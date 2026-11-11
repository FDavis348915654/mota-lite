# 小米手环10 · 网格回合制 RPG（Magic Tower Lite）开发方案

> 目标设备：小米手环 10（212×520，胶囊形 AMOLED，Vela OS）\
> 目标产出：可侧载到自用手环的 `.rpk` 快应用，玩法为「魔塔」极简版\
> 参照文档：《小米手环10-雷电Lite开发方案》（同空间，下称《雷电Lite》）\
> 文档用途：换机器后照此继续实现，无需回溯上下文；技术底座与真机安装流程沿用《雷电Lite》，本文只写差异\
> 配套骨架：`mota-lite-skeleton/`（逻辑层 + 配置表 + 离线校验脚本，已用 node 跑通，见附 B）\
> **M1 实现状态（2026-11-10）**：完整工程已落地在 `mota-lite/`，`npm run check` 全绿。本文 §7 的代码块是设计稿，实际代码以工程内文件为准，**5 处修正见附 C**。
>
> **当前阶段（2026-11-11 起）：在线版 v0.8.0（13×15 大地图与主动交互），真机仍暂缓。** 用户明确「真机相关内容暂缓，先在在线版体验完整」；本轮按浏览器体验反馈重做全部 21 层地图，并把「点哪儿走哪儿」改成「点实体才交互」。据此：
> - 手环端 M1 工程 `mota-lite/` **继续冻结**：不编译 `.rpk`、不进 AIoT-IDE 模拟器、不上真机，**M2 全部暂缓**；
> - 在线试玩版 `mota-lite-web/` 的 21 层全部重做为 **13×15 主题大地图**（单层 195 格、一屏只显示 7×9，靠视口裁剪 + 相机跟随），新增房间层（房内宝物 / 法师 / 盗贼 / 商人，门口有守怪）；
> - 寻路把物品 / 怪物 / 商店 / NPC 视为**阻挡**，玩家主动点实体才会走到它旁边一格再交互，交互完即停；
> - 新增宝物**图鉴**（全塔唯一，6F 房间）：拾取后解锁图鉴按钮，展示当前层存活怪物的 HP / 攻 / 防与战斗预测；新增被困的**法师 / 盗贼**救援奖励；
> - **飞行器**改为全塔唯一的中期永久道具（11F 房间），且只能跳往**已探索过的楼层**；存档升 **v3**（head 加 `book`、新增 `explored` 段，兼容 v2 / v1）；
> - 屏幕缩放新增 **0.5×** 档，便于确认手环观感。规格与验收见**附 H**；v0.7.0 的存档槽 / 新游戏入口 / 二次确认结论见**附 G**，仍然有效；
> - 本文 §3.3 原「明确不做」的能力（隐藏道具 / 飞行器 / 炸弹 / 战斗动画 / 文本框弹层）经用户确认**全部纳入开发**，已在在线版落地，规格见附 D / 附 E / 附 F / 附 G；
> - 本文 §4 / §6 / §7 / §11 描述的是 **M1 手环端基线**，其数值（3 层、26 步、HP96、128B 存档）对 M1 仍准确、**不回改**；在线版对应数值以附 D（v0.4.0）～附 G（v0.7.0）快照与附 H～附 M 为准（**当前阶段：附 M，v0.11.0**）；真机解冻时的唯一开工清单见**附 I**。

---

## 目录

1. [结论与定位](#1-结论与定位)
2. [技术底座](#2-技术底座)
3. [硬约束重估与能力映射](#3-硬约束重估与能力映射)
4. [玩法规格（魔塔 Lite）](#4-玩法规格魔塔-lite)
5. [屏幕与操作适配](#5-屏幕与操作适配)
6. [数据设计：配置层优先](#6-数据设计配置层优先)
7. [工程结构与完整骨架代码](#7-工程结构与完整骨架代码)
8. [性能预算与调优](#8-性能预算与调优)
9. [真机安装与存档代价](#9-真机安装与存档代价)
10. [踩坑清单](#10-踩坑清单)
11. [里程碑与验收标准](#11-里程碑与验收标准)
12. [参考资料](#12-参考资料)

> 文末另有附 A（下次开工）、附 B（离线校验实测）、附 C（M1 工程落地）、附 D（在线版完整内容阶段 v0.4.0 快照）、附 E（M3 内容收尾 v0.5.0 快照）、附 F（21 层与交互重构 v0.6.0 快照）、附 G（存档安全与新游戏入口 v0.7.0 快照）、**附 H（当前阶段：13×15 大地图与主动交互 v0.8.0）**、**附 I（真机 M2 开工清单·合并版，取代 D.8 / E.8 / G.7 / H.9 的分散条目）**、附 J（主题深度与难度曲线调研，v0.8.1 探针）、**附 K（数值完整化与经典魔塔机制，v0.9.0）**、**附 L（设置存盘与门回归经典魔塔，v0.10.0）**、**附 M（当前阶段：交互回归经典魔塔「撞一下」，v0.11.0）**。

---

## 1. 结论与定位

**核心判断：《魔塔》比《雷电》更适合手环 10，且更容易做稳。**

《雷电Lite》的三个最大工程负担——逐帧主循环、高频节点 diff、连续动画——全部来自「实时动作游戏」这个题材，不是平台强制的。魔塔是**确定性、无随机、回合制、网格**的策略 RPG：玩家滑一下走一格，触发一次结算，整表赋值刷新一次视图。它把《雷电Lite》最硬的两条约束直接绕开：

| 维度 | 雷电 Lite（实时动作） | 魔塔 Lite（回合制网格） |
| --- | --- | --- |
| 主循环 | `setInterval(tick, 66)`，15fps 常驻 | **无主循环**，事件驱动，静止时零计算零耗电 |
| 渲染触发 | 每 66ms 一次整表赋值 | 每走一步一次整表赋值（几分钟才一次） |
| 节点预算 | 同屏可动 ≤12、静态 ≤6 | 低频提交，可放宽到 ~63 格（**需真机实测**） |
| 音效 | 缺失明显，只能靠振动补 | 原作本就无音效，振动仅用于战斗/开门/通关 |
| 存档 | M3 才需要（最高分） | **M1 刚需**（多层长流程，断电必须续玩） |

可交付形态：

- **7 列 × 9 行** 单层网格（每格 28px），整层即一屏，无滚动
- 四方向 `swipe` 走一格；撞墙/开门/拾取/战斗/上下楼全部**纯数值结算**
- 3 层示例关卡、3 种怪物、10 种道具、黄/蓝/红钥匙门、魔王通关
- 单机、无联网、无音效、`@system.storage` 持久化

明确排除（沿用《雷电Lite》§1）：Cocos2d-JS / Unity / WebView / WebGL / Canvas。Vela 快应用是组件树 + JS 逻辑，不是浏览器。**可复用的是逻辑层**：固定槽位、状态机、关卡表、整表赋值刷新。

> 本文是一份实现 spec，不是已编译工程。代码分两处：`mota-lite-skeleton/` 里的纯逻辑层（可 node 直接测）与本文 §7 的 `.ux` 视图层（必须进 AIoT-IDE 才能编译）。分工理由见 §6。

---

## 2. 技术底座

沿用《雷电Lite》§2 **已核实事实**，本次未重复联网核实；只补三项与魔塔直接相关的新核实。

| 项 | 值 | 来源 |
| --- | --- | --- |
| 操作系统 | Xiaomi Vela OS（NuttX RTOS），HyperOS 精简版 | 《雷电Lite》§2 |
| 应用框架 | Vela JS 快应用，类 Vue MVVM，`.ux` 三段式 | 《雷电Lite》§2 |
| 开发工具 | AIoT-IDE（VS Code 魔改，内置模拟器） | 《雷电Lite》§2 |
| 产物 | `.rpk`（非 APK） | 《雷电Lite》§2 |
| 屏幕 | 1.725"，212×520，PPI 326，DPR 2.0，DP 宽 106，胶囊形 | 《雷电Lite》§2 |
| 内存 / 存储 | ~64 MB RAM；应用可用 ~100 MB | 《雷电Lite》§2 |
| 扬声器 / 麦克风 / GPS / WiFi | 均无 | 《雷电Lite》§2 |
| 振动 | `@system.vibrator`，`mode: 'short' \| 'long'` | 《雷电Lite》§2 |
| 传感器 | 加速度计、气压计；无陀螺仪/磁力计 | 《雷电Lite》§2 |
| 通信 | 仅 BLE，只连已配对手机 | 《雷电Lite》§2 |
| 快应用上限 | 20 个 | 《雷电Lite》§2 |
| **通用事件 `swipe`** | 1000+ 支持，`{ direction: 'left'\|'right'\|'up'\|'down' }`；**有滚动条时不触发** | 本次核实：[Vela 通用事件](https://iot.mi.com/vela/quickapp/zh/components/general/events.html) |
| **`@system.storage`** | 本地 KV 持久化，值为字符串 | 本次核实：Vela features 文档（**API 签名需 M2 真机核对**） |
| **魔塔战斗公式** | 固定数值、无随机；`回合数 = 怪物HP / (己攻 - 怪防)` | 本次核实：[百度百科·魔塔](https://baike.baidu.com/item/魔塔/861619) |

`manifest.json` 关键约定沿用《雷电Lite》§2：`deviceTypeList` 必须 `["watch"]`（**不能写 `band`**）、`designWidth: 212`、不要写 `minAPILevel`。新增 `features` 里加 `system.storage`。

---

## 3. 硬约束重估与能力映射

### 3.1 三条硬约束在回合制下的影响

| 《雷电Lite》约束 | 对射击游戏的影响 | 对魔塔的影响 |
| --- | --- | --- |
| 没有 `canvas` | 精灵只能 `div`/`image` 绝对定位，节点数即性能上限 | 地图本来就是**静态网格**，天然适配固定 `div` 槽位；不需要批量绘制 |
| 没有 `requestAnimationFrame` | 只能 `setInterval(tick,66)` ≈15fps，掉帧即手感崩 | **完全不需要主循环**。一次 `swipe` → `resolveStep()` → 一次整表赋值，静止时定时器都不必开 |
| 没有扬声器 | 命中/受伤靠振动，体验突兀 | 魔塔原作无音效；振动只在「战斗/开门/换层/阵亡/通关」触发，频率极低，反而自然 |

### 3.2 魔塔新增的三条约束

1. **胶囊屏比例**：经典魔塔是 11×11 正方形，手环是 212×520 窄长条。必须压成 7 列窄地图（推导见 §5.1），不能照搬原作版面。
2. **存档是刚需而非增强项**：多层长流程，用户可能玩几天。`@system.storage` 进 M1，且要处理固件升级/卸载清档的代价（§9）。
3. **长流程常亮**：魔塔是慢节奏思考型游戏，玩家会盯着屏幕算数值不发操作。`onShow` 的 `brightness.setKeepScreenOn` 比射击游戏更关键。

### 3.3 原作能力 → 手环实现映射

| 魔塔要素 | 手环 10 实现 | 备注 |
| --- | --- | --- |
| 11×11 网格地图 | 7×9 网格，28px/格，`div` 固定槽位 | M1 整层一屏，不滚动 |
| 方向键走一步 | `swipe` 四方向，一次触发走一格 | 见 §5.2 误触兜底 |
| 自动战斗（走到怪格触发） | `calcBattle()` 纯函数一次性结算，无动画 | 见 §4.3 |
| 回合制伤害数字 | HUD 一行文字 + 底部提示条 | M1 无战斗动画；**在线版已补战斗动画**（附 D） |
| 血瓶/宝石/剑盾/钥匙 | 字符 tile → 道具表增量 effect | 配置层，见 §6.1 |
| 黄/蓝/红门 | 扣钥匙 + 该格变更集改为地板 | 见 §6.2 |
| 多层 + 楼梯 | `FLOORS[]` + `up/down` 落点配对 | §6.1 楼梯双向校验 |
| 商店 / NPC 对话 | 文本框弹层 + 金币换攻击 | **已纳入**，在线版落地（附 D） |
| 隐藏道具 / 飞行器 / 炸弹 | 隐藏暗格 `H` / `useFly()` / `useBomb()` | **已纳入**，在线版落地（附 D） |
| 存档 / 读档 | `@system.storage` + 变更集序列化 | §6.3；在线版为 v2 格式（附 D） |

> **阶段修订（2026-11-10）**：上表原标注「不做」的三项（无战斗动画 / 不做文本框弹层 / 隐藏道具等不做）已按用户确认**全部纳入开发范围**。实现策略是「**在线版先行、手环端移植时评估性能后适配**」：战斗动画、文本框弹层属于表现层，受手环性能预算约束，移植时可能降级为简版；隐藏暗格 / 飞行器 / 炸弹属于确定性逻辑，与平台无关。完整规格、数值与移植待办见 **附 D**。

---

## 4. 玩法规格（魔塔 Lite）

### 4.1 M1 核心循环（与 `tick()` 对照）

《雷电Lite》是「每 66ms 无条件跑一遍」；魔塔是「**没有输入就什么都不跑**」：

```
onSwipe(dir):                          # 唯一驱动源
  1. state = resolveStep(state, dir)   # 纯函数：算目标格 -> 分发 -> 结算
  2. cells = buildCells(state)         # 定长 63 槽位，重算背景色/字符
  3. this.cells = cells               # 整表赋值：唯一一次渲染提交
     this.hud   = {...}               # HUD 仅在数值变化时赋值
  4. events.forEach(...)              # 振动 / 提示 / 换层 / 结束态
  5. if (关键节点) saveGame()          # 节流写盘，非每步写
```

**视图层不做任何数值计算**，只做「拿 state → 拿 cells → 赋值」。这样逻辑层能脱离 Vela 用 node 全量验证（附 B 实测 38 项断言）。

### 4.2 一次结算的分发顺序（`resolveStep`）

墙壁/越界 → 门（扣钥匙）→ 怪物（战斗）→ 道具（加属性）→ 楼梯（换层）→ 通关 `W` → NPC → 落到目标格。顺序固定，避免「门后还站着怪」这类歧义。

### 4.3 战斗公式（本方案采用的确定版本）

经典魔塔公式，不同版本有细微差异，这里把差异做成配置开关，避免「差一错误」藏进代码：

```
perHit    = hero.atk - mon.def
            <= 0 时：默认判「不可破防」禁止战斗（经典 50 层）；
                     MIN_DAMAGE_1=true 时改为强制 1 点伤害（Triglav 等版本）
rounds    = ceil(mon.hp / perHit)              击杀所需回合数
monPerHit = max(0, mon.atk - hero.def)         DEF>=ATK 时为 0，即「防杀」
hpCost    = (FIRST_STRIKE ? rounds-1 : rounds) * monPerHit
            玩家先手 -> 最后一回合怪已死，不再反击
hpCost >= hero.hp -> 判「硬拼会阵亡」，禁止战斗（不消耗资源）
胜：hero.hp -= hpCost; hero.gold += mon.gold; 该格变地板
```

| 开关 | 默认 | 作用 |
| --- | --- | --- |
| `FIRST_STRIKE` | `true` | 玩家先手，`(rounds-1)`；改 `false` 则怪打满 `rounds` 回合 |
| `MIN_DAMAGE_1` | `false` | `ATK<=DEF` 时是否允许磨 1 点伤害 |

> 关掉 `FIRST_STRIKE` 的断言已写进 `validate_tables.js`（蝙蝠损血从 8 变 12），确保差一错误不会被静默引入。

### 4.4 数值表

| 参数 | 值 | 说明 |
| --- | --- | --- |
| 网格 | 7 列 × 9 行 = 63 格 | 7×28 = 196px，212 宽左右各留 8px |
| 格子边长 | 28px | 内嵌字符 ≥14px（沿用《雷电Lite》踩坑 #6） |
| 初始属性 | HP 200 / ATK 10 / DEF 10 / GOLD 0 / 钥匙 0 | 开局打史莱姆「防杀」0 损血 |
| 史莱姆 | HP20 / ATK8 / DEF2 / 3G | 教学怪 |
| 蝙蝠 | HP35 / ATK14 / DEF5 / 6G | 拿剑前损血 24，拿剑后 8 |
| 魔王 | HP100 / ATK32 / DEF14 | 裸属性不可破防；收齐血瓶后可胜（损血 352） |
| 铁剑 / 铁盾 | ATK+10 / DEF+10 | 固定道具优先于商店，越早拿收益越高 |
| 红 / 蓝宝石 | ATK+3 / DEF+3 | |
| 小 / 大血瓶 | HP+50 / HP+200 | 1F / 2F |
| 楼层 | 3 层（1F/2F/3F） | M3 再扩到 10~20 层 |
| 振动间隔 | ≥300ms | 沿用《雷电Lite》§3.3 |

**BFS 实测**：最短 26 步可通关，通关属性 `HP96 / ATK20 / DEF13`。裸冲 3F 打不过魔王，必须先收血瓶与剑盾——这就是魔塔「路线规划」的价值，也是关卡可解性的证明。

> **注（M1 基线，勿回改）**：以上数值与「3 层」均属**已冻结的手环端 M1 基线**。上表「铁剑 / 铁盾」中的**铁盾在 M1 的 3 层地图里并未放置**（文档 / 配置不一致，盘点报告已记录），故 26 步通关实测为 `ATK20`（仅 +铁剑）/ `DEF13`（+蓝宝石）。在线版完整内容已补放铁盾及其余 7 个未使用 tile，并扩到 5 层，路线与数值见 **附 D**。

---

## 5. 屏幕与操作适配

### 5.1 212×520 胶囊屏的版面推导

```
顶部 40px 安全区（胶囊圆角，沿用《雷电Lite》踩坑 #5）
├ HUD        44px   「1F  HP200  A10 D10  Y0」
├ 网格容器   252px  9 行 × 28px，left=8px，宽 196px
├ 提示条     48px   最近一次事件文本（"胜 史莱姆 -0HP +3G"）
├ 操作提示   32px   "滑动四方向移动"
└ 底部 40px 安全区
                    合计 ≈ 456px < 520，余量留白
```

- **7 列**是 212 宽下的上限：`7×28=196`，左右各 8px；若改 8 列需 `8×24=192` 但格子缩到 24px、字体难达标，故取 7。
- **9 行**是高度余量与节点预算的折中；M3 扩图时改为视口裁剪（§5.3），不要直接堆到 15 行。
- 左右安全区 8px 是硬性的：胶囊圆角会切掉贴边元素（《雷电Lite》踩坑 #5 的横向版本）。

### 5.2 `swipe` 四方向映射与误触兜底

```js
const DIR = { left:[-1,0], right:[1,0], up:[0,-1], down:[0,1] }
onSwipe(e) {
  const d = DIR[e.direction]        // Vela 官方：{ direction: 'left'|'right'|'up'|'down' }
  if (!d) return
  ...
}
```

- 根节点 `.stage` **不能用 `scroll`/`list`**：官方明确「滑动方向有滚动条时不触发 swipe」。M1 整层一屏，本就无需滚动。
- 兜底：若真机上 `swipe` 灵敏度差（手环屏幕小、快速滑动易判成点击），在底部提示条区域加 4 个 `@click` 方向按钮，与 `swipe` 共用同一个 `step(dir)` 入口。**不要在 M1 就做**，先真机验手感（M2）。
- 长按/双击不需要；魔塔一次操作只有一个语义。

### 5.3 视口裁剪（M3，非 M1）

M1 整层 = 视口，63 个格子 div + 63 个 text 常驻节点，长度恒定、无创建销毁。M3 若扩到 15 行以上：

- `buildCells()` 改为以玩家 `(x,y)` 为中心取 7×9 窗口，**返回数组长度仍固定 63**，只换 `x/y/背景色/字符`；
- 越界部分填墙色 `#`，不新增节点；
- 这样 DOM 节点数永不变化，符合《雷电Lite》§6.4「固定槽位」原则。

> **未实测项**：63 个 div + 63 个 text 在 Vela 上一次整表 diff 的耗时，我没有真机数据，不编结论。M2 真机若卡顿，按 §8 降级顺序收窄到 5×7（35 格）或去掉 `text` 层、改纯色块 + 底部图例。

---

## 6. 数据设计：配置层优先

这是本方案与《雷电Lite》差异最大的地方，也是刻意做的架构选择：**能用配置表解决的，不写进逻辑代码**。

### 6.1 三张表 + 字符地图

| 表 | 内容 | 形态 |
| --- | --- | --- |
| `FLOORS[]` | 每层的 `rows`（等宽字符串数组）+ `up/down` 楼梯坐标 | 数组 |
| `MONSTERS[]` | `id/ch/name/hp/atk/def/gold/bg` | 数组 |
| `ITEMS[]` | `id/ch/name/effect`（对 hero 的增量） | 数组 |
| `TILE_COLOR` / `TILE_CHAR` | 字符 → 背景色 / 显示字 | 字典（只读） |

tile 字符编码：`.`地板 `#`墙 `@`出生 `Y/B/R`门 `y/b/r`钥匙 `p/P`血瓶 `a/d`宝石 `s/S`剑盾 `g`金币 `1-9`怪物 `U/D`楼梯 `W`通关 `N`NPC。

**两处刻意的设计**：

1. **一律用「数组 + id」，不用对象字面量当字典。** 对象字面量里重复 key 会被静默覆盖（`{m1: A, m1: B}` 只剩 B），改表时极难发现；数组能被 `validate_tables.js` 直接查出重复 id。查表用 `Array.find()`，表只有 3~10 项，不做缓存——与「去 `m_xxx` 缓存、直读配置」一致。
2. **「先打 Boss 才能通关」用地图配置实现，不写逻辑代码。** 3F 用墙把 `W` 三面封死，唯一入口 `(3,5)` 由魔王把守。`resolveStep` 里没有任何 Boss 特判，改关卡只改 `rows`。

### 6.2 地图状态：变更集，不是整图快照

存档里不存每层完整地图（冗余且易与 `tables.js` 版本错位），只存「被改过的格子」：

```js
opened: {                    // { [floor]: { [y*W+x]: newChar } }
  "0": { "13": ".", "45": "." }   // 已拾取的道具 / 已开的门 / 已杀的怪
}
```

`tileAt(x,y)` = 直读 `FLOORS[floor].rows[y][x]`，再叠加 `opened` 覆盖。地图只有一份真相源（静态表），运行时状态是可复现的增量。

### 6.3 存档 schema 与写盘节流

```js
{ v:1, floor, x, y, hero:{hp,atk,def,gold,keys:{y,b,r}}, opened, ended }
```

- `serialize()` 只序列化可变状态；`deserialize()` 对坏 JSON、越界楼层、版本不符一律返回 `null` → 回退到 `newGame()`，绝不让坏档炸掉启动。
- **不是每步写盘**：`@system.storage` 是同步/异步 IO，每步写会在连续走格时抖动。只在「拾取 / 开门 / 战斗 / 换层 / `onHide` / `onDestroy`」写；普通走格只更新内存态。
- `onHide` 必须写一次（抬腕息屏/切走是魔塔最常发生的中断点）。

### 6.4 离线校验脚本（改表后必跑）

`validate_tables.js` 是纯 node 脚本，不依赖 Vela，检查五类问题：

1. 重复 id / 同名 key 覆盖
2. 地图结构：等宽等高、`up/down` 坐标确实落在 `U/D` 上、楼梯双向配对、唯一出生点、无孤儿怪物字符
3. 战斗公式断言（含 `FIRST_STRIKE` 差一）、数值可达性
4. `buildCells` 定长、存档往返、坏档兜底
5. **可解性**：用 `resolveStep` 做 BFS 穷举，证明存在通关路线（本次实测展开 3428 个状态，找到 26 步解）

> 这条对应《雷电Lite》「改配置后须用 node 验证」的经验，但把它固化成了脚本而不是口头约定。改 `tables.js` 后跑 `node validate_tables.js`，38 项断言全绿才进 IDE。

---

## 7. 工程结构与完整骨架代码

```
mota-lite/
├── package.json              # AIoT-IDE 模板生成，勿手写
├── src/
│   ├── manifest.json         # 见 7.1
│   ├── app.ux                # 见 7.2
│   ├── common/
│   │   ├── logo.png          # 108×108，缺失会编译失败
│   │   ├── tables.js         # 见 7.3（配置层）
│   │   └── logic.js          # 见 7.4（纯逻辑层，可 node 测）
│   └── pages/index/index.ux  # 见 7.5（视图层，唯一碰 Vela API 的文件）
├── tools/validate_tables.js  # 见 7.6（离线校验，不进 rpk）
└── dist/                     # 构建产物 .rpk
```

**推荐做法**沿用《雷电Lite》§5：AIoT-IDE「新建工程 → Vela JS 快应用 → 手表模板」生成骨架，只替换 `src/` 下文件，不要手写 `package.json` 与构建配置。

### 7.1 src/manifest.json

```json
{
  "package": "com.yourname.motalite",
  "name": "腕上魔塔",
  "versionName": "0.1.0",
  "versionCode": 1,
  "minPlatformVersion": 1200,
  "icon": "/common/logo.png",
  "deviceTypeList": ["watch"],
  "features": [
    { "name": "system.vibrator" },
    { "name": "system.brightness" },
    { "name": "system.storage" }
  ],
  "config": {
    "logLevel": "debug",
    "designWidth": 212
  },
  "router": {
    "entry": "pages/index",
    "pages": {
      "pages/index": { "component": "index" }
    }
  }
}
```

### 7.2 src/app.ux

```vue
<script>
export default {
  onCreate() { console.log('[mota] app created') },
  onDestroy() { console.log('[mota] app destroyed') }
}
</script>
```

### 7.3 src/common/tables.js（配置层）

```js
// 一律「数组 + id」，不用对象字面量当字典（防同名 key 静默覆盖）
// 地图 = 等宽字符串数组；改配置后必须跑 node tools/validate_tables.js

export const TILE_COLOR = {
  '#': '#37474f', '.': '#1b2430', '@': '#1b2430',
  'Y': '#f9a825', 'B': '#1e88e5', 'R': '#e53935',
  'y': '#fdd835', 'b': '#42a5f5', 'r': '#ef5350',
  'p': '#ef5350', 'P': '#b71c1c', 'a': '#ff5252', 'd': '#448aff',
  's': '#cfd8dc', 'S': '#90a4ae', 'g': '#ffd54f',
  'U': '#66bb6a', 'D': '#8d6e63', 'W': '#ab47bc', 'N': '#26c6da'
}
export const TILE_CHAR = {
  'Y': '门', 'B': '门', 'R': '门', 'y': '钥', 'b': '钥', 'r': '钥',
  'p': '+', 'P': '++', 'a': '攻', 'd': '防', 's': '剑', 'S': '盾',
  'g': '金', 'U': '↑', 'D': '↓', 'W': '王', 'N': '商'
}

export const MONSTERS = [
  { id: 'm1', ch: '1', name: '史莱姆', hp: 20,  atk: 8,  def: 2,  gold: 3, bg: '#4caf50' },
  { id: 'm2', ch: '2', name: '蝙蝠',   hp: 35,  atk: 14, def: 5,  gold: 6, bg: '#7e57c2' },
  { id: 'm3', ch: '3', name: '魔王',   hp: 100, atk: 32, def: 14, gold: 0, bg: '#e53935' }
]

export const ITEMS = [
  { id: 'potion_s', ch: 'p', name: '小血瓶', effect: { hp: 50 } },
  { id: 'potion_l', ch: 'P', name: '大血瓶', effect: { hp: 200 } },
  { id: 'gem_atk',  ch: 'a', name: '红宝石', effect: { atk: 3 } },
  { id: 'gem_def',  ch: 'd', name: '蓝宝石', effect: { def: 3 } },
  { id: 'sword',    ch: 's', name: '铁剑',   effect: { atk: 10 } },
  { id: 'shield',   ch: 'S', name: '铁盾',   effect: { def: 10 } },
  { id: 'key_y',    ch: 'y', name: '黄钥匙', effect: { key: 'y', n: 1 } },
  { id: 'key_b',    ch: 'b', name: '蓝钥匙', effect: { key: 'b', n: 1 } },
  { id: 'key_r',    ch: 'r', name: '红钥匙', effect: { key: 'r', n: 1 } },
  { id: 'gold',     ch: 'g', name: '金币',   effect: { gold: 20 } }
]

export const FLOORS = [
  {
    name: '1F',
    rows: [
      '#######',
      '#p###a#',
      '#.###.#',
      '#1#s#Y#',
      '#.#..U#',
      '#.#.###',
      '#y#...#',
      '#@....#',
      '#######'
    ],
    up:   { x: 5, y: 4 },
    down: null
  },
  {
    name: '2F',
    rows: [
      '#######',
      '#D....#',
      '#.....#',
      '#..P..#',
      '#.....#',
      '#..d..#',
      '#....2#',
      '#....U#',
      '#######'
    ],
    up:   { x: 5, y: 7 },
    down: { x: 1, y: 1 }
  },
  {
    name: '3F',
    // 用墙把 W 三面封死，唯一入口 (3,5) 由魔王把守
    // ——「先打 Boss 再通关」是配置层约束，不写进逻辑代码
    rows: [
      '#######',
      '#D....#',
      '#.....#',
      '#.###.#',
      '#.#W#.#',
      '#..3..#',
      '#.....#',
      '#.....#',
      '#######'
    ],
    up:   null,
    down: { x: 1, y: 1 }
  }
]

export const HERO0 = { hp: 200, atk: 10, def: 10, gold: 0, keys: { y: 0, b: 0, r: 0 } }
export const DOOR_KEY = { 'Y': 'y', 'B': 'b', 'R': 'r' }

// 表很小，线性查找即可，不做 m_xxx 缓存
export function monsterByCh(ch) { return MONSTERS.find(m => m.ch === ch) || null }
export function itemByCh(ch)    { return ITEMS.find(i => i.ch === ch) || null }
```

### 7.4 src/common/logic.js（纯逻辑层）

**这一层不 `import` 任何 `@system.*`**，所以能被 node 直接测。视图层只负责把 state 传进来、拿 `cells` 赋值。

```js
import { FLOORS, HERO0, TILE_COLOR, TILE_CHAR, DOOR_KEY, monsterByCh, itemByCh } from './tables.js'

export const CONFIG = {
  FIRST_STRIKE: true,   // 玩家先手：最后一回合怪已死 -> (rounds-1)
  MIN_DAMAGE_1: false,  // 经典 50 层：ATK<=DEF 判不可破防
  CELL: 28,
  SAFE_LR: 8,
  VIBRATE_GAP: 300
}
const DIR = { left:[-1,0], right:[1,0], up:[0,-1], down:[0,1] }

export function newGame() {
  let sx = 1, sy = 1
  FLOORS[0].rows.forEach((row, y) => {
    const x = row.indexOf('@'); if (x >= 0) { sx = x; sy = y }
  })
  return {
    floor: 0, x: sx, y: sy,
    hero: JSON.parse(JSON.stringify(HERO0)),
    opened: {},          // 变更集，不存整图快照
    ended: null          // null | 'dead' | 'win'
  }
}
function clone(s)       { return JSON.parse(JSON.stringify(s)) }
function width(floor)   { return FLOORS[floor].rows[0].length }
function height(floor)  { return FLOORS[floor].rows.length }

export function tileAt(s, x, y) {
  const rows = FLOORS[s.floor].rows
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return '#'
  const ov = s.opened[s.floor] && s.opened[s.floor][y * width(s.floor) + x]
  return ov !== undefined ? ov : rows[y][x]      // 直读静态表 + 叠加变更集
}
function setTile(s, x, y, ch) {
  if (!s.opened[s.floor]) s.opened[s.floor] = {}
  s.opened[s.floor][y * width(s.floor) + x] = ch
}

// ---- 战斗：确定性、无随机 ----
export function calcBattle(hero, mon) {
  let perHit = hero.atk - mon.def
  if (perHit <= 0) {
    if (!CONFIG.MIN_DAMAGE_1)
      return { ok:false, reason:'unbreakable', rounds:0, hpCost:0, perHit, monPerHit:0 }
    perHit = 1
  }
  const rounds = Math.ceil(mon.hp / perHit)
  const monPerHit = Math.max(0, mon.atk - hero.def)      // DEF>=ATK -> 防杀
  const hpCost = (CONFIG.FIRST_STRIKE ? rounds - 1 : rounds) * monPerHit
  if (hpCost >= hero.hp) return { ok:false, reason:'lethal', rounds, hpCost, perHit, monPerHit }
  return { ok:true, reason:'', rounds, hpCost, perHit, monPerHit }
}
function applyEffect(hero, eff) {
  if (eff.hp) hero.hp += eff.hp
  if (eff.atk) hero.atk += eff.atk
  if (eff.def) hero.def += eff.def
  if (eff.gold) hero.gold += eff.gold
  if (eff.key) hero.keys[eff.key] += eff.n
}

// ---- 一次输入 = 一次结算 = 一次视图提交 ----
export function resolveStep(prev, direction) {
  const s = clone(prev), ev = []
  if (s.ended) return { state:s, events:ev }
  const d = DIR[direction]; if (!d) return { state:s, events:ev }
  const nx = s.x + d[0], ny = s.y + d[1], t = tileAt(s, nx, ny)

  if (t === '#') { ev.push({ t:'msg', text:'前方是墙' }); return { state:s, events:ev } }

  const needKey = DOOR_KEY[t]
  if (needKey) {
    if (s.hero.keys[needKey] <= 0) { ev.push({ t:'msg', text:'缺少钥匙' }); return { state:s, events:ev } }
    s.hero.keys[needKey] -= 1; setTile(s, nx, ny, '.')
    ev.push({ t:'vibrate' }, { t:'msg', text:'门已打开' })
  }

  const mon = monsterByCh(t)
  if (mon) {
    const r = calcBattle(s.hero, mon)
    if (!r.ok) {
      const text = r.reason === 'unbreakable' ? '攻击不足，无法破防'
                 : '硬拼会阵亡（需 ' + (r.hpCost + 1) + ' HP）'
      ev.push({ t:'msg', text }, { t:'vibrate' }); return { state:s, events:ev }
    }
    s.hero.hp -= r.hpCost; s.hero.gold += mon.gold; setTile(s, nx, ny, '.')
    ev.push({ t:'vibrate' }, { t:'msg', text:'胜 ' + mon.name + ' -' + r.hpCost + 'HP +' + mon.gold + 'G' })
  }

  const item = itemByCh(t)
  if (item) { applyEffect(s.hero, item.effect); setTile(s, nx, ny, '.'); ev.push({ t:'msg', text:'获得 ' + item.name }) }

  if (t === 'U' || t === 'D') {
    const nf = t === 'U' ? s.floor + 1 : s.floor - 1
    const target = FLOORS[nf]
    if (!target) { ev.push({ t:'msg', text:'没有更多楼层' }); return { state:s, events:ev } }
    const landing = t === 'U' ? target.down : target.up
    s.floor = nf; s.x = landing ? landing.x : 1; s.y = landing ? landing.y : 1
    ev.push({ t:'floor' }, { t:'vibrate' }, { t:'msg', text:'进入 ' + target.name })
    return { state:s, events:ev }
  }

  if (t === 'W') {
    s.x = nx; s.y = ny; s.ended = 'win'
    ev.push({ t:'win' }, { t:'vibrate' }); return { state:s, events:ev }
  }
  if (t === 'N') ev.push({ t:'msg', text:'商人：M3 开放' })

  s.x = nx; s.y = ny
  if (s.hero.hp <= 0) { s.ended = 'dead'; ev.push({ t:'dead' }, { t:'vibrate' }) }
  return { state:s, events:ev }
}

// ---- 定长 cells：节点数恒定，靠整表赋值触发 diff ----
export function buildCells(s) {
  const W = width(s.floor), H = height(s.floor), C = CONFIG.CELL
  const out = new Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = tileAt(s, x, y), mon = monsterByCh(ch)
    const glyph = mon ? mon.ch : (TILE_CHAR[ch] || '')
    out[y * W + x] = {
      x: x * C, y: y * C,
      bg: mon ? mon.bg : (TILE_COLOR[ch] || TILE_COLOR['.']),
      ch: glyph, fg: '#ffffff', hasCh: !!glyph,
      isHero: x === s.x && y === s.y
    }
  }
  return out
}

export function serialize(s) {
  return JSON.stringify({ v:1, floor:s.floor, x:s.x, y:s.y, hero:s.hero, opened:s.opened, ended:s.ended })
}
export function deserialize(text) {
  try {
    const o = JSON.parse(text)
    if (!o || o.v !== 1 || !o.hero || !FLOORS[o.floor]) return null
    return o
  } catch (e) { return null }
}
```

### 7.5 src/pages/index/index.ux（视图层）

> M1 全部用 `div` + 背景色 + 单字符，不依赖图片资源，换机器后无需美术即可跑通。后续把格子换成 `image` + PNG8 即可。

```vue
<template>
  <div class="stage" @swipe="onSwipe">
    <text class="hud">{{ hud }}</text>

    <div class="grid">
      <block for="c in cells">
        <div class="cell" style="left: {{c.x}}px; top: {{c.y}}px; background-color: {{c.bg}};">
          <text if="{{c.hasCh}}" class="cell-ch">{{c.ch}}</text>
        </div>
      </block>
      <!-- 玩家高亮写在格子之后：Vela 无 z-index，靠 DOM 顺序决定层级 -->
      <div class="hero" style="left: {{heroX}}px; top: {{heroY}}px;"></div>
    </div>

    <text class="tip">{{ tip }}</text>
    <text class="legend">滑动四方向移动</text>

    <!-- 结束遮罩必须写在最后 -->
    <div class="over" if="{{ended}}">
      <text class="over-title">{{ endTitle }}</text>
      <text class="over-sub">{{ endSub }}</text>
      <div class="btn" @click="restart"><text class="btn-text">重新开始</text></div>
    </div>
  </div>
</template>

<script>
import brightness from '@system.brightness'
import vibrator   from '@system.vibrator'
import storage    from '@system.storage'
import { CONFIG, newGame, resolveStep, buildCells, serialize, deserialize } from '../../common/logic.js'
import { FLOORS } from '../../common/tables.js'

const SAVE_KEY = 'mota_lite_save_v1'

export default {
  data: {
    cells: [], hud: '', tip: '滑动开始爬塔',
    heroX: 0, heroY: 0,
    ended: false, endTitle: '', endSub: ''
  },

  onInit() {
    this.state = null
    this.lastVib = 0
  },

  onShow() {
    // 魔塔是盯着数值思考的慢节奏游戏，不息屏是硬要求
    brightness.setKeepScreenOn({
      keepScreenOn: true,
      fail: (e) => console.log('[mota] keepScreenOn fail: ' + JSON.stringify(e))
    })
    // 读档（API 签名以 Vela 官方为准，M2 真机核对）
    storage.get({
      key: SAVE_KEY,
      success: (data) => {
        const s = deserialize(data)
        this.state = s || newGame()
        this.render(true)
      },
      fail: () => { this.state = newGame(); this.render(true) }
    })
  },

  onHide()    { this.save() },
  onDestroy() { this.save() },

  // ---------- 唯一输入入口 ----------
  onSwipe(e) {
    if (this.ended || !this.state) return
    this.step(e.direction)
  },

  step(dir) {
    const r = resolveStep(this.state, dir)
    this.state = r.state
    this.handleEvents(r.events)
    this.render(r.events.length > 0)
  },

  handleEvents(events) {
    let dirty = false
    let lastMsg = ''
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (ev.t === 'msg') lastMsg = ev.text
      if (ev.t === 'vibrate') this.vibrate()
      if (ev.t === 'floor' || ev.t === 'win' || ev.t === 'dead') dirty = true
      if (ev.t === 'win')  { this.ended = true; this.endTitle = '通关'; this.endSub = '魔王已被击败' }
      if (ev.t === 'dead') { this.ended = true; this.endTitle = '阵亡'; this.endSub = '重新开始' }
    }
    if (lastMsg) this.tip = lastMsg        // 只在有文本时赋值
    if (dirty) this.save()                 // 节流：关键节点才写盘
  },

  vibrate() {
    const now = Date.now()
    if (now - this.lastVib < CONFIG.VIBRATE_GAP) return
    this.lastVib = now
    vibrator.vibrate({ mode: 'short', fail: () => {} })
  },

  save() {
    if (!this.state) return
    storage.set({ key: SAVE_KEY, value: serialize(this.state), fail: () => {} })
  },

  // ---------- 唯一渲染提交 ----------
  render() {
    const s = this.state
    this.cells = buildCells(s)             // 整表赋值：Vela 监听不到数组元素内部属性变更
    this.heroX = s.x * CONFIG.CELL
    this.heroY = s.y * CONFIG.CELL
    const h = s.hero
    this.hud = FLOORS[s.floor].name + '  HP' + h.hp + '  A' + h.atk + ' D' + h.def + '  Y' + h.keys.y
  },

  restart() {
    storage.set({ key: SAVE_KEY, value: '', fail: () => {} })
    this.state = newGame()
    this.ended = false
    this.tip = '滑动开始爬塔'
    this.render()
  }
}
</script>

<style>
.stage {
  position: relative;
  width: 212px;
  height: 520px;
  background-color: #0b1017;
}
.hud {
  position: absolute;
  left: 8px; top: 40px;
  width: 196px;
  font-size: 14px;
  color: #90a4ae;
  text-align: center;
}
.grid {
  position: absolute;
  left: 8px; top: 88px;      /* 40 安全区 + 44 HUD + 4 间距 */
  width: 196px; height: 252px;
}
.cell {
  position: absolute;
  width: 28px; height: 28px;
  border: 1px solid #0b1017;
  justify-content: center;
  align-items: center;
}
.cell-ch { font-size: 14px; color: #ffffff; }
.hero {
  position: absolute;
  width: 28px; height: 28px;
  border: 2px solid #ffeb3b;   /* 描边而非填充，不遮住格子内容 */
}
.tip {
  position: absolute;
  left: 8px; top: 348px;
  width: 196px; height: 48px;
  font-size: 14px;
  color: #ffd54f;
  text-align: center;
}
.legend {
  position: absolute;
  left: 8px; top: 404px;
  width: 196px;
  font-size: 14px;
  color: #546e7a;
  text-align: center;
}
.over {
  position: absolute;
  left: 0; top: 0;
  width: 212px; height: 520px;
  background-color: rgba(0, 0, 0, 0.88);
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.over-title { font-size: 22px; color: #ffd54f; }
.over-sub   { margin-top: 8px; font-size: 14px; color: #ffffff; }
.btn {
  margin-top: 24px;
  width: 112px; height: 40px;
  background-color: #263238;
  border-radius: 20px;
  justify-content: center;
  align-items: center;
}
.btn-text { font-size: 15px; color: #4dd0e1; }
</style>
```

### 7.6 关键实现说明（四条，对应《雷电Lite》§6.4）

1. **固定 63 槽位，不是 `for` 渲染变长数组**：节点创建/销毁在 Vela 上最贵。`buildCells()` 恒定返回 63 项，靠 `if="{{c.hasCh}}"` 控制字符显隐（该 `text` 节点常驻，不销毁），生命周期内节点数不变。
2. **每步只做一次整表赋值**：`this.cells = buildCells(s)` 是唯一的渲染提交。Vela 监听不到 `this.cells[0].bg = ...` 这类内部修改，必须整体赋新数组触发 diff；中途不要多次赋值。
3. **没有 `z-index`，层级靠 DOM 顺序**：`.hero` 写在 `.grid` 内所有格子之后，`.over` 写在 `.stage` 最后。不用 `position: fixed`（相对滚动视口不可控），根节点 `relative` + 子元素 `absolute`。
4. **逻辑层零平台依赖**：`tables.js`/`logic.js` 只 `import` 彼此，视图层是唯一碰 `@system.*` 的文件。这是「能在 PC 上用 node 验证再进 IDE」的前提，也是本方案与《雷电Lite》最实质的差别。

> **编译报错优先怀疑三处**（沿用《雷电Lite》附）：`block` 标签的 `for` 用法、`style` 内联绑定 `{{ }}` 的 px 单位、`data` 里数组初始化的时机。新增第四处：`common/logic.js` 的相对路径 `../../common/` —— Vela 打包对 `src/common` 的路径解析与真机不一致时，把 `tables.js`/`logic.js` 直接内联进 `index.ux` 即可（牺牲可测性，仅作兜底）。

### 7.7 tools/validate_tables.js（离线校验，不进 rpk）

检查项与实测输出见 **附 B**；完整脚本见配套骨架 `mota-lite-skeleton/validate_tables.js`。核心是五类断言：重复 id、地图结构/楼梯配对、战斗公式（含差一）、定长 cells/存档往返、**BFS 可解性**。用法：

```bash
node tools/validate_tables.js     # 改完 tables.js 必跑，全绿才进 IDE
```

---

## 8. 性能预算与调优

| 指标 | 目标 | 与《雷电Lite》§7 的差异 |
| --- | --- | --- |
| 主循环 | **无常驻定时器** | 雷电 66ms/15fps；魔塔静止时零计算 |
| 静止功耗 | 仅保持常亮 | 需 `setKeepScreenOn`，但无 tick 唤醒 |
| 常驻节点 | 63 `div` + 63 `text` + HUD/提示/图例/玩家 ≈130 | 雷电 ≤18；因低频提交可放宽，**未真机实测** |
| 每次操作赋值次数 | 1（`cells`）+ 2~3（HUD/tip/hero 坐标） | 雷电每帧 2 次 ×15fps = 30 次/秒；魔塔 ≈0.3 次/秒 |
| 单步 JS 计算 | <5ms（`resolveStep` + `buildCells` 纯算术） | 雷电 <10ms/帧 |
| 冷启动首屏 | <2s（FMP ≤2000ms，官方发布强制要求） | 沿用 |
| 存档大小 | <2KB（变更集，不是整图） | 新增 |

调优顺序（按收益排序）：

1. **收窄视口**：63 格 diff 若真机卡顿，先降到 5×7=35 格（`CONFIG` + 地图同步改），不要急着换渲染方案。
2. **去掉 `text` 层**：格子改纯色块 + 底部图例，节点数直接减半。
3. **静态节点标 `static`**：HUD/图例 `<text class="legend" static>`，跳过 diff。
4. **HUD 不要每步改**：只在数值变化时赋值（当前 `render()` 每步都赋，可加脏标记优化，但低频下收益极小，列为可选）。
5. **`left/top` → `transform: translate()`**：减少重排，需实测 Vela 对 translate 的 px 支持。
6. **手动 GC**：`onDestroy` 里 `global.runGC()`；`resolveStep` 每步 `clone` 一次 state，是唯一的对象分配来源，量很小，不要为此引入可变原地修改（会破坏可测性）。

---

## 9. 真机安装与存档代价

**流程完全沿用《雷电Lite》§8 AuthKey 四步**，不重复展开：安卓手机 + 小米运动健康生成迁移日志 → 米坛「表盘自定义工具」v6.5+ 读 64 位 AuthKey → 验证配对 → 蓝牙一键安装 `dist/com.yourname.motalite.rpk`。蓝牙 ADB 仅用于真机看手感，正式安装仍走 AuthKey。

魔塔特有的三条代价：

1. **固件升级会清空所有第三方快应用，存档一并丢失**（沿用《雷电Lite》§8.6，但魔塔损失的是几十分钟进度，不是一局分数）。调试期建议加一个「把 `serialize(state)` 打到 console」的调试开关，便于人工备份。
2. **连 iPhone 时第三方应用被隐藏**，切回安卓重连恢复；长流程游戏中断感知更强，M2 要验证「切走再回来」读档正确。
3. **`@system.storage` 的 `get/set` 回调签名需 M2 真机核对**；模拟器与真机不一致时以真机为准。读档失败一律回退 `newGame()`，不要让坏档卡死冷启动（影响 FMP）。

AuthKey 等同设备配对密码，不要外传；快应用 20 个上限，装不上先卸载几个（沿用《雷电Lite》§8.4）。

---

## 10. 踩坑清单

前 12 条沿用《雷电Lite》§9（已核实），后 8 条为魔塔新增。

| # | 坑 | 解法 | 来源 |
| --- | --- | --- | --- |
| 1 | 5 秒息屏 | `onShow` 里 `brightness.setKeepScreenOn` | 沿用 |
| 2 | 抬腕/息屏回来定时器堆叠 | `onHide`/`onDestroy` 清定时器；**魔塔无常驻定时器，但读档回调可能重复触发，需幂等** | 沿用 |
| 3 | 数据改了视图不动 | 数组整体赋值，不改元素属性 | 沿用 |
| 4 | 层级错乱 | 没有 `z-index`，靠 DOM 顺序 | 沿用 |
| 5 | 元素溢出到圆角外 | 顶部 40px、底部 40px、**左右各 8px** 留安全区 | 沿用+横向版 |
| 6 | 字体太小 | 212 宽下正文 ≥14px | 沿用 |
| 7 | 模拟器不渲染非方形纹理 | 手环10 模拟器可能失败，先用方形模拟器验逻辑 | 沿用 |
| 8 | 模拟器没选中导致调试无反应 | 调试按钮旁 `[+]` 下拉勾选模拟器 | 沿用 |
| 9 | 内存涨 | `global.runGC()`；避免每帧 new 对象 | 沿用 |
| 10 | 振动过频 | 间隔 ≥300ms，只在关键事件振 | 沿用 |
| 11 | 缺 `logo.png` 编译失败 | `src/common/logo.png` 108×108 | 沿用 |
| 12 | `deviceTypeList` 写 `band` | 手环10 必须写 `watch` | 沿用 |
| 13 | **`swipe` 完全不触发** | 根节点用了 `scroll`/`list`；官方明确「滑动方向有滚动条时不触发」 | 新增 |
| 14 | **每步写盘导致走格抖动** | 只在关键节点 + `onHide` 写 `storage`，普通走格只改内存态 | 新增 |
| 15 | **同名 key 覆盖改坏了怪物表** | 配置表用「数组 + id」，跑 `validate_tables.js` 查重复 | 新增 |
| 16 | **战斗「差一」错误** | `(rounds-1)` vs `rounds` 做成 `FIRST_STRIKE` 开关 + 断言 | 新增 |
| 17 | **除零 / 负数伤害** | `perHit<=0` 先判 `unbreakable`，再 `Math.ceil` | 新增 |
| 18 | **换层落点越界或落在墙里** | `FLOORS[].up/down` 坐标由校验脚本断言确实落在 `U/D` 上，且楼梯双向配对 | 新增 |
| 19 | **关卡是死局（打不过魔王）** | BFS 穷举可解性；裸冲 3F 会判 `unbreakable`，必须收血瓶与剑盾 | 新增 |
| 20 | **63 格整表 diff 卡顿** | 先收窄视口到 5×7，再去 `text` 层；**需真机实测，无现成数据** | 新增 |

---

## 11. 里程碑与验收标准

> 沿用《雷电Lite》「先低风险验证、再高风险确认方案」的分阶段节奏。M1 只做能跑通的最小闭环，内容扩展一律推到 M3。

> **阶段调整（2026-11-10）**：用户确认**先在在线版体验完整内容，真机移植暂缓**。因此 **M1 已交付并冻结**、**M2 全部暂缓**（不编译 `.rpk` / 不进模拟器 / 不上真机），新增「**M0′ · 在线版完整内容阶段**」作为当前唯一在演进的主线：
> `mota-lite-web/` v0.4.0 —— 5 层关卡、隐藏暗格 / 飞行器 / 炸弹 / 商店、像素精灵与战斗动画、文本框剧情、8-bit 音效、全部文本资源；逻辑层独立演进（分叉），存档 v2 兼容 v1。详见 **附 D**。
>
> 下面 M1~M3 的排期保留，作为未来真机移植时的执行清单；M3 的内容项已在在线版先行验证。

### M1 · 模拟器跑通（0.5~1 天）

- AIoT-IDE 新建工程，替换 `manifest.json` / `app.ux` / `index.ux`，放入 `tables.js`、`logic.js`、`logo.png`
- 先在 **PC 上跑 `node tools/validate_tables.js`**，38 项断言全绿（附 B），再进 IDE
- 模拟器选 `xiaomi10Band`（若非方形纹理失败则先用方形模拟器验逻辑），Build → Run
- 四方向 `swipe` 各走一格、边界/墙壁不越界
- 拾取道具后 HUD 数值更新、该格变地板
- 战斗结算正确（史莱姆防杀 0 损血、魔王裸属性判不可破防）
- 黄门：无钥匙拦住 / 有钥匙扣 1 并开门
- 上下楼换层落点正确、通关弹结束页、RETRY 可重开

### M2 · 真机验证（0.5~1 天）〔当前暂缓〕

- AuthKey 打通，`.rpk` 装上
- 全程不息屏；**切走再回来读档正确**（魔塔长流程的关键项）
- `@system.storage` 的 `get/set` 回调签名按真机核对修正
- 63 格整表 diff 实测不卡；若卡按 §8 降级
- `swipe` 灵敏度实测：若误触多，加底部 4 个 `@click` 方向按钮（共用 `step(dir)`）
- 战斗/开门/通关有振动且不连振

### M3 · 内容打磨（3~5 天）〔在线版已收尾并继续演进，见附 E / 附 F〕

> **状态（2026-11-11）**：下列 5 项已在在线版 `mota-lite-web/` v0.5.0 完成（手环端移植仍暂缓）；
> v0.6.0 又按浏览器体验反馈把楼层从 10 层扩到 **21 层**（对齐原版魔塔），并重构输入为点击格子移动，详见附 F。
>
> **【结论作废】附 E.2 的「视口裁剪不做」在 v0.8.0 作废。** 当时地图是 7×9 = 63 格、恰好一屏，裁剪确实没有意义；
> v0.8 按用户要求把每层扩到 **13×15 = 195 格**（「不要求一屏显示完」），单层已远超一屏，视口裁剪 + 相机跟随成为**必需**，
> §5.3 的设计在此真正落地：195 个固定槽位全量渲染，`.viewport` 裁出 7×9，`.grid` / `.fx-layer` 按 state.x/y 做 `translate()`。详见附 H。

- 楼层扩到 **21 层**（v0.5 为 10 层，v0.6 再补 11 层；视口裁剪 v0.8 已落地，见附 H，~~附 E.2「不做」的结论作废~~）
- 商店/NPC、蓝红钥匙门、骷髅兵/暗法师等特殊怪 —— v0.4 已落地
- 像素图替换色块（32 帧精灵表 + 可一键切回色块，图例保留）—— v0.4 已落地
- 最高层/最少步数记录持久化 —— **v0.5 落地**（`records.js`，独立 localStorage key）
- 关卡表外置 + 导表脚本 —— **v0.5 落地**：编辑源 `levels/levels.json`，`tools/build_tables.py` 生成 `tables.js`；
  未接 Excel（用户现有 `Tools\ExcelToTableData` 是另一套工程，此处改用 JSON 作中间格式以便 diff / node 校验，理由见附 E.3）
- 点击格子移动 / 道具与设置按钮 / HUD 分段彩色 / 1F 残留单位修复 —— **v0.6 落地**，见附 F

### 验收红线

- 静止时无常驻定时器、无掉帧；一步操作在 1 帧内完成刷新
- 冷启动首屏 < 2s（FMP ≤2000ms，官方发布强制要求）
- 连续玩 10 分钟不发热降频、内存不涨
- **每个楼层都存在通关路线**（`validate_tables.js` BFS 全绿）
- 坏档 / 切走重进 / 通关重开三条路径不崩

> **在线版验收口径（附 F）**：21 层 flood fill 可达性 + 策略式攻略**逐步 `resolveStep` 重放通关**（**462 步**）。不再用穷举 BFS —— 多层内容下属性与 `opened` 变更集组合指数增长，实测展开 40 万状态仍未收敛，故改用「单层 BFS 寻路 + 贪心清场」的策略式求解器；这是搜索策略不适用，不是死局。

---

## 12. 参考资料

沿用《雷电Lite》§11，并补三项：

| 资源 | 地址 | 用途 |
| --- | --- | --- |
| Vela 快应用官方文档 | https://iot.mi.com/vela/quickapp/zh/ | 组件/API 总入口 |
| AIoT-IDE 下载 | https://iot.mi.com/vela/quickapp/zh/guide/start/use-ide.html | 工程与模拟器 |
| 多屏适配（屏幕参数表） | https://iot.mi.com/vela/quickapp/zh/guide/multi-screens | 212×520 参数 |
| 真机安装 FAQ | https://iot.mi.com/vela/quickapp/zh/guide/other/faq.html | AuthKey / rpk |
| **Vela 通用事件（swipe）** | https://iot.mi.com/vela/quickapp/zh/components/general/events.html | 四方向输入 + 滚动条限制 |
| **百度百科·魔塔** | https://baike.baidu.com/item/魔塔/861619 | 战斗公式、无随机/资源不可再生特性 |
| 基于 AIoT-IDE 的 VelaJS 游戏开发快速入门 | https://www.cnblogs.com/HPC2H2/p/19504076 | 工程结构与血泪经验 |
| 官方示例（wearable 目录） | https://github.com/open-vela/packages_apps | 组件用法参考 |
| HyperTetris（开源手环游戏） | https://github.com/AetherZeng1145/HyperTetris | `div` 网格渲染参考 |
| 手环10 开发技能文档 | https://github.com/paraflu/hermes-skill-xiaomi-miband10-vela-js | AI 上下文 |
| 米坛社区 | https://www.bandbbs.cn | 表盘自定义工具 / AuthKey |

---

## 附 A：下次开工第一件事

```bash
# 1. 先在 PC 上验全部离线断言（不需要 IDE、不需要手环）
cd mota-lite && npm run check
#    期待：配置/逻辑层 47 项 + 视图层 65 项全绿，BFS 找到 26 步通关路线

# 2. 用 AIoT-IDE 打开 mota-lite/（或新建「Vela JS 快应用 / 手表」工程后覆盖 src/）
# 3. 确认 src/common/logo.png 是 108×108（工程里已生成）
# 4. Build → Build RPK，先跑模拟器（非方形纹理失败则换方形模拟器验逻辑）
# 5. 真机手感验证再走 AuthKey
```

> 工程内 `src/manifest.json` / `src/app.ux` / `src/common/*.js` / `src/pages/index/index.ux` 已按本文 §7 落地并修正，见附 C。
>
> **当前阶段提示**：真机暂缓，上面第 2~5 步（IDE / RPK / 模拟器 / AuthKey）**暂不执行**。当前在演进的是在线版 `mota-lite-web/`，其目录结构、改动纪律与校验命令见 **附 D**。

**改动纪律**：调数值只改 `tables.js`；改规则先改 `logic.js` 的 `CONFIG` 开关；两处改完都重跑校验脚本。**不要在 `index.ux` 里写数值判断**——视图层一旦掺入规则，node 侧就无法验证，这套分层就失效了。

---

## 附 B：离线校验实测结果

在 PC（node 22，无 Vela 依赖）上实跑 `node validate_tables.js` 的输出：

```
[1] 重复 id / 同名 key 覆盖检查
  ✓ MONSTERS 无重复 id = 3
  ✓ ITEMS 无重复 id = 10
  ✓ FLOORS.name 无重复 id = 3
  ✓ 怪物/道具表为数组（非对象字典）

[2] 地图结构检查
  ✓ 第 1 层尺寸 7x9（7*28=196 ≤ 212 宽） = [7,9]
  ✓ 1F / 2F / 3F 等宽等高（保证 cells 定长）
  ✓ 1F / 2F / 3F 无不合法字符 / 孤儿怪物 = []
  ✓ 1F.up 落在 U、2F.up 落在 U、2F.down / 3F.down 落在 D
  ✓ 首层无 D、末层无 U
  ✓ 1F.U -> 2F.D、2F.U -> 3F.D、2F.D -> 1F.U、3F.D -> 2F.U 全部配对
  ✓ 全表恰好 1 个出生点 @ = 1

[3] 战斗公式断言（确定性、无随机）
  ✓ 开局打史莱姆：防杀 0 损血 = [true,8,3,0]
  ✓ 拿剑后打蝙蝠：损血 8 = [15,3,8]
  ✓ 裸属性打魔王：ATK<=DEF 不可破防 = "unbreakable"
  ✓ 收齐血瓶后打魔王：可胜，损血 352 = [true,6,17,352]
  ✓ 关闭玩家先手 -> rounds*monPerHit = 12   （差一错误有断言兜底）

[4] 逻辑层：定长 cells / 存档往返 / 变更集
  ✓ buildCells 定长 63 槽位、玩家高亮恰好 1 格
  ✓ serialize -> deserialize 往返可用、坏存档返回 null

[5] 可解性：BFS 搜索一条真实通关路线
  ✓ 存在通关路线（BFS 展开 3428 个状态）
    最短步数 = 26，通关属性 = {"hp":96,"atk":20,"def":13,"gold":0}
  ✓ 通关时 HP > 0
  ✓ 必须拾取成长道具才能通关

全部 47 项断言通过（M1 工程版：原 38 项 + 存档上限 / 事件协议 9 项）。视图层另有 65 项契约断言，见附 C。
```

**尚未实测、不编结论的三项**：① 63 格 `div`+`text` 整表 diff 的真机耗时；② `@system.storage` 的 `get/set` 真机回调签名；③ `swipe` 在 212 宽胶囊屏上的识别灵敏度。三项全部留到 M2 真机验证，失败路径已写在 §5.2 / §8 / §9。

---

## 附 C：M1 工程落地状态（2026-11-10）

**完整工程**：`mota-lite/`，可用 AIoT-IDE 直接打开；`npm run check` 跑全部离线校验。本文 §7 的代码块是设计稿，实际实现以工程内文件为准。开发阶段验证后修正了 5 处：

| # | 设计稿问题 | 工程实现 | 理由 |
| --- | --- | --- | --- |
| 1 | §6.3 用 JSON 存档 | `serialize()` 改紧凑串 `1\|f,x,y,...\|fi.i.i`，最坏 68B | 轻量穿戴 `@system.storage.set` 的 value 需 <128B，JSON 存档会超。快应用官方未写上限，OpenHarmony Lite / 华为文档明确 128B，Vela 未查到明文 → 按最严实现，不赌 Vela 宽松 |
| 2 | §7.5 写盘只判 `floor/win/dead` 事件 | `resolveStep` 统一发 `{ t:'save' }`，视图层只做 IO | 原实现拾取 / 开门 / 战斗都不写盘，与「关键节点写盘」约定矛盾；把"哪些是关键节点"留在逻辑层才能用 node 验证 |
| 3 | §7.5 结束遮罩由 `win/dead` 事件驱动 | `render()` 读 `state.ended` | 读档到「已通关」存档时遮罩会丢失。UI 态必须挂在 state 上，不能挂在一次性事件上 |
| 4 | §7.5 `onShow` 每次读档 | 加 `booted` 幂等守卫 | 抬腕 / 切走回来重复触发 `onShow` 会重建 `newGame()`，直接丢进度（踩坑 #2） |
| 5 | §7.5 `restart` 写空串清档 | 立刻写入 `newGame()` 新档 | 「重开后马上切走」会读回旧存档。另外 `render(true)` 与无参定义不一致、HUD 每步赋值，一并改为脏标记 |

顺带去掉了 `<text static>`：该指令在参考骨架里只是优化建议、未经真机验证，M1 以编译通过优先。

**离线校验**（PC 上跑，不需要 IDE / 真机）：

| 脚本 | 断言 | 覆盖 |
| --- | --- | --- |
| `node tools/validate_tables.js` | 47 项 | 重复 id、地图 / 楼梯配对、战斗公式含 `FIRST_STRIKE` 差一、定长 cells、紧凑存档往返与 128B 上限、事件协议、BFS 可解性（3428 状态 / 26 步） |
| `node tools/validate_view.js` | 65 项 | 抽取 `index.ux` 真实 `<script>` 段注入 mock `@system.*`，覆盖冷启动、普通走格不写盘、拾取写盘、`onShow` 幂等、读档 / 坏档、26 步通关、读档到已通关存档、重开、振动节流 |

合计 **112 项断言全绿**。视图层校验验的是工程里真实的 `index.ux`，不是复制品。

**工程结构差异**（相对 §7）：新增 `tools/solver.js`（BFS 复用）、`tools/validate_view.js`、`src/common/logo.png`（108×108 已生成）；根 `package.json` 带 `type: module`，仅为让 `tools/` 能 import `src/common` 的 ESM —— 若用 IDE 新建工程覆盖了本文件，需补回该字段。

**M2 仍需真机确认**：63 格整表 diff 耗时、`@system.storage` 在 Vela 真机的回调签名与 128B 限制是否真的存在、`swipe` 灵敏度。以上均未在 PC 上编结论。


---

## 附 D：在线版完整内容阶段（v0.4.0，2026-11-10）

> 本附录记录**当前唯一在演进的主线**：在线试玩版 `/workspace/mota-lite-web/`。
> 手环端 M1 工程 `/workspace/mota-lite/` 已冻结（真机暂缓），本文 §4/§6/§7/§11 的 M1 基线数值不回改。
> 「换机器后照此继续实现」时：**先读本附录**，再按 §12 参考资料补背景。

### D.1 阶段决策：逻辑层分叉（重要）

用户确认「先在在线版体验完整，再考虑移植真机」。加内容必然要改 `logic.js` / `tables.js`（隐藏道具 / 飞行器 / 炸弹是逻辑机制；战斗动画 / 文本框 / 图像 / 声音是纯表现层），而表现层里的战斗动画、文本框弹层受手环性能预算约束、M1 阶段本就做不了。据此定：

| 项 | 决策 |
| --- | --- |
| 手环端 `mota-lite/` | **整个目录冻结**。不编译 `.rpk`、不进模拟器、不上真机；M2 全部暂缓 |
| 在线版 `mota-lite-web/` | 逻辑层 / 配置表**独立演进为完整内容版**，`logic.js` / `tables.js` / `solver.js` 是它自己的**单一真源**（仍只有一份，没有第二套数值实现） |
| 与 M1 的字节一致 | **不再保持**。原 v0.1~v0.3 的「同源 diff 断言」已移除，改为「在线版自身完整性校验」 |
| 未来真机移植 | 以在线版为准**重新对齐** M1 工程，恢复字节一致；表现层按手环性能评估后降级（见 D.8） |

为什么不硬保字节一致：那需要同步升级 M1 工程并重跑其 112 项断言，属于「真机移植准备工作」，与用户「真机暂缓」的意图冲突；而悄悄在宿主层复制一套规则才是真正的技术债。分叉是**受控、可追溯**的：在线版 `tools/validate_logic.mjs` 校验自己的逻辑层，附 D 记录对齐方案。

### D.2 完整内容规格

| 维度 | M1 基线（冻结） | 在线版 v0.4.0 |
| --- | --- | --- |
| 楼层 | 3 层 | **5 层**（1F~5F），均为 7×9 = 63 格 |
| 怪物 | 3 种（史莱姆 / 蝙蝠 / 魔王） | **5 种**（+ 骷髅兵 / 暗法师；魔王设 `bombImmune`） |
| 道具 | 10 种（表里有 7 个 tile 未进关卡） | **12 种**（+ 飞行器 `F` / 炸弹 `o`），**7 个未使用 tile 全部铺进关卡**（铁盾 `S`、金币 `g`、蓝红钥匙/门、商店 `N`） |
| 隐藏道具 | 不做 | **隐藏暗格 `H`** × 4，由 `HIDDEN` 坐标配置表驱动（视觉同地板，走到触发后清成地板、不二次触发） |
| 飞行器 | 不做 | `hero.fly` + `useFly(state, ±1)`，直接升降一层（落点复用楼梯配对） |
| 炸弹 | 不做 | `hero.bomb` + `useBomb(state)`，清掉四邻普通怪（Boss 免疫、无目标不消耗、不给金币） |
| 商店 / NPC | 一句占位提示 | 文本框对话 + `shopBuy(state)`（20G 换 ATK+3，可重复） |
| 文本框弹层 | 不做 | **打字机弹层**，15 段剧情（序章 / 每层首次进入 / 隐藏发现 / 商店 / 获得能力 / 通关 / 阵亡），每段只弹一次、回放不弹 |
| 战斗动画 | 不做 | 旧帧 → 冲刺 / 打击星芒 / 伤害浮字 → 新帧；回放与演示跳过，带 `animating` 锁 |
| 图像 / 动画 / 声音 | 色块 + 字符、无音效 | 32 帧像素精灵表 + 2 个循环 GIF + 塔景插画 + 12 个 8-bit WAV + Web Audio（静音开关） |

**硬约束（写进校验，防止内容膨胀成不可解）**：隐藏道具 / 飞行器 / 炸弹 / 商店都是**可选增强或捷径，不是通关必需**。`solver.js` 只枚举四方向仍能通关，`tools/validate_logic.mjs` 有断言「solver 未调用 `useFly` / `useBomb` / `shopBuy`」。BFS 因此不需要为这些动作扩分支。

**关卡结构**：每层「开放大厅 + 楼梯龛 + 门」，门挡在上楼 `U` 的唯一入口、对应钥匙放在同层，避免钥匙链死锁；5F 王座 `W` 三面封墙、由魔王把守（「先打 Boss 再通关」仍是配置层约束，逻辑零特判）。`tools/validate_logic.mjs` 用 flood fill 断言每层所有实体格可达、楼梯双向配对。

### D.3 存档 v2 与 128B 待办

```
v2: 2|f,x,y,hp,atk,def,gold,ky,kb,kr,e,fly,bomb|fi.i.i;fi.i.i
v1: 1|f,x,y,hp,atk,def,gold,ky,kb,kr,e|fi.i.i        （M1 / 在线版 v0.3 旧档）
```

- `deserialize()` 同时接受 v2 与 v1，**v1 旧档补 `fly=0 / bomb=0`**，实现真实向后兼容（浏览器回归有断言）。
- `e` = 0 游戏中 / 1 阵亡 / 2 通关；第 3 段仍是「已清成地板的格子下标」变更集，`setTile` 只写 `.`，所以不必存新字符。
- **128B 暂不背**：手环端 `@system.storage.set` 的 128B 是 M1 附 C 的约束；在线版用 `localStorage` 无此硬限制，故 `CONFIG.SAVE_LIMIT` 放宽到 512、`CONFIG.HANDHELD_SAVE_LIMIT=128` 仅作 UI 参考线。为「暂缓的真机」硬上位图压缩属于过度设计。
- **实测最坏存档 137B**（5 层通关态）：已超过 128B 参考线，但在线版 512B 内。`validate_logic.mjs` 把这两条都写成断言，避免移植时忘记。
- **移植待办**：真机移植时须恢复 128B 约束，把第 3 段变更集改为**每层 63 格位图 + base64url**（固定 ~11 字符/层，5 层约 65 字符，head ~45 字符 → ~110B）。不要用 JS `BigInt`（轻量穿戴 JS 引擎未必支持），用 `Uint8Array` + 自实现 base64url。

### D.4 求解器：穷举 BFS → 策略式攻略

M1 的 3 层只有约 10 个可清格，宽搜 3428 状态即找到 26 步最短路。扩到 5 层后，属性（HP/攻/防/金币/钥匙）与 `opened` 变更集组合指数增长，**实测宽搜展开 40 万状态仍未收敛**——不是死局，是搜索策略不适用。

`solver.js` 因此改为「**单层静态 BFS 寻路 + 贪心清场**」：每轮按 `win > 道具/H > 可打赢的怪 > 能开的门 > 上楼` 的优先级选目标，用当前属性把「打不过的怪 / 没钥匙的门」当障碍做单层寻路，执行后重新规划。输出仍是纯方向数组，回放控制台接口不变。

| 项 | 实测 |
| --- | --- |
| 耗时 / 规划轮数 / 寻路节点 | 4 ms / 33 轮 / 260 节点 |
| 通关路线 | **110 步** |
| 通关属性 | `HP737 / ATK32 / DEF23 / GOLD93 / fly1 / bomb2` |
| 可解性证据 | ① 每层 flood fill 全可达；② 楼梯双向配对；③ 路线**逐步 `resolveStep` 重放确实 `win`**；④ 裸属性打魔王判 `unbreakable`（证明必须收成长道具） |

### D.5 表现层与资源

**分层保持不变**：`logic.js` / `tables.js` 零平台依赖（不 import DOM / `@system.*` / 任何资源名），`buildCells()` 只透传 `tile` 原始字符；精灵映射、音效映射、剧情时机全部由宿主层 `app.js` 按「state + 配置表 + texts.js」推断。事件协议仍是 M1 的 `msg / vibrate / save` **三类最小集合**，没有为 UI 新增事件类型。

`assets/` 全部由 `tools/gen_assets.py` 程序化生成（可复现、透明通道精确对齐 28px 网格、无外链）：

| 资源 | 内容 |
| --- | --- |
| `sprites.png` + `sprites.json` | 224×112、32 帧 28×28 像素精灵；atlas 自带 `tileMap`（tile 字符 → 帧 id）。覆盖墙 / 地板 / 英雄 2 帧 / 3 色门 / 3 色钥匙 / 12 道具 / 5 怪物 / 楼梯 / 王座 / 商店 / 隐藏地板 / 3 个特效帧 |
| `hero_idle.gif` / `slime_idle.gif` | 4 帧循环 GIF（84×84），资源卡可预览 |
| `title.png` | 480×260 像素风塔景插画，作文本框弹层背景。刻意用程序化像素风与精灵表统一，不叠 AI 半写实插画 |
| `assets/audio/*.wav` | 12 个 8-bit 芯片音效（22050Hz 单声道）：footstep / pickup / door / battle_hit / hurt / powerup / hidden / bomb / win / lose / click / story |
| `texts.js` | 全部文本单一真源：15 段剧情、12 道具描述、5 怪物描述、UI / 帮助文案、事件→音效映射 |
| `manifest.json` | 资源清单，供校验脚本核对 |

宿主层可一键切换：像素图 ↔ 色块、战斗动画开/关、音效开/关；资源卡可试听 12 个音效。音效经 Web Audio 播放，**首次交互后才初始化 AudioContext**（浏览器自动播放策略），音频不可用时静默降级。

### D.6 验证结果（PC 全量，未上真机）

| 脚本 | 断言 | 覆盖 |
| --- | --- | --- |
| `node tools/validate_logic.mjs` | **93 项** | 配置表合法性 / 楼梯配对 / 5 层 flood fill 可达性 / HIDDEN 坐标 / 110 步路线逐步重放 / 可选机制非必需 / 四个可选机制 / 战斗公式 / 存档 v2 往返与 v1 兼容 / 最坏存档 137B |
| `node tools/validate_assets.mjs` | **70 项** | atlas 覆盖所有地图 tile / PNG-GIF-WAV 文件有效且循环 / 15 段剧情 key 齐全 / 12 道具与 5 怪物描述齐全 / 音效映射无孤儿资源 |
| `node tools/validate_version.mjs` | **21 项** | 版本号单一真源、HTML 无硬编码、注入点齐全、回归脚本保留版本断言 |
| `node tools/browser_check.mjs` | **92 项** | 真实 Chromium CDP：冷启动 63 格、精灵渲染、序章弹层、手动走格、110 步回放（单步/跳转/后退/播放）、v1/v2 存档导入、缩放、隐藏暗格、F/Shift+F 升降、B 炸弹、商店购买、三开关、**零 JS 异常** |

合计 **276 项**。截图确认：胶囊屏像素精灵清晰无裁切、文本框弹层与塔景插画正常、资源卡 4 图无变形、全页卡片无重叠。M1 工程的 112 项断言仍有效（工程冻结未动）。

### D.7 版本号与改动纪律

`version.js` 是版本号单一真源（`VERSION` / `BUILD_DATE` / `CHANGELOG`），`renderVersion()` 注入标题徽章 / 标签页 / 页脚 / 版本记录。每次改动的固定动作：

1. 递增 `VERSION`（新增能力 +1 minor，修 bug / 小调整 +1 patch）；
2. `CHANGELOG` 最前补一条，`v` 必须与 `VERSION` 完全一致；
3. 跑 `node tools/validate_version.mjs` 与 `node tools/browser_check.mjs`。

改动纪律：**调数值只改 `tables.js`；改规则先改 `logic.js` 的 `CONFIG` 开关或纯函数；改文案只改 `texts.js`；改资源重跑 `python3 tools/gen_assets.py` 后跑 `validate_assets.mjs`**。视图层 `app.js` 不写任何数值判断。当前为 **v0.4.0**。

### D.8 真机移植对齐待办（暂缓，勿现在做）

1. 以在线版 `logic.js` / `tables.js` / `texts.js` 为准重新对齐 `mota-lite/src/common/`，恢复字节一致；M1 的 `validate_tables.js` / `validate_view.js` / `solver.js` 需按 5 层内容重写断言（26 步 → 110 步、3 层 → 5 层）。
2. `manifest.json` 的 `versionName 0.1.0 / versionCode 1` 与 `package` 占位 `com.yourname.motalite` 未联动，需一并定稿。
3. **恢复 128B 存档约束**：按 D.3 把变更集改位图 base64url，或确认 Vela 真机 `storage.set` 实际上限后放宽。
4. 表现层降级评估：63 格整表 diff 耗时、`@system.storage` 真机回调签名、`swipe` 在 212 宽胶囊屏的灵敏度——三项**仍无真机数据，未编结论**。战斗动画 / 文本框弹层 / Web Audio 音效在 Vela 上需按性能预算降级或裁剪（M1 的 `index.ux` 无这些能力）。
5. M2 全套：AuthKey → Build RPK → 模拟器四方向 `swipe` → 不息屏与切走读档 → 振动验证。
6. `mota-lite-skeleton/` 是过时初版（未同步附 C 的 5 处修正），**不要再拿它继续开发**。

### D.9 已知边界

- 在线版是浏览器试玩版，**不是 `.rpk`**，也不能替代手环端。
- 逻辑层分叉是**有意且受控**的（D.1）；两份 `logic.js` 是「同一文件的不同阶段版本」，不是两套并行实现。
- 5 层仍用整层 63 格视口，未做 M3 的视口裁剪；若继续扩到 10~20 层需按 §5.3 实现视口裁剪（数组仍定长 63）。
  **v0.5 更新**：现已扩到 10 层，但**仍不做视口裁剪** —— 每层恰好 63 格一屏，层数增加不触发裁剪需求，理由见附 E.2。
- 「商店」固定一种交易（20G → ATK+3）、炸弹固定清四邻，都是刻意保持简单；要扩展优先走配置层。


---

## 附 E：在线版 M3 内容收尾（v0.5.0，2026-11-11）

> 本附录记录**当前阶段**：在线试玩版 `/workspace/mota-lite-web/`，版本 `v0.5.0`。
> 附 D 是 v0.4.0 的时点快照，保留作历史对照；**当前状态以本附录为准**。
> 手环端 M1 工程 `mota-lite/` **继续冻结**（真机暂缓）——用户在阶段选择中明确选了「M3 完整收尾」而非「解冻真机」。
> 「换机器后照此继续实现」时：**先读附 E，再读附 D**，M1 基线见 §4/§6/§7/§11。

### E.1 阶段选择与边界

| 项 | 决策 |
| --- | --- |
| 真机 / M2 | **继续暂缓**。不编译 `.rpk`、不进模拟器、不上真机；AuthKey、`@system.storage` 回调签名、63 格 diff 耗时、`swipe` 灵敏度仍**无真机数据，未编结论** |
| 在线版 | 独立演进到 **v0.5.0**，本附录为其唯一当前规格 |
| 逻辑层分叉 | 沿用附 D.1 的受控分叉，在线版自己的 `logic.js` / `tables.js` / `solver.js` 仍是单一真源 |
| 视口裁剪 | **不做**（M3 原列项，经评估为过度设计，见 E.2） |
| Excel 导表 | **不接**（改用 JSON 中间格式，见 E.3） |

### E.2 为什么不做视口裁剪（对 M3 原项的修订）

> **【本附录结论已于 v0.8.0 作废，保留仅作历史对照】** 当时地图是 7×9 = 63 格、恰好一屏，
> 裁剪确实没有意义；v0.8.0 按用户要求把每层扩到 **13×15 = 195 格**（「不要求一屏显示完」），
> 单层已远超一屏，视口裁剪 + 相机跟随反而成为**必需**并已落地。当前规格见**附 H / H.7**，
> 切勿再引用本节的「不做」结论。下面的推理只对 v0.5~v0.7 的 63 格地图成立。

M3 原文写「楼层扩到 10~20 层，地图用视口裁剪（数组仍定长 63）」。复核后确认这句把两件事绑在了一起，但实际不成立：

- 视口裁剪解决的是「**单层地图大于一屏**」——比如 11×11 或 20×20 的地图，需要只渲染玩家周围的 63 格；
- 本项目每层固定 **7×9 = 63 格**，正好等于 `buildCells()` 的定长输出与手环 212×520 一屏容量。**层数从 5 增到 10 不改变单层尺寸**，每层仍是一次整表赋值、零滚动、零坐标偏移；
- 若强做裁剪，需要引入相机坐标、可见窗口到棋盘坐标的映射、存档里的相机状态、solver 的路径坐标换算，以及 M1 视图层 `<block for>` 的重写 —— 收益为零，却让「配置层优先 / 视图层不写规则」这套分层失效。

因此**按用户「检测过度设计时要求纠正」的约定显式删掉该项**，10 层仍用整层 63 格视口。若将来真要做大地图（单层 > 63 格），再按 §5.3 单独开项，不与「加层数」混为一谈。

### E.3 关卡表外置与导表脚本（配置层优先的落地）

```
levels/levels.json   ← 唯一编辑源（策划改这里）
        │  python3 tools/build_tables.py
        ▼
tables.js            ← 生成物，运行时唯一 import 目标（app.js / logic.js / solver.js 不认识 JSON）
        │  node tools/validate_levels.mjs
        ▼
   30 项断言：结构合法 / 8 个导出语义等价 / --check 防漂移 / 生成器确定性
```

- `levels.json` 含 `tileColor` / `tileChar` / `monsters` / `items` / `floors` / `hero0` / `doorKey` / `hidden` 八段，一律「数组 + id」，避免同名 key 静默覆盖。
- `build_tables.py` 只依赖标准库，输出确定（同一份 JSON 永远生成同样字节）；支持 `--check`（只比对不写盘）与 `--stdout`（供 diff）。
- **改动纪律**：改数值 / 改地图 → 改 `levels.json` → 跑 `python3 tools/build_tables.py` → 跑 `node tools/validate_levels.mjs`。`validate_levels.mjs` 会断言「重新生成的字节 == 现有 `tables.js`」，防止手改生成物或忘记导表。
- 资源侧同源：`tools/gen_assets.py` 的 `manifest.version` 从 `version.js` 读、塔景插画层数从 `levels.json` 读，消除双版本号 / 双层数漂移。

> **为什么没接 Excel**：用户现有工程 `Tools\ExcelToTableData`（Python 导出 `res/DataTable`）是另一套项目，与本在线版无关；此处关卡是等宽字符地图，用 JSON 作中间格式可直接 diff、可直接被 node 校验、无需额外依赖。保留「以后接 Excel」的口子：只需再加一个 `xlsx -> levels.json` 的转换脚本，运行时与生成器都不用改。

### E.4 10 层内容规格

| 维度 | v0.4.0（附 D） | v0.5.0（当前） |
| --- | --- | --- |
| 楼层 | 5 层 | **10 层**（1F~10F，每层仍 7×9 = 63 格） |
| 隐藏暗格 | 4 处 | **8 处**（1F/3F/4F/5F/6F/7F/8F/10F） |
| 剧情文本 | 15 段 | **24 段**（10 段楼层 + 8 段暗格 + 序章/终章/商店/能力等） |
| 通关记录 | 无 | **有**：最高层 / 最少步数 / 累计通关次数，独立 `localStorage` key |
| 通关路线 | 110 步 | **220 步**（策略式求解 9ms / 78 轮规划 / 483 寻路节点） |
| 通关属性 | HP737 / A32 / D23 | HP1641 / A64 / D55 / G192 / fly2 / bomb3 |
| 最坏存档 | 137 B | **269 B**（仍 < 在线版 `SAVE_LIMIT` 512；> 手环端 128B 参考线） |

**关卡结构**：1F~4F 沿用 v0.4 原图不改（回归断言不破）；5F 从「顶层王座」改造为中间层；6F~9F 新增，统一「左右双竖廊 + 门挡上楼唯一入口 + 钥匙同层」模板；10F 为顶层，王座 `W` 三面封墙、唯一入口由魔王 `3` 把守 —— 「先打 Boss 再通关」仍是配置层约束，逻辑零特判。

**可解性证据**（`validate_logic.mjs`）：① 每层 flood fill 所有实体格可达；② 楼梯双向配对；③ `HIDDEN` 坐标与地图 `H` 一致；④ 220 步路线**逐步 `resolveStep` 重放确实 `win`**；⑤ 路线覆盖全部 10 层；⑥ 裸属性打魔王仍判 `unbreakable`（证明必须收成长道具）。

**修掉一个真 bug**：10 层里可拾到多个飞行器 / 炸弹，通关态 `fly=2 / bomb=3`，而 v0.4 的 `deserialize()` 有 `fly > 1` 上限判断，会把通关存档判成坏档、读档后回退 `newGame()`。现改为「`fly > 99 || bomb > 99` 才判坏档」（挡异常大数，不是游戏规则），并新增 4 条回归断言守住：通关存档能完整读回、ended/楼层/变更集一致、`fly/bomb > 1` 合法、异常大数仍拒绝。

### E.5 通关记录（records.js）

- 独立于存档串：`RECORD_KEY = 'mota_lite_web_records_v1'`，JSON 存 `{ bestFloor, minSteps, wins }`；存档串仍是可复制的紧凑格式，不塞记录。
- 纯函数零 DOM 依赖：`normalizeRecords()` 容错坏数据、`applyStep()` 只在「真实走一步后换层 / 本步从非通关跃迁到通关」时更新，可被 node 直接校验（14 项断言）。
- **纪律**：回放心旅行、导入外部存档、读档到已通关状态都**不写入记录**（与「回放不污染 localStorage 存档」一致）；`browser_check.mjs` 有 8 条端到端断言覆盖，含「回放通关不写记录」「导入存档本身不写记录」「正常游玩通关才写」。
- 口径：步数按本次会话计，导入存档后从 0 起算（存档格式不含步数，UI 已注明）。

### E.6 界面修整

新增「通关记录」卡片填掉「图例」右侧原有的约 300px 留白；截图确认图例与记录卡并排、右列不再空。同时把「当前阶段 / 架构说明」文案改为描述关卡表外置与 10 层，标题版本号仍由 `version.js` 单一注入。

### E.7 验证结果（PC 全量，未上真机）

| 脚本 | 断言 | 覆盖 |
| --- | --- | --- |
| `node tools/validate_logic.mjs` | **158 项** | 10 层配置 / 楼梯 / flood fill / 220 步重放 / 可选机制 / 战斗公式 / 存档 v2 与 v1 兼容 / **fly-bomb 多持有回归** / records 纯逻辑 |
| `node tools/validate_assets.mjs` | **70 项** | atlas 覆盖全部 tile / PNG-GIF-WAV 有效 / 24 段剧情 key 齐全 / 无孤儿资源 / manifest 版本号同源 |
| `node tools/validate_version.mjs` | **21 项** | v0.5.0 单一真源、HTML 无硬编码、注入点齐全、回归脚本保留版本断言 |
| `node tools/validate_levels.mjs` | **30 项** | JSON 结构 / 8 导出语义等价 / 生成器防漂移与确定性 / 运行时不读 JSON |
| `node tools/browser_check.mjs` | **104 项** | 真实 Chromium：冷启动 63 格 / 精灵渲染 / 剧情弹层 / 220 步回放（单步·跳转·后退·播放）/ v1-v2 存档导入 / 缩放 / 记录持久化 8 项 / 三开关 / **零 JS 异常** |

合计 **383 项全绿**。M1 工程 112 项断言仍有效（工程冻结未动）。线上链接 `https://a90de159696836c69.app.workbuddy.host/?sharecode=Q3MGIJWJ43` 实时挂载 `/workspace/mota-lite-web/`，刷新即为 v0.5.0。

### E.8 改动纪律与真机移植待办

**纪律**（每次改动固定动作）：

1. 改数值 / 改地图 → 只改 `levels/levels.json`；改规则 → 改 `logic.js` 的 `CONFIG` 或纯函数；改文案 → 只改 `texts.js`；改资源 → `python3 tools/gen_assets.py`。
2. 改完 `levels.json` 必须跑 `python3 tools/build_tables.py` + `node tools/validate_levels.mjs`。
3. 每次改动递增 `version.js` 的 `VERSION` 并补 `CHANGELOG`（首条 `v` 必须等于 `VERSION`），跑 `validate_version.mjs` 与 `browser_check.mjs`。
4. 视图层 `app.js` 不写任何数值判断；`tables.js` 是生成物，**不要手改**。

**真机移植待办（仍暂缓，勿现在做）**：沿用附 D.8 全部 6 条，并补充：

- 按 10 层内容重新对齐 M1 `src/common/`，其校验脚本需把「5 层 / 110 步」全部改为「10 层 / 220 步」；
- 恢复 128B 存档约束：10 层最坏存档 269B，位图压缩方案（附 D.3）在 10 层下约需 ~20 字符/层的位图，须重算上界；
- 8 处隐藏暗格 / 24 段剧情文本框在 212×520 上的表现层降级评估；
- `manifest.json` 的 `versionName / versionCode / package` 仍需定稿。


---

## 附 F：在线版 21 层与交互重构（v0.6.0，2026-11-11）

> 本附录取代附 E 作为**当前阶段规格**；附 D / 附 E 分别保留 v0.4.0 / v0.5.0 时点快照作历史对照。
> 手环端 M1 工程 `mota-lite/` 继续冻结（真机暂缓），本轮全部改动只发生在 `mota-lite-web/`。
> 触发本轮的是用户在浏览器上确认效果后的 4 条反馈：方向键多余、1F 移动后原地还有单位、HUD 文本同色难分辨、期望 21 层。

### F.1 四项改动与落地位置

| 反馈 | 处理 | 文件 |
| --- | --- | --- |
| 方向键多余，不如点格子 | 移除 `.pad` 四个方向按钮；点击任意可达格 → 复用 `solver.js` 导出的 `findPath()` 求最短方向序列 → `walkTo()` 自动逐帧 `manualStep()`（相邻格即单步） | `index.html` / `style.css` / `app.js` / `solver.js` |
| 原位置放道具与设置按钮 | 3×2 的 `.action-bar`：升层 / 降层 / 炸弹 / 购买 / 设置；`.settings-layer` 浮层放像素图 / 战斗动画 / 音效三开关，与右侧工作台共用同一份状态 | 同上 + `texts.js` |
| 1F 移动后原地还有单位 | 见 F.2 根因修复 | `logic.js` / `tools/gen_assets.py` |
| 期望 21 层 | 见 F.3 | `levels/levels.json` / `tables.js` / `texts.js` / 资源 |
| HUD 同色难分辨 | 见 F.5 | `index.html` / `style.css` / `app.js` |

### F.2 「移动后原地还有单位」的真正根因

不是动画残影，也不是 DOM 槽位没清。`levels.json` 的 1F 出生点字符是 `@`，`newGame()` 只把它当出生坐标、**从不归一化成地板**；而 `assets/sprites.json` 的 `tileMap` 把 `"@"` 映射成 `hero_a`。于是 `buildCells()` 每次都把 `@` 当作普通 tile 透传给宿主层的 `applyVisual()`，英雄走开后出生点依旧画一个英雄精灵。

**色块模式下无此问题**（`TILE_CHAR['@']` 未定义 → 空字），所以只有像素图模式可见，容易被误判成渲染残留。

修复在**视图数据边界**完成，不动地图、不动存档、不动 solver：

- `logic.js` `buildCells()`：`const ch = raw === '@' ? '.' : raw`，`@` 统一归一化成地板再产出 `tile` 字段；
- `tools/gen_assets.py`：`TILE_MAP['@'] = 'floor'`，让任何绕过 `buildCells` 的渲染路径也不会画出第二个英雄；
- 回归断言：`validate_logic.mjs` 断言任意状态 `buildCells()` 不含 `@`、`isHero` 恰好 1 个；`validate_assets.mjs` 断言 atlas 的 `@` 映射为 `floor`；`browser_check.mjs` 在英雄走开后校验 slot 50 的 `backgroundPosition` 等于 floor 帧而非 `hero_a` 帧。

### F.3 21 层：配置层扩层，不改战斗公式

沿用 v0.5 的中间层模板循环补齐 11F~20F，21F 为顶层王座；1F~4F 原样不动。仍是「数组 + id」、7×9 = 63 格整层一屏，**不做视口裁剪**（理由见附 E.2：层数增加不改变单层尺寸）。

- `levels/levels.json`：21 层 / 5 怪 / 12 道具 / **19 处隐藏暗格**；`meta.note` 标明唯一编辑源。
- `tools/build_tables.py` 生成 `tables.js`（12993 B），`tools/validate_levels.mjs` 30 项防漂移断言不变。
- `texts.js`：`story` 从 24 段扩到 **46 段** = 通用 6 + 楼层 21 + 暗格 19；序章「二十一层石阶」、终章「第二十一层」、tagline「廿一层塔，一把锈剑，一个结局」同步。
- `tools/gen_assets.py` 重跑：塔景插画画成 21 层，`manifest.version = 0.6.0`、`manifest.levels.floors = 21`，版本号与层数仍是同源。

**可解性与存档上界（先在隔离探针实测，再落地）**：

| 指标 | 实测 |
| --- | --- |
| 通关路线 | **462 步** / 177 轮规划 / 974 寻路节点 / 14ms |
| 通关态属性 | `HP3291 / ATK137 / DEF122`，`fly=4 / bomb=5` |
| 通关存档 | **569 B**，变更集 160 格 |
| 原 `SAVE_LIMIT` | 512 B → **超限 57 B** |

因此 `CONFIG.SAVE_LIMIT` 由 512 放宽到 **1024**（在线版 `localStorage` 无手环 128B 硬限制），`HANDHELD_SAVE_LIMIT=128` 仍只作 UI 参考线。`deserialize()` 对 `fly/bomb > 1` 的既有兼容保留。

**已知边界（如实记录，不额外造内容）**：怪物表是全局共享的 5 种，21 层里后段重复模板，道具累加使属性线性增长，后期难度趋于平缓（通关态 ATK137 / DEF122 远高于魔王 DEF18 / ATK36）。这是 Lite 版按层数对齐的务实取舍；若要难度曲线，需新增怪物种类与精灵帧、精灵表尺寸与 `monsterDesc` 一并调整，属独立议题，本轮不做（避免过度设计）。

### F.4 点击格子移动的交互口径

- 点**相邻格** = 路径长 1，等价于原来的单步；
- 点**远处可达格** = 自动逐帧走（150ms / 步），障碍判定与通关攻略完全同源（墙 / 打不过的怪 / 缺钥匙的门都视为障碍）；
- 途中遇战斗动画（等待）、剧情弹层（停止，玩家看完再点）、换层或结束（停止）自动让位；键盘 ↑↓←→ / WASD 与滑动拖动保留作精确单步输入，`endGesture()` 抑制滑动附带的合成 click，避免一次滑动走两步；
- `solver.js` 的 `findPath()` 由内部函数改为导出，`app.js` 直接复用，不复制第二套寻路；
- 462 步回放下 `renderRouteStrip()` 改为「DOM 只建一次、之后只改 class」，避免单步 / 一路退回时反复重建数百个按钮。

### F.5 HUD 分段彩色

原 `renderHud()` 把 `1F HP200 A10 D10 Y0` 整串写进一个 `textContent`。改为 `index.html` 里 8 个固定 `span` 槽位（与 63 格「固定槽位、只改内容」同风格）：楼层金、HP 绿（≤30 转红）、攻橙、防青、黄/蓝/红钥匙三色、金币黄；两行排布，不重建 DOM。`browser_check.mjs` 用 `getComputedStyle` 断言颜色不少于 6 种。

### F.6 验证结果

| 校验 | 断言 |
| --- | --- |
| `node tools/validate_logic.mjs` | **261 项** |
| `node tools/validate_assets.mjs` | **73 项** |
| `node tools/validate_version.mjs` | **21 项** |
| `node tools/validate_levels.mjs` | **30 项** |
| `node tools/browser_check.mjs`（真实 Chromium CDP） | **128 项** |
| **合计** | **513 项全绿，零 JS 异常** |

`python3 tools/build_tables.py --check` 通过；线上链接 `https://a90de159696836c69.app.workbuddy.host/?sharecode=Q3MGIJWJ43` 实时挂载 `/workspace/mota-lite-web/`，刷新即为 v0.6.0。

### F.7 改动纪律与真机移植补充待办

沿用附 E.8 全部纪律（改 `levels.json` → 导表 → 校验；每次改动递增 `version.js` 并跑版本 / 浏览器回归；`tables.js` 是生成物不要手改）。新增：

- 真机移植时 `SAVE_LIMIT` 必须**收回 128B** 并启用位图压缩：21 层最坏 569B，按附 D.3 方案重算上界（比 10 层的 269B 更紧）；
- M1 对齐时按 **21 层 / 462 步** 重写其校验脚本基线，并把点击格子输入映射回 `@swipe`（手环没有「点远格」概念，需评估是否退化为四方向单步）；
- 21 层 × 46 段文本框在 212×520 上的表现层降级评估；
- 后期难度曲线（新增怪物种类 / 精灵帧）为独立议题，用户未要求前不启动。


---

## 附 G：在线版存档安全与新游戏入口（v0.7.0，2026-11-11）

> 本附录取代附 F 作为**当前阶段规格**；附 D / E / F 分别保留 v0.4.0 / v0.5.0 / v0.6.0 时点快照作历史对照。
> 手环端 M1 工程 `mota-lite/` 继续冻结（真机暂缓），本轮全部改动只发生在 `mota-lite-web/`。
> 触发本轮的是用户三个问题：有没有存档槽位概念、开始新游戏没有入口、危险操作需要二次确认（例如是否覆盖存档）。
> **本轮未改任何游戏规则、配置表与存档格式**，21 层 / 462 步 / 569B / 1024B 上限等附 F 结论仍然有效。

### G.1 存档模型：明确为「单一自动存档槽」，不引入多槽位

**现状（回答用户提问）**：全局只有一个 `SAVE_KEY = 'mota_lite_web_v1'`，`save()` 在每次 `resolveStep()` 产出 `t=save` 事件时把 `serialize(state)` 整串**覆盖写入** `localStorage`；没有槽位编号、没有多进度并存。`mota_lite_web_records_v1` 是通关记录统计（独立 key），不是存档槽。存档工作台里可复制 / 粘贴存档串，事实上充当「手动备份」。

**决策：保持单槽，不做 3 槽位**。理由：

- 用户举的例子是「是否覆盖存档」，本身就是单槽覆盖语义；
- Lite 版定位与手环端 128B 存档约束下，多槽会成倍放大存储与同步复杂度；
- 多槽会牵动存档 key 结构、存档工作台、回放备份（`backup`）、通关记录归属、真机移植压缩方案全链路，收益低，属于过度设计。

但把这个事实**在界面上写明**：存档工作台标题加「自动存档 · 单槽」，新增 `TEXTS.ui.saveSlotNote`，说明「每走一步自动覆盖写；复制上方存档串粘贴回来即为手动备份」。若将来确需多进度并存，应单独开一轮，先定槽位数、命名与迁移策略。

### G.2 新游戏入口族：从「藏起来且一点就覆盖」到「多处可见且统一收口」

v0.6 及以前 `restart()` 只挂在结束遮罩「重新开始」、右下角存档工作台「重新开始」、键盘 `R`；正常游玩中屏幕内没有明显入口，且 `restart()` 内部直接 `save()` 覆盖旧档，**零确认**。

v0.7 新增三处可见入口：

| 入口 | 元素 | 说明 |
| --- | --- | --- |
| 页头主按钮 | `#btnNewGameTop` | 最显眼，脱离 212×520 屏幕，任何状态可点 |
| 屏幕内道具栏第 6 个按钮 | `#btnActNewGame` | 原方向键位置，`.action-bar` 由 3×2 改为 3×2 + 提示行（6 按钮 + 跨列 hint） |
| 设置浮层一项 | `#setNewGame` | 常规「设置 → 新游戏」路径，危险色 `.settings-danger` |

连同 `overBtn`、`btnRestart`、键盘 `R` **全部收口到 `requestNewGame()`** → 二次确认 → `restart()`。`restart()` 保留为「真正执行」的纯动作、不带确认逻辑，便于确认回调与回放复用。

### G.3 通用二次确认弹窗

刻意**不用 `window.confirm`**：原生 dialog 会阻塞无头 Chromium（CDP 回归直接卡死）、样式与屏幕内浮层不统一、也无法被自动化断言覆盖。改为屏幕内 `.confirm-layer`（`z-index: 12`，高于剧情 10 / 设置 11）+ 回调式 `openConfirm(opt)`：

- `confirmOpen` / `confirmAction` 两个模块级状态；`openConfirm()` 有重入保护（`if (confirmOpen) return`），打开时 `pause()` + `stopAuto()` + 若设置浮层开着则 `closeSettings()`；
- `confirmOk()` 先 `closeConfirm()` 再执行回调，`confirmCancel()` 只关弹层并写「已取消，当前进度未改动」日志；
- 交互：Enter 确认、Escape 取消、点遮罩取消；确认分支在全局 `keydown` 里**优先于** `INPUT` 判断，避免焦点还留在存档输入框时 Enter 失效；`saveInput` 的 Enter 与 `importSave()` 都有重入保护，不会二次弹窗；
- **输入互斥**：`manualStep()` / `walkTo()` / `swipe()` / `doAction()` 开头都加 `confirmOpen` 判断，确认框打开期间键盘方向键、点击格子、滑动、道具按钮全部让位；`.confirm-card` 加入 `mousedown` 排除列表，避免确认框内拖动被当成 swipe 并吃掉下一次点击。

### G.4 四类危险操作接入确认

| 操作 | 入口 | 确认关键点 |
| --- | --- | --- |
| 开始新游戏 | `requestNewGame()` | 「开始新游戏？」；`hasProgress()` 为真时正文带当前楼层 / HP / 步数摘要、按钮「覆盖并开始」；无进度时只说「从 1F 重新开始」、按钮「开始」 |
| 清除存档 | `requestClearSave()` | 「清除存档？」；确认后 `clearSave(); restart()` |
| 载入存档 | `importSave()` | 「载入存档？」；**坏档 / 空串在确认之前就拒绝**，只有合法存档才谈覆盖；正文显示截断到 46 字的存档串摘要 |
| 清除通关记录 | `requestClearRecords()` | 「清除通关记录？」；明确说明存档进度不受影响 |

`btnReplay`（载入通关攻略）**不加确认**：`startReplay()` 有 `backup` 快照，退出回放可完整恢复进度，属于可逆操作，避免确认疲劳。

实现上 `importSave()` 拆成「校验 + 弹确认」与 `applyImport(s, text)`「真正落盘」两段；两者都不调用 `commitRecords()`，导入外部存档仍不计入通关记录。`validate_logic.mjs` 相应改为按**函数体大括号配对**取 `importSave` / `applyImport` 的函数体再判定，避免跨函数正则把相邻函数的 `commitRecords` 误算进导入路径。

### G.5 文案与单一真源

新增 `TEXTS.confirm`（18 项）与 `TEXTS.ui` 的 5 项入口文案，全部由 `injectTexts()` 注入；`index.html` 里按钮只留 `—` 占位。`validate_assets.mjs` 新增断言覆盖确认文案齐全与占位符 `{floor}` / `{hp}` / `{steps}` / `{save}`。

### G.6 验证结果

| 校验 | 断言 |
| --- | --- |
| `node tools/validate_logic.mjs` | **261 项** |
| `node tools/validate_assets.mjs` | **76 项** |
| `node tools/validate_version.mjs` | **29 项** |
| `node tools/validate_levels.mjs` | **30 项** |
| `node tools/browser_check.mjs`（真实 Chromium CDP） | **169 项** |
| **合计** | **565 项全绿，零 JS 异常** |

`browser_check.mjs` 新增 `accept(sel)` 辅助：点击危险按钮后若确认框出现就自动点「确认」，坏档等不弹窗的情况原样跳过——原有 128 条断言不必逐条改写语义。新增 O 段 41 条专项断言，覆盖：三处入口、进度摘要、取消不覆盖、确认覆盖、Enter / Esc / 点遮罩取消、确认期间键盘与点击格子不生效、结束遮罩入口、键盘 R / Backspace、坏档不弹窗、清除存档 / 载入存档 / 清除记录均需确认。

`validate_version.mjs` 新增 8 项防漂移断言（确认弹层注入点、入口族三处、单槽说明、未实际调用原生 `window.confirm`、危险操作绑定带确认入口、CSS 样式、浏览器回归有专项断言）。

### G.7 边界与真机移植待办

- 在线版 `localStorage` 仍是**单槽**，真机移植时除附 F.7 的 128B 压缩外，还需在 Vela 静态组件树里自绘一套确认浮层（无原生 `window.confirm`、无 DOM `hidden` 属性语义），并把 Enter / Esc 映射回 `swipe` 或实体键；
- 确认弹窗是**宿主层**能力，`logic.js` 不感知；存档格式 v2 未变，`deserialize()` 兼容 v1 旧档不变；
- 若将来要做多存档槽位，须先定槽位数、命名、迁移与通关记录归属，属独立议题，本轮不做；
- 附 F 的 21 层 / 462 步 / 569B / `SAVE_LIMIT=1024` 等结论**仍然有效**。

---

## 附 H：在线版 13×15 大地图与主动交互（v0.8.0，2026-11-11）

> 本轮输入是用户在浏览器里体验完 v0.7.0 后的一次性六条反馈。核心是**地图从「一屏一层」改成「一层多屏」**，
> 以及**输入语义从「点哪儿走到哪儿」改成「点实体才交互」**。前者让附 E.2 的「视口裁剪不做」正式作废，
> 后者是魔塔类游戏的操作惯例回归 —— 走路不该顺手把怪打了、把宝捡了。

### H.1 六条需求与落地口径

| # | 用户原话 | 落地口径 |
| --- | --- | --- |
| 1 | 寻路应视格子上的物品/怪物/商店等为阻挡，玩家需主动交互；领取动作是走到物品前一格停下再领取，之后停下 | 新增 `isWalkable()` / `isEntityTile()` 作为唯一判定；`findPath(s, targets, {blockEntities:true})`；点实体走「相邻格」路径，走完补一次交互即停（一次点到底） |
| 2 | 每层地图太小，需要扩大、不要求一屏显示完，复杂度提高、每层有主题，部分地图有房间，房内有宝物或要救的人（商人/法师/盗贼），房间入口有怪物把守 | 21 层全量重做为 **13×15 = 195 格**；9 层带房间；房内放商人 / 法师 / 盗贼 / 图鉴 / 飞行器 / 宝物；开口外侧必有守怪；每层一主题名（`THEMES`） |
| 3 | 新增宝物「图鉴」，获得后点图鉴按钮弹出界面，展示当前层所有怪物类型的攻/防/血 | 宝物 `I`（全塔唯一，6F 房间），`effect: {book:1}`；新增图鉴按钮 + 浮层，列出本层存活怪物的 HP / 攻 / 防 + `calcBattle()` 预测徽章 |
| 4 | 屏幕缩放再加一档 0.5×，方便确认手环 10 上的效果 | `data-zoom="0.5"`，与 1× / 1.25× / 1.5× 并列，CSS `zoom` 实现 |
| 5 | 飞行器只需获取一次，应是中期道具 | 全塔唯一 `F`（11F 房间），`applyEffect` 里 `fly = 1` 不累加；永久持有、不消耗 |
| 6 | 飞行器只能跳转到已探索过的楼层 | 新增 `state.explored`，换层 / 飞行时记录；`useFly()` 校验目标层 ∈ explored |

### H.2 地图：13×15 主题大地图

生成器 `tools/make_levels.py`（新增，可重跑）→ `levels/levels.json` → `tools/build_tables.py` → `tables.js`，编辑纪律不变。

- **尺寸**：13 列 × 15 行，边框全墙，内部 11×13 大厅；单层 195 格，一屏只显示 7×9（`meta.viewport`）。
- **固定锚点**：`D` 下楼落点恒在 (1,1)（1F 该格是 `@`），`U` 上楼恒在 (11,13)，与 `resolveStep` 的落点规则严格一致。
- **主题**：21 层各一个主题名（潮湿石厅 / 商队歇脚 / 骨与火把 / … / 王座之间），写进 `floors[].name`，HUD 直接显示。
- **房间**：9 层（2/4/6/8/11/13/15/17/19F）用内墙围出 7×6 房间，唯一开口 (6,8)，开口外侧 (6,9) 放守怪。
  房内内容按 `ROOM_KIND` 分配：2F/17F 商人、8F 法师、15F 盗贼、6F 图鉴、11F 飞行器、4F/13F/19F 宝物。
- **复杂度**：非房间层随机插入 5 段 2 格短内墙（`flood_ok()` 不连通则回退），形成走廊与绕行。
- **唯一性**：`F` 与 `I` 全塔各 1 个（`validate_levels` 双重断言）；`HIDDEN` 19 处且奖励与既有剧情文案逐条对齐（`HIDDEN_REWARD`）。
- **可解性**：隔离探针实测 **1432 步 / 244 轮 / 43ms** 通关，重放 `ended=win`，覆盖全部 21 层。

### H.3 主动交互：从「点哪儿走哪儿」到「点实体才交互」

判定集中在 `logic.js`，宿主层与求解器共用同一份，不各写一套：

```js
const WALKABLE = { '.': 1, '@': 1, 'H': 1, 'U': 1, 'D': 1, 'W': 1 }
export function isWalkable(ch) { return !!WALKABLE[ch] }
export function isEntityTile(ch) { return ch !== '#' && !WALKABLE[ch] }
```

- **可走格只有** `. @ H U D W`。`H` 必须算可走 —— 它视觉与地板完全一致，靠走上去发现，若算实体就永远踩不到。
- **实体**：门 / 三色钥匙 / 所有道具 / 怪物 / 商店 `N` / 法师 `M` / 盗贼 `T` / 图鉴 `I`。
- **寻路**：`findPath(s, targets, opts)` 新增 `opts.blockEntities`。玩家点击传 `true`；solver 攻略**不传**，保持 v0.7 语义（可穿越可打赢的怪与道具），否则 1432 步的通关路线会被新规则打断。
- **门仍可穿**：有对应钥匙时 `blockEntities` 也放行 —— 开门后该格就是地板，若把门当纯阻挡，进房间要反复点门，体验退化。
- **点实体**：目标是「它四周的可走格集合」，走完路径后补一次「进格」交互再 `stopAuto()`。这满足「走到前一格停下再领取，之后停下」。
- **点商店**：`resolveStep` 撞 `N` 改为**只对话、不移动**（v0.7 会站到商人身上）。宿主层点 `N` 直接弹交易框。
- **兜底**：实体四周全被其他实体占住时，退回旧语义直接走进目标格，避免角落宝箱永远拿不到。
- **solver 的 `N` 处理**：任何模式都不穿越 `N`，否则会规划出「走不动」的路径导致策略空转。

### H.4 图鉴

- 宝物 `I`「怪物图鉴」，`effect: { book: 1 }`，`applyEffect` 里 `book = 1` 不累加；`hero0.book = 0`。
- 宿主层按钮 `#btnActCodex`：未持有时按钮半透明（`locked` class），点击给提示「先找到宝物图鉴（6F 房间）」；
  持有时打开 `#codexLayer`，列出**当前层存活怪物类型**的 `HP/攻/防`，并用 `calcBattle()` 给出 `防杀 / -NHP / 破不了防 / 会阵亡` 徽章。
- 与右侧「战斗预览」的区别：预览是开发用全量面板，图鉴是**游戏内道具**，只显示本层、按持有状态解锁。

### H.5 飞行器：全塔唯一 + 只能飞已探索层

- `F` 只在 11F 房间，`applyEffect` 从 `fly += n` 改成 `fly = 1`（永久持有、不消耗）。
- `state.explored` 是 `{ [floor]: 1 }`：`newGame()` 只含出生层；`resolveStep` 换层、`useFly` 成功后写入。
- `useFly` 校验顺序：有道具 → 目标层存在 → **目标层已探索**。未探索时提示「飞行器只能前往已探索的楼层」。
- 这样它才是中期赶路道具：能回跳补道具，不能当电梯直上顶层。

### H.6 存档 v3

```
3|f,x,y,hp,atk,def,gold,ky,kb,kr,e,fly,bomb,book|opened|explored
```

- head 从 13 字段扩到 14（末尾加 `book`），新增第 4 段 `explored`（升序点分，如 `0.1.2`）。
- `deserialize` 同时接受 v3 / v2 / v1：v2 补 `book=0`，`explored` 按「当前层 + `opened` 出现过的层」推断；v1 再补 `fly/bomb=0`。
- `book > 1`、`explored` 含非法楼层、段数不足，一律判坏档返回 `null`。
- 实测：21 层 13×15 通关存档 **1025B**（v0.7 是 569B），`SAVE_LIMIT` 从 1024 放宽到 **4096**；`HANDHELD_SAVE_LIMIT = 128` 保留作真机参考线。

### H.7 视口裁剪与相机（附 E.2 结论作废）

- 195 个 `.cell` **全部创建、生命周期内不增删**，`.viewport` 固定 196×252px（7×9 格）`overflow: hidden`。
- `.grid` / `.fx-layer` 按 `translate(-camX*28px, -camY*28px)` 整体位移，`camX/Y` 由 `state.x/y` 派生并 clamp 到边界。
- **相机不进存档**：纯表现层，读档后按当前坐标重算，不占一个字节。
- 点击坐标不用换算：`transform` 不改变事件目标，`.cell.dataset.i` 仍直接给出 `y*13+x`。
- 缩放新增 **0.5×**：`device.style.zoom`，228px 宽的手环壳缩到 114px，用于一眼看整体观感；1× 才是设计基准。

### H.8 验证结果

| 校验 | 断言 |
| --- | --- |
| `node tools/validate_logic.mjs` | **314 项**（含可走/实体判定、blockEntities 绕路、图鉴/NPC/商店、explored、v3 存档与 v2/v1 兼容） |
| `node tools/validate_assets.mjs` | **76 项**（含图鉴/法师/盗贼精灵与 tileMap） |
| `node tools/validate_version.mjs` | **39 项**（含图鉴浮层注入点、viewport 容器、0.5× 档、v3 格式） |
| `node tools/validate_levels.mjs` | **43 项**（含 13×15、viewport<地图、F/I 唯一、房间层守怪） |
| `node tools/browser_check.mjs`（真实 Chromium CDP） | **195 项** |
| **合计** | **667 项全绿，零 JS 异常** |

`browser_check.mjs` 本轮做了一次结构性改写：**不再把地图坐标写进断言**。旧版写死 (1,7)/(2,7)/(3,7) 等格子，
地图一改就整片变红、掩盖真实回归。现在统一在浏览器里 `import('./logic.js')` 现算「黄钥匙在哪」「哪个怪旁边能站人」
「图鉴在第几层」，坐标全部运行期推导。新增断言覆盖：点远处道具自动走过去领取并停住、领取后该格变地板、
商店对话不把英雄挪到商人格、图鉴未持有/持有两态、0.5× 实际渲染宽度、相机把英雄保持在视口内。

### H.9 边界与真机移植待办

- **12ms/格不是真机数据**：195 格整表 diff 的真机耗时仍未实测，`§8` 的降级路径（先收窄到 5×7）依然有效；
  相机 `translate` 在 Vela 上要换成 `style.transform` 或直接改 `left/top`，需真机确认哪种不触发全量重排。
- **图鉴浮层**是真 DOM 浮层，Vela 静态组件树里要改成「预留槽位 + 显隐切换」，不能动态 `createElement`。
- **0.5× 只是浏览器调试档**，真机没有 `zoom` 等价能力，移植时删掉即可。
- 存档 v3 比 v2 多 456B，128B 参考线在真机上更吃紧，附 D 的位图压缩方案需要把 `explored` 也一起编码。
- 附 F 的「点击格子移动」交互口径被本轮**部分取代**：点击仍然自动寻路，但实体不再可穿越，交互需要主动点。

---

## 附 I：真机 M2 开工清单（合并版，2026-11-11）

> **本附录是解冻真机时的唯一开工清单。** 附 D.8（5 层 110 步口径）、附 E.8（10 层 220 步口径）、
> 附 G.7（v2 单槽口径）、附 H.9 的分散条目**全部按此处重写**，那些旧段落保留作历史快照、不再维护。
> 所有数值以**在线版 v0.8.0 的实际状态**为准：21 层、单层 13×15 = 195 格、通关策略 1432 步、
> 存档 v3 通关态 1025B、`SAVE_LIMIT=4096`。
>
> **前置状态**：手环端 `mota-lite/` 仍整体冻结，以下每一条都**尚未执行**；
> 标注「**无真机数据**」的项一律保持未知，**不得编造结论**（沿用附 C 以来的纪律）。

### I.1 逻辑层与配置层对齐（先做，纯 PC 可验）

1. 以在线版 `logic.js` / `tables.js` / `texts.js` / `solver.js` / `records.js` 为准，重新对齐 `mota-lite/src/common/`。
   在线版自 v0.4 起有意分叉（附 D.1），M1 的 3 层 / 26 步基线**不要直接沿用**。
2. M1 的 `validate_tables.js` / `validate_view.js` / `solver.js` 断言按 **21 层 / 1432 步 / 13×15** 重写。
3. `mota-lite-skeleton/` 是过时初版（未同步附 C 的 5 处修正），**不拿来继续开发**。

### I.2 存档：128B 约束必须重新设计（最大的硬门槛）

- 现状：v3 通关态 **1025B**，head 14 字段 + `opened` 变更集 + `explored` 段；`@system.storage` **128B 参考线**（附 C）在 v0.8 下缺口更大。
- 附 D.3 的位图 base64url 方案是按「63 格 / 5 层」算的，**已不适用**：现在单层 195 格、21 层，且 `explored` 也要编码。
- 需重新定方案：① 实测 Vela `@system.storage.set` 真实上限（**无真机数据**，快应用官方未写上限）；
  ② 若确为 128B，`opened` 改「每层 195 bit 位图 + base64url」，`explored` 压成 21 bit 位掩码，head 用变长整数；
  ③ 不用 `BigInt`（轻量穿戴 JS 引擎未必支持），用 `Uint8Array` + 自实现 base64url。
- `deserialize()` 的 v3 / v2 / v1 三档兼容要跟着重写，回归断言同步补。

### I.3 表现层降级评估（依赖真机，全部**无真机数据**）

| 在线版能力 | Vela 上的处理 | 状态 |
| --- | --- | --- |
| 195 格整表 diff | 实测耗时；卡则按 §8 降级到 5×7 视口窗口或减少 `text` 层 | **无真机数据** |
| 相机 `translate()` | 换成 `style.transform` 或直接改 `left/top`，需真机确认哪种不触发全量重排 | **无真机数据** |
| 图鉴浮层（动态 `createElement`） | 改成「预留槽位 + 显隐切换」，静态组件树不能动态建节点 | 待实现 |
| 二次确认弹窗（DOM `hidden` / 遮罩） | 自绘一套浮层；Enter / Esc 映射回 `swipe` 或实体键 | 待实现 |
| 战斗动画 / 打字机剧情弹层 / Web Audio 12 音效 | 按性能预算降级或裁剪（M1 `index.ux` 无这些能力） | 待评估 |
| `device.style.zoom` 的 0.5× 档 | Vela 无等价能力，**移植时删掉**（纯浏览器调试档） | 直接删 |
| `@swipe` 四方向 | 212 宽胶囊屏灵敏度实测；误触多则加 4 个 `@click` 方向按钮兜底 | **无真机数据** |

### I.4 manifest 定稿

`mota-lite/src/manifest.json` 的 `versionName` / `versionCode` 与 `package` 占位（`com.yourname.motalite`）**仍未定稿**，与在线版 `version.js` 的单一真源尚未联动。

### I.5 M2 全套验证（依赖 I.1~I.4）

AuthKey 打通 → Build `.rpk` → 装真机 → AIoT-IDE 模拟器四方向 `swipe` → 全程不息屏 →
**切走再回来读档正确**（长流程关键项）→ `@system.storage` 回调签名 → 战斗 / 开门 / 通关振动且不连振（逻辑层已节流，真机未验）。

### I.6 解冻前的一句话结论

在线版是**浏览器试玩版，不是 `.rpk`**，也不能替代手环端；上面每一项都还没有真机数据。
真机仍按用户要求暂缓，本清单只负责让解冻当天不必再从四份历史快照里翻旧数值。

---

## 附 J：主题深度与难度曲线调研（v0.8.1 探针，2026-11-11）

> **本附录是调研与方案，不是已落地功能。** 用户批复「做 ①②③」，其中 ③ 属高风险数值重构，
> 按既有约定「先出方案 + 隔离探针实测，确认后再落正式配置」执行：本轮**没有改动**
> `levels/levels.json` / `make_levels.py` / 任何运行时数值。探针产物在
> `/root/.codebuddy/artifact/2f8a7d30-.../probe_v9/`（`gen.py` 生成候选、`eval.mjs` 回放评估）。

### J.1 已确认的三个真实根因（不是猜测，全部实测）

| # | 现象 | 实测证据 | 根因 |
| --- | --- | --- | --- |
| 1 | **战斗系统全程失效** | 通关回放 50 场战斗、**100% 零伤**、累计掉血 **0**，连魔王都没掉血 | `calcBattle()` 用 `monPerHit = max(0, mon.atk - hero.def)`。全塔投放 `ATK+168 / DEF+204 / HP+3800`（`make_levels.py` 每层固定 2 个成长道具），通关态 `DEF240`，而最强怪魔王 `ATK36` → 相减恒为 0 |
| 2 | **主题名没接进运行时** | `levels.json` 每层都有 `theme`（潮湿石厅 / 商队歇脚…），但 `app.js` 从头到尾只读 `FLOORS[].name`（"1F"/"2F"） | `renderHud()` / `codexSub` / `iPos` / 载入日志全部用 `f.name`；`theme` 字段生成后**从未被消费**。玩家看不到主题 |
| 3 | **主题没有体现在内容上** | 全塔 53 只怪里史莱姆 22 / 蝙蝠 25（**89%**），骷髅兵 5（全在房门口），**暗法师 0 只**；21 层主路怪组合几乎完全相同 | `place_entities()` 把主路怪写死 `weak = ['1','2']`；21 个 `theme` 只是字符串，不影响地形 / 怪物 / 道具投放 |

问题 1 比历史快照里写的「后期难度趋平」严重得多：不是趋平，是**从第 1 层到魔王，战斗从未产生过代价**。
`HP4450 / ATK191 / DEF240` 对魔王 `HP120 / ATK36 / DEF18`：魔王一击杀不死玩家，玩家一回合秒杀魔王。

### J.2 探针设计

- 隔离目录复制 `logic.js` / `solver.js` + `base.json`，`gen.py` 只改配置层（怪物数值表、道具 `effect`、逐层怪种字符、把 `theme` 拼进 `name`），**零逻辑层改动**。
- 复用正式 `build_tables.py` 的 `build()` 导候选 `tables.js`，保证与线上同构；`eval.mjs` 跑真实 `findSolution()` 并逐步 `resolveStep()` 回放，统计逐层掉血、零伤占比、通关态属性、魔王战 `hpCost`、存档体积。
- 所有候选都跑满 21 层、`ended = win`、零 JS 异常，耗时 41~43ms。

### J.3 候选实测对照

| 候选 | 做法 | 通关 | 步数 | 通关态 HP/ATK/DEF | 零伤占比 | 累计掉血 | 有掉血层 | 魔王战掉血 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **base** | 现状 v0.8.0 | ✅ | 1432 | 4450 / 191 / 240 | **100%** | 0 | 0 | 0 |
| **A** | 只做分层投放 + 主题接线，不动数值 | ✅ | 1432 | 4450 / 191 / 240 | 100% | 0 | 0 | 0 |
| **B** | 道具砍到 4 成 + 温和提怪 | ✅ | 1432 | 4422 / 79 / 99 | 96% | 28 | 2 | 0 |
| **C** | 道具减半 + 中等提怪 | ✅ | 1432 | 4450 / 122 / 151 | 100% | 0 | 0 | 0 |
| **D** | 不削道具，怪 ATK 抬到 DEF 之上 | ✅ | 1358 | **306** / 191 / 227 | **23%** | 4144 | **19** | 198 |
| **E** | 只强化魔王（其余全不动） | ✅ | 1432 | 2710 / 191 / 240 | 98% | 1740 | 1 | 1740 |
| **F** | 道具减半 + 怪提刀 + 分层 | ✅ | 1432 | 3030 / 122 / 151 | 56% | 1420 | 15 | 266 |
| **G** | 按楼层段投放递增强度怪 + 道具减半 | ✅ | 1432 | 2574 / 122 / 151 | 56% | 1876 | 13 | 408 |

**读法**：
- **A / C 无效**：只要魔王 `ATK ≤ 玩家 DEF`，`monPerHit` 恒 0，削道具或分层都救不了魔王战。
- **E 片面**：只在 21F 制造 1740 掉血，前 20 层仍 98% 零伤，等于把整局压成最后一战。
- **D 曲线最好但过陡**：19 层有掉血、零伤仅 23%，但 **1F 就掉 160 血**、通关 HP 只剩 **306**，容错极低，且步数从 1432 降到 1358（solver 绕开了打不过的怪，说明有怪变成了「拦路虎」而非「可选项」）。
- **F / G 是可接受的折中**：G 呈 6F / 12F / 21F 三阶梯，比 F 的单调解更有层次；但 17~20F 仍归零。

### J.4 纯配置层的天花板（关键结论）

`monPerHit = max(0, mon.atk - hero.def)` 里，**怪 ATK 是全局常量、玩家 DEF 单调增长**，
所以任何「固定怪表 + 固定道具」的组合，掉血曲线必然**随层数递减**（F / G 都验证了：前段高、后段归零）。
要把曲线做成「越往上越吃力」，只有三条路：

| 路径 | 改动面 | 代价 |
| --- | --- | --- |
| ① 分层怪表（按楼层段给同一字符不同数值） | `tables.js` 结构 + `monsterByCh(ch, floor)` + `calcBattle` 签名 + 图鉴 / 战斗预览 / 全部战斗断言 | 中高，牵动逻辑层纯函数 |
| ② 逐层怪物缩放系数（配置层加 `floorScale[]`，`calcBattle` 乘一下） | `levels.json` 加一段 + `calcBattle` 一处乘法 | **较小**，且配置层驱动、可回归 |
| ③ 改战斗公式（比例伤害 / 保底伤害） | `calcBattle` + 全部 21 层数值重标定 | 高，等于重做战斗系统，用户明确反对过度设计 |

**推荐 ②**：在 `levels.json` 增加 `floorScale`（21 个数，随层递增的怪物 HP/ATK/DEF 倍率），
`calcBattle(hero, mon, floor)` 读它做缩放。配置层驱动、单点改动、能用现有 solver 全量回归，
也顺带解决「5 种怪全局共享」的问题 —— 同一只史莱姆在 1F 和 18F 可以危险程度不同。

> ⛔ **本节的「待确认 / 三选一 / 待拍板」已作废（v0.9.0）**：见附 K，数值与机制已全部落地。以下保留作调研快照。

### J.5 待确认的落地方案（确认后再写代码）〔历史快照，已由附 K 落地〕

**第 1 步（低风险，可立即做）**：主题接线。把 `theme` 拼进 `FLOORS[].name`（或 `renderHud()` 显示 `name + theme`），
让 21 个主题名真正出现在 HUD / 图鉴副标题 / 载入日志。注意 `hudFloor` 是固定宽度 span，
长主题名可能要截断或改字号；`browser_check.mjs` 里 `HUD0` 与若干 `includes('1F')` 断言需同步。

**第 2 步（中风险）**：分层投放。改 `make_levels.py` 的 `place_entities()`，按楼层段替换主路怪字符，
让骷髅兵 / 暗法师真正进场，每个主题层有可辨识的怪物组合。需重跑 `flood_ok()`、全套回归与存档体积实测。

**第 3 步（高风险，需先拍板数值）**：难度曲线。三选一：
- **J.5-a 只接线 + 分层**（不动战斗数值）：修好问题 2/3，问题 1 保留，零风险；
- **J.5-b 配置层 G 方案**：道具减半 + 分层怪 + 魔王强化，零伤 100%→56%，魔王战掉 408 血，**不动逻辑层**；
- **J.5-c 加 `floorScale`（推荐方向）**：能做出递增曲线，但要动 `calcBattle` 与图鉴/预览/断言，需先定 21 个缩放系数。

**待你确认**：选 a / b / c？若选 c，我下轮先出 21 层缩放系数表 + 探针曲线，再动正式配置。

### J.6 本轮实际落地清单（与方案区分）

- ✅ #33 补房间 NPC 端到端回归（`browser_check` 195 → **210** 项）
- ✅ #34 文档作废标注 / 附 I「M2 开工清单」合并 / 三个 `.bak` 归档到 `tools/_bak/`
- ✅ #35 图鉴口径改为「本层所有怪物类型 + 已清除置灰」（`browser_check` 210 → **217** 项）
- ✅ #36 本附录：三个根因 + 8 组候选探针实测 + 落地方案与待确认项
- ⏸ **未改（当时）**：`levels/levels.json`、`make_levels.py` 的数值、战斗公式、主题接线（待 J.5 拍板）—— **⛔ 已在 v0.9.0 / 附 K 全部落地**

---

## 附 K：在线版数值完整化与经典魔塔机制（v0.9.0，2026-11-11）

> **当前阶段以本附录为准**，取代附 J.5 的「待确认 / 三选一 / 待拍板」状态。
> 触发：用户原话「数值也做完全吧，另外可以参考网上的魔塔游戏机制补全」。
> 范围：在线试玩版 `/workspace/mota-lite-web/`。真机 M2 继续暂缓（清单见附 I）。

### K.1 为什么必须改（沿用附 J.1 的实测根因）

v0.8.1 的探针已证明：通关回放 50 场战斗 **100% 零伤**，不是「难度趋平」而是战斗系统全程失效。
根因是 `calcBattle()` 的净伤 `max(0, 敌ATK - 我DEF)` 相减结构，而怪 ATK 是**全局常量**
（史莱姆 8 / 蝙蝠 14 / 魔王 36），玩家 DEF 却从 1F 的 10 单调涨到 21F 的 240 —— 从第 3 层起
敌 ATK 永远小于我 DEF，净伤恒为 0。联网调研确认当前战斗公式
`rounds = ceil(敌HP / (我攻 - 敌防))`、玩家先手只承受 `(rounds - 1)` 次反击、净伤 `max(0, 敌攻 - 我防)`
与经典 21/24/50 层魔塔**完全一致**，因此**不改公式，只改数值投放**。

### K.2 落地方案：`FLOOR_SCALE` 逐层强度曲线

链路：`levels/levels.json`（唯一编辑源）← `tools/make_levels.py` 生成 ← `tools/build_tables.py`
导出 `tables.js`（运行时唯一 import）。新增 `floorScale` 段，21 组「本层标准怪」数值：

| 字段 | 含义 |
| --- | --- |
| `hp` / `atk` / `def` | 本层标准怪的 HP / 攻 / 防，运行时按怪种权重派生 |
| `targetLoss` | 本层目标总损血，用于摊薄每只怪的净伤 |
| `mobs` | 本层实际怪数（分层投放后现算） |

生成参数（`make_levels.py` 的 `CURVE_CFG` / `CURVE_A` / `CURVE_D`）：

```py
CURVE_A = [23, 23, 26, 42, 52, 55, 58, 81, 91, 91, 97, 110, 133, 133,
           136, 149, 162, 162, 178, 191, 191]   # diag.mjs 实测每层首次进入时玩家 ATK
CURVE_D = [20, 43, 46, 56, 76, 92, 95, 103, 113, 126, 132, 135, 155, 178,
           181, 181, 201, 217, 230, 240, 240]   # 同上，玩家 DEF
CURVE_CFG = dict(loss0=24, lossK=2.4, rounds=3, defGap=6, atkFloor=16)
BOSS_FINAL = {'hp': 950, 'atk': 300, 'def': 56}
```

`build_floor_scale(cnt)` 每层按 `floor_loss = loss0 + lossK*f` 定目标损血，除以本层怪数摊薄，
再反推 `atk = max(pd + defGap, atkFloor + 4*f) + mph`、`def = max(0, pa - per_hit)`、
`hp = (rounds-1)*per_hit + 1`。最后一轮离线校验暴露的两个真问题都在生成器里修（不放宽断言）：

- **ATK 前缀最大值钳制** `atk = max(atk, out[-1]['atk'])`：否则 `mph` 按 2/3 交替的怪数摊薄，会让 20F `263` > 21F `258` 出现回落；
- **怪种轮替起点随层号错开** `pool[(k + fi) % len(pool)]`：否则每层只有 2 只主路怪，三怪种 pool 的第 3 项永远取不到，石头人 `6` / 魔法警卫 `8` 会缺席。

运行时 `logic.js` 的 `scaledMon(mon, floor)` = `FLOOR_SCALE[floor] × {hpW, atkW, defW}`；
`solver.js` 两处 `calcBattle(s.hero, mon)` 同步改为带 `s.floor`，保证**求解器与运行时战斗判定同源**。

**实测曲线**（ATK 逐层不回落）：
`55, 56, 69, 87, 106, 107, 119, 126, 143, 149, 149, 174, 193, 201, 201, 222, 233, 252, 257, 263, 263`；
1F 标准怪 `33/55/7` → 21F `269/263/57`。

### K.3 怪种 5 → 8 与分层投放

| 字符 | 怪种 | 分工（经典魔塔） | 权重 hpW / atkW / defW |
| --- | --- | --- | --- |
| `1` | 史莱姆 | 入门 | 0.85 / 0.9 / 0.8 |
| `2` | 蝙蝠 | 入门 | 1.0 / 1.0 / 1.0 |
| `4` | 骷髅兵 | 进阶 | 1.1 / 1.05 / 1.1 |
| `6` | 石头人 | **高防低血，破防博弈** | 0.7 / 0.85 / 1.7 |
| `7` | 兽人 | 高攻 | 1.15 / 1.15 / 0.9 |
| `5` | 暗法师 | **pierce 真实伤害，无视 DEF** | 0.9 / 0.16 / 0.8 |
| `8` | 魔法警卫 | **pierce 真实伤害，无视 DEF** | 1.0 / 0.20 / 1.0 |
| `3` | 魔王 | **noScale 独立终局数值** `950/300/56` | — |

`tier_chars(n)` 按楼层段切换：1~5F `['1','2']` → 6~11F `['2','4','6']` → 12~17F `['4','5','7']` → 18~20F `['5','7','8']`。
实测分布 `5:6  6:4  7:6  8:2`（均进场）。**房间开口守怪 `(6,9)` 不参与轮替、保持常规怪种** ——
否则玩家攻击刚过防时要打几十回合，会出现 6F 掉血尖峰（隔离探针实测 642 损血、通关 HP 仅 454）。
`theme` 拼进 `FLOORS[].name`（如 `1F · 潮湿石厅`），HUD / 图鉴副标题 / 载入日志直接可见。

### K.4 经典魔塔机制补全（联网调研 → 落地）

| 经典机制 | 落地位置 | 说明 |
| --- | --- | --- |
| 固定数值、可预计算战斗 | `calcBattle(hero, mon, floor)` | 公式与经典一致，未改；改为按层取实际数值 |
| 法师真实伤害 | `mon.pierce` + `scaledMon` | 净伤直接取敌 ATK，`max(0, ...)` 不适用，堆防无效 |
| 怪物手册（临界 / 加防收益） | `battleHint()` + 图鉴 / 战斗预览徽章 `title` | 「再 +N 攻少挨一回合」「每 +1 防少掉 N HP」；pierce 怪加防收益恒为 0 |
| 商店攻 / 防 / 生命三选一 | `SHOP_GOODS` / `shopOffer()` / `shopTier()` / `shopBuy()` | 固定价 20G，按 7 层一档递增回报（经典 50 层「高楼层同价回报更好」）；不新增存档字段，读档后按当前层派生 |
| 石头人破防 | `m6` 高 `defW` 低 `hpW` | 攻击不足时判 `unbreakable`，须先取剑 / 宝石 |
| 高防 Boss 门槛 | 魔王 `noScale` | 裸装 `calcBattle` 返回 `unbreakable`（A10 < DEF56），必须收成长道具 |

图例（启动时静态构建）原先写死「未缩放兜底」基础数值（1F 史莱姆显示 `20/8/2`，实际 `28/50/6`），
会与战斗预览 / 图鉴冲突，本轮改为只列怪种与分工、分组标题注明「数值逐层变化，见图鉴」。

### K.5 正式工程端到端回放实测（不是隔离探针）

用真实 `findSolution()` + `resolveStep()` 回放，从 `newGame()` 逐步打到通关：

| 指标 | 结果 |
| --- | --- |
| 结局 / 步数 | `win` / **1432 步**，未阵亡，最低 HP 200 |
| 通关属性 | HP684 / ATK191 / DEF240 / G961 / 图鉴已持有 |
| 战斗 | **50 场**，零伤 **2 场（4.0%）** —— 均为一击必杀（`rounds=1` → 0 次反击），符合先手公式；v0.8.1 为 100% 零伤 |
| 逐层掉血 | **21 / 21 层全部掉血**，每层 69~279，终局魔王战 420，总损血 **3766** |
| 魔王战 | 掉 420 HP，`ok:true`；裸装冲魔王 `unbreakable` |
| 存档 | 通关态 **1024 B** / `SAVE_LIMIT=4096` |

### K.6 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `tools/make_levels.py` | 新增 `CURVE_A/D/CFG`、`BOSS_FINAL`、`tier_chars()`、`retier_monsters()`、`count_mobs()`、`build_floor_scale()`；8 怪表 + 权重 / `pierce` / `noScale`；theme 接线；`meta.schema=3`、新 `floorScale` 段 |
| `levels/levels.json` / `tables.js` | 重新生成，新增 `FLOOR_SCALE`（21 组） |
| `tools/build_tables.py` | `REQUIRED` / `SECTIONS` / `HEADER` 支持 `FLOOR_SCALE` |
| `logic.js` | `scaledMon()`、`calcBattle(hero, mon, floor)`、`battleHint()`、商店三选一（`SHOP_GOODS` / `shopOffer` / `shopTier` / `shopBuy`）、`CONFIG.SHOP_TIER_*` |
| `solver.js` | 两处 `calcBattle` 带 `s.floor` |
| `app.js` | 战斗预览 / 图鉴显示本层实际数值 + 手册 tooltip + `✦`；商店弹层动态三选一；图例口径修正 |
| `texts.js` | `monsterDesc` 扩到 m1~m8、`shopGoods`、`codexSub`、帮助规则补经典公式与商店说明 |
| `tools/gen_assets.py` | 新增 `m6/m7/m8` 精灵帧与 `TILE_MAP`（38 帧）；`manifest.json` 版本同源 `0.9.0` |
| `tools/validate_logic.mjs` / `validate_levels.mjs` | 重写战斗公式断言，新增曲线单调 / 分层怪种 / 主题 / 手册 / 商店断言 |
| `tools/browser_check.mjs` | `HUD0` 运行期从 `tables.js` 取（主题接线），商店 2→4 按钮断言，新增 9 项 v0.9 专项 |
| `version.js` | `v0.8.1 → v0.9.0` + CHANGELOG 首条 |

### K.7 验证结果

| 校验 | 项数 | 结果 |
| --- | --- | --- |
| `validate_logic` | 333 | 全绿 |
| `validate_assets` | 78 | 全绿 |
| `validate_levels` | 54 | 全绿 |
| `validate_version` | 45 | 全绿 |
| `build_tables.py --check` | — | 通过（表未落后于源） |
| 真实 Chromium `browser_check` | **226** | 全绿、**零 JS 异常**（v0.8.1 为 217，新增 9 项 v0.9 专项） |
| **合计** | **736** | 全绿 |

### K.8 边界与真机移植待办（M2 仍暂缓）

- 真机 M2 全部（AuthKey / rpk / 模拟器 / 128B 实测 / swipe 灵敏度）继续暂缓，清单见附 I；
  `FLOOR_SCALE` 21 组数值进 `tables.js` 后体积增大，真机移植时须一并评估。
- 多存档槽位、Excel 导表：维持「明确不做」。
- 存档 v3 格式未变（仍 4 段、1024 B），当前仍兼容 v2 / v1 旧档。
- **开发阶段存档约束（用户 2026-11-11 松绑，取代上文「兼容 v2/v1」的隐性前提）**：存档格式允许随版本调整；
  若改格式导致不兼容，**直接放弃旧存档、不写兼容层 / 迁移代码**——开发阶段无真实用户存档需保护。
  本轮核验：v3 的 14 个 head 字段（`floor/x/y`、`hp/atk/def/gold`、三色钥匙、`ended`、`fly/bomb/book`）
  + 变更集 `opened` + 已探索段 `explored` 已覆盖全部运行时状态；商店档位由 `shopTier(floor)` 按**商人所在层**
  派生（商人是地图固定格、非玩家状态），读档后天然一致，本来就不需要新增字段。因此 v0.9「不新增存档字段」
  是配置层驱动的正确设计，**当前没有改格式的必要性**。
  现有兼容痕迹清单（下次改格式时一并清除，不单独发版）：
  `logic.js` `deserialize()` 的 v1/v2/v3 三版本分支与旧档 `explored` 推断（425–479 行）、
  `fly>99` 为旧档历史大值保留的上限（441–443 行）、`app.js` `SAVE_KEY='mota_lite_web_v1'` 刻意不改名（24 行）、
  `archSub` 文案（1114 行）、`validate_logic.mjs` 约 15 项旧档断言（460–504 行）、
  `browser_check.mjs` 导入旧档断言（397–404 行）、`validate_version.mjs` 版本断言（101–102 行）。
  **未来真正会触发改格式的场景**：① 商店改为经典「按购买次数递增价格 / 回报」→ 须存 `shopCount`；
  ② 真机 M2 解冻恢复 128B → 变更集改位图 base64url（附 D.3）；③ 成就 / 累计统计落档、多槽位（当前明确不做）。
- 逐层曲线目前由 `CURVE_CFG` 单组参数驱动；若要微调难度，只需改 `make_levels.py` 参数并重跑导表 + 全套校验，
  **逻辑层零改动**（配置层驱动）。

---

## 附 L：设置存盘与门回归经典魔塔（v0.10.0，2026-11-11）

> **当前阶段以本附录为准**，取代附 K「存档 v3 未改 / 开发阶段约束」之外的待办表述。
> 触发（用户原话）：「设置需要能存盘，比如我关了音效，刷新浏览器之后进游戏应该还是关闭音效的状态；
> 你布置的门完全没起到作用啊，感觉就是随便摆的，门应该能阻挡玩家进入房间才对，其它作用参考原版魔塔」。
> 范围：在线试玩版 `/workspace/mota-lite-web/`。真机 M2 继续暂缓（清单见附 I）。

### L.1 设置存盘（本机偏好，不进游戏存档）

改动前：5 项表现层设置全是内存变量 —— `app.js` 的 `spriteMode / animOn / soundOn`（49 行）、
`speed`（46 行）、缩放只写 `deviceEl.style.zoom`（934 行），**刷新一律回到默认值**。

落地：新增独立 key `mota_lite_web_settings_v1` 与 `loadSettings() / saveSettings() / applySettings()`，
持久化 `{sprite, anim, sound, speed, zoom}`；`normalizeSettings()` 用白名单 + 类型校验兜底坏数据
（`SPEEDS` / `ZOOMS` 白名单，非法值回落默认）。冷启动在 `injectTexts()` 末尾调用
`applySettings(loadSettings())`，一次同步内存变量、工作台三个按钮、设置浮层、`#speedInfo` 与
`deviceEl.style.zoom`；`setSpeed()` 本身不写盘，避免冷启动凭空产生设置 key。

设计取向：设置是**本机偏好**而非**游戏进度**，故与 `SAVE_KEY` / `RECORD_KEY` 并列第三个 key，
不进 `serialize()` —— 导入 / 清除 / 覆盖存档都不影响音效开关，回放也不写它。
音效关闭时 `playSfx()` 的 `if (!soundOn ...) return` 守卫保证静音，且不会在冷启动初始化 AudioContext。

### L.2 门为什么「完全没起作用」（亲自核验的三层偏差）

| 层 | 现状 | 问题 |
| --- | --- | --- |
| 生成器 | `make_levels.py` 第 14 行「门 1 道（开放区，可绕行；不阻断主路）」、216 行 `door = ['Y','B','R'][floor_no % 3]; take()` | 门随机撒在开阔地，绕一下就过 |
| 房间结构 | `room_rect()` 唯一开口 `(6,8)` 是 `.`，`(6,9)` 放守怪 | 房间门口没有门，守怪不等于门 |
| 寻路 / 交互 | `app.js` 注释「有钥匙的门仍可穿越，否则进房间要反复点门」；`solver.js` `if (blockEntities && isEntityTile(ch) && !need) continue` | 门被排除在阻挡之外；每层三色钥匙各一 ⇒ 玩家点房间内部时寻路直接穿门 |

联网核对经典 21/24/50 层魔塔的门规则：**黄/蓝/红门对应三色钥匙、开门消耗 1 把钥匙、
门是不可绕行的障碍**，用来保护房间内资源或通往深处的必经路，门开后不复原；红门常是通向 Boss
或关键道具的必经门。进阶形态（铁门、需道具撞出的暗门）本次未引入。

### L.3 落地方案：门封「唯一入口」，三色按层段分级

| 层类型 | 门位置 | 阻挡什么 |
| --- | --- | --- |
| 房间层 9 层（2/4/6/8/11/13/15/17/19F） | 房间唯一开口 `(6,8)` | 房内宝物 / 商人 / 法师 / 盗贼 / 图鉴 / 飞行器；门外 `(6,9)` 守怪保留 |
| 开放层 11 层 | 封住上楼 `U(11,13)` 的另一邻格，门成为 `(10,13)` 或 `(11,12)` 唯一入口 | 上楼 |
| 顶层 21F | 红门 `(6,6)`，`(5,5)/(7,5)` 砌墙 | 决战魔王 / 王座 |

`door_char(n)`：黄 1~7F / 蓝 8~14F / 红 15~21F，正好对上主题名 12F「蓝门之后」、16F「红门厅」。
每层仍投放三色钥匙各一（保留既有断言），门必定可开；`DOOR_KEY` 映射不变，门精灵 `door_y/door_b/door_r`
三帧本来就有，资源层零改动。

**生成器踩坑**：上楼 U 只有两个可走邻格，封哪一侧不能写死 —— 14F 的随机短内墙
`(7,12)(8,12)(9,12)` 加上封 `(10,13)` 会把 `(8,13)(9,13)` 困成孤岛，`flood_ok` 直接失败。
最终改为**两种封法都试、取 `flood_ok` 通过的那一种**，门始终是上楼唯一入口但位置随该层随机墙自适应。
另把门口通路格 `(11,11)(10,12)(10,11)(11,10)` 加入 `candidate_pool.protected` 与内墙排除集，
保证门口有可站格可点击。

为把回归面压到最小，`place_entities()` 里仍 `take()` 消耗一个候选坐标但不放门（门改由 `make_floor`
固定放置），使其它实体 / 暗格坐标与 v0.9 完全一致；门不是怪，`count_mobs()` 不变 ⇒
**`floorScale` 与 v0.9 逐项一致**，v0.9 难度曲线未退化。

### L.4 逻辑层：门真正成为障碍

- `solver.js findPath`：`blockEntities` 模式改为 `if (blockEntities && isEntityTile(ch) && !targets.has(nx+','+ny)) continue`
  —— 门与其它实体一律不穿越，只有「目标格本身是这个实体」才允许作为终点；
  **solver 自用模式（不传 opts）语义不变**，有钥匙的门仍可穿过，保证 `findSolution()` 攻略路线不受影响。
- `app.js walkTo`：旧兜底「走不到实体旁边就退回非阻挡模式直接走进目标格」会绕开门，改为
  **只有 `standNextTo()` 返回空集（角落死角）才退回**；路径被门挡住时提示「目标格不可达（可能要先开门）」。
- `logic.js resolveStep` 的开门处理**未改**：扣 1 把对应钥匙 → 门格清成地板 → 继续走进该格 → 发 `save`。
  保留「开门即通过」是刻意选择：若改成经典「开门不移动」，`solver.findPath` 规划出的穿门路径会与实际
  执行错位，属于为改而改的高风险重构。门已通过「必须主动点开 + 消耗钥匙 + 不可绕行」满足核心诉求。

### L.5 隔离探针与正式工程实测（不是只靠断言）

隔离目录复制 `logic.js / solver.js / tables.js` 后跑真实 `findSolution()` 回放，**36 项全绿**：
21 层门结构 / 分级 / 三色钥匙、`floorScale` 与备份逐项一致、门阻挡语义（点击模式门后 U 不可达、
有钥匙也不穿、solver 模式可穿、主动撞门扣钥匙变地板、无钥匙提示缺少钥匙）、通关回放。

| 指标 | v0.9.0 | v0.10.0 |
| --- | --- | --- |
| 结局 / 步数 | win / 1432 | **win / 1372** |
| 门被实际打开 | 0（门可绕行） | **21 次 / 21 层全在主路上** |
| 逐层掉血 | 21/21 | 21/21 |
| 魔王战 | -420HP | -420HP |
| 通关属性 | HP684 / ATK191 / DEF240 | HP779 / ATK191 / DEF240 |
| 通关存档 | 1024 B | 1010 B（限 4096 B） |

步数与战斗场数变化来自门位置改变后 solver 路线重排，不是数值改动：`floorScale` 逐项一致。

### L.6 浏览器回归踩坑（值得记一笔）

新增「关音效 → `Page.reload` → 音效仍关」断言首次跑出 5 项失败，但独立最小 CDP 复现显示
**设置其实恢复正确**。根因是测试脚本时序：`Page.reload` 异步，旧页面上下文的 `#log` 也含「就绪」，
`waitFor` 过早返回，后续断言跑到新页面脚本执行前的初始 DOM 上（`#setSound` 还是占位符「—」）。
修法：reload 前打 `window.__v10ReloadMark = 1`，就绪条件改为
「标记消失 **且** `#titleVersion` 已被 `renderVersion()` 注入」（`renderVersion` 在 `injectTexts` 之后调用），
确保新上下文的 `applySettings()` 确实跑完。这是**测试脚本**的问题，不是产品代码 bug。

### L.7 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `app.js` | 新增 `SETTINGS_KEY / ZOOMS / normalizeSettings / loadSettings / saveSettings / applySettings`；5 个开关 / 速度 / 缩放点击处接 `saveSettings()`；`injectTexts()` 末尾改为 `applySettings(loadSettings())`；`walkTo` 兜底与注释口径修正 |
| `tools/make_levels.py` | 新增 `door_char()`；`place_entities` 不再随机放门；`make_floor` 按层类型封唯一入口 + `flood_ok` 自适应；顶层红门封王座口；`candidate_pool.protected` 与内墙排除集补门口通路；docstring / meta.note / 摘要更新 |
| `levels/levels.json` / `tables.js` | 重新生成（21 层门位置变化；`floorScale` 不变） |
| `solver.js` | `findPath` 的 `blockEntities` 把门也当障碍，注释同步 |
| `texts.js` | `help.rule` 补三色门规则与「设置刷新后仍保持」说明 |
| `tools/validate_logic.mjs` | 修 6.6「U 旁必有可走格」旧断言（改为先开门再换层）；新增第 9 段门结构 / 阻挡 / 开门链路 / 攻略开门次数 / 设置 key 独立 |
| `tools/validate_levels.mjs` | 新增 1c 段：每层 1 门、三色分级、唯一入口、三色钥匙、守门怪仍在门外 |
| `tools/validate_version.mjs` | 新增设置 key / 门阻挡 / 浏览器专项静态断言 |
| `tools/browser_check.mjs` | 新增设置刷新 7 项 + 门阻挡 6 项端到端断言；修 reload 就绪判定 |
| `version.js` | `v0.9.0 → v0.10.0` + CHANGELOG 首条 |
| `assets/manifest.json` | `gen_assets.py` 重跑，同源 `0.10.0`（38 帧精灵 / 12 音效未变） |

### L.8 验证结果

| 校验 | 项数 | 结果 |
| --- | --- | --- |
| `validate_logic` | **350** | 全绿 |
| `validate_assets` | 78 | 全绿 |
| `validate_levels` | **59** | 全绿 |
| `validate_version` | **49** | 全绿 |
| `build_tables.py --check` | — | 通过（表未落后于源） |
| 真实 Chromium `browser_check` | **242** | 全绿、**零 JS 异常**（v0.9.0 为 226，新增 16 项 v0.10 专项） |
| 隔离探针 | 36 | 全绿 |
| **合计** | **778** | 全绿 |

### L.9 边界与后续

- **存档 v3 格式未改**：本轮既没有新增存档字段，也没有动 `deserialize()`；上一轮确立的
  「开发阶段允许改存档格式、不兼容就丢弃旧档、不写兼容层」约束仍然有效，只是本轮无需动用。
- 门采用「开门即通过」而非经典「开门不移动」，理由见 L.4；若日后要做更硬核的钥匙经济
  （按购买次数涨价、商店卖钥匙、开错门卡关），属新玩法，另出 spec。
- 暗门 / 铁门 / 需要特定道具撞出的隐藏门（21 层原版有）本轮未引入。
- 真机 M2 全部继续暂缓；多存档槽位、Excel 导表维持「明确不做」。

---

## 附 M：交互回归经典魔塔「撞一下」（v0.11.0，2026-11-11，历史快照，已由附 N 取代）

> 本附录保留作历史快照。**当前阶段以附 N 为准。**
> 触发（用户原话）：「交互逻辑需要调整一下，比如我走到怪物旁边点击怪物，击败怪物之后我应该是停留在原地才对，
> 而不是走到之前怪物所在的格子；其它物品的交互逻辑也做类似调整，参考原版魔塔」。
> 范围：在线试玩版 `/workspace/mota-lite-web/`。真机 M2 继续暂缓（清单见附 I）。

### M.1 根因：逻辑层单一真源，不是点击链的问题

`logic.js` 的 `resolveStep(prev, direction)` 是「一次输入 = 一次结算」的纯函数，被
`app.js`（点击 / 键盘 / 滑动 / 回放）与 `solver.js`（`findSolution` 通关路线）**共用**。
改动前它的结构是「顺序 if 处理目标格，最后统一落到 `s.x = nx; s.y = ny`」：

```js
// 2. 门：扣钥匙 + 该格变地板        （不 return）
// 3. 怪物：算战斗，胜利扣血加钱 + 清格（不 return）
// 4. 道具 / NPC：applyEffect + 清格  （不 return）
// 4.5 暗格 H：清成地板              （不 return）
// 5. 换层 U/D / 6. 通关 W / 7. 商店 N 各自 return
// 8. 落到目标格：s.x = nx; s.y = ny  ← 上面 2/3/4/4.5 都会走到这里
```

因此**打完怪 / 捡完东西，英雄顺势踩进实体原来那格** —— 就是用户看到的现象。
联网核对经典 50 层魔塔规则：「方向键移动，接触怪物即自动战斗」「走到物品上自动拾起获得」
「碰撞黄/蓝/红门时自动开启」——「撞」这个动作本身是**结算但不进入该格**，
怪物/道具消失后格子变空地，玩家再走一步才进去。故修法是这三个实体交互分支结算后 `return`、
不改坐标，属于**逻辑层单一真源修正，宿主层点击链一行未改**（`app.interact()` 仍发一个方向，
由 `resolveStep` 的新语义自然得到「原地交互」）。

### M.2 改动边界（哪些改、哪些不改，以及为什么）

| 交互 | 改后 | 依据 |
| --- | --- | --- |
| 怪物（含魔王） | **停原地**，怪格清成地板 | 用户核心诉求 + 经典「撞怪自动战斗」 |
| 道具 / NPC（法师/盗贼/图鉴/钥匙/宝石/血瓶/飞行器/炸弹） | **停原地**，清成地板 | 用户「其它物品也做类似调整」 |
| 门 `Y/B/R` | 保持**开门即通过**（进入门格） | 门是通道不是物品，原版「碰撞门自动开启」后即通过；附 L 刚做成「封唯一入口 + 主动点开」，改它会破坏该设计 |
| 暗格 `H` | 保持**走上去发现** | H 是 `WALKABLE` 可走格、视觉与地板一致，靠踩上去触发，不是「点实体交互」 |
| 楼梯 `U/D` | 保持**换层**（落点移动） | 换层语义本来就是移动 |
| 王座 `W` | 保持**通关**（进入 W 格） | 结束态，且 W 是可走格 |
| 商店 `N` | 保持**不移动**（只对话） | v0.8 起本就 `return` 不移动 |

战斗分支 `return` 前补上 `if (s.hero.hp <= 0) { s.ended='dead'; ... }` —— 原来这个判定在
末尾「落到目标格」之后，若直接 `return` 会漏掉，属于同步迁移而非新增机制。

### M.3 宿主层必须同步修的隐藏回归（`moved` 依赖）

`app.js` 的 `step()` 原先用 `moved`（坐标变化）判定「发生了交互」：

```js
const moved = state.x !== before.x || ...
const battleWon = !!beforeMon && moved && events.some(t => t.startsWith('胜 '))  // ← 依赖 moved
if (hidden && moved) queueStory(...)        // 飞行器 / 炸弹 / 暗格 / 商店剧情同样依赖
```

交互改为不移动后 `moved === false`，会导致**战斗音效、战斗动画、道具剧情全部丢失** ——
这是比坐标更隐蔽的回归。修法：

```js
const battleWon = !!beforeMon && events.some(t => t.startsWith('胜 '))     // 按胜利事件判定
const interacted = r.events.some(e => e.t === 'save' || e.t === 'vibrate')  // 交互都发 save
const progressed = moved || interacted                                       // 剧情触发改用它
```

战斗 dash 特效 `showBattleFx(sx, sy, tx, ty)` 本就是「从英雄格冲向怪格再弹回」的
`--dx/--dy` 动画，不依赖英雄真的走过去，改后「撞一下停原地」反而更贴切。

### M.4 solver 为什么零改动

`solver.findSolution()` 用 `findPath(s, targets)`（不传 `blockEntities`）规划「穿过实体格」的
策略路线，再逐步 `resolveStep` 回放，每步有：

```js
if (s.floor + ',' + s.x + ',' + s.y === before) break   // 坐标没变 → 本段结束，外层重新 scan
```

交互后坐标不变会触发这个 `break`，但**恰好是安全的**：该实体已清成地板，
外层重新 `scan` 时不再列为目标，于是重新规划到下一个目标（含「再走一步进入空格」）。
隔离探针把上限放宽到 `8000/3000` 量出真实消耗为 **1456 步 / 259 轮**，
远低于原上限 `2400/500`；把上限改回原值重跑仍 21 项全绿通关 —— 故 `solver.js` **逻辑零改动**，
只在注释里说明「交互不移动 → 重新规划」是预期行为。回归面压到最小。

### M.5 隔离探针与正式工程实测（不是只靠断言）

隔离目录复制 `logic.js / solver.js / tables.js`，改 `resolveStep` 后跑真实 `findSolution()` 回放，
**21 项全绿**：怪物/道具交互后坐标不变、再走一步才进入、门仍开门即进入、通关且 21 层门全开、
21/21 层掉血、魔王战 -420HP、存档 1025B。

| 指标 | v0.10.0 | v0.11.0 |
| --- | --- | --- |
| 结局 / 步数 | win / 1372 | **win / 1456**（多 84 步 = 每个实体交互后重新规划 + 再走一步进空格） |
| 交互后英雄位置 | 踩进实体格 | **停在相邻原地** |
| 逐层掉血 | 21/21 | 21/21 |
| 魔王战 | -420HP | -420HP |
| 通关属性 | HP779 / ATK191 / DEF240 | HP504 / ATK191 / DEF240 |
| 通关存档 | 1010 B | 1025 B（限 4096 B） |
| solver 上限 | 2400 / 500 | 2400 / 500（未触顶，零改动） |

属性/步数变化来自路线重排与多走的步骤，不是数值改动：`floorScale` 未动，难度曲线未退化。

### M.6 浏览器回归：4 条旧断言失效是「口径」不是 bug

诊断跑显示离线四套全绿、真实浏览器 **242 项里恰好 4 项失败、零 JS 异常**：
B 段两条（「领取后英雄停在该道具格」）、NPC 段两条（「英雄最终停在法师/盗贼原格」）——
都是 v0.8 起写死「交互后踩进实体格」的旧断言。修法不是放宽，而是**改成新语义口径**：
从存档读回英雄真实坐标，断言与实体格**曼哈顿距离 = 1**（停在相邻格）、
`posAtPick` 前后一致（不再继续移动）、NPC 停在 `np.sx,np.sy`（交互前的相邻格）。
另追加 6 项 v0.11 真实点击专项：运行期推导 1F 怪物/门坐标 + 导入高属性存档，
真实点击怪物 → 胜利结算 + 停原地 + 清格 → 再点一次才进原格；点击门仍进入门格。

顺手修掉 `texts.js` `help.rule` 里历史遗留的重复句
「战斗沿用经典魔塔的固定数值公式：战斗沿用…」（v0.9 拼接时产生），并补上原地交互说明。

### M.7 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `logic.js` | `resolveStep` 怪物 / 道具(NPC) 两分支结算后 `return` 停原地；战斗分支补阵亡判定 |
| `app.js` | `step()` 的 `battleWon` 改按胜利事件判定、新增 `interacted`/`progressed` 触发剧情；`walkTo`/`interact`/`autoTick` 注释口径同步 |
| `solver.js` | 仅补注释（逻辑零改动） |
| `texts.js` | `help.controls` / `help.rule` 补原地交互说明；修掉重复公式句 |
| `tools/validate_logic.mjs` | 新增第 10 段：怪物/道具停原地 + 再走一步进入 + 门仍进入 + U 换层落点 + 宿主层静态断言 + 通关路线 |
| `tools/validate_version.mjs` | 新增 5 条防漂移静态断言 |
| `tools/browser_check.mjs` | 修 4 条旧断言口径 + 新增 6 项 v0.11 真实点击专项 |
| `version.js` | `v0.10.0 → v0.11.0` + CHANGELOG 首条 |
| `assets/manifest.json` | `gen_assets.py` 重跑，同源 `0.11.0`（38 帧精灵 / 12 音效未变） |

**未改**：`tables.js` / `levels.json` / `make_levels.py`（本轮是纯交互语义，不碰地图与数值）、
存档 v3 格式（`serialize`/`deserialize` 零改动）。

### M.8 验证结果

| 校验 | 项数 | 结果 |
| --- | --- | --- |
| `validate_logic` | **373** | 全绿 |
| `validate_assets` | 78 | 全绿 |
| `validate_levels` | 59 | 全绿 |
| `validate_version` | **54** | 全绿 |
| `build_tables.py --check` | — | 通过（表未落后于源） |
| 真实 Chromium `browser_check` | **248** | 全绿、**零 JS 异常**（v0.10.0 为 242，新增 6 项 v0.11 专项） |
| 隔离探针 | 21 | 全绿 |
| **合计** | **812** | 全绿 |

### M.9 边界与后续

- **存档 v3 格式未改**：本轮只改交互语义，`opened` 变更集照旧，兼容 v2/v1 旧档；
  上一轮确立的「开发阶段允许改存档格式、不兼容就丢弃旧档」约束仍然有效，本轮无需动用。
- 门维持「开门即通过」而非「开门不移动」，理由见 M.2 / 附 L.4；若日后要做更硬核的
  钥匙经济或把门也统一成「撞一下停原地」，属新玩法，另出 spec。
- 暗门 / 铁门 / 需要特定道具撞出的隐藏门（21 层原版有）本轮未引入 —— **⛔ 已在 v0.12.0 / 附 N 全部落地**（暗门 A、铁门 G、钥匙经济）。
- 真机 M2 全部继续暂缓；多存档槽位、Excel 导表维持「明确不做」。

---

## 附 N：大字号适配手环屏 + 暗门/铁门/钥匙经济（v0.12.0，2026-11-12）

> **当前阶段以本附录为准**，取代附 M 的「当前阶段」表述。
> 触发（用户原话）：「期望按钮文本尽量大一点，用来适配手环的屏幕，其它文本也尽量大一点；
> 原版的暗门/铁门/钥匙经济也考虑加入吧」。
> 范围：在线试玩版 `/workspace/mota-lite-web/`。真机 M2 继续暂缓（清单见附 I）。

### N.1 联网核验：经典魔塔里这三样到底是什么

不照搬记忆，本轮重新检索了 50 层魔塔道具/暗墙攻略与 21 层暗门攻略，得到的可落地口径：

| 经典机制 | 原版表现 | Lite 化口径 |
| --- | --- | --- |
| 三色钥匙 / 门 | 黄、蓝、红钥匙开对应色门；「三黄门」「出来需要消耗三把蓝钥匙」这类加厚门要一次掏多把 | 普通门 1 把；**铁门 G 一次消耗 3 把黄钥匙**（`DOOR_COST`） |
| 暗墙 / 暗门 | 5F 假墙取铁剑、9F 暗墙取铁盾、19F 十字暗墙取十字架、16F 右下暗墙取圣水；**墙体和普通砖墙无视觉差别，只能靠主动撞墙显形**，墙后藏宝物/钥匙，部分还需前置条件 | **暗门 A**：色块与精灵都复用 `wall` 帧，主动撞墙才显形，墙后奖励由 `SECRET` 表给出，格子清成地板，英雄停原地 |
| 钥匙经济 | 商人卖黄钥匙（1F 1000G）、卖蓝钥匙（15F 200G）、回收黄钥匙（28F 100G/把）；「每一把黄钥匙都要留给通往高层的必经通道」 | 商店第 4 项 **20G 补 1 把黄钥匙**；地图三色钥匙 + 暗门黄钥匙 + 盗贼救出 +3，形成攒 / 花 / 买闭环 |

引用来源为攻略站文字（03737 魔塔 50 层道具说明、乐单机暗墙道具表、TapTap 经典模式通关攻略、简书/卷当网 21 层暗门流程）；部分站点对同一机制描述略有出入，故只取「撞墙显形」「加厚门多把钥匙」「商人买卖钥匙」这三条稳定共识，不引入十字架交付、冻结岩浆、对称飞行器等需要大改地图的支线。

### N.2 字号：布局先给宽度，再谈字号

212×520 手环屏物理尺寸很小，9~12px 在真机上基本不可读。约束是**屏幕内 7 个道具按钮 + HUD 8 段信息都是固定槽位**，不能靠换行解决，所以先改布局再放大字号：

| 元素 | v0.11 | v0.12 |
| --- | --- | --- |
| `.action-bar` | 4 列 × 2 行（41px 宽 / 27px 高），按钮 9px | **3 列 × 3 行（56px 宽 / 29px 高）**，按钮 **14px** |
| HUD | 2 行、12px、楼层名和 HP/A/D 挤在同一行 | **3 行**：楼层名 15px / HP·攻·防 14px / 三色钥匙·金币 13px |
| 纵向排布 | HUD 56 / viewport 92 / tip 352 / 按钮区 402 | HUD 50 / viewport 108 / tip 360 / 按钮区 402（总高 514 < 520，实测无溢出） |
| 格子字形 / 提示条 | 13px / 12px | **16px / 15px** |
| 弹层文本 | 9~13px | 剧情正文 14px（可滚动 + 打字机跟随）、设置/图鉴/确认按钮 15px、标题 17px、结束页 28~30px |
| 右侧工作台 | 11~13px | 12~16px |

`story-card` 加到 460px 高、正文 `max-height:160px; overflow-y:auto`，并在 `app.js` 打字机里跟 `scrollTop = scrollHeight`，避免 14px 放大后长剧情被裁掉半截。校验用真实 `getComputedStyle`（19 处文本下限断言），不是只读 CSS 文本。

### N.3 暗门 / 铁门 / 钥匙经济：配置层优先，逻辑层最小改动

**生成链**：`make_levels.py` 新增 `IRON_FLOORS = {7,14,21}`、`SECRET_REWARD`、`add_secret()`；
`flood_ok()` 把 `A` 视作墙（`WALL = '#A'`），所以暗门在生成阶段完全等价于墙，**连通性结论与不放暗门时一致**。
`add_secret()` 优先挑现成内部墙，找不到就在普通地板上砌 1 格并 `flood_ok` 校验；
`secret_forbidden()` 排除房间墙（x3..9 / y3..8）以及门/楼梯/王座/出生点的曼哈顿距离 2 邻域 ——
撞开暗门会把墙变成地板，若它正好在门旁就会形成第二个入口，附 L 的「门封唯一入口」会直接失效。

`levels.json` 重导：21 处暗门 A、3 道铁门 G（7F/14F/21F），其余层仍按黄 1-7 / 蓝 8-14 / 红 15-21 分级。
`build_tables.py` 新增 `DOOR_COST` 与 `SECRET` 两段 + `secretAt()`；`gen_assets.py` 新增 `door_iron` 帧（39 帧），`'A': 'wall'` 保证像素图模式下也伪装成墙。

**逻辑层**（`logic.js`）：
- 门分支改按 `DOOR_COST[t] || 1` 扣钥匙；钥匙不足时铁门给专属提示「铁门需要 3 把黄钥匙（现有 N 把）」，但仍发统一的 `门已打开` 事件，保证音效/回放统计口径不漂。
- 新增 `t === 'A'` 分支：查 `secretAt()` → `applyEffect()` 结算墙后奖励 → `setTile('.')` → 发 `撞开暗门` + vibrate + save → **return 不移动**（沿用附 M 的「撞一下」语义）。与 H 暗格的区别：H 在地板上、踩到就触发；A 在墙里、不撞永远看不见。
- 商店加第 4 项 `key`：`shopOffer('key')` 固定 1 把 / 20G（不随楼层档位加量），`shopBuy` 走 `hero.keys.y += 1`。

**宿主层**（`app.js`）：`step()` 接 `secretAt` 剧情与 `hidden` 音效；新增 `secretNearby()`，在**纯移动且本步没有事件消息**时把提示条换成「这面墙似乎有点异样…（点它撞一下）」，给手环小屏一条可发现的线索，同时不盖掉战斗/开门结果。

**求解器**（`solver.js`）：按 `DOOR_COST` 判定门（只有 1~2 把黄钥匙时不把铁门当可穿过，否则会规划走不通的路并原地 break 震荡）；暗门 `A` 只作为目标格、**不可穿越**，并列入 `scan()` 的支线 items 组，攻略会顺路撞开拿钥匙。

### N.4 难度曲线保护：本轮最关键的取舍

21 处暗门如果每处给铁剑 / 铁盾 / 大血瓶（+10 攻防 / +200 HP），玩家 DEF 会提前越过逐层怪 ATK，把 v0.9 校准的「21/21 层掉血」打回 v0.8 的 100% 零伤。**实测**：

| 暗门奖励方案 | 终局 HP | ATK / DEF | 21/21 掉血 | 总损血 |
| --- | --- | --- | --- | --- |
| 第一版：铁剑 / 铁盾 / 大血瓶 | 4478 | 241 / 290 | ✅（但明显被稀释） | — |
| 第二版：铁剑 / 铁盾彩蛋保留 | 1641 | 201 / 253 | ✅ | — |
| **最终**：钥匙 / 小血瓶 / 金币 / 炸弹 + 三处 +3 宝石彩蛋 | **1087** | **194 / 243** | ✅ | **3663**（v0.11 为 3766） |

5F「锈剑上的红宝石」、9F「废盾上的蓝宝石」、19F「十字墙」三处保留经典暗墙叙事，但奖励压到 +3，不改曲线。1~7F 暗门全部补黄钥匙：前 6 层普通黄门要花 6 把、7F 铁门又要 3 把，地图每层 1 把刚好卡在临界，不补就会让第一道铁门变成死局。

### N.5 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `style.css` | 全量字号提升 + HUD 3 行 / action-bar 3×3 / 弹层可滚动，重写 |
| `index.html` | HUD 拆 3 行（新增 `hud-row-title`） |
| `tools/make_levels.py` | `IRON_FLOORS` / `SECRET_REWARD` / `secret_forbidden()` / `add_secret()` / `WALL='#A'` / `doorCost`+`secret` 段 / `A`、`G` 字符定义 |
| `levels/levels.json` | 重新生成：21 暗门 A + 3 铁门 G，`meta.schema` 升 4 |
| `tools/build_tables.py` | 新增 `DOOR_COST` / `SECRET` 段 + `secretAt()`，REQUIRED / SECTIONS / HEADER 同步 |
| `tables.js` | 由导表脚本重新生成 |
| `tools/gen_assets.py` | `draw_door_iron()` + `'G': 'door_iron'` / `'A': 'wall'`，`assets/manifest.json` 同源 `0.12.0` |
| `logic.js` | 门按 `DOOR_COST` 扣钥匙、暗门 A 分支、商店第 4 项黄钥匙 |
| `solver.js` | `DOOR_COST` 判门、暗门只作目标不穿越、`scan()` 收暗门 |
| `app.js` | `secretAt` 剧情 / 暗门音效 / `secretNearby()` 相邻提示 / 打字机滚动 |
| `texts.js` | 7 段暗门短剧情、商店文案四选一、暗门/铁门/钥匙经济帮助文案、UI 文案 |
| `version.js` | `v0.11.0 → v0.12.0` + CHANGELOG 首条 |
| 四套校验 + `browser_check.mjs` | 新增第 11 段 / 1d 段 / 字号与大三机制防漂移 / 真实点击专项 |

**未改**：存档 v3 格式（`serialize`/`deserialize` 零改动）、战斗公式、`FLOOR_SCALE`、`HERO0`、真机 M1/M2 工程。

### N.6 验证结果

| 校验 | 项数 | 结果 |
| --- | --- | --- |
| `validate_logic` | **409** | 全绿（新增第 11 段：配置 / 结构 / 撞墙显形 / 铁门 3 钥匙 / 经济闭环 / 通关回放） |
| `validate_assets` | **82** | 全绿（atlas A/G 映射、7 段暗门剧情） |
| `validate_levels` | **72** | 全绿（新增 1d：doorCost / SECRET / 暗门不绕门 / 奖励不破坏曲线） |
| `validate_version` | **71** | 全绿（字号下限 / 11 处字号 / 生成链 / 文案防漂移） |
| `build_tables.py --check` | — | 通过（表未落后于源） |
| 真实 Chromium `browser_check` | **267** | 全绿、**零 JS 异常**（新增 19 处 computedStyle 字号、撞暗门停原地+清格+奖励+剧情+再走一步、铁门 2 把拒绝/3 把开启、商店买黄钥匙） |
| **合计** | **901** | 全绿 |

正式工程回放：`1492` 步 / `279` 轮通关、21/21 层掉血、50 场战斗仅 2 场零伤、21 道门全开（含 3 道铁门）、20 处暗门被实际撞开、通关 HP1087 / ATK194 / DEF243、存档 1095B（v3 格式未改，限 4096B）。

### N.7 边界与后续

- **存档 v3 未改**：暗门 / 铁门只写 `opened` 的地板变更集，钥匙数在 `hero.keys` 里，旧档兼容策略不变。
- 暗门奖励刻意不给铁剑 / 铁盾 / 大血瓶，理由见 N.4；若以后要补经典道具，须重跑逐层曲线探针再定数值。
- 铁门统一消耗 **黄**钥匙（不按层变色），黄钥匙从 8F 起主要就是为 3 道铁门服务；「卖钥匙换金币」（原版 28F）暂未做，属后续可选项。
- 暗门为纯支线：solver 顺路撞开 20/21 处，少撞几处不影响可解性；「需要前置道具才撞得开」的 21 层式暗门未引入（会强制依赖剧情顺序，和当前策略式攻略不兼容）。
- 字号已按手环屏放大，但**真机可读性仍需 M2 解冻后实测**；本轮只在 212×520 的模拟器与真实 Chromium 里核验。
- 真机 M2 全部继续暂缓；多存档槽位、Excel 导表维持「明确不做」。
