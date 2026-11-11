// src/common/logic.js —— 纯逻辑层：不 import 任何 @system.* / Vela API
// 因此可以被 node 直接 import 做离线校验（见 validate_tables.js）。
// 视图层 index.ux 只负责：把 state 交给本层、拿 cells 整表赋值、响应 events。

import {
  FLOORS, HERO0, TILE_COLOR, TILE_CHAR, DOOR_KEY,
  monsterByCh, itemByCh
} from './tables.js'

// 全部可调参数集中在配置层，改数值不改逻辑
export const CONFIG = {
  FIRST_STRIKE: true,   // 玩家先手：最后一回合怪已死，不再反击 -> (rounds-1)
  MIN_DAMAGE_1: false,  // 经典 50 层：ATK<=DEF 判「不可破防」；部分版本强制 1 点伤害
  CELL: 28,             // 格子边长 px（7 列 * 28 = 196，212 宽左右各留 8）
  SAFE_LR: 8,           // 胶囊圆角左右安全区
  VIBRATE_GAP: 300      // ms，振动最小间隔
}

const DIR = {
  left:  [-1, 0], right: [1, 0],
  up:    [0, -1], down:  [0, 1]
}

export function newGame() {
  const f0 = FLOORS[0]
  let sx = 1, sy = 1
  f0.rows.forEach((row, y) => {
    const x = row.indexOf('@')
    if (x >= 0) { sx = x; sy = y }
  })
  return {
    floor: 0, x: sx, y: sy,
    hero: JSON.parse(JSON.stringify(HERO0)),
    opened: {},          // { [floor]: { [idx]: newCh } } —— 只存变更集，不存整图快照
    ended: null          // null | 'dead' | 'win'
  }
}

function clone(s) { return JSON.parse(JSON.stringify(s)) }
function width(floor) { return FLOORS[floor].rows[0].length }
function height(floor) { return FLOORS[floor].rows.length }

// 直读原始地图 + 叠加变更集；不做 m_xxx 缓存
export function tileAt(s, x, y) {
  const rows = FLOORS[s.floor].rows
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return '#'
  const ov = s.opened[s.floor] && s.opened[s.floor][y * width(s.floor) + x]
  return ov !== undefined ? ov : rows[y][x]
}

function setTile(s, x, y, ch) {
  if (!s.opened[s.floor]) s.opened[s.floor] = {}
  s.opened[s.floor][y * width(s.floor) + x] = ch
}

// ---- 战斗结算：确定性、无随机 ----
// perHit    = 玩家每回合对怪伤害
// rounds    = 击杀所需回合数 = ceil(mon.hp / perHit)
// monPerHit = 怪每回合对玩家伤害（DEF>=ATK 时为 0，即「防杀」）
// hpCost    = 玩家总损血
export function calcBattle(hero, mon) {
  let perHit = hero.atk - mon.def
  if (perHit <= 0) {
    if (!CONFIG.MIN_DAMAGE_1) {
      return { ok: false, reason: 'unbreakable', rounds: 0, hpCost: 0, perHit, monPerHit: 0 }
    }
    perHit = 1
  }
  const rounds = Math.ceil(mon.hp / perHit)
  const monPerHit = Math.max(0, mon.atk - hero.def)
  const hpCost = (CONFIG.FIRST_STRIKE ? rounds - 1 : rounds) * monPerHit
  if (hpCost >= hero.hp) {
    return { ok: false, reason: 'lethal', rounds, hpCost, perHit, monPerHit }
  }
  return { ok: true, reason: '', rounds, hpCost, perHit, monPerHit }
}

function applyEffect(hero, eff) {
  if (eff.hp)   hero.hp += eff.hp
  if (eff.atk)  hero.atk += eff.atk
  if (eff.def)  hero.def += eff.def
  if (eff.gold) hero.gold += eff.gold
  if (eff.key)  hero.keys[eff.key] += eff.n
}

// ---- 一次输入 = 一次结算 = 一次视图提交（替代雷电方案的 tick 主循环）----
// 纯函数：返回新 state + events，视图层不参与任何数值计算
export function resolveStep(prev, direction) {
  const s = clone(prev)
  const ev = []
  if (s.ended) return { state: s, events: ev }

  const d = DIR[direction]
  if (!d) return { state: s, events: ev }
  const nx = s.x + d[0], ny = s.y + d[1]
  const t = tileAt(s, nx, ny)

  // 1. 墙 / 越界
  if (t === '#') { ev.push({ t: 'msg', text: '前方是墙' }); return { state: s, events: ev } }

  // 2. 门
  const needKey = DOOR_KEY[t]
  if (needKey) {
    if (s.hero.keys[needKey] <= 0) {
      ev.push({ t: 'msg', text: '缺少钥匙' }); return { state: s, events: ev }
    }
    s.hero.keys[needKey] -= 1
    setTile(s, nx, ny, '.')
    ev.push({ t: 'vibrate' }, { t: 'msg', text: '门已打开' })
  }

  // 3. 怪物
  const mon = monsterByCh(t)
  if (mon) {
    const r = calcBattle(s.hero, mon)
    if (!r.ok) {
      const text = r.reason === 'unbreakable'
        ? '攻击不足，无法破防'
        : '硬拼会阵亡（需 ' + (r.hpCost + 1) + ' HP）'
      ev.push({ t: 'msg', text }, { t: 'vibrate' })
      return { state: s, events: ev }
    }
    s.hero.hp -= r.hpCost
    s.hero.gold += mon.gold
    setTile(s, nx, ny, '.')
    ev.push({ t: 'vibrate' }, {
      t: 'msg',
      text: '胜 ' + mon.name + ' -' + r.hpCost + 'HP +' + mon.gold + 'G'
    })
  }

  // 4. 道具
  const item = itemByCh(t)
  if (item) {
    applyEffect(s.hero, item.effect)
    setTile(s, nx, ny, '.')
    ev.push({ t: 'msg', text: '获得 ' + item.name })
  }

  // 5. 换层（落点 = 相邻层的对向楼梯坐标）
  if (t === 'U' || t === 'D') {
    const nf = t === 'U' ? s.floor + 1 : s.floor - 1
    const target = FLOORS[nf]
    if (!target) { ev.push({ t: 'msg', text: '没有更多楼层' }); return { state: s, events: ev } }
    const landing = t === 'U' ? target.down : target.up
    s.floor = nf
    s.x = landing ? landing.x : 1
    s.y = landing ? landing.y : 1
    ev.push({ t: 'floor' }, { t: 'vibrate' }, { t: 'msg', text: '进入 ' + target.name })
    return { state: s, events: ev }
  }

  // 6. 通关
  if (t === 'W') {
    s.x = nx; s.y = ny; s.ended = 'win'
    ev.push({ t: 'win' }, { t: 'vibrate' })
    return { state: s, events: ev }
  }

  // 7. 商店/NPC（M1 占位，可走）
  if (t === 'N') ev.push({ t: 'msg', text: '商人：M3 开放' })

  // 8. 落到目标格
  s.x = nx; s.y = ny
  if (s.hero.hp <= 0) { s.ended = 'dead'; ev.push({ t: 'dead' }, { t: 'vibrate' }) }
  return { state: s, events: ev }
}

// ---- 视图数据：定长 cells 数组，节点数恒定，靠整表赋值触发 diff ----
// M1：整层即视口（7x9=63 格，无需滚动）。M3 若扩地图，改为以 (x,y) 为中心的视口裁剪，
//     数组长度仍固定为 VP_W*VP_H，槽位不变。
export function buildCells(s) {
  const W = width(s.floor), H = height(s.floor), C = CONFIG.CELL
  const out = new Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = tileAt(s, x, y)
      const mon = monsterByCh(ch)
      const glyph = mon ? mon.ch : (TILE_CHAR[ch] || '')
      out[y * W + x] = {
        x: x * C, y: y * C,
        bg: mon ? mon.bg : (TILE_COLOR[ch] || TILE_COLOR['.']),
        ch: glyph,
        fg: '#ffffff',
        hasCh: !!glyph,
        isHero: x === s.x && y === s.y
      }
    }
  }
  return out
}

// 存档：只序列化可变状态，地图由 tables.js 静态提供
export function serialize(s) {
  return JSON.stringify({
    v: 1, floor: s.floor, x: s.x, y: s.y,
    hero: s.hero, opened: s.opened, ended: s.ended
  })
}

export function deserialize(text) {
  try {
    const o = JSON.parse(text)
    if (!o || o.v !== 1 || !o.hero) return null
    if (!FLOORS[o.floor]) return null
    return o
  } catch (e) { return null }
}
