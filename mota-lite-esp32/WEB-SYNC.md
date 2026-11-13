# ESP32 版 ↔ web 版：共同点与差异点

> 这份文档只回答一件事：**改 web 版之后，ESP32 版会跟着变吗？要做什么？**
> 工程自身的构建/引脚/回滚见 `README.md`。

---

## 1. 一句话结论

- **逻辑、数据、文案是同一份代码**：`logic.js` / `tables.js` / `texts.js` 在运行时由 QuickJS 执行，C 侧不重写规则。
- **界面是照着重写的**：布局、绘制、动画、弹层、按钮全在 C 里（`game.c` / `gfx.c`），只共享“行为”，不共享代码。
- **所有内容都是编译期快照**：固件里没有 WiFi / HTTP / 文件读取，改 web 不会“自动感知”。
  必须手动跑生成链再编译，**跳过也不会报错**——这是最容易踩的坑。

---

## 2. 三层关系

| 层 | web 侧 | ESP32 侧 | 改 web 后 |
|---|---|---|---|
| 玩法规则 | `logic.js` | 打包成 `main/js/logic_bundle.js`，QuickJS `eval` | 重跑打包即 100% 跟随，**C 代码零改动** |
| 数据表 | `tables.js` | 同上（一起打包） | 同上 |
| 文案/剧情 | `texts.js` | 同上（一起打包） | 同上；新字要重导字库（见 §5） |
| 精灵图 | `assets/sprites.png` + `sprites.json` | `main/assets/sprites.c` + `tilemap.c`（编译期导出） | 重跑导出脚本 |
| 音效 | `assets/audio/*.wav` | `main/assets/sfx.c`（PCM 数组） | 重跑导出脚本 |
| 字库 | 浏览器字体 | `font24.c` / `font20.c`（点阵） | 重跑导出脚本 |
| 界面布局 / 渲染 | `index.html` + `style.css` + `app.js` 的 DOM 操作 | **C 重写**（约 2,300 行） | ❌ 不跟随，人工移植 |
| 动画 / 弹层 / 按钮 | CSS 过渡 + `app.js` | **C 重写** | ❌ 不跟随 |
| 寻路 | `app.js` 的 `walkTo` | C 自写 BFS（`walk_to`） | ❌ 行为对齐，代码独立 |
| 存档 | `localStorage` | NVS（`logic.serialize()` 同源字符串） | ✅ 格式天然一致 |

---

## 3. 文件对照表

| web 文件 | ESP32 对应物 | 同步方式 |
|---|---|---|
| `logic.js` | 打进 `logic_bundle.js` | `python tools/bundle_logic.py` |
| `tables.js` | 同上 | 同上 |
| `texts.js` | 同上 | 同上 |
| `assets/sprites.png` / `sprites.json` | `main/assets/sprites.c`、`tilemap.c` | `python tools/export_assets.py` |
| `assets/audio/*.wav` | `main/assets/sfx.c` | 同上 |
| 文本里的汉字 | `main/assets/font24.c`（3,890 字形） | 同上 |
| `index.html` / `style.css` | 无（布局在 `game.c` 顶部宏） | 人工移植 |
| `app.js` | `game.c`（状态机 / 渲染 / 输入） | 人工移植 |
| `version.js` | 目前未进入固件（只在 README 记版本） | 见 §7 待办 |

---

## 4. 改完 web 的标准动作

```bash
cd mota-lite-esp32
python tools/bundle_logic.py      # 规则 + 数据 + 文案
python tools/export_assets.py     # 精灵 / 音效 / 字库 / tileMap
python tools/check_sync.py        # 静态检查：快照/FLAG/剧情 key/tileMap/字库
# 然后 build.ps1 build + 烧录
```

只想确认"要不要重打包"时，用只读模式：`python tools/bundle_logic.py --check`
（不落盘，一致返回 0、落后返回 1）。

顺序不能反：`export_assets.py` 的字符集来自 `texts.js`，后跑才包含新文案的字。

**跳过第一条** → 规则/关卡/文案全部停在旧版本，但编译照样成功。
**跳过第二条** → 图、音、字停在旧版本，新怪可能渲染成空白。

---

## 5. 静默风险（不报错但会错）

| 风险 | 触发条件 | 表现 |
|---|---|---|
| **FLAG 位值漂移** | `logic.js` 的 `FLAG` 中间插入新位，C 里 5 个宏（1 / 2 / 16 / 128 / 256）是**抄的常量** | 炸弹按钮不出现 / 提前解锁，无任何报错 |
| **tileMap 缺字符** | 新增怪物或道具字符，`sprites.json` 的 `tileMap` 没加 | 该格渲染成空帧（`SPR_NONE`） |
| **剧情 key 改名** | C 里硬编码 19 个 key（`intro`/`elder`/`fly`/`lockpick`/`moneybag`/`thief_*`/`fairy_*`/`mage_free`/`sealed_door`/`elite_hint`/`core_hint`/`win`/`lose`） | 弹层空白或不出 |
| **生僻字** | 文案用到 GB2312 一级 3,755 字以外的字 | 该字留半个字宽，不报错 |
| **新界面元素** | web 新增面板/按钮/手势 | ESP32 完全不知道，需人工移植 |
| **消息过长** | 单条 > 约 54 字（底栏 3 行 × 24px） | 末尾被截成 `...` |

字库不算脆弱：不是按当前文本取子集，而是 **ASCII + GB2312 一级 + `texts.js` 出现的全部字**，
常规新文案都能覆盖。

---

## 6. 已验证的一致性（v0.17.0）

| 项 | 结果 |
|---|---|
| `logic.js` 导出 | 23 个，签名未变 |
| 怪物种类 | 8 → 9（新增 `X`，`tileMap` 已映射到 `elite` 帧） |
| 精灵帧 / tileMap | 46 / 43，未变 |
| 关卡 schema | 7 → 8，只影响 `tables.js` 生成 |
| 1F 地图 | 195 格 / 94 墙，完全相同 |
| 逻辑断言 | `tools/smoke_test.js` 13 项全过（含“对史莱姆破不了防”这一 v0.17 变更） |
| 快照漂移 | 重跑打包与仓库内 `logic_bundle.js` 逐字节一致 |

---

## 7. 布局差异（设计上的取舍，不是缺陷）

| 维度 | web | ESP32 | 说明 |
|---|---|---|---|
| 视口 | 7×9 格 + 相机 | **7×9 格 + 相机（整格跳转）** | 已对齐，同一公式 |
| 格子尺寸 | CSS 缩放（约 38px） | 42px（源图 28px × 1.5） | 480 宽屏上约 4.8mm |
| 侧栏 | 320px 独立栏 | 186px（数值 24px） | 屏窄，压缩但放大字号 |
| 动作栏 | 屏幕内 3 列 | 侧栏 2 列 + 设置整行 | 触控优先 |
| 底栏 | 全宽、可滚动 | 480×102，3 行 | 长消息仍可能截断 |
| 战斗预览 | 侧栏只读面板 | 同（点怪直接结算） | 行为一致 |
| 攻略回放 / 求解器 | 有 | 没搬 | 设备上用途不大 |
| 事件历史 | 有 | 没搬 | 同上 |

---
