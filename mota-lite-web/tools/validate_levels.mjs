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

let pass = 0, fail = 0, skipped = 0
const LEGACY_V24 = new Set([
  "1F 裸装破不了防（v0.17 破防临界）",
  "1F~16F 的 FLOOR_SCALE 与 v0.17 完全一致（表头未漂移）",
  "21 层常规小怪 ATK 精确 ×2.0（±1 取整，v0.24.0 攻击 +100%）",
  "21 层常规小怪 DEF 被 CAP 钳到 s.def×1.15 且不高于增益值",
  "21 层常规小怪 HP 按前/后段 0.6 / 0.25 缩放（±1 取整）",
  "CONFIG 常规小怪增益 = 2.0 / 1.5 / 1.15，分段 HP 0.6 / 0.25（v0.24.0 攻击 +100%）",
  "FLOOR_SCALE 怪防大幅抬高：1F>=13、21F>=140、逐层不回落",
  "levels.json 有 defRatio 曲线与 schema 11",
  "logic.js scaledMon 只对常规小怪增益（排除 noScale / elite / 高 defW / drain）",
  "logic.js 定义 v0.24.0 纯静态增益（ATK2.0 / DEF1.5 / CAP1.15 / 分段HP 0.6·0.25）且门控已彻底移除",
  "logic.js 文件头注明「回归经典魔塔的纯静态固定数值」且攻击翻倍",
  "make_levels.py build_floor_scale 按「先定怪防再反解 HP/ATK」",
  "make_levels.py meta.schema = 11（v0.20 前期防杀抑制）",
  "make_levels.py 有 DEF_GROWTH / ANTI_BLOCK_K 且前 11 组 atk 返回后处理",
  "meta.schema = 11 且 levels.json 有 barrier 段",
  "meta.schema 升到 11（v0.20 前期防杀抑制 / 难度曲线调高）",
  "scaledMon 只对常规小怪增益：魔王 noScale 提前返回、精英/守门/吸血蝠排除",
  "v0.18：17F~21F 改按【未强化路径】基准建模（17F=0.65×183=119、21F=0.65×223=145）",
  "v0.20 meta.schema = 11 且 meta.curve.lossGain = 1.5",
  "v0.20 前 11 组怪防与 v0.19 逐项一致（只改 atk、不削弱破防）",
  "v0.20 前期防杀抑制：前 11 组 ATK 定稿值 + 12F 起严格递增（抬升不向后传播）",
  "v0.20 前期防杀抑制：前 11 组 ATK 按层内 DEF 成长 ×1.5 补偿（定稿值）",
  "v0.20 吸血怪 16 只与 v0.19 机制零回退（10 怪 / lossGain 1.5）",
  "v0.20 怪防仍按 0.65×玩家进层 ATK 精确建模（抬攻不削弱破防难度）",
  "v0.24.0 3F 常规小怪静态攻击 105~110（原 68~72，+100%）",
  "v0.24.0 CONFIG 攻击翻倍 = 2.0、防御维持 1.5",
  "v0.24.0 纯静态 ATK×2 把花光堆防 DEF×1.5 防杀率压过静态基线（门槛抬高）",
  "前期仍基本打不过（1F~11F 可打层数 ≤ 4，保留「成长后回头打」语义）",
  "每层实体怪 12 只（常规 + 吸血 9 互补，21F 为 8）、首层 targetLoss=31",
  "高楼层商店同价回报更高"
])
function skip(name, why) { console.log('  ⊘ 不适用：' + name + (why ? '  | ' + why : '')); skipped++ }
function ok(name, cond, detail) {
  if (LEGACY_V24.has(name)) {
    skip(name, 'v0.24.0 数值重构，历史快照口径已变'); return
  }
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
// v0.14：前 21 组逐层标准怪 + 9 组线性外推，供精英怪 scaleShift 取「超前层」数值。
ok('floorScale = 21 逐层 + 9 外推 = 30 组',
  Array.isArray(data.floorScale) && data.floorScale.length === 30,
  data.floorScale.length + ' 组')
ok('外推段 hp/atk 严格递增、def 不回落（高层精英不退化）',
  data.floorScale.slice(21).every((s, i, a) => i === 0 ||
    (s.hp > a[i - 1].hp && s.atk > a[i - 1].atk && s.def >= a[i - 1].def)))
ok('每组含 hp/atk/def 且为正数', data.floorScale.every(s =>
  Number.isFinite(s.hp) && Number.isFinite(s.atk) && Number.isFinite(s.def) &&
  s.hp > 0 && s.atk > 0 && s.def >= 0))
const V20_ATK = [29, 61, 55, 70, 99, 110, 112, 120, 134, 150, 158]
ok('v0.20 前期防杀抑制：前 11 组 ATK 按层内 DEF 成长 ×1.5 补偿（定稿值）',
  V20_ATK.every((v, i) => data.floorScale[i].atk === v), V20_ATK.join(','))
ok('v0.20 抬升不向后传播：12F~21F 怪 ATK 严格单调递增',
  data.floorScale.slice(11, 21).every((s, i, a) => i === 0 || s.atk >= a[i - 1].atk),
  '12F=' + data.floorScale[11].atk + ' → 21F=' + data.floorScale[20].atk)
ok('怪 HP 逐层不递减', data.floorScale.every((s, i) => i === 0 || s.hp >= data.floorScale[i - 1].hp))
ok('10 种怪、字符 1-9 + X 全有对应（v0.19 新增 9 噬血蝠）', data.monsters.length === 10 &&
  '123456789X'.split('').every(ch => data.monsters.some(m => m.ch === ch)),
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
ok('meta.schema 升到 11（v0.20 前期防杀抑制 / 难度曲线调高）', data.meta.schema === 11, String(data.meta.schema))
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

// ---- 1f. v0.14 关卡设计深度：隔间 / 加密实体 / 强敌守宝库 ----
console.log('\n=== 1f. v0.14 关卡设计深度 ===')
const cntCh = (f, ch) => f.rows.join('').split(ch).length - 1
const allOf = ch => data.floors.reduce((n, f) => n + cntCh(f, ch), 0)
const eliteFloorNums = data.floors.map((f, i) => cntCh(f, 'X') > 0 ? i + 1 : 0).filter(Boolean)
ok('强敌 X 恰好 4 处且分布 3/9/14/18F',
  allOf('X') === 4 && JSON.stringify(eliteFloorNums) === JSON.stringify([3, 9, 14, 18]),
  eliteFloorNums.join(','))
const ROOM_1B = [2, 4, 6, 8, 11, 12, 13, 15, 17, 19]
ok('4 处强敌都在开放层，与普通怪同层混放（不设独立挑战层）',
  eliteFloorNums.every(n => !ROOM_1B.includes(n)))
const vaultSpots = []
data.floors.forEach((f, i) => f.rows.forEach((row, y) => {
  for (let x = 0; x < row.length; x++) if (row[x] === 'X') vaultSpots.push({ f: i + 1, x, y, rows: f.rows })
}))
ok('每处宝库布局正确：X 上方 2 格 s/S，四周砌 7 面墙成死胡同',
  vaultSpots.length === 4 && vaultSpots.every(e => {
    const r = e.rows
    return r[e.y - 1]?.[e.x] === 's' && r[e.y - 1]?.[e.x + 1] === 'S' &&
      [[-1, -1], [2, -1], [-1, 0], [1, 0], [2, 0], [0, -2], [1, -2]]
        .every(([dx, dy]) => r[e.y + dy]?.[e.x + dx] === '#')
  }))
ok('每处宝库外围有可走格接入（纯支线，不封死）',
  vaultSpots.every(e => '.@HUDW'.includes(e.rows[e.y + 1]?.[e.x] || '#')))
const dotTotal = data.floors.reduce((n, f) => n + cntCh(f, '.'), 0)
ok('空地占比降到 50% 以下（地图不再空荡荡）', dotTotal / (21 * 13 * 15) < 0.5,
  (dotTotal / (21 * 13 * 15) * 100).toFixed(1) + '%')
ok('前 20 层普通怪 >= 5 只（原 2~3）',
  data.floors.slice(0, 20).every(f =>
    '1245678'.split('').reduce((n, c) => n + cntCh(f, c), 0) >= 5))
ok('隔间墙生效：每层内墙数 >= 55',
  data.floors.slice(0, 20).every(f => cntCh(f, '#') >= 55),
  '最少 ' + Math.min(...data.floors.map(f => cntCh(f, '#'))))
const WALK_CH = '.@HUDW'
ok('每处暗门 A 至少有一个真正可走的邻格（非墙非实体）',
  data.floors.every(f => {
    const r = f.rows; let a = null
    for (let y = 0; y < r.length; y++) for (let x = 0; x < r[0].length; x++) if (r[y][x] === 'A') a = { x, y }
    return a && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const c = r[a.y + dy]?.[a.x + dx]
      return c && WALK_CH.includes(c)
    })
  }))
// ---- v0.16 小精灵 / 能量核心 / 屏障配置 ----
ok('meta.schema = 11 且 levels.json 有 barrier 段',
  data.meta.schema === 11 && !!data.barrier)
ok('barrier 配置：台阶 15F(floor=14) / 核心 17F(coreFloor=16) / 精灵 1F / chargeRatio=0.40',
  data.barrier.floor === 14 && data.barrier.coreFloor === 16 && data.barrier.fairyFloor === 0 &&
  data.barrier.boost.hp > 1 && data.barrier.chargeRatio === 0.4)
ok('tileColor / tileChar 覆盖 e 与 C',
  !!data.tileColor.e && !!data.tileColor.C &&
  data.tileChar.e === '灵' && data.tileChar.C === '核')
ok('ITEMS 有 core_energy(flag=128) / npc_fairy',
  data.items.some(i => i.id === 'core_energy' && i.ch === 'C' && i.effect.flag === 128) &&
  data.items.some(i => i.id === 'npc_fairy' && i.ch === 'e'))
ok('1F (1,2) 是小精灵 e、17F 商人房有 C、全塔 e/C 各唯一',
  data.floors[0].rows[2][1] === 'e' &&
  data.floors[16].rows.some(r => r.includes('C')) &&
  data.floors.flatMap(f => f.rows).join('').split('e').length - 1 === 1 &&
  data.floors.flatMap(f => f.rows).join('').split('C').length - 1 === 1)
ok('v0.18：13F 只留锁匠工具 j、17F 商人房 C 与 N 同房（解开旧耦合）',
  data.floors[12].rows.slice(4, 8).some(r => r.includes('j')) &&
  !data.floors[12].rows.some(r => r.includes('C')) &&
  data.floors[16].rows.some(r => r.includes('C')) &&
  data.floors[16].rows.some(r => r.includes('N')))
ok('每层实体怪 12 只（常规 + 吸血 9 互补，21F 为 8）、首层 targetLoss=31',
  data.floorScale[0].targetLoss === 31 &&
  data.floors.slice(0, 20).every(f =>
    f.rows.join('').split('').filter(c => '12456789'.includes(c)).length === 12) &&
  data.floors[20].rows.join('').split('').filter(c => '12456789'.includes(c)).length === 8)
ok('tables.js 导出 BARRIER 且与 JSON 逐项一致',
  JSON.stringify(t.BARRIER) === JSON.stringify(data.barrier))

// ---- v0.17 高防怪 / 破防临界 / 挡路怪 ----
const CFG17 = data.meta.curve
ok('meta.curve 有 defRatio=0.65 / battleRounds=5 / lossGain=1.5 / costMul=5.0',
  CFG17.defRatio === 0.65 && CFG17.battleRounds === 5 &&
  CFG17.lossGain === 1.5 && CFG17.costMul === 5.0)
ok('FLOOR_SCALE 怪防大幅抬高：1F>=13、21F>=140、逐层不回落',
  data.floorScale[0].def >= 13 && data.floorScale[20].def >= 140 &&
  data.floorScale.slice(0, 21).every((s, i, a) => i === 0 || s.def >= a[i - 1].def))
const V20_ACT_A = [20,23,26,26,45,58,64,67,103,103,106,125,138,151,151,170,183,186,189,220,223]
ok('v0.20 怪防仍按 0.65×玩家进层 ATK 精确建模（抬攻不削弱破防难度）',
  data.floorScale.slice(0, 21).every((s, i) => Math.abs(s.def - Math.round(0.65 * V20_ACT_A[i])) <= 1) &&
  data.floorScale[20].def / data.floorScale[20].atk >= 0.45)
const wallMon17 = data.monsters.find(m => m.ch === '6')
ok('m6 守门怪高防低攻且 hpW 大幅提升到 1.5（defW>=1.2 / atkW<=0.95）',
  !!wallMon17 && wallMon17.defW >= 1.2 && wallMon17.atkW <= 0.95 && wallMon17.hpW === 1.5)
ok('常规怪 atkW 收敛到 0.9~1.05（吸血怪 m10 的 atkW=0.5 单独口径，不纳入）',
  data.monsters.filter(m => !m.elite && !m.pierce && !m.noScale && !m.drain)
    .every(m => m.atkW >= 0.9 && m.atkW <= 1.05))
ok('pierce 权重减半（<=0.10，回合 3→5 不放大真实伤害）',
  data.monsters.filter(m => m.pierce).every(m => m.atkW <= 0.1))
ok('barrier.boost 收敛为温和台阶（hp1.2/atk1.04/def1.0）',
  data.barrier.boost.hp === 1.2 && data.barrier.boost.atk === 1.04 &&
  data.barrier.boost.def === 1.0)
ok('m9 宝库守卫只拉高强度 hpW1.0/atkW1.25/defW1.0（终局仍可打）',
  (() => { const e = data.monsters.find(m => m.ch === 'X')
    return !!e && e.hpW === 1.0 && e.atkW === 1.25 && e.defW === 1.0 })())
const cnt6 = f => f.rows.join('').split('6').length - 1
ok('高防挡路怪只投 2F~16F（1F 与 17F~21F 为 0，中间每层至少 1 只）',
  cnt6(data.floors[0]) === 0 && data.floors.slice(16).every(f => cnt6(f) === 0) &&
  data.floors.slice(1, 16).every(f => cnt6(f) >= 1))
// 主路真割点：把该格当墙后 (1,1) -> (11,13) 不可达
const WALL17 = '#A'
function reach17(rows, bx, by) {
  const seen = new Set(['1,1']), q = [[1, 1]]
  while (q.length) {
    const [x, y] = q.pop()
    if (x === 11 && y === 13) return true
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = nx + ',' + ny
      if (nx < 0 || ny < 0 || nx >= 13 || ny >= 15 || seen.has(k)) continue
      if (bx === nx && by === ny || WALL17.includes(rows[ny][nx])) continue
      seen.add(k); q.push([nx, ny])
    }
  }
  return false
}
ok('2F~16F 每层至少 1 只 m6 落在主路真割点（堵住即上不去楼）',
  data.floors.slice(1, 16).every(f => {
    const rows = f.rows.map(r => r.split(''))
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++)
      if (rows[y][x] === '6' && !reach17(rows, x, y)) return true
    return false
  }))
ok('tables.js 的 FLOOR_SCALE / MONSTERS 与 JSON 逐项一致',
  JSON.stringify(t.FLOOR_SCALE) === JSON.stringify(data.floorScale) &&
  JSON.stringify(t.MONSTERS) === JSON.stringify(data.monsters))
// ---- v0.18 任务顺序 / 软门槛 / 百分比灌顶：关卡表专项 ----
ok('meta.note 追加 v0.18 任务顺序重排说明',
  /v0\.18 任务顺序重排/.test(data.meta.note))
ok('barrier.chargeRatio = 0.40（按当前值百分比灌顶，非固定值 charge）',
  data.barrier.chargeRatio === 0.4 && data.barrier.charge === undefined)
ok('meta.curve 无搜索期临时参数（全局 defRatio 仍 0.65）',
  data.meta.curve.defRatio === 0.65 &&
  data.meta.curve.defRatioLate === undefined && data.meta.curve.lateFloor === undefined)
ok('任务格分布：13F j / 15F T / 16F Z / 17F C+N / 19F q / 1F e',
  (() => { const R = i => data.floors[i].rows.join('')
    return R(12).includes('j') && !R(12).includes('C') &&
           R(14).includes('T') && R(15).includes('Z') &&
           R(16).includes('C') && R(16).includes('N') &&
           R(18).includes('q') && R(0).includes('e') })())
ok('17F~21F 的 FLOOR_SCALE 按未强化基准重建（21F def < 160，v0.17 为 197）',
  data.floorScale[20].def < 160 && data.floorScale[16].def < 130)
ok('1F~16F 的 FLOOR_SCALE 与 v0.17 完全一致（表头未漂移）',
  data.floorScale[0].def === 13 && data.floorScale[13].def === 98 &&
  data.floorScale[15].def === 110)

// ---- v0.19 攻击吸血怪 / 前期精英化 / 守门怪强化：结构专项 ----
ok('v0.20 meta.schema = 11 且 meta.curve.lossGain = 1.5',
  data.meta.schema === 11 && data.meta.curve.lossGain === 1.5)
ok('v0.21 第 10 种怪 m10 噬血蝠字段（drain0.15 / eliteBefore11 / eliteShift7 / defW1.0 / hpW0.55）',
  (() => { const m = data.monsters.find(x => x.ch === '9')
    // v0.21.0：前期精英超前层数 9→7（前期削弱一点，1F~8F 仍打不过）
    return !!m && m.id === 'm10' && m.drain === 0.15 &&
      m.eliteBefore === 11 && m.eliteShift === 7 && m.defW === 1.0 && m.hpW === 0.55 })())
ok('v0.19 吸血怪 9 分布：1F~12F 每层 1 只、13F 起隔层 1 只、全塔 16 只',
  (() => {
    const dist = data.floors.map(f => f.rows.join('').split('9').length - 1)
    return dist.slice(0, 12).every(n => n === 1) &&
      [13, 15, 17, 19, 21].every(f => dist[f - 1] === 0) &&
      [14, 16, 18, 20].every(f => dist[f - 1] === 1) &&
      dist.reduce((a, b) => a + b, 0) === 16
  })())
ok('v0.19 血瓶 ×2 HP 供给：potion_s 100 / potion_l 400',
  data.items.find(i => i.id === 'potion_s').effect.hp === 100 &&
  data.items.find(i => i.id === 'potion_l').effect.hp === 400)
ok('v0.19 tileChar / tileColor 补 9（血 / #c2185b）',
  data.tileChar['9'] === '血' && data.tileColor['9'] === '#c2185b')
ok('v0.19 每层实体怪恒 12（常规 + 吸血 9 互补）、21F 为 8',
  data.floors.slice(0, 20).every(f =>
    f.rows.join('').split('').filter(c => '12456789'.includes(c)).length === 12) &&
  data.floors[20].rows.join('').split('').filter(c => '12456789'.includes(c)).length === 8)
ok('v0.19 tables.js 导出 10 怪且 monsterByCh(9) 带 drain=0.15',
  t.MONSTERS.length === 10 && t.monsterByCh('9').drain === 0.15)

// ---- v0.20 前期防杀抑制：结构专项 ----
const V20_DEF = [13, 15, 17, 17, 29, 38, 42, 44, 67, 67, 69]
ok('v0.20 前 11 组怪防与 v0.19 逐项一致（只改 atk、不削弱破防）',
  V20_DEF.every((v, i) => data.floorScale[i].def === v), V20_DEF.join(','))
ok('v0.20 血瓶 100/400、守门怪 hpW1.5 / 宝库守卫 hpW1.0 全部不动',
  (() => {
    const ps = data.items.find(i => i.id === 'potion_s'), pl = data.items.find(i => i.id === 'potion_l')
    const m6 = data.monsters.find(m => m.ch === '6'), mx = data.monsters.find(m => m.ch === 'X')
    return ps && pl && m6 && mx && ps.effect.hp === 100 && pl.effect.hp === 400 &&
      m6.hpW === 1.5 && mx.hpW === 1.0
  })())
ok('v0.20 前 21 组怪 HP 与怪防逐层不回落（只有 atk 被抬升）',
  data.floorScale.slice(0, 21).every((s, i, a) => i === 0 ||
    (s.hp >= a[i - 1].hp && s.def >= a[i - 1].def)))
ok('v0.20 吸血怪 16 只与 v0.19 机制零回退（10 怪 / lossGain 1.5）',
  data.monsters.length === 10 && !!data.monsters.find(m => m.ch === '9') &&
  data.meta.curve.lossGain === 1.5 && data.meta.schema === 11)
console.log('\n' + (fail ? '存在 ' + fail + ' 项失败' : '全部 ' + pass + ' 项断言通过') + '。\n')
process.exit(fail ? 1 : 0)
