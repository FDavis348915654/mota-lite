# mota-lite · 腕上魔塔

经典魔塔（Dungeon RPG）复刻 Lite：**21 层 × 13×15 大地图、8 种怪物、暗门 / 铁门 / 三色钥匙经济、图鉴 / 飞行器 / 炸弹 / 商店**。
纯静态前端，零构建、零外部素材依赖 —— 像素图集由 Python 脚本程序化生成，音效为 8-bit WAV。

> A lightweight remake of the classic Magic Tower (魔塔) dungeon RPG. All art is procedurally generated and SFX are tiny 8-bit WAVs — no binary asset packs, no build step.

**运行方式**：本地起静态服务即可玩（ES Module 需要 http 协议，不能直接双击 `index.html`），见下方「快速开始」。

---

## 仓库结构

| 路径 | 说明 |
|---|---|
| `mota-lite-web/` | **在线试玩版工程本体**（当前主力，v0.12.0） |
| `mota-lite-web/logic.js` | 逻辑层纯函数：移动 / 战斗 / 门 / 暗门 / 商店 / 存档序列化，零 DOM，可被 Node 直接 import |
| `mota-lite-web/tables.js` | 由 `levels.json` 生成的配置表（FLOORS / MONSTERS / ITEMS / DOOR_COST / SECRET…） |
| `mota-lite-web/solver.js` | 攻略求解器：可解性验证 + 攻略回放 + 点击寻路共用 |
| `mota-lite-web/levels/levels.json` | 21 层关卡的唯一数据源（含暗门 A / 铁门 G / SECRET 奖励） |
| `mota-lite-web/assets/` | 程序化生成的图集（39 帧）与 12 个 8-bit WAV |
| `mota-lite-web/tools/` | 关卡生成、导表、资源生成、四套离线校验、真实 Chromium 回归 |
| `mota-lite/` | 手环端 M1 快应用工程（小米手环 10 / Vela，真机暂缓，**已冻结**） |
| `mota-lite-skeleton/` | 最早期逻辑骨架留档 |
| `小米手环10-魔塔Lite开发方案.md` | 移植到小米手环 10（Vela 快应用）的方案文档 |
| `魔塔Lite-开发盘点.md` | 逐版本开发盘点与当前状态 |
| `README.md` | 本文件 |
| `LICENSE` | MIT |
| `.gitignore` | 版本控制排除规则（详见下方「版本控制约定」） |

## 快速开始

逻辑层用了 ES Module（`import ... from './logic.js'`），`file://` 直接打开会被浏览器拦截，起个静态服务即可：

```
cd mota-lite-web
python3 -m http.server 8765
# 浏览器打开 http://127.0.0.1:8765
```

页面内置 212×520 手环屏模拟器（右侧是调试工作台），桌面 / 手机浏览器都能玩；存档存 `localStorage`，关掉再开自动续玩。

## 操作

| 动作 | 触屏 / 鼠标 | 键盘 |
|---|---|---|
| 移动 | **点击格子**（自动寻路，实体格为阻挡） | `WASD` / 方向键 |
| 交互（怪物 / 道具 / NPC / 门） | 点击实体本身，「撞一下停原地」，再走一步进入 | 走到相邻格后朝它移动 |
| 飞行器 升层 / 降层 | 屏幕内 `升层` / `降层` 按钮（只能去已探索楼层） | `F` 升层 / `Shift+F` 降层 |
| 引爆炸弹 | 屏幕内 `炸弹` 按钮 | `B` |
| 怪物图鉴 | 屏幕内 `图鉴` 按钮（需先拾取图鉴） | `C` |
| 新游戏 / 设置 / 商店 | 屏幕内对应按钮（危险操作有二次确认） | `R` 新游戏 |
| 回放 播放 / 步进 / 调速 | 右侧工作台回放条 | `空格` 播放、`[` `]` 步进、`+` `-` 调速、`Esc` 退出 |
| 弹层确认 / 关闭 | 点击按钮 | `Enter` / `空格` 确认、`Esc` 关闭 |

## 玩法要素

- **门与钥匙经济**：黄 / 蓝 / 红门封住唯一入口，消耗对应钥匙；**铁门 `G`**（7F / 14F / 21F 主路）一次耗 3 把黄钥匙；商店第四项 20G 买 1 把黄钥匙，配合地图投放、暗门奖励、盗贼救援构成攒 / 花 / 买闭环。
- **暗门 `A`**：伪装成普通砖墙（色块与精灵完全一致），主动撞墙才显形，墙后有钥匙 / 药水 / 金币 / 炸弹与三处宝石彩蛋。
- **战斗公式**：经典先手制，`回合数 = ceil(敌HP / (我攻-敌防))`，承受 `回合数-1` 次反击；法师系 `pierce` 无视防御；怪物手册给出「临界攻击」与「每 +1 防少掉多少 HP」。
- **逐层数值曲线**：每层独立 `FLOOR_SCALE`，怪 ATK 55→263 单调爬坡，保证 21/21 层都有掉血压力。
- **收集**：三色钥匙、血瓶、宝石、飞行器、炸弹、怪物图鉴（含每层清剿标注）、NPC 房间事件。

## 开发

```
cd mota-lite-web

python3 tools/make_levels.py        # 重新生成 levels/levels.json（改关卡后跑）
python3 tools/build_tables.py       # levels.json -> tables.js；--check 只校验一致性
python3 tools/gen_assets.py         # 重新生成图集 / 音频 / manifest.json（改美术后跑）

node tools/validate_version.mjs     # 版本 / 布局 / 字号断言（71 项）
node tools/validate_levels.mjs      # 关卡语义断言（72 项）
node tools/validate_logic.mjs       # 逻辑层断言（409 项）
node tools/validate_assets.mjs      # 资源断言（82 项）
node tools/browser_check.mjs        # 真实 Chromium 回归（267 项，需先起 http.server 8765）
```

全套合计 **901 项断言**（离线四套 + 导表一致性 + 真实浏览器回归）。

改完**必须递增版本号**，否则标题 / 页脚 / 版本记录会漂移：

1. `mota-lite-web/version.js` 的 `VERSION`（唯一真源，HTML 不硬编码任何版本号）
2. 同文件 `CHANGELOG` 最前面补一条，`v` 必须与 `VERSION` 完全一致

### 协作流程

这个目录同时是云电脑上的工作副本，**动手前先同步远端**。仓库已配置 `pull.rebase=true` 与 `rebase.autoStash=true`，有未提交改动时也能直接拉：

```
git pull --rebase        # 或简写 git sync（已设别名）
```

日常顺序：

1. `git pull --rebase` 拉到最新
2. 改 `mota-lite-web/` 下的代码，递增 `version.js`
3. 跑四套离线校验 + `node tools/browser_check.mjs`
4. `git add -A && git commit -m "..." && git push`

### 版本控制约定

`.gitignore` 只排除「能重新生成或与运行无关」的东西，工程本身（含图集、音频、文档、截图）全部入库：

| 排除项 | 原因 |
|---|---|
| `node_modules/`、`__pycache__/`、`*.pyc` | 依赖与 Python 运行缓存 |
| `mota-lite/dist/`、`dist/` | 快应用构建产物，可重新打出 |
| `.codebuddy/`、`.cloudstudio` | 云开发平台目录 |
| `.vscode/`、`.idea/`、`.DS_Store`、`Thumbs.db` | 编辑器与系统文件 |
| `*.log` | 临时日志 |

`mota-lite-web/tools/_bak/`（v7 / v11 的关卡与 tables 备份）**保留在仓库里**：它们是回归对照与回滚依据。

## 版本

当前 **v0.12.0**。完整变更记录（每个版本改了什么、数值怎么定的）见 `mota-lite-web/version.js` 的 `CHANGELOG` 与 `魔塔Lite-开发盘点.md`。

## 仓库用途

日常开发在云电脑上进行，这个仓库主要用于**备份与同步**：主工程始终是 `mota-lite-web/`；`mota-lite/`（手环端）已冻结，未来真机移植以在线版为准重新对齐。

## License

MIT © 2026 Davis，详见 [LICENSE](LICENSE)。
