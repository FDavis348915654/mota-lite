// src/common/tables.js —— 配置层：地图表 / 怪物表 / 道具表
// 设计约定：一律用「数组 + id」，不用对象字面量当字典。
// 原因：对象字面量里重复 key 会被静默覆盖（同名 key 覆盖陷阱），
//       数组能被 validate_tables.js 检查出重复 id。
// 地图用字符编码，一层 = 等宽字符串数组；改配置后必须跑 npm run check。

// ---- tile 字符表 ----
// .  地板        #  墙          @  出生点(仅第 1 层)
// Y/B/R  黄/蓝/红门            y/b/r  黄/蓝/红钥匙
// p/P  小/大血瓶  a/d  红/蓝宝石  s/S  铁剑/铁盾  g  金币
// 1-9  怪物(下标 -> MONSTERS)   U  上楼  D  下楼  W  通关(魔王/公主)
// N  商店/NPC(M3)
export const TILE_COLOR = {
  '#': '#37474f', '.': '#1b2430', '@': '#1b2430',
  'Y': '#f9a825', 'B': '#1e88e5', 'R': '#e53935',
  'y': '#fdd835', 'b': '#42a5f5', 'r': '#ef5350',
  'p': '#ef5350', 'P': '#b71c1c', 'a': '#ff5252', 'd': '#448aff',
  's': '#cfd8dc', 'S': '#90a4ae', 'g': '#ffd54f',
  'U': '#66bb6a', 'D': '#8d6e63', 'W': '#ab47bc', 'N': '#26c6da'
}
export const TILE_CHAR = {
  'Y': '门', 'B': '门', 'R': '门', 'y': '钥', 'b': '钥', 'r': '钥',
  'p': '+', 'P': '++', 'a': '攻', 'd': '防', 's': '剑', 'S': '盾',
  'g': '金', 'U': '↑', 'D': '↓', 'W': '王', 'N': '商'
}

// ---- 怪物表：id 唯一，勿重复 ----
export const MONSTERS = [
  { id: 'm1', ch: '1', name: '史莱姆', hp: 20,  atk: 8,  def: 2,  gold: 3,  bg: '#4caf50' },
  { id: 'm2', ch: '2', name: '蝙蝠',   hp: 35,  atk: 14, def: 5,  gold: 6,  bg: '#7e57c2' },
  { id: 'm3', ch: '3', name: '魔王',   hp: 100, atk: 32, def: 14, gold: 0,  bg: '#e53935' }
]

// ---- 道具表：effect 为对 hero 的增量 ----
export const ITEMS = [
  { id: 'potion_s', ch: 'p', name: '小血瓶', effect: { hp: 50 } },
  { id: 'potion_l', ch: 'P', name: '大血瓶', effect: { hp: 200 } },
  { id: 'gem_atk',  ch: 'a', name: '红宝石', effect: { atk: 3 } },
  { id: 'gem_def',  ch: 'd', name: '蓝宝石', effect: { def: 3 } },
  { id: 'sword',    ch: 's', name: '铁剑',   effect: { atk: 10 } },
  { id: 'shield',   ch: 'S', name: '铁盾',   effect: { def: 10 } },
  { id: 'key_y',    ch: 'y', name: '黄钥匙', effect: { key: 'y', n: 1 } },
  { id: 'key_b',    ch: 'b', name: '蓝钥匙', effect: { key: 'b', n: 1 } },
  { id: 'key_r',    ch: 'r', name: '红钥匙', effect: { key: 'r', n: 1 } },
  { id: 'gold',     ch: 'g', name: '金币',   effect: { gold: 20 } }
]

// ---- 楼层表：rows 必须等宽；up/down 是楼梯坐标，供换层落点用 ----
// 第 1 层演示全部 M1 机制：拾取 p/a/s/y、打怪 1、开黄门 Y、上楼 U
export const FLOORS = [
  {
    name: '1F',
    rows: [
      '#######',
      '#p###a#',
      '#.###.#',
      '#1#s#Y#',
      '#.#..U#',
      '#.#.###',
      '#y#...#',
      '#@....#',
      '#######'
    ],
    up:   { x: 5, y: 4 },
    down: null
  },
  {
    name: '2F',
    rows: [
      '#######',
      '#D....#',
      '#.....#',
      '#..P..#',
      '#.....#',
      '#..d..#',
      '#....2#',
      '#....U#',
      '#######'
    ],
    up:   { x: 5, y: 7 },
    down: { x: 1, y: 1 }
  },
  {
    name: '3F',
    // 用「墙」把 W 三面封死，唯一入口 (3,5) 由魔王 '3' 把守
    // —— 强制「先打 Boss 再通关」是配置层约束，不写进逻辑代码
    rows: [
      '#######',
      '#D....#',
      '#.....#',
      '#.###.#',
      '#.#W#.#',
      '#..3..#',
      '#.....#',
      '#.....#',
      '#######'
    ],
    up:   null,
    down: { x: 1, y: 1 }
  }
]

// 初始属性
export const HERO0 = { hp: 200, atk: 10, def: 10, gold: 0, keys: { y: 0, b: 0, r: 0 } }

// 门的字符 -> 需要的钥匙
export const DOOR_KEY = { 'Y': 'y', 'B': 'b', 'R': 'r' }

// 查表工具（数组线性查找，表很小，不做缓存 —— 与「去 m_xxx 缓存直读配置」一致）
export function monsterByCh(ch) { return MONSTERS.find(m => m.ch === ch) || null }
export function itemByCh(ch)    { return ITEMS.find(i => i.ch === ch) || null }
