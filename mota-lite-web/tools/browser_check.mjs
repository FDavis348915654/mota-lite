#!/usr/bin/env node
// 在线试玩版的真实 Chromium 回归（开发工具，不是页面入口）。
// 用法：先起本地服务 `python3 -m http.server 8765 --directory .`，再 `node tools/browser_check.mjs [URL]`
// 零安装：只用 Node 22 内置的 fetch / WebSocket + CDP，不拉 playwright。
//
// v0.8 改写原则：**断言不写死地图坐标**。
// 13×15 大地图每层都可能重排，旧版把 (1,7)/(2,7)/(3,7) 之类的格子写进断言，
// 一改地图就整片变红，反而掩盖真实回归。现在统一用 import('./logic.js') 现算：
// 「黄钥匙在哪」「哪个怪旁边能站人」「图鉴在第几层」，坐标全部运行期推导。
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
const cellClick = i => ev(`document.querySelectorAll('.cell')[${i}].click()`)
// 危险操作现在会先弹二次确认：点击后若确认框出现则自动点「确认」，坏档等不弹窗的情况原样跳过
const accept = async sel => {
  await click(sel)
  return ev("(()=>{const l=document.querySelector('#confirmLayer');const b=document.querySelector('#confirmOk');if(l&&!l.hidden&&b){b.click();return true}return false})()")
}
// HUD 为分段 span，用 | 拼接读回，避免依赖整串文本
const hud = () => ev("(()=>{const g=id=>document.getElementById(id).textContent;return ['hudFloor','hudHp','hudAtk','hudDef','hudKy','hudKb','hudKr','hudGold'].map(g).join('|')})()")
// v0.9：楼层段拼了主题（f.name = '1F · 潮湿石厅'），HUD0 运行期从 tables.js 取，不写死
let HUD0 = ''
const closeStory = async () => { await click('#storyContinue'); await click('#storyContinue') }

// 地图探测：全部在浏览器里 import 真逻辑层现算，杜绝坐标硬编码
const MAP = await (async () => {
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL })
  await sleep(400)
  await send('Runtime.enable')
  return ev(`(async()=>{
    const l = await import('./logic.js');
    const t = await import('./tables.js');
    const sv = await import('./solver.js');
    const s = l.newGame();
    const W = t.FLOORS[0].rows[0].length, H = t.FLOORS[0].rows.length;
    const at = (x,y) => l.tileAt(s,x,y);
    const spawn = { x: s.x, y: s.y, idx: s.y*W + s.x };
    const out = { W, H, spawn, floors: t.FLOORS.length, f0name: t.FLOORS[0].name,
                  keyY: null, free1: null, free2: null,
                  hidden: null, bombSpot: null, shop: null, codexFloor: null,
                  mage: null, thief: null, secret1f: null, iron: null,
                  doorCost: null, secretCfgCount: 0 };

    // 1F 黄钥匙（每层三色各一，必存在）
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      const it = t.itemByCh(at(x,y));
      if (it && it.id === 'key_y' && !out.keyY) out.keyY = { x, y, idx: y*W + x };
    }
    // 相邻 1 步 / 2 步的可走空格，各取第一个（用 solver 真寻路确认步数）
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      if (x===spawn.x && y===spawn.y) continue;
      if (at(x,y) !== '.') continue;
      const r = sv.findPath(s, new Set([x+','+y]), { blockEntities: true });
      if (!r.path) continue;
      if (r.path.length === 1 && !out.free1) out.free1 = { x, y, idx: y*W + x };
      if (r.path.length === 2 && !out.free2) out.free2 = { x, y, idx: y*W + x };
    }
    // 1F 隐藏暗格（配置表里有 floor=0 的记录）
    const h0 = t.HIDDEN.find(h => h.floor === 0);
    if (h0) out.hidden = { x: h0.x, y: h0.y, idx: h0.y*W + h0.x, name: h0.name };
    // 1F 某个怪旁边能站人的位置（炸弹测试用）
    for (let y=0;y<H && !out.bombSpot;y++) for (let x=0;x<W && !out.bombSpot;x++) {
      const mon = t.monsterByCh(at(x,y));
      if (!mon || mon.bombImmune) continue;
      for (const d of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const nx=x+d[0], ny=y+d[1];
        if (nx<0||ny<0||nx>=W||ny>=H) continue;
        const ch = at(nx,ny);
        if (ch === '.' || ch === '@') { out.bombSpot = { x:nx, y:ny, mx:x, my:y }; break; }
      }
    }
    // 全塔找商店 N 与它旁边能站的格
    for (let f=0;f<t.FLOORS.length && !out.shop;f++) {
      const rows = t.FLOORS[f].rows, fw = rows[0].length, fh = rows.length;
      for (let y=0;y<fh && !out.shop;y++) for (let x=0;x<fw && !out.shop;x++) {
        if (rows[y][x] !== 'N') continue;
        for (const d of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nx=x+d[0], ny=y+d[1];
          if (nx<0||ny<0||nx>=fw||ny>=fh) continue;
          const ch = rows[ny][nx];
          if (ch === '.' || ch === '@') { out.shop = { floor:f, x:nx, y:ny, nx, ny2:y, sx:x, sy:y }; break; }
        }
      }
    }
    // 图鉴所在层（ITEMS 里 id=codex 的字符出现在哪层）
    for (let f=0;f<t.FLOORS.length && out.codexFloor===null;f++) {
      if (t.FLOORS[f].rows.some(r => r.indexOf('I') >= 0)) out.codexFloor = f;
    }
    // 1F 静态配置的怪物类型全集 + 其中一类的可清除坐标（验证「已清除仍列出」口径）
    const f0 = t.FLOORS[0].rows, f0w = f0[0].length;
    const monTypes = new Set(), firstMon = {};
    for (let y=0;y<f0.length;y++) for (let x=0;x<f0w;x++) {
      const c = f0[y][x];
      if (!t.monsterByCh(c)) continue;
      monTypes.add(c);
      if (!firstMon[c]) firstMon[c] = { x, y, idx: y*f0w + x };
    }
    out.codexMon = { types: [...monTypes], firstMon };
    // v0.12：1F 暗门 A 与它旁边能站的格（真实点击撞墙用），坐标运行期推导
    for (let y=0;y<H && !out.secret1f;y++) for (let x=0;x<W && !out.secret1f;x++) {
      if (at(x,y) !== 'A') continue;
      for (const d of [[0,1,'up'],[0,-1,'down'],[1,0,'left'],[-1,0,'right']]) {
        const nx=x+d[0], ny=y+d[1], ch=at(nx,ny);
        if (ch !== '#' && !l.isEntityTile(ch)) {
          const sec = t.secretAt(0,x,y) || {};
          out.secret1f = { floor:0, x, y, sx:nx, sy:ny, idx:y*W+x,
                           story:sec.story, item:sec.item, name:sec.name };
          break;
        }
      }
    }
    // v0.12：7F 铁门 G 与它旁边能站的格（3 把黄钥匙门槛用）
    for (let f=0;f<t.FLOORS.length && !out.iron;f++) {
      const rows=t.FLOORS[f].rows, fw=rows[0].length, fh=rows.length;
      for (let y=0;y<fh && !out.iron;y++) for (let x=0;x<fw && !out.iron;x++) {
        if (rows[y][x] !== 'G') continue;
        for (const d of [[0,1,'up'],[0,-1,'down'],[1,0,'left'],[-1,0,'right']]) {
          const nx=x+d[0], ny=y+d[1], row=rows[ny], ch=row && row[nx];
          if (ch && ch!=='#' && !l.isEntityTile(ch)) {
            out.iron = { floor:f, x, y, sx:nx, sy:ny, idx:y*fw+x, W:fw };
            break;
          }
        }
      }
    }
    out.doorCost = t.DOOR_COST;
    out.secretCfgCount = t.SECRET.length;
    // 全塔找法师 M / 盗贼 T，以及「站在它旁边能触发交互」的可走相邻格。
    // NPC 是房间层实体，可能不在 1F，故存档串要按其所在层动态构造。
    for (let f=0;f<t.FLOORS.length;f++) {
      const rows = t.FLOORS[f].rows, fw = rows[0].length, fh = rows.length;
      for (let y=0;y<fh;y++) for (let x=0;x<fw;x++) {
        const c = rows[y][x];
        const slot = c === 'M' ? 'mage' : (c === 'T' ? 'thief' : null);
        if (!slot || out[slot]) continue;
        for (const d of [[0,1],[0,-1],[1,0],[-1,0]]) {
          const nx=x+d[0], ny=y+d[1];
          if (nx<0||ny<0||nx>=fw||ny>=fh) continue;
          const ch = rows[ny][nx];
          if (ch === '.' || ch === '@') {
            // dir = 从站立格走进 NPC 格的方向
            const dir = d[0]===1 ? 'right' : d[0]===-1 ? 'left' : d[1]===1 ? 'down' : 'up';
            out[slot] = { floor:f, sx:nx, sy:ny, nx:x, ny:y, idx:y*fw+x, dir,
                          standIdx: ny*fw+nx };
            break;
          }
        }
      }
    }
    return out;
  })()`)
})()
HUD0 = MAP.f0name + '|HP200|A10|D10|Y0|B0|R0|G0'

try {
  const ready = await waitFor(`document.readyState === 'complete' && document.querySelectorAll('.cell').length === ${MAP.W * MAP.H}`)
  check(`冷启动渲染 ${MAP.W * MAP.H} 格`, ready)
  if (!ready) throw new Error('页面未就绪，中止后续交互')

  // ---- A 冷启动 / 资源 / 版本 ----
  check('HUD 初始属性（8 段）', (await hud()) === HUD0, await hud())
  const hudColors = await ev("(()=>{const ids=['hudFloor','hudHp','hudAtk','hudDef','hudKy','hudKb','hudKr','hudGold'];return [...new Set(ids.map(id=>getComputedStyle(document.getElementById(id)).color))].length})()")
  check('HUD 分段颜色 >= 6 种', hudColors >= 6, hudColors + ' 种')
  check('模式标记 = 正常游玩', (await txt('#modeBadge')) === '正常游玩')
  const legendCount = await ev("document.querySelectorAll('#legend .legend-item').length")
  check('图例由配置表生成（含图鉴 / 法师 / 盗贼）', legendCount >= 34, legendCount + ' 项')
  check('图例含图鉴与两个 NPC', (await txt('#legend')).includes('怪物图鉴') && (await txt('#legend')).includes('法师') && (await txt('#legend')).includes('盗贼'))
  check('战斗预览列出本层存活怪（带本层实际 HP/攻/防）',
    await ev("document.querySelectorAll('#battleList .battle-row').length > 0 && [...document.querySelectorAll('#battleList .bstat')].every(e => e.textContent.split('/').length === 3 && e.textContent.split('/').every(n => Number(n) > 0))"),
    await txt('#battleList'))
  check('v0.9 战斗有代价：1F 裸装预览含「会阵亡」（不再是 100% 零伤）',
    (await txt('#battleList')).includes('会阵亡'), await txt('#battleList'))
  check('战斗预览数值 = scaledMon 本层实际值', await ev(`(async()=>{
    const t = await import('./tables.js'); const l = await import('./logic.js');
    const rows = t.FLOORS[0].rows;
    const want = [...new Set(rows.join('').split('').filter(c => t.monsterByCh(c)))]
      .map(c => { const m = l.scaledMon(t.monsterByCh(c), 0); return m.hp+'/'+m.atk+'/'+m.def });
    const got = [...document.querySelectorAll('#battleList .bstat')].map(e => e.textContent);
    return want.length > 0 && want.every(w => got.includes(w));
  })()`), await txt('#battleList'))
  check('战斗预览徽章带怪物手册 tooltip（加防收益 / 临界 / 真实伤害）',
    await ev("[...document.querySelectorAll('#battleList .badge')].some(b => ['每 +1 防少掉','少挨一回合','真实伤害'].some(k => (b.title || '').includes(k)))"))
  check('存档串为 v3 紧凑格式', (await txt('#savePreview')).startsWith('3|'), await txt('#savePreview'))
  check('v3 存档含已探索段（出生层 0）', (await txt('#savePreview')).split('|')[3] === '0', await txt('#savePreview'))
  check('v3 存档段数为 4', (await txt('#savePreview')).split('|').length === 4)
  check('播放按钮未载入路线时禁用', await ev("document.querySelector('#btnPlay').disabled") === true)
  check('标签副标题由 texts.js 注入', (await txt('#headSub')).includes('212×520'))
  check('tagline 注入', (await txt('#tagline')).length > 4, await txt('#tagline'))
  check('图例带文案 tooltip', await ev("!!document.querySelector('#legend .swatch[title]')"))

  // 资源卡
  check('资源卡 4 张图', await ev("document.querySelectorAll('.asset-row img').length") === 4)
  check('12 个音效试听按钮', await ev("document.querySelectorAll('#sfxRow button').length") === 12)
  check('道具栏 fly/bomb/gold 已渲染', (await txt('#iFly')).length > 0 && (await txt('#iBomb')) === '0' && (await txt('#iGold')) === '0')
  check('帮助快捷键含 Shift+F 与 C', (await txt('#helpKeys')).includes('Shift+F') && (await txt('#helpKeys')).includes('C 图鉴'))
  check('架构说明标注分叉', (await txt('#archText')).includes('单一真源'))
  check('架构说明改为视口裁剪 + 相机', (await txt('#archSub')).includes('viewport') && (await txt('#archSub')).includes('相机'), await txt('#archSub'))

  // 精灵渲染（等 atlas fetch 完成）
  const spriteReady = await waitFor("document.querySelector('.cell').style.backgroundImage.includes('sprites.png')", 8000)
  check('像素精灵渲染已生效', spriteReady, await ev("document.querySelector('.cell').style.backgroundImage"))
  check('精灵模式下字符层隐藏', await ev("document.querySelector('.cell .cell-ch').textContent") === '')
  check('v0.9 新怪种 6/7/8 都有精灵帧与映射', await ev(`(async()=>{
    const a = await fetch('./assets/sprites.json').then(r => r.json());
    return ['6','7','8'].every(c => a.tileMap[c] && a.frames[a.tileMap[c]]);
  })()`))

  // ---- A4 视口 / 相机 / 按钮 ----
  const FLOOR_N = MAP.floors
  check('楼层数 = 21', FLOOR_N === 21, FLOOR_N + ' 层')
  check('槽位数 = 整层地图格数', await ev("document.querySelectorAll('.cell').length") === MAP.W * MAP.H, MAP.W + '×' + MAP.H)
  check('视口按 7×9 裁剪', await ev("(()=>{const v=document.querySelector('#viewport');return v.clientWidth===196&&v.clientHeight===252})()"))
  check('grid 尺寸 = 整层像素', await ev(`(()=>{const g=document.querySelector('#grid');return g.style.width==='${MAP.W * 28}px'&&g.style.height==='${MAP.H * 28}px'})()`), await ev("document.querySelector('#grid').style.width"))
  check('tagline 标注廿一层', (await txt('#tagline')).includes('廿一层'), await txt('#tagline'))
  check('就绪日志标注 21 层', (await txt('#log')).includes(FLOOR_N + ' 层'), await txt('#log'))
  check('存档体积条上限 = 4096 B', (await txt('#iSaveSize')).includes('4096 B'), await txt('#iSaveSize'))
  check('方向键已移除', await ev("!document.querySelector('.pad') && !document.querySelector('.pad-btn')"))
  check('道具/图鉴/设置/新游戏按钮 7 个', await ev("document.querySelectorAll('.action-bar .action-btn').length") === 7)
  check('按钮文案由 texts.js 注入', (await txt('#btnActSettings')) === '设置' && (await txt('#btnActCodex')) === '图鉴',
    (await txt('#btnActSettings')) + ' / ' + (await txt('#btnActCodex')))
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
    const box = document.querySelectorAll('.cell')[${MAP.spawn.idx}];
    return { tile: c[${MAP.spawn.idx}].tile, map: a.tileMap['@'], pos: box.style.backgroundPosition,
      floor: '-'+a.frames.floor.x+'px '+(-a.frames.floor.y)+'px',
      hero: '-'+a.frames.hero_a.x+'px '+(-a.frames.hero_a.y)+'px' };
  })()`)
  check('出生点 tile 归一化为地板', spawnFix.tile === '.', spawnFix.tile)
  check('atlas 的 @ 映射为 floor', spawnFix.map === 'floor', spawnFix.map)
  check('冷启动时英雄确实站在出生点', spawnFix.pos === spawnFix.hero, spawnFix.pos + ' / ' + spawnFix.hero)
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
  check('通关记录卡初始显示总层数', (await txt('#recBestFloor')).includes('/ ' + FLOOR_N + 'F'), await txt('#recBestFloor'))
  check('初始无最少步数 / 0 次通关', (await txt('#recMinSteps')) === '—' && (await txt('#recWins')) === '0')
  check('冷启动不产生记录 key', (await ev("localStorage.getItem('mota_lite_web_records_v1')")) === null)
  check('记录卡说明文案来自 texts.js', (await txt('#recHint')).includes('本次会话'))

  // ---- A2 开场文本框弹层 ----
  check('冷启动弹出序章文本框', (await hidden('#storyLayer')) === false && (await txt('#storyTitle')).includes('序章'), await txt('#storyTitle'))
  check('序章有打字机正文', (await txt('#storyBody')).length > 0)
  await closeStory()
  check('可关闭文本框弹层', (await hidden('#storyLayer')) === true)

  // ---- B v0.8 核心：点实体 -> 走到旁边 -> 自动交互 -> 停下 ----
  check('B 前置：1F 有黄钥匙可点', !!MAP.keyY, JSON.stringify(MAP.keyY))
  await cellClick(MAP.keyY.idx)
  const picked = await waitFor("document.querySelector('#tip').textContent.includes('获得 黄钥匙')", 10000)
  check('点远处道具会自动走过去领取', picked, await txt('#tip'))
  const keyHero = await ev(`(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return {x:s.x,y:s.y}})()`)
  check('v0.11 领取后英雄停在道具相邻格（不再踩进道具格）',
    Math.abs(keyHero.x - MAP.keyY.x) + Math.abs(keyHero.y - MAP.keyY.y) === 1,
    `英雄(${keyHero.x},${keyHero.y}) 道具(${MAP.keyY.x},${MAP.keyY.y})`)
  const keyCleared = await ev(`(async()=>{const l=await import('./logic.js');const t=await import('./tables.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return l.tileAt(s,${MAP.keyY.x},${MAP.keyY.y})})()`)
  check('领取后该格变回地板', keyCleared === '.', keyCleared)
  const stepsAfterPick = Number(await txt('#iSteps'))
  check('一次点到底产生了完整步数（>1）', stepsAfterPick > 1, stepsAfterPick)
  const posAtPick = await txt('#iPos')
  await sleep(500)
  check('领取后不再继续移动（停下来了）', (await txt('#iPos')) === posAtPick, await txt('#iPos'))

  const saveAfterStep = await txt('#savePreview')
  check('变更集写入存档串', /0:\d+/.test(saveAfterStep), saveAfterStep)
  const SAVE_BEFORE = await ev("localStorage.getItem('mota_lite_web_v1')")
  check('真实存档已落 localStorage', !!SAVE_BEFORE && SAVE_BEFORE === saveAfterStep)
  check('存档串随拾取记录黄钥匙数量', (await hud()).includes('Y1'), await hud())

  // ---- C 载入回放（策略式攻略）----
  const SOL = await ev("(async()=>{const m=await import('./solver.js');const s=m.findSolution();return {n:s.steps.length,hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,ended:s.state.ended,floors:Object.keys(s.state.explored).length}})()")
  check('solver 在浏览器里可运行', SOL && SOL.n > 0, SOL ? SOL.n + ' 步' : 'null')
  check('solver 覆盖全部 21 层', SOL.floors === 21, SOL.floors + ' 层')
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

  // ---- G 上一步 + 重新载入（1432 步全量回退太慢，用重载验证归零）----
  await click('#btnPrev')
  check('从终点上一步可退', (await txt('#replayInfo')).includes('第 ' + (SOL.n - 1) + '/' + SOL.n), await txt('#replayInfo'))
  await click('#btnReplay')
  check('重新载入攻略回到第 0 步', (await txt('#replayInfo')).includes('第 0/' + SOL.n), await txt('#replayInfo'))
  check('遮罩随状态复原而隐藏', (await hidden('#over')) === true)
  check('HUD 回到初始', (await hud()) === HUD0, await hud())

  // ---- H 4× 播放（短时抽检，不跑完整 1432 步）----
  await click('[data-speed="80"]')
  check('速度档切换为 80ms', (await txt('#speedInfo')) === '80 ms / 步')
  await click('#btnPlay')
  await sleep(1400)
  await click('#btnPlay')
  const played = await ev("(()=>{const m=/第 (\\d+)\\//.exec(document.querySelector('#replayInfo').textContent);return m?Number(m[1]):0})()")
  check('自动播放推进了路线', played > 6, played + ' 步')
  check('播放期间仍未写盘', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_BEFORE)

  // ---- I 退出回放并恢复 ----
  await click('#btnExit')
  check('模式标记回到正常游玩', (await txt('#modeBadge')) === '正常游玩')
  check('恢复进入回放前的进度', (await hud()).includes('HP200') && (await hud()).includes('Y1'), await hud())
  check('恢复步数与领取后一致', (await txt('#iSteps')) === String(stepsAfterPick), await txt('#iSteps'))
  check('恢复提示条', (await txt('#tip')) === '获得 黄钥匙')
  check('退出后 localStorage 与进入前一致', (await ev("localStorage.getItem('mota_lite_web_v1')")) === SAVE_BEFORE)

  // ---- J 存档导入（v3 / v2 / v1 三代兼容）----
  await setVal('#saveInput', 'bad-save'); await accept('#btnImport')
  check('坏档安全拒绝', (await txt('#log')).includes('返回 null'), await txt('#log'))
  await setVal('#saveInput', '2|2,1,1,999,50,50,0,0,0,0,0,0,0|'); await accept('#btnImport')
  check('导入 v2 存档成功', (await txt('#iPos')).includes('3F') && (await txt('#iHero')) === '999 / 50 / 50', (await txt('#iPos')) + ' / ' + await txt('#iHero'))
  check('v2 旧档 fly 语义兼容', (await txt('#iFly')) === '0', await txt('#iFly'))
  await setVal('#saveInput', '1|0,1,1,200,10,10,0,1,0,0,0|'); await accept('#btnImport')
  check('v1 旧档可读', (await txt('#iPos')).includes('1F') && (await txt('#iHero')) === '200 / 10 / 10', await txt('#iPos'))
  const TOP_SAVE = FLOOR_N - 1   // 顶层索引随层数变化，不硬编码
  await setVal('#saveInput', '3|' + TOP_SAVE + ',3,4,96,20,13,0,0,0,0,2,0,0,0||' + TOP_SAVE); await accept('#btnImport')
  check('读档到「已通关」存档遮罩正确', (await hidden('#over')) === false && (await txt('#overTitle')) === '通关')

  // ---- K 缩放（含 0.5× 手环观感档）----
  await click('[data-zoom="0.5"]')
  check('屏幕缩放 0.5× 生效', (await ev("document.querySelector('#device').style.zoom")) === '0.5')
  check('设备实际渲染宽度减半', await ev("Math.round(document.querySelector('#device').getBoundingClientRect().width)") === 114,
    await ev("document.querySelector('#device').getBoundingClientRect().width"))
  await click('[data-zoom="1.25"]')
  check('屏幕缩放 1.25× 生效', (await ev("document.querySelector('#device').style.zoom")) === '1.25')
  await click('[data-zoom="1"]')

  // ---- L 新增能力：暗格 / 飞行器 / 炸弹 / 商店 / 图鉴 ----
  await accept('#btnRestart')
  check('重开回到 newGame', (await hud()) === HUD0, await hud())

  // 隐藏暗格：点配置表里的 H 坐标，走过去触发
  await cellClick(MAP.hidden.idx)
  const hid = await waitFor("document.querySelector('#tip').textContent.includes('发现隐藏的')", 10000)
  check('走到隐藏暗格触发奖励', hid, await txt('#tip'))
  check('隐藏发现弹出对应剧情', (await hidden('#storyLayer')) === false && (await txt('#storyTitle')).includes('暗格'), await txt('#storyTitle'))
  await closeStory()
  check('隐藏剧情可关闭', (await hidden('#storyLayer')) === true)

  // 飞行器：v0.8 只能飞已探索过的楼层
  await setVal('#saveInput', '3|0,1,1,200,10,10,0,0,0,0,0,1,0,0||0'); await accept('#btnImport')
  check('飞行器存档导入', (await txt('#iFly')).includes('已持有'), await txt('#iFly'))
  await key('f')
  check('未探索的楼层飞不过去', (await txt('#iPos')).includes('1F') && (await txt('#tip')).includes('已探索'), await txt('#tip'))
  await setVal('#saveInput', '3|0,1,1,200,10,10,0,0,0,0,0,1,0,0||0.1'); await accept('#btnImport')
  await key('f')
  check('按 F 升到已探索的 2F', (await txt('#iPos')).includes('2F'), await txt('#iPos'))
  await closeStory()
  await keyShift('F')
  check('Shift+F 降回已探索的 1F', (await txt('#iPos')).includes('1F'), await txt('#iPos'))
  await closeStory()

  // 炸弹：站在怪旁边引爆
  await setVal('#saveInput', '3|0,' + MAP.bombSpot.x + ',' + MAP.bombSpot.y + ',200,10,10,0,0,0,0,0,0,1,0||0'); await accept('#btnImport')
  check('炸弹存档导入', (await txt('#iBomb')) === '1')
  await key('b')
  check('按 B 引爆炸弹', (await txt('#tip')).includes('炸弹'), await txt('#tip'))
  check('炸弹消耗后归零', (await txt('#iBomb')) === '0')

  // 商店：点商人 -> 走到旁边 -> 弹交易框（英雄不踩到商人身上）
  const sp = MAP.shop
  await setVal('#saveInput', '3|' + sp.floor + ',' + sp.x + ',' + sp.y + ',200,10,10,20,0,0,0,0,0,0,0||' + sp.floor); await accept('#btnImport')
  const posBeforeShop = await txt('#iPos')
  check('商人前置：英雄已站在商人旁边一格', posBeforeShop.includes(`(${sp.x},${sp.y})`), posBeforeShop)
  await cellClick(sp.sy * MAP.W + sp.sx)
  const shopOpen = await waitFor("(()=>{const l=document.querySelector('#storyLayer');return l&&!l.hidden&&document.querySelectorAll('#storyActions button').length===5})()", 10000)
  check('点商人弹交易框（v0.12 四选一 + 离开 = 5 个动作）', shopOpen, await txt('#storyTitle'))
  const shopLabels = await txt('#storyActions')
  check('v0.12 商店提供攻击 / 防御 / 生命 / 黄钥匙四种商品',
    ['攻击','防御','生命','黄钥匙'].every(k => shopLabels.includes(k)), shopLabels)
  check('v0.12 商店标签带档位增量与固定价 20G',
    await ev("[...document.querySelectorAll('#storyActions button')].slice(0,4).every(b => b.textContent.includes('+') && b.textContent.includes('20G'))"), shopLabels)
  check('商人对话不把英雄挪到商人格', (await txt('#iPos')) === posBeforeShop, await txt('#iPos'))
  await ev("document.querySelector('#storyActions button').click()")
  check('购买后攻击 +3 金币清零', (await txt('#iHero')) === '200 / 13 / 10' && (await txt('#iGold')) === '0', (await txt('#iHero')) + ' / ' + await txt('#iGold'))
  check('购买后弹层关闭', (await hidden('#storyLayer')) === true)

  // ---- L' 房间 NPC：法师 / 盗贼 真实点击交互（坐标全部运行期推导，不写死楼层/格子）----
  // 旧版只在 validate_logic 里测了 resolveStep 的奖励，宿主层「点格子 -> 走到旁边 -> 交互」链路没覆盖。
  // 这里用导入存档把英雄放到 NPC 相邻可站格，再真实点击 NPC 槽位，验证整条链路 + 奖励 + 清格 + 停住。
  check('全塔定位到法师 M 与盗贼 T 及其相邻可站格', !!MAP.mage && !!MAP.thief,
    JSON.stringify({ mage: MAP.mage, thief: MAP.thief }))
  for (const npcSpec of [
    { key: 'mage', label: '法师', hero: '300 / 10 / 18', keys: '0 / 0' },
    { key: 'thief', label: '盗贼', hero: '200 / 10 / 10', keys: '3 / 40' }
  ]) {
    const np = MAP[npcSpec.key]
    if (!np) continue
    // v3 存档：站在 NPC 相邻格，HERO0 属性，无道具，explored 只含该层（房间层可能 > 0）
    const npcSave = '3|' + np.floor + ',' + np.sx + ',' + np.sy +
      ',200,10,10,0,0,0,0,0,0,0,0||' + np.floor
    await setVal('#saveInput', npcSave); await accept('#btnImport')
    check(`${npcSpec.label}前置：英雄站在相邻可站格`,
      (await txt('#iPos')).includes(`(${np.sx},${np.sy})`), await txt('#iPos'))
    await cellClick(np.idx)
    const rescued = await waitFor("document.querySelector('#tip').textContent.includes('已救出')", 10000)
    check(`点${npcSpec.label}格触发「已救出」文案`, rescued, await txt('#tip'))
    check(`救出${npcSpec.label}奖励生效（HP/攻/防）`, (await txt('#iHero')) === npcSpec.hero, await txt('#iHero'))
    check(`救出${npcSpec.label}奖励生效（黄钥匙/金币）`, (await txt('#iKeys')) === npcSpec.keys, await txt('#iKeys'))
    // v0.11：从存档读回真实 state —— NPC 格清成地板，英雄停在交互前的相邻格（不再踩进 NPC 原格）
    const npcAfter = await ev(`(async()=>{
      const l = await import('./logic.js');
      const s = l.deserialize(localStorage.getItem('mota_lite_web_v1'));
      return { tile: l.tileAt(s, ${np.nx}, ${np.ny}), x: s.x, y: s.y, floor: s.floor };
    })()`)
    check(`${npcSpec.label}格救出后清成地板`, npcAfter.tile === '.', npcAfter.tile)
    check(`v0.11 英雄救出${npcSpec.label}后停在原地相邻格（不踩进 NPC 原格）`,
      npcAfter.x === np.sx && npcAfter.y === np.sy && npcAfter.floor === np.floor, JSON.stringify(npcAfter))
    // 交互完即停：再等一拍步数不再增长（不偷偷继续自动行走）
    const stepsAtNpc = await txt('#iSteps')
    await sleep(350)
    check(`${npcSpec.label}交互后自动行走已停下`, (await txt('#iSteps')) === stepsAtNpc, await txt('#iSteps'))
  }

  // 图鉴：未持有 -> 提示；持有 -> 浮层列出本层「所有」怪物类型（含已清除）
  check('图鉴浮层初始隐藏', (await hidden('#codexLayer')) === true)
  await click('#btnActCodex')
  check('未持有图鉴时点击给提示', (await hidden('#codexLayer')) === true && (await txt('#log')).includes('还没有图鉴'), await txt('#log'))
  await setVal('#saveInput', '3|0,1,1,200,10,10,0,0,0,0,0,0,0,1||0'); await accept('#btnImport')
  await click('#btnActCodex')
  check('持有图鉴可打开浮层', (await hidden('#codexLayer')) === false)
  check('图鉴标题来自 texts.js', (await txt('#codexTitle')).includes('图鉴'), await txt('#codexTitle'))
  check('图鉴副标题标注「所有怪物类型」', (await txt('#codexSub')).includes('所有'), await txt('#codexSub'))
  check('v0.9 图鉴副标题含本层主题', (await txt('#codexSub')).includes(MAP.f0name), await txt('#codexSub'))
  check('v0.9 图鉴数值 = scaledMon 本层实际值', await ev(`(async()=>{
    const t = await import('./tables.js'); const l = await import('./logic.js');
    const rows = t.FLOORS[0].rows;
    const want = [...new Set(rows.join('').split('').filter(c => t.monsterByCh(c)))]
      .map(c => { const m = l.scaledMon(t.monsterByCh(c), 0); return m.hp+'/'+m.atk+'/'+m.def });
    const got = [...document.querySelectorAll('#codexList .cstat')].map(e => e.textContent);
    return want.length > 0 && want.every(w => got.includes(w));
  })()`))
  check('v0.9 图鉴徽章带怪物手册 tooltip',
    await ev("[...document.querySelectorAll('#codexList .cbadge')].some(b => ['每 +1 防少掉','少挨一回合','真实伤害'].some(k => (b.title || '').includes(k)))"))
  const codexRowsAll = await ev("document.querySelectorAll('#codexList .codex-row').length")
  check('图鉴列出本层怪物条目', codexRowsAll > 0, codexRowsAll)
  check('图鉴列出本层「配置过的全部」类型（不只是存活）',
    codexRowsAll === MAP.codexMon.types.length,
    codexRowsAll + ' 行 / 配置 ' + MAP.codexMon.types.length + ' 类')
  const cstat = await ev("document.querySelector('#codexList .cstat').textContent")
  check('图鉴条目含 HP/攻/防 三段数值', /^\d+\/\d+\/\d+$/.test(cstat || ''), cstat)
  check('图鉴条目含战斗预测徽章', await ev("!!document.querySelector('#codexList .cbadge.ok, #codexList .cbadge.no')"))
  await key('Escape')
  check('Esc 可关图鉴', (await hidden('#codexLayer')) === true)

  // v0.9 口径回归：用 opened 变更集清掉本层某一类怪，验证它仍列在图鉴里并标「已清除」
  // 1F 每类怪恰好 1 只，清掉下标即可让该类型存活数归零（下标由 MAP 探测现算）
  const clearCh = MAP.codexMon.types[0]
  const clearIdx = MAP.codexMon.firstMon[clearCh].idx
  await setVal('#saveInput', '3|0,1,1,200,10,10,0,0,0,0,0,0,0,1|0:' + clearIdx + '|0'); await accept('#btnImport')
  await click('#btnActCodex')
  const codexRowsCleared = await ev("document.querySelectorAll('#codexList .codex-row').length")
  check('清掉一只怪后图鉴仍列出全部类型', codexRowsCleared === MAP.codexMon.types.length,
    codexRowsCleared + ' 行 / 配置 ' + MAP.codexMon.types.length + ' 类')
  const clearedRow = await ev("(()=>{const r=[...document.querySelectorAll('#codexList .codex-row.cleared')];return {n:r.length, badge:r[0]?.querySelector('.cbadge')?.textContent||'', stat:r[0]?.querySelector('.cstat')?.textContent||''}})()")
  check('被清掉的类型标为「已清除」且置灰', clearedRow.n === 1 && clearedRow.badge === '已清除', JSON.stringify(clearedRow))
  check('已清除条目仍保留 HP/攻/防 三段数值', /^\d+\/\d+\/\d+$/.test(clearedRow.stat), clearedRow.stat)
  check('存活类型仍显示战斗预测徽章', await ev("!!document.querySelector('#codexList .codex-row:not(.cleared) .cbadge.ok, #codexList .codex-row:not(.cleared) .cbadge.no')"))
  await key('Escape')
  check('清怪后图鉴可关闭', (await hidden('#codexLayer')) === true)

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
  check('通关前存档落在顶层', (await txt('#iPos')).includes(FLOOR_N + 'F'), await txt('#iPos'))
  check('导入外部存档本身不写记录', (await ev("localStorage.getItem('mota_lite_web_records_v1')")) === null)
  await key(KEYMAP[PREWIN.dir])
  check('正常游玩通关写入记录', (await ev("JSON.parse(localStorage.getItem('mota_lite_web_records_v1') || '{}').wins")) === 1)
  check('记录 UI 同步次数与步数', (await txt('#recWins')) === '1' && (await txt('#recMinSteps')) === '1 步',
    await txt('#recWins') + ' / ' + await txt('#recMinSteps'))
  check('通关记录不塞进存档串', !(await txt('#savePreview')).includes('wins'))

  // ---- N 点击空地与相机 ----
  await accept('#btnRestart')
  check('重开步数归零', (await txt('#iSteps')) === '0')
  await cellClick(MAP.free1.idx)
  await sleep(400)
  check('点击相邻空格走一步', (await txt('#iSteps')) === '1', await txt('#iPos'))
  await accept('#btnRestart')
  await cellClick(MAP.free2.idx)
  await sleep(900)
  check('点击远格自动寻路 2 步', (await txt('#iSteps')) === '2', await txt('#iPos'))
  check('英雄落在目标格', (await txt('#iPos')).includes(`(${MAP.free2.x},${MAP.free2.y})`), await txt('#iPos'))
  const stepsBeforeSelf = await txt('#iSteps')
  await cellClick(MAP.free2.idx)
  await sleep(250)
  check('点自己所在格不移动', (await txt('#iSteps')) === stepsBeforeSelf, await txt('#iSteps'))
  check('相机把英雄保持在视口内', await ev("(()=>{const v=document.querySelector('#viewport').getBoundingClientRect();const h=document.querySelector('.cell.is-hero').getBoundingClientRect();return h.left>=v.left-1&&h.right<=v.right+1&&h.top>=v.top-1&&h.bottom<=v.bottom+1})()"))
  // 真正要守的回归：英雄离开出生点后，那格必须变回地板精灵，不能残留第二个英雄
  const spawnAfter = await ev(`(async()=>{
    const a = await fetch('./assets/sprites.json').then(r=>r.json());
    return { pos: document.querySelectorAll('.cell')[${MAP.spawn.idx}].style.backgroundPosition,
      floor: '-'+a.frames.floor.x+'px '+(-a.frames.floor.y)+'px',
      hero: '-'+a.frames.hero_a.x+'px '+(-a.frames.hero_a.y)+'px' };
  })()`)
  check('英雄走开后出生点画地板而非英雄', spawnAfter.pos === spawnAfter.floor && spawnAfter.pos !== spawnAfter.hero,
    spawnAfter.pos + ' / ' + spawnAfter.floor)
  check('英雄走开后仍只有 1 个 is-hero', await ev("document.querySelectorAll('.cell.is-hero').length") === 1)

  // ---- O 二次确认弹窗 / 新游戏入口族（单槽覆盖语义）----
  const SAVE_O_BASE = '3|0,1,1,999,50,50,0,0,0,0,0,0,0,0||0'
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

  // 确认期间输入互斥：点一个确定可走的相邻空格，确认框打开时不应推进
  await click('#btnActNewGame')
  check('屏幕内新游戏按钮也能弹确认', (await hidden('#confirmLayer')) === false)
  await key('ArrowUp')
  check('确认期间键盘方向键不生效', (await txt('#iSteps')) === '0', await txt('#iSteps'))
  await cellClick(MAP.free1.idx)
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
  await setVal('#saveInput', '3|2,1,1,888,50,50,0,0,0,0,0,0,0,0||0.1.2'); await click('#btnImport')
  check('载入存档弹确认且正文含覆盖',
    (await hidden('#confirmLayer')) === false && (await txt('#confirmBody')).includes('覆盖'))
  check('载入确认正文含存档串摘要', (await txt('#confirmBody')).includes('3|2,1,1'), await txt('#confirmBody'))
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
  await setVal('#saveInput', '3|' + TOP_SAVE + ',3,4,96,20,13,0,0,0,0,2,0,0,0||' + TOP_SAVE); await accept('#btnImport')
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

  // ---- v0.10 设置持久化：真实刷新浏览器后仍保持（用户原话场景）----
  const SETK = 'mota_lite_web_settings_v1'
  await ev(`localStorage.removeItem('${SETK}')`)
  if (!(await ev("document.querySelector('#btnSound').classList.contains('on')"))) await click('#btnSound')
  await click('#btnSound')   // 开 -> 关
  check('关音效后写入独立设置 key',
    await ev(`(()=>{const o=JSON.parse(localStorage.getItem('${SETK}')||'null');return !!o && o.sound===false})()`))
  if (await ev("document.querySelector('#btnSprite').classList.contains('on')")) await click('#btnSprite')
  if (await ev("document.querySelector('#btnAnim').classList.contains('on')")) await click('#btnAnim')
  await ev(`document.querySelector('.speed-row button[data-speed="160"]').click()`)
  await ev(`document.querySelector('.zoom-row button[data-zoom="1.5"]').click()`)
  check('设置 key 存了 5 项（音效/像素图/动画/速度/缩放）',
    await ev(`(()=>{const o=JSON.parse(localStorage.getItem('${SETK}'));return !!o && o.sound===false && o.sprite===false && o.anim===false && o.speed===160 && o.zoom==='1.5'})()`),
    await ev(`localStorage.getItem('${SETK}')`))
  const saveBeforeReload = await ev("localStorage.getItem('mota_lite_web_v1')")
  // reload 是异步的：旧上下文里 #log 也含「就绪」，会让 waitFor 过早返回，
  // 后续断言跑到新页面脚本执行前的初始 DOM 上。用「旧页面标记消失 + 版本徽章已注入」
  // 作为新上下文真正就绪的信号（renderVersion 在 injectTexts 之后调用）。
  await ev('window.__v10ReloadMark = 1')
  await send('Page.reload', { ignoreCache: true })
  await send('Runtime.enable')
  await waitFor("!window.__v10ReloadMark && document.querySelector('#titleVersion') && /^v\\d/.test(document.querySelector('#titleVersion').textContent)", 15000)
  check('刷新后音效仍关闭（关了音效刷新应还是关闭）',
    await ev("document.querySelector('#btnSound').textContent.includes('静音') && !document.querySelector('#btnSound').classList.contains('on')"),
    await txt('#btnSound'))
  check('刷新后像素图 / 战斗动画仍关闭',
    await ev("!document.querySelector('#btnSprite').classList.contains('on') && !document.querySelector('#btnAnim').classList.contains('on')"))
  check('刷新后回放速度仍为 160 ms', (await txt('#speedInfo')).includes('160'), await txt('#speedInfo'))
  check('刷新后缩放仍为 1.5×',
    await ev(`document.querySelector('#device').style.zoom === '1.5' && document.querySelector('.zoom-row button[data-zoom="1.5"]').classList.contains('on')`))
  check('刷新后设置浮层文案同步', (await txt('#setSound')).includes('静音'), await txt('#setSound'))
  check('刷新不污染游戏存档串（设置独立 key）',
    (await ev("localStorage.getItem('mota_lite_web_v1')")) === saveBeforeReload)
  check('冷启动不会凭空产生设置 key 之外的存档字段',
    await ev(`(()=>{const o=JSON.parse(localStorage.getItem('${SETK}'));return Object.keys(o).sort().join(',')==='anim,sound,speed,sprite,zoom'})()`))

  // ---- v0.10 门阻挡：运行期推导坐标 + 真实点击 ----
  const GATE = await ev(`(async()=>{
    const t = await import('./tables.js'), l = await import('./logic.js');
    const rows = t.FLOORS[0].rows, D = ['Y','B','R','G'];
    let gate = null;
    rows.forEach((r,y)=>[...r].forEach((c,x)=>{ if (D.includes(c)) gate = { x, y, c } }));
    const W = rows[0].length;
    let stand = null;
    for (const [dx,dy,dir] of [[0,1,'up'],[0,-1,'down'],[-1,0,'right'],[1,0,'left']]) {
      const sx = gate.x+dx, sy = gate.y+dy, ch = rows[sy][sx];
      if (ch !== '#' && !l.isEntityTile(ch)) { stand = { x: sx, y: sy, dir }; break }
    }
    return { gate, stand, W, key: t.DOOR_KEY[gate.c] };
  })()`)
  check('1F 门与门口可站格运行期推导成功', !!GATE.gate && !!GATE.stand, JSON.stringify(GATE))
  check('21 层门结构与三色/铁门分级（运行期从 tables.js 推导）', await ev(`(async()=>{
    const t = await import('./tables.js'), D = ['Y','B','R','G'];
    return t.FLOORS.every((f,i)=>{
      const n=i+1, ds=[];
      f.rows.forEach((r,y)=>[...r].forEach((c,x)=>{ if (D.includes(c)) ds.push({c,x,y}) }));
      const want = (n===7||n===14||n===21)?'G':(n<=7?'Y':(n<=14?'B':'R')), isRoom = f.rows[3].slice(3,10)==='#######';
      let at = false;
      if (n===21) at = ds.length===1 && ds[0].x===6 && ds[0].y===6 && f.rows[5][5]==='#' && f.rows[5][7]==='#';
      else if (isRoom) at = ds.length===1 && ds[0].x===6 && ds[0].y===8;
      else { const a=f.rows[13][10], b=f.rows[12][11];
             at = ds.length===1 && ((a==='#'&&D.includes(b))||(b==='#'&&D.includes(a))) && f.rows[13][11]==='U'; }
      return ds.length===1 && ds[0].c===want && at;
    });
  })()`))
  const gateIdx = GATE.gate.y * GATE.W + GATE.gate.x
  const saveAtGate = ky => `3|0,${GATE.stand.x},${GATE.stand.y},200,10,10,0,${ky},0,0,0,0,0,0||0`
  const tileNow = () => ev(`(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return l.tileAt(s,${GATE.gate.x},${GATE.gate.y})})()`)
  await setVal('#saveInput', saveAtGate(0)); await accept('#btnImport')
  check('未开门时点击寻路到上楼格不可达', await ev(`(async()=>{
    const l=await import('./logic.js'), m=await import('./solver.js');
    const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));
    return m.findPath(s,new Set(['11,13']),{blockEntities:true}).path===null;
  })()`))
  await cellClick(gateIdx)
  check('无钥匙点门：提示「缺少钥匙」且门还在',
    ((await txt('#log')).includes('缺少钥匙') || (await txt('#tip')).includes('缺少钥匙')) && (await tileNow()) === GATE.gate.c,
    await tileNow())
  await setVal('#saveInput', saveAtGate(1)); await accept('#btnImport')
  await cellClick(gateIdx)
  check('有钥匙点门：门已打开、变地板、扣 1 把对应钥匙',
    (await tileNow()) === '.' &&
    await ev(`(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return s.hero.keys['${GATE.key}']===0})()`),
    await tileNow())
  check('点门日志出现「门已打开」',
    (await txt('#log')).includes('门已打开') || (await txt('#tip')).includes('门已打开'))
  check('开门后点击模式可到上楼格', await ev(`(async()=>{
    const l=await import('./logic.js'), m=await import('./solver.js');
    const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));
    return m.findPath(s,new Set(['11,13']),{blockEntities:true}).path!==null;
  })()`))


  // ---- v0.11 交互停原地：真实点击链路（怪物 / 门），坐标运行期推导 ----
  const V11 = await ev(`(async()=>{
    const t=await import('./tables.js'), l=await import('./logic.js');
    const rows=t.FLOORS[0].rows, W=rows[0].length;
    const dirFrom=(sx,sy,tx,ty)=> tx>sx?'right':tx<sx?'left':ty>sy?'down':'up';
    let mon=null, gate=null;
    for(let y=0;y<rows.length;y++)for(let x=0;x<W;x++){
      const ch=rows[y][x], m=t.monsterByCh(ch), need=t.DOOR_KEY[ch];
      for(const [dx,dy] of [[0,1],[0,-1],[1,0],[-1,0]]){
        const sx=x+dx, sy=y+dy;
        if(sx<0||sy<0||sx>=W||sy>=rows.length) continue;
        const sc=rows[sy][sx]; if(sc!=='.'&&sc!=='@') continue;
        const e={x,y,sx,sy,dir:dirFrom(sx,sy,x,y),idx:y*W+x,ch};
        if(m&&!mon) mon=e;
        if(need&&!gate) gate=e;
      }
    }
    return {mon,gate,key: gate?t.DOOR_KEY[gate.ch]:null, W};
  })()`)
  check('v0.11 推导 1F 怪物 / 门交互场景', !!V11.mon && !!V11.gate, JSON.stringify(V11))
  const xyIn = async (x, y) => (await txt('#iPos')).includes(`(${x},${y})`)
  if (V11.mon) {
    // 高属性存档保证战斗必胜，英雄站在怪物相邻格；head 14 字段 v3 存档
    const monSave = `3|0,${V11.mon.sx},${V11.mon.sy},9999,9999,9999,0,0,0,0,0,0,0,0||0`
    await setVal('#saveInput', monSave); await accept('#btnImport')
    await cellClick(V11.mon.idx)
    const won = await waitFor("document.querySelector('#tip').textContent.includes('胜 ')", 10000)
    check('v0.11 点怪物触发战斗胜利（原地交互仍有胜利结算）', won, await txt('#tip'))
    check('v0.11 击败怪物后英雄停在原地（不踩进怪格）',
      (await xyIn(V11.mon.sx, V11.mon.sy)) && !(await xyIn(V11.mon.x, V11.mon.y)), await txt('#iPos'))
    check('v0.11 怪格清成地板', (await ev(`(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return l.tileAt(s,${V11.mon.x},${V11.mon.y})})()`)) === '.')
    await sleep(300)
    await cellClick(V11.mon.idx)   // 原怪格已是地板，再点一次才走过去
    await sleep(200)
    check('v0.11 再走一步才进入原怪格', await xyIn(V11.mon.x, V11.mon.y), await txt('#iPos'))
  }
  if (V11.gate) {
    const ky = V11.key==='y'?1:0, kb = V11.key==='b'?1:0, kr = V11.key==='r'?1:0
    const gateSave = `3|0,${V11.gate.sx},${V11.gate.sy},200,10,10,0,${ky},${kb},${kr},0,0,0,0||0`
    await setVal('#saveInput', gateSave); await accept('#btnImport')
    await cellClick(V11.gate.idx)
    await sleep(200)
    check('v0.11 门仍开门即进入（通道语义不变）', await xyIn(V11.gate.x, V11.gate.y), await txt('#iPos'))
  }

  // ---- v0.12 大字号适配手环屏：真实 computedStyle，不读 CSS 文本 ----
  await ev("document.getElementById('device').style.zoom = '1'")
  const FS = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return e?parseFloat(getComputedStyle(e).fontSize):0})()`)
  const fontRows = [
    ['.action-btn', 14], ['.action-hint', 12], ['.tip', 15], ['.cell-ch', 16],
    ['.hud', 14], ['.hud-row-title', 15], ['.statusbar', 13],
    ['.story-title', 17], ['.story-body', 14], ['.story-continue', 15],
    ['.settings-title', 17], ['.settings-item', 15], ['.codex-close', 15],
    ['.confirm-title', 17], ['.confirm-body', 14], ['.confirm-ok', 15],
    ['.over-title', 28], ['.over-sub', 16], ['.over-btn', 16]
  ]
  const fontBad = []
  for (const [sel, min] of fontRows) {
    const v = await FS(sel)
    if (!(v >= min)) fontBad.push(sel + ':' + v + '<' + min)
  }
  check('v0.12 屏幕内 19 处文本全部达到新字号下限（按钮 14px 起）',
    fontBad.length === 0, fontBad.join(' ') || '19 处全达标')
  check('v0.12 按钮区改 3 列 × 3 行（56px 宽容纳 14px 字）', await ev(
    "(()=>{const s=getComputedStyle(document.querySelector('.action-bar'));return s.gridTemplateColumns.split(' ').length===3&&s.gridTemplateRows.split(' ').length===4})()"))
  check('v0.12 按钮区仍在 520px 屏幕内（top402 + 3×29 + 提示行）', await ev(
    "(()=>{const b=document.querySelector('.action-bar');return parseFloat(getComputedStyle(b).top)+b.offsetHeight<=520})()"))

  // ---- v0.12 暗门 A：真实点击「撞墙显形」 ----
  const SC = MAP.secret1f
  check('v0.12 1F 暗门与相邻可站格运行期推导成功', !!SC && !!SC.story && !!SC.item, JSON.stringify(SC))
  if (SC) {
    await setVal('#saveInput', `3|0,${SC.sx},${SC.sy},200,10,10,0,0,0,0,0,0,0,0||0`); await accept('#btnImport')
    check('v0.12 暗门视觉与墙完全一致（精灵表复用 wall 帧）', await ev(`(async()=>{
      const a=await (await fetch('./assets/sprites.json')).json();
      return a.tileMap.A===a.tileMap['#'] && a.tileMap.A==='wall';
    })()`))
    await cellClick(SC.idx)
    await sleep(220)
    check('v0.12 撞暗门：停在原地（不踩进墙格）',
      (await xyIn(SC.sx, SC.sy)) && !(await xyIn(SC.x, SC.y)), await txt('#iPos'))
    check('v0.12 撞暗门：提示「撞开暗门」且墙格清成地板',
      (await txt('#tip')).includes('撞开暗门') &&
      (await ev(`(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return l.tileAt(s,${SC.x},${SC.y})})()`)) === '.', await txt('#tip'))
    check('v0.12 撞暗门：墙后黄钥匙按 SECRET 生效', await ev(`(async()=>{
      const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));
      return ${JSON.stringify(SC.item)}==='key_y' ? s.hero.keys.y===1 : true;
    })()`))
    check('v0.12 撞暗门弹出短剧情文本框', (await hidden('#storyLayer')) === false)
    await closeStory()
    await cellClick(SC.idx)
    await sleep(220)
    check('v0.12 撞开后再点一次才进入原墙格', await xyIn(SC.x, SC.y), await txt('#iPos'))
  }

  // ---- v0.12 铁门 G：3 把黄钥匙门槛 ----
  const IR = MAP.iron
  check('v0.12 铁门与相邻可站格运行期推导成功（7F）', !!IR, JSON.stringify(IR))
  if (IR) {
    const tileIron = () => ev(`(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return l.tileAt(s,${IR.x},${IR.y})})()`)
    const keyYNow = () => ev("(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return s.hero.keys.y})()")
    // v3 head 恰好 14 段：floor,x,y,hp,atk,def,gold,ky,kb,kr,e,fly,bomb,book
    const ironSave = ky => `3|${IR.floor},${IR.sx},${IR.sy},200,10,10,0,${ky},0,0,0,0,0,0||${IR.floor}`
    await setVal('#saveInput', ironSave(2)); await accept('#btnImport')
    await cellClick(IR.idx)
    await sleep(200)
    check('v0.12 2 把黄钥匙撞铁门：提示需 3 把、门不动、钥匙不扣',
      (await txt('#tip')).includes('铁门需要 3 把') && (await tileIron()) === 'G' && (await keyYNow()) === 2,
      await txt('#tip'))
    await setVal('#saveInput', ironSave(3)); await accept('#btnImport')
    await cellClick(IR.idx)
    await sleep(200)
    check('v0.12 3 把黄钥匙撞铁门：开启、扣 3 把、变地板',
      (await tileIron()) === '.' && (await keyYNow()) === 0 &&
      ((await txt('#tip')).includes('铁门开启') || (await txt('#log')).includes('铁门开启')),
      await txt('#tip'))
  }

  // ---- v0.12 商店第四项：真实点「黄钥匙」 ----
  const SP2 = MAP.shop
  await setVal('#saveInput', `3|${SP2.floor},${SP2.x},${SP2.y},200,10,10,20,0,0,0,0,0,0,0||${SP2.floor}`); await accept('#btnImport')
  await cellClick(SP2.sy * MAP.W + SP2.sx)
  const keyShopOpen = await waitFor("(()=>{const l=document.querySelector('#storyLayer');return l&&!l.hidden&&document.querySelectorAll('#storyActions button').length===5})()", 10000)
  check('v0.12 商店弹层 5 个动作（四商品 + 离开）', keyShopOpen)
  if (keyShopOpen) {
    check('v0.12 第四项标签是黄钥匙 +1（20G）', await ev(
      "document.querySelectorAll('#storyActions button')[3].textContent.includes('黄钥匙')"))
    await ev("document.querySelectorAll('#storyActions button')[3].click()")
    await sleep(180)
    check('v0.12 买黄钥匙：keys.y +1 且金币清零',
      (await ev("(async()=>{const l=await import('./logic.js');const s=l.deserialize(localStorage.getItem('mota_lite_web_v1'));return s.hero.keys.y})()")) === 1 &&
      (await txt('#iGold')) === '0', await txt('#iGold'))
    check('v0.12 购买后弹层关闭', (await hidden('#storyLayer')) === true)
  }

  // ---- v0.12 配置层：DOOR_COST / SECRET / 铁门数量 ----
  check('v0.12 DOOR_COST：普通门 1 把 / 铁门 3 把', await ev(`(async()=>{
    const t=await import('./tables.js');
    return t.DOOR_COST.G===3&&t.DOOR_COST.Y===1&&t.DOOR_COST.B===1&&t.DOOR_COST.R===1&&t.DOOR_KEY.G==='y';
  })()`))
  check('v0.12 SECRET 21 处 / 铁门恰好 3 道',
    MAP.secretCfgCount === 21 &&
    await ev(`(async()=>{const t=await import('./tables.js');return t.FLOORS.reduce((n,f)=>n+f.rows.join('').split('G').length-1,0)})()`) === 3,
    MAP.secretCfgCount + ' 处暗门')

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
