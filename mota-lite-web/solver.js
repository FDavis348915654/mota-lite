// solver.js —— 在线版「完整内容」通关路线求解（开发工具，不进任何运行时页面逻辑）
//
// 【为什么不再是穷举 BFS】
// v0.3 的 3 层地图只有 ~10 个可清格，宽搜 3428 状态即可找到 26 步最短路。
// v0.4 扩到 5 层、v0.5 扩到 10 层、v0.6 再扩到 21 层 + 大量道具/怪物/门后，
// 属性(HP/攻/防/金币/钥匙)与 opened 变更集的组合指数增长，
// 实测宽搜展开 40 万状态仍未收敛 —— 不是死局，是搜索策略不适用。
// 因此改为「策略式攻略」：单层静态 BFS 寻路 + 贪心清场，产出一条真实可走通的路线。
// findPath() 同时导出给 app.js 的「点击格子移动」复用，保证两处障碍判定完全同源。
// 可解性由 tools/validate_logic.mjs 的三重断言保证：
//   ① 每层 flood fill 所有实体格可达；② 楼梯双向配对；③ 本路线逐步 resolveStep 能通关。
//
// 输出的 steps 仍是纯方向数组，回放控制台直接消费，接口不变。
// 可选机制（飞行器 / 炸弹 / 商店）不进路线 —— 它们是捷径而非通关必需。

import {
  newGame, resolveStep, tileAt, calcBattle, isEntityTile, FLAG, thiefStage
} from './logic.js'
import {
  FLOORS, DOOR_KEY, DOOR_COST, monsterByCh, itemByCh
} from './tables.js'

const DIRS = ['up', 'down', 'left', 'right']
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

// 单层静态寻路：找「从当前位置到任一目标格」的最短方向序列。
//
// opts.blockEntities = true（v0.8 玩家点击用，v0.10 收紧）：物品 / 怪物 / 钥匙 / 门 / NPC / 图鉴都不穿越，
//   只走地板 / 楼梯 / 王座 / 暗格；门必须主动点击才会开，是真正的障碍。
//   这样「点远处道具」会停在它旁边一格，再由宿主层补一次交互。
// 不传 opts（solver 攻略自用）：保持 v0.7 语义 —— 可打赢的怪、道具、门都能穿过，
//   沿途由 resolveStep 逐个结算，保证通关路线不受新交互规则影响。
// 商人 N 在任何模式下都不穿越：撞上去只对话不移动，穿过去会规划出「走不动」的路径。
export function findPath(s, targets, opts) {
  const blockEntities = !!(opts && opts.blockEntities)
  const W = FLOORS[s.floor].rows[0].length, H = FLOORS[s.floor].rows.length
  const startKey = s.y * W + s.x
  const q = [{ x: s.x, y: s.y, path: [] }]
  const seen = new Set([startKey])
  let head = 0, visited = 0
  while (head < q.length) {
    const cur = q[head++]
    visited++
    for (const d of DIRS) {
      const delta = DELTA[d]
      const nx = cur.x + delta[0], ny = cur.y + delta[1]
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const k = ny * W + nx
      if (seen.has(k)) continue
      const ch = tileAt(s, nx, ny)
      if (ch === '#') continue
      // v0.12 暗门 A 伪装成墙：只允许作为目标格（主动撞墙），绝不能被当成通路穿过去，
      // 否则 solver 会规划出「穿墙」路径，resolveStep 撞开后又停在原地，路线会反复震荡。
      if (ch === 'A' && !targets.has(nx + ',' + ny)) continue
      const mon = monsterByCh(ch)
      if (mon && !calcBattle(s.hero, mon, s.floor).ok) continue
      const need = DOOR_KEY[ch]
      // v0.12：铁门要 3 把黄钥匙，只有 1~2 把时不能当作「可穿过」，
      // 否则攻略会规划一条实际走不通的路并在门前来回 break，最终触发死局信号。
      if (need && s.hero.keys[need] < (DOOR_COST[ch] || 1)) continue
      // v0.13：封印门 Z 钥匙开不了，只能等盗贼任务线远程撬开；两种模式都不可穿越。
      if (ch === 'Z') continue
      // v0.13：法师 M / 盗贼 T 救出后常驻（固定 NPC），路径不可穿越、只允许作为目标格
      // （完成任务时撞上去）；否则路径会反复穿过它们被「撞停」，在原地死循环（r113 震荡根因）。
      if ((ch === 'M' || ch === 'T') && !targets.has(nx + ',' + ny)) continue
      // 商人不可踩：两种模式都绕开
      if (ch === 'N') continue
      // v0.14：楼梯 U/D 只允许作为终点，不能当普通地板穿过。加密隔间后
      // BFS 会规划出「抄近路踩 D」的路径，resolveStep 立刻换层、路径后半段
      // 作废，英雄落回上一层的 U 格，形成「起点即目标」死局（8F 实测轨迹）。
      // g.stairs 目标就是 U；盗贼任务线下楼目标 (1,1) 是 D —— 都靠 targets 放行。
      if ((ch === 'U' || ch === 'D') && !targets.has(nx + ',' + ny)) continue
      // v0.10 玩家点击模式：门与其它实体一律不穿越（经典魔塔「门不可绕行」）。
      // 门必须主动点击才会开；只有「目标格本身就是这个实体」才允许作为终点。
      // solver 自用模式（不传 opts）仍可穿过有钥匙的门，保证攻略路线不受影响。
      if (blockEntities && isEntityTile(ch) && !targets.has(nx + ',' + ny)) continue
      const path = cur.path.concat(d)
      if (targets.has(nx + ',' + ny)) return { path, visited }
      seen.add(k)
      q.push({ x: nx, y: ny, path })
    }
  }
  return { path: null, visited }
}

// 收集当前层仍「可清且有益」的目标格，按优先级分组。
// 门只在有对应钥匙时列入；打不过的怪不列入（等属性提升后下一轮自然会出现）。
function scan(s) {
  const rows = FLOORS[s.floor].rows
  const W = rows[0].length, H = rows.length
  const g = { win: [], items: [], monsters: [], doors: [], stairs: [] }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = tileAt(s, x, y)
      const key = x + ',' + y
      if (ch === 'W') g.win.push(key)
      // v0.12：暗门 A 也算支线目标，攻略会顺路撞开拿墙后奖励（含黄钥匙），
      // 但它们不是必经路，少撞几处也不影响通关。
      if (itemByCh(ch) || ch === 'H' || ch === 'A') {
        // v0.13 常驻 NPC：法师救过之后是「兑换商」不是清场目标（兑换可选，攻略不用）；
        // 盗贼只在「撞上去能推进任务线」时列为目标，否则会对常驻格反复空撞、死循环。
        if (ch === 'M' && (s.hero.flags & FLAG.MAGE_FREED)) continue
        if (ch === 'T') {
          const st = thiefStage(s.hero)
          const canAdvance = st === 0 ||
            (st === 1 && (s.hero.flags & FLAG.LOCKPICK)) ||
            (st === 2 && (s.hero.flags & FLAG.MONEYBAG))
          if (!canAdvance) continue
        }
        g.items.push(key)
      }
      const mon = monsterByCh(ch)
      if (mon && calcBattle(s.hero, mon, s.floor).ok) g.monsters.push(key)
      const need = DOOR_KEY[ch]
      if (need && s.hero.keys[need] >= (DOOR_COST[ch] || 1)) g.doors.push(key)
      if (ch === 'U') g.stairs.push(key)   // 只规划上楼，避免 D 下楼造成来回震荡
    }
  }
  return g
}

export function findSolution() {
  let s = newGame()
  const steps = []
  let visited = 0, rounds = 0
  const MAX_STEPS = 3000   // 21 层 13×15 大地图实测 1432 步，留足余量

  while (!s.ended && steps.length < MAX_STEPS) {
    rounds++
    if (rounds > 600) return null            // 防策略死循环

    // v0.13 盗贼任务线：持有任务道具且盗贼在等交付时，优先逐层下楼回 15F（floor index 14）。
    // stage1（交锁匠工具）是通关硬门槛 —— 16F 封印门 Z 不开就到不了上层；stage2（交钱袋）
    // 是可选支线，也顺路完成以验证全链。D 楼梯固定 (1,1)，逐层下，路径到 D 为止（踩 D 换层）。
    const _st = thiefStage(s.hero)
    const _needThief = (_st === 1 && (s.hero.flags & FLAG.LOCKPICK)) ||
                       (_st === 2 && (s.hero.flags & FLAG.MONEYBAG))
    if (_needThief && s.floor > 14) {
      const rd = findPath(s, new Set(['1,1']))
      if (rd.path) {
        for (const d of rd.path) {
          const bf = s.floor
          const rr = resolveStep(s, d)
          s = rr.state
          steps.push(d)
          if (s.ended || s.floor !== bf) break   // 踩到 D 已换层，旧路径作废
        }
        continue
      }
    }

    const g = scan(s)
    const groups = [g.win, g.items, g.monsters, g.doors, g.stairs]
    let picked = null
    for (const targets of groups) {
      if (!targets.length) continue
      const r = findPath(s, new Set(targets))
      visited += r.visited
      if (r.path) { picked = r.path; break }
    }
    if (!picked) return null                 // 无可达目标 = 死局信号

    const beforeFloor = s.floor
    for (const d of picked) {
      const before = s.floor + ',' + s.x + ',' + s.y
      const r = resolveStep(s, d)
      s = r.state
      steps.push(d)
      if (s.ended) break
      // v0.14：踩到楼梯换层后，当前层的剩余方向全部作废（英雄已落到另一层），
      // 否则会拿旧路径在新层乱走，甚至停回 U 格上。
      if (s.floor !== beforeFloor) break
      // 被墙/门/不可破防拦住、或 v0.11 实体交互结算后停在原地，坐标都不变；
      // 统一当作「本段路径走完」，由外层重新 scan（该实体已清成地板，不再列为目标）。
      if (s.floor + ',' + s.x + ',' + s.y === before) break
    }
  }

  if (s.ended !== 'win') return null
  return { steps, state: s, hero: s.hero, expanded: visited, rounds }
}
