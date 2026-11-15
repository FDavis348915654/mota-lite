#!/usr/bin/env node
// 静态校验：版本号单一真源不漂移。
// 用法：node tools/validate_version.mjs（不需要浏览器 / 本地服务）
// 每次改动宿主层后，除了递增 version.js 的 VERSION，还要跑这个脚本。
import { VERSION, BUILD_DATE, CHANGELOG } from '../version.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(path.join(root, f), 'utf8')

let pass = 0
function ok(name, cond, detail) {
  if (cond) {
    console.log('  ✓ ' + name + (detail ? '  ' + detail : ''))
    pass++
  } else {
    console.error('  ✗ ' + name + (detail ? '  -> ' + detail : ''))
    process.exitCode = 1
  }
}

const html = read('index.html')
const app = read('app.js')
const css = read('style.css')
const browserCheck = read('tools/browser_check.mjs')

const nums = v => v.slice(1).split('.').map(Number)
function cmp(a, b) {
  const x = nums(a), y = nums(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

console.log('当前版本：' + VERSION + '（' + BUILD_DATE + '）\n')

// ---- version.js 自身 ----
ok('VERSION 为语义化版本 vX.Y.Z', /^v\d+\.\d+\.\d+$/.test(VERSION), VERSION)
ok('BUILD_DATE 为 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(BUILD_DATE), BUILD_DATE)
ok('CHANGELOG 非空', Array.isArray(CHANGELOG) && CHANGELOG.length > 0, CHANGELOG.length + ' 条')
ok('CHANGELOG 首条 v === VERSION', CHANGELOG[0] && CHANGELOG[0].v === VERSION, CHANGELOG[0] && CHANGELOG[0].v)
ok('CHANGELOG 首条 date === BUILD_DATE', CHANGELOG[0] && CHANGELOG[0].date === BUILD_DATE)
ok('CHANGELOG 每条字段齐全', CHANGELOG.every(c =>
  typeof c.v === 'string' && /^v\d+\.\d+\.\d+$/.test(c.v) &&
  typeof c.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.date) &&
  typeof c.note === 'string' && c.note.length > 0))
ok('CHANGELOG 版本号无重复', new Set(CHANGELOG.map(c => c.v)).size === CHANGELOG.length)
ok('CHANGELOG 按新→旧降序', CHANGELOG.every((c, i) => i === 0 || cmp(CHANGELOG[i - 1].v, c.v) > 0))

// ---- HTML 不硬编码版本号，只留注入点 ----
const hardcoded = html.match(/v\d+\.\d+\.\d+/g)
ok('index.html 未硬编码版本号', !hardcoded, hardcoded ? hardcoded.join(', ') : '')
ok('index.html 有标题徽章注入点', html.includes('id="titleVersion"'))
ok('index.html 有页脚注入点', html.includes('id="footVersion"'))
ok('index.html 有版本记录注入点', html.includes('id="versionLog"'))

// ---- 胶水层确实从单一真源读取并注入 ----
ok('app.js import version.js', app.includes("from './version.js'"))
ok('app.js 定义 renderVersion()', app.includes('function renderVersion()'))
ok('app.js 冷启动调用 renderVersion()', /\brenderVersion\(\)/.test(app.replace('function renderVersion()', '')))
ok('app.js 写入标签页 title', app.includes('document.title') && app.includes('VERSION'))
ok('app.js 写入标题徽章 / 页脚 / 版本记录',
  app.includes("$('titleVersion')") && app.includes("$('footVersion')") && app.includes("$('versionLog')"))
ok('style.css 有版本徽章与记录样式', css.includes('.title-version') && css.includes('.version-log'))

// ---- 浏览器回归里必须有版本号断言，防止以后漏验 ----
ok('browser_check.mjs 校验标题徽章', browserCheck.includes('#titleVersion'))
ok('browser_check.mjs 从 version.js 动态读真值', browserCheck.includes("import('./version.js')"))
ok('browser_check.mjs 校验标签页 / 页脚', browserCheck.includes('document.title') && browserCheck.includes('#footVersion'))

// ---- 二次确认弹窗 / 新游戏入口：防止以后漏接或漂移 ----
ok('index.html 有确认弹层全部注入点',
  ['confirmLayer', 'confirmTitle', 'confirmBody', 'confirmOk', 'confirmCancel']
    .every(id => html.includes('id="' + id + '"')))
ok('index.html 有新游戏入口族三处',
  ['btnNewGameTop', 'btnActNewGame', 'setNewGame'].every(id => html.includes('id="' + id + '"')))
ok('index.html 有单槽说明注入点', html.includes('id="saveSlotNote"'))
ok('app.js 定义 openConfirm / confirmOk / requestNewGame',
  ['function openConfirm', 'function confirmOk', 'function requestNewGame'].every(s => app.includes(s)))
ok('app.js 未实际调用原生 window.confirm（无头浏览器会被阻塞）', !/\bwindow\.confirm\s*\(/.test(app))
ok('app.js 危险操作绑定带确认入口',
  app.includes("addEventListener('click', requestNewGame)") &&
  app.includes("addEventListener('click', requestClearSave)") &&
  app.includes("addEventListener('click', requestClearRecords)"))
ok('style.css 有确认弹层与页头按钮样式', css.includes('.confirm-layer') && css.includes('.head-newgame'))
ok('browser_check.mjs 有确认弹窗专项断言', browserCheck.includes('confirmLayer'))

// ---- v0.8 图鉴 / 视口裁剪 / 0.5× 缩放：防止以后漏接或漂移 ----
ok('index.html 有图鉴按钮与浮层注入点',
  ['btnActCodex', 'codexLayer', 'codexTitle', 'codexSub', 'codexList', 'codexClose'].every(id => html.includes('id="' + id + '"')))
ok('app.js 定义图鉴开关与渲染',
  ['function openCodex', 'function closeCodex', 'function renderCodex'].every(s => app.includes(s)))
ok('图鉴按钮绑定与 Esc 关闭都在',
  app.includes("$('btnActCodex').addEventListener('click', openCodex)") && app.includes('closeCodex()'))
ok('index.html 有 .viewport 裁剪容器', html.includes('class="viewport"') && html.includes('id="viewport"'))
ok('app.js 用 VIEWPORT 配置做相机', app.includes("import") && app.includes('VIEWPORT') && app.includes('function updateCamera'))
ok('style.css 有视口裁剪与相机样式', css.includes('.viewport') && css.includes('overflow: hidden'))
ok('缩放档含 0.5×（手环观感）', /data-zoom="0\.5"/.test(html) && html.includes('data-zoom="1.5"'))
ok('browser_check.mjs 有图鉴与相机专项断言', browserCheck.includes('#codexLayer') && browserCheck.includes('is-hero'))
ok('logic.js 存档版本升到 v4', read('logic.js').includes("return '4|'"))
ok('logic.js deserialize 只认 v4 且 head 恰好 16 段',
  read('logic.js').includes("seg[0] !== '4' || seg.length !== 4") &&
  read('logic.js').includes('a.length !== 16'))
ok('browser_check.mjs 断言 v4 存档格式',
  browserCheck.includes("startsWith('4|')") && browserCheck.includes('v0.13 存档串为 v4 格式'))

// ---- v0.9 图鉴「所有类型」口径 / 房间 NPC 端到端回归：防止漏接或漂移 ----
ok('renderCodex 静态扫本层配置过的类型全集（不只看存活）',
  app.includes('configured') && app.includes('monsterByCh(ch)') && app.includes('FLOORS[state.floor]'))
ok('renderCodex 对已清除类型仍列数值并标 cleared',
  app.includes("'codex-row' + (cleared") && app.includes('TEXTS.ui.codexCleared') && app.includes('configured.has(m.ch)'))
ok('style.css 有已清除态置灰样式', css.includes('.codex-row.cleared') && css.includes('.cbadge.cleared'))
ok('browser_check.mjs 有图鉴「所有类型/已清除」断言',
  browserCheck.includes('清掉一只怪后图鉴仍列出全部类型') && browserCheck.includes('codex-row.cleared'))
ok('browser_check.mjs 有房间 NPC 端到端断言（法师/盗贼点击交互）',
  browserCheck.includes('全塔定位到法师 M 与盗贼 T') && browserCheck.includes('已救出') && browserCheck.includes('救出'))
ok('texts.js 有 codexCleared 文案', read('texts.js').includes('codexCleared'))

// ---- v0.10 设置持久化 / 门阻挡：防止漏接或漂移 ----
ok('app.js 有独立设置 key 与 load/save/apply',
  ["const SETTINGS_KEY = 'mota_lite_web_settings_v1'", 'function loadSettings(',
   'function saveSettings(', 'function applySettings(', 'applySettings(loadSettings())'].every(t => app.includes(t)))
ok('solver.js 点击模式把门也当障碍', read('solver.js').includes('blockEntities && isEntityTile(ch) && !targets.has'))
ok('app.js 死角兜底不绕开门', app.includes('standTargets.size === 0'))
ok('browser_check.mjs 有设置刷新与门阻挡专项断言',
  browserCheck.includes('刷新后') && browserCheck.includes('门已打开'))


// ---- v0.11 交互停原地：防止漏接或漂移 ----
const logicSrc = read('logic.js'), textsSrcV = read('texts.js')
ok('logic.js 怪物 / 道具 交互结算后 return 停原地',
  logicSrc.includes('撞怪 = 结算但不进入该格') && logicSrc.includes('拾取 / 救出后停在原地'))
ok('app.js battleWon 不再依赖 moved',
  app.includes("const battleWon = !!beforeMon && events.some(t => t.startsWith('胜 '))"))
ok('app.js 交互剧情改用 interacted / progressed',
  app.includes('const progressed = moved || interacted') && app.includes("if (beforeTile === 'F' && progressed)"))
ok('texts.js 公式句不重复且说明原地交互',
  (textsSrcV.match(/战斗沿用经典魔塔的固定数值公式/g) || []).length === 1 &&
  textsSrcV.includes('交互后英雄停在原地'))
ok('browser_check.mjs 有 v0.11 真实点击停原地专项',
  browserCheck.includes('v0.11 击败怪物后英雄停在原地') && browserCheck.includes('v0.11 再走一步才进入原怪格'))

// ---- v0.12 大字号适配手环屏：静态防漂移（真实 computedStyle 由 browser_check 验）----
function ruleFontSize(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(esc + '\\s*\\{[^}]*font-size:\\s*(\\d+(?:\\.\\d+)?)px', 'm')
  const m = css.match(re)
  return m ? Number(m[1]) : 0
}
const fontFloor = [
  ['.action-btn', 14], ['.tip', 15], ['.cell-ch', 16], ['.hud', 14],
  ['.hud-row-title', 15], ['.story-body', 14], ['.settings-item, .settings-close', 15],
  ['.codex-close', 15], ['.confirm-ok, .confirm-cancel', 15],
  ['.over-title', 28], ['.btn-row button', 14]
]
const fontBad = fontFloor.filter(([s, min]) => ruleFontSize(s) < min)
ok('style.css 屏幕内主要文本字号全部达标（按钮 >=14px）', fontBad.length === 0,
  fontBad.length ? fontBad.map(([s, m]) => s + ':' + ruleFontSize(s) + '<' + m).join(' ') : fontFloor.length + ' 处达标')
ok('style.css 不再出现 9/10/11px 的手环小字', !/font-size:\s*(9|10|11)px/.test(css))
ok('style.css v0.13 action-bar 改 3 列自适应行（51px 宽 / 27px 行 / top394 / width160）',
  /\.action-bar\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*51px\)/.test(css) &&
  /\.action-bar\s*\{[^}]*grid-auto-rows:\s*27px/.test(css) &&
  /\.action-bar\s*\{[^}]*top:\s*394px/.test(css) &&
  /\.action-bar\s*\{[^}]*width:\s*160px/.test(css))
ok('style.css 删除被裁的 action-hint 小字节点（不再有该规则）', !/\.action-hint\s*\{/.test(css))
ok('style.css 有 act-locked / 常驻弹层余额 / 离开 / 隐藏继续样式',
  css.includes('.act-locked') && css.includes('.story-status') &&
  css.includes('.story-leave') && css.includes('.story-continue[hidden]'))
ok('index.html HUD 拆成 3 行（楼层名单独一行）', html.includes('hud-row-title'))
ok('app.js 打字机跟随滚动（放大后长剧情不被裁）', app.includes('body.scrollTop = body.scrollHeight'))

// ---- v0.12 暗门 / 铁门 / 钥匙经济：防漏接或漂移 ----
const levelsSrc = read('levels/levels.json'), genSrc = read('tools/gen_assets.py')
ok('levels.json 含 doorCost / secret 段',
  levelsSrc.includes('"doorCost"') && levelsSrc.includes('"secret"'))
ok('build_tables.py 导出 DOOR_COST / SECRET + secretAt()',
  ["'DOOR_COST'", "'doorCost'", "'SECRET'", "'secret'"].every(s => read('tools/build_tables.py').includes(s)) &&
  read('tools/build_tables.py').includes('export function secretAt'))
ok('make_levels.py 放暗门 A / 铁门 G 且 flood_ok 把 A 当墙',
  read('tools/make_levels.py').includes('IRON_FLOORS') &&
  read('tools/make_levels.py').includes('def add_secret(') &&
  read('tools/make_levels.py').includes("WALL = '#A'"))
ok('logic.js 暗门分支 / 铁门 DOOR_COST / 商店第 4 项黄钥匙',
  logicSrc.includes("if (t === 'A')") && logicSrc.includes('DOOR_COST[t] || 1') &&
  logicSrc.includes("{ kind: 'key', label: '黄钥匙'"))
ok('solver.js 按 DOOR_COST 判门且暗门只作目标不穿越',
  read('solver.js').includes('DOOR_COST[ch] || 1') &&
  read('solver.js').includes("ch === 'A' && !targets.has"))
ok('gen_assets.py 有 door_iron 帧且 A 映射 wall（视觉隐藏）',
  genSrc.includes("'door_iron', draw_door_iron") && genSrc.includes("'A': 'wall'"))
ok('texts.js 有暗门/铁门/钥匙经济文案与 7 段暗门剧情',
  textsSrcV.includes('暗门伪装成普通砖墙') && textsSrcV.includes('铁门是加厚门') &&
  textsSrcV.includes('钥匙经济') &&
  ['secret_key', 'secret_potion', 'secret_gold', 'secret_bomb',
   'secret_sword', 'secret_shield', 'secret_gem'].every(k => textsSrcV.includes(k + ':')))
ok('app.js 接 secretAt 剧情 / 暗门音效 / 相邻提示',
  app.includes("beforeTile === 'A' ? secretAt") && app.includes("t.includes('撞开暗门')") &&
  app.includes('function secretNearby'))
ok('browser_check.mjs 有 v0.13 字号 / 暗门 / 铁门 / 商店钥匙专项',
  browserCheck.includes('v0.13 屏幕内 18 处文本') && browserCheck.includes('v0.12 撞暗门：停在原地') &&
  browserCheck.includes('v0.12 3 把黄钥匙撞铁门') && browserCheck.includes('v0.13 买黄钥匙'))
ok('validate_logic.mjs 有第 11 段 / validate_levels.mjs 有 1d 段',
  read('tools/validate_logic.mjs').includes('=== 11. v0.12 暗门 / 铁门 / 钥匙经济 ===') &&
  read('tools/validate_levels.mjs').includes('=== 1d. v0.12 暗门 / 铁门 / 钥匙经济 ==='))
ok('validate_assets.mjs 校验 atlas 的 A/G 映射与暗门剧情',
  read('tools/validate_assets.mjs').includes("atlas.tileMap.A === 'wall'") &&
  read('tools/validate_assets.mjs').includes("atlas.tileMap.G === 'door_iron'") &&
  read('tools/validate_assets.mjs').includes('secretStoryKeys'))
// patch 版本（v0.13.1）会成为首条，故 v0.13 大版本记录改为「存在该条目」而非「首条」
const c13 = CHANGELOG.find(c => c.v === 'v0.13.0')
ok('CHANGELOG 有 v0.13.0 且说明经验 / 盗贼任务线 / 封印门 / 存档 v4 / 音量',
  !!c13 && c13.note.includes('经验系统') && c13.note.includes('盗贼任务线') &&
  c13.note.includes('封印门') && c13.note.includes('存档升 v4') && c13.note.includes('音量'))

// ---- v0.13 经验 / 盗贼任务线 / 炸弹中后期化 / 存档 v4：静态防漂移 ----
ok('logic.js 定义 FLAG / thiefStage / monsterExp / mageBuy',
  ['export const FLAG', 'export function thiefStage', 'export function monsterExp', 'export function mageBuy']
    .every(s => logicSrc.includes(s)))
ok('logic.js 有封印门 Z 分支 / BOMB_UNLOCK 商店炸弹门槛 / BOMB_COST·EXP_COST',
  logicSrc.includes("if (t === 'Z')") &&
  logicSrc.includes("offer.kind === 'bomb' && !(s.hero.flags & FLAG.BOMB_UNLOCK)") &&
  logicSrc.includes('BOMB_COST: 30') && logicSrc.includes('EXP_COST: 30'))
ok('app.js 音量 0.45→0.2', app.includes('g.gain.value = 0.2'))
ok('app.js renderHud 读 flags 解锁按钮 + 经验 HUD / 工作台',
  app.includes("'E' + (h.exp || 0)") && app.includes('act-locked') &&
  app.includes('FLAG.SHOP_SEEN') && app.includes('FLAG.BOMB_UNLOCK'))
ok('app.js 常驻交易弹层 persistent / status / 隐藏「继续」/ 购买后只刷新余额',
  ['opts.persistent', 'opts.status', 'updateStoryStatus',
   "$('storyContinue').hidden = !!item.persistent"].every(s => app.includes(s)))
ok('app.js 剧情触发覆盖 E / j / q / Z / N / M / T',
  ["beforeTile === 'E'", "beforeTile === 'j'", "beforeTile === 'q'", "beforeTile === 'Z'",
   "beforeTile === 'N'", "beforeTile === 'M'", "beforeTile === 'T'"].every(s => app.includes(s)))
ok('index.html 有 hudExp / iExp / storyStatus 注入点，且已删除 actionHint',
  ['id="hudExp"', 'id="iExp"', 'id="storyStatus"'].every(s => html.includes(s)) &&
  !html.includes('id="actionHint"'))
ok('browser_check.mjs 有 v0.13 经验 / 法师 / 老者 / 封印门 / 盗贼端到端专项',
  ['v0.13 打怪经验按 monsterExp 入账', 'v0.13 法师兑换扣 30 EXP',
   'v0.13 老者置 BOMB_UNLOCK', 'v0.13 封印门 Z 不被打开',
   'v0.13 交工具后盗贼阶段 1→2'].every(s => browserCheck.includes(s)))
ok('validate_assets.mjs 有 v0.13 精灵 / 剧情 / 商店炸弹专项',
  ['atlas 新增 E / j / q / Z 四个精灵映射', 'v0.13 新剧情 key 齐全',
   'SECRET 奖励不再产出炸弹'].every(s => read('tools/validate_assets.mjs').includes(s)))

// ---- v0.13.1 常驻交易弹层尺寸恒定：静态防漂移 ----
ok('style.css 常驻交易弹层正文区高度钉死 160px',
  /\.story-card\.persistent\s+\.story-body\s*\{[^}]*height:\s*160px/.test(css) &&
  /\.story-card\.persistent\s+\.story-body\s*\{[^}]*scrollbar-gutter:\s*stable/.test(css))
ok('app.js 给常驻交易弹层加 persistent 类',
  app.includes("classList.toggle('persistent'"))
ok('browser_check.mjs 有打字机期间坐标恒定专项',
  browserCheck.includes('v0.13.1 打字机期间卡片高度恒定') &&
  browserCheck.includes('v0.13.1 打字机期间商品按钮坐标恒定'))
// v0.14 成为首条，v0.13.1 patch 记录改为「存在该条目」（同 v0.13.0 的处理）
const c131 = CHANGELOG.find(c => c.v === 'v0.13.1')
ok('CHANGELOG 有 v0.13.1 且说明界面伸缩 / 误选',
  !!c131 && c131.note.includes('界面伸缩') && c131.note.includes('误选'))
// v0.15 成为首条，v0.14 / v0.13.1 记录改为「存在该条目」（同 v0.13.0 的处理）
ok('CHANGELOG 有 v0.14.0 且说明关卡设计深度 / 强敌 / scaleShift',
  (() => { const c = CHANGELOG.find(x => x.v === 'v0.14.0')
           return !!c && c.note.includes('关卡设计深度') && c.note.includes('强敌') &&
                  c.note.includes('scaleShift') })())
// v0.16 成为首条，v0.15 记录改为「存在该条目」（同 v0.14 / v0.13.0 的处理）
ok('CHANGELOG 有 v0.15.0 且说明走廊 / 瓶颈 / 清层节奏',
  (() => { const c = CHANGELOG.find(x => x.v === 'v0.15.0')
           return !!c && c.note.includes('窄走廊') && c.note.includes('守路怪') &&
                  c.note.includes('不打怪不能上楼') && c.note.includes('强敌') })())
ok('CHANGELOG 保留 v0.16.0 条目（小精灵 / 能量核心 / 护盾 / 交互等待）',
  CHANGELOG.some(c => c.v === 'v0.16.0' && c.note.includes('小精灵') &&
    c.note.includes('能量核心') && c.note.includes('能量护盾') && c.note.includes('交互等待')))
ok('CHANGELOG 保留 v0.17.0 条目（怪防 / 高防挡路怪 / 难度提高）',
  CHANGELOG.some(c => c.v === 'v0.17.0' && c.note.includes('防御') &&
    c.note.includes('挡路') && c.note.includes('难度')))
ok('CHANGELOG 首条为 v0.21.0 且说明常规小怪增益 / 花光资源通关 / 囚禁剧情 / 点击排队',
  CHANGELOG[0].v === 'v0.21.0' && CHANGELOG[0].note.includes('常规小怪') &&
  CHANGELOG[0].note.includes('花光资源') && CHANGELOG[0].note.includes('囚禁') &&
  CHANGELOG[0].note.includes('点击排队') && CHANGELOG[0].note.includes('DEF_GAIN'))
// v0.21.0 成为首条（minor），v0.20.2 / v0.20.1 记录改为「保留该条目」
ok('CHANGELOG 保留 v0.20.2 条目（缓存根因 / import map / 资源参数）',
  CHANGELOG.some(c => c.v === 'v0.20.2' && c.note.includes('缓存') &&
    c.note.includes('import map') && c.note.includes('?r=')))
ok('CHANGELOG 保留 v0.20.1 条目（振屏范围 / 振屏开关 / 防御 +20%）',
  CHANGELOG.some(c => c.v === 'v0.20.1' && c.note.includes('振屏') &&
    c.note.includes('开关') && c.note.includes('20%')))
ok('CHANGELOG 保留 v0.20.0 条目（难度曲线 / 防杀 / 合理利用金币经验 / 4 条路径口径）',
  CHANGELOG.some(c => c.v === 'v0.20.0' && c.note.includes('难度曲线再次调高') &&
    c.note.includes('防杀') && c.note.includes('合理利用手上的金币') &&
    c.note.includes('4 条正常强化时机路径')))
ok('CHANGELOG 保留 v0.19.0 条目（攻击吸血怪 / 不管破防 / 先打怪还是先捡血瓶 / 守门怪强化）',
  CHANGELOG.some(c => c.v === 'v0.19.0' && c.note.includes('攻击吸血怪') &&
    c.note.includes('不管能不能破防') && c.note.includes('先打怪还是先捡血瓶') &&
    c.note.includes('守门怪') && c.note.includes('噬血蝠')))
ok('CHANGELOG 保留 v0.18.0 条目（任务顺序重排 / 软门槛 / 百分比灌顶 / 剧情深度）',
  CHANGELOG.some(c => c.v === 'v0.18.0' && c.note.includes('任务顺序重排') &&
    c.note.includes('软门槛') && c.note.includes('百分比') && c.note.includes('剧情深度')))

// ---- v0.20.2 静态资源 cache-bust（import map）：静态防漂移 ----
// 线上响应只有 last-modified、无 Cache-Control，裸路径资源会被浏览器长期缓存，
// 导致新版改动在端上不生效。参数由 sync_cache_bust.py 从 VERSION 派生，每次递增版本必变。
const bustKeys = [...html.matchAll(/\?r=([0-9.]+)/g)].map(m => m[1])
const bustExpect = CHANGELOG[0].v.replace(/^v/, '')
ok('index.html 有 import map（静态资源 cache-bust）', html.includes('type="importmap"'))
ok('全部 ?r= 参数与 VERSION 一致（9 处）',
  bustKeys.length === 9 && bustKeys.every(k => k === bustExpect), bustKeys.join(','))
ok('import map 覆盖全部 7 个模块入口',
  ['app.js', 'logic.js', 'tables.js', 'solver.js', 'version.js', 'texts.js', 'records.js']
    .every(f => html.includes('"./' + f + '": "./' + f + '?r=' + bustExpect + '"')))
ok('app.js 入口与 style.css 均带 cache-bust',
  html.includes('src="./app.js?r=' + bustExpect + '"') &&
  html.includes('href="./style.css?r=' + bustExpect + '"'))
ok('所有 .js 的 import 说明符保持裸路径（import map 零侵入）',
  app.includes("from './version.js'") && !app.includes('?r=') && !logicSrc.includes('?r='))
ok('index.html 带 no-cache meta', html.includes('http-equiv="Cache-Control"'))
ok('sync_cache_bust.py 从 VERSION 派生参数且支持 --check',
  read('tools/sync_cache_bust.py').includes('export const VERSION') &&
  read('tools/sync_cache_bust.py').includes('--check'))

// ---- v0.20.1 振屏范围 / 振屏开关 / 防御增益：静态防漂移 ----
const manifest21 = JSON.parse(read('assets/manifest.json'))
ok('manifest.json version = 0.21.0', manifest21.version === '0.21.0', manifest21.version)
ok('logic.js 定义 v0.21.0 常规小怪增益（ATK1.2 / DEF1.5 / CAP1.15 / 分段HP 0.6·0.3）且移除 DEF_GAIN 死局旋钮',
  /MOB_ATK_GAIN:\s*1\.2/.test(logicSrc) && /MOB_DEF_GAIN:\s*1\.5/.test(logicSrc) &&
  /MOB_DEF_CAP_MULT:\s*1\.15/.test(logicSrc) &&
  /MOB_HP_SCALE_FRONT:\s*0\.6/.test(logicSrc) && /MOB_HP_SCALE_BACK:\s*0\.3/.test(logicSrc) &&
  !/DEF_GAIN:\s*1\.2/.test(logicSrc) && !logicSrc.includes('CONFIG.DEF_GAIN'))
ok('logic.js 清理死配置 VIBRATE_GAP', !logicSrc.includes('VIBRATE_GAP:'))
ok('logic.js 仅 4 处 vibrate 事件', (logicSrc.match(/\{ t: 'vibrate' \}/g) || []).length === 4)
ok('app.js 振屏开关 vibOn 全链路（pulse 拦截 / 持久化 / 双按钮）',
  ['if (!vibOn) return', 'vib: vibOn', 'vibOn = o.vib', 'function toggleVib',
   "$('btnVib')", "$('setVib')"].every(x => app.includes(x)))
ok('app.js interacted 不再依赖 vibrate（事件协议解耦）',
  app.includes("const interacted = r.events.some(e => e.t === 'save' || e.t === 'msg')"))
ok('index.html 有 btnVib / setVib 注入点',
  html.includes('id="btnVib"') && html.includes('id="setVib"'))
ok('texts.js 有 vibOn / vibOff 文案',
  textsSrcV.includes('vibOn:') && textsSrcV.includes('vibOff:'))
ok('validate_logic.mjs 有 v0.21.0 专项段且已清除 DEF_GAIN 基线隔离',
  read('tools/validate_logic.mjs').includes('=== v0.21.0') &&
  !read('tools/validate_logic.mjs').includes('CONFIG.DEF_GAIN ='))
ok('validate_assets.mjs 版本对齐已改 0.21.0',
  read('tools/validate_assets.mjs').includes("version === '0.21.0'"))
// ---- v0.14 关卡设计深度：静态防漂移 ----
const genPy = read('tools/make_levels.py')
ok('make_levels.py 有隔间 / 宝库 / 精英常量',
  genPy.includes('def add_corridors') && genPy.includes('def add_vault') &&
  genPy.includes('ELITE_FLOORS') && genPy.includes('ELITE_SHIFT'))
ok('logic.js scaledMon 支持 scaleShift',
  read('logic.js').includes('mon.scaleShift || 0'))
ok('solver.js 禁止把楼梯当通路 + 换层后终止路径',
  read('solver.js').includes("ch === 'U' || ch === 'D'") &&
  read('solver.js').includes('s.floor !== beforeFloor'))
ok('texts.js 有精英引导与 m9 描述',
  read('texts.js').includes('elite_hint') && read('texts.js').includes('m9:'))
ok('app.js 首次撞 X 弹引导',
  app.includes("beforeTile === 'X' && progressed"))
ok('gen_assets.py 有 elite 帧与 X 映射',
  read('tools/gen_assets.py').includes('draw_elite') &&
  read('tools/gen_assets.py').includes("'X': 'elite'"))
ok('browser_check.mjs 有 v0.14 端到端专项',
  browserCheck.includes('v0.14 强敌'))

// ---- v0.15 关卡节奏（走廊 + 瓶颈守路）：静态防漂移 ----
ok('make_levels.py 有闸墙 / 凹室 / 第一带 / 守路怪池',
  genPy.includes('def gate_skeleton') && genPy.includes('def add_alcoves') &&
  genPy.includes('def start_region') && genPy.includes('def guard_pool') &&
  genPy.includes('GATE_TARGET'))
ok('make_levels.py 闸墙起始行 >= y4 且 m9 强度改用 ELITE_HPW=1.0 常量（v0.19 只拉高强度）',
  genPy.includes('range(4, 12)') &&
  genPy.includes('ELITE_HPW = 1.0') && genPy.includes("'atkW': 1.25") &&
  genPy.includes("'hpW': ELITE_HPW, 'atkW': 1.25, 'defW': 1.0"))
ok('solver.js 强敌纯支线 + 保护阈值放大（v0.16 含精灵往返 6000/1400）',
  read('solver.js').includes('!mon.elite') &&
  read('solver.js').includes('guarded.has(key)') &&
  read('solver.js').includes('MAX_STEPS = 6000') &&
  read('solver.js').includes('rounds > 1400'))
ok('texts.js 帮助文案说明走廊 / 守路怪 / 清层节奏',
  read('texts.js').includes('守路怪') && read('texts.js').includes('杀完一层的怪'))
ok('browser_check.mjs 有 v0.15 走廊拦路端到端专项',
  browserCheck.includes('v0.15 走廊'))

// ---- v0.16 小精灵 / 能量核心 / 能量护盾 / 交互等待：静态防漂移 ----
ok('make_levels.py 有 v0.16 基础常量（精灵 e / 核心 C / 怪数 12 / 损血×1.3）',
  genPy.includes("FAIRY_CH = 'e'") && genPy.includes("CORE_CH = 'C'") &&
  genPy.includes('TARGET_MOBS = 12') && genPy.includes('lossMul=1.3'))
ok('levels.json 有 barrier 表且 build_tables.py 导出 BARRIER',
  read('tools/build_tables.py').includes("('BARRIER',") &&
  read('tables.js').includes('export const BARRIER'))
ok('logic.js 有 flags 扩位 / 精灵三态分支 / 软门槛（无 shield 早退）',
  read('logic.js').includes('CORE_HELD: 128') &&
  read('logic.js').includes('FAY_CHARGED: 256') &&
  !read('logic.js').includes("reason: 'shield'") &&
  read('logic.js').includes('flags > 511') &&
  read('logic.js').includes("if (t === 'e')") &&
  read('logic.js').includes('chargeRatio'))
ok('solver.js 有精灵回头往返 + 保护阈值 6000/1400',
  read('solver.js').includes('backForFairy') &&
  read('solver.js').includes('BARRIER.floor') &&
  read('solver.js').includes('MAX_STEPS = 6000') &&
  read('solver.js').includes('rounds > 1400'))
ok('app.js 有「走到实体旁等一拍」交互（AUTO_STEP_MS / interactTimer）与精灵剧情',
  app.includes('AUTO_STEP_MS = 150') && app.includes('interactTimer') &&
  app.includes('}, AUTO_STEP_MS)') && app.includes("queueStory('fairy_charge')"))
ok('texts.js 有 v0.16 四段剧情 / 17F 护盾 / 帮助说明',
  read('texts.js').includes('fairy_intro') && read('texts.js').includes('core_hint') &&
  read('texts.js').includes('fairy_charge') && read('texts.js').includes('能量护盾'))
ok('gen_assets.py 有 fairy / core 两帧与 e/C 映射',
  read('tools/gen_assets.py').includes('draw_fairy') &&
  read('tools/gen_assets.py').includes('draw_core') &&
  read('tools/gen_assets.py').includes("'e': 'fairy'"))
ok('browser_check.mjs 有 v0.16 小精灵端到端专项',
  browserCheck.includes('v0.16 小精灵'))

// ---- v0.17 高防怪 / 破防临界 / 挡路怪：静态防漂移 ----
ok('make_levels.py 有实测属性表 ACT_A / ACT_D 与 v0.19 曲线参数（lossGain=1.5）',
  genPy.includes('ACT_A = [') && genPy.includes('ACT_D = [') &&
  genPy.includes('defRatio=0.65') && genPy.includes('battleRounds=5') &&
  genPy.includes('lossGain=1.5') && genPy.includes('costMul=5.0'))
ok('make_levels.py build_floor_scale 按「先定怪防再反解 HP/ATK」',
  genPy.includes("dfn = round(c.get('defRatio', 0.65) * pa)") &&
  genPy.includes('mon_per_hit = cost / (R - 1)'))
ok('make_levels.py 有高防挡路怪 WALL_GUARD_CH + 2F~16F 投放层限制',
  genPy.includes("WALL_GUARD_CH = '6'") && genPy.includes('use_wall = 2 <= floor_no <= 16'))
ok('make_levels.py 守门怪 m6 hpW 大幅提升到 WALL_GUARD_HPW=1.5（defW1.23 / atkW0.92 不动）',
  genPy.includes('WALL_GUARD_HPW = 1.5') &&
  genPy.includes("'hpW': WALL_GUARD_HPW, 'atkW': 0.92, 'defW': 1.23"))
ok('make_levels.py 常规怪 atkW 收敛 / pierce 权重减半（防净伤放大）',
  genPy.includes("'atkW': 0.08") && genPy.includes("'atkW': 0.10") &&
  genPy.includes("'atkW': 1.05, 'defW': 0.9"))
ok('make_levels.py BARRIER_BOOST 收敛为温和台阶（hp1.2/atk1.04/def1.0）',
  genPy.includes("BARRIER_BOOST = {'hp': 1.2, 'atk': 1.04, 'def': 1.0}"))
ok('make_levels.py meta.schema = 11（v0.20 前期防杀抑制）', genPy.includes("'schema': 11"))
ok('levels.json 有 defRatio 曲线与 schema 11',
  read('levels/levels.json').includes('"defRatio": 0.65') &&
  read('levels/levels.json').includes('"schema": 11'))
ok('browser_check.mjs 有 v0.17 高防端到端专项',
  browserCheck.includes('v0.17 高防'))

// ---- v0.18 任务顺序重排 / 软门槛 / 百分比灌顶 / 剧情链：静态防漂移 ----
ok('make_levels.py：核心 17F / 台阶 15F / 百分比灌顶常量',
  genPy.includes('CORE_FLOOR = 17') && genPy.includes('BARRIER_FLOOR = 15') &&
  genPy.includes('FAIRY_CHARGE_RATIO = 0.40') &&
  genPy.includes('chargeRatio') && genPy.includes("g[inner[2][1]][inner[2][0]] = CORE_CH"))
ok('make_levels.py：ACT_A/ACT_D 的 17F~21F 段重建为未强化基准',
  genPy.includes('183, 186, 189, 220, 223') &&
  genPy.includes('218, 244, 250, 265, 278') &&
  genPy.includes('未强化路径'))
ok('make_levels.py：13F treasure 房不再投放核心 C',
  !genPy.includes("if floor_no == CORE_FLOOR: loot.append(CORE_CH)"))
ok('logic.js：scaledMon 增第三参数 hero（默认 null = 基线不套加成）',
  read('logic.js').includes('export function scaledMon(mon, floor, hero)') &&
  read('logic.js').includes('const shielded = !!(BARRIER && hero'))
ok('logic.js：精灵灌顶按当前值百分比（Math.round + chargeRatio）',
  read('logic.js').includes('Math.round(s.hero.atk * (1 + ratio))') &&
  read('logic.js').includes('BARRIER.chargeRatio'))
ok('solver.js：findSolution(opts) 支持 noCharge / chargeFloor（5 条路径可验证）',
  read('solver.js').includes('export function findSolution(opts)') &&
  read('solver.js').includes('opts.noCharge') &&
  read('solver.js').includes('opts.chargeFloor'))
ok('texts.js：剧情链互文（法师认符文 / 老者警告 / 盗贼撬开泄盾 / 商人摊后核心）',
  read('texts.js').includes('塔灵的锁') && read('texts.js').includes('压着塔灵的气') &&
  read('texts.js').includes('符文一灭') && read('texts.js').includes('摊子后头') &&
  read('texts.js').includes('按你【当下的身子】灌顶'))
ok('texts.js：17F / 核心 / 帮助文案无「13F 核心」与「硬门槛」旧口径',
  read('texts.js').includes('"17F · 摊子后头的光"') &&
  read('texts.js').includes('"17F · 能量核心"') &&
  !read('texts.js').includes('没回去强化就一定卡在 17F'))
ok('build_tables.py HEADER 有 v0.18 口径与 schema 9',
  read('tools/build_tables.py').includes('v0.18 任务顺序重排') &&
  read('tools/build_tables.py').includes('能量核心(17F 商人房'))
ok('browser_check.mjs 有 v0.18 任务链端到端专项',
  browserCheck.includes('v0.18 任务链'))

// ---- v0.19 攻击吸血怪 / 前期精英化 / 守门怪强化：静态防漂移 ----
ok('make_levels.py 有 v0.21 吸血怪常量（字符 9 / 15% / eliteBefore 11 / shift 7）',
  genPy.includes("DRAIN_CH = '9'") && genPy.includes('DRAIN_RATIO = 0.15') &&
  genPy.includes('DRAIN_ELITE_BEFORE = 11') && genPy.includes('DRAIN_ELITE_SHIFT = 7') &&
  !genPy.includes('DRAIN_ELITE_SHIFT = 9'))
ok('make_levels.py m10 噬血蝠带 drain / eliteBefore / eliteShift（k×r<1 硬约束，defW 恒 1.0）',
  genPy.includes("'id': 'm10'") && genPy.includes("'drain': DRAIN_RATIO") &&
  genPy.includes("'eliteBefore': DRAIN_ELITE_BEFORE") &&
  genPy.includes("'eliteShift': DRAIN_ELITE_SHIFT") && genPy.includes("'defW': 1.0"))
ok('make_levels.py 精英吸血怪投放做 BFS 非割点校验，且 9 纳入 cut_by_floor 双保险',
  genPy.includes('_reach(g, (1, 1), (11, 13), {c})') &&
  genPy.includes("'1245678' + DRAIN_CH"))
ok('make_levels.py 血瓶 ×2 HP 供给校准（100 / 400）',
  genPy.includes("'hp': 100") && genPy.includes("'hp': 400"))
ok('make_levels.py tileChar / tileColor 补 9（血 / #c2185b）',
  genPy.includes("'9': '血'") && genPy.includes("'9': '#c2185b'"))
ok('logic.js calcBattle 把吸血作为独立项并入 hpCost（普伤为 0 也扣、不回怪血）',
  logicSrc.includes('drainPerHit') && logicSrc.includes('hits * (monPerHit + drainPerHit)') &&
  !logicSrc.includes('drain 回怪血'))
ok('logic.js scaledMon 支持 eliteBefore 动态前期精英化（12F 起回落普通）',
  logicSrc.includes('mon.eliteBefore') && logicSrc.includes('dynElite'))
ok('app.js 战斗预览标「（吸血）」、texts.js 有 m10 图鉴与帮助文案',
  app.includes('（吸血）') && read('texts.js').includes('m10:') &&
  read('texts.js').includes('噬血蝠') && read('texts.js').includes('先把它打掉再回头捡血瓶') &&
  read('texts.js').includes('堆防挡不住'))
ok('gen_assets.py 有 drain 精灵帧与 9 → drain 映射',
  read('tools/gen_assets.py').includes('draw_drain') &&
  read('tools/gen_assets.py').includes("'9': 'drain'"))
ok('build_tables.py HEADER 有 v0.19 口径（drain=15% / schema 10）',
  read('tools/build_tables.py').includes('v0.19') &&
  read('tools/build_tables.py').includes('drain=15%'))
ok('browser_check.mjs 有 v0.19 吸血怪端到端专项',
  browserCheck.includes('v0.19 吸血怪'))

// ---- v0.20 前期防杀抑制：静态防漂移 ----
ok('make_levels.py 有 DEF_GROWTH / ANTI_BLOCK_K 且前 11 组 atk 返回后处理',
  genPy.includes('DEF_GROWTH = [3, 20, 0, 10, 20, 10, 0, 5, 0, 0, 3]') &&
  genPy.includes('ANTI_BLOCK_K = 1.5') &&
  genPy.includes("out[f]['atk'] += round(ANTI_BLOCK_K * DEF_GROWTH[f])\n    return out"))
ok('make_levels.py meta.note 含 v0.20 防杀抑制说明',
  genPy.includes('v0.20 前期防杀抑制'))
ok('v0.20 帮助文案已改口径：不再宣称「完全不强化也能硬扛通关」',
  !read('texts.js').includes('完全不强化也能硬扛通关') &&
  !read('texts.js').includes('不回去强化也能硬扛到塔顶') &&
  read('texts.js').includes('合理利用手上的金币与经验'))
ok('v0.20 验收口径：4 条正常路径 / noCharge 不再保证通关（离线 + 浏览器同步）',
  read('tools/validate_logic.mjs').includes('四条正常强化时机路径') &&
  read('tools/validate_logic.mjs').includes('noCharge）不再保证通关') &&
  read('tools/browser_check.mjs').includes('noCharge 不再保证通关'))
ok('v0.20 build_tables.py HEADER 有防杀抑制说明',
  read('tools/build_tables.py').includes('v0.20：前期防杀抑制'))

// ---- v0.21.0 常规小怪增益 / 囚禁剧情 / 点击排队：静态防漂移 ----
const appV21 = read('app.js'), textsV21 = read('texts.js'), logicV21 = read('logic.js')
ok('logic.js scaledMon 只对常规小怪增益（排除 noScale / elite / 高 defW / drain）',
  logicV21.includes('if (mon.noScale) return mon') &&
  logicV21.includes('const isCommon = !isElite && defW < 1.2 && !mon.drain') &&
  logicV21.includes('MOB_DEF_CAP_MULT') && logicV21.includes('hpScale'))
ok('texts.js 有首次商人感谢剧情 shop_free（被怪物囚禁 / 先道谢）',
  textsV21.includes('shop_free:') && textsV21.includes('被怪物囚禁') &&
  textsV21.includes('这份谢我得先说'))
ok('texts.js 法师 / 盗贼 / 老者 / 结局统一「被怪物囚禁 · 顺路救出」口径',
  textsV21.includes('怪物把我锁进这法阵') && textsV21.includes('怪物把我扔进来关了三天') &&
  textsV21.includes('怪物把我看在这儿太久') && textsV21.includes('这一路救出来的，不止是公主'))
ok('app.js 首次撞商店按 SHOP_SEEN 判定并先弹 shop_free',
  appV21.includes('const shopSeenBefore') && appV21.includes('openShop(!shopSeenBefore)') &&
  appV21.includes('function openShop(firstTime') && appV21.includes("queueStory('shop_free')"))
ok('app.js 点击排队全链路（enqueue / pump / clear / 动画结束与剧情后触发）',
  ['let inputQueue', 'function enqueueInput', 'function pumpInputQueue', 'function clearInputQueue',
   "enqueueInput({ kind: 'walk'", "enqueueInput({ kind: 'dir'", 'pumpInputQueue()'].every(x => appV21.includes(x)))
ok('app.js 动画期间点击 / 方向键改为排队而非丢弃',
  appV21.includes("if (animating) { enqueueInput({ kind: 'walk', x, y }); return }") &&
  appV21.includes('const aq = KEYMAP[k]'))
ok('levels.json / tables.js 吸血蝠 eliteShift = 7',
  JSON.parse(read('levels/levels.json')).monsters.find(m => m.ch === '9').eliteShift === 7 &&
  read('tables.js').includes('"eliteShift": 7'))
ok('browser_check.mjs 有 v0.21.0 剧情 / 手感端到端专项',
  browserCheck.includes('v0.21.0 剧情') && browserCheck.includes('v0.21.0 手感'))
console.log('\n' + (process.exitCode ? '存在失败项' : '全部 ' + pass + ' 项断言通过') + '。每次改动后记得递增 version.js 的 VERSION 并补 CHANGELOG。\n')
