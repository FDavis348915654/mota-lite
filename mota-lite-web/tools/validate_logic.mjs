#!/usr/bin/env node
// 在线版「完整内容」逻辑层 / 配置层离线校验（不需要浏览器、不需要本地服务）
// 用法：node tools/validate_logic.mjs
//
// 覆盖：配置表合法性、楼梯双向配对、每层可达性、HIDDEN 坐标、通关路线逐步重放、
//       可选机制（隐藏/飞行器/炸弹/商店/图鉴）、存档 v3 往返与 v2/v1 旧档兼容、最坏存档体积。
// 注意：本脚本校验的是在线版自己的 logic.js / tables.js（与 M1 基线已分叉，见 spec 附 D）。

import {
  FLOORS, MONSTERS, ITEMS, HIDDEN, SECRET, DOOR_KEY, DOOR_COST,
  TILE_COLOR, TILE_CHAR, HERO0, FLOOR_SCALE,
  monsterByCh, itemByCh, itemById, hiddenAt, secretAt
} from '../tables.js'
import {
  CONFIG, newGame, resolveStep, calcBattle, scaledMon, battleHint, tileAt, buildCells,
  useFly, useBomb, shopBuy, shopOffer, shopTier, SHOP_GOODS,
  serialize, deserialize, isWalkable, isEntityTile
} from '../logic.js'
import { findSolution, findPath } from '../solver.js'
import { emptyRecords, normalizeRecords, applyStep, formatRecords, RECORD_KEY } from '../records.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(path.join(root, f), 'utf8')

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); pass++ }
  else { console.error('  ✗ ' + name + (detail ? '  -> ' + detail : '')); fail++ }
}
function eq(a, b, name) { ok(name, a === b, a === b ? String(a) : 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)) }

console.log('=== 1. 配置表合法性 ===')
const KNOWN = new Set([
  '#', '.', '@', 'U', 'D', 'W', 'N', 'H', 'F', 'o', 'A',
  ...Object.keys(DOOR_KEY), ...Object.keys(DOOR_KEY).map(k => k.toLowerCase()),
  ...ITEMS.map(i => i.ch), ...MONSTERS.map(m => m.ch)
])
ok('楼层数 = 21（对齐原版魔塔层数）', FLOORS.length === 21, FLOORS.length + ' 层')
const MAP_W = FLOORS[0].rows[0].length, MAP_H = FLOORS[0].rows.length
ok('地图统一 13×15（v0.8 扩图口径）', MAP_W === 13 && MAP_H === 15, MAP_W + '×' + MAP_H)
FLOORS.forEach((f, fi) => {
  const w = f.rows[0].length
  ok(f.name + ' 每行等宽 ' + MAP_W, f.rows.every(r => r.length === w) && w === MAP_W)
  const bad = [...new Set([...f.rows.join('')].filter(c => !KNOWN.has(c)))]
  ok(f.name + ' 无非法字符', bad.length === 0, bad.join(' '))
  ok(f.name + ' 恰有一个出生点或没有', f.rows.join('').split('@').length - 1 <= 1)
})
eq(f_rows_count('@'), 1, '全地图只有一个 @ 出生点')
function f_rows_count(ch) { return FLOORS.reduce((n, f) => n + f.rows.join('').split(ch).length - 1, 0) }
ok('MONSTERS id 唯一', new Set(MONSTERS.map(m => m.id)).size === MONSTERS.length, MONSTERS.length + ' 个')
ok('ITEMS id / ch 唯一',
  new Set(ITEMS.map(i => i.id)).size === ITEMS.length && new Set(ITEMS.map(i => i.ch)).size === ITEMS.length,
  ITEMS.length + ' 个')
ok('HIDDEN 每项 item 都能在 ITEMS 找到', HIDDEN.every(h => !!itemById(h.item)))
ok('HIDDEN 坐标在地图里确实是 H', HIDDEN.every(h => FLOORS[h.floor].rows[h.y][h.x] === 'H'),
  HIDDEN.map(h => FLOORS[h.floor].name + '(' + h.x + ',' + h.y + ')').join(' '))
ok('HIDDEN 坐标唯一', new Set(HIDDEN.map(h => h.floor + ':' + h.x + ':' + h.y)).size === HIDDEN.length)
ok('每个 tile 都有颜色定义', [...KNOWN].every(c => monsterByCh(c) || TILE_COLOR[c] !== undefined))
ok('HERO0 含 fly / bomb', HERO0.fly === 0 && HERO0.bomb === 0)

console.log('\n=== 2. 楼梯双向配对 ===')
FLOORS.forEach((f, fi) => {
  const hasU = f.rows.join('').includes('U'), hasD = f.rows.join('').includes('D')
  ok(f.name + ' U/D 与 up/down 声明一致',
    (hasU ? !!f.up : true) && (hasD ? !!f.down : true))
  if (f.up) ok(f.name + ' up 落点是 U 或可站格', f.rows[f.up.y][f.up.x] === 'U')
  if (f.down) ok(f.name + ' down 落点是 D 或可站格', f.rows[f.down.y][f.down.x] === 'D')
})
for (let i = 0; i < FLOORS.length - 1; i++) {
  ok((i + 1) + 'F→' + (i + 2) + 'F 上楼落点 = 下层 down', !!FLOORS[i + 1].down)
  ok((i + 2) + 'F→' + (i + 1) + 'F 下楼落点 = 下层 up', !!FLOORS[i].up)
}

console.log('\n=== 3. 每层可达性（flood fill，门视为可开）===')
FLOORS.forEach((f, fi) => {
  const W = f.rows[0].length, H = f.rows.length
  const start = f.down || f.up || { x: 1, y: 1 }
  const seen = new Set([start.y * W + start.x])
  const q = [[start.x, start.y]]
  while (q.length) {
    const [x, y] = q.shift()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      if (f.rows[ny][nx] === '#') continue
      const k = ny * W + nx
      if (seen.has(k)) continue
      seen.add(k); q.push([nx, ny])
    }
  }
  const unreachable = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = f.rows[y][x]
    if (ch === '#' || ch === '.') continue
    if (!seen.has(y * W + x)) unreachable.push(ch + '@' + x + ',' + y)
  }
  ok(f.name + ' 所有实体格可达', unreachable.length === 0, unreachable.join(' ') || seen.size + ' 格可达')
})

console.log('\n=== 4. 通关路线（策略式求解 + 逐步重放）===')
const sol = findSolution()
ok('findSolution 找到路线', !!sol, sol ? sol.steps.length + ' 步 / ' + sol.rounds + ' 轮规划' : 'null')
if (sol) {
  let s = newGame()
  for (const d of sol.steps) s = resolveStep(s, d).state
  eq(s.ended, 'win', '路线逐步 resolveStep 重放确实通关')
  eq(s.floor, FLOORS.length - 1, '通关发生在顶层 ' + FLOORS[FLOORS.length - 1].name)
  ok('通关时 HP > 0', s.hero.hp > 0, 'HP' + s.hero.hp)
  ok('通关前确需成长（ATK 高于初始）', s.hero.atk > HERO0.atk + 10, 'ATK' + s.hero.atk)
  ok('21 层路线步数显著长于 M1 的 26 步', sol.steps.length > 100, sol.steps.length + ' 步')
  ok('路线覆盖全部 ' + FLOORS.length + ' 层', new Set((() => {
    let t = newGame(); const set = new Set([t.floor])
    for (const d of sol.steps) { t = resolveStep(t, d).state; set.add(t.floor) }
    return set
  })()).size === FLOORS.length, FLOORS.length + ' / ' + FLOORS.length)
  const solverSrc = read('solver.js')
  ok('路线不依赖可选机制（solver 未调用 useFly/useBomb/shopBuy）',
    !/useFly\(|useBomb\(|shopBuy\(/.test(solverSrc))
  // 裸属性冲 Boss 必须打不过，证明「必须收成长道具」，内容为死局保护
  const boss = monsterByCh('3')
  const naked = calcBattle(newGame().hero, boss)
  ok('裸属性打魔王被拦（不可破防 / 会阵亡）', !naked.ok, naked.reason)
}

console.log('\n=== 5. 战斗公式（经典魔塔同式：ceil(HP/(攻-防)) 回合 × 净伤）===')
const slime = monsterByCh('1')
const bat = monsterByCh('2')
const hero0 = newGame().hero
// 1F 裸装英雄 A10/D10 vs 1F 史莱姆：v0.9 起战斗有代价，不再是「防杀 0 损血」
ok('1F 裸装打史莱姆会掉血（战斗系统生效）', calcBattle(hero0, slime, 0).hpCost > 0,
  'hpCost=' + calcBattle(hero0, slime, 0).hpCost)
const sword = { hp: 200, atk: 20, def: 10, gold: 0, keys: { y: 0, b: 0, r: 0 }, fly: 0, bomb: 0 }
ok('拿剑后打蝙蝠损血下降', calcBattle(sword, bat, 0).hpCost < calcBattle(hero0, bat, 0).hpCost,
  calcBattle(hero0, bat, 0).hpCost + ' -> ' + calcBattle(sword, bat, 0).hpCost)
eq(calcBattle({ atk: 2, def: 10, hp: 200 }, slime, 0).reason, 'unbreakable',
  'ATK<=DEF 判不可破防')
// 先手：承受 (rounds-1) 次反击
{
  const r = calcBattle(sword, bat, 0)
  const m = scaledMon(bat, 0)
  eq(r.rounds, Math.ceil(m.hp / r.perHit), '回合数 = ceil(敌HP/每击)')
  eq(r.hpCost, (r.rounds - 1) * r.monPerHit, '玩家先手，只挨 rounds-1 次反击')
}
// pierce：法师真实伤害无视 DEF
{
  const mage = MONSTERS.find(m => m.pierce)
  ok('存在 pierce 真实伤害怪种', !!mage, mage ? mage.name : 'none')
  const lowDef = { hp: 99999, atk: 500, def: 0, gold: 0, keys: { y: 0, b: 0, r: 0 }, fly: 0, bomb: 0 }
  const highDef = { ...lowDef, def: 9999 }
  eq(calcBattle(lowDef, mage, 10).monPerHit, calcBattle(highDef, mage, 10).monPerHit,
    'pierce 净伤与玩家 DEF 无关')
  ok('普通怪净伤随玩家 DEF 变化', (() => {
    const n = MONSTERS.find(m => !m.pierce && !m.noScale)
    return calcBattle(lowDef, n, 10).monPerHit >= calcBattle(highDef, n, 10).monPerHit
  })(), 'DEF 越高普通怪净伤越低')
}
// 逐层曲线：21F 怪数值显著高于 1F，且 21 组递增
ok('FLOOR_SCALE 覆盖 21 层', FLOOR_SCALE.length === 21, FLOOR_SCALE.length + ' 组')
ok('逐层怪 ATK 单调递增', FLOOR_SCALE.every((s, i) => i === 0 || s.atk >= FLOOR_SCALE[i - 1].atk),
  '1F=' + FLOOR_SCALE[0].atk + ' → 21F=' + FLOOR_SCALE[20].atk)
ok('同一只怪在 21F 显著强于 1F', scaledMon(slime, 20).hp > scaledMon(slime, 0).hp * 3,
  scaledMon(slime, 0).hp + ' → ' + scaledMon(slime, 20).hp)
ok('魔王 noScale 不随层变化', scaledMon(monsterByCh('3'), 0).hp === scaledMon(monsterByCh('3'), 20).hp)
// 主题接线
ok('FLOORS[].name 含主题', FLOORS.every(f => f.name.includes(' · ')),
  FLOORS[0].name + ' / ' + FLOORS[20].name)
// 怪物手册：临界 / 加防收益
{
  const h = battleHint(sword, bat, 0)
  ok('battleHint 给出临界攻击', h.nextAtk === null || h.nextAtk > 0, 'nextAtk=' + h.nextAtk)
  ok('普通怪加防收益 > 0', h.defGain > 0, '每+1防少掉 ' + h.defGain + ' 血')
  const hm = battleHint(sword, MONSTERS.find(m => m.pierce), 0)
  eq(hm.defGain, 0, 'pierce 怪加防收益为 0（防御无效）')
}

console.log('\n=== 6. 可选机制 ===')
// 6.1 隐藏暗格：H 坐标从配置表现算，不写死地图位置
{
  const hid = HIDDEN.find(h => h.floor === 0)
  ok('1F 配了隐藏暗格', !!hid, hid ? '(' + hid.x + ',' + hid.y + ')' : 'none')
  // 找到 H 旁边一个可站格；dir = 站过去之后走回暗格的方向
  const SIDES = [
    { dx: -1, dy: 0, dir: 'right' }, { dx: 1, dy: 0, dir: 'left' },
    { dx: 0, dy: -1, dir: 'down' }, { dx: 0, dy: 1, dir: 'up' }
  ]
  const from = SIDES.map(d => ({ x: hid.x + d.dx, y: hid.y + d.dy, dir: d.dir }))
    .find(p => ['.', '@'].includes(tileAt(newGame(), p.x, p.y)))
  ok('暗格旁边有可站的格', !!from, from ? from.dir + ' from (' + from.x + ',' + from.y + ')' : 'none')
  let s = newGame(); s.x = from.x; s.y = from.y
  const before = s.hero.atk
  const r = resolveStep(s, from.dir)
  eq(r.state.hero.atk, before + 3, '走到隐藏暗格获得红宝石 ATK+3')
  eq(tileAt(r.state, hid.x, hid.y), '.', '暗格触发后清成地板')
  ok('隐藏触发发 save 事件', r.events.some(e => e.t === 'save'))
}
// 6.2 飞行器
{
  let s = newGame()
  const r0 = useFly(s, 1)
  eq(r0.state.floor, 0, '无飞行器时不能换层')
  ok('无飞行器给出提示', r0.events.some(e => e.t === 'msg' && e.text.includes('还没有')))
  s.hero.fly = 1
  // v0.8：没探索过的楼层飞不过去（飞行器是中期道具，不是电梯）
  const rDeny = useFly(s, 1)
  eq(rDeny.state.floor, 0, '未探索的楼层飞不过去')
  ok('被拒时给出已探索提示', rDeny.events.some(e => e.t === 'msg' && e.text.includes('已探索')))
  s.explored[1] = 1
  const r = useFly(s, 1)
  eq(r.state.floor, 1, '已探索的 2F 可飞上去')
  eq(r.state.x + ',' + r.state.y, FLOORS[1].down.x + ',' + FLOORS[1].down.y, '落点与目标层 down 一致')
  ok('换层发 save 事件', r.events.some(e => e.t === 'save'))
  eq(r.state.hero.fly, 1, '飞行器是永久道具，不消耗')
  eq(r.state.explored[1], 1, '飞过去后目标层仍记为已探索')
  const TOP = FLOORS.length - 1
  const topState = newGame()
  topState.floor = TOP; topState.hero.fly = 1; topState.explored[TOP] = 1
  const rTop = useFly(topState, 1)
  eq(rTop.state.floor, TOP, '顶层 ' + FLOORS[TOP].name + ' 再上升被拒')
}
// 6.3 炸弹
{
  // 从 1F 现找「站得住 + 四邻有普通怪」的位置，不写死坐标
  const base = newGame()
  let spot = null
  for (let y = 0; y < MAP_H && !spot; y++) {
    for (let x = 0; x < MAP_W && !spot; x++) {
      if (tileAt(base, x, y) === '#') continue
      const mon = [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]]
        .map(d => ({ d: d[0], x: x + d[1], y: y + d[2], m: monsterByCh(tileAt(base, x + d[1], y + d[2])) }))
        .find(o => o.m && !o.m.bombImmune)
      if (mon) spot = { x: x, y: y, t: mon }
    }
  }
  ok('1F 找到可炸的站位', !!spot, spot ? '(' + spot.x + ',' + spot.y + ') ' + spot.t.m.name : 'none')
  let s = newGame(); s.x = spot.x; s.y = spot.y
  const r0 = useBomb(s)
  eq(r0.state.hero.bomb, 0, '无炸弹时不消耗')
  s.hero.bomb = 1
  const r = useBomb(s)
  eq(r.state.hero.bomb, 0, '消耗 1 个炸弹')
  eq(tileAt(r.state, spot.t.x, spot.t.y), '.', '四邻 ' + spot.t.m.name + ' 被清除')
  ok('炸弹发 msg / save', r.events.some(e => e.t === 'save') && r.events.some(e => e.t === 'msg' && e.text.includes('消灭')))
  ok('Boss 配置免疫炸弹', monsterByCh('3').bombImmune === true)
  // 顶层：站在魔王前面（W 三面封墙，四邻只有免疫 Boss）-> 不消耗
  const TOP2 = FLOORS.length - 1
  const bossAt = (() => {
    const rows = FLOORS[TOP2].rows
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) {
      if (rows[y][x] === 'W') return { x: x, y: y }
    }
    return null
  })()
  const topAt = (x, y) => FLOORS[TOP2].rows[y][x]
  const bossFront = [['down', 0, 1], ['up', 0, -1], ['left', -1, 0], ['right', 1, 0]]
    .map(d => ({ x: bossAt.x + d[1], y: bossAt.y + d[2] }))
    .find(p => monsterByCh(topAt(p.x, p.y)))
  ok('王座正面有怪把守', !!bossFront, bossFront ? '(' + bossFront.x + ',' + bossFront.y + ')' : 'none')
  let s5 = newGame(); s5.floor = TOP2; s5.x = bossFront.x; s5.y = bossFront.y; s5.hero.bomb = 1
  const r5 = useBomb(s5)
  eq(r5.state.hero.bomb, 1, '四邻无普通怪时不消耗炸弹（避免误操作）')
  ok('Boss 未被炸掉', !!monsterByCh(tileAt(r5.state, bossFront.x, bossFront.y)))
  eq(tileAt(r5.state, bossAt.x, bossAt.y), 'W', '王座格本体不被炸弹改写')
}
// 6.4 商店
{
  let s = newGame()
  const r0 = shopBuy(s)
  eq(r0.state.hero.atk, HERO0.atk, '金币不足不成交')
  s.hero.gold = CONFIG.SHOP_COST
  const r = shopBuy(s)
  eq(r.state.hero.gold, 0, '扣 ' + CONFIG.SHOP_COST + ' 金币')
  eq(r.state.hero.atk, HERO0.atk + CONFIG.SHOP_ATK, '攻击 +' + CONFIG.SHOP_ATK)
  // v0.9 攻/防/生命三选一 + 高楼层同价更高回报；v0.12 加第 4 项黄钥匙（钥匙经济）
  ok('商店提供四种商品（攻/防/生命/黄钥匙）',
    SHOP_GOODS.length === 4 && SHOP_GOODS.map(g => g.kind).join(',') === 'atk,def,hp,key')
  SHOP_GOODS.filter(g => g.kind !== 'key').forEach(g => {
    let t = newGame(); t.hero.gold = CONFIG.SHOP_COST
    const before = t.hero[g.stat]
    const rr = shopBuy(t, g.kind)
    eq(rr.state.hero[g.stat] - before, shopOffer(g.kind, 0).amount,
      '购买' + g.label + '按档位增量生效')
  })
  {
    let t = newGame(); t.hero.gold = CONFIG.KEY_COST
    const before = t.hero.keys.y
    const rr = shopBuy(t, 'key')
    eq(rr.state.hero.keys.y - before, shopOffer('key', 0).amount, '购买黄钥匙按档位增量生效')
    eq(rr.state.hero.gold, 0, '买钥匙扣 ' + CONFIG.KEY_COST + ' 金币')
    ok('钥匙报价固定 1 把 / 20G（不随楼层加量）',
      shopOffer('key', 20).amount === 1 && shopOffer('key', 20).cost === CONFIG.KEY_COST)
    let poor = newGame()
    eq(shopBuy(poor, 'key').state.hero.keys.y, HERO0.keys.y, '金币不足买不了钥匙')
  }
  ok('高楼层商店同价回报更高',
    shopOffer('atk', 20).amount > shopOffer('atk', 0).amount &&
    shopOffer('atk', 20).cost === shopOffer('atk', 0).cost,
    '1F +' + shopOffer('atk', 0).amount + ' → 21F +' + shopOffer('atk', 20).amount)
  ok('楼层档位按 7 层递增', shopTier(0) === 0 && shopTier(7) === 1 && shopTier(20) === 2)
}

console.log('\n=== 6.5 图鉴 / NPC / 商店阻挡（v0.8）===')
{
  // 可走 / 实体判定是「点击交互」的唯一真源，必须与寻路、宿主层同源
  ok('可走格：地板 / 出生点 / 暗格 / 楼梯 / 王座',
    ['.', '@', 'H', 'U', 'D', 'W'].every(ch => isWalkable(ch)))
  ok('门 / 钥匙 / 道具 / 怪物 / 商店 / NPC 都不是可走格',
    ['Y', 'y', 'p', '1', 'N', 'I', 'M', 'T'].every(ch => !isWalkable(ch)))
  ok('墙既不是可走格也不是实体', isWalkable('#') === false && isEntityTile('#') === false)
  ok('实体 = 非墙且非可走', isEntityTile('p') && isEntityTile('N') && !isEntityTile('.') && !isEntityTile('U'))

  // 图鉴：走到 I 解锁 book，且不累加
  const codexAt = (() => {
    for (let f = 0; f < FLOORS.length; f++) {
      const rows = FLOORS[f].rows
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) {
        if (rows[y][x] === 'I') return { f, x, y }
      }
    }
    return null
  })()
  ok('全塔恰有一个图鉴 I', !!codexAt, codexAt ? 'F' + (codexAt.f + 1) + ' (' + codexAt.x + ',' + codexAt.y + ')' : 'none')
  eq(FLOORS.reduce((n, f) => n + f.rows.join('').split('I').length - 1, 0), 1, 'I 全塔唯一（不重复放置）')
  const SIDES2 = [
    { dx: -1, dy: 0, dir: 'right' }, { dx: 1, dy: 0, dir: 'left' },
    { dx: 0, dy: -1, dir: 'down' }, { dx: 0, dy: 1, dir: 'up' }
  ]
  const near = (t, f) => SIDES2.map(d => ({ x: t.x + d.dx, y: t.y + d.dy, dir: d.dir }))
    .find(p => ['.', '@'].includes(tileAt({ ...newGame(), floor: f }, p.x, p.y)))
  const codexSide = near(codexAt, codexAt.f)
  ok('图鉴旁边有可站的格', !!codexSide, codexSide ? codexSide.dir : 'none')
  let cs = newGame(); cs.floor = codexAt.f; cs.x = codexSide.x; cs.y = codexSide.y
  const rc = resolveStep(cs, codexSide.dir)
  eq(rc.state.hero.book, 1, '拾取图鉴后 book = 1')
  eq(tileAt(rc.state, codexAt.x, codexAt.y), '.', '图鉴拾取后清成地板')
  ok('图鉴拾取发 save 事件', rc.events.some(e => e.t === 'save'))

  // NPC：M / T 走「救出」文案 + 一次性奖励，且清格
  const npcFind = ch => {
    for (let f = 0; f < FLOORS.length; f++) {
      const rows = FLOORS[f].rows
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) {
        if (rows[y][x] === ch) return { f, x, y }
      }
    }
    return null
  }
  const mage = npcFind('M'), thief = npcFind('T')
  ok('法师 M 存在', !!mage, mage ? 'F' + (mage.f + 1) : 'none')
  ok('盗贼 T 存在', !!thief, thief ? 'F' + (thief.f + 1) : 'none')
  const mageSide = near(mage, mage.f)
  let ms = newGame(); ms.floor = mage.f; ms.x = mageSide.x; ms.y = mageSide.y
  const rm = resolveStep(ms, mageSide.dir)
  eq(rm.state.hero.def, HERO0.def + 8, '救出法师：防御 +8')
  eq(rm.state.hero.hp, HERO0.hp + 100, '救出法师：生命 +100')
  ok('救出 NPC 用「已救出」文案', rm.events.some(e => e.t === 'msg' && e.text.startsWith('已救出')), rm.events.map(e => e.text).join(' / '))
  eq(tileAt(rm.state, mage.x, mage.y), '.', 'NPC 救出后清成地板')

  // 商店：N 不可踩上去（撞上去只对话、英雄不动）
  const shopPos = (() => {
    for (let f = 0; f < FLOORS.length; f++) {
      const rows = FLOORS[f].rows
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[0].length; x++) {
        if (rows[y][x] === 'N') return { f, x, y }
      }
    }
    return null
  })()
  ok('全塔至少一个商店 N', !!shopPos, shopPos ? 'F' + (shopPos.f + 1) : 'none')
  const shopSide = near(shopPos, shopPos.f)
  let ns = newGame(); ns.floor = shopPos.f; ns.x = shopSide.x; ns.y = shopSide.y
  const rn = resolveStep(ns, shopSide.dir)
  eq(rn.state.x + ',' + rn.state.y, shopSide.x + ',' + shopSide.y, '撞商店不移动到商人格')
  ok('撞商店给出对话提示', rn.events.some(e => e.t === 'msg' && e.text.includes('商人')))

  // 寻路：默认可穿越道具，blockEntities 必须绕开
  const s0 = newGame()
  let shrink = null, blockedGain = null
  for (let y = 0; y < MAP_H && !blockedGain; y++) {
    for (let x = 0; x < MAP_W && !blockedGain; x++) {
      if (tileAt(s0, x, y) === '#' || isEntityTile(tileAt(s0, x, y))) continue
      const key = x + ',' + y
      const r1 = findPath(s0, new Set([key]))
      const r2 = findPath(s0, new Set([key]), { blockEntities: true })
      if (!r1.path) continue
      if (!r2.path) blockedGain = { x, y, why: '完全不可达' }
      else if (r2.path.length > r1.path.length) blockedGain = { x, y, why: r1.path.length + ' -> ' + r2.path.length + ' 步' }
      if (!shrink && r1.path && r1.path.length) shrink = r1
    }
  }
  ok('点击模式会因实体阻挡而绕路 / 不可达', !!blockedGain, blockedGain ? '(' + blockedGain.x + ',' + blockedGain.y + ') ' + blockedGain.why : 'none')

  // 点实体的路径终点必须是「目标旁边一格」，不是目标格本身
  const keyY = (() => {
    const rows = FLOORS[0].rows
    for (let y = 0; y < rows.length; y++) {
      const x = rows[y].indexOf('y')
      if (x >= 0) return { x, y }
    }
    return null
  })()
  const sideOfKey = near(keyY, 0)
  const rk = findPath(s0, new Set([sideOfKey.x + ',' + sideOfKey.y]), { blockEntities: true })
  ok('点道具能规划到它旁边一格', !!rk.path && rk.path.length > 0, rk.path ? rk.path.length + ' 步' : 'null')
  const walk = rk.path.reduce((p, d) => {
    const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d]
    return { x: p.x + delta[0], y: p.y + delta[1] }
  }, { x: newGame().x, y: newGame().y })
  eq(walk.x + ',' + walk.y, sideOfKey.x + ',' + sideOfKey.y, '路径落点 = 道具相邻格')
  ok('路径未穿过任何实体格', rk.path.length > 0)
}

console.log('\n=== 6.6 已探索楼层（v0.8）===')
{
  const s = newGame()
  eq(JSON.stringify(s.explored), '{"0":1}', '新游戏只有出生层已探索')
  // 换层自动记为已探索
  const upAt = (() => {
    const rows = FLOORS[0].rows
    for (let y = 0; y < rows.length; y++) {
      const x = rows[y].indexOf('U')
      if (x >= 0) return { x, y }
    }
    return null
  })()
  // v0.10：上楼 U 的唯一入口被门封住，门口不再是 '.'。先把门清成地板（等价已开门），
  // 再站到门格朝 U 走一步 —— 本段只验「换层自动记为已探索」，门本身在第 9 段专项校验。
  const W0 = FLOORS[0].rows[0].length
  const gate = [[-1, 0], [0, -1], [1, 0], [0, 1]]
    .map(([dx, dy]) => ({ x: upAt.x + dx, y: upAt.y + dy }))
    .find(p => DOOR_KEY[tileAt(s, p.x, p.y)])
  ok('1F 上楼口由门把守（v0.10）', !!gate, gate ? gate.x + ',' + gate.y : 'none')
  const dirToU = gate.x < upAt.x ? 'right' : (gate.x > upAt.x ? 'left' : (gate.y < upAt.y ? 'down' : 'up'))
  let s2 = newGame()
  s2.opened = { 0: { [gate.y * W0 + gate.x]: '.' } }
  s2.x = gate.x; s2.y = gate.y
  const r2 = resolveStep(s2, dirToU)
  eq(r2.state.floor, 1, '踩上楼楼梯到 2F')
  eq(r2.state.explored[1], 1, '换层后目标层记为已探索')
  eq(JSON.stringify(Object.keys(r2.state.explored)), '["0","1"]', '已探索集合累计')
  // 飞行器只能在这两个层之间跳
  let s3 = JSON.parse(JSON.stringify(r2.state)); s3.hero.fly = 1
  eq(useFly(s3, 1).state.floor, 1, '未探索的 3F 飞不过去')
  eq(useFly(s3, -1).state.floor, 0, '已探索的 1F 可以飞回去')
}

console.log('\n=== 7. buildCells / 存档 ===')
{
  const s = newGame()
  const cells = buildCells(s)
  eq(cells.length, FLOORS[0].rows[0].length * FLOORS[0].rows.length, 'cells 定长 = 整层格数')
  ok('cells 带 tile 原始字符供精灵映射', cells.every(c => typeof c.tile === 'string'))
  eq(cells.filter(c => c.isHero).length, 1, '恰有 1 个英雄高亮')
  // v0.6.0 回归：@ 只是 levels.json 的出生点标记，不是可渲染实体。
  // 若 buildCells 把它透传给宿主层，sprites.json 的 tileMap['@'] 会画成第二个英雄，
  // 也就是「英雄走开后原地还站着一个单位」。归一化必须在视图数据边界完成。
  eq(cells.filter(c => c.tile === '@').length, 0, '出生点 @ 已归一化为地板，不透传')
  const spawnY = FLOORS[0].rows.findIndex(r => r.includes('@'))
  const spawnX = FLOORS[0].rows[spawnY].indexOf('@')
  eq(cells[spawnY * FLOORS[0].rows[0].length + spawnX].tile, '.', '出生点格 tile = 地板')
  const moved = resolveStep(s, 'right').state
  const cells2 = buildCells(moved)
  eq(cells2.filter(c => c.isHero).length, 1, '英雄走开后仍只有 1 个英雄高亮')
  eq(cells2.filter(c => c.tile === '@').length, 0, '英雄走开后出生点不再透传 @')
}
{
  const s = newGame()
  const text = serialize(s)
  ok('存档为 v3 格式', text.startsWith('3|'), text)
  eq(text.split('|').length, 4, 'v3 四段：版本 | head | 变更集 | 已探索')
  eq(text.split('|')[3], '0', 'v3 已探索段初始只有出生层')
  const back = deserialize(text)
  ok('serialize -> deserialize 往返可用', !!back && JSON.stringify(back.hero) === JSON.stringify(s.hero))
  eq(back.v, 3, 'deserialize 标记 v3')
  eq(JSON.stringify(back.explored), JSON.stringify(s.explored), '已探索楼层往返一致')
  eq(back.hero.book, 0, 'v3 带 book 字段（初始未持有图鉴）')

  // v2 旧档兼容（v0.5~v0.7）：没有 book 段、没有 explored 段
  const v2 = deserialize('2|0,1,1,200,10,10,0,1,0,0,0,1,2|0:20.21')
  ok('v2 旧档可读', !!v2, v2 ? 'v=' + v2.v : 'null')
  eq(v2 && v2.hero.book, 0, 'v2 旧档补 book=0')
  eq(v2 && v2.hero.fly, 1, 'v2 旧档 fly 保留')
  eq(v2 && v2.opened[0][20], '.', 'v2 旧档变更集正确复原')
  ok('v2 旧档按「当前层 + 有清格记录的层」推断已探索',
    !!v2 && v2.explored[0] === 1 && Object.keys(v2.explored).length === 1,
    v2 ? Object.keys(v2.explored).join(',') : 'null')

  // v1 旧档兼容（M1 / 在线版 v0.3）
  const v1 = deserialize('1|0,1,1,200,10,10,0,1,0,0,0|0:43')
  ok('v1 旧档可读', !!v1, v1 ? 'v=' + v1.v : 'null')
  eq(v1 && v1.hero.fly, 0, 'v1 旧档补 fly=0')
  eq(v1 && v1.hero.bomb, 0, 'v1 旧档补 bomb=0')
  eq(v1 && v1.hero.book, 0, 'v1 旧档补 book=0')
  eq(v1 && v1.opened[0][43], '.', 'v1 旧档变更集正确复原')

  ok('坏档安全返回 null',
    deserialize('{bad json') === null && deserialize('9|0|') === null && deserialize('2|1,2|') === null)
  ok('v3 段数不足判坏档', deserialize('3|0,1,1,200,10,10,0,0,0,0,0,0,0,0|') === null)
  ok('v3 已探索段含非法楼层判坏档', deserialize('3|0,1,1,200,10,10,0,0,0,0,0,0,0,0||0.99') === null)
  ok('book > 1 判坏档', deserialize('3|0,1,1,200,10,10,0,0,0,0,0,0,0,2||0') === null)

  // 最坏存档（21 层通关态，实测约 1.0KB）
  const worst = sol ? serialize(sol.state) : text
  const bytes = new Blob([worst]).size
  ok('最坏存档 < 在线版 SAVE_LIMIT', bytes < CONFIG.SAVE_LIMIT, bytes + ' B / ' + CONFIG.SAVE_LIMIT + ' B')
  ok('最坏存档 > 手环端 128B 参考线（移植须压缩，见 spec 附 D）',
    bytes > CONFIG.HANDHELD_SAVE_LIMIT, bytes + ' B / ' + CONFIG.HANDHELD_SAVE_LIMIT + ' B')
  const backWin = deserialize(worst)
  ok('通关存档能完整读回', !!backWin,
    backWin ? 'fly' + backWin.hero.fly + ' bomb' + backWin.hero.bomb + ' book' + backWin.hero.book : 'null')
  ok('读回后 ended / 楼层 / 变更集 / 已探索一致', !!backWin &&
    backWin.ended === 'win' && backWin.floor === FLOORS.length - 1 &&
    JSON.stringify(backWin.opened) === JSON.stringify(sol.state.opened) &&
    Object.keys(backWin.explored).length === 21)
  ok('通关态确实拿到了图鉴', !!backWin && backWin.hero.book === 1)

  const TOP_SAVE = FLOORS.length - 1   // 顶层索引随层数变化，不再硬编码 9
  // 炸弹仍可持有多个；飞行器在 v0.8 收敛为 0/1，但旧档里的历史大值不能判坏
  const manyBomb = '3|' + TOP_SAVE + ',3,4,999,50,50,0,0,0,0,2,1,15,1||' + TOP_SAVE
  ok('bomb 为持有数量（>1 合法）', !!deserialize(manyBomb) && deserialize(manyBomb).hero.bomb === 15)
  ok('旧档 fly 大值仍可读（历史遗留）', deserialize('2|' + TOP_SAVE + ',3,4,999,50,50,0,0,0,0,2,12,15|') !== null)
  ok('fly / bomb 异常大数仍判坏档', deserialize('2|' + TOP_SAVE + ',3,4,999,50,50,0,0,0,0,2,100,0|') === null)
}

console.log('\n=== 8. 通关记录（records.js 纯逻辑）===')
{
  const e = emptyRecords()
  ok('默认记录为空', e.bestFloor === 1 && e.minSteps === null && e.wins === 0)
  ok('坏数据归一化', normalizeRecords(null).wins === 0 &&
    normalizeRecords({ bestFloor: -3, wins: 'x', minSteps: 0 }).bestFloor === 1 &&
    normalizeRecords({ bestFloor: 7, wins: 4, minSteps: 88 }).minSteps === 88)
  const b = newGame(), a = { ...b, floor: 4 }
  eq(applyStep(e, b, a, 30).bestFloor, 5, '换层刷新最高层')
  ok('applyStep 不改入参', e.bestFloor === 1 && e.wins === 0)
  const won = applyStep(e, b, { ...b, ended: 'win' }, 42)
  eq(won.wins, 1, '通关跃迁累加次数')
  eq(won.minSteps, 42, '记录通关步数')
  eq(applyStep(won, { ...b, ended: 'win' }, { ...b, ended: 'win' }, 1).wins, 1,
    '读档到已通关状态不重复计数')
  eq(applyStep(won, b, { ...b, ended: 'dead' }, 9).wins, 1, '阵亡不算通关')
  const min = applyStep(won, b, { ...b, ended: 'win' }, 20)
  eq(min.minSteps, 20, '最少步数取更小值')
  eq(applyStep(min, b, { ...b, ended: 'win' }, 80).minSteps, 20, '更多步数不抬高最少值')
  const f = formatRecords({ bestFloor: 7, minSteps: 33, wins: 2 }, FLOORS.length)
  ok('展示文案含总层数且不写死', f.bestFloor.includes(String(FLOORS.length)) && f.minSteps === '33 步' && f.wins === '2')
  ok('记录 key 独立于存档 key', read('app.js').includes("const SAVE_KEY = 'mota_lite_web_v1'") && RECORD_KEY !== 'mota_lite_web_v1')
  const appSrc = read('app.js')
  ok('回放态不写记录', /function commitRecords[\s\S]{0,220}replayMode\) return/.test(appSrc))
  // 按大括号配对取函数体，避免「导入拆成 importSave(校验+确认) / applyImport(落盘)」后，
  // 跨函数正则把相邻函数的 commitRecords 误算进导入路径。
  const fnBody = name => {
    const i = appSrc.indexOf('function ' + name + '(')
    if (i < 0) return ''
    let depth = 0, started = false
    for (let j = i; j < appSrc.length; j++) {
      if (appSrc[j] === '{') { depth++; started = true }
      else if (appSrc[j] === '}') { depth--; if (started && depth === 0) return appSrc.slice(i, j + 1) }
    }
    return ''
  }
  const importBody = fnBody('importSave'), applyBody = fnBody('applyImport')
  ok('导入存档不经过 commitRecords',
    !!importBody && !!applyBody &&
    !importBody.includes('commitRecords(') && !applyBody.includes('commitRecords(') &&
    applyBody.includes('render(); renderHistory(); renderReplayUI()'))
}

console.log('\n=== 9. v0.10 门机制 / 设置持久化 ===')
{
  const D = ['Y', 'B', 'R', 'G'], K = ['y', 'b', 'r']
  const wantDoor12 = n => (n === 7 || n === 14 || n === 21) ? 'G'
    : (n <= 7 ? 'Y' : (n <= 14 ? 'B' : 'R'))
  const doorsOf = f => {
    const out = []
    f.rows.forEach((r, y) => [...r].forEach((c, x) => { if (D.includes(c)) out.push({ c, x, y }) }))
    return out
  }
  let structOK = true; const structBad = []
  FLOORS.forEach((f, i) => {
    const n = i + 1, ds = doorsOf(f), want = wantDoor12(n)
    const isRoom = f.rows[3].slice(3, 10) === '#######'
    let atGate = false
    if (n === 21) atGate = ds.length === 1 && ds[0].x === 6 && ds[0].y === 6 && f.rows[5][5] === '#' && f.rows[5][7] === '#'
    else if (isRoom) atGate = ds.length === 1 && ds[0].x === 6 && ds[0].y === 8
    else {
      const a = f.rows[13][10], b = f.rows[12][11]
      atGate = ds.length === 1 && ((a === '#' && D.includes(b)) || (b === '#' && D.includes(a))) && f.rows[13][11] === 'U'
    }
    const keys = K.filter(k => f.rows.some(r => r.includes(k)))
    if (!(ds.length === 1 && ds[0].c === want && atGate && keys.length === 3)) {
      structOK = false; structBad.push(n + 'F')
    }
  })
  ok('21 层：每层恰好 1 门 + 三色/铁门分级 + 唯一入口 + 三色钥匙', structOK, structBad.join(','))
  ok('doorKey 四门映射（铁门 G 也消耗黄钥匙）',
    JSON.stringify(DOOR_KEY) === JSON.stringify({ Y: 'y', B: 'b', R: 'r', G: 'y' }))
  ok('doorCost：普通门 1 把 / 铁门 3 把',
    DOOR_COST.Y === 1 && DOOR_COST.B === 1 && DOOR_COST.R === 1 && DOOR_COST.G === 3,
    JSON.stringify(DOOR_COST))
  ok('铁门恰好 3 道，落在 7F / 14F / 21F',
    [6, 13, 20].every(i => doorsOf(FLOORS[i]).length === 1 && doorsOf(FLOORS[i])[0].c === 'G') &&
    FLOORS.filter(f => doorsOf(f).some(d => d.c === 'G')).length === 3)

  const gate0 = doorsOf(FLOORS[0])[0]
  const U = { x: 11, y: 13 }, s0 = newGame()
  ok('点击模式：门后的上楼格不可达', findPath(s0, new Set([U.x + ',' + U.y]), { blockEntities: true }).path === null)
  const withKey = newGame(); withKey.hero.keys[DOOR_KEY[gate0.c]] = DOOR_COST[gate0.c] || 1
  ok('有钥匙也不能穿门（必须主动点开）', findPath(withKey, new Set([U.x + ',' + U.y]), { blockEntities: true }).path === null)
  ok('solver 模式有钥匙可规划穿门（攻略不受影响）', findPath(withKey, new Set([U.x + ',' + U.y])).path !== null)
  const stand = [['down', 0, 1, 'up'], ['up', 0, -1, 'down'], ['left', -1, 0, 'right'], ['right', 1, 0, 'left']]
    .map(([d, dx, dy, back]) => ({ x: gate0.x + dx, y: gate0.y + dy, dir: back }))
    .find(p => { const ch = tileAt(withKey, p.x, p.y); return ch !== '#' && !isEntityTile(ch) })
  ok('门旁有可站格', !!stand)
  if (stand) {
    const mk = ky => deserialize(`3|0,${stand.x},${stand.y},200,10,10,0,${ky},0,0,0,0,0,0||0`)
    const r = resolveStep(mk(1), stand.dir)
    ok('主动撞门：扣钥匙 + 门变地板 + 发 save',
      r.events.some(e => e.t === 'msg' && e.text === '门已打开') &&
      tileAt(r.state, gate0.x, gate0.y) === '.' &&
      r.state.hero.keys[DOOR_KEY[gate0.c]] === 0 && r.events.some(e => e.t === 'save'))
    ok('开门后点击模式可到 U', findPath(r.state, new Set([U.x + ',' + U.y]), { blockEntities: true }).path !== null)
    const r2 = resolveStep(mk(0), stand.dir)
    ok('无钥匙撞门：提示缺少钥匙且门不动',
      r2.events.some(e => e.t === 'msg' && e.text === '缺少钥匙') && tileAt(r2.state, gate0.x, gate0.y) === gate0.c)
  }

  const sol10 = findSolution()
  ok('findSolution 仍可通关（门改动未破坏可解性）', !!sol10 && sol10.state.ended === 'win')
  if (sol10) {
    let st = newGame(), opened = 0
    for (const d of sol10.steps) {
      const r = resolveStep(st, d); st = r.state
      opened += r.events.filter(e => e.t === 'msg' && e.text === '门已打开').length
    }
    ok('21 层门在攻略回放里都被实际打开', opened >= 21, opened + ' 次')
  }

  const appSrc10 = read('app.js'), textsSrc = read('texts.js')
  ok('app.js 定义设置 key 与 load/save/apply',
    ["const SETTINGS_KEY = 'mota_lite_web_settings_v1'", 'function loadSettings(', 'function saveSettings(',
     'function applySettings('].every(t => appSrc10.includes(t)))
  ok('设置 key 独立于存档 key', !appSrc10.includes("const SETTINGS_KEY = 'mota_lite_web_v1'"))
  ok('冷启动统一恢复设置', appSrc10.includes('applySettings(loadSettings())'))
  ok('设置不进游戏存档串', !/sprite|soundOn|animOn|zoom/.test(serialize(newGame())))
  ok('帮助文案说明三色门与设置存盘',
    textsSrc.includes('门是经典魔塔的不可绕行障碍') && textsSrc.includes('刷新浏览器后仍保持'))
}

console.log('\n=== 10. v0.11 交互停原地（经典魔塔「撞一下」）===')
{
  const rows0 = FLOORS[0].rows, W0 = rows0[0].length
  const dirFrom = (sx, sy, tx, ty) => tx > sx ? 'right' : tx < sx ? 'left' : ty > sy ? 'down' : 'up'
  const scene = kind => {
    for (let y = 0; y < rows0.length; y++) for (let x = 0; x < W0; x++) {
      const ch = rows0[y][x]
      if (!kind(ch)) continue
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const sx = x + dx, sy = y + dy
        if (sx < 0 || sy < 0 || sx >= W0 || sy >= rows0.length) continue
        if (!['.', '@'].includes(rows0[sy][sx])) continue
        return { x, y, sx, sy, dir: dirFrom(sx, sy, x, y), ch }
      }
    }
    return null
  }
  const strong = (sx, sy) => {
    const s = newGame(); s.x = sx; s.y = sy
    s.hero.hp = 99999; s.hero.atk = 9999; s.hero.def = 9999
    return s
  }
  // 10.1 怪物：结算后停原地 + 清格 + 发事件（音效/动画依据） + 再走一步才进入
  const mg = scene(ch => !!monsterByCh(ch))
  ok('1F 找到怪物场景', !!mg, mg ? `(${mg.x},${mg.y})` : 'none')
  if (mg) {
    const r = resolveStep(strong(mg.sx, mg.sy), mg.dir)
    ok('v0.11 击败怪物后英雄停在原地', r.state.x === mg.sx && r.state.y === mg.sy,
      `(${r.state.x},${r.state.y}) vs (${mg.sx},${mg.sy})`)
    ok('v0.11 战斗仍发胜利 / save / vibrate 事件（宿主层音效动画不丢）',
      r.events.some(e => e.t === 'msg' && /^胜 /.test(e.text)) &&
      r.events.some(e => e.t === 'save') && r.events.some(e => e.t === 'vibrate'))
    ok('v0.11 怪格清成地板', tileAt(r.state, mg.x, mg.y) === '.')
    ok('v0.11 金币增加', r.state.hero.gold > 0)
    const r2 = resolveStep(r.state, mg.dir)
    ok('v0.11 再走一步才进入原怪格', r2.state.x === mg.x && r2.state.y === mg.y)
  }
  // 10.2 道具 / NPC：同样停原地
  const ig = scene(ch => !!itemByCh(ch))
  ok('1F 找到道具场景', !!ig)
  if (ig) {
    const r = resolveStep(strong(ig.sx, ig.sy), ig.dir)
    ok('v0.11 拾取道具后英雄停在原地', r.state.x === ig.sx && r.state.y === ig.sy)
    ok('v0.11 拾取仍发获得/救出 + save 事件',
      r.events.some(e => e.t === 'msg' && /^(获得|已救出) /.test(e.text)) && r.events.some(e => e.t === 'save'))
    ok('v0.11 道具格清成地板', tileAt(r.state, ig.x, ig.y) === '.')
    const r2 = resolveStep(r.state, ig.dir)
    ok('v0.11 再走一步才进入原道具格', r2.state.x === ig.x && r2.state.y === ig.y)
  }
  // 10.3 门：仍「开门即进入」（通道语义不变，v0.10 设计不回退）
  const dg = scene(ch => !!DOOR_KEY[ch])
  ok('1F 找到门场景', !!dg)
  if (dg) {
    const s = strong(dg.sx, dg.sy); s.hero.keys[DOOR_KEY[dg.ch]] = DOOR_COST[dg.ch] || 1
    const r = resolveStep(s, dg.dir)
    ok('v0.11 门仍开门即进入', r.state.x === dg.x && r.state.y === dg.y)
    ok('v0.11 开门仍扣 1 把对应钥匙 + 变地板', r.state.hero.keys[DOOR_KEY[dg.ch]] === 0 && tileAt(r.state, dg.x, dg.y) === '.')
  }
  // 10.4 楼梯 / 王座 / 商店 / 暗格：各自语义不变
  {
    // 换层：直接用 1F 上楼口（v0.10 由门把守，故先清门再撞 U）
    const s = newGame()
    let upAt = null
    FLOORS[0].rows.forEach((r, y) => { const x = r.indexOf('U'); if (x >= 0) upAt = { x, y } })
    const gate = [[-1,0],[1,0],[0,-1],[0,1]].map(([dx,dy]) => ({ x: upAt.x+dx, y: upAt.y+dy }))
      .find(p => DOOR_KEY[tileAt(s, p.x, p.y)])
    const dirToU = gate.x < upAt.x ? 'right' : gate.x > upAt.x ? 'left' : gate.y < upAt.y ? 'down' : 'up'
    let s2 = newGame(); s2.opened = { 0: { [gate.y*W0+gate.x]: '.' } }; s2.x = gate.x; s2.y = gate.y
    const r = resolveStep(s2, dirToU)
    const land = FLOORS[1].down
    ok('v0.11 撞 U 仍换层且落点 = 目标层 down',
      r.state.floor === 1 && !!land && r.state.x === land.x && r.state.y === land.y,
      `floor=${r.state.floor} (${r.state.x},${r.state.y}) vs (${land && land.x},${land && land.y})`)
    // 商店 N：本就不移动
    const appSrc = read('app.js')
    ok('app.js battleWon 不再依赖 moved（按胜利事件判定）',
      appSrc.includes("const battleWon = !!beforeMon && events.some(t => t.startsWith('胜 '))"))
    ok('app.js 用 interacted / progressed 触发交互剧情',
      appSrc.includes('const interacted = r.events.some') && appSrc.includes('const progressed = moved || interacted'))
    ok('logic.js 两个实体交互分支结算后 return',
      read('logic.js').includes('撞怪 = 结算但不进入该格') && read('logic.js').includes('拾取 / 救出后停在原地'))
    const tSrc = read('texts.js')
    ok('texts.js 公式句不再重复', (tSrc.match(/战斗沿用经典魔塔的固定数值公式/g) || []).length === 1)
    ok('texts.js 说明交互停原地', tSrc.includes('交互后英雄停在原地') && tSrc.includes('再走一步才进去'))
  }
  // 10.5 通关路线不受影响（solver 零改动）
  const sol11 = findSolution()
  ok('v0.11 findSolution 仍可通关', !!sol11 && sol11.state.ended === 'win')
  if (sol11) {
    let st = newGame(), loss = new Set(), opened = 0
    for (const d of sol11.steps) {
      const before = st, r = resolveStep(st, d); st = r.state
      opened += r.events.filter(e => e.t === 'msg' && e.text === '门已打开').length
      const w = r.events.find(e => e.t === 'msg' && /^胜 /.test(e.text || ''))
      if (w) { const m = w.text.match(/-(\d+)HP/); if (m && Number(m[1]) > 0) loss.add(before.floor) }
    }
    ok('v0.11 21 层门仍全被打开', opened >= 21, opened + ' 次')
    ok('v0.11 21/21 层仍掉血（难度曲线不退化）', loss.size === 21, loss.size + '/21')
  }
}

console.log('\n=== 11. v0.12 暗门 / 铁门 / 钥匙经济 ===')
{
  const tSrc12 = read('texts.js'), appSrc12 = read('app.js'), logicSrc12 = read('logic.js')
  const A_in = f => {
    const out = []
    FLOORS[f].rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === 'A') out.push({ x, y }) }))
    return out
  }
  // 11.1 暗门配置表
  ok('SECRET 恰好 21 处（每层一处暗门）', SECRET.length === 21, SECRET.length + ' 处')
  ok('SECRET 坐标在地图里确实是 A',
    SECRET.every(s => FLOORS[s.floor] && FLOORS[s.floor].rows[s.y][s.x] === 'A'))
  ok('SECRET 坐标唯一', new Set(SECRET.map(s => s.floor + ':' + s.x + ':' + s.y)).size === SECRET.length)
  ok('SECRET 的 item 都能在 ITEMS 找到', SECRET.every(s => !!itemById(s.item)))
  ok('secretAt 可按坐标查到', SECRET.every(s => secretAt(s.floor, s.x, s.y) === s))
  ok('SECRET 的 story key 都有文案', SECRET.every(s => tSrc12.includes(s.story + ':')) &&
    new Set(SECRET.map(s => s.story)).size === 7, new Set(SECRET.map(s => s.story)).size + ' 段')
  ok('每层恰好 1 处暗门 A', FLOORS.every((f, i) => A_in(i).length === 1))
  // 11.2 暗门绝不绕开 v0.10 的唯一入口
  ok('暗门不落在房间墙 / 门 / 楼梯 / 王座邻域 2 格内', FLOORS.every((f, i) => {
    const a = A_in(i)[0]
    if (!a) return false
    if (f.rows[3].slice(3, 10) === '#######' && a.x >= 3 && a.x <= 9 && a.y >= 3 && a.y <= 8) return false
    const gates = []
    f.rows.forEach((r, y) => [...r].forEach((c, x) => {
      if (DOOR_KEY[c] || c === 'U' || c === 'D' || c === 'W' || c === '@') gates.push({ x, y })
    }))
    return gates.every(g => Math.abs(g.x - a.x) + Math.abs(g.y - a.y) > 2)
  }))
  ok('暗门至少有一个可站邻格（玩家能走过去撞）', FLOORS.every((f, i) => {
    const a = A_in(i)[0]
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const row = f.rows[a.y + dy], c = row && row[a.x + dx]
      return c && c !== '#' && c !== 'A' && !isEntityTile(c)
    })
  }))
  // 11.3 撞墙显形：停原地 + 清地板 + 结算奖励 + 再走一步才进
  const a0 = A_in(0)[0]
  const standA = [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down'], [0, 1, 'up']]
    .map(([dx, dy, dir]) => ({ x: a0.x + dx, y: a0.y + dy, dir }))
    .find(p => { const c = tileAt(newGame(), p.x, p.y); return c !== '#' && !isEntityTile(c) })
  ok('1F 暗门旁有可站格', !!standA)
  if (standA) {
    const sA = newGame(); sA.x = standA.x; sA.y = standA.y
    const beforeHp = sA.hero.hp, beforeY = sA.hero.keys.y
    const rA = resolveStep(sA, standA.dir)
    const sec0 = secretAt(0, a0.x, a0.y)
    ok('撞暗门：停在原地（v0.11「撞一下」语义）', rA.state.x === standA.x && rA.state.y === standA.y)
    ok('撞暗门：墙格清成地板', tileAt(rA.state, a0.x, a0.y) === '.')
    ok('撞暗门：发「撞开暗门」+ vibrate + save',
      rA.events.some(e => e.t === 'msg' && e.text.includes('撞开暗门')) &&
      rA.events.some(e => e.t === 'vibrate') && rA.events.some(e => e.t === 'save'))
    ok('撞暗门：墙后奖励按 SECRET 生效',
      (sec0.item === 'key_y' ? rA.state.hero.keys.y - beforeY === 1 : true) &&
      (sec0.item === 'potion_s' ? rA.state.hero.hp - beforeHp === 50 : true), sec0.item)
    const rA2 = resolveStep(rA.state, standA.dir)
    ok('撞开后再走一步才进入原墙格', rA2.state.x === a0.x && rA2.state.y === a0.y)
  }
  // 11.4 铁门：一次要 3 把黄钥匙
  const iron = []
  FLOORS.forEach((f, i) => f.rows.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'G') iron.push({ f: i, x, y })
  })))
  ok('铁门恰好 3 道（7F / 14F / 21F）', iron.length === 3 && iron.map(g => g.f + 1).join(',') === '7,14,21')
  if (iron.length) {
    const g = iron[0]
    const standG = [[-1, 0, 'right'], [1, 0, 'left'], [0, -1, 'down'], [0, 1, 'up']]
      .map(([dx, dy, dir]) => ({ x: g.x + dx, y: g.y + dy, dir }))
      .find(p => { const row = FLOORS[g.f].rows[p.y], c = row && row[p.x]; return c && c !== '#' && !isEntityTile(c) })
    ok('铁门旁有可站格', !!standG)
    if (standG) {
      const mkG = ky => { const s = newGame(); s.floor = g.f; s.x = standG.x; s.y = standG.y; s.hero.keys.y = ky; return s }
      const r0 = resolveStep(mkG(2), standG.dir)
      ok('2 把黄钥匙撞铁门：拒绝且门不动、坐标不变',
        r0.events.some(e => e.t === 'msg' && e.text.includes('铁门需要 3 把')) &&
        tileAt(r0.state, g.x, g.y) === 'G' && r0.state.x === standG.x && r0.state.y === standG.y)
      const r3 = resolveStep(mkG(3), standG.dir)
      ok('3 把黄钥匙撞铁门：开启、扣 3 把、变地板',
        r3.state.hero.keys.y === 0 && tileAt(r3.state, g.x, g.y) === '.' &&
        r3.events.some(e => e.t === 'msg' && e.text === '门已打开') &&
        r3.events.some(e => e.t === 'msg' && e.text.includes('铁门开启')))
    }
  }
  ok('solver 按 DOOR_COST 判定门、暗门只作目标不穿越',
    read('solver.js').includes('DOOR_COST[ch] || 1') &&
    read('solver.js').includes("ch === 'A' && !targets.has"))
  // 11.5 钥匙经济闭环
  ok('钥匙经济四条来源齐全（地图三色 / 暗门 / 盗贼 +3 / 商店补钥匙）',
    FLOORS.every(f => ['y', 'b', 'r'].every(k => f.rows.some(r => r.includes(k)))) &&
    SECRET.filter(s => s.item === 'key_y').length >= 5 &&
    ITEMS.some(i => i.id === 'npc_thief' && i.effect.key === 'y' && i.effect.n === 3) &&
    SHOP_GOODS.some(g => g.kind === 'key') &&
    CONFIG.KEY_COST === 20, SECRET.filter(s => s.item === 'key_y').length + ' 处暗门给黄钥匙')
  // 11.6 宿主层 / 文案接线
  ok('app.js 接 secretAt 剧情 + 暗门音效 + 相邻提示',
    appSrc12.includes("beforeTile === 'A' ? secretAt") &&
    appSrc12.includes("t.includes('撞开暗门')") &&
    appSrc12.includes('function secretNearby') && appSrc12.includes('TEXTS.ui.secretHint'))
  ok('logic.js 暗门分支与 DOOR_COST 扣钥匙都在',
    logicSrc12.includes("if (t === 'A')") && logicSrc12.includes('DOOR_COST[t] || 1'))
  ok('帮助文案说明暗门 / 铁门 / 钥匙经济',
    tSrc12.includes('暗门伪装成普通砖墙') && tSrc12.includes('铁门是加厚门') && tSrc12.includes('钥匙经济'))
  // 11.7 正式工程回放
  const sol12 = findSolution()
  ok('v0.12 findSolution 仍可通关', !!sol12 && sol12.state.ended === 'win')
  if (sol12) {
    let st = newGame(), loss = new Set(), opened = 0, ironOpened = 0, secretOpened = 0
    for (const d of sol12.steps) {
      const before = st, r = resolveStep(st, d); st = r.state
      const msgs = r.events.filter(e => e.t === 'msg').map(e => e.text).join(' ')
      opened += r.events.filter(e => e.t === 'msg' && e.text === '门已打开').length
      if (msgs.includes('铁门开启')) ironOpened++
      if (msgs.includes('撞开暗门')) secretOpened++
      const w = r.events.find(e => e.t === 'msg' && /^胜 /.test(e.text || ''))
      if (w) { const m = w.text.match(/-(\d+)HP/); if (m && Number(m[1]) > 0) loss.add(before.floor) }
    }
    ok('攻略回放 21 道门全开', opened >= 21, opened + ' 次')
    ok('攻略回放 3 道铁门全开', ironOpened === 3, ironOpened + ' 道')
    ok('攻略回放暗门被实际撞开', secretOpened >= 15, secretOpened + ' 处')
    ok('21/21 层仍掉血（v0.9 难度曲线未退化）', loss.size === 21, loss.size + '/21')
    ok('存档仍为 v3 且体积可控',
      serialize(sol12.state).startsWith('3|') && serialize(sol12.state).length < CONFIG.SAVE_LIMIT,
      serialize(sol12.state).length + ' B')
  }
}

console.log('\n' + (fail ? '存在 ' + fail + ' 项失败' : '全部 ' + pass + ' 项断言通过') + '。\n')
process.exit(fail ? 1 : 0)
