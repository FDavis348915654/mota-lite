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
ok('CHANGELOG 首条说明 v0.13 经验 / 盗贼任务线 / 封印门 / 炸弹 / 存档 v4 / 音量',
  CHANGELOG[0].note.includes('经验系统') && CHANGELOG[0].note.includes('盗贼任务线') &&
  CHANGELOG[0].note.includes('封印门') && CHANGELOG[0].note.includes('存档升 v4') &&
  CHANGELOG[0].note.includes('音量'))

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

console.log('\n' + (process.exitCode ? '存在失败项' : '全部 ' + pass + ' 项断言通过') + '。每次改动后记得递增 version.js 的 VERSION 并补 CHANGELOG。\n')
