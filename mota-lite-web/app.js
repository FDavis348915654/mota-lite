// 在线试玩版胶水层 —— 不重写任何游戏规则。
// 直接 import 在线版自己的 logic.js / tables.js / solver.js（单一真源），
// 只替换宿主能力：输入（键盘/点击/手势）、渲染（DOM + 像素精灵）、存档（localStorage）。
//
// v0.4「完整内容阶段」新增的表现层（全部只读调用逻辑层 / 配置表，不改写规则）：
//   - 像素精灵渲染（assets/sprites.png + sprites.json），可一键切回色块；
//   - 战斗动画（旧帧 -> 特效覆盖层 -> 新帧），回放/演示自动跳过，带动画锁；
//   - 文本框弹层（打字机），剧情 / 隐藏发现 / 商店 / 结局，每段只弹一次、回放不弹；
//   - Web Audio 播放 8-bit WAV（静音开关，首次交互后初始化）；
//   - 飞行器 / 炸弹 / 商店交易的入口，与 step() 共用逻辑层纯函数。
import {
  CONFIG, newGame, resolveStep, buildCells, tileAt, calcBattle, scaledMon, battleHint,
  serialize, deserialize, useFly, useBomb, shopBuy, shopOffer, SHOP_GOODS, isEntityTile
} from './logic.js'
import {
  FLOORS, TILE_COLOR, TILE_CHAR, MONSTERS, ITEMS, DOOR_KEY, VIEWPORT,
  monsterByCh, itemByCh, hiddenAt, secretAt
} from './tables.js'
import { findSolution, findPath } from './solver.js'
import { VERSION, BUILD_DATE, CHANGELOG } from './version.js'
import { TEXTS } from './texts.js'
import { RECORD_KEY, emptyRecords, normalizeRecords, applyStep, formatRecords } from './records.js'

const SAVE_KEY = 'mota_lite_web_v1'   // 保持原 key：旧版 v1 存档串会被 deserialize() 兼容读入
const $ = id => document.getElementById(id)

const screenEl = $('screen'), gridEl = $('grid'), fxLayer = $('fxLayer'), deviceEl = $('device')
const tipEl = $('tip'), overEl = $('over'), logEl = $('log')
const modeBadge = $('modeBadge'), replayInfo = $('replayInfo'), replayBar = $('replayBar')
const routeStrip = $('routeStrip'), battleList = $('battleList'), legendEl = $('legend')
const eventList = $('eventList'), savePreview = $('savePreview'), saveBarFill = $('saveBarFill')
const saveInput = $('saveInput')

const ARROW = { up: '↑', down: '↓', left: '←', right: '→' }
const DIRNAME = { up: '上', down: '下', left: '左', right: '右' }
const DELTA = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }
const SPEEDS = [640, 320, 160, 80]

let state = null, steps = 0, history = []

// 通关记录（独立于存档串；回放 / 时间旅行 / 导入外部存档都不写入）
let records = emptyRecords()

// 回放态
let replayMode = false, route = [], snapshots = [], cursor = 0
let playTimer = null, speed = 320, backup = null

// 表现层状态
let atlas = null, spriteMode = true, animOn = true, soundOn = true
let animating = false
// v0.6.0：点击格子移动 / 设置浮层状态
let autoQueue = [], autoTimer = null, suppressGridClick = false, settingsOpen = false
// v0.8：点实体时「走完路径后要补的一次交互」，以及图鉴浮层开关
let pendingInteract = null, codexOpen = false
// 通用二次确认弹窗：confirmOpen 期间所有游戏输入让位
let confirmOpen = false, confirmAction = null
let audioCtx = null, audioReady = false, audioBuffers = {}
let storyQueue = [], storySeen = new Set(), storyOpen = false, typeTimer = null, currentStory = null

// ---- 固定槽位：整层 W*H 个节点，生命周期内不增删 ----
// v0.8：13×15 = 195 个槽位全部渲染，靠 .viewport 裁出 7×9 一屏 + translate 相机跟随英雄。
// 相机不进存档（纯表现层，由 state.x/y 派生），所以存档格式不受影响。
const W = FLOORS[0].rows[0].length, H = FLOORS[0].rows.length
gridEl.style.width = W * CONFIG.CELL + 'px'
gridEl.style.height = H * CONFIG.CELL + 'px'
fxLayer.style.width = W * CONFIG.CELL + 'px'
fxLayer.style.height = H * CONFIG.CELL + 'px'
const slots = []
for (let i = 0; i < W * H; i++) {
  const box = document.createElement('div'); box.className = 'cell'
  box.dataset.i = String(i)          // 点击格子时反推 (x,y)；195 槽位结构恒定
  const ch = document.createElement('span'); ch.className = 'cell-ch'
  box.appendChild(ch); gridEl.appendChild(box); slots.push({ box, ch })
}

// ---- 跟随相机：把英雄尽量放在视口中央，到边界时贴边 ----
let camX = 0, camY = 0
function updateCamera() {
  const gw = FLOORS[state.floor].rows[0].length
  const gh = FLOORS[state.floor].rows.length
  const halfC = Math.floor(VIEWPORT.cols / 2), halfR = Math.floor(VIEWPORT.rows / 2)
  camX = Math.max(0, Math.min(gw - VIEWPORT.cols, state.x - halfC))
  camY = Math.max(0, Math.min(gh - VIEWPORT.rows, state.y - halfR))
  const L = CONFIG.CELL
  const tf = 'translate(' + (-camX * L) + 'px,' + (-camY * L) + 'px)'
  gridEl.style.transform = tf
  fxLayer.style.transform = tf
}

function log(text) { logEl.textContent = text }

// 精灵表异步加载：加载前先用色块渲染，到了再整表刷新，零阻塞冷启动
fetch('./assets/sprites.json')
  .then(r => r.json()).then(a => { atlas = a; renderCells(buildCells(state)) })
  .catch(() => { atlas = null })

// ---- 音频：首次交互后初始化，音频不可用时全部静默降级 ----
async function ensureAudio() {
  if (audioCtx || audioReady) return
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    audioCtx = new AC()
    const names = [...new Set(Object.values(TEXTS.sfx))]
    await Promise.all(names.map(async n => {
      const buf = await fetch('./assets/audio/' + n + '.wav').then(r => r.arrayBuffer())
      audioBuffers[n] = await audioCtx.decodeAudioData(buf)
    }))
    audioReady = true
  } catch (e) { audioCtx = null }
}
function playSfx(key) {
  if (!soundOn || !audioReady || !audioCtx) return
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const b = audioBuffers[TEXTS.sfx[key]]
    if (!b) return
    const src = audioCtx.createBufferSource(); src.buffer = b
    const g = audioCtx.createGain(); g.gain.value = 0.45
    src.connect(g); g.connect(audioCtx.destination); src.start()
  } catch (e) { /* 忽略音频设备异常 */ }
}
document.addEventListener('pointerdown', ensureAudio, { once: true })
document.addEventListener('keydown', ensureAudio, { once: true })

function textColor(bg) {
  const m = /^#([0-9a-f]{6})$/i.exec(bg)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0b1017' : '#ffffff'
}

// ---- 存档：回放期间只读预览，不落盘 ----
function save() {
  if (replayMode) { updateSavePreview(); return }
  try { localStorage.setItem(SAVE_KEY, serialize(state)) } catch (e) { /* 隐私模式 */ }
  updateSavePreview()
}
function load() {
  try { return deserialize(localStorage.getItem(SAVE_KEY) || '') } catch (e) { return null }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY) } catch (e) {} }

// ---- 通关记录：独立 key，坏数据归一化，回放期间绝不写盘 ----
function loadRecords() {
  try { return normalizeRecords(JSON.parse(localStorage.getItem(RECORD_KEY) || 'null')) }
  catch (e) { return emptyRecords() }
}
function saveRecords() {
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(records)) } catch (e) { /* 隐私模式 */ }
}
function renderRecords() {
  const f = formatRecords(records, FLOORS.length)
  $('recBestFloor').textContent = f.bestFloor
  $('recMinSteps').textContent = f.minSteps
  $('recWins').textContent = f.wins
  $('recHint').textContent = TEXTS.ui.recHint
}
// 正常游玩态真实走一步（或真实换层 / 真实通关）后才调用；回放态直接跳过
function commitRecords(before, after, stepCount) {
  if (replayMode) return
  const next = applyStep(records, before, after, stepCount)
  if (next.bestFloor === records.bestFloor && next.wins === records.wins && next.minSteps === records.minSteps) return
  records = next
  saveRecords(); renderRecords()
  if (after.ended === 'win' && before.ended !== 'win') {
    log(TEXTS.ui.recWon.replace('{wins}', records.wins).replace('{min}', records.minSteps + ' 步'))
  }
}
function clearRecords() {
  records = emptyRecords()
  try { localStorage.removeItem(RECORD_KEY) } catch (e) {}
  renderRecords(); log(TEXTS.ui.recCleared)
}
function updateSavePreview() {
  const text = serialize(state)
  const size = new Blob([text]).size
  savePreview.textContent = text
  $('iSaveSize').textContent = size + ' B / ' + CONFIG.SAVE_LIMIT + ' B'
  saveBarFill.style.width = Math.min(100, size / CONFIG.SAVE_LIMIT * 100) + '%'
  saveBarFill.classList.toggle('over', size > CONFIG.SAVE_LIMIT)
  $('saveHint').textContent = size > CONFIG.HANDHELD_SAVE_LIMIT
    ? '已超过手环端 ' + CONFIG.HANDHELD_SAVE_LIMIT + 'B 参考线：真机移植须压缩（spec 附 D）'
    : '在线版 localStorage 无 128B 限制；手环端参考线 ' + CONFIG.HANDHELD_SAVE_LIMIT + 'B'
}

// ---- 图例：完全由 tables.js + texts.js 生成 ----
function swatch(bg, glyph, tip) {
  const el = document.createElement('span')
  el.className = 'swatch'; el.style.backgroundColor = bg
  el.style.color = textColor(bg); el.textContent = glyph
  if (tip) el.title = tip
  return el
}
function legendItem(bg, glyph, name, tip) {
  const el = document.createElement('span'); el.className = 'legend-item'
  el.appendChild(swatch(bg, glyph, tip))
  const t = document.createElement('span'); t.textContent = name; if (tip) t.title = tip
  el.appendChild(t); return el
}
function legendGroup(title, items) {
  const g = document.createElement('div'); g.className = 'legend-group'
  const h = document.createElement('div'); h.className = 'legend-title'; h.textContent = title
  g.appendChild(h); items.forEach(it => g.appendChild(it)); return g
}
function buildLegend() {
  const terrain = ['#', '.', '@', 'U', 'D', 'W', 'N', 'H']
  const terrainName = { '#': '墙', '.': '地板', '@': '出生点', 'U': '上楼', 'D': '下楼', 'W': '王座/通关', 'N': '商店', 'H': '隐藏暗格' }
  const kd = ['Y', 'B', 'R', 'y', 'b', 'r']
  const kdName = { 'Y': '黄门', 'B': '蓝门', 'R': '红门', 'y': '黄钥匙', 'b': '蓝钥匙', 'r': '红钥匙' }
  legendEl.innerHTML = ''
  legendEl.appendChild(legendGroup('地形 / 出口', terrain.map(ch =>
    legendItem(TILE_COLOR[ch] || TILE_COLOR['.'], TILE_CHAR[ch] || ch, terrainName[ch]))))
  legendEl.appendChild(legendGroup('门 / 钥匙', kd.map(ch =>
    legendItem(TILE_COLOR[ch], TILE_CHAR[ch] || ch, kdName[ch]))))
  legendEl.appendChild(legendGroup('道具 / 能力', ITEMS.map(it =>
    legendItem(TILE_COLOR[it.ch] || TILE_COLOR['.'], TILE_CHAR[it.ch] || it.ch, it.name, TEXTS.itemDesc[it.id]))))
  // v0.9：怪物基础数值只是「未缩放兜底」，运行时由 FLOOR_SCALE 派生本层实际值。
  // 图例是启动时静态构建的，若写死基础数值会与战斗预览 / 图鉴冲突（1F 史莱姆基础 20/8/2、实际 28/50/6），
  // 故这里只列怪种与分工，数值统一以图鉴为准；分组标题注明口径。
  legendEl.appendChild(legendGroup('怪物（数值逐层变化，见图鉴）', MONSTERS.map(m =>
    legendItem(m.bg, m.ch, m.name + (m.pierce ? ' ✦' : ''), TEXTS.monsterDesc[m.id]))))
}

// ---- 战斗预览：只读扫当前层存活怪物 + 复用 calcBattle() ----
// v0.9：数值显示本层实际值（scaledMon），并给出经典魔塔怪物手册的「临界 / 加防收益」。
function renderBattlePreview() {
  const rows = FLOORS[state.floor].rows
  const fw = rows[0].length, fh = rows.length
  const counts = new Map()
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
    const mon = monsterByCh(tileAt(state, x, y))
    if (mon) counts.set(mon.ch, (counts.get(mon.ch) || 0) + 1)
  }
  battleList.innerHTML = ''
  if (!counts.size) {
    const p = document.createElement('p'); p.className = 'dim'; p.style.margin = '0'
    p.textContent = '本层已无存活怪物'; battleList.appendChild(p); return
  }
  MONSTERS.forEach(m => {
    const n = counts.get(m.ch); if (!n) return
    const msc = scaledMon(m, state.floor)
    const hint = battleHint(state.hero, m, state.floor)
    const r = hint.r
    const row = document.createElement('div'); row.className = 'battle-row'
    row.appendChild(swatch(m.bg, m.ch, TEXTS.monsterDesc[m.id]))
    const name = document.createElement('span'); name.className = 'bname'
    name.textContent = m.name + (m.pierce ? ' ✦' : '') + (n > 1 ? ' ×' + n : '')
    name.title = m.pierce ? '真实伤害：无视防御' : TEXTS.monsterDesc[m.id]
    row.appendChild(name)
    const stat = document.createElement('span'); stat.className = 'bstat'
    stat.textContent = msc.hp + '/' + msc.atk + '/' + msc.def
    stat.title = '本层实际 HP / 攻 / 防'
    row.appendChild(stat)
    const badge = document.createElement('span')
    if (r.ok) { badge.className = 'badge ok'; badge.textContent = '可打 · ' + r.rounds + ' 回合 · -' + r.hpCost + ' HP' }
    else { badge.className = 'badge no'; badge.textContent = r.reason === 'unbreakable' ? '不可破防' : '会阵亡 -' + r.hpCost + ' HP' }
    // 怪物手册：临界攻击 / 加防收益（经典魔塔策略信息）
    const tips = [m.pierce ? '✦真实伤害，堆防无效' : ('每 +1 防少掉 ' + hint.defGain + ' HP')]
    if (hint.nextAtk != null) tips.push('再 +' + hint.nextAtk + ' 攻少挨一回合')
    badge.title = tips.join('；')
    row.appendChild(badge); battleList.appendChild(row)
  })
}

// ---- 事件流水 ----
function renderHistory() {
  eventList.innerHTML = ''
  if (!history.length) {
    const li = document.createElement('li'); li.className = 'empty'
    li.textContent = '暂无事件，走一步试试'; eventList.appendChild(li); return
  }
  const frag = document.createDocumentFragment()
  history.slice(-60).forEach(h => {
    const li = document.createElement('li')
    const no = document.createElement('span'); no.className = 'eno'; no.textContent = '#' + h.step
    const tx = document.createElement('span'); tx.textContent = h.text
    li.appendChild(no); li.appendChild(tx); frag.appendChild(li)
  })
  eventList.appendChild(frag); eventList.scrollTop = eventList.scrollHeight
}

// ---- 渲染：精灵 / 色块两套外观，共用同一份 buildCells 输出 ----
function applyVisual(s, c) {
  const id = c.isHero ? 'hero_a' : (atlas && atlas.tileMap[c.tile])
  const f = spriteMode && atlas && atlas.frames[id]
  if (f) {
    s.box.style.backgroundColor = '#1b2430'
    s.box.style.backgroundImage = "url('./assets/sprites.png')"
    s.box.style.backgroundPosition = '-' + f.x + 'px -' + f.y + 'px'
    s.box.style.backgroundSize = atlas.width + 'px ' + atlas.height + 'px'
    s.ch.textContent = ''
  } else {
    s.box.style.backgroundImage = 'none'
    s.box.style.backgroundColor = c.bg
    s.ch.style.color = textColor(c.bg)
    s.ch.textContent = c.hasCh ? c.ch : ''
  }
}
function renderCells(cells) {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i], s = slots[i]
    s.box.style.left = c.x + 'px'; s.box.style.top = c.y + 'px'
    applyVisual(s, c); s.box.classList.toggle('is-hero', c.isHero)
  }
}
function renderHud() {
  const h = state.hero, f = FLOORS[state.floor]
  // 分段彩色 HUD：固定 span 槽位，只改 textContent 与低血量警示 class，不重建 DOM
  $('hudFloor').textContent = f.name
  const hp = $('hudHp')
  hp.textContent = 'HP' + h.hp
  hp.classList.toggle('low', h.hp <= 30)
  $('hudAtk').textContent = 'A' + h.atk
  $('hudDef').textContent = 'D' + h.def
  $('hudKy').textContent = 'Y' + h.keys.y
  $('hudKb').textContent = 'B' + h.keys.b
  $('hudKr').textContent = 'R' + h.keys.r
  $('hudGold').textContent = 'G' + h.gold
  $('iPos').textContent = f.name + '  (' + state.x + ',' + state.y + ')'
  $('iHero').textContent = h.hp + ' / ' + h.atk + ' / ' + h.def
  $('iKeys').textContent = h.keys.y + ' / ' + h.gold
  $('iSteps').textContent = String(steps)
  $('iFly').textContent = h.fly ? '已持有 ✈' : '0'
  $('iBomb').textContent = String(h.bomb)
  $('iGold').textContent = String(h.gold)
  // 图鉴按钮：未持有时淡化，点击给出提示（不用 disabled，玩家需要知道为什么点不动）
  $('btnActCodex').classList.toggle('locked', !h.book)
}
function renderOver() {
  if (state.ended) {
    overEl.hidden = false
    $('overTitle').textContent = state.ended === 'win' ? '通关' : '阵亡'
    $('overSub').textContent = state.ended === 'win' ? '魔王已被击败' : 'HP 归零，再来一次'
  } else overEl.hidden = true
}
function render() {
  renderCells(buildCells(state))
  updateCamera()
  renderHud(); updateSavePreview(); renderBattlePreview(); renderOver()
}
function pulse() {
  deviceEl.classList.remove('vib'); void deviceEl.offsetWidth
  deviceEl.classList.add('vib'); setTimeout(() => deviceEl.classList.remove('vib'), 180)
}

// ---- 战斗动画：只影响视觉节奏，不改变 state 序列 ----
function spriteBg(id) {
  const f = atlas && atlas.frames[id]
  return f ? "url('./assets/sprites.png')" : 'none'
}
function spritePos(id) {
  const f = atlas && atlas.frames[id]
  return f ? '-' + f.x + 'px -' + f.y + 'px' : '0 0'
}
function showBattleFx(sx, sy, tx, ty, dmg) {
  const L = CONFIG.CELL
  fxLayer.innerHTML = ''
  const mk = (cls, x, y, id) => {
    const el = document.createElement('div'); el.className = cls
    el.style.left = x * L + 'px'; el.style.top = y * L + 'px'
    if (id && atlas) {
      el.style.backgroundImage = spriteBg(id)
      el.style.backgroundPosition = spritePos(id)
      el.style.backgroundSize = atlas.width + 'px ' + atlas.height + 'px'
    }
    fxLayer.appendChild(el); return el
  }
  mk('fx-hit', tx, ty, 'fx_hit')
  mk('fx-dmg', tx, ty).textContent = dmg > 0 ? '-' + dmg + 'HP' : '防杀!'
  const dash = mk('fx-dash', sx, sy, 'hero_b')
  dash.style.setProperty('--dx', (tx - sx) * L + 'px')
  dash.style.setProperty('--dy', (ty - sy) * L + 'px')
}
function hideBattleFx() { fxLayer.innerHTML = '' }

// ---- 文本框弹层：打字机 + 剧情队列 ----
function queueStory(key, actions, once = true) {
  if (replayMode || !TEXTS.story[key]) return
  if (once && storySeen.has(key)) return
  if (once) storySeen.add(key)
  storyQueue.push({ key, actions: actions || [] })
  flushStory()
}
function showNextStory() {
  const item = storyQueue.shift()
  if (!item) { storyOpen = false; return }
  currentStory = item
  const seg = TEXTS.story[item.key]
  storyOpen = true
  $('storyTitle').textContent = seg.title
  $('storyBody').textContent = ''
  const acts = $('storyActions'); acts.innerHTML = ''
  item.actions.forEach(a => {
    const b = document.createElement('button'); b.textContent = a.label
    b.addEventListener('click', () => { a.run(); dismissStory() })
    acts.appendChild(b)
  })
  $('storyLayer').hidden = false
  clearInterval(typeTimer)
  let i = 0
  typeTimer = setInterval(() => {
    const body = $('storyBody')
    body.textContent = seg.body.slice(0, ++i)
    // v0.12：正文放大到 14px 后可滚动，打字机要跟着滚到底，不能把后半段藏起来
    body.scrollTop = body.scrollHeight
    if (i >= seg.body.length) { clearInterval(typeTimer); typeTimer = null }
  }, 22)
  playSfx('story')
}
function dismissStory() {
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null }
  $('storyLayer').hidden = true
  storyOpen = false; currentStory = null
  showNextStory()
}
function closeStory() {
  if (typeTimer) {
    clearInterval(typeTimer); typeTimer = null
    if (currentStory) {
      const body = $('storyBody')
      body.textContent = TEXTS.story[currentStory.key].body
      body.scrollTop = body.scrollHeight
    }
    return
  }
  dismissStory()
}
function flushStory() { if (!storyOpen && storyQueue.length && !animating) showNextStory() }

// ---- 通用二次确认弹窗 ----
// 刻意不用 window.confirm：无头浏览器会被原生 dialog 阻塞、样式不统一、也无法自动化断言。
// 这里是屏幕内浮层 + 回调；confirmOpen 期间 manualStep / walkTo / swipe / doAction / 键盘游戏输入全部让位。
function openConfirm(opt) {
  if (confirmOpen) return
  pause(); stopAuto()
  if (settingsOpen) closeSettings()
  confirmAction = opt.onOk
  $('confirmTitle').textContent = opt.title
  $('confirmBody').textContent = opt.body
  $('confirmOk').textContent = opt.okLabel
  $('confirmCancel').textContent = TEXTS.confirm.cancel
  confirmOpen = true
  $('confirmLayer').hidden = false
  playSfx('click')
}
function closeConfirm() {
  confirmOpen = false; confirmAction = null
  $('confirmLayer').hidden = true
}
function confirmOk() {
  const fn = confirmAction
  closeConfirm()
  if (fn) fn()
}
function confirmCancel() {
  closeConfirm()
  log(TEXTS.confirm.cancelled); playSfx('click')
}
function progressBrief() {
  return { floor: FLOORS[state.floor].name, hp: state.hero.hp, steps }
}
// 有存档 / 已走步 / 已结束 / 回放中都算「有进度可覆盖」，确认文案据此自适应
function hasProgress() { return steps > 0 || !!load() || !!state.ended || replayMode }
function fillTpl(t, m) {
  return t.replace(/\{(\w+)\}/g, (s, k) => m[k] === undefined ? s : String(m[k]))
}

// ---- 音效映射：宿主层按事件文本判断，逻辑层不碰 ----
function pickSfx(events, beforeTile, battleWon) {
  const t = events.join(' ')
  if (t.includes('发现隐藏') || t.includes('撞开暗门')) return 'hidden'
  if (t.includes('通关')) return 'win'
  if (t.includes('阵亡')) return 'lose'
  if (battleWon) return 'battle'
  if (t.includes('门已打开') || t.includes('进入 ')) return 'door'
  if (t.includes('获得 ')) return ['F', 'o', 's', 'S', 'a', 'd'].includes(beforeTile) ? 'powerup' : 'pickup'
  if (t.includes('缺少') || t.includes('前方是墙') || t.includes('攻击不足') || t.includes('硬拼')) return 'click'
  return 'step'
}

function shopActions() {
  // v0.9 经典魔塔商店：攻 / 防 / 生命 三选一，标签带当前楼层档位的实际增量
  const goods = SHOP_GOODS.map(g => {
    const offer = shopOffer(g.kind, state.floor)
    return {
      label: TEXTS.ui.shopGoods[g.kind] + ' +' + offer.amount + '（' + offer.cost + 'G）',
      run: () => {
        const r = shopBuy(state, g.kind); state = r.state
        const msgs = r.events.filter(e => e.t === 'msg').map(e => e.text)
        if (msgs.length) tipEl.textContent = msgs[msgs.length - 1]
        if (r.events.some(e => e.t === 'save')) save()
        msgs.forEach(t => history.push({ step: steps, text: t }))
        render(); renderHistory(); playSfx('powerup')
      }
    }
  })
  return [...goods, { label: TEXTS.ui.shopLeave, run: () => {} }]
}

// v0.12：暗门 A 视觉与墙完全一致，手环小屏靠「相邻提示」给一条可发现的线索。
// 只在纯移动（本步没有任何事件消息）时才覆盖提示条，避免盖掉战斗 / 拾取 / 开门结果。
function secretNearby(s) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(d =>
    tileAt(s, s.x + d[0], s.y + d[1]) === 'A')
}

// ---- 一次输入 = 一次结算 = 一次视图提交 ----
function step(dir) {
  if (state.ended || animating) return { msgs: [] }
  const before = state
  const d = DELTA[dir]
  const tx = before.x + (d ? d[0] : 0), ty = before.y + (d ? d[1] : 0)
  const beforeTile = tileAt(before, tx, ty)
  const beforeMon = monsterByCh(beforeTile)
  const hidden = beforeTile === 'H' ? hiddenAt(before.floor, tx, ty) : null
  const secret = beforeTile === 'A' ? secretAt(before.floor, tx, ty) : null
  const beforeFloor = before.floor
  const beforeCells = buildCells(before)

  const r = resolveStep(before, dir)
  state = r.state
  steps++
  commitRecords(before, state, steps)
  const events = r.events.filter(e => e.t === 'msg').map(e => e.text)
  const last = events[events.length - 1]
  if (last) tipEl.textContent = last
  else if (secretNearby(state)) tipEl.textContent = TEXTS.ui.secretHint
  if (r.events.some(e => e.t === 'vibrate')) pulse()
  if (!replayMode && r.events.some(e => e.t === 'save')) save()
  const msgs = events.length ? events.slice() : ['走一格 · 向' + DIRNAME[dir] + '（无事件）']
  msgs.forEach(t => history.push({ step: steps, text: t }))
  if (history.length > 200) history = history.slice(-200)

  const moved = state.x !== before.x || state.y !== before.y || state.floor !== beforeFloor
  // v0.11：战斗 / 拾取 / 救出结算后英雄停在原地，不再走进实体格，
  // 因此「战斗胜利」不能靠 moved 判定（否则音效 / 动画全丢），直接看胜利事件；
  // 剧情触发也改用 progressed（移动 或 结算了交互），避免原地交互时丢失剧情。
  const battleWon = !!beforeMon && events.some(t => t.startsWith('胜 '))
  const interacted = r.events.some(e => e.t === 'save' || e.t === 'vibrate')
  const progressed = moved || interacted
  playSfx(pickSfx(events, beforeTile, battleWon))

  if (!replayMode) {
    if (hidden && progressed) queueStory(hidden.story)
    // v0.12 撞开暗门：按奖励类型弹一段短剧情（storySeen 按 key 去重，同类只弹一次）
    if (secret && progressed) queueStory(secret.story)
    if (beforeTile === 'F' && progressed) queueStory('fly')
    if (beforeTile === 'o' && progressed) queueStory('bomb')
    if (beforeTile === 'N' && progressed) queueStory('shop', shopActions(), false)
    if (state.floor !== beforeFloor) queueStory(FLOORS[state.floor].story)
    if (state.ended === 'win') queueStory('win')
    if (state.ended === 'dead') queueStory('lose')
  }

  if (battleWon && animOn && !replayMode) {
    // 动画期间网格保留旧帧（怪还在），特效叠在覆盖层；结束后才提交新帧
    animating = true
    renderCells(beforeCells)
    showBattleFx(before.x, before.y, tx, ty, calcBattle(before.hero, beforeMon, before.floor).hpCost)
    setTimeout(() => {
      animating = false; hideBattleFx()
      render(); renderHistory(); renderReplayUI(); flushStory()
    }, 460)
  } else {
    render(); renderHistory(); renderReplayUI(); flushStory()
  }
  return { msgs }
}

// ---- 可选机制入口：与 step 共用逻辑层纯函数 ----
function doAction(fn, sfx) {
  if (state.ended || animating || storyOpen || confirmOpen || codexOpen) return
  if (replayMode) { log('回放中请先「退出回放并恢复」再用道具。'); return }
  const beforeFloor = state.floor
  const before = state
  const r = fn(state); state = r.state
  commitRecords(before, state, steps)
  const msgs = r.events.filter(e => e.t === 'msg').map(e => e.text)
  if (msgs.length) tipEl.textContent = msgs[msgs.length - 1]
  if (r.events.some(e => e.t === 'vibrate')) pulse()
  if (r.events.some(e => e.t === 'save')) save()
  msgs.forEach(t => history.push({ step: steps, text: t }))
  render(); renderHistory(); renderReplayUI()
  playSfx(sfx)
  if (state.floor !== beforeFloor) queueStory(FLOORS[state.floor].story)
  flushStory()
  log(msgs[msgs.length - 1] || '操作完成')
}

// ---- 回放：snapshots[k] = 第 k 步之后的状态 ----
function restoreSnapshot(n) {
  cursor = n
  const snap = snapshots[n]
  state = deserialize(snap.save) || newGame()
  steps = snap.steps; tipEl.textContent = snap.tip
  history = []
  for (let k = 1; k <= n; k++) snapshots[k].msgs.forEach(t => history.push({ step: k, text: t }))
  render(); renderHistory()
}
function advanceOne() {
  const dir = route[cursor]
  if (!dir || state.ended) return false
  const r = step(dir)
  cursor++; snapshots.length = cursor
  snapshots[cursor] = { save: serialize(state), steps, tip: tipEl.textContent, msgs: r.msgs, dir }
  history = []
  for (let k = 1; k <= cursor; k++) snapshots[k].msgs.forEach(t => history.push({ step: k, text: t }))
  renderHistory()
  return true
}
function goto(n) {
  if (!replayMode) return
  n = Math.max(0, Math.min(n, route.length))
  if (n > cursor) { while (cursor < n) { if (!advanceOne()) break } }
  else if (n < cursor) restoreSnapshot(n)
  renderReplayUI()
}
let routeBtns = [], routeBtnsRoute = null
function renderRouteStrip() {
  if (!route.length) {
    routeStrip.innerHTML = ''
    const s = document.createElement('span'); s.className = 'dim'
    s.textContent = '路线步骤条将在载入后生成'; routeStrip.appendChild(s)
    routeBtns = []; routeBtnsRoute = null
    return
  }
  // 21 层路线 462 步：DOM 只建一次，之后单步 / 回退只改 class，
  // 避免逐次重建数百个按钮（一路退回起点时尤其明显）。
  if (routeBtnsRoute !== route || routeBtns.length !== route.length) {
    routeStrip.innerHTML = ''
    const frag = document.createDocumentFragment()
    routeBtns = route.map((d, i) => {
      const b = document.createElement('button')
      b.textContent = ARROW[d]; b.title = '第 ' + (i + 1) + ' 步：向' + DIRNAME[d]
      b.dataset.i = String(i + 1); frag.appendChild(b); return b
    })
    routeStrip.appendChild(frag)
    routeBtnsRoute = route
  }
  for (let i = 0; i < routeBtns.length; i++) {
    routeBtns[i].className = 'route-step' + (i < cursor ? ' done' : '') + (i === cursor ? ' current' : '')
  }
}
function renderReplayUI() {
  const inReplay = replayMode && route.length > 0
  const atEnd = state && !!state.ended
  modeBadge.textContent = replayMode ? '回放中' : '正常游玩'
  modeBadge.classList.toggle('replaying', replayMode)
  $('btnPlay').disabled = !inReplay || atEnd
  $('btnPrev').disabled = !inReplay || cursor <= 0
  $('btnNext').disabled = !inReplay || cursor >= route.length || atEnd
  $('btnExit').disabled = !replayMode
  $('btnReplay').textContent = replayMode ? '重新载入攻略' : '载入通关攻略'
  $('btnPlay').textContent = playTimer ? '⏸ 暂停' : '▶ 播放'
  replayBar.style.width = route.length ? (cursor / route.length * 100) + '%' : '0%'
  if (inReplay) {
    const next = cursor < route.length ? ' · 下一步 ' + ARROW[route[cursor]] : ' · 已到终点'
    replayInfo.textContent = '路线 ' + route.length + ' 步 · 当前第 ' + cursor + '/' + route.length + ' 步' + next + (atEnd ? ' · ' + (state.ended === 'win' ? '通关' : '阵亡') : '')
  } else replayInfo.textContent = '未载入路线 · 点「载入通关攻略」生成策略式路线'
  renderRouteStrip()
}
function pause() { if (playTimer) { clearInterval(playTimer); playTimer = null } renderReplayUI() }
function play() {
  if (playTimer) { pause(); return }
  if (!replayMode || !route.length) return
  if (cursor >= route.length || state.ended) { log('已到路线终点，先「上一步」或重新载入路线。'); return }
  playTimer = setInterval(() => {
    const ok = advanceOne()
    if (!ok || cursor >= route.length || state.ended) {
      pause(); log('回放结束：' + (state.ended === 'win' ? '通关成功' : '未通关') + '，共 ' + cursor + ' 步，HP ' + state.hero.hp)
    }
    renderReplayUI()
  }, speed)
  renderReplayUI()
}
function startReplay() {
  const sol = findSolution()
  if (!sol) { log('未找到通关路线，请先跑 node tools/validate_logic.mjs 检查配置表。'); return }
  pause(); dismissStory(); stopAuto()
  settingsOpen = false; $('settingsLayer').hidden = true
  codexOpen = false; $('codexLayer').hidden = true
  if (!backup) backup = { save: serialize(state), steps, tip: tipEl.textContent, history: history.slice() }
  replayMode = true; route = sol.steps.slice()
  state = newGame(); steps = 0
  tipEl.textContent = '回放起点 · 从 newGame() 出发'; history = []
  snapshots = [{ save: serialize(state), steps: 0, tip: tipEl.textContent, msgs: [], dir: null }]
  cursor = 0
  render(); renderHistory(); renderReplayUI()
  log('策略规划 ' + sol.rounds + ' 轮，生成 ' + route.length + ' 步通关路线。回放不写 localStorage，退出可恢复原进度。')
}
function exitReplay(restore) {
  pause(); dismissStory()
  if (!replayMode) return
  replayMode = false
  if (restore && backup) {
    state = deserialize(backup.save) || newGame()
    steps = backup.steps; tipEl.textContent = backup.tip; history = backup.history.slice()
    log('已退出回放，恢复进入回放前的进度。')
  } else log('已脱离回放，从当前步继续正常游玩（该状态已写入存档）。')
  save(); route = []; snapshots = []; cursor = 0; backup = null
  render(); renderHistory(); renderReplayUI()
}
function restart() {
  pause(); dismissStory(); stopAuto()
  settingsOpen = false; $('settingsLayer').hidden = true
  codexOpen = false; $('codexLayer').hidden = true
  replayMode = false; route = []; snapshots = []; cursor = 0; backup = null
  state = newGame(); steps = 0
  tipEl.textContent = '点格子开始爬塔'; history = []
  hideBattleFx(); animating = false
  save(); render(); renderHistory(); renderReplayUI(); log('已重新开始。')
}
// 危险操作统一入口：先二次确认，确认后才执行原逻辑。
// restart() 仍是「真正执行」的纯动作；回放 / 结束遮罩 / 页头 / 屏幕内 / 设置 / 键盘全收口到 requestNewGame()。
function requestNewGame() {
  const has = hasProgress(), p = progressBrief()
  openConfirm({
    title: TEXTS.confirm.newGameTitle,
    body: has ? fillTpl(TEXTS.confirm.newGameBodyHas, p) : TEXTS.confirm.newGameBodyEmpty,
    okLabel: has ? TEXTS.confirm.newGameOkHas : TEXTS.confirm.newGameOkEmpty,
    onOk: () => { restart(); log(TEXTS.confirm.newGameDone) }
  })
}
function requestClearSave() {
  openConfirm({
    title: TEXTS.confirm.clearSaveTitle,
    body: TEXTS.confirm.clearSaveBody,
    okLabel: TEXTS.confirm.clearSaveOk,
    onOk: () => { clearSave(); restart(); log(TEXTS.confirm.clearSaveDone) }
  })
}
function requestClearRecords() {
  openConfirm({
    title: TEXTS.confirm.clearRecordsTitle,
    body: TEXTS.confirm.clearRecordsBody,
    okLabel: TEXTS.confirm.clearRecordsOk,
    onOk: clearRecords
  })
}
function manualStep(dir) {
  if (storyOpen || animating || settingsOpen || confirmOpen || codexOpen) return
  if (replayMode) exitReplay(false)
  step(dir)
}

// ---- v0.8：点击寻路「视实体为阻挡，必须主动点它才交互」----
// 规则（与 logic.isEntityTile / solver.findPath(opts) 完全同源）：
//   · 可走格只有 . @ H U D W；物品 / 怪物 / 钥匙 / 门 / 商店 / NPC / 图鉴都是实体，寻路不穿越。
//   · 点空地            -> 走最短路径到那一格就停。
//   · 点实体（非相邻）  -> 走到它的相邻可走格停下，再补一次交互（英雄留在原地），然后彻底停。
//   · 点相邻实体        -> 原地直接交互，不多走一步。
//   · v0.11：战斗 / 拾取 / 救出后英雄停在原地，实体格清成地板，再点一次才走过去；
//     门 / 楼梯 / 王座 / 暗格仍按各自语义移动（通道与可走格）。
//   · 点商店            -> 走到旁边停下并弹交易框，英雄不踩到商人身上。
//   · v0.10：门也必须主动点开（经典魔塔「门不可绕行」），封住房间 / 上楼 / 王座的唯一入口；
//     没开门前点门后的格子会提示不可达，不会自动绕门或穿门。
function stopAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null }
  autoQueue = []
  pendingInteract = null
}
// 实体周围可以站人的格子（只用可走格，避免「停在另一个怪身上」）
function standNextTo(tx, ty) {
  const out = new Set()
  const gw = FLOORS[state.floor].rows[0].length
  const gh = FLOORS[state.floor].rows.length
  ;[['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]].forEach(function (a) {
    const nx = tx + a[1], ny = ty + a[2]
    if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) return
    const ch = tileAt(state, nx, ny)
    if (ch === '#' || isEntityTile(ch)) return
    out.add(nx + ',' + ny)
  })
  return out
}
function dirTo(tx, ty) {
  if (tx > state.x) return 'right'
  if (tx < state.x) return 'left'
  if (ty > state.y) return 'down'
  return 'up'
}
// 对相邻格执行一次交互：商店弹交易框；v0.11 起怪物 / 道具 / NPC 结算后停在原地，
// 门 / 楼梯 / 王座 / 暗格仍走进去 —— 由 resolveStep 各自的语义决定，宿主层不再补走一步。
function interact(tx, ty) {
  if (tileAt(state, tx, ty) === 'N') {
    queueStory('shop', shopActions(), false); flushStory()
    log('商人：欢迎光临，看看货吧')
    return
  }
  manualStep(dirTo(tx, ty))
}
function walkTo(tx, ty) {
  if (storyOpen || animating || settingsOpen || confirmOpen || codexOpen || state.ended) return
  if (replayMode) { log('回放中请先「退出回放并恢复」再点击格子。'); return }
  if (tx === state.x && ty === state.y) return
  const ch = tileAt(state, tx, ty)
  if (ch === '#') { log('那里是墙。'); return }
  stopAuto()

  // 相邻格：直接交互，不启动自动行走
  if (Math.abs(tx - state.x) + Math.abs(ty - state.y) === 1) { interact(tx, ty); return }

  const entity = isEntityTile(ch)
  const standTargets = entity ? standNextTo(tx, ty) : new Set([tx + ',' + ty])
  let r = findPath(state, standTargets, { blockEntities: true })
  // v0.10：只有「实体四周没有任何可站格」才退回直接走进目标格（角落死角）。
  // 路径被门 / 其它实体挡住时绝不退回 —— 否则会绕开唯一入口的门，门就形同虚设。
  if ((!r.path || !r.path.length) && entity && standTargets.size === 0)
    r = findPath(state, new Set([tx + ',' + ty]))
  if (!r.path || !r.path.length) {
    log(entity ? '走不到它旁边（墙 / 挡路的实体 / 未开启的门）。' : '目标格不可达（可能要先开门）。')
    return
  }
  autoQueue = r.path.slice()
  pendingInteract = entity ? { x: tx, y: ty } : null
  autoTimer = setInterval(autoTick, 150)
}
function autoTick() {
  if (state.ended || replayMode || settingsOpen || codexOpen) { stopAuto(); return }
  if (storyOpen) { stopAuto(); return }   // 剧情打断：玩家看完再点，不偷偷继续走
  if (animating) return                   // 战斗动画仅 460ms，等下一拍
  if (!autoQueue.length) { stopAuto(); return }
  const dir = autoQueue.shift()
  const beforeFloor = state.floor
  const before = state.floor + ',' + state.x + ',' + state.y
  manualStep(dir)
  const after = state.floor + ',' + state.x + ',' + state.y
  // 被拦住（state 未变）或换层（路径已失效）时停止
  if (after === before || state.floor !== beforeFloor) { stopAuto(); return }
  // 走到实体旁最后一步：补一次交互（英雄停在原地），然后彻底停下
  if (!autoQueue.length && pendingInteract) {
    const p = pendingInteract
    stopAuto()
    interact(p.x, p.y)
  }
}
function applyImport(s, text) {
  pause(); dismissStory(); stopAuto()
  settingsOpen = false; $('settingsLayer').hidden = true
  codexOpen = false; $('codexLayer').hidden = true
  replayMode = false; route = []; snapshots = []; cursor = 0; backup = null
  state = s; steps = 0
  tipEl.textContent = '已载入外部存档'; history = [{ step: 0, text: '载入存档 ' + text }]
  save(); render(); renderHistory(); renderReplayUI()
  log('已载入：' + FLOORS[state.floor].name + ' (' + state.x + ',' + state.y + ') HP' + state.hero.hp + '。步数不在存档格式内，记为 0。')
}
function importSave() {
  if (confirmOpen) return
  const text = saveInput.value.trim()
  if (!text) { log('请先粘贴存档串。'); return }
  const s = deserialize(text)
  if (!s) { log('存档串无效：deserialize() 返回 null（格式 / 版本 / 越界任一不符）。'); return }
  // 坏档 / 空串在确认之前就拒绝，不弹窗；只有合法存档才谈「是否覆盖」
  const brief = text.length > 46 ? text.slice(0, 46) + '…' : text
  openConfirm({
    title: TEXTS.confirm.importTitle,
    body: fillTpl(TEXTS.confirm.importBody, { ...progressBrief(), save: brief }),
    okLabel: TEXTS.confirm.importOk,
    onOk: () => applyImport(s, text)
  })
}
function setSpeed(ms) {
  speed = Math.max(SPEEDS[SPEEDS.length - 1], Math.min(SPEEDS[0], ms))
  document.querySelectorAll('.speed-row button[data-speed]').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === speed))
  $('speedInfo').textContent = speed + ' ms / 步'
}

// ---- 输入映射 ----
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right'
}
document.addEventListener('keydown', e => {
  const k = e.key
  // 确认弹窗优先级最高：即使焦点仍在存档输入框，Enter / Esc 也归它处理
  if (confirmOpen) {
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); confirmOk() }
    else if (k === 'Escape') { e.preventDefault(); confirmCancel() }
    return
  }
  if (e.target && e.target.tagName === 'INPUT') return
  if (codexOpen) {
    if (k === 'Escape' || k === 'Enter' || k === ' ') { e.preventDefault(); closeCodex() }
    return
  }
  if (settingsOpen) {
    if (k === 'Escape') { e.preventDefault(); closeSettings() }
    return
  }
  if (storyOpen) {
    if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 'Escape') { e.preventDefault(); closeStory() }
    return
  }
  if (animating) return
  if (k === 'Escape') { e.preventDefault(); if (replayMode) exitReplay(true); return }
  if (k === ' ' || k === 'Spacebar') { e.preventDefault(); play(); return }
  if (k === '[') { e.preventDefault(); pause(); goto(cursor - 1); return }
  if (k === ']') { e.preventDefault(); pause(); goto(cursor + 1); return }
  if (k === '+' || k === '=') { e.preventDefault(); setSpeed(speed / 2); return }
  if (k === '-' || k === '_') { e.preventDefault(); setSpeed(speed * 2); return }
  if (k === 'r' || k === 'R') { e.preventDefault(); requestNewGame(); return }
  if (k === 'Backspace') { e.preventDefault(); requestClearSave(); return }
  if (k === 'f' || k === 'F') { e.preventDefault(); doAction(s => useFly(s, e.shiftKey ? -1 : 1), 'powerup'); return }
  if (k === 'b' || k === 'B') { e.preventDefault(); doAction(useBomb, 'bomb'); return }
  if (k === 'c' || k === 'C') { e.preventDefault(); openCodex(); return }
  const dir = KEYMAP[k]
  if (dir) { e.preventDefault(); pause(); manualStep(dir) }
})

// 点击格子移动（v0.6.0 取代方向键）；与 swipe 拖动互斥，见 endGesture()
gridEl.addEventListener('click', e => {
  if (suppressGridClick) { suppressGridClick = false; return }
  const box = e.target.closest('.cell'); if (!box) return
  const i = Number(box.dataset.i)
  const W = FLOORS[state.floor].rows[0].length
  walkTo(i % W, Math.floor(i / W))
})
$('overBtn').addEventListener('click', requestNewGame)
$('btnReplay').addEventListener('click', startReplay)
$('btnPlay').addEventListener('click', play)
$('btnPrev').addEventListener('click', () => { pause(); goto(cursor - 1) })
$('btnNext').addEventListener('click', () => { pause(); goto(cursor + 1) })
$('btnExit').addEventListener('click', () => exitReplay(true))
$('btnRestart').addEventListener('click', requestNewGame)
$('btnClear').addEventListener('click', requestClearSave)
$('btnClearRecords').addEventListener('click', requestClearRecords)
$('btnImport').addEventListener('click', importSave)
saveInput.addEventListener('keydown', e => { if (e.key === 'Enter') importSave() })
// 新游戏入口族：页头 / 屏幕内道具栏 / 设置浮层，全部收口到同一个带确认的入口
$('btnNewGameTop').addEventListener('click', requestNewGame)
$('btnActNewGame').addEventListener('click', requestNewGame)
$('setNewGame').addEventListener('click', requestNewGame)
// 确认弹层：确认 / 取消 / 点遮罩取消
$('confirmOk').addEventListener('click', confirmOk)
$('confirmCancel').addEventListener('click', confirmCancel)
$('confirmLayer').addEventListener('click', e => { if (e.target === $('confirmLayer')) confirmCancel() })
$('storyContinue').addEventListener('click', closeStory)
$('storyLayer').addEventListener('click', e => { if (e.target === $('storyLayer')) closeStory() })

$('btnFlyUp').addEventListener('click', () => doAction(s => useFly(s, 1), 'powerup'))
$('btnFlyDown').addEventListener('click', () => doAction(s => useFly(s, -1), 'powerup'))
$('btnBomb').addEventListener('click', () => doAction(useBomb, 'bomb'))
$('btnShop').addEventListener('click', () => { queueStory('shop', shopActions(), false); flushStory() })
// 屏幕内道具按钮（原方向键位置），与右侧工作台共用同一组 doAction 入口
$('btnActFlyUp').addEventListener('click', () => doAction(s => useFly(s, 1), 'powerup'))
$('btnActFlyDown').addEventListener('click', () => doAction(s => useFly(s, -1), 'powerup'))
$('btnActBomb').addEventListener('click', () => doAction(useBomb, 'bomb'))
$('btnActShop').addEventListener('click', () => { queueStory('shop', shopActions(), false); flushStory() })

routeStrip.addEventListener('click', e => {
  const b = e.target.closest('.route-step'); if (!b || !replayMode) return
  pause(); goto(Number(b.dataset.i))
})
document.querySelector('.speed-row').addEventListener('click', e => {
  const b = e.target.closest('[data-speed]'); if (!b) return
  setSpeed(Number(b.dataset.speed)); saveSettings()
})
document.querySelector('.zoom-row').addEventListener('click', e => {
  const b = e.target.closest('[data-zoom]'); if (!b) return
  deviceEl.style.zoom = b.dataset.zoom
  document.querySelectorAll('.zoom-row button[data-zoom]').forEach(x => x.classList.toggle('on', x === b))
  saveSettings()
})
savePreview.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(serialize(state)); log('存档串已复制。') }
  catch (e) { log('复制失败，请手动选中存档串。') }
})

// ---- 表现层设置持久化（v0.10：独立于游戏存档串，刷新 / 重开浏览器都保持）----
// 设置是「本机偏好」而非「游戏进度」：不进 serialize()，导入 / 清除存档都不影响它。
const SETTINGS_KEY = 'mota_lite_web_settings_v1'
const ZOOMS = ['0.5', '1', '1.25', '1.5']
function defaultZoom() {
  const b = document.querySelector('.zoom-row button[data-zoom].on')
  return b ? b.dataset.zoom : '1'
}
function normalizeSettings(raw) {
  const o = (raw && typeof raw === 'object') ? raw : {}
  return {
    sprite: typeof o.sprite === 'boolean' ? o.sprite : true,
    anim: typeof o.anim === 'boolean' ? o.anim : true,
    sound: typeof o.sound === 'boolean' ? o.sound : true,
    speed: SPEEDS.indexOf(Number(o.speed)) >= 0 ? Number(o.speed) : 320,
    zoom: ZOOMS.indexOf(String(o.zoom)) >= 0 ? String(o.zoom) : defaultZoom()
  }
}
function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')) }
  catch (e) { return normalizeSettings(null) }
}
function saveSettings() {
  try {
    const z = String(deviceEl.style.zoom)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      sprite: spriteMode, anim: animOn, sound: soundOn, speed,
      zoom: ZOOMS.indexOf(z) >= 0 ? z : defaultZoom()
    }))
  } catch (e) { /* 隐私模式 */ }
}
// 冷启动唯一入口：内存变量 + 工作台按钮 + 设置浮层 + 速度 / 缩放一次同步到位
function applySettings(o) {
  spriteMode = o.sprite; animOn = o.anim; soundOn = o.sound
  $('btnSprite').classList.toggle('on', spriteMode)
  $('btnSprite').textContent = spriteMode ? TEXTS.ui.spriteOn : TEXTS.ui.spriteOff
  $('btnAnim').classList.toggle('on', animOn)
  $('btnAnim').textContent = animOn ? TEXTS.ui.animOn : TEXTS.ui.animOff
  $('btnSound').classList.toggle('on', soundOn)
  $('btnSound').textContent = soundOn ? TEXTS.ui.soundOn : TEXTS.ui.soundOff
  setSpeed(o.speed)          // 只同步 UI，不写盘（冷启动不产生设置 key）
  deviceEl.style.zoom = o.zoom
  document.querySelectorAll('.zoom-row button[data-zoom]').forEach(x => x.classList.toggle('on', x.dataset.zoom === o.zoom))
  syncSettings()
}

// ---- 表现层开关：右侧工作台与屏幕内设置浮层共用同一份状态 ----
function syncSettings() {
  $('setSprite').textContent = spriteMode ? '像素图：开' : '像素图：关'
  $('setSprite').classList.toggle('on', spriteMode)
  $('setAnim').textContent = animOn ? '战斗动画：开' : '战斗动画：关'
  $('setAnim').classList.toggle('on', animOn)
  $('setSound').textContent = soundOn ? '音效：开' : '音效：静音'
  $('setSound').classList.toggle('on', soundOn)
}
function openSettings() {
  pause(); stopAuto()
  if (codexOpen) closeCodex()
  settingsOpen = true; syncSettings(); $('settingsLayer').hidden = false
  playSfx('click')
}
function closeSettings() {
  settingsOpen = false; $('settingsLayer').hidden = true
  playSfx('click')
}

// ---- v0.9 怪物图鉴（怪物手册）：只读 state + MONSTERS + scaledMon/calcBattle/battleHint ----
// 口径（用户原话「展示当前层**所有**怪物类型的攻/防/血」）：
//   · 静态扫 FLOORS[floor].rows -> 本层「配置过的」怪物类型全集（打死也仍列）
//   · 动态扫 tileAt(state,...)  -> 各类型当前存活数
//   · 存活：×n + 战斗预测徽章；已清除：仍列 HP/攻/防，置灰标「已清除」，不做预测
// 图鉴是只读视图，不写 state、不触发存档；与本层的战斗预览互不干扰。
function renderCodex() {
  const f = FLOORS[state.floor]
  $('codexTitle').textContent = TEXTS.ui.codexTitle
  $('codexSub').textContent = f.name + ' · ' + TEXTS.ui.codexSub
  const list = $('codexList'); list.innerHTML = ''
  const gw = f.rows[0].length, gh = f.rows.length

  // 本层配置过的类型（静态，不受 cleared 影响）
  const configured = new Set()
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const ch = f.rows[y][x]
      if (monsterByCh(ch)) configured.add(ch)
    }
  }
  // 当前存活数（动态，读 state 的 opened 变更集）
  const alive = new Map()
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const mon = monsterByCh(tileAt(state, x, y))
      if (mon) alive.set(mon.ch, (alive.get(mon.ch) || 0) + 1)
    }
  }
  if (!configured.size) {
    const p = document.createElement('div'); p.className = 'codex-empty'
    p.textContent = TEXTS.ui.codexEmpty; list.appendChild(p); return
  }
  const frag = document.createDocumentFragment()
  MONSTERS.forEach(m => {
    if (!configured.has(m.ch)) return
    const n = alive.get(m.ch) || 0
    const cleared = n === 0
    const msc = scaledMon(m, state.floor)          // 本层实际数值（逐层曲线）
    const hint = battleHint(state.hero, m, state.floor)
    const row = document.createElement('div'); row.className = 'codex-row' + (cleared ? ' cleared' : '')
    row.appendChild(swatch(m.bg, m.ch, TEXTS.monsterDesc[m.id]))
    const name = document.createElement('span'); name.className = 'cname'
    name.textContent = m.name + (m.pierce ? ' ✦' : '') + (n > 1 ? ' ×' + n : '')
    name.title = m.pierce ? '真实伤害：无视防御' : TEXTS.monsterDesc[m.id]
    const stat = document.createElement('span'); stat.className = 'cstat'
    stat.textContent = msc.hp + '/' + msc.atk + '/' + msc.def
    stat.title = '本层实际 HP / 攻 / 防'
    const badge = document.createElement('span')
    if (cleared) {
      badge.className = 'cbadge cleared'; badge.textContent = TEXTS.ui.codexCleared
    } else {
      const r = hint.r
      if (!r.ok) { badge.className = 'cbadge no'; badge.textContent = r.reason === 'unbreakable' ? '破不了防' : '会阵亡' }
      else if (r.hpCost === 0) { badge.className = 'cbadge ok'; badge.textContent = '防杀' }
      else { badge.className = 'cbadge ok'; badge.textContent = '-' + r.hpCost + 'HP' }
      const tips = [m.pierce ? '✦真实伤害，堆防无效' : ('每 +1 防少掉 ' + hint.defGain + ' HP')]
      if (hint.nextAtk != null) tips.push('再 +' + hint.nextAtk + ' 攻少挨一回合')
      badge.title = tips.join('；')
    }
    row.appendChild(name); row.appendChild(stat); row.appendChild(badge)
    frag.appendChild(row)
  })
  list.appendChild(frag)
}
function openCodex() {
  if (!state.hero.book) { log(TEXTS.ui.codexLocked); playSfx('click'); return }
  pause(); stopAuto()
  if (settingsOpen) closeSettings()
  codexOpen = true
  renderCodex(); $('codexLayer').hidden = false
  playSfx('click')
}
function closeCodex() {
  codexOpen = false; $('codexLayer').hidden = true
  playSfx('click')
}
function toggleSprite() {
  spriteMode = !spriteMode
  $('btnSprite').classList.toggle('on', spriteMode)
  $('btnSprite').textContent = spriteMode ? TEXTS.ui.spriteOn : TEXTS.ui.spriteOff
  syncSettings(); saveSettings(); renderCells(buildCells(state)); playSfx('click')
}
function toggleAnim() {
  animOn = !animOn
  $('btnAnim').classList.toggle('on', animOn)
  $('btnAnim').textContent = animOn ? TEXTS.ui.animOn : TEXTS.ui.animOff
  syncSettings(); saveSettings(); playSfx('click')
}
function toggleSound() {
  soundOn = !soundOn
  $('btnSound').classList.toggle('on', soundOn)
  $('btnSound').textContent = soundOn ? TEXTS.ui.soundOn : TEXTS.ui.soundOff
  syncSettings(); saveSettings()
  if (soundOn) ensureAudio().then(() => playSfx('click'))
}
$('btnSprite').addEventListener('click', toggleSprite)
$('setSprite').addEventListener('click', toggleSprite)
$('btnAnim').addEventListener('click', toggleAnim)
$('setAnim').addEventListener('click', toggleAnim)
$('btnSound').addEventListener('click', toggleSound)
$('setSound').addEventListener('click', toggleSound)
$('btnActSettings').addEventListener('click', openSettings)
$('btnActCodex').addEventListener('click', openCodex)
$('codexClose').addEventListener('click', closeCodex)
$('codexLayer').addEventListener('click', e => { if (e.target === $('codexLayer')) closeCodex() })
$('settingsClose').addEventListener('click', closeSettings)
$('settingsLayer').addEventListener('click', e => { if (e.target === $('settingsLayer')) closeSettings() })

let start = null
function swipe(dx, dy) {
  if (storyOpen || animating || settingsOpen || confirmOpen || codexOpen) return
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return
  pause(); stopAuto()
  manualStep(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
}
// 有效滑动会附带一次合成 click，必须抑制，否则「滑一步 + 点一格」会走两步
function endGesture(dx, dy) {
  if (Math.abs(dx) >= 20 || Math.abs(dy) >= 20) suppressGridClick = true
  swipe(dx, dy); start = null
}
screenEl.addEventListener('touchstart', e => {
  suppressGridClick = false
  const t = e.touches[0]; start = { x: t.clientX, y: t.clientY }
}, { passive: true })
screenEl.addEventListener('touchend', e => {
  if (!start) return
  const t = e.changedTouches[0]; endGesture(t.clientX - start.x, t.clientY - start.y)
})
screenEl.addEventListener('mousedown', e => {
  suppressGridClick = false
  if (e.target.closest('.action-bar') || e.target.closest('.over-btn') ||
      e.target.closest('.story-card') || e.target.closest('.settings-card') ||
      e.target.closest('.confirm-card')) return
  start = { x: e.clientX, y: e.clientY }
})
window.addEventListener('mouseup', e => {
  if (!start) return
  endGesture(e.clientX - start.x, e.clientY - start.y)
})

// ---- 静态文案注入（全部来自 texts.js）----
function injectTexts() {
  $('headSub').textContent = TEXTS.meta.intro
  $('tagline').textContent = TEXTS.meta.tagline
  $('footNote').textContent = TEXTS.meta.footer
  $('assetNote').textContent = TEXTS.ui.assetNote
  $('helpControls').textContent = TEXTS.help.controls
  $('helpKeys').textContent = TEXTS.help.keys
  $('helpRule').textContent = TEXTS.help.rule
  $('helpOptional').textContent = TEXTS.help.optional
  $('archText').textContent = '本页 import 在线版自己的 logic.js / tables.js / solver.js（单一真源），浏览器里跑的就是那个 resolveStep()。关卡编辑源是 levels/levels.json，由 tools/build_tables.py 生成 tables.js，运行时不读 JSON。像素精灵、战斗动画、文本框剧情、8-bit 音效、全部文案都是本地生成的资源，由配置表与 texts.js 驱动。'
  $('archSub').textContent = '手环端 M1 工程 /workspace/mota-lite/ 已冻结（真机暂缓）。v0.4 起逻辑层分叉，未来移植以在线版为准重新对齐；存档 v3 兼容 v2 / v1 旧档。' + FLOORS.length + ' 层整层 13×15 = ' + (W * H) + ' 格全部渲染，.viewport 只裁出 ' + VIEWPORT.cols + '×' + VIEWPORT.rows + ' 一屏，相机由 state.x/y 派生（不进存档）。手环端输入 @swipe → 键盘/点击格子/手势，@system.storage → localStorage。'
  $('abilityHint').textContent = '道具按钮在屏幕下方：升层 / 降层 / 炸弹 / 购买 / 图鉴；键盘 F / Shift+F / B / C 亦可。飞行器只飞已探索过的楼层。'
  $('storyContinue').textContent = TEXTS.ui.storyContinue
  $('btnFlyUp').textContent = TEXTS.ui.flyUp
  $('btnFlyDown').textContent = TEXTS.ui.flyDown
  $('btnBomb').textContent = TEXTS.ui.bombBtn
  $('btnShop').textContent = TEXTS.ui.shopBuy
  // v0.6.0：道具 / 设置按钮与浮层文案，全部来自 texts.js
  $('btnActFlyUp').textContent = TEXTS.ui.actFlyUp
  $('btnActFlyDown').textContent = TEXTS.ui.actFlyDown
  $('btnActBomb').textContent = TEXTS.ui.actBomb
  $('btnActShop').textContent = TEXTS.ui.actShop
  $('btnActSettings').textContent = TEXTS.ui.actSettings
  $('btnActCodex').textContent = TEXTS.ui.actCodex
  $('codexClose').textContent = TEXTS.ui.codexClose
  $('actionHint').textContent = TEXTS.ui.actHint
  $('settingsTitle').textContent = TEXTS.ui.settingsTitle
  $('settingsClose').textContent = TEXTS.ui.settingsClose
  // 新游戏入口族 + 单槽说明，文案同样只从 texts.js 取
  $('btnNewGameTop').textContent = TEXTS.ui.headNewGame
  $('overBtn').textContent = TEXTS.ui.overRestart
  $('btnActNewGame').textContent = TEXTS.ui.actNewGame
  $('setNewGame').textContent = TEXTS.ui.settingsNewGame
  $('saveSlotNote').textContent = TEXTS.ui.saveSlotNote
  applySettings(loadSettings())
}
function buildSfxRow() {
  const row = $('sfxRow'); row.innerHTML = ''
  Object.keys(TEXTS.sfx).forEach(k => {
    const b = document.createElement('button')
    b.textContent = '▶ ' + k; b.title = '试听 ' + TEXTS.sfx[k] + '.wav'
    b.addEventListener('click', () => ensureAudio().then(() => playSfx(k)))
    row.appendChild(b)
  })
}

// ---- 版本号注入：唯一真源是 version.js，HTML 不硬编码任何版本号 ----
function renderVersion() {
  document.title = '腕上魔塔 Lite ' + VERSION + ' · 在线试玩'
  $('titleVersion').textContent = VERSION
  $('footVersion').textContent = '在线试玩版 ' + VERSION + ' · 构建 ' + BUILD_DATE + ' · 版本号由 version.js 单一注入'
  const listEl = $('versionLog'); listEl.innerHTML = ''
  const frag = document.createDocumentFragment()
  CHANGELOG.forEach((c, i) => {
    const li = document.createElement('li'); if (i === 0) li.className = 'current'
    const v = document.createElement('span'); v.className = 'vtag'; v.textContent = c.v
    const d = document.createElement('span'); d.className = 'vdate'; d.textContent = c.date
    const n = document.createElement('span'); n.className = 'vnote'; n.textContent = c.note
    li.appendChild(v); li.appendChild(d); li.appendChild(n); frag.appendChild(li)
  })
  listEl.appendChild(frag)
}

// ---- 冷启动 ----
const loaded = load()
state = loaded || newGame()
steps = 0
records = loadRecords()
tipEl.textContent = loaded ? '已恢复上次进度' : '点格子开始爬塔'
history = loaded ? [{ step: 0, text: '从 localStorage 恢复存档' }] : []
buildLegend(); buildSfxRow(); injectTexts(); renderVersion()
render(); renderRecords(); renderHistory(); renderReplayUI()
log('就绪：' + VERSION + ' · ' + (loaded ? '从 localStorage 恢复存档' : '新游戏') + '，' + FLOORS.length + ' 层完整内容。')
if (!loaded) queueStory('intro')
