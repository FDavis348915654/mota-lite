// tools/validate_tables.js —— 改配置表后必跑：node validate_tables.js
// 防三件事：① 同名 key / 重复 id 静默覆盖  ② 地图结构错误导致换层落点越界
//          ③ 关卡不可解（初始属性 + 现有道具打不到通关）
import assert from 'node:assert/strict'
import {
  FLOORS, MONSTERS, ITEMS, HERO0, DOOR_KEY,
  monsterByCh, itemByCh
} from '../src/common/tables.js'
import { CONFIG, newGame, calcBattle, resolveStep, buildCells, serialize, deserialize } from '../src/common/logic.js'

let pass = 0
function ok(cond, label) {
  assert.ok(cond, '✗ ' + label)
  console.log('  ✓ ' + label)
  pass++
}
function eq(a, b, label) {
  assert.deepEqual(a, b, '✗ ' + label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a))
  console.log('  ✓ ' + label + ' = ' + JSON.stringify(a))
  pass++
}

console.log('\n[1] 重复 id / 同名 key 覆盖检查')
for (const [name, arr] of [['MONSTERS', MONSTERS], ['ITEMS', ITEMS], ['FLOORS.name', FLOORS]]) {
  const ids = arr.map(o => o.id !== undefined ? o.id : o.name)
  eq(new Set(ids).size, ids.length, name + ' 无重复 id')
}
// 表用数组而非对象字面量，重复 key 无法静默吞掉
ok(Array.isArray(MONSTERS) && Array.isArray(ITEMS), '怪物/道具表为数组（非对象字典）')

console.log('\n[2] 地图结构检查')
const W = FLOORS[0].rows[0].length
const H = FLOORS[0].rows.length
eq([W, H], [7, 9], '第 1 层尺寸 7x9（7*28=196 ≤ 212 宽）')
FLOORS.forEach((f, i) => {
  ok(f.rows.length === H && f.rows.every(r => r.length === W), f.name + ' 等宽等高（保证 cells 定长）')
})
const LEGAL = new Set([
  '.', '#', '@', 'Y', 'B', 'R', 'y', 'b', 'r', 'p', 'P', 'a', 'd',
  's', 'S', 'g', 'U', 'D', 'W', 'N', '1', '2', '3', '4', '5', '6', '7', '8', '9'
])
FLOORS.forEach(f => {
  const bad = []
  f.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!LEGAL.has(ch)) bad.push(f.name + '(' + x + ',' + y + ')=' + ch)
    if (/[1-9]/.test(ch) && !monsterByCh(ch)) bad.push(f.name + ' 怪物字符 ' + ch + ' 无对应 MONSTERS 条目')
    if (itemByCh(ch) && LEGAL.has(ch)) { /* 已登记 */ }
  }))
  eq(bad, [], f.name + ' 无不合法字符 / 孤儿怪物')
})
FLOORS.forEach((f, i) => {
  if (f.up)   eq(f.rows[f.up.y][f.up.x],     'U', f.name + '.up 坐标确实落在 U 上')
  if (f.down) eq(f.rows[f.down.y][f.down.x], 'D', f.name + '.down 坐标确实落在 D 上')
  ok(i === 0 ? f.down === null : !!f.down, f.name + (i === 0 ? ' 首层无 D' : ' 有 D'))
  ok(i === FLOORS.length - 1 ? f.up === null : !!f.up, f.name + (i === FLOORS.length - 1 ? ' 末层无 U' : ' 有 U'))
})
// 楼梯双向配对：踩 U 上楼后要落在相邻层的 D，踩 D 下楼后要落在相邻层的 U
FLOORS.forEach((f, i) => {
  if (f.up)   ok(!!FLOORS[i + 1] && !!FLOORS[i + 1].down, f.name + '.U -> ' + FLOORS[i + 1].name + '.D 配对')
  if (f.down) ok(!!FLOORS[i - 1] && !!FLOORS[i - 1].up,   f.name + '.D -> ' + FLOORS[i - 1].name + '.U 配对')
})
const spawnCount = FLOORS.reduce((n, f) => n + f.rows.join('').split('@').length - 1, 0)
eq(spawnCount, 1, '全表恰好 1 个出生点 @')

console.log('\n[3] 战斗公式断言（确定性、无随机）')
const m1 = monsterByCh('1'), m2 = monsterByCh('2'), m3 = monsterByCh('3')
let r = calcBattle(HERO0, m1)
eq([r.ok, r.perHit, r.rounds, r.hpCost], [true, 8, 3, 0], '开局打史莱姆：防杀 0 损血')
r = calcBattle({ hp: 200, atk: 20, def: 10 }, m2)
eq([r.perHit, r.rounds, r.hpCost], [15, 3, 8], '拿剑后打蝙蝠：损血 8（体现剑盾优先）')
r = calcBattle(HERO0, m3)
eq(r.reason, 'unbreakable', '裸属性打魔王：ATK<=DEF 不可破防')
r = calcBattle({ hp: 450, atk: 20, def: 10 }, m3)
eq([r.ok, r.perHit, r.rounds, r.hpCost], [true, 6, 17, 352], '收齐血瓶后打魔王：可胜，损血 352')
// FIRST_STRIKE 开关验证：差一错误不能悄悄出现
const savedFS = CONFIG.FIRST_STRIKE
CONFIG.FIRST_STRIKE = false
eq(calcBattle({ hp: 999, atk: 20, def: 10 }, m2).hpCost, 12, '关闭玩家先手 -> rounds*monPerHit')
CONFIG.FIRST_STRIKE = savedFS

console.log('\n[4] 逻辑层：定长 cells / 存档往返 / 变更集')
let s = newGame()
eq(buildCells(s).length, W * H, 'buildCells 定长 63 槽位（节点数恒定）')
ok(buildCells(s).filter(c => c.isHero).length === 1, '玩家高亮恰好 1 格')
const s2 = deserialize(serialize(s))
eq(s2.floor, 0, 'serialize -> deserialize 往返可用')
eq(s2.hero.hp, 200, '紧凑存档往返 hero 属性无损')
eq(deserialize('{bad json'), null, '坏存档安全返回 null')

// 轻量穿戴的 @system.storage.set 要求 value < 128 字节；JSON 存档会超，故 logic.js 用紧凑串。
// 这里按「全图所有可变更格都被打开」构造最坏存档，验证上限。
const mutable = []
FLOORS.forEach((f, fi) => {
  f.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (itemByCh(ch) || monsterByCh(ch) || DOOR_KEY[ch]) mutable.push([fi, y * W + x])
  }))
})
const worstOpened = {}
mutable.forEach(pair => {
  if (!worstOpened[pair[0]]) worstOpened[pair[0]] = {}
  worstOpened[pair[0]][pair[1]] = '.'
})
const worst = {
  floor: FLOORS.length - 1, x: 6, y: 8,
  hero: { hp: 9999, atk: 999, def: 999, gold: 9999, keys: { y: 9, b: 9, r: 9 } },
  opened: worstOpened,
  ended: null
}
const packed = serialize(worst)
ok(Buffer.byteLength(packed, 'utf8') < CONFIG.SAVE_LIMIT,
  '最坏存档 ' + Buffer.byteLength(packed, 'utf8') + 'B < 128B（可变更格 ' + mutable.length + ' 个）')
eq(deserialize(packed).hero.hp, 9999, '最坏存档可无损往返')

console.log('\n[5] 可解性：BFS 搜索一条真实通关路线')
// 状态空间小（3 层 63 格），用「一次 resolveStep = 一步」穷举，证明关卡不是死局
const DIRS = ['up', 'down', 'left', 'right']
const q = [{ s: newGame(), n: 0 }]
const seen = new Set([serialize(q[0].s)])
let head = 0, solution = null
const MAX = 200000
while (head < q.length && seen.size < MAX) {
  const cur = q[head++]
  for (const d of DIRS) {
    const { state: ns } = resolveStep(cur.s, d)
    if (ns.ended === 'dead') continue
    if (ns.ended === 'win') { solution = { n: cur.n + 1, hero: ns.hero }; break }
    const k = serialize(ns)
    if (seen.has(k)) continue
    seen.add(k)
    q.push({ s: ns, n: cur.n + 1 })
  }
  if (solution) break
}
ok(!!solution, '存在通关路线（BFS 展开 ' + seen.size + ' 个状态）')
if (solution) {
  console.log('    最短步数 = ' + solution.n + '，通关属性 = ' + JSON.stringify({
    hp: solution.hero.hp, atk: solution.hero.atk, def: solution.hero.def, gold: solution.hero.gold
  }))
  ok(solution.hero.hp > 0, '通关时 HP > 0')
  ok(solution.hero.atk > HERO0.atk, '必须拾取成长道具才能通关（验证路线规划价值）')
}

console.log('\n[6] 事件协议：只有改变持久状态才发 save')
const hasSave = (st, d) => resolveStep(st, d).events.some(e => e.t === 'save')
const s0 = newGame()
eq(hasSave(s0, 'down'), false, '撞墙不发 save（(1,8) 是墙）')
eq(hasSave(s0, 'right'), false, '普通走格不发 save')
eq(hasSave(s0, 'up'), true, '拾取道具发 save')
const noKey = {
  floor: 0, x: 4, y: 3,
  hero: JSON.parse(JSON.stringify(HERO0)), opened: {}, ended: null
}
eq(hasSave(noKey, 'right'), false, '缺钥匙被拦，不发 save')
const weak = {
  floor: 2, x: 3, y: 6,
  hero: JSON.parse(JSON.stringify(HERO0)), opened: {}, ended: null
}
eq(hasSave(weak, 'up'), false, '打不过魔王被拦，不发 save')
eq(resolveStep(s0, 'down').events.filter(e => e.t === 'msg').length, 1, '撞墙只回一条提示')

console.log('\n全部 ' + pass + ' 项断言通过。改完 tables.js 记得重跑：node tools/validate_tables.js\n')
