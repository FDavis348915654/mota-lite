// tools/validate_view.js —— 视图层离线契约校验（不需要 AIoT-IDE / 真机）
//
// 做法：把 index.ux 的 <script> 段抽出来，剥掉 import、把 `export default` 换成 `return`，
//       用 new Function 注入真实的 logic.js / tables.js 和 mock 的 @system.* 模块，
//       然后按 Vela 生命周期顺序在 node 里调用，断言「视图只反映 state」这条契约。
// 验的是 index.ux 里真实的那份代码，不是复制品；本脚本不进 rpk。

import fs from 'node:fs'
import assert from 'node:assert/strict'
import * as logic from '../src/common/logic.js'
import { FLOORS } from '../src/common/tables.js'
import { findSolution } from './solver.js'

let pass = 0
function ok(cond, label) {
  assert.ok(cond, '✗ ' + label)
  console.log('  ✓ ' + label)
  pass++
}
function eq(a, b, label) {
  assert.deepEqual(a, b, '✗ ' + label + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a))
  console.log('  ✓ ' + label + ' = ' + JSON.stringify(a))
  pass++
}

const SAVE_KEY = 'mota_lite_save_v1'
const ux = fs.readFileSync(new URL('../src/pages/index/index.ux', import.meta.url), 'utf8')

console.log('\n[0] .ux 三段式与模板静态检查')
ok(/<template>[\s\S]*?<\/template>/.test(ux), 'index.ux 有 template 段')
ok(/<script>[\s\S]*?<\/script>/.test(ux), 'index.ux 有 script 段')
ok(/<style>[\s\S]*?<\/style>/.test(ux), 'index.ux 有 style 段')
const tpl = ux.match(/<template>([\s\S]*?)<\/template>/)[1]
const script = ux.match(/<script>([\s\S]*?)<\/script>/)[1]
ok(/@swipe="onSwipe"/.test(tpl), '根节点绑定 @swipe')
ok(!/<(scroll|list)\b/.test(tpl), '未使用 scroll/list（官方：有滚动条时 swipe 不触发）')
ok(/<block for="c in cells">/.test(tpl), '固定槽位用 <block for>')
eq((tpl.match(/class="cell"/g) || []).length, 1, 'cell 模板只有 1 处（定长数组渲染）')
ok(tpl.indexOf('class="hero"') > tpl.indexOf('class="cell"'), 'hero 写在格子之后（DOM 顺序定层级）')
ok(tpl.indexOf('class="over"') > tpl.indexOf('class="hero"'), 'over 遮罩写在最后')
const css = ux.match(/<style>([\s\S]*?)<\/style>/)[1]
ok(css.indexOf('z-index') < 0, 'style 段未使用 Vela 不支持的 z-index')
for (const k of ['cells', 'hud', 'tip', 'heroX', 'heroY', 'ended', 'endTitle', 'endSub']) {
  ok(new RegExp('\\b' + k + '\\s*:').test(script), 'data 声明了 ' + k)
}
ok(!/@system\./.test(script.replace(/^\s*import\s+.*$/gm, '')), 'script 里除 import 外无裸 @system 调用')

// ---- 构造一个可在 node 里运行的页面实例 ----
const scriptCode = script
  .replace(/^\s*import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
  .replace(/export\s+default\s*/, 'return ')

const factory = new Function(
  'CONFIG', 'newGame', 'resolveStep', 'buildCells', 'serialize', 'deserialize',
  'FLOORS', 'brightness', 'vibrator', 'storage', 'console', 'Date',
  scriptCode
)

function makeEnv(initial) {
  const store = new Map(initial || [])
  const writes = []
  const vibs = []
  const logs = []
  const clock = { t: 1000 }
  const storage = {
    get(o) {
      const v = store.has(o.key) ? store.get(o.key) : (o.default !== undefined ? o.default : '')
      if (o.success) o.success(v)
    },
    set(o) {
      if (o.value === '') store.delete(o.key)
      else store.set(o.key, o.value)
      writes.push({ key: o.key, value: o.value })
      if (o.success) o.success()
    }
  }
  const brightness = { setKeepScreenOn: () => logs.push('keepScreenOn') }
  const vibrator = { vibrate: () => vibs.push(clock.t) }
  const ctrl = factory(
    logic.CONFIG, logic.newGame, logic.resolveStep, logic.buildCells,
    logic.serialize, logic.deserialize, FLOORS,
    brightness, vibrator, storage,
    { log: (m) => logs.push(m) }, { now: () => clock.t }
  )
  Object.assign(ctrl, ctrl.data)   // 模拟 Vela 把 data 平铺到页面实例
  return { ctrl, store, writes, vibs, logs, clock }
}

console.log('\n[1] 冷启动：无存档 -> newGame + 常亮 + 63 槽位')
const e1 = makeEnv()
const c1 = e1.ctrl
c1.onInit()
c1.onShow()
ok(c1.state !== null, 'onShow 后 state 已就绪')
eq(c1.state.floor, 0, '起始楼层')
eq(c1.cells.length, 63, 'cells 定长 63')
ok(/^1F\s+HP200/.test(c1.hud), 'HUD 显示 1F / HP200 = ' + c1.hud)
eq(c1.ended, false, '初始无结束遮罩')
ok(e1.logs.indexOf('keepScreenOn') >= 0, 'onShow 调用了 setKeepScreenOn')

console.log('\n[2] 普通走格不写盘；关键节点才写盘')
const w0 = e1.writes.length
c1.onSwipe({ direction: 'right' })       // (1,7) -> (2,7) 地板
eq(c1.state.x, 2, '向右走一格')
eq(e1.writes.length, w0, '普通走格 0 次写盘')
eq(c1.cells.length, 63, '走格后 cells 仍定长 63')
c1.onSwipe({ direction: 'left' })        // 回到 (1,7)
eq(e1.writes.length, w0, '再走一格仍 0 次写盘')
c1.onSwipe({ direction: 'up' })          // (1,6) = 黄钥匙 y
eq(c1.state.hero.keys.y, 1, '拾取黄钥匙')
eq(e1.writes.length, w0 + 1, '拾取触发恰好 1 次写盘')
ok(/Y1/.test(c1.hud), 'HUD 更新为 Y1 = ' + c1.hud)
const saved = e1.writes[e1.writes.length - 1].value
ok(Buffer.byteLength(saved, 'utf8') < logic.CONFIG.SAVE_LIMIT, '存档 ' + Buffer.byteLength(saved, 'utf8') + 'B < 128B')
eq(logic.deserialize(saved).hero.keys.y, 1, '写盘内容可被 deserialize 还原')
eq(logic.tileAt(c1.state, 1, 6), '.', '拾取后该格变地板（变更集生效）')

console.log('\n[3] onShow 幂等 + onHide 兜底写盘')
const st = c1.state
c1.onShow()
ok(c1.state === st, '重复 onShow 不重建 state（不丢进度）')
c1.onHide()
ok(e1.writes.length >= w0 + 2, 'onHide 补写一次存档')

console.log('\n[4] 读档恢复：属性 / 坐标 / 变更集 / HUD')
const e4 = makeEnv([[SAVE_KEY, saved]])
const c4 = e4.ctrl
c4.onInit(); c4.onShow()
eq([c4.state.x, c4.state.y], [1, 6], '坐标从存档恢复')
eq(c4.state.hero.keys.y, 1, '钥匙数从存档恢复')
eq(logic.tileAt(c4.state, 1, 6), '.', '变更集从存档恢复，道具不会复活')
eq(c4.cells.length, 63, '读档后 cells 仍定长 63')
ok(/Y1/.test(c4.hud), '读档后 HUD 正确 = ' + c4.hud)

console.log('\n[5] 坏档回退 newGame，不炸冷启动')
const c5 = makeEnv([[SAVE_KEY, '{bad json']]).ctrl
c5.onInit(); c5.onShow()
eq(c5.state.floor, 0, '坏档回到 1F')
eq(c5.state.hero.keys.y, 0, '坏档回到初始属性')
for (const bad of ['', '1|0,1,7,200,10,10,0,0,0,0', '2|0,1,7,200,10,10,0,0,0,0,0|', '1|9,1,7,200,10,10,0,0,0,0,0|']) {
  eq(logic.deserialize(bad), null, '非法存档安全返回 null：' + JSON.stringify(bad))
}

console.log('\n[6] 通关全流程：26 步喂进 onSwipe，遮罩由 state 驱动')
const sol = findSolution()
ok(!!sol, 'BFS 找到通关路径（展开 ' + (sol ? sol.expanded : 0) + ' 个状态）')
const e6 = makeEnv()
const c6 = e6.ctrl
c6.onInit(); c6.onShow()
sol.steps.forEach(d => c6.onSwipe({ direction: d }))
eq(sol.steps.length, 26, '最短通关步数')
eq(c6.state.ended, 'win', '通关态写入 state')
eq(c6.ended, true, '结束遮罩出现')
eq(c6.endTitle, '通关', '结束标题')
eq(c6.cells.length, 63, '通关后 cells 仍定长 63（节点数恒定）')
ok(e6.writes.length > 0, '通关路径产生了写盘')
c6.onSwipe({ direction: 'left' })
eq(c6.state.ended, 'win', '通关后输入被忽略')

console.log('\n[7] 读档到「已通关」存档时遮罩仍能复原')
const e7 = makeEnv([[SAVE_KEY, logic.serialize(sol.state)]])
const c7 = e7.ctrl
c7.onInit(); c7.onShow()
eq(c7.ended, true, '遮罩由 state.ended 渲染，不依赖事件')
eq(c7.endTitle, '通关', '结束标题正确')

console.log('\n[8] restart 重开：清档 / 遮罩消失 / cells 复位')
c7.restart()
eq(c7.ended, false, '遮罩消失')
eq(c7.state.floor, 0, '回到 1F')
eq(c7.state.hero.hp, 200, '属性复位')
eq(e7.writes[e7.writes.length - 1].value, logic.serialize(c7.state), '立刻写入新档，不会读回旧档')
eq(c7.cells.length, 63, '重开后 cells 仍定长 63')

console.log('\n[9] 振动节流（间隔 >= 300ms）')
const e9 = makeEnv()
const c9 = e9.ctrl
c9.onInit(); c9.onShow()
c9.vibrate()
c9.vibrate()
eq(e9.vibs.length, 1, '同一时刻连振被合并为 1 次')
e9.clock.t += logic.CONFIG.VIBRATE_GAP
c9.vibrate()
eq(e9.vibs.length, 2, '超过间隔后可再振')

console.log('\n视图层契约全部 ' + pass + ' 项断言通过。\n')
