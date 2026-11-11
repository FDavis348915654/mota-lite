#!/usr/bin/env node
// 在线试玩版的真实 Chromium 回归（开发工具，不是页面入口）。
// 用法：先起本地服务 `python3 -m http.server 8765 --directory .`，再 `node tools/browser_check.mjs [URL]`
// 零安装：只用 Node 22 内置的 fetch / WebSocket + CDP，不拉 playwright。
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'

const URL = process.argv[2] || 'http://127.0.0.1:8765/'
const PORT = 9300 + Math.floor(Math.random() * 400)
const PROFILE = `/tmp/mota-cdp-${process.pid}`
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const jsErrors = []
const results = []
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) })
}

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())
      const page = list.find(t => t.type === 'page')
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch (e) { /* 还没起来 */ }
    await sleep(150)
  }
  throw new Error('Chromium CDP 未就绪')
}

const wsUrl = await getWs()
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') {
    jsErrors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''))
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    jsErrors.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '))
  }
})
function send(method, params = {}) {
  return new Promise(res => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
  return r.result?.result?.value
}
async function waitFor(expr, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { if (await ev(expr)) return true } catch (e) { /* 上下文重建 */ }
    await sleep(120)
  }
  return false
}
const click = sel => ev(`document.querySelector(${JSON.stringify(sel)}).click()`)
const txt = sel => ev(`document.querySelector(${JSON.stringify(sel)}).textContent.trim()`)
const setVal = (sel, v) => ev(`document.querySelector(${JSON.stringify(sel)}).value = ${JSON.stringify(v)}`)
const key = k => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}))`)
const keyShift = k => ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},shiftKey:true,bubbles:true}))`)
const hidden = sel => ev(`document.querySelector(${JSON.stringify(sel)}).hidden`)
// 危险操作现在会先弹二次确认：点击后若确认框出现则自动点「确认」，坏档等不弹窗的情况原样跳过
const accept = async sel => {
  await click(sel)
  return ev("(()=>{const l=document.querySelector('#confirmLayer');const b=document.querySelector('#confirmOk');if(l&&!l.hidden&&b){b.click();return true}return false})()")
}
// v0.6.0：HUD 改为分段 span，用 | 拼接读回，避免依赖旧的整串文本
const hud = () => ev("(()=>{const g=id=>document.getElementById(id).textContent;return ['hudFloor','hudHp','hudAtk','hudDef','hudKy','hudKb','hudKr','hudGold'].map(g).join('|')})()")
const HUD0 = '1F|HP200|A10|D10|Y0|B0|R0|G0'

try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL })
  await sleep(400)
  await send('Runtime.enable')
  const ready = await waitFor("document.readyState === 'complete' && document.querySelectorAll('.cell').length === 63")
  check('冷启动渲染 63 格', ready)
  if (!ready) throw new Error('页面未就绪，中止后续交互')

  // ---- A 冷启动 / 资源 / 版本 ----
  check('HUD 初始属性（8 段）', (await hud()) === HUD0, await hud())
  const hudColors = await ev("(()=>{const ids=['hudFloor','hudHp','hudAtk','hudDef','hudKy','hudKb','hudKr','hudGold'];return [...new Set(ids.map(id=>getComputedStyle(document.getElementById(id)).color))].length})()")
  check('HUD 分段颜色 >= 6 种', hudColors >= 6, hudColors + ' 种')
  check('模式标记 = 正常游玩', (await txt('#modeBadge')) === '正常游玩')
  const legendCount = await ev("document.querySelectorAll('#legend .legend-item').length")
  check('图例由配置表生成', legendCount >= 30, legendCount + ' 项')
  check('战斗预览含史莱姆且可打', (await txt('#battleList')).includes('史莱姆') && (await txt('#battleList')).includes('可打'))
  check('存档串为 v2 紧凑格式', (await txt('#savePreview')).startsWith('2|'), await txt('#savePreview'))
  check('播放按钮未载入路线时禁用', await ev("document.querySelector('#btnPlay').disabled") === true)
  check('标签副标题由 texts.js 注入', (await txt('#headSub')).includes('212×520'))
  check('tagline 注入', (await txt('#tagline')).length > 4, await txt('#tagline'))
  check('图例带文案 tooltip', await ev("!!document.querySelector('#legend .swatch[title]')"))

  // 资源卡
  check('资源卡 4 张图', await ev("document.querySelectorAll('.asset-row img').length") === 4)
  check('12 个音效试听按钮', await ev("document.querySelectorAll('#sfxRow button').length") === 12)
  check('道具栏 fly/bomb/gold 已渲染', (await txt('#iFly')).length > 0 && (await txt('#iBomb')) === '0' && (await txt('#iGold')) === '0')
  check('帮助快捷键含 Shift+F', (await txt('#helpKeys')).includes('Shift+F'))
  check('架构说明标注分叉', (await txt('#archText')).includes('单一真源'))

  // 精灵渲染（等 atlas fetch 完成）
  const spriteReady = await waitFor("document.querySelector('.cell').style.backgroundImage.includes('sprites.png')", 8000)
  check('像素精灵渲染已生效', spriteReady, await ev("document.querySelector('.cell').style.backgroundImage"))
  check('精灵模式下字符层隐藏', await ev("document.querySelector('.cell .cell-ch').textContent") === '')

  // ---- A4 21 层 / 方向键移除 / 道具设置按钮 / 出生点残留修复 ----
  const FLOOR_N = await ev("(async()=>{const m=await import('./tables.js');return m.FLOORS.length})()")
  check('楼层数 = 21', FLOOR_N === 21, FLOOR_N + ' 层')
  check('tagline 标注廿一层', (await txt('#tagline')).includes('廿一层'), await txt('#tagline'))
  check('就绪日志标注 21 层', (await txt('#log')).includes(FLOOR_N + ' 层'), await txt('#log'))
  check('存档体积条上限 = 1024 B', (await txt('#iSaveSize')).includes('1024 B'), await txt('#iSaveSize'))
  check('方向键已移除', await ev("!document.querySelector('.pad') && !document.querySelector('.pad-btn')"))
  check('道具/设置/新游戏按钮 6 个', await ev("document.querySelectorAll('.action-bar .action-btn').length") === 6)
  check('按钮文案由 texts.js 注入', (await txt('#btnActSettings')) === '设置' && (await txt('#actionHint')).length > 0,
    (await txt('#btnActSettings')) + ' / ' + (await txt('#actionHint')))
  check('设置浮层初始隐藏', (await hidden('#settingsLayer')) === true)
  await click('#btnActSettings')
  check('设置按钮打开浮层', (await hidden('#settingsLayer')) === false)
  check('浮层三个开关有文案', await ev("['setSprite','setAnim','setSound'].every(id=>document.getElementById(id).textContent.length>3)"))
  await click('#setSprite')
  check('浮层开关与右侧工作台同源', (await txt('#btnSprite')) === '色块', await txt('#btnSprite'))
  await click('#setSprite'); await click('#settingsClose')
  check('设置浮层可关闭', (await hidden('#settingsLayer')) === true)
  // 出生点 @ 归一化：逻辑层 / atlas / 实际精灵位置三重验证
  const spawnFix = await ev(`(async()=>{
    const a = await fetch('./assets/sprites.json').then(r=>r.json());
    const l = await import('./logic.js');
    const c = l.buildCells(l.newGame());
    const box = document.querySelectorAll('.cell')[50];
    return { tile: c[50].tile, map: a.tileMap['@'], pos: box.style.backgroundPosition,
      floor: '-'+a.frames.floor.x+'px '+(-a.frames.floor.y)+'px',
      hero: '-'+a.frames.hero_a.x+'px '+(-a.frames.hero_a.y)+'px' };
  })()`)
  check('出生点 tile 归一化为地板', spawnFix.tile === '.', spawnFix.tile)
  check('atlas 的 @ 映射为 floor', spawnFix.map === 'floor', spawnFix.map)
  // 冷启动时英雄本来就站在出生点，这里应画 hero_a；「走开后仍是英雄」才是 bug，放到 N 段验证
  check('冷启动时英雄确实站在出生点', spawnFix.pos === spawnFix.hero,
    spawnFix.pos + ' / ' + spawnFix.hero)
  check('全局仅 1 个 is-hero', await ev("document.querySelectorAll('.cell.is-hero').length") === 1)

  // 版本号单一真源（动态 import 拿真值）
  const V = await ev("(async()=>{const m=await import('./version.js');return m.VERSION})()")
  const CL = await ev("(async()=>{const m=await import('./version.js');return m.CHANGELOG.length})()")
  check('版本号可从 version.js 读出', /^v\d+\.\d+\.\d+$/.test(V || ''), V)
  const V0 = await ev("(async()=>{const m=await import('./version.js');return m.CHANGELOG[0].v})()")
  check('当前版本 = CHANGELOG 首条（不硬编码具体版本号）', V === V0, V + ' / ' + V0)
  check('游戏标题徽章 = 当前版本', (await txt('#titleVersion')) === V, await txt('#titleVersion'))
  check('标签页 title 含当前版本', (await ev('document.title')).includes(V), await ev('document.title'))
  check('页脚含当前版本', (await txt('#footVersion')).includes(V))
  check('版本记录条数与 CHANGELOG 一致', (await ev("document.querySelectorAll('#versionLog li').length")) === CL, CL + ' 条')
  check('版本记录首条 = 当前版本', (await ev("document.querySelector('#versionLog li .vtag')?.textContent")) === V)
  check('就绪日志含当前版本', (await txt('#log')).includes(V))

  // ---- A3 通关记录（独立 localStorage key）----
  check('通关记录卡初始显示总层数', (await txt('#recBestFloor')).includes('/ ' + (await ev("(async()=>{const m=await import('./tables.js');return m.FLOORS.length})()")) + 'F'),
    await txt('#recBestFloor'))
  check('初始无最少步数 / 0 次通关', (await txt('#recMinSteps')) === '—' && (await txt('#recWins')) === '0')
  check('冷启动不产生记录 key', (await ev("localStorage.getItem('mota_lite_web_records_v1')")) === null)
  check('记录卡说明文案来自 texts.js', (await txt('#recHint')).includes('本次会话'))

  // ---- A2 开场文本框弹层 ----
  check('冷启动弹出序章文本框', (await hidden('#storyLayer')) === false && (await txt('#storyTitle')).includes('序章'), await txt('#storyTitle'))
  check('序章有打字机正文', (await txt('#storyBody')).length > 0)
  await click('#storyContinue'); await click('#storyContinue')
  check('可关闭文本框弹层', (await hidden('#storyLayer')) === true)

  // ---- B 手动走格（拿黄钥匙）----
  await key('ArrowUp')
  check('手动走格获得黄钥匙', (await txt('#tip')) === '获得 黄钥匙', await txt('#tip'))
  const saveAfterStep = await txt('#savePreview')
  check('变更集写入存档串', saveAfterStep.includes('0:43'), saveAfterStep)
  check('步数 = 1', (await txt('#iSteps')) === '1')
  const SAVE_BEFORE = await ev("localStorage.getItem('mota_lite_web_v1')")
  check('真实存档已落 localStorage', !!SAVE_BEFORE && SAVE_BEFORE === saveAfterStep)

  // ---- C 载入回放（策略式攻略）----
  const SOL = await ev("(async()=>{const m=await import('./solver.js');const s=m.findSolution();return {n:s.steps.length,hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,ended:s.state.ended}})()")
  check('solver 在浏览器里可运行', SOL && SOL.n > 0, SOL ? SOL.n + ' 步' : 'null')
  await click('#btnReplay')
  check('模式标记 = 回放中', (await txt('#modeBadge')) === '回放中')
  const routeCount = await ev("document.querySelectorAll('.route-step').length")
  check('步骤条格数 = 路线步数', routeCount === SOL.n, routeCount + ' / ' + SOL.n)
  check('回放信息显示路线步数', (await txt('#replayInfo')).includes('路线 ' + SOL.n + ' 步') && (await txt('#replayInfo')).includes('第 0/' + SOL.n), await txt('#replayInfo'))
  check('回放从 newGame 出发', (await hud()) === HUD0, await hud())
  check('回放未污染真实存档', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_BEFORE)
  check('播放按钮已启用', (await ev("document.querySelector('#btnPlay').disabled")) === false)
  check('回放日志标注策略规划', (await txt('#log')).includes('策略规划'), await txt('#log'))

  // ---- D 单步前进 3 步 ----
  await click('#btnNext'); await click('#btnNext'); await click('#btnNext')
  check('前进到第 3 步', (await txt('#replayInfo')).includes('第 3/' + SOL.n), await txt('#replayInfo'))
  check('步骤条 done=3 / current=1', await ev("document.querySelectorAll('.route-step.done').length===3 && document.querySelectorAll('.route-step.current').length===1"))
  check('单步前进未写盘', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_BEFORE)

  // ---- E 后退 ----
  await click('#btnPrev')
  check('后退到第 2 步', (await txt('#replayInfo')).includes('第 2/' + SOL.n), await txt('#replayInfo'))
  check('后退复原步数', (await txt('#iSteps')) === '2')

  // ---- F 跳到最后一步（通关）----
  await ev(`document.querySelectorAll('.route-step')[${SOL.n - 1}].click()`)
  check('跳转到 ' + SOL.n + '/' + SOL.n, (await txt('#replayInfo')).includes('第 ' + SOL.n + '/' + SOL.n), await txt('#replayInfo'))
  check('通关属性与 solver 一致', (await hud()).includes('HP' + SOL.hp + '|A' + SOL.atk + '|D' + SOL.def), await hud())
  check('结束遮罩显示', (await hidden('#over')) === false)
  check('遮罩标题 = 通关', (await txt('#overTitle')) === '通关')
  check('通关时魔王已被击败（不在存活列表）', !(await txt('#battleList')).includes('魔王'), await txt('#battleList'))
  check('跳转通关仍未写盘', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_BEFORE)
  check('回放通关不写入通关记录', (await ev("localStorage.getItem('mota_lite_web_records_v1')")) === null)
  const evCount = await ev("document.querySelectorAll('#eventList li:not(.empty)').length")
  check('事件流水随回放重建', evCount >= 20, evCount + ' 条')
  check('事件流水含纯移动记录', (await txt('#eventList')).includes('走一格 · 向'))
  check('回放期间不弹剧情文本框', (await hidden('#storyLayer')) === true)

  // ---- G 一路退回第 0 步 ----
  await ev(`for(let i=0;i<${SOL.n};i++) document.querySelector('#btnPrev').click()`)
  check('回到第 0 步', (await txt('#replayInfo')).includes('第 0/' + SOL.n), await txt('#replayInfo'))
  check('遮罩随状态复原而隐藏', (await hidden('#over')) === true)
  check('HUD 回到初始', (await hud()) === HUD0, await hud())

  // ---- H 4× 播放到通关 ----
  await click('[data-speed="80"]')
  check('速度档切换为 80ms', (await txt('#speedInfo')) === '80 ms / 步')
  await click('#btnPlay')
  // 21 层 462 步 × 80ms ≈ 37s，超时留足余量
  const played = await waitFor(`document.querySelector('#replayInfo').textContent.includes('第 ${SOL.n}/${SOL.n}')`, 60000)
  check('自动播放走到通关', played, await txt('#replayInfo'))
  check('播放结束后日志收尾', (await txt('#log')).includes('回放结束'), await txt('#log'))
  check('播放期间仍未写盘', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_BEFORE)

  // ---- I 退出回放并恢复 ----
  await click('#btnExit')
  check('模式标记回到正常游玩', (await txt('#modeBadge')) === '正常游玩')
  check('恢复进入回放前的进度', (await hud()) === '1F|HP200|A10|D10|Y1|B0|R0|G0', await hud())
  check('恢复步数 = 1', (await txt('#iSteps')) === '1')
  check('恢复提示条', (await txt('#tip')) === '获得 黄钥匙')
  check('退出后 localStorage 与进入前一致', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_BEFORE)

  // ---- J 存档导入（v2 + v1 旧档兼容）----
  await setVal('#saveInput', 'bad-save'); await accept('#btnImport')
  check('坏档安全拒绝', (await txt('#log')).includes('返回 null'), await txt('#log'))
  await setVal('#saveInput', '2|2,1,1,999,50,50,0,0,0,0,0,0,0|'); await accept('#btnImport')
  check('导入 v2 存档成功', (await txt('#iPos')).includes('3F') && (await txt('#iHero')) === '999 / 50 / 50', await txt('#iPos') + ' / ' + await txt('#iHero'))
  check('战斗预览随导入属性刷新', (await txt('#battleList')).includes('可打'))
  await setVal('#saveInput', '1|0,1,7,200,10,10,0,1,0,0,0|'); await accept('#btnImport')
  check('v1 旧档可读', (await txt('#iPos')).includes('1F') && (await txt('#iHero')) === '200 / 10 / 10', await txt('#iPos'))
  const TOP_SAVE = FLOOR_N - 1   // 顶层索引随层数变化，不再硬编码 9
  await setVal('#saveInput', '2|' + TOP_SAVE + ',3,4,96,20,13,0,0,0,0,2,0,0|'); await accept('#btnImport')
  check('读档到「已通关」存档遮罩正确', (await hidden('#over')) === false && (await txt('#overTitle')) === '通关')

  // ---- K 缩放 ----
  await click('[data-zoom="1.25"]')
  check('屏幕缩放生效', (await ev("document.querySelector('#device').style.zoom")) === '1.25')

  // ---- L 新增能力：隐藏暗格 / 飞行器 / 炸弹 / 商店 / 开关 ----
  await accept('#btnRestart')
  check('重开回到 newGame', (await hud()) === HUD0, await hud())
  await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight')
  check('走到隐藏暗格触发', (await txt('#tip')).includes('发现隐藏的 红宝石'), await txt('#tip'))
  check('隐藏发现弹出对应剧情', (await hidden('#storyLayer')) === false && (await txt('#storyTitle')).includes('暗格'), await txt('#storyTitle'))
  await click('#storyContinue'); await click('#storyContinue')
  check('隐藏剧情可关闭', (await hidden('#storyLayer')) === true)

  // 飞行器：载入 fly=1 的存档后按 F 升层
  await setVal('#saveInput', '2|0,1,7,200,10,10,0,0,0,0,0,1,0|'); await accept('#btnImport')
  check('飞行器存档导入', (await txt('#iFly')).includes('已持有'), await txt('#iFly'))
  await key('f')
  check('按 F 升到 2F', (await txt('#iPos')).includes('2F'), await txt('#iPos'))
  await click('#storyContinue'); await click('#storyContinue')
  await keyShift('F')
  check('Shift+F 降回 1F', (await txt('#iPos')).includes('1F'), await txt('#iPos'))
  await click('#storyContinue'); await click('#storyContinue')

  // 炸弹：站在史莱姆上方，按 B 清掉它
  await setVal('#saveInput', '2|0,1,2,200,10,10,0,0,0,0,0,0,1|'); await accept('#btnImport')
  check('炸弹存档导入', (await txt('#iBomb')) === '1')
  await key('b')
  check('按 B 引爆炸弹', (await txt('#tip')).includes('炸弹'), await txt('#tip'))
  check('炸弹消耗后归零', (await txt('#iBomb')) === '0')
  check('史莱姆被清除', !(await txt('#battleList')).includes('史莱姆'))

  // 商店：带 20 金币打开对话并购买
  await setVal('#saveInput', '2|1,4,2,200,10,10,20,0,0,0,0,0,0|'); await accept('#btnImport')
  await click('#btnShop')
  check('商店文本框带购买按钮', (await hidden('#storyLayer')) === false && (await ev("document.querySelectorAll('#storyActions button').length")) === 2)
  await ev("document.querySelector('#storyActions button').click()")
  check('购买后攻击 +3 金币清零', (await txt('#iHero')) === '200 / 13 / 10' && (await txt('#iGold')) === '0', await txt('#iHero') + ' / ' + await txt('#iGold'))
  check('购买后弹层关闭', (await hidden('#storyLayer')) === true)

  // 表现层开关
  await click('#btnSprite')
  check('可切回色块渲染', await ev("document.querySelector('.cell').style.backgroundImage") === 'none')
  check('色块模式恢复字符', await ev("document.querySelector('.cell .cell-ch').textContent !== '' || document.querySelector('.cell').style.backgroundColor !== ''"))
  await click('#btnSprite')
  check('可切回像素精灵', await ev("document.querySelector('.cell').style.backgroundImage.includes('sprites.png')"))
  await click('#btnAnim')
  check('战斗动画开关文案变化', (await txt('#btnAnim')).includes('关'))
  await click('#btnAnim')
  await click('#btnSound')
  check('音效开关文案变化', (await txt('#btnSound')).includes('静音'))
  await click('#btnSound')

  // ---- M 通关记录：正常游玩真实走一步才写 ----
  await accept('#btnClearRecords')
  check('清除记录后 UI 归零', (await txt('#recWins')) === '0' && (await txt('#recMinSteps')) === '—')
  check('清除记录移除 localStorage key', (await ev("localStorage.getItem('mota_lite_web_records_v1')")) === null)
  // 从 solver 动态取「通关前一步」的存档与最后一步方向，不硬编码楼层 / 坐标
  const PREWIN = await ev(`(async()=>{
    const m = await import('./solver.js'); const l = await import('./logic.js');
    const sol = m.findSolution(); let s = l.newGame();
    for (let i=0;i<sol.steps.length-1;i++) s = l.resolveStep(s, sol.steps[i]).state;
    return { save: l.serialize(s), dir: sol.steps[sol.steps.length-1] };
  })()`)
  const KEYMAP = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
  await setVal('#saveInput', PREWIN.save); await accept('#btnImport')
  check('通关前存档落在顶层', (await txt('#iPos')).includes((await ev("(async()=>{const m=await import('./tables.js');return m.FLOORS.length})()")) + 'F'), await txt('#iPos'))
  check('导入外部存档本身不写记录', (await ev("localStorage.getItem('mota_lite_web_records_v1')")) === null)
  await key(KEYMAP[PREWIN.dir])
  check('正常游玩通关写入记录', (await ev("JSON.parse(localStorage.getItem('mota_lite_web_records_v1') || '{}').wins")) === 1)
  check('记录 UI 同步次数与步数', (await txt('#recWins')) === '1' && (await txt('#recMinSteps')) === '1 步',
    await txt('#recWins') + ' / ' + await txt('#recMinSteps'))
  check('通关记录不塞进存档串', !(await txt('#savePreview')).includes('wins'))

  // ---- N 点击格子移动（v0.6.0 取代方向键）----
  await accept('#btnRestart')
  check('重开步数归零', (await txt('#iSteps')) === '0')
  await ev("document.querySelectorAll('.cell')[51].click()")   // (2,7) 相邻格
  await sleep(300)
  check('点击相邻格走一步', (await txt('#iSteps')) === '1', await txt('#iPos'))
  await accept('#btnRestart')
  await ev("document.querySelectorAll('.cell')[52].click()")   // (3,7) 两格外，自动寻路
  await sleep(700)
  check('点击远格自动寻路 2 步', (await txt('#iSteps')) === '2', await txt('#iPos'))
  check('英雄落在目标格 (3,7)', (await txt('#iPos')).includes('(3,7)'), await txt('#iPos'))
  const stepsBeforeSelf = await txt('#iSteps')
  await ev("document.querySelectorAll('.cell')[52].click()")
  await sleep(250)
  check('点自己所在格不移动', (await txt('#iSteps')) === stepsBeforeSelf, await txt('#iSteps'))
  // 真正要守的回归：英雄离开出生点后，那格必须变回地板精灵，不能残留第二个英雄
  const spawnAfter = await ev(`(async()=>{
    const a = await fetch('./assets/sprites.json').then(r=>r.json());
    return { pos: document.querySelectorAll('.cell')[50].style.backgroundPosition,
      floor: '-'+a.frames.floor.x+'px '+(-a.frames.floor.y)+'px',
      hero: '-'+a.frames.hero_a.x+'px '+(-a.frames.hero_a.y)+'px' };
  })()`)
  check('英雄走开后出生点画地板而非英雄', spawnAfter.pos === spawnAfter.floor && spawnAfter.pos !== spawnAfter.hero,
    spawnAfter.pos + ' / ' + spawnAfter.floor)
  check('英雄走开后仍只有 1 个 is-hero', await ev("document.querySelectorAll('.cell.is-hero').length") === 1)

  // ---- O 二次确认弹窗 / 新游戏入口族（单槽覆盖语义）----
  const SAVE_O_BASE = '2|0,1,7,999,50,50,0,0,0,0,0,0,0|'
  await setVal('#saveInput', SAVE_O_BASE); await accept('#btnImport')
  const SAVE_O = await ev("localStorage.getItem('mota_lite_web_v1')")
  check('O 前置：载入 1F 出生点且 HP999',
    (await txt('#iPos')).includes('1F') && (await hud()).includes('HP999'), await hud())
  check('页头新游戏主入口存在', (await txt('#btnNewGameTop')).includes('新游戏'))
  check('单槽说明已注入', (await txt('#saveSlotNote')).includes('单槽'))
  check('确认弹层初始隐藏', (await hidden('#confirmLayer')) === true)

  await click('#btnNewGameTop')
  check('点页头新游戏弹出确认框', (await hidden('#confirmLayer')) === false)
  check('确认标题为「开始新游戏」', (await txt('#confirmTitle')).includes('新游戏'))
  check('确认正文含当前进度摘要（1F / HP999）',
    (await txt('#confirmBody')).includes('1F') && (await txt('#confirmBody')).includes('HP999'), await txt('#confirmBody'))
  check('确认按钮为「覆盖并开始」', (await txt('#confirmOk')).includes('覆盖'))
  check('取消按钮文案来自 texts.js', (await txt('#confirmCancel')).length > 0)
  await click('#confirmCancel')
  check('取消后确认框关闭', (await hidden('#confirmLayer')) === true)
  check('取消后存档未被覆盖', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_O)
  check('取消后仍停在原进度', (await hud()).includes('HP999'), await hud())
  check('取消日志提示进度未改动', (await txt('#log')).includes('未改动'))

  // 确认期间输入互斥：1F (1,7) 向上确定能走一格，但确认框打开时不应推进
  await click('#btnActNewGame')
  check('屏幕内新游戏按钮也能弹确认', (await hidden('#confirmLayer')) === false)
  await key('ArrowUp')
  check('确认期间键盘方向键不生效', (await txt('#iSteps')) === '0', await txt('#iSteps'))
  await ev("document.querySelectorAll('.cell')[43].click()")
  await sleep(250)
  check('确认期间点击格子不生效', (await txt('#iSteps')) === '0', await txt('#iSteps'))
  check('确认期间弹层仍显示', (await hidden('#confirmLayer')) === false)
  await key('Escape')
  check('Esc 取消确认', (await hidden('#confirmLayer')) === true)
  check('Esc 取消后存档仍未变', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_O)

  // 设置浮层入口 + Enter 确认
  await click('#btnActSettings')
  check('设置浮层已打开', (await hidden('#settingsLayer')) === false)
  await click('#setNewGame')
  check('设置浮层新游戏项弹确认并自动关设置',
    (await hidden('#confirmLayer')) === false && (await hidden('#settingsLayer')) === true)
  await key('Enter')
  check('Enter 确认后弹层关闭', (await hidden('#confirmLayer')) === true)
  check('Enter 确认后回到 newGame', (await hud()) === HUD0, await hud())
  check('确认后旧存档被覆盖', (await ev("localStorage.getItem('mota_lite_web_v1')")) !== SAVE_O)
  check('新游戏完成日志', (await txt('#log')).includes('覆盖'), await txt('#log'))

  // 清除存档 / 载入存档 / 清除记录都要确认，坏档不弹窗
  await click('#btnClear')
  check('清除存档弹确认', (await hidden('#confirmLayer')) === false && (await txt('#confirmTitle')).includes('清除存档'))
  await click('#confirmCancel')
  check('取消清除后存档仍在', (await ev("localStorage.getItem('mota_lite_web_v1')")) !== null)
  await setVal('#saveInput', '2|2,1,1,888,50,50,0,0,0,0,0,0,0|'); await click('#btnImport')
  check('载入存档弹确认且正文含覆盖',
    (await hidden('#confirmLayer')) === false && (await txt('#confirmBody')).includes('覆盖'))
  check('载入确认正文含存档串摘要', (await txt('#confirmBody')).includes('2|2,1,1'), await txt('#confirmBody'))
  await click('#confirmCancel')
  check('取消载入后仍停在 1F', (await txt('#iPos')).includes('1F'), await txt('#iPos'))
  await setVal('#saveInput', 'bad-save'); await click('#btnImport')
  check('坏档不弹确认直接拒绝', (await hidden('#confirmLayer')) === true && (await txt('#log')).includes('返回 null'))
  await click('#btnClearRecords')
  check('清除记录弹确认', (await hidden('#confirmLayer')) === false && (await txt('#confirmTitle')).includes('通关记录'))
  await click('#confirmOk')
  check('确认清除记录后归零', (await txt('#recWins')) === '0')

  // 遮罩点击取消 / 结束遮罩入口 / 键盘 R 与 Backspace
  await click('#btnNewGameTop')
  await ev("document.querySelector('#confirmLayer').click()")
  check('点遮罩取消确认', (await hidden('#confirmLayer')) === true)
  await setVal('#saveInput', '2|' + (FLOOR_N - 1) + ',3,4,96,20,13,0,0,0,0,2,0,0|'); await accept('#btnImport')
  check('已通关遮罩显示', (await hidden('#over')) === false)
  await click('#overBtn')
  check('结束遮罩重新开始也弹确认', (await hidden('#confirmLayer')) === false)
  await click('#confirmCancel')
  check('取消后结束遮罩仍在', (await hidden('#over')) === false)
  await key('r')
  check('键盘 R 走新游戏确认', (await hidden('#confirmLayer')) === false)
  await key('Escape')
  await key('Backspace')
  check('键盘 Backspace 走清除存档确认',
    (await hidden('#confirmLayer')) === false && (await txt('#confirmTitle')).includes('清除存档'))
  await key('Escape')
  check('全部确认框已关闭', (await hidden('#confirmLayer')) === true)
  check('确认弹窗专项期间零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '))

  check('全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '))
} catch (e) {
  check('脚本执行未抛错', false, e.message)
} finally {
  try { ws.close() } catch (e) {}
  try { chrome.kill('SIGKILL') } catch (e) {}
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
}

const failed = results.filter(r => !r.pass)
const summary = {
  url: URL, total: results.length, passed: results.length - failed.length,
  failed: failed.length, jsErrors, failedItems: failed, all: results
}
process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
process.exit(failed.length ? 1 : 0)
