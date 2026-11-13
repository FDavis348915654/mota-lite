# mota-lite-esp32 · 魔塔 Lite 的 ESP32-S3 移植

把 `mota-lite-web` 搬到微雪 **ESP32-S3-Touch-AMOLED-2.16**（480×480 QSPI AMOLED + 触摸 + 双麦）。
核心原则：**逻辑层一行不改**，`mota-lite-web/logic.js` 原样跑在板子上，本项目只负责渲染、输入与板级驱动。

---

## 当前状态：M1 完成

| 项 | 实测值 |
|---|---|
| 固件 | 1,413,088 字节（资源 634 KB + QuickJS + 代码） |
| 启动 | 约 1.9 秒到首帧 |
| 运行内存 | 内部 RAM 剩 155 KB，PSRAM 剩 7.44 MB |
| 逻辑包 | 64,704 字节，QuickJS 一次性 eval（对齐 web 版 **v0.17.0**） |
| 首局自检 | `第1层 (1,1) HP=200 ATK=10 DEF=10`，地图 `#############` / `#@..........#` |

**已可用**：完整渲染管线（地图/精灵/24px 中文/侧栏/底栏）、触摸点击 + BFS 自动寻路、方向与配色正确。
**未做**：战斗结算 UI、音效、存档落盘、上下楼与飞行器、图鉴与商店弹层。

---

## 架构

```
        ┌─────────────────────────────┐
        │  mota-lite-web/logic.js     │  纯函数、零 DOM，web 与 ESP32 共用同一份
        │  mota-lite-web/tables.js    │  关卡与数值表
        └──────────────┬──────────────┘
                       │ tools/bundle_logic.py 合成单文件 IIFE
                       ▼
        ┌─────────────────────────────┐
        │  QuickJS (espressif/quickjs-ng) │
        └──────────────┬──────────────┘
                       │ JS_Call / JS_GetPropertyStr
                       ▼
   board.c ◄── game.c（状态桥 + 游戏逻辑） ──► gfx.c（软件渲染）
   屏/触摸/电源        输入映射、寻路            帧缓冲 + 精灵 + 点阵字
```

### 三个关键取舍

**1. 逻辑层不翻译成 C**

`logic.js` 731 行、20 个导出函数，翻译成 C 约 1500 行。但 web 版仍在迭代（当前 v0.16.0），
每改一次战斗公式或任务线，C 版就得同步重译，分叉是必然的。
走 QuickJS 后逻辑层永远是同一个文件，web 版升级只需重跑一次 `bundle_logic.py`。

**2. 不用微雪官方 BSP**

`waveshare/esp32_s3_touch_amoled_2_16` 硬依赖 lvgl + libpng + freetype + jpeg + qoi + zlib
一整棵图片/字体解码树（23 个组件）。本项目自绘 framebuffer，这些一个都用不到。
砍掉后依赖只剩 6 个，全量构建从 7 分钟降到 1 分钟。
代价是板级初始化要自己写——参数全部抄自官方 BSP 源码的 yaml，不是猜的。

**3. 画面旋转用软件转置，不改 MADCTL**

这块 CO5300 的原生扫描方向比逻辑画面顺时针多 90°。CO5300 驱动的
`draw_bitmap` 不会随 MADCTL 的 MV 位交换 CASET/RASET，改寄存器会导致坐标语义错乱；
软件转置则渲染层完全无感，触摸也保持原映射不动。

---

## 目录结构

```
main/
  main.c        启动流程 + 方向自检图
  board.c       板级：I2C / AXP2101 / CO5300 QSPI / CST9217 触摸 / 分块推屏
  gfx.c/.h      RGB565 帧缓冲、精灵 blit、UTF-8 点阵文字
  game.c/.h     QuickJS 状态桥、事件处理、地图与 HUD 渲染、BFS 寻路
  input.c/.h    触摸按下沿检测、Key3 重开
  assets/       由 tools/export_assets.py 生成，勿手改
    sprites.c   46 帧 28×28 RGB565 + 1bit alpha（74 KB）
    font24.c    3890 字形 24×24 点阵（364 KB）
    sfx.c       12 段 22050Hz/16bit/mono PCM（196 KB）
    tilemap.c   43 条「地图字符 → 精灵帧」映射
  js/
    logic_bundle.js   由 tools/bundle_logic.py 生成，CMake EMBED 进固件

tools/
  export_assets.py    图集/字库/音效/映射 → C 数组
  bundle_logic.py     tables.js + logic.js → 单文件 IIFE（含移植适配层）
  smoke_test.js       无 DOM 环境下验证逻辑包可用（13 项断言）
  preview_font.py     把点阵打成 ASCII art，改字体前先看效果

build.ps1             固化的构建入口（见「构建」）
partitions.csv        nvs 0x9000/0x6000 · phy_init 0xf000/0x1000 · factory 0x10000/0x700000
```

---

## 数据来源（改上游要重跑生成链）

| 内容 | 来源 | 生成方式 |
|---|---|---|
| 逻辑与数值 | `../mota-lite-web/{logic,tables}.js` | `python tools/bundle_logic.py` |
| 精灵/音效 | `../mota-lite-web/assets/` | `python tools/export_assets.py` |
| 中文字库 | `texts.js` 用字 + GB2312 一级汉字 | 同上（simhei 24px 渲染） |
| 硬件引脚 | `waveshareteam/waveshare_boards` 的 `boards/esp32_s3_touch_amoled_2_16/*.yaml` | 手抄进 board.c |

改完资源或逻辑后必须重新生成并重编，`build/` 不会自动跟踪 `../mota-lite-web` 的变化。

**顺序不能反**：`bundle_logic.py` → `smoke_test.js`（13 项断言全过）→ `export_assets.py` → `build.ps1 build`。
当前对齐 web 版 **v0.17.0**；v0.17 的兼容性核查结论见开发记录文档第 9 节。

---

## 引脚（来自官方 BSP yaml，勿随意改）

| 用途 | 引脚 |
|---|---|
| I2C（触摸/AXP2101） | SDA **15** · SCL **14**，400 kHz |
| 屏 CO5300 QSPI | MOSI **4** · MISO **5** · WP **6** · HD **7** · SCLK **38** · CS **12** · RST **39** |
| 触摸 CST9217 | I2C 地址 **0x5A** · RST **40** · INT **11** · `swap_xy=1 mirror_y=1` |
| 电源 AXP2101 | I2C 地址 **0x34**，只需 `reg 0x90 = 0x01` 打开 ALDO1（麦克风）；屏的 VCC3V3 走 DCDC1 默认输出 |
| 用户键 Key3 | **18**（上拉，按下接地） |

---

## 构建

IDF **v6.0.2**，装在 `C:\esp\esp-idf`；工具链在 `%USERPROFILE%\.espressif`；都不在系统 PATH。

```powershell
cd C:\VersionFiles\mota-lite\mota-lite-esp32

.\build.ps1 set-target esp32s3     # 首次
.\build.ps1 build
.\build.ps1 -p COM4 flash monitor  # 烧录并看日志
```

`build.ps1` 做的事情：拼好 `IDF_PATH` / `IDF_PYTHON_ENV_PATH` / `ESP_IDF_VERSION` / `ESP_ROM_ELF_DIR`
以及工具链 PATH，然后调 `idf.py`。**必须用 PowerShell**，Git Bash 会被 IDF 拒绝（见「坑」）。

烧录地址（手工烧时）：
```
0x0      build/bootloader/bootloader.bin
0x8000   build/partition_table/partition-table.bin
0x10000  build/mota_lite_esp32.bin
```

---

## 关键实现细节

**分块推屏（20 行 / 19200 字节）**
帧缓冲在 PSRAM，SPI 驱动要为不满足 DMA 要求的源缓冲在内部 RAM 分配中转缓冲
（`spicommon_dma_setup_priv_buffer`）。整屏 460800 字节一次要，内部 RAM 只有 ~50KB 空闲，
直接返回 `ESP_ERR_INVALID_ARG`。所以按 20 行一段推，24 段约 6~10ms。

**RGB565 字节序**
CO5300 按高字节先收，而 ESP32 是小端存放 `uint16_t`。不交换的话 `0x1082` 被读成 `0x8210`，
整屏呈现偏紫粉的错色。交换在两边各做一次，必须保持一致：
`tools/export_assets.py` 的 `rgb565()` 与 `main/gfx.h` 的 `rgb565_pack()`。

**中文用 24px 不用 16px**
实测 16px 复杂汉字笔画糊成一团（「魔」的鬼部无法分辨）。24px SimHei 结构清晰，
3890 字占 364 KB，Flash 完全够。

**JS 方向参数是字符串**
`logic.js` 的 `DIR` 以 `'up'/'right'/'down'/'left'` 为 key，不是索引。
`bundle_logic.py` 生成了 `stepByIndex(s, d)` 适配层，C 侧传 0..3 即可。

**地图取数一次拿整层**
`floorString(s)` 返回 15 行拼成的单字符串，C 侧一次 `JS_ToCString` 就得到整层，
避免 195 次跨语言调用。

---

## 踩过的坑

| # | 现象 | 根因 |
|---|---|---|
| 1 | IDF 拒绝运行 | Git Bash 会触发 `MSys/Mingw is not supported`，必须走 PowerShell |
| 2 | `Version string lacks a numerical component` | `ESP_IDF_VERSION` 不能带 `v` 前缀 |
| 3 | 配置/编译「莫名失败」 | PowerShell `$ErrorActionPreference="Stop"` 把 IDF 写到 stderr 的 Kconfig 警告当成致命错误 |
| 4 | `undefined reference to _binary_js_logic_bundle_js_start` | `EMBED_TXTFILES` 符号名取 basename，不含目录前缀 |
| 5 | `SyntaxError: unexpected token` | 同一机制会在末尾追加 `\0`，传给 `JS_Eval` 的长度必须减 1 |
| 6 | `draw_bitmap` 返回 0x101 | PSRAM 源缓冲的 DMA 中转缓冲分配失败，需分块推 |
| 7 | 整屏偏紫粉 | RGB565 高低字节没交换 |
| 8 | 画面顺时针多转 90° | CO5300 原生扫描方向，需软件逆时针转置 |

---

## 待办

**M2（让 1F 真正可通关）**
- 战斗/拾取/开门的事件 UI（现在只在底栏出一行字）
- HUD 图标化（当前全是数字文字）
- 上下楼、飞行器、图鉴、商店弹层
- 存档落 NVS（`serialize()/deserialize()` 已就绪）

**M3（打磨）**
- 12 段 PCM 接 I2S / ES8311 出声
- 精灵动画（`hero_a`/`hero_b` 已有两帧）
- 转置用 PPA 硬件加速（现在是 CPU 循环，每帧 230400 次）

**长期**
- 去掉方向自检图（`main.c` 里 5 秒延时）
- 触摸日志降级（`input.c` 每次点击都打 INFO）

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

整片写回后连「小智已绑定」的状态都会恢复，不需要重新配网输验证码。
