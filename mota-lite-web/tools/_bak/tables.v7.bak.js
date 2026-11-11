// tables.js —— 由 tools/build_tables.py 从 levels/levels.json 生成，请勿手改。
//
// 【编辑纪律】改数值 / 改地图请改 levels/levels.json，然后跑：
//     python3 tools/build_tables.py
//     node tools/validate_levels.mjs
// 运行时（app.js / logic.js / solver.js）只 import 本文件，不认识 JSON。
//
// 【与 M1 的分叉说明】本文件是在线试玩版自己的配置层单一真源；
// /workspace/mota-lite/src/common/tables.js 是手环端 M1 基线，已冻结（真机暂缓）。
// 两者不再字节一致：未来真机移植时以本文件为准重新对齐，见 spec 附 D / 附 E。
//
// 设计约定：一律「数组 + id」，不用对象字面量当字典（防同名 key 静默覆盖）；
// 地图用等宽字符数组编码，一层 = 一个 rows 数组。
//
// ---- tile 字符表 ----
// .  地板        #  墙          @  出生点(仅第 1 层)
// Y/B/R  黄/蓝/红门            y/b/r  黄/蓝/红钥匙
// p/P  小/大血瓶  a/d  红/蓝宝石  s/S  铁剑/铁盾  g  金币
// F  飞行器      o  炸弹        H  隐藏暗格(视觉同地板，走到触发)
// 1-9  怪物(下标 -> MONSTERS)   U  上楼  D  下楼  W  通关(王座)
// N  商店/NPC
// ---- tile 字符 -> 色块颜色 ----
export const TILE_COLOR = {
  "#": "#37474f",
  ".": "#1b2430",
  "@": "#1b2430",
  "Y": "#f9a825",
  "B": "#1e88e5",
  "R": "#e53935",
  "y": "#fdd835",
  "b": "#42a5f5",
  "r": "#ef5350",
  "p": "#ef5350",
  "P": "#b71c1c",
  "a": "#ff5252",
  "d": "#448aff",
  "s": "#cfd8dc",
  "S": "#90a4ae",
  "g": "#ffd54f",
  "F": "#26c6da",
  "o": "#ff7043",
  "H": "#1b2430",
  "U": "#66bb6a",
  "D": "#8d6e63",
  "W": "#ab47bc",
  "N": "#26c6da"
}

// ---- tile 字符 -> 色块模式下的字形 ----
export const TILE_CHAR = {
  "Y": "门",
  "B": "门",
  "R": "门",
  "y": "钥",
  "b": "钥",
  "r": "钥",
  "p": "+",
  "P": "++",
  "a": "攻",
  "d": "防",
  "s": "剑",
  "S": "盾",
  "g": "金",
  "F": "飞",
  "o": "炸",
  "H": "",
  "U": "↑",
  "D": "↓",
  "W": "王",
  "N": "商"
}

// ---- 怪物表：id 唯一，勿重复；bombImmune 表示炸弹不可炸 ----
export const MONSTERS = [
  {
    "id": "m1",
    "ch": "1",
    "name": "史莱姆",
    "hp": 20,
    "atk": 8,
    "def": 2,
    "gold": 3,
    "bg": "#4caf50"
  },
  {
    "id": "m2",
    "ch": "2",
    "name": "蝙蝠",
    "hp": 35,
    "atk": 14,
    "def": 5,
    "gold": 6,
    "bg": "#7e57c2"
  },
  {
    "id": "m3",
    "ch": "3",
    "name": "魔王",
    "hp": 120,
    "atk": 36,
    "def": 18,
    "gold": 0,
    "bg": "#e53935",
    "bombImmune": true
  },
  {
    "id": "m4",
    "ch": "4",
    "name": "骷髅兵",
    "hp": 50,
    "atk": 20,
    "def": 8,
    "gold": 10,
    "bg": "#b0bec5"
  },
  {
    "id": "m5",
    "ch": "5",
    "name": "暗法师",
    "hp": 45,
    "atk": 26,
    "def": 6,
    "gold": 12,
    "bg": "#5c6bc0"
  }
]

// ---- 道具表：effect 为对 hero 的增量 ----
export const ITEMS = [
  {
    "id": "potion_s",
    "ch": "p",
    "name": "小血瓶",
    "effect": {
      "hp": 50
    }
  },
  {
    "id": "potion_l",
    "ch": "P",
    "name": "大血瓶",
    "effect": {
      "hp": 200
    }
  },
  {
    "id": "gem_atk",
    "ch": "a",
    "name": "红宝石",
    "effect": {
      "atk": 3
    }
  },
  {
    "id": "gem_def",
    "ch": "d",
    "name": "蓝宝石",
    "effect": {
      "def": 3
    }
  },
  {
    "id": "sword",
    "ch": "s",
    "name": "铁剑",
    "effect": {
      "atk": 10
    }
  },
  {
    "id": "shield",
    "ch": "S",
    "name": "铁盾",
    "effect": {
      "def": 10
    }
  },
  {
    "id": "key_y",
    "ch": "y",
    "name": "黄钥匙",
    "effect": {
      "key": "y",
      "n": 1
    }
  },
  {
    "id": "key_b",
    "ch": "b",
    "name": "蓝钥匙",
    "effect": {
      "key": "b",
      "n": 1
    }
  },
  {
    "id": "key_r",
    "ch": "r",
    "name": "红钥匙",
    "effect": {
      "key": "r",
      "n": 1
    }
  },
  {
    "id": "gold",
    "ch": "g",
    "name": "金币",
    "effect": {
      "gold": 20
    }
  },
  {
    "id": "fly",
    "ch": "F",
    "name": "飞行器",
    "effect": {
      "fly": 1
    }
  },
  {
    "id": "bomb",
    "ch": "o",
    "name": "炸弹",
    "effect": {
      "bomb": 1
    }
  }
]

// ---- 楼层表：rows 等宽；up/down 为楼梯落点；story 为剧情 key ----
export const FLOORS = [
  {
    "name": "1F",
    "story": "floor_1f",
    "rows": ["#######", "#p###a#", "#.....#", "#1#s#Y#", "#.#..U#", "#.#.###", "#y#...#", "#@..HF#", "#######"],
    "up": {
      "x": 5,
      "y": 4
    },
    "down": null
  },
  {
    "name": "2F",
    "story": "floor_2f",
    "rows": ["#######", "#D...g#", "#.....#", "#.S.N.#", "#.....#", "#b.P.o#", "#..2.B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "3F",
    "story": "floor_3f",
    "rows": ["#######", "#D....#", "#..a..#", "#4###.#", "#.....#", "#r.H.5#", "#....R#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "4F",
    "story": "floor_4f",
    "rows": ["#######", "#D..g.#", "#..o..#", "#.4.P.#", "#..d..#", "#b.H.a#", "#.5..B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "5F",
    "story": "floor_5f",
    "rows": ["#######", "#D..g.#", "#..a..#", "#.###.#", "#..d..#", "#y.H.1#", "#..2.Y#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "6F",
    "story": "floor_6f",
    "rows": ["#######", "#D..P.#", "#..a..#", "#.###.#", "#..s..#", "#b.H.1#", "#..4.B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "7F",
    "story": "floor_7f",
    "rows": ["#######", "#D..F.#", "#..P..#", "#.###.#", "#..d..#", "#r.H.2#", "#..5.R#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "8F",
    "story": "floor_8f",
    "rows": ["#######", "#D..a.#", "#..S..#", "#.###.#", "#..P..#", "#y.H.1#", "#..4.Y#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "9F",
    "story": "floor_9f",
    "rows": ["#######", "#D..g.#", "#..a..#", "#.###.#", "#..d..#", "#b.H.o#", "#..2.B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "10F",
    "story": "floor_10f",
    "rows": ["#######", "#D..g.#", "#..a..#", "#.###.#", "#..d..#", "#y.H.1#", "#..2.Y#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "11F",
    "story": "floor_11f",
    "rows": ["#######", "#D..P.#", "#..a..#", "#.###.#", "#..s..#", "#b.H.1#", "#..4.B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "12F",
    "story": "floor_12f",
    "rows": ["#######", "#D..F.#", "#..P..#", "#.###.#", "#..d..#", "#r.H.2#", "#..5.R#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "13F",
    "story": "floor_13f",
    "rows": ["#######", "#D..a.#", "#..S..#", "#.###.#", "#..P..#", "#y.H.1#", "#..4.Y#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "14F",
    "story": "floor_14f",
    "rows": ["#######", "#D..g.#", "#..a..#", "#.###.#", "#..d..#", "#b.H.o#", "#..2.B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "15F",
    "story": "floor_15f",
    "rows": ["#######", "#D..g.#", "#..a..#", "#.###.#", "#..d..#", "#y.H.1#", "#..2.Y#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "16F",
    "story": "floor_16f",
    "rows": ["#######", "#D..P.#", "#..a..#", "#.###.#", "#..s..#", "#b.H.1#", "#..4.B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "17F",
    "story": "floor_17f",
    "rows": ["#######", "#D..F.#", "#..P..#", "#.###.#", "#..d..#", "#r.H.2#", "#..5.R#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "18F",
    "story": "floor_18f",
    "rows": ["#######", "#D..a.#", "#..S..#", "#.###.#", "#..P..#", "#y.H.1#", "#..4.Y#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "19F",
    "story": "floor_19f",
    "rows": ["#######", "#D..g.#", "#..a..#", "#.###.#", "#..d..#", "#b.H.o#", "#..2.B#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "20F",
    "story": "floor_20f",
    "rows": ["#######", "#D..g.#", "#..a..#", "#.###.#", "#..d..#", "#y.H.1#", "#..2.Y#", "#...#U#", "#######"],
    "up": {
      "x": 5,
      "y": 7
    },
    "down": {
      "x": 1,
      "y": 1
    }
  },
  {
    "name": "21F",
    "story": "floor_21f",
    "rows": ["#######", "#D..g.#", "#..P..#", "#.###.#", "#.#W#.#", "#..3..#", "#.4.5.#", "#o.H.a#", "#######"],
    "up": null,
    "down": {
      "x": 1,
      "y": 1
    }
  }
]

// ---- 初始属性 ----
export const HERO0 = {
  "hp": 200,
  "atk": 10,
  "def": 10,
  "gold": 0,
  "keys": {
    "y": 0,
    "b": 0,
    "r": 0
  },
  "fly": 0,
  "bomb": 0
}

// ---- 门的字符 -> 需要的钥匙 ----
export const DOOR_KEY = {
  "Y": "y",
  "B": "b",
  "R": "r"
}

// ---- 隐藏暗格：坐标 -> 奖励 + 文本框 key ----
export const HIDDEN = [
  {
    "floor": 0,
    "x": 4,
    "y": 7,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_1f"
  },
  {
    "floor": 2,
    "x": 3,
    "y": 5,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_3f"
  },
  {
    "floor": 3,
    "x": 3,
    "y": 5,
    "item": "key_r",
    "name": "红钥匙",
    "story": "hidden_4f"
  },
  {
    "floor": 4,
    "x": 3,
    "y": 5,
    "item": "shield",
    "name": "铁盾",
    "story": "hidden_5f"
  },
  {
    "floor": 5,
    "x": 3,
    "y": 5,
    "item": "gem_def",
    "name": "蓝宝石",
    "story": "hidden_6f"
  },
  {
    "floor": 6,
    "x": 3,
    "y": 5,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_7f"
  },
  {
    "floor": 7,
    "x": 3,
    "y": 5,
    "item": "sword",
    "name": "铁剑",
    "story": "hidden_8f"
  },
  {
    "floor": 20,
    "x": 3,
    "y": 7,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_21f"
  },
  {
    "floor": 9,
    "x": 3,
    "y": 5,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_10f"
  },
  {
    "floor": 10,
    "x": 3,
    "y": 5,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_11f"
  },
  {
    "floor": 11,
    "x": 3,
    "y": 5,
    "item": "gem_def",
    "name": "蓝宝石",
    "story": "hidden_12f"
  },
  {
    "floor": 12,
    "x": 3,
    "y": 5,
    "item": "sword",
    "name": "铁剑",
    "story": "hidden_13f"
  },
  {
    "floor": 13,
    "x": 3,
    "y": 5,
    "item": "shield",
    "name": "铁盾",
    "story": "hidden_14f"
  },
  {
    "floor": 14,
    "x": 3,
    "y": 5,
    "item": "potion_s",
    "name": "小血瓶",
    "story": "hidden_15f"
  },
  {
    "floor": 15,
    "x": 3,
    "y": 5,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_16f"
  },
  {
    "floor": 16,
    "x": 3,
    "y": 5,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_17f"
  },
  {
    "floor": 17,
    "x": 3,
    "y": 5,
    "item": "gem_def",
    "name": "蓝宝石",
    "story": "hidden_18f"
  },
  {
    "floor": 18,
    "x": 3,
    "y": 5,
    "item": "sword",
    "name": "铁剑",
    "story": "hidden_19f"
  },
  {
    "floor": 19,
    "x": 3,
    "y": 5,
    "item": "shield",
    "name": "铁盾",
    "story": "hidden_20f"
  }
]


// ---- 查表工具（数组线性查找，表很小，不做缓存 —— 与「去 m_xxx 缓存直读配置」一致）----
export function monsterByCh(ch) { return MONSTERS.find(m => m.ch === ch) || null }
export function itemByCh(ch)    { return ITEMS.find(i => i.ch === ch) || null }
export function itemById(id)    { return ITEMS.find(i => i.id === id) || null }
export function hiddenAt(floor, x, y) {
  return HIDDEN.find(h => h.floor === floor && h.x === x && h.y === y) || null
}
