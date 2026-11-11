// tools/solver.js —— BFS 找一条真实通关路径，供离线校验脚本复用（不进 rpk）
import { newGame, resolveStep, serialize } from '../src/common/logic.js'

const DIRS = ['up', 'down', 'left', 'right']

export function findSolution() {
  const q = [{ s: newGame(), path: [] }]
  const seen = new Set([serialize(q[0].s)])
  let head = 0
  const MAX = 200000
  while (head < q.length && seen.size < MAX) {
    const cur = q[head++]
    for (const d of DIRS) {
      const { state: ns } = resolveStep(cur.s, d)
      if (ns.ended === 'dead') continue
      const path = cur.path.concat(d)
      if (ns.ended === 'win') {
        return { steps: path, state: ns, hero: ns.hero, expanded: seen.size }
      }
      const k = serialize(ns)
      if (seen.has(k)) continue
      seen.add(k)
      q.push({ s: ns, path })
    }
  }
  return null
}
