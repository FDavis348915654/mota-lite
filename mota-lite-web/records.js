// records.js —— 通关记录的纯逻辑（零 DOM / 零平台依赖，可被 node 离线校验）
//
// 与存档纪律一致：
//   - 独立 localStorage key，不塞进存档串（存档串仍是可复制的紧凑格式）；
//   - 只在「正常游玩态真实走了一步」时由宿主层调用 applyStep()；
//     回放、时间旅行、导入外部存档都不计入（这些状态不是玩家打出来的）。
//   - 只认「本步从非通关跃迁到通关」才算一次通关，读档到已通关存档不重复计数。

export const RECORD_KEY = 'mota_lite_web_records_v1'

export function emptyRecords() {
  return { bestFloor: 1, minSteps: null, wins: 0 }
}

// 容错归一化：手改 localStorage / 旧版残留 / 坏 JSON 都退回默认值，不让 UI 崩
export function normalizeRecords(raw) {
  const e = emptyRecords()
  if (!raw || typeof raw !== 'object') return e
  const f = Number(raw.bestFloor)
  const w = Number(raw.wins)
  const m = raw.minSteps === null || raw.minSteps === undefined ? null : Number(raw.minSteps)
  return {
    bestFloor: Number.isInteger(f) && f >= 1 ? f : e.bestFloor,
    wins: Number.isInteger(w) && w >= 0 ? w : e.wins,
    minSteps: m === null || (Number.isInteger(m) && m > 0) ? m : null
  }
}

// before / after 是 resolveStep 前后的 state，steps 是本次会话已走步数。
// 返回新对象（不改入参），宿主层决定是否落盘。
export function applyStep(records, before, after, steps) {
  const r = normalizeRecords(records)
  if (after.floor !== before.floor) {
    r.bestFloor = Math.max(r.bestFloor, after.floor + 1)
  }
  if (before.ended !== 'win' && after.ended === 'win') {
    r.wins += 1
    r.minSteps = r.minSteps === null ? steps : Math.min(r.minSteps, steps)
  }
  return r
}

// 展示文案：totalFloors 由配置表传入，视图层不写死层数
export function formatRecords(records, totalFloors) {
  const r = normalizeRecords(records)
  return {
    bestFloor: r.bestFloor + 'F / ' + totalFloors + 'F',
    minSteps: r.minSteps === null ? '—' : r.minSteps + ' 步',
    wins: String(r.wins)
  }
}
