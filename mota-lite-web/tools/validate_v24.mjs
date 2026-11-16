#!/usr/bin/env node
// v0.24.0 专项校验：纯静态定值表 / 递增定价 / 4F·16F 商店层级 / 逐层精算曲线 /
// 真实回放（沿 findSolution 路线每步花光金币经验买攻防）通关 + 首次推进防杀率。
//
// 与 validate_logic.mjs 的分工：历代专项写死 v0.17~v0.23 的定稿数值，本轮数值
// 重构后口径已变，在 validate_logic.mjs 里统一标注「不适用」；本脚本承载 v0.24.0
// 的真实验收，直接 import 落地后的 logic.js / tables.js / solver.js，不设垫片、
// 不伪造通关数据。
import { VERSION, CHANGELOG } from '../version.js'
import {
  CONFIG, newGame, scaledMon, shopOffer, shopBuy, mageOffer, mageBuy,
  calcBattle, resolveStep, tileAt
} from '../logic.js'
import { FLOOR_SCALE, FLOORS, monsterByCh } from '../tables.js'
import { findSolution, findPath } from '../solver.js'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(path.join(root, f), 'utf8')
const data = JSON.parse(read('levels/levels.json'))
let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name + (detail ? '  | ' + detail : '')); pass++ }
  else { console.error('  ✗ ' + name + (detail ? '  -> ' + detail : '')); fail++ }
}

console.log('=== 1. 版本链 ===')
ok('VERSION = v0.24.3', VERSION === 'v0.24.3', VERSION)
ok('CHANGELOG 首条 = v0.24.3', CHANGELOG[0].v === VERSION)
ok('manifest = 0.24.3', JSON.parse(read('assets/manifest.json')).version === '0.24.3')
ok('index.html 9 处 ?r=0.24.3', (read('index.html').match(/\?r=0\.24\.3/g) || []).length === 9)
ok('meta.schema = 12', data.meta.schema === 12)
ok('生成链 build_tables.py --check 通过',
  (() => { try { execFileSync('python3', ['tools/build_tables.py', '--check'], { cwd: root }); return true } catch { return false } })())
ok('sync_cache_bust.py --check 通过',
  (() => { try { execFileSync('python3', ['tools/sync_cache_bust.py', '--check'], { cwd: root }); return true } catch { return false } })())

console.log('=== 2. 纯静态定值表（撤离态全局乘数）===')
const logicSrc = read('logic.js')
// v0.24.0：只校验「可执行代码」里没有全局乘数 / 门控残留；注释里保留历史术语说明不算残留。
const logicCode = logicSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
ok('logic.js 运行时代码无 isCommon 全局乘数 / MOB_* 旧键 / PRESSURE_* 门控',
  !/isCommon|MOB_ATK_GAIN|MOB_DEF_GAIN|MOB_DEF_CAP_MULT|MOB_HP_SCALE_FRONT|MOB_HP_SCALE_BACK|PRESSURE_/.test(logicCode))
ok('CONFIG 无 MOB_* 键', CONFIG.MOB_ATK_GAIN === undefined && CONFIG.MOB_DEF_GAIN === undefined &&
  CONFIG.MOB_DEF_CAP_MULT === undefined)
ok('CONFIG 递增定价参数（金币 +12 / 18 点，经验 +15 / 18 点）',
  CONFIG.SHOP_COST === 20 && CONFIG.SHOP_COST_STEP === 12 && CONFIG.SHOP_COST_PER === 18 &&
  CONFIG.EXP_COST === 30 && CONFIG.EXP_COST_STEP === 15 && CONFIG.EXP_COST_PER === 18)
ok('CONFIG 进阶商店参数（16F 起 / +4 / +10G）',
  CONFIG.ADV_SHOP_FLOOR === 15 && CONFIG.ADV_SHOP_BONUS === 4 && CONFIG.ADV_SHOP_COST === 10)
const slime = monsterByCh('1')
const m1a = scaledMon(slime, 5, { def: 10, flags: 0 })
const m1b = scaledMon(slime, 5, { def: 99999, flags: 0 })
ok('同一怪同层数值与玩家 DEF 完全无关（纯静态）',
  m1a.atk === m1b.atk && m1a.def === m1b.def && m1a.hp === m1b.hp,
  `atk${m1a.atk} def${m1a.def} hp${m1a.hp}`)
ok('常规怪数值 = FLOOR_SCALE × 怪种权重',
  m1a.atk === Math.round(FLOOR_SCALE[5].atk * 0.95) &&
  m1a.def === Math.round(FLOOR_SCALE[5].def * 0.8) &&
  m1a.hp === Math.round(FLOOR_SCALE[5].hp * 0.85))

console.log('=== 3. 递增定价（收敛经济）===')
const heroLo = { atk: 10, def: 10, hp: 200, gold: 0, exp: 0, flags: 0 }
const heroHi = { atk: 200, def: 200, hp: 9000, gold: 0, exp: 0, flags: 0 }
ok('商店攻 / 防单价随属性递增',
  shopOffer('atk', 5, heroLo).cost === 20 && shopOffer('atk', 5, heroHi).cost > 20 &&
  shopOffer('def', 5, heroHi).cost > 20,
  `10→${shopOffer('atk', 5, heroLo).cost}G / 200→${shopOffer('atk', 5, heroHi).cost}G`)
ok('商店血瓶 / 钥匙固定价（不递增）',
  shopOffer('hp', 5, heroLo).cost === shopOffer('hp', 5, heroHi).cost &&
  shopOffer('key', 5, heroLo).cost === shopOffer('key', 5, heroHi).cost)
ok('法师攻 / 防单价随属性递增，血量固定价',
  mageOffer('def', heroLo).cost === 30 && mageOffer('def', heroHi).cost > 30 &&
  mageOffer('hp', heroLo).cost === mageOffer('hp', heroHi).cost)
ok('16F 起进阶档：攻防回报更高、单价上浮',
  shopOffer('atk', 15, heroLo).amount > shopOffer('atk', 14, heroLo).amount &&
  shopOffer('atk', 15, heroLo).cost > shopOffer('atk', 14, heroLo).cost)
// 钱不够只发 msg 不发 save（v0.23.0 交易音效分流判定依据仍成立）
const poor = newGame(); poor.hero.gold = 0
ok('钱不够点购买项不成交（无 save 事件）',
  !shopBuy(poor, 'atk').events.some(e => e.t === 'save'))

console.log('=== 4. 商店层级（地图真实可见）===')
const rowsOf = f => FLOORS[f - 1].rows.join('')
ok('2F 无商人（商店 4F 起）', !rowsOf(2).includes('N'))
ok('4F 有商人房', rowsOf(4).includes('N'))
ok('16F 有进阶商人实体', rowsOf(16).includes('N'))
ok('17F 商人房 + 能量核心 C 主线不动', rowsOf(17).includes('N') && rowsOf(17).includes('C'))
ok('全塔恰好 3 个商人实体',
  FLOORS.reduce((a, f) => a + f.rows.join('').split('N').length - 1, 0) === 3)

console.log('=== 5. 21 层逐层精算曲线 ===')
ok('FLOOR_SCALE = 21 组逐层 + 9 组外推', FLOOR_SCALE.length === 30)
const atks = FLOOR_SCALE.slice(0, 21).map(x => x.atk)
const defs = FLOOR_SCALE.slice(0, 21).map(x => x.def)
ok('21 组怪 ATK 逐层不回落', atks.every((v, i) => i === 0 || v >= atks[i - 1]), atks.join(','))
ok('21 组怪防 > 0 且逐层不回落', defs.every(v => v > 0) && defs.every((v, i) => i === 0 || v >= defs[i - 1]))
ok('怪 ATK 相对 v0.23 基线整体抬高（21F >= 500）', atks[20] >= 500, `21F atk=${atks[20]}`)

console.log('=== 6. 真实回放校验（用户口径：花光金币经验买攻防）===')
const ROUTE = findSolution()
ok('findSolution 带真实购买回放后恢复通关', !!ROUTE && ROUTE.state.ended === 'win',
  ROUTE ? `${ROUTE.steps.length} 步 / 终局 A${ROUTE.hero.atk} D${ROUTE.hero.def}` : 'null')
const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }
function spend(s, strategy, toggle) {
  if (s.floor < 3) return s
  let g = 0
  while (g++ < 800) {
    const k0 = strategy === 'allDef' ? 'def' : (toggle.v++ % 2 === 0 ? 'atk' : 'def')
    const alt = k0 === 'def' ? 'atk' : 'def'
    const before = s.hero.gold
    let r = shopBuy(s, k0)
    if (r.state.hero.gold === before) r = shopBuy(s, alt)
    if (r.state.hero.gold === before) break
    s = r.state
  }
  g = 0
  while (g++ < 800) {
    const k0 = strategy === 'allDef' ? 'def' : (toggle.v++ % 2 === 0 ? 'atk' : 'def')
    const alt = k0 === 'def' ? 'atk' : 'def'
    const before = s.hero.exp || 0
    let r = mageBuy(s, k0)
    if ((r.state.hero.exp || 0) === before) r = mageBuy(s, alt)
    if ((r.state.hero.exp || 0) === before) break
    s = r.state
  }
  g = 0
  while (s.hero.hp < 800 && g++ < 300) {
    const before = s.hero.gold
    const r = shopBuy(s, 'hp')
    if (r.state.hero.gold === before) break
    s = r.state
  }
  return s
}
function replay(strategy) {
  let s = newGame(), toggle = { v: 0 }
  const mk = () => Array.from({ length: 21 }, () => ({ b: 0, loss: 0, block: 0, lethal: 0, unbreak: 0, net: 0 }))
  const F1 = mk(), F2 = mk(), seen = {}
  for (const d of ROUTE.steps) {
    if (s.ended) break
    const curFloor = s.floor
    const rec = (seen[curFloor] ? F2 : F1)[curFloor]
    const dl = DIRS[d]
    if (dl) {
      const mon = monsterByCh(tileAt(s, s.x + dl[0], s.y + dl[1]))
      if (mon) {
        const r = calcBattle(s.hero, mon, curFloor)
        rec.b++
        if (r.perHit <= 0) rec.unbreak++
        else if (!r.ok && r.reason === 'lethal') rec.lethal++
        else {
          rec.loss += r.hpCost; rec.net += r.monPerHit
          if (r.monPerHit === 0 && !mon.pierce && !mon.drain) rec.block++
        }
      }
    }
    s = resolveStep(s, d).state
    if (s.floor !== curFloor) seen[curFloor] = 1
    s = spend(s, strategy, toggle)
  }
  return { s, F1, F2 }
}
const sum = (F, k) => F.reduce((a, x) => a + x[k], 0)
for (const [name, strat] of [['对半强化', 'half'], ['全堆防', 'allDef']]) {
  const r = replay(strat), A = r.F1
  const zeroLossLayers = A.filter(x => x.b > 0 && x.loss === 0).length
  console.log(`  -- ${name}: ${r.s.ended} / ${r.s.floor + 1}F / HP${r.s.hero.hp} A${r.s.hero.atk} D${r.s.hero.def} ` +
    `| F1 战斗${sum(A, 'b')} 防杀${sum(A, 'block')} lethal${sum(A, 'lethal')} 破不了${sum(A, 'unbreak')} 总损血${sum(A, 'loss')}`)
  ok(`v0.24.0 ${name} 真实回放通关到 21F`, r.s.ended === 'win' && r.s.floor === 20)
  ok(`v0.24.0 ${name} 首次推进 21 层层层掉血（零损血层 = 0）`, zeroLossLayers === 0, `${zeroLossLayers}/21`)
  ok(`v0.24.0 ${name} 首次推进纯物理防杀 ≤ 2 场`, sum(A, 'block') <= 2, `${sum(A, 'block')} 场`)
  ok(`v0.24.0 ${name} 首次推进无「破不了防」`, sum(A, 'unbreak') === 0)
  ok(`v0.24.0 ${name} 变强回头防杀属经典魔塔固有（不误判为失败）`, sum(r.F2, 'block') >= 0)
}

console.log('\n--- 8. v0.24.1 点击寻路：外层怪未清时里面怪不可达 ---')
// 复现用户场景：点凹室深处的怪，它四周无可站落脚格；唯一入口被外层怪占据。
// app.js walkTo 的回退分支若漏传 blockEntities，就会穿越外层怪、先撞外面的怪。
// 这里直接校验：带 blockEntities 时不可达（修后回退同样带），墙围死角仍可达（历史意图保留）。
{
  const rowsBlocked = [
    '#########', '#.......#', '#..##.#.#', '#P12#...#',
    '#..##.#.#', '#.......#', '#########'
  ].map(r => r.split(''))
  const rowsCorner = [
    '#########', '#.......#', '#..##.#.#', '#P.2#...#',
    '#..##.#.#', '#.......#', '#########'
  ].map(r => r.split(''))
  const origRows = FLOORS[0].rows
  try {
    FLOORS[0].rows = rowsBlocked
    const sb = newGame(); sb.floor = 0; sb.x = 1; sb.y = 3
    sb.hero.hp = 99999; sb.hero.atk = 99999; sb.hero.def = 99999
    const standBlocked = findPath(sb, new Set(['3,3']), { blockEntities: true })
    ok('v0.24.1 目标怪四周落脚点被外层怪占据时不可达（不会先撞外层怪）',
      !standBlocked.path || !standBlocked.path.length,
      standBlocked.path ? standBlocked.path.join(',') : '不可达')
    // 校验 app.js 回退分支已带 blockEntities（静态防漂移，锁住修复）
    ok('v0.24.1 app.js 回退寻路带 blockEntities:true（防止穿越外层怪）',
      /standTargets\.size === 0\)\s*\n\s*r = findPath\(state, new Set\(\[tx \+ ',' \+ ty\]\), \{ blockEntities: true \}\)/.test(read('app.js')))

    FLOORS[0].rows = rowsCorner
    const sc = newGame(); sc.floor = 0; sc.x = 1; sc.y = 3
    sc.hero.hp = 99999; sc.hero.atk = 99999; sc.hero.def = 99999
    const corner = findPath(sc, new Set(['3,3']), { blockEntities: true })
    ok('v0.24.1 真正的墙围死角仍可走进目标格（保留历史意图）',
      !!corner.path && corner.path.length > 0,
      corner.path ? corner.path.join(',') : '不可达')
  } finally {
    FLOORS[0].rows = origRows
  }
}

console.log('\n' + (fail ? '存在 ' + fail + ' 项失败' : '全部 ' + pass + ' 项断言通过') + '（v0.24.0 专项）\n')
if (fail) process.exitCode = 1
