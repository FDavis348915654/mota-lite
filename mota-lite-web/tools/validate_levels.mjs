#!/usr/bin/env node
// 关卡表外置校验：levels/levels.json 是唯一编辑源，tables.js 必须是它的生成物。
// 用法：node tools/validate_levels.mjs
//
// 三类断言：
//   ① JSON 结构合法（字段 / 等宽 / id 唯一 / 楼梯配对 / 暗格坐标）；
//   ② 语义等价：tables.js 的 8 个导出与 JSON 的 8 个段逐项深度一致；
//   ③ 防漂移：python3 tools/build_tables.py --check 必须返回 0（表没落后于源）。
// 另外断言「运行时不认识 JSON」——只有生成物 tables.js 被 import。
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(path.join(root, f), 'utf8')
const data = JSON.parse(read('levels/levels.json'))
const t = await import('../tables.js')

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); pass++ }
  else { console.error('  ✗ ' + name + (detail ? '  -> ' + detail : '')); fail++ }
}
const eqJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('=== 1. 编辑源结构 ===')
const KEYS = ['tileColor', 'tileChar', 'monsters', 'items', 'floors', 'hero0',
  'doorKey', 'doorCost', 'hidden', 'secret', 'floorScale']
ok('meta 标注生成器与产物', data.meta && data.meta.generator === 'tools/make_levels.py' && data.meta.output === 'tables.js')
ok('11 个必需段齐全（含 v0.12 doorCost / secret）', KEYS.every(k => data[k] !== undefined), KEYS.join(' '))
ok('floors / monsters / items / hidden / secret 均为数组',
  ['floors', 'monsters', 'items', 'hidden', 'secret'].every(k => Array.isArray(data[k])))
ok('monsters id 与 ch 唯一',
  new Set(data.monsters.map(m => m.id)).size === data.monsters.length &&
  new Set(data.monsters.map(m => m.ch)).size === data.monsters.length, data.monsters.length + ' 个')
ok('items id 与 ch 唯一',
  new Set(data.items.map(i => i.id)).size === data.items.length &&
  new Set(data.items.map(i => i.ch)).size === data.items.length, data.items.length + ' 个')
ok('floors name 唯一', new Set(data.floors.map(f => f.name)).size === data.floors.length,
  data.floors.length + ' 层')
const W = data.floors[0].rows[0].length
ok('每层 rows 等宽且行数一致', data.floors.every(f =>
  f.rows.every(r => r.length === W) && f.rows.length === data.floors[0].rows.length),
  W + ' 列 × ' + data.floors[0].rows.length + ' 行')
ok('每层都有 name / story / rows', data.floors.every(f => f.name && f.story && Array.isArray(f.rows)))
ok('首层有唯一出生点 @', data.floors[0].rows.join('').split('@').length - 1 === 1)
ok('顶层无上楼 U、首层无下楼 D',
  !data.floors[0].rows.join('').includes('D') &&
  !data.floors[data.floors.length - 1].rows.join('').includes('U'))
ok('每层 U/D 与 up/down 声明一致', data.floors.every(f => {
  const hasU = f.rows.join('').includes('U'), hasD = f.rows.join('').includes('D')
  return (hasU ? !!f.up : true) && (hasD ? !!f.down : true) &&
    (f.up ? f.rows[f.up.y][f.up.x] === 'U' : true) &&
    (f.down ? f.rows[f.down.y][f.down.x] === 'D' : true)
}))
ok('相邻层楼梯双向配对', data.floors.every((f, i) =>
  i === data.floors.length - 1 || (!!f.up && !!data.floors[i + 1].down)))
ok('HIDDEN 坐标在源 JSON 里确实是 H',
  data.hidden.every(h => data.floors[h.floor].rows[h.y][h.x] === 'H'), data.hidden.length + ' 处')
ok('HIDDEN 坐标唯一', new Set(data.hidden.map(h => h.floor + ':' + h.x + ':' + h.y)).size === data.hidden.length)
// ---- v0.8：13×15 大地图 / 视口 / 关键唯一道具 ----
ok('meta.mapSize 标注 13×15', data.meta.mapSize && data.meta.mapSize.cols === 13 && data.meta.mapSize.rows === 15,
  JSON.stringify(data.meta.mapSize))
ok('实际地图尺寸 = meta.mapSize', W === data.meta.mapSize.cols && data.floors[0].rows.length === data.meta.mapSize.rows,
  W + '×' + data.floors[0].rows.length)
ok('meta.viewport 为一屏 7×9', data.meta.viewport && data.meta.viewport.cols === 7 && data.meta.viewport.rows === 9,
  JSON.stringify(data.meta.viewport))
ok('视口小于地图（需要相机跟随）',
  data.meta.viewport.cols < W && data.meta.viewport.rows < data.floors[0].rows.length)
const countCh = ch => data.floors.reduce((n, f) => n + f.rows.join('').split(ch).length - 1, 0)
ok('图鉴 I 全塔唯一', countCh('I') === 1, countCh('I') + ' 个')
ok('飞行器 F 全塔唯一（中期道具，只该有一个）', countCh('F') === 1, countCh('F') + ' 个')
ok('飞行器不在前 1/3、也不在顶层（中期而非开局/终局）', (() => {
  const f = data.floors.findIndex(fl => fl.rows.join('').includes('F'))
  return f >= Math.floor(data.floors.length / 3) && f < data.floors.length - 1
})(), 'F 在 ' + (data.floors.findIndex(fl => fl.rows.join('').includes('F')) + 1) + 'F')
ok('图鉴与飞行器不在同一层', (() => {
  const a = data.floors.findIndex(fl => fl.rows.join('').includes('I'))
  const b = data.floors.findIndex(fl => fl.rows.join('').includes('F'))
  return a !== b
})())
ok('法师 M / 盗贼 T 各至少一个', countCh('M') >= 1 && countCh('T') >= 1, countCh('M') + ' / ' + countCh('T'))
ok('商人 N 至少一个', countCh('N') >= 1, countCh('N') + ' 个')
ok('有房间的层都有守门怪（房间开口外侧非空）', (() => {
  // 房间由生成器 room_rect() 挖出：y=3 行 x=3..9 连续 7 格内墙，普通随机内墙做不到
  const isRoom = f => f.rows[3].slice(3, 10) === '#######'
  const rooms = data.floors.filter(isRoom)
  return rooms.length >= 5 && rooms.every(f => /[1-5]/.test(f.rows[9][6]))
})(), data.floors.filter(f => f.rows[3].slice(3, 10) === '#######').length + ' 个房间层')
ok('图鉴 / 飞行器 / NPC / 商店都有对应的 items 描述',
  ['I', 'F', 'M', 'T', 'N'].every(ch => data.items.some(i => i.ch === ch) || ch === 'N'))
ok('HIDDEN 的 item 能在 items 找到', data.hidden.every(h => data.items.some(i => i.id === h.item)))
ok('doorKey 的 key 都是小写钥匙字符', Object.values(data.doorKey).every(v => typeof v === 'string' && v === v.toLowerCase()))

// ---- v0.9：逐层强度曲线 / 分层怪种 / 主题接线 ----
console.log('\n=== 1b. v0.9 数值曲线 ===')
ok('floorScale 恰好 21 组', Array.isArray(data.floorScale) && data.floorScale.length === 21,
  data.floorScale.length + ' 组')
ok('每组含 hp/atk/def 且为正数', data.floorScale.every(s =>
  Number.isFinite(s.hp) && Number.isFinite(s.atk) && Number.isFinite(s.def) &&
  s.hp > 0 && s.atk > 0 && s.def >= 0))
ok('怪 ATK 逐层单调递增（修 100% 零伤根因）',
  data.floorScale.every((s, i) => i === 0 || s.atk >= data.floorScale[i - 1].atk),
  data.floorScale[0].atk + ' → ' + data.floorScale[20].atk)
ok('怪 HP 逐层不递减', data.floorScale.every((s, i) => i === 0 || s.hp >= data.floorScale[i - 1].hp))
ok('8 种怪、字符 1-8 全有对应', data.monsters.length === 8 &&
  '12345678'.split('').every(ch => data.monsters.some(m => m.ch === ch)),
  data.monsters.map(m => m.ch + ':' + m.name).join(' '))
ok('存在 pierce 真实伤害怪', data.monsters.some(m => m.pierce))
ok('魔王 noScale（终局独立数值）', (() => {
  const b = data.monsters.find(m => m.noScale)
  return b && b.ch === '3' && b.hp >= 900
})(), 'HP' + (data.monsters.find(m => m.noScale) || {}).hp)
ok('theme 拼进 FLOORS[].name', data.floors.every(f => f.name && f.name.includes(' · ') && f.theme && f.name.includes(f.theme)))
ok('分层怪种：高楼层出现 5/6/7/8', ['5', '6', '7', '8'].every(ch => countCh(ch) > 0),
  ['5', '6', '7', '8'].map(ch => ch + ':' + countCh(ch)).join(' '))
ok('房间开口守门怪仍是常规怪种', (() => {
  const rooms = data.floors.filter(f => f.rows[3].slice(3, 10) === '#######')
  return rooms.every(f => /[124]/.test(f.rows[9][6]))
})(), data.floors.filter(f => f.rows[3].slice(3, 10) === '#######').length + ' 个房间层')

// ---- 1c. v0.10 三色门封唯一入口 ----
console.log('\n=== 1c. v0.10 门结构 ===')
// v0.13：16F 上楼唯一入口改为封印门 Z（三色钥匙无效，只有盗贼任务线能撬开），
//        故门字符集合纳入 Z；7F / 14F / 21F 主路门仍是铁门 G，其余按三色分段。
const DCH = ['Y', 'B', 'R', 'G', 'Z'], KCH = ['y', 'b', 'r']
const doorsIn = f => f.rows.join('').split('').filter(c => DCH.includes(c))
const wantDoor = n => n === 16 ? 'Z'
  : ((n === 7 || n === 14 || n === 21) ? 'G' : (n <= 7 ? 'Y' : (n <= 14 ? 'B' : 'R')))
ok('每层恰好 1 道门', data.floors.every(f => doorsIn(f).length === 1),
  data.floors.map((f, i) => (i + 1) + 'F:' + doorsIn(f).length).filter(t => !t.endsWith('1')).join(' '))
ok('三色门按层段分级 + 铁门在 7/14/21F',
  data.floors.every((f, i) => doorsIn(f)[0] === wantDoor(i + 1)),
  [7, 14, 21].map(n => n + 'F:' + wantDoor(n)).join(' '))
ok('门都封在唯一入口：房间口 (6,8) / 上楼口 / 王座口 (6,6)', data.floors.every((f, i) => {
  const n = i + 1, rows = f.rows
  const isRoom = rows[3].slice(3, 10) === '#######'
  if (n === 21) return rows[6][6] === 'G' && rows[5][5] === '#' && rows[5][7] === '#'
  if (isRoom) return rows[8][6] === wantDoor(n)
  const a = rows[13][10], b = rows[12][11]
  return rows[13][11] === 'U' && ((a === '#' && DCH.includes(b)) || (b === '#' && DCH.includes(a)))
}))
ok('每层三色钥匙各一（门必定可开）',
  data.floors.every(f => KCH.every(k => f.rows.join('').includes(k))))
ok('房间层守门怪仍在门外 (6,9) 且为常规怪种',
  data.floors.filter(f => f.rows[3].slice(3, 10) === '#######').every(f => /[124]/.test(f.rows[9][6])))

// ---- 1d. v0.12 暗门 / 铁门 / 钥匙经济 ----
console.log('\n=== 1d. v0.12 暗门 / 铁门 / 钥匙经济 ===')
ok('doorCost：普通门 1 把 / 铁门 3 把',
  eqJSON(data.doorCost, { Y: 1, B: 1, R: 1, G: 3 }), JSON.stringify(data.doorCost))
ok('doorKey 四门映射（铁门 G 也用黄钥匙）',
  eqJSON(data.doorKey, { Y: 'y', B: 'b', R: 'r', G: 'y' }))
ok('铁门恰好 3 道，落在 7F / 14F / 21F', (() => {
  const gs = []
  data.floors.forEach((f, i) => { if (f.rows.join('').includes('G')) gs.push(i + 1) })
  return gs.join(',') === '7,14,21' && data.floors.every(f => f.rows.join('').split('G').length - 1 <= 1)
})())
ok('每层恰好 1 处暗门 A', data.floors.every(f => f.rows.join('').split('A').length - 1 === 1),
  countCh('A') + ' 处')
ok('SECRET 恰好 21 项（每层一处）', Array.isArray(data.secret) && data.secret.length === 21,
  data.secret.length + ' 项')
ok('SECRET 坐标在源 JSON 里确实是 A',
  data.secret.every(s => data.floors[s.floor] && data.floors[s.floor].rows[s.y][s.x] === 'A'))
ok('SECRET 坐标唯一', new Set(data.secret.map(s => s.floor + ':' + s.x + ':' + s.y)).size === data.secret.length)
ok('SECRET 的 item 能在 items 找到', data.secret.every(s => data.items.some(i => i.id === s.item)))
ok('暗门不落在房间墙 / 门 / 楼梯 / 王座邻域 2 格内（不绕开唯一入口）', data.floors.every((f, i) => {
  let a = null
  f.rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'A') a = { x, y } }))
  if (!a) return false
  if (f.rows[3].slice(3, 10) === '#######' && a.x >= 3 && a.x <= 9 && a.y >= 3 && a.y <= 8) return false
  const anchors = []
  f.rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (DCH.includes(c) || c === 'U' || c === 'D' || c === 'W' || c === '@') anchors.push({ x, y })
  }))
  return anchors.every(g => Math.abs(g.x - a.x) + Math.abs(g.y - a.y) > 2)
}))
ok('暗门奖励不给铁剑/铁盾/大血瓶（不破坏 v0.9 难度曲线）',
  data.secret.every(s => !['sword', 'shield', 'potion_l'].includes(s.item)),
  [...new Set(data.secret.map(s => s.item))].join(' '))
ok('前 7 层的暗门都以黄钥匙为主（保证 7F 铁门可开）',
  data.secret.filter(s => s.floor < 7 && s.item === 'key_y').length >= 5,
  data.secret.filter(s => s.floor < 7 && s.item === 'key_y').length + ' 处')

// ---- 1e. v0.13 经验 / 盗贼任务线 / 老者炸弹 / 16F 封印门 ----
console.log('\n=== 1e. v0.13 经验 / 盗贼任务线 / 老者炸弹 / 16F 封印门 ===')
const chAt = (f, ch) => f.rows.join('').split(ch).length - 1
const floorHas = (n, ch) => chAt(data.floors[n - 1], ch) > 0
const totalOf = ch => data.floors.reduce((s, f) => s + chAt(f, ch), 0)
ok('meta.schema 升到 5', data.meta.schema === 5, String(data.meta.schema))
ok('16F 上楼唯一入口是封印门 Z，且全塔仅此 1 道',
  floorHas(16, 'Z') && totalOf('Z') === 1 && doorsIn(data.floors[15])[0] === 'Z')
ok('doorKey 不含 Z（三色钥匙打不开封印门）', !('Z' in data.doorKey), JSON.stringify(data.doorKey))
ok('老者 E 只在 12F 房间，且全塔唯一', floorHas(12, 'E') && totalOf('E') === 1)
ok('锁匠工具 j 在 13F、钱袋 q 在 19F，各唯一',
  floorHas(13, 'j') && floorHas(19, 'q') && totalOf('j') === 1 && totalOf('q') === 1)
ok('地图已无炸弹拾取格 o（炸弹改为商店购买）', totalOf('o') === 0, totalOf('o') + ' 处')
ok('items 仍保留 bomb 定义（供商店 effect 用），但不再放置到地图',
  data.items.some(i => i.id === 'bomb' && i.ch === 'o') && totalOf('o') === 0)
ok('SECRET 奖励不再含炸弹（改金币轮换）',
  data.secret.every(s => !/bomb/.test(s.item) && !/bomb/.test(s.story)),
  [...new Set(data.secret.map(s => s.item))].join(' '))
ok('怪物表全部带 exp（m3 王为 0）',
  data.monsters.every(m => Number.isInteger(m.exp) && m.exp >= 0) &&
  data.monsters.find(m => m.id === 'm3').exp === 0,
  data.monsters.map(m => m.exp).join(','))
ok('hero0 带 exp / flags 且初始为 0', data.hero0.exp === 0 && data.hero0.flags === 0)
ok('老者 / 任务道具的 effect.flag 位正确（2 / 4 / 8）',
  data.items.find(i => i.id === 'npc_elder').effect.flag === 2 &&
  data.items.find(i => i.id === 'quest_lockpick').effect.flag === 4 &&
  data.items.find(i => i.id === 'quest_moneybag').effect.flag === 8)

console.log('\n=== 2. 生成物语义等价 ===')
const PAIRS = [
  ['TILE_COLOR', 'tileColor'], ['TILE_CHAR', 'tileChar'],
  ['MONSTERS', 'monsters'], ['ITEMS', 'items'], ['FLOORS', 'floors'],
  ['HERO0', 'hero0'], ['DOOR_KEY', 'doorKey'], ['DOOR_COST', 'doorCost'],
  ['HIDDEN', 'hidden'], ['SECRET', 'secret'], ['FLOOR_SCALE', 'floorScale']
]
PAIRS.forEach(([exp, key]) => ok('tables.js 的 ' + exp + ' === JSON.' + key,
  eqJSON(t[exp], data[key])))
ok('tables.js 的 VIEWPORT === JSON.meta.viewport', eqJSON(t.VIEWPORT, data.meta.viewport))
ok('查表工具仍由生成物导出（含 secretAt）',
  ['monsterByCh', 'itemByCh', 'itemById', 'hiddenAt', 'secretAt'].every(n => typeof t[n] === 'function'))
ok('tables.js 头部标注为生成物', read('tables.js').startsWith('// tables.js —— 由 tools/build_tables.py'))
ok('运行时不 import levels.json（文案里提到不算）',
  ['app.js', 'logic.js', 'solver.js', 'texts.js', 'records.js'].every(f =>
    !/^\s*import[\s\S]{0,120}from\s+['"][^'"]*levels\.json['"]/m.test(read(f)) &&
    !/import\(\s*['"][^'"]*levels\.json['"]\s*\)/.test(read(f))))

console.log('\n=== 3. 防漂移（生成器 --check）===')
let checkOut = '', checkOk = true
try {
  checkOut = execFileSync('python3', ['tools/build_tables.py', '--check'], { cwd: root, encoding: 'utf8' }).trim()
} catch (e) { checkOk = false; checkOut = String(e.stdout || e.message) }
ok('build_tables.py --check 通过（表未落后于源）', checkOk, checkOut)
let gen = ''
try { gen = execFileSync('python3', ['tools/build_tables.py', '--stdout'], { cwd: root, encoding: 'utf8' }) } catch (e) {}
ok('生成器输出与现有 tables.js 字节一致', gen === read('tables.js'),
  gen.length + ' B / ' + read('tables.js').length + ' B')
ok('生成器确定性（连续两次输出相同）',
  gen === execFileSync('python3', ['tools/build_tables.py', '--stdout'], { cwd: root, encoding: 'utf8' }))

console.log('\n' + (fail ? '存在 ' + fail + ' 项失败' : '全部 ' + pass + ' 项断言通过') + '。\n')
process.exit(fail ? 1 : 0)
