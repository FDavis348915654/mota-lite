#!/usr/bin/env node
// 视觉核验专用：冷启动后关闭序章弹层，截一张「干净主界面」并量真实渲染尺寸。
// 仅用于人工排版核验，不参与回归断言；用完可留作工具。
import { spawn } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'

const URL = process.argv[2] || 'http://127.0.0.1:8765/'
const OUT = process.argv[3] || '/workspace/mota-lite-web/screenshots/v0.12-clean.png'
const PORT = 9300 + Math.floor(Math.random() * 400)
const PROFILE = `/tmp/mota-shot-${process.pid}`
const chrome = spawn('/usr/bin/chromium', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--window-size=1200,900', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json())
      const page = list.find(t => t.type === 'page')
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch (e) {}
    await sleep(150)
  }
  throw new Error('Chromium CDP 未就绪')
}
const ws = new WebSocket(await getWs())
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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
  return r.result?.result?.value
}

try {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL })
  // 等主界面 HUD 注入（版本号 / 楼层名都由 version.js 注入）
  for (let i = 0; i < 80; i++) {
    const ok = await ev("(()=>{const f=document.getElementById('hudFloor');return !!(f && f.textContent && f.textContent.trim().length)})()")
    if (ok) break
    await sleep(120)
  }
  await sleep(600) // 让序章打字机跑完、精灵图集加载

  // 关闭序章：直接调用与 UI 相同的关闭路径。序章只有一段，closeStory 首点补全打字、次点关闭。
  // 用 DOM 点击 storyContinue 两次，保证不依赖内部变量。
  await ev("document.getElementById('storyContinue').click()")
  await sleep(120)
  await ev("document.getElementById('storyContinue').click()")
  await sleep(200)
  // 若仍有排队剧情（保险），继续点直到隐藏
  for (let i = 0; i < 8; i++) {
    const h = await ev("document.getElementById('storyLayer').hidden")
    if (h) break
    await ev("document.getElementById('storyContinue').click()")
    await sleep(120)
  }
  // 兜底：强制隐藏所有遮罩层，保证得到干净主界面
  await ev("['storyLayer','settingsLayer','confirmLayer','codexLayer'].forEach(id=>{const e=document.getElementById(id);if(e)e.hidden=true})")

  // 量真实渲染尺寸：设备区矩形、各 HUD 行、按钮区、提示条、是否溢出 520
  const metrics = await ev(`(()=>{
    const rect = s => { const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom)} }
    const fs = s => { const e=document.querySelector(s); if(!e) return null; return getComputedStyle(e).fontSize }
    const dev = document.querySelector('#device').getBoundingClientRect()
    const bar = document.querySelector('#actionBar')
    const btns = [...document.querySelectorAll('.action-btn')].map(b=>({t:b.textContent.trim(),fs:getComputedStyle(b).fontSize,w:Math.round(b.getBoundingClientRect().width),h:Math.round(b.getBoundingClientRect().height)}))
    return {
      device:{x:Math.round(dev.x),y:Math.round(dev.y),w:Math.round(dev.width),h:Math.round(dev.height),bottom:Math.round(dev.bottom)},
      screen: rect('#screen'),
      hudTitle: rect('.hud-row-title'), hudSub: rect('.hud-row-sub'),
      viewport: rect('#viewport'), tip: rect('#tip'), actionBar: rect('#actionBar'),
      actionBarBottomInDevice: Math.round(bar.getBoundingClientRect().bottom - dev.top),
      fsHudFloor: fs('.hud-floor'), fsHudHp: fs('.hud-hp'), fsHudKy: fs('.hud-ky'),
      fsTip: fs('#tip'), fsCellCh: fs('.cell-ch'),
      buttons: btns,
      storyHidden: document.getElementById('storyLayer').hidden
    }
  })()`)
  console.log('METRICS=' + JSON.stringify(metrics, null, 2))

  // 截图：只截设备区
  const box = metrics.device
  const shot = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: box.x - 6, y: box.y - 6, width: box.w + 12, height: box.h + 12, scale: 1 }
  })
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log('SHOT=' + OUT)
} finally {
  try { ws.close() } catch (e) {}
  try { chrome.kill('SIGKILL') } catch (e) {}
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch (e) {}
}
