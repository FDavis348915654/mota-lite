#!/usr/bin/env node
// 资源完整性离线校验：精灵 atlas 覆盖 / 文案 key 齐全 / 音频与动画文件有效 / 清单一致。
// 用法：node tools/validate_assets.mjs
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { FLOORS, MONSTERS, ITEMS, HIDDEN, SECRET } from '../tables.js'
import { TEXTS } from '../texts.js'
import { VERSION } from '../version.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(path.join(root, f))
const readText = f => read(f).toString('utf8')
const has = f => existsSync(path.join(root, f))

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); pass++ }
  else { console.error('  ✗ ' + name + (detail ? '  -> ' + detail : '')); fail++ }
}

console.log('=== 1. 资源清单 ===')
ok('assets/manifest.json 存在', has('assets/manifest.json'))
const man = JSON.parse(readText('assets/manifest.json'))
ok('清单版本号与 version.js 一致', man.version === VERSION.replace(/^v/, ''), man.version + ' / ' + VERSION)
ok('生成脚本可复现', has('tools/gen_assets.py'))
ok('清单层数与 FLOORS 同源', man.levels && man.levels.floors === FLOORS.length,
  (man.levels && man.levels.floors) + ' / ' + FLOORS.length)

console.log('\n=== 2. 精灵表与 atlas ===')
ok('sprites.png 存在', has('assets/sprites.png'))
ok('sprites.json 存在', has('assets/sprites.json'))
const atlas = JSON.parse(readText('assets/sprites.json'))
const png = read('assets/sprites.png')
ok('sprites.png 是 PNG', png.slice(1, 4).toString() === 'PNG', png.length + ' B')
// PNG IHDR 宽高（大端）
const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20)
ok('PNG 尺寸与 atlas 声明一致', pw === atlas.width && ph === atlas.height, pw + 'x' + ph)
ok('atlas 帧数 = count', Object.keys(atlas.frames).length === atlas.count, atlas.count + ' 帧')
ok('每帧坐标在画布内', Object.values(atlas.frames).every(f =>
  f.x >= 0 && f.y >= 0 && f.x + f.w <= atlas.width && f.y + f.h <= atlas.height && f.w === atlas.tile && f.h === atlas.tile))
// 地图里实际出现的每个 tile 字符都要有精灵
const used = new Set()
FLOORS.forEach(f => f.rows.forEach(r => { for (const c of r) used.add(c) }))
const missing = [...used].filter(c => !atlas.tileMap[c] || !atlas.frames[atlas.tileMap[c]])
ok('地图所有 tile 字符都有精灵映射', missing.length === 0,
  missing.length ? '缺: ' + missing.join(' ') : [...used].sort().join(' ') )
ok('英雄有两帧用于待机动画', !!atlas.frames.hero_a && !!atlas.frames.hero_b)
ok('战斗/炸弹/拾取特效帧齐全',
  !!atlas.frames.fx_hit && !!atlas.frames.fx_boom && !!atlas.frames.fx_pick)
ok('隐藏暗格精灵 = 地板精灵（视觉隐藏）', atlas.tileMap.H === 'hidden' && !!atlas.frames.hidden)
// v0.12：暗门伪装成普通砖墙（与 # 共用同一帧），铁门用独立加厚铁板帧
ok('暗门 A 精灵 = 墙精灵（视觉与墙完全一致）',
  atlas.tileMap.A === 'wall' && atlas.tileMap['#'] === 'wall' && !!atlas.frames.wall,
  String(atlas.tileMap.A))
ok('铁门 G 有独立 door_iron 帧',
  atlas.tileMap.G === 'door_iron' && !!atlas.frames.door_iron, String(atlas.tileMap.G))
// v0.6.0 回归：@ 是出生点标记而非实体，必须与 buildCells() 一样归一化成地板，
// 否则像素图模式会在英雄走开后把出生点画成第二个英雄单位。
ok('出生点 @ 归一化为地板精灵（残留单位修复）',
  atlas.tileMap['@'] === 'floor' && !!atlas.frames.floor, String(atlas.tileMap['@']))

console.log('\n=== 3. 动画资源（GIF）===')
man.animations.forEach(f => {
  ok(f + ' 存在', has(f))
  if (!has(f)) return
  const b = read(f)
  ok(f + ' 是 GIF89a', b.slice(0, 6).toString() === 'GIF89a', b.length + ' B')
  // 图形控制扩展块数量 >= 2 视为多帧；NETSCAPE 扩展视为循环
  let gce = 0
  for (let i = 0; i < b.length - 2; i++) if (b[i] === 0x21 && b[i + 1] === 0xF9) gce++
  ok(f + ' 为多帧动画', gce >= 2, gce + ' 帧')
  ok(f + ' 声明循环播放', b.includes(Buffer.from('NETSCAPE2.0')))
})

console.log('\n=== 4. 氛围插画 ===')
ok(man.illustration + ' 存在', has(man.illustration))
if (has(man.illustration)) {
  const b = read(man.illustration)
  ok('title.png 是有效 PNG', b.slice(1, 4).toString() === 'PNG', b.length + ' B')
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20)
  ok('插画尺寸适合文本框背景', w >= 300 && h >= 180, w + 'x' + h)
}

console.log('\n=== 5. 8-bit 音效 ===')
const audioDir = man.audio.dir
const audioFiles = man.audio.files
ok('音频清单条目数 = 12', audioFiles.length === 12, audioFiles.length + ' 个')
audioFiles.forEach(f => {
  const rel = audioDir + '/' + f
  ok(rel + ' 存在', has(rel))
  if (!has(rel)) return
  const b = read(rel)
  const okWav = b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE'
  ok(rel + ' 是有效 WAV', okWav, b.length + ' B')
  if (okWav) {
    const dataLen = b.length - 44
    ok(rel + ' 有音频数据', dataLen > 200, Math.round(dataLen / 22050 * 1000) + ' ms')
  }
})
const sfxValues = Object.values(TEXTS.sfx)
ok('文本里的每个音效 key 都有对应 WAV', sfxValues.every(k => audioFiles.includes(k + '.wav')),
  sfxValues.join(' '))
ok('每个 WAV 都被文本 sfx 映射引用（无孤儿资源）',
  audioFiles.every(f => sfxValues.includes(f.replace('.wav', ''))))

console.log('\n=== 6. 文本资源完整性 ===')
// v0.12：SECRET 的 story key 按奖励类型复用（21 处暗门 -> 7 段短剧情），先去重
const secretStoryKeys = [...new Set(SECRET.map(s => s.story))]
const storyKeys = [
  'intro', 'win', 'lose', 'shop', 'fly', 'bomb',
  ...FLOORS.map(f => f.story),
  ...HIDDEN.map(h => h.story),
  ...secretStoryKeys
]
const missStory = storyKeys.filter(k => !TEXTS.story[k] || !TEXTS.story[k].title || !TEXTS.story[k].body)
ok('所有剧情 key 都有 {title, body}', missStory.length === 0,
  missStory.length ? '缺: ' + missStory.join(' ') : storyKeys.length + ' 段')
ok('每段剧情有换行正文（打字机分段）', storyKeys.every(k => TEXTS.story[k].body.length > 10))
ok('剧情段数 = 通用 6 + 楼层 + 暗格 + 暗门类型',
  storyKeys.length === 6 + FLOORS.length + HIDDEN.length + secretStoryKeys.length,
  storyKeys.length + ' 段 / ' + FLOORS.length + ' 层 + ' + HIDDEN.length + ' 暗格 + ' + secretStoryKeys.length + ' 暗门剧情')
ok('SECRET 的 21 处坐标都能映射到剧情', SECRET.every(s => !!TEXTS.story[s.story]),
  SECRET.length + ' 处')
const missItem = ITEMS.map(i => i.id).filter(id => !TEXTS.itemDesc[id])
ok('每个道具都有描述文案', missItem.length === 0, missItem.join(' ') || ITEMS.length + ' 个')
const missMon = MONSTERS.map(m => m.id).filter(id => !TEXTS.monsterDesc[id])
ok('每个怪物都有描述文案', missMon.length === 0, missMon.join(' ') || MONSTERS.length + ' 个')
ok('UI 文案齐全（含道具/设置/新游戏入口）', ['flyUp', 'flyDown', 'bombBtn', 'shopBuy', 'storyContinue', 'spriteOn', 'soundOn',
  'actFlyUp', 'actFlyDown', 'actBomb', 'actShop', 'actSettings', 'actHint', 'settingsTitle', 'settingsClose',
  'headNewGame', 'overRestart', 'actNewGame', 'settingsNewGame', 'saveSlotNote']
  .every(k => !!TEXTS.ui[k]))
ok('v0.12 UI 文案齐全（暗门相邻提示 + 商店第四项黄钥匙）',
  !!TEXTS.ui.secretHint && TEXTS.ui.shopGoods && !!TEXTS.ui.shopGoods.key,
  TEXTS.ui.secretHint)
ok('图鉴文案齐全（含「已清除」态）',
  ['codexTitle', 'codexSub', 'codexEmpty', 'codexCleared', 'codexClose', 'codexLocked'].every(k => !!TEXTS.ui[k]))
ok('图鉴副标题标注「所有怪物类型」而非「存活」',
  TEXTS.ui.codexSub.includes('所有') && !TEXTS.ui.codexSub.includes('存活'), TEXTS.ui.codexSub)
const confirmKeys = ['cancel', 'cancelled', 'newGameTitle', 'newGameBodyHas', 'newGameBodyEmpty',
  'newGameOkHas', 'newGameOkEmpty', 'newGameDone', 'clearSaveTitle', 'clearSaveBody', 'clearSaveOk',
  'clearSaveDone', 'importTitle', 'importBody', 'importOk', 'clearRecordsTitle', 'clearRecordsBody', 'clearRecordsOk']
ok('确认弹窗文案齐全', confirmKeys.every(k => !!TEXTS.confirm[k]), confirmKeys.length + ' 项')
ok('新游戏确认文案含进度占位符', ['floor', 'hp', 'steps'].every(k => TEXTS.confirm.newGameBodyHas.includes('{' + k + '}')))
ok('载入确认文案含存档串占位符', TEXTS.confirm.importBody.includes('{save}'))
ok('帮助文案齐全', ['controls', 'keys', 'rule', 'optional'].every(k => !!TEXTS.help[k]))
ok('meta 三件套齐全', !!TEXTS.meta.gameTitle && !!TEXTS.meta.tagline && !!TEXTS.meta.footer)

console.log('\n=== 7. v0.13 经验 / 盗贼任务线 / 老者炸弹 / 封印门 专项 ===')
ok('manifest 版本升到 0.13.0', man.version === '0.13.0', man.version)
ok('atlas 新增 E / j / q / Z 四个精灵映射',
  atlas.tileMap.E === 'npc_elder' && atlas.tileMap.j === 'lockpick' &&
  atlas.tileMap.q === 'moneybag' && atlas.tileMap.Z === 'door_seal',
  ['E', 'j', 'q', 'Z'].map(c => c + ':' + atlas.tileMap[c]).join(' '))
ok('npc_elder / lockpick / moneybag / door_seal 四帧都存在',
  ['npc_elder', 'lockpick', 'moneybag', 'door_seal'].every(k => !!atlas.frames[k]))
ok('地图已无炸弹拾取格 o（炸弹改商店购买）', !used.has('o'), [...used].sort().join(' '))
ok('items 仍保留 bomb 定义（供商店 effect 用）但不再放置到地图',
  ITEMS.some(i => i.id === 'bomb' && i.ch === 'o') && !used.has('o'))
ok('SECRET 奖励不再产出炸弹（改金币轮换）',
  SECRET.every(s => !/bomb/.test(s.item) && !/bomb/.test(s.story)))
ok('v0.13 新剧情 key 齐全（法师 / 老者 / 任务道具 / 封印门 / 盗贼五段）',
  ['mage_free', 'mage', 'elder', 'lockpick', 'moneybag', 'sealed_door',
   'thief_free', 'thief_task1', 'thief_door', 'thief_task2', 'thief_leave']
    .every(k => !!TEXTS.story[k] && !!TEXTS.story[k].title && !!TEXTS.story[k].body))
ok('v0.13 新道具都有描述文案',
  ['npc_elder', 'quest_lockpick', 'quest_moneybag'].every(id => !!TEXTS.itemDesc[id]))
ok('v0.13 商店五种商品 UI 文案齐全（含炸弹）',
  ['atk', 'def', 'hp', 'key', 'bomb'].every(k => !!TEXTS.ui.shopGoods[k]))
ok('v0.13 法师兑换 UI 文案齐全（三属性 + 离开）',
  ['atk', 'def', 'hp'].every(k => !!TEXTS.ui.mageGoods[k]) && !!TEXTS.ui.mageLeave)

console.log('\n' + (fail ? '存在 ' + fail + ' 项失败' : '全部 ' + pass + ' 项断言通过') + '。\n')
process.exit(fail ? 1 : 0)
