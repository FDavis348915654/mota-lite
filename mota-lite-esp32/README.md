# mota-lite-esp32 · 魔塔 Lite 的 ESP32-S3 移植

把 `mota-lite-web` 搬到微雪 **ESP32-S3-Touch-AMOLED-2.16**（480×480 QSPI AMOLED + 触摸 + 双麦）。
核心原则：**逻辑层一行不改**，`mota-lite-web/logic.js` 原样跑在板子上，本项目只负责渲染、输入、动画、音频与板级驱动。

---

## 当前状态：M1/M2/M3 + 交互对齐完成

| 项 | 实测值 |
|---|---|
| 固件 | **1,755,792 字节**（资源 634 KB + 12 段 PCM 196 KB + QuickJS + 代码） |
| 启动 | 约 2.0 秒到首帧 |
| 运行内存 | 内部 RAM 剩 **78 KB**，PSRAM 剩 **7.43 MB** |
| 逻辑包 | **94,809 字节**（含 `texts.js` 剧情文案），QuickJS 一次性 eval（web v0.17.0） |
| 单帧推屏 | **50 ms**（软件转置 26 ms + 12 段 QSPI 24 ms） |
| 音频 | ES8311 / I2S0，22.05 kHz 单声道，音量 **32** |

**已实现（与 web 版对齐）**

- 完整渲染：地图 13×15、46 帧精灵、24px 中文 + 20px ASCII 变宽字库、侧栏 HUD、底栏双行提示
- **逐格行走**：点远处格子后 150 ms/步移动，不是瞬移；走到实体旁停一拍再交互
- **战斗动画 460 ms**：保留战前网格（怪还在）、英雄冲刺残影、命中特效、`-NHP` 飘字、震动边框
- **动作栏 7 项**：升层 / 降层 / 炸弹 / 购买 / 图鉴 / 新游 / 设置；炸弹与购买按 flags 解锁，图鉴未持书时淡化
- **剧情弹层**：序章、首次进层、暗格/暗门/飞行器/老者/封印门/精英怪提示/小精灵/法师/盗贼/通关/阵亡
- 商店（2F/17F）、法师经验兑换（8F）、怪物图鉴（6F 后）
- 存档：`save` 事件合并写 NVS、开机读档；步数、经验、最高层/通关次数/最少步数记录
- 音效：12 段 PCM，事件文本 → 音效/动画的映射与 web `pickSfx` 同源
- 设置：音效开关、战斗动画开关、重新开始（二次确认）、记录展示
- **熄屏**：空闲 2 分钟自动关屏（AMOLED 静态画面长期不灭会烧屏），任意触摸/按键唤醒，第一下只负责点亮不误触走格
- 诊断：USB 串口 `cap / tap / load / newgame / state / font / off / on`（见下）

**刻意保留的差异**

- **整层 13×15 全显示**，没有照搬 web 的 7×9 视口 + 相机跟随：480×480 上全层可见更适合看塔防布局，也省掉相机逻辑。动作栏因此放在右侧栏底部，而不是屏幕内 3 列。
- **没有做攻略回放/求解器**（`solver.js` 245 行 + 回放 UI），设备上用途不大。
- **没有战斗预览弹窗**：web 的「战斗预览」是侧栏的一个只读面板，不是点怪弹窗；点怪在 web 与这里都是直接结算。
- **PPA 硬件转置未启用**：软件转置 26 ms、整帧 50 ms，回合制够用；PPA 的旋转方向只能实物目视确认，不冒方向反掉的风险。

---

## 架构

```
        ┌─────────────────────────────┐
        │  mota-lite-web/logic.js     │  纯函数、零 DOM，web 与 ESP32 共用同一份
        │  mota-lite-web/tables.js    │  关卡与数值表
        │  mota-lite-web/texts.js     │  剧情与 UI 文案（纯数据）
        └──────────────┬──────────────┘
                       │ tools/bundle_logic.py 合成单文件 IIFE
                       ▼
        ┌─────────────────────────────┐
        │  QuickJS (espressif/quickjs-ng) │
        └──────────────┬──────────────┘
                       │ JS_Call / JS_GetPropertyStr
                       ▼
   board.c ◄── game.c（状态桥 + 交互 + 动画 + 弹层） ──► gfx.c（软件渲染）
   屏/触摸/电源        事件文本 → 音效/动画/存档          帧缓冲 + 精灵 + 两档字库
                       │
                       ▼
                    audio.c（ES8311 + I2S，独立播放任务）
```

### 四个关键取舍

**1. 逻辑层不翻译成 C**

`logic.js` 731 行、23 个导出函数。web 版仍在迭代，翻译成 C 必然分叉。
走 QuickJS 后逻辑层永远是同一个文件，web 升级只需重跑 `bundle_logic.py`。
`texts.js` 也一起打进 bundle（94 KB），剧情文案与 UI 词条同样单一真源。

**2. 不用微雪官方 BSP**

`waveshare/esp32_s3_touch_amoled_2_16` 硬依赖 lvgl + libpng + freetype + jpeg + qoi + zlib。
本项目自绘 framebuffer，一个都用不到；砍掉后全量构建从 7 分钟降到 1 分钟。
板级参数全部抄自官方 BSP 源码的 yaml。

**3. 画面旋转用软件转置，不改 MADCTL**

CO5300 的原生扫描方向比逻辑画面顺时针多 90°。驱动的 `draw_bitmap` 不会随 MADCTL 的 MV 位
交换 CASET/RASET，改寄存器会导致坐标语义错乱；软件转置则渲染层与触摸都无感。

**4. 战斗没有独立界面**

与 web 一致：撞上去直接结算，结果显示在底栏。动画/音效由宿主层按事件文本推断
（`胜 ` → 命中 + `battle_hit`；`获得`/`已救出` → 拾取；`门已打开`/`进入` → 开门），
逻辑层不感知任何资源。

---

## 目录结构

```
main/
  main.c        启动 + 主循环（点击注入 / 截图锁 / 动画置脏）
  board.c       板级：I2C / AXP2101 / CO5300 QSPI / CST9217 / 分块推屏 / 分块转置
  gfx.c/.h      RGB565 帧缓冲、精灵 blit、24px 中文 + 20px ASCII、自动折行与行首禁则
  game.c/.h     QuickJS 桥、逐格寻路、战斗动画、剧情/商店/图鉴/设置/确认、全部渲染
  audio.c/.h    ES8311 + I2S0，12 段 PCM 排队播放（队列只保留最新一条）
  input.c/.h    触摸按下沿、Key3（静音 / 结算页重开）
  diag.c/.h     USB 串口诊断：cap / tap / load / newgame / state / font
  assets/       由 tools/export_assets.py 生成，勿手改
    sprites.c   46 帧 28×28 RGB565 + 1bit alpha（74 KB）
    font24.c    3890 字形 24×24 点阵 + 变宽推进（364 KB）
    font20.c    95 字形 20×20 ASCII（HUD 数值 / 伤害飘字）
    sfx.c       12 段 22050Hz/16bit/mono PCM（196 KB）
    tilemap.c   43 条「地图字符 → 精灵帧」映射
  js/
    logic_bundle.js   由 tools/bundle_logic.py 生成（tables + texts + logic）

tools/
  export_assets.py    图集/字库/音效/映射 → C 数组
  bundle_logic.py     tables.js + texts.js + logic.js → 单文件 IIFE
  smoke_test.js       无 DOM 环境下验证逻辑包（13 项断言）
  preview_font.py     点阵 ASCII art 预览
  cap.py / probe.py   通过 USB 抓帧 / 注入点击（配合 diag.c）

build.ps1             固化的构建入口
partitions.csv        nvs 0x9000/0x6000 · phy_init 0xf000/0x1000 · factory 0x10000/0x700000
```

---

## 界面布局（480×480）

```
┌───────────────────────────┬────────────┐
│                           │ 2F         │  侧栏 116px：
│   地图 13×15，每格 28px   │ 血200      │  · 楼层 + 血/攻/防/金
│   364×420                 │ 攻30       │  · 三色钥匙 + 步数 + 经验
│                           │ 防10       │  · 动作栏 2 列 × N 行
│                           │ 金100      │    升层/降层 · 炸弹/购买
│                           │ 黄0 蓝0 红0│    图鉴/新游 · 设置
│                           │ 步5 经12   │
│                           │ [升层][降层]│
│                           │ [炸弹][购买]│
│                           │ [图鉴][新游]│
│                           │ [设置]      │
├───────────────────────────┴────────────┤
│ 底栏 480×60：提示/战斗结果，两行 24px  │
└────────────────────────────────────────┘
```

- 动作栏按 `visible_actions()` 动态排列：炸弹（`FLAG_BOMB_UNLOCK`）与购买（`FLAG_SHOP_SEEN`）
  未解锁时**不占位**，后续按钮自动前移，与 web 的 `display:none` 行为一致。
- 图鉴未持书时按钮淡化，仍可点击并给出「先去 6F 找图鉴」提示。
- 侧栏数值用 20px ASCII 变宽字库，4 位 HP/金币也不会顶到边。

---

## 数据来源（改上游要重跑生成链）

| 内容 | 来源 | 生成方式 |
|---|---|---|
| 逻辑与数值 | `../mota-lite-web/{logic,tables}.js` | `python tools/bundle_logic.py` |
| 剧情与文案 | `../mota-lite-web/texts.js` | 同上（打进 bundle） |
| 精灵/音效 | `../mota-lite-web/assets/` | `python tools/export_assets.py` |
| 中文字库 | `texts.js` 用字 + GB2312 一级汉字 | 同上（simhei 24px） |
| 小字库 | ASCII 0x20-0x7E | 同上（simhei 20px） |
| 硬件引脚 | `waveshareteam/waveshare_boards` 的 yaml | 手抄进 board.c |

**顺序不能反**：`bundle_logic.py` → `smoke_test.js`（13 项断言全过）→ `export_assets.py` → `build.ps1 build`。

---

## 引脚（来自官方 BSP yaml，勿随意改）

| 用途 | 引脚 |
|---|---|
| I2C（触摸/AXP2101/ES8311） | SDA **15** · SCL **14**，400 kHz |
| 屏 CO5300 QSPI | MOSI **4** · MISO **5** · WP **6** · HD **7** · SCLK **38** · CS **12** · RST **39**，80 MHz |
| 触摸 CST9217 | I2C 地址 **0x5A** · RST **40** · INT **11** · `swap_xy=1 mirror_y=1` |
| 电源 AXP2101 | I2C 地址 **0x34**，`reg 0x90 = 0x01` 打开 ALDO1 |
| 音频 I2S0 | MCLK **42** · BCLK **9** · WS **45** · DOUT **8** · DIN **10** |
| 功放 PA | **46**（高有效） |
| 用户键 Key3 | **18**（上拉，按下接地） |

---

## 构建

IDF **v6.0.2**，装在 `C:\esp\esp-idf`；工具链在 `%USERPROFILE%\.espressif`。

```powershell
cd C:\VersionFiles\mota-lite\mota-lite-esp32

.\build.ps1 set-target esp32s3     # 首次
.\build.ps1 build
.\build.ps1 -p COM4 flash monitor
```

手工烧录地址：
```
0x0      build/bootloader/bootloader.bin
0x8000   build/partition_table/partition-table.bin
0x10000  build/mota_lite_esp32.bin
```

---

## 串口诊断（无实物验收用）

`diag.c` 直接读 USB Serial JTAG 字节（console 在 UART0，stdin 读不到 USB）。
命令以 `\n` 结尾：

| 命令 | 作用 |
|---|---|
| `cap` | 冻结渲染 → 拷贝帧缓冲 → base64 分块吐出（配合 `tools/cap.py` 转 PNG） |
| `tap X Y` | 注入一次点击（主循环执行，避免与渲染线程抢 framebuffer） |
| `load <存档串>` | 直接载入 `4\|...` 存档并落盘（测试用） |
| `newgame` | 清档重开 |
| `state` | 打一行状态（层/坐标/HP/攻防/金币/钥匙/步数/结束/flags/覆盖层） |
| `font` | 打印字宽（排查排版） |
| `off` / `on` | 关屏 / 点亮（关屏 = 亮度 0 + DISPOFF，彻底熄像素） |

> 打开 COM4 会让板子复位。`tools/probe.py` 已处理：等「诊断命令就绪」再发命令，
> 并在一次连接里连续执行 `tap / sleep / cap / load / state`。

---

## 关键实现细节

**逐格行走**
`walk_to()` 先用 BFS 找路（中间格只走 `. @ H U D W`，实体不穿越），把方向序列存进
`s_path[]`；`game_tick()` 每 150 ms 弹一步。走到实体旁时 `s_pending` 再等一拍才交互，
避免「还有一格就开始结算」。新点击/弹层/换层/被挡都会 `stop_auto()`。

**关屏（`board_screen()`）**
AMOLED 没有背光可控，所以关屏做两层：`esp_lcd_panel_co5300_set_brightness(0)` 让像素彻底熄灭，
再发 `DISPOFF(0x28)` 停扫描；开屏反向（`DISPON` + 亮度 100）。帧缓冲内容原样保留，
唤醒后不需要重绘，看上去像"瞬间恢复"。空闲判定在 `input.c`，触摸/按键/串口注入都会刷新计时；
熄屏后的第一次触摸只唤醒、不传给游戏，避免黑屏误触走错格。

> 注意：**打开 COM4 会让板子复位**，复位后屏会重新点亮。要它整夜不亮，最后一次串口操作应是 `off`。

**战斗动画**
命中后保留战前 `s_grid` 到 `s_anim.grid`，状态立即更新（HP/金币），但画面继续画旧网格
460 ms；期间画冲刺残影（0-170 ms）、命中特效与 `-NHP` 飘字（100-460 ms）。结束后
`read_grid()` 提交新网格。动画期间输入被忽略。

**自动折行 + 行首禁则**
`gfx_text_wrap` 按像素宽度断行，`closing_punct()` 允许 `，。！？：；）」】》` 悬在行尾，
不会出现在行首。剧情正文最多 9 行（432px 面板内）。

**两档字库都变宽**
24px 汉字 24px 全宽，ASCII 按墨迹右边界 +2 推进；20px 只含 ASCII，用于 HUD 数值与伤害飘字。
否则 `-56HP` 会被排成 `- 5 6 H P`。

**分块转置/推屏**
转置按 32×32 分块（源/目标工作集各 2 KB，能进 cache），从 43 ms 降到 26 ms；
推屏 40 行/段（38.4 KB），12 段 24 ms。整帧 50 ms。

**存档只认对象**
`logic.deserialize()` 对坏档返回 `null`。C 侧必须先 `JS_IsObject()` 再替换 `s_state`，
否则 HUD 全 0、下一次存档会把旧进度写成空档（本项目踩过，已修）。

---

## 踩过的坑

| # | 现象 | 根因 |
|---|---|---|
| 1 | IDF 拒绝运行 | Git Bash 触发 `MSys/Mingw is not supported`，必须 PowerShell |
| 2 | `Version string lacks a numerical component` | `ESP_IDF_VERSION` 不能带 `v` 前缀 |
| 3 | 配置/编译「莫名失败」 | `$ErrorActionPreference="Stop"` 把 Kconfig 警告当致命错误 |
| 4 | `undefined reference to _binary_js_logic_bundle_js_start` | `EMBED_TXTFILES` 符号名取 basename |
| 5 | `SyntaxError: unexpected token` | 同一机制末尾追加 `\0`，`JS_Eval` 长度要减 1 |
| 6 | `draw_bitmap` 返回 0x101 | PSRAM 源缓冲的 DMA 中转缓冲分配失败，需分块推 |
| 7 | 整屏偏紫粉 | RGB565 高低字节没交换 |
| 8 | 画面顺时针多转 90° | CO5300 原生扫描方向，软件逆时针转置 |
| 9 | `driver/gpio.h: No such file` | `espressif/es8311` 旧组件未声明 IDF6 依赖；用 `esp_codec_dev` 内置驱动 |
| 10 | `JS_IsArray` 参数过多 | quickjs-ng 0.14 签名是 `JS_IsArray(JSValue)`，不带 ctx |
| 11 | 推屏 80 ms | 列优先写 PSRAM 缓存全失效；32×32 分块 + 40 行/段降到 50 ms |
| 12 | 点远处格子永远「走不到它旁边」 | BFS 回溯把起点也塞进 path，方向计算 `0,0` 直接 return 0 |
| 13 | 坏档后 HUD 全 0、存档被覆盖 | `deserialize` 返回 null 被当成合法 state；加 `JS_IsObject` 保护 |
| 14 | 图鉴永远「本层没有怪物」 | `seen` 名额先被道具/NPC 占满；只在确认是怪物后占用 |
| 15 | 截图半帧撕裂 | 直接读 framebuffer 时渲染未停；加 `diag_capture_locked()` 冻结渲染 |

---

## 待办（可选）

- 存档串导入/导出 UI（目前只有串口 `load` 与 NVS 单槽）
- 事件历史面板（web 有，设备上价值一般）
- 攻略回放（`solver.js`，不建议搬）
- 7×9 视口 + 相机跟随（如果更想要 web 的观感）
- PPA 硬件转置（26 ms → ~2 ms，需实物确认方向）
- HUD 图标化、标题页、通关统计页
- 亮度三档（驱动已支持 `esp_lcd_panel_co5300_set_brightness`，只是没做入口）

---

## 回滚到出厂固件

出厂固件全片 16 MB 备份（含 NVS 里的 WiFi 密码与小智绑定身份）：

```
C:\Users\34891\WorkBuddy\2026-11-13-21-57-01\esp32s3-amoled216-full-16MB-backup.bin
MD5: 31d5cd1e05e938e0c9b74ed9cb904b01
```

```powershell
python -m esptool --chip esp32s3 -p COM4 -b 921600 write-flash 0 "<备份路径>"
```
