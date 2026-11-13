// 自动生成，勿手改。来源 mota-lite-web/{tables,logic}.js
// Created by Davis
var MotaLogic = (function () {
'use strict';

// ===== tables.js =====
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
// v0.17 数值口径：FLOOR_SCALE 由 make_levels.py 按「每层首次战斗实测 ATK/DEF」
// 反解 —— 怪防 = 0.65 × 实测 ATK、战斗 5 回合、每怪损血按 costMul=5.0 标定
// 后再 ×1.3；m6 石头人是高防低攻挡路怪，主投 2F~16F 的闸墙缺口（主路真割点）。
// 参数见 levels.json 的 meta.curve，推导与校准实录见《开发盘点》0-O。
//
// ---- tile 字符表 ----
// .  地板        #  墙          @  出生点(仅第 1 层)
// Y/B/R  黄/蓝/红门  G  铁门(加厚，需 3 把黄钥匙)   A  暗门(视觉同墙，撞开显形)
// Z  封印门(16F 上楼唯一入口，三色钥匙无效，仅盗贼任务线能撬开)
// y/b/r  黄/蓝/红钥匙
// p/P  小/大血瓶  a/d  红/蓝宝石  s/S  铁剑/铁盾  g  金币
// F  飞行器(全塔唯一)  o  炸弹  H  隐藏暗格(视觉同地板，走到触发)
// I  怪物图鉴(全塔唯一，拾取后解锁图鉴界面)
// M  被困的法师   T  被困的盗贼   E  被困的老者   N  商人(商店)
// j  锁匠工具(13F)   q  钱袋(19F)   —— 盗贼任务线两件交付道具
// e  塔灵小精灵(1F 出生点旁常驻 NPC)   C  能量核心(13F 房间，全塔唯一)
// 1-8  怪物(字符 -> MONSTERS)   X  宝库守卫(精英怪，强度超前 9 层，守墙围宝库)
// U  上楼  D  下楼  W  通关(王座)
//
// 可走格只有 . @ H U D W；其余非墙格都是「实体」，寻路不穿越、须玩家主动点击交互。
// 暗门 A 视觉与墙一致、但属实体：主动点它(撞墙)才显形，不是可走格也不是墙。
// v0.9：怪物运行时数值 = FLOOR_SCALE[层] × 该怪种权重；noScale(魔王) 用自身数值。
// v0.12：DOOR_COST 给每道门的钥匙消耗；SECRET 给暗门坐标 -> 墙后奖励 + 剧情 key。
// v0.13：MONSTERS 加 exp；HERO0 加 exp / flags；ITEMS 加老者 E 与任务道具 j/q；
//   16F 的上楼门改为封印门 Z（DOOR_KEY 不含 Z，三色钥匙开不了，见 logic.js）。
// v0.14：关卡设计深度 —— 隔间墙 + 加密实体 + 4 处强敌守宝库(3/9/14/18F)；
//   MONSTERS 加精英怪 X(scaleShift/elite)；FLOOR_SCALE 扩到 30 组（21 逐层 + 9 外推，
//   供 scaledMon 的 scaleShift 取「超前层」数值，见 logic.js）；meta.schema 升 6。
// v0.15：走廊闸墙 / 单格瓶颈守路怪 / 支路凹室资源把守。
// v0.16：1F 小精灵 e + 13F 能量核心 C + BARRIER（17F 起数值台阶与能量护盾）；
//   怪数 12、全塔目标损血 ×1.3；schema 升 7。
// ---- tile 字符 -> 色块颜色 ----
const TILE_COLOR = {
  "#": "#37474f",
  ".": "#1b2430",
  "@": "#1b2430",
  "A": "#37474f",
  "G": "#8d99a6",
  "Z": "#7b5ea7",
  "Y": "#e6a23c",
  "B": "#3a86e8",
  "R": "#e5534b",
  "y": "#ffd54f",
  "b": "#64b5f6",
  "r": "#ef9a9a",
  "p": "#ef5350",
  "P": "#e53935",
  "a": "#ff5252",
  "d": "#448aff",
  "s": "#cfd8dc",
  "S": "#90a4ae",
  "g": "#ffca28",
  "F": "#4dd0e1",
  "o": "#546e7a",
  "I": "#ba68c8",
  "M": "#7e57c2",
  "T": "#8d6e63",
  "E": "#bcaaa4",
  "j": "#b0bec5",
  "q": "#ffca28",
  "X": "#ff7043",
  "e": "#66e0c8",
  "C": "#8c7bff",
  "H": "#1b2430",
  "U": "#66bb6a",
  "D": "#8d6e63",
  "W": "#ab47bc",
  "N": "#26c6da"
}

// ---- tile 字符 -> 色块模式下的字形 ----
const TILE_CHAR = {
  "Y": "门",
  "B": "门",
  "R": "门",
  "G": "铁",
  "A": "",
  "Z": "封",
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
  "I": "鉴",
  "M": "法",
  "T": "盗",
  "H": "",
  "E": "老",
  "j": "具",
  "q": "袋",
  "X": "卫",
  "e": "灵",
  "C": "核",
  "U": "↑",
  "D": "↓",
  "W": "王",
  "N": "商"
}

// ---- 怪物表：id 唯一，勿重复；bombImmune 表示炸弹不可炸 ----
const MONSTERS = [
  {
    "id": "m1",
    "ch": "1",
    "name": "史莱姆",
    "hp": 20,
    "atk": 8,
    "def": 2,
    "gold": 3,
    "exp": 4,
    "bg": "#4caf50",
    "hpW": 0.85,
    "atkW": 0.95,
    "defW": 0.8
  },
  {
    "id": "m2",
    "ch": "2",
    "name": "蝙蝠",
    "hp": 35,
    "atk": 14,
    "def": 5,
    "gold": 6,
    "exp": 6,
    "bg": "#7e57c2",
    "hpW": 1.0,
    "atkW": 1.0,
    "defW": 1.0
  },
  {
    "id": "m4",
    "ch": "4",
    "name": "骷髅兵",
    "hp": 50,
    "atk": 20,
    "def": 8,
    "gold": 10,
    "exp": 9,
    "bg": "#b0bec5",
    "hpW": 1.1,
    "atkW": 1.0,
    "defW": 1.1
  },
  {
    "id": "m6",
    "ch": "6",
    "name": "石头人",
    "hp": 60,
    "atk": 12,
    "def": 26,
    "gold": 14,
    "exp": 11,
    "bg": "#8d6e63",
    "hpW": 1.0,
    "atkW": 0.92,
    "defW": 1.23
  },
  {
    "id": "m7",
    "ch": "7",
    "name": "兽人",
    "hp": 55,
    "atk": 24,
    "def": 7,
    "gold": 15,
    "exp": 10,
    "bg": "#d84315",
    "hpW": 1.15,
    "atkW": 1.05,
    "defW": 0.9
  },
  {
    "id": "m5",
    "ch": "5",
    "name": "暗法师",
    "hp": 45,
    "atk": 26,
    "def": 6,
    "gold": 16,
    "exp": 12,
    "bg": "#5c6bc0",
    "hpW": 0.9,
    "atkW": 0.08,
    "defW": 0.8,
    "pierce": true
  },
  {
    "id": "m8",
    "ch": "8",
    "name": "魔法警卫",
    "hp": 50,
    "atk": 20,
    "def": 10,
    "gold": 18,
    "exp": 13,
    "bg": "#00897b",
    "hpW": 1.0,
    "atkW": 0.1,
    "defW": 1.0,
    "pierce": true
  },
  {
    "id": "m9",
    "ch": "X",
    "name": "宝库守卫",
    "hp": 120,
    "atk": 30,
    "def": 20,
    "gold": 60,
    "exp": 45,
    "bg": "#ef6c00",
    "hpW": 0.8,
    "atkW": 1.25,
    "defW": 1.0,
    "scaleShift": 9,
    "elite": true
  },
  {
    "id": "m3",
    "ch": "3",
    "name": "魔王",
    "hp": 950,
    "atk": 380,
    "def": 56,
    "gold": 0,
    "exp": 0,
    "bg": "#e53935",
    "bombImmune": true,
    "noScale": true
  }
]

// ---- 道具表：effect 为对 hero 的增量 ----
const ITEMS = [
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
  },
  {
    "id": "codex",
    "ch": "I",
    "name": "怪物图鉴",
    "effect": {
      "book": 1
    }
  },
  {
    "id": "npc_mage",
    "ch": "M",
    "name": "被困的法师",
    "effect": {
      "def": 8,
      "hp": 100
    }
  },
  {
    "id": "npc_thief",
    "ch": "T",
    "name": "被困的盗贼",
    "effect": {
      "key": "y",
      "n": 3,
      "gold": 40
    }
  },
  {
    "id": "npc_elder",
    "ch": "E",
    "name": "被困的老者",
    "effect": {
      "flag": 2,
      "bomb": 1
    }
  },
  {
    "id": "quest_lockpick",
    "ch": "j",
    "name": "锁匠工具",
    "effect": {
      "flag": 4
    }
  },
  {
    "id": "quest_moneybag",
    "ch": "q",
    "name": "钱袋",
    "effect": {
      "flag": 8
    }
  },
  {
    "id": "core_energy",
    "ch": "C",
    "name": "能量核心",
    "effect": {
      "flag": 128
    }
  },
  {
    "id": "npc_fairy",
    "ch": "e",
    "name": "塔灵小精灵",
    "effect": {}
  }
]

// ---- 楼层表：rows 等宽；up/down 为楼梯落点；story 为剧情 key ----
const FLOORS = [
  {
    "name": "1F · 潮湿石厅",
    "theme": "潮湿石厅",
    "story": "floor_1f",
    "rows": ["#############", "#@..........#", "#e..y....sPg#", "#p....gSrb..#", "##1##########", "#.........2.#", "##########2##", "#.......2..H#", "##1##########", "#..A##.....1#", "#.21..###...#", "#.#P#..#....#", "#.1#..#d#..Y#", "#.21...2..#U#", "#############"],
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "2F · 商队歇脚",
    "theme": "商队歇脚",
    "story": "floor_2f",
    "rows": ["#############", "#D..........#", "#.......g...#", "#..#######p.#", "#..#.....#..#", "#..#..N..#..#", "#bg#.....#.P#", "#..#...S.#.r#", "#..###Y###..#", "#..y.d2....S#", "#########6###", "#2.1.6.2....#", "#1.2#P#.1...#", "#.A###2.12.U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "3F · 骨与火把",
    "theme": "骨与火把",
    "story": "floor_3f",
    "rows": ["#############", "#D..........#", "#.##rgygd.P.#", "##sS#......a#", "##X##..bp...#", "#...........#", "####6########", "#....4.141..#", "########2####", "#...........#", "####1########", "#.....#.....#", "#21A.#g#.2.Y#", "#....H6..1#U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "4F · 倾斜回廊",
    "theme": "倾斜回廊",
    "story": "floor_4f",
    "rows": ["#############", "#D..........#", "#..gg...y...#", "#..#######Aa#", "#..#.....#.r#", "#b.#.....#..#", "#.p#..S.a#..#", "#..#.P...#s.#", "#..###Y###..#", "#....P2.....#", "##########6##", "#..#21.#2...#", "#1#d#H#a#...#", "#.2112.6.1.U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "5F · 藏书回廊",
    "theme": "藏书回廊",
    "story": "floor_5f",
    "rows": ["#############", "#D..........#", "#....r.S.py.#", "#gb....s.Pg.#", "###6#########", "#..H........#", "#########2###", "#.........1.#", "###1#########", "#.1..#....2.#", "##P#.#..#...#", "#.#..#.6d#..#", "#..12...#..Y#", "#1.2..1A###U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "6F · 断剑武库",
    "theme": "断剑武库",
    "story": "floor_6f",
    "rows": ["#############", "#D..........#", "#..P........#", "#p.#######..#", "#..#...I.#g.#", "#r.#.....#..#", "#..#.....#..#", "#..#...a.#S.#", "#.d###Y###.g#", "#y....2..bA.#", "########6####", "#62.H#.41...#", "#6..#P#2.4..#", "#.6..6..2..U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "7F · 风井",
    "theme": "风井",
    "story": "floor_7f",
    "rows": ["#############", "#D..........#", "#.d.gy.g....#", "#.bp.P.a..r.#", "#####6#######", "#..2..H.....#", "#######4#####", "#.4.........#", "#####2#######", "#.6.22......#", "#...4...#...#", "#.....6#a#..#", "#.A..#g#2..G#", "#..6..#####U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "8F · 铁盾厅",
    "theme": "铁盾厅",
    "story": "floor_8f",
    "rows": ["#############", "#D..........#", "#.....y...rP#", "#..#######a.#", "#..#...M.#As#", "#g.#.P...#..#", "#..#.....#g.#", "#..#.....#..#", "#..###B###..#", "#.b...2...p.#", "#######6#####", "#.4#.6.H61..#", "#2#d#4.#a#..#", "#..2.6.2#4.U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "9F · 补给长廊",
    "theme": "补给长廊",
    "story": "floor_9f",
    "rows": ["#############", "#D..........#", "#...g.......#", "#...##......#", "#p.#sS#....y#", "#.r#X##....g#", "#bP......S.s#", "##6##########", "#6...11...4.#", "##########4##", "#..1.24...2.#", "##2##########", "#..2.......B#", "#...###A..#U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "10F · 塔之中点",
    "theme": "塔之中点",
    "story": "floor_10f",
    "rows": ["#############", "#D..........#", "#..Sp..Py.g.#", "#b..d...gr..#", "#########6###", "#...2...4H..#", "###4#########", "#....1.....2#", "#########2###", "#.64......A.#", "##P#...6....#", "#.#...#..2..#", "#....2g#...B#", "#.....#...#U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "11F · 囚徒囚室",
    "theme": "囚徒囚室",
    "story": "floor_11f",
    "rows": ["#############", "#D..........#", "#..ry...g...#", "#g.#######..#", "#..#.F...#..#", "#aA#.....#..#", "#..#.....#..#", "#..#..d..#b.#", "#..###B###.p#", "#...d.4.P...#", "####6########", "#.4H6...24..#", "#..#g#6#a#..#", "#.24#.62#4.U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "12F · 蓝门之后",
    "theme": "蓝门之后",
    "story": "floor_12f",
    "rows": ["#############", "#D..........#", "#..g..p...r.#", "#..#######b.#", "#.s#.....#..#", "#..#..d..#A.#", "#..#.....#..#", "#..#..E..#y.#", "#..###B###a.#", "#....P2...g.#", "##6##########", "#H17#4..62..#", "#57#d#.#a#..#", "#..24.1.#..U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "13F · 断刃与骨",
    "theme": "断刃与骨",
    "story": "floor_13f",
    "rows": ["#############", "#D..........#", "#..........g#", "#..#######.r#", "#.P#j...C#..#", "#..#....a#..#", "#p.#..PS.#A.#", "#S.#.....#..#", "#b.###B###..#", "#yg..s4.....#", "#########6###", "#4.5..6..4..#", "#7.4.#d#....#", "#.H57.#45..U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "14F · 风井回声",
    "theme": "风井回声",
    "story": "floor_14f",
    "rows": ["#############", "#D..........#", "#....r....A.#", "#.........g.#", "#....y..d##.#", "#.......#sS##", "#g.S.p..#X###", "#...b.....P.#", "####6########", "#..5..4...H7#", "########7####", "#.4#...6....#", "#5#g#.#P#7.G#", "#4.7...#5.#U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "15F · 半途之盾",
    "theme": "半途之盾",
    "story": "floor_15f",
    "rows": ["#############", "#D..........#", "#.yg...P....#", "#..#######A.#", "#..#.....#..#", "#.g#.....#..#", "#..#.....#..#", "#..#.Tg..#..#", "#..###R###..#", "#..dr.4ab.p.#", "##########6##", "#..#745H#...#", "#.#a#74#g#..#", "#.547..46..U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "16F · 红门厅",
    "theme": "红门厅",
    "story": "floor_16f",
    "rows": ["#############", "#D..........#", "#.....sa.P..#", "#..g.gy.b.rp#", "###6#########", "#.......H2.4#", "#########7###", "#....2......#", "###4#########", "#1.....#.5..#", "#.A##.#d4.7.#", "#.###.##....#", "#....#a#...Z#", "#.....6.4.#U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "17F · 锈铁冷光",
    "theme": "锈铁冷光",
    "story": "floor_17f",
    "rows": ["#############", "#D..........#", "#.....b.y...#", "#.p#######P.#", "#..#.....#..#", "#.r#.N...#.S#", "#..#...S.#.g#", "#..#.....#..#", "#g.###R###..#", "#.....4....s#", "########4####", "#..H5#74.4..#", "#.5.#d#A##..#", "#745.7...7.U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "18F · 收窄石阶",
    "theme": "收窄石阶",
    "story": "floor_18f",
    "rows": ["#############", "#D..........#", "#..yr....pdg#", "#g....bPS...#", "#####4#######", "#......1..8.#", "#######7#####", "#.....#...A.#", "#.##.7g#..#5#", "##sS#.##.1#.#", "##X##.#P#.#.#", "#....7.4....#", "#....8...5.R#", "#7H####...#U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "19F · 最后的暗格",
    "theme": "最后的暗格",
    "story": "floor_19f",
    "rows": ["#############", "#D..........#", "#......g.r.b#", "#a.#######..#", "#..#S.q..#p.#", "#..#a..P.#..#", "#..#.....#..#", "#..#.....#..#", "#.y###R###..#", "#P....4gd...#", "#######4#####", "#5#A###.....#", "#78..#g#5...#", "#7H85778...U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "20F · 王座下的静",
    "theme": "王座下的静",
    "story": "floor_20f",
    "rows": ["#############", "#D..........#", "#.r..a..Ps.y#", "#.g.b...pg..#", "##4##########", "#...1.4.....#", "##########7##", "#...2.......#", "##4##########", "#..7..4.7.H.#", "#....#.#a#..#", "#..#8#..#...#", "#.#d4#.....R#", "#5.#..#A#.#U#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    },
    "up": {
      "x": 11,
      "y": 13
    }
  },
  {
    "name": "21F · 王座之间",
    "theme": "王座之间",
    "story": "floor_21f",
    "rows": ["#############", "#D.#.....#..#", "#..4.a...#.##", "#..#..#..#.##", "#..#.#W#.#P##", "#..#.#3#.#.##", "#..#..G.2#.S#", "#..###H..#..#", "#.2####y1#A.#", "#..####..##.#", "#.s#a##..##.#", "#P.#.##.14sd#", "#..#.#...#..#", "#.b#r.1..#.4#", "#############"],
    "down": {
      "x": 1,
      "y": 1
    }
  }
]

// ---- 初始属性 ----
const HERO0 = {
  "hp": 200,
  "atk": 10,
  "def": 10,
  "gold": 0,
  "exp": 0,
  "flags": 0,
  "keys": {
    "y": 0,
    "b": 0,
    "r": 0
  },
  "fly": 0,
  "bomb": 0,
  "book": 0
}

// ---- 门的字符 -> 需要的钥匙（铁门 G 也用黄钥匙） ----
const DOOR_KEY = {
  "Y": "y",
  "B": "b",
  "R": "r",
  "G": "y"
}

// ---- 门的字符 -> 消耗钥匙数量（普通 1 / 铁门 3） ----
const DOOR_COST = {
  "Y": 1,
  "B": 1,
  "R": 1,
  "G": 3
}

// ---- 隐藏暗格：坐标 -> 奖励 + 文本框 key ----
const HIDDEN = [
  {
    "floor": 0,
    "x": 11,
    "y": 7,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_1f"
  },
  {
    "floor": 2,
    "x": 5,
    "y": 13,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_3f"
  },
  {
    "floor": 3,
    "x": 5,
    "y": 12,
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
    "x": 4,
    "y": 11,
    "item": "gem_def",
    "name": "蓝宝石",
    "story": "hidden_6f"
  },
  {
    "floor": 6,
    "x": 6,
    "y": 5,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_7f"
  },
  {
    "floor": 7,
    "x": 7,
    "y": 11,
    "item": "sword",
    "name": "铁剑",
    "story": "hidden_8f"
  },
  {
    "floor": 9,
    "x": 9,
    "y": 5,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_10f"
  },
  {
    "floor": 10,
    "x": 3,
    "y": 11,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_11f"
  },
  {
    "floor": 11,
    "x": 1,
    "y": 11,
    "item": "gem_def",
    "name": "蓝宝石",
    "story": "hidden_12f"
  },
  {
    "floor": 12,
    "x": 2,
    "y": 13,
    "item": "sword",
    "name": "铁剑",
    "story": "hidden_13f"
  },
  {
    "floor": 13,
    "x": 10,
    "y": 9,
    "item": "shield",
    "name": "铁盾",
    "story": "hidden_14f"
  },
  {
    "floor": 14,
    "x": 7,
    "y": 11,
    "item": "potion_s",
    "name": "小血瓶",
    "story": "hidden_15f"
  },
  {
    "floor": 15,
    "x": 8,
    "y": 5,
    "item": "potion_l",
    "name": "大血瓶",
    "story": "hidden_16f"
  },
  {
    "floor": 16,
    "x": 3,
    "y": 11,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_17f"
  },
  {
    "floor": 17,
    "x": 2,
    "y": 13,
    "item": "gem_def",
    "name": "蓝宝石",
    "story": "hidden_18f"
  },
  {
    "floor": 18,
    "x": 2,
    "y": 13,
    "item": "sword",
    "name": "铁剑",
    "story": "hidden_19f"
  },
  {
    "floor": 19,
    "x": 10,
    "y": 9,
    "item": "shield",
    "name": "铁盾",
    "story": "hidden_20f"
  },
  {
    "floor": 20,
    "x": 6,
    "y": 7,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "hidden_21f"
  }
]

// ---- 暗门：坐标 -> 墙后奖励 + 文本框 key（撞墙显形） ----
const SECRET = [
  {
    "floor": 0,
    "x": 3,
    "y": 9,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 1,
    "x": 2,
    "y": 13,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 2,
    "x": 3,
    "y": 12,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 3,
    "x": 10,
    "y": 3,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 4,
    "x": 7,
    "y": 13,
    "item": "gem_atk",
    "name": "红宝石",
    "story": "secret_sword"
  },
  {
    "floor": 5,
    "x": 10,
    "y": 9,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 6,
    "x": 2,
    "y": 12,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 7,
    "x": 10,
    "y": 4,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 8,
    "x": 7,
    "y": 13,
    "item": "gem_def",
    "name": "蓝宝石",
    "story": "secret_shield"
  },
  {
    "floor": 9,
    "x": 10,
    "y": 9,
    "item": "gold",
    "name": "金币",
    "story": "secret_gold"
  },
  {
    "floor": 10,
    "x": 2,
    "y": 5,
    "item": "gold",
    "name": "金币",
    "story": "secret_gold"
  },
  {
    "floor": 11,
    "x": 10,
    "y": 5,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 12,
    "x": 10,
    "y": 6,
    "item": "potion_s",
    "name": "小血瓶",
    "story": "secret_potion"
  },
  {
    "floor": 13,
    "x": 10,
    "y": 2,
    "item": "gold",
    "name": "金币",
    "story": "secret_gold"
  },
  {
    "floor": 14,
    "x": 10,
    "y": 3,
    "item": "gold",
    "name": "金币",
    "story": "secret_gold"
  },
  {
    "floor": 15,
    "x": 2,
    "y": 10,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 16,
    "x": 7,
    "y": 12,
    "item": "potion_s",
    "name": "小血瓶",
    "story": "secret_potion"
  },
  {
    "floor": 17,
    "x": 10,
    "y": 7,
    "item": "gold",
    "name": "金币",
    "story": "secret_gold"
  },
  {
    "floor": 18,
    "x": 3,
    "y": 11,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_gem"
  },
  {
    "floor": 19,
    "x": 7,
    "y": 13,
    "item": "key_y",
    "name": "黄钥匙",
    "story": "secret_key"
  },
  {
    "floor": 20,
    "x": 10,
    "y": 8,
    "item": "potion_s",
    "name": "小血瓶",
    "story": "secret_potion"
  }
]

// ---- 逐层怪物标准数值（hp/atk/def），运行时按层派生实际数值 ----
const FLOOR_SCALE = [
  {
    "hp": 29,
    "atk": 24,
    "def": 13,
    "targetLoss": 31,
    "mobs": 12
  },
  {
    "hp": 33,
    "atk": 31,
    "def": 15,
    "targetLoss": 34,
    "mobs": 12
  },
  {
    "hp": 37,
    "atk": 54,
    "def": 17,
    "targetLoss": 37,
    "mobs": 12
  },
  {
    "hp": 37,
    "atk": 54,
    "def": 17,
    "targetLoss": 41,
    "mobs": 12
  },
  {
    "hp": 65,
    "atk": 68,
    "def": 29,
    "targetLoss": 44,
    "mobs": 12
  },
  {
    "hp": 81,
    "atk": 94,
    "def": 38,
    "targetLoss": 47,
    "mobs": 12
  },
  {
    "hp": 89,
    "atk": 111,
    "def": 42,
    "targetLoss": 50,
    "mobs": 12
  },
  {
    "hp": 93,
    "atk": 111,
    "def": 44,
    "targetLoss": 53,
    "mobs": 12
  },
  {
    "hp": 145,
    "atk": 133,
    "def": 67,
    "targetLoss": 56,
    "mobs": 12
  },
  {
    "hp": 145,
    "atk": 149,
    "def": 67,
    "targetLoss": 59,
    "mobs": 12
  },
  {
    "hp": 149,
    "atk": 152,
    "def": 69,
    "targetLoss": 62,
    "mobs": 12
  },
  {
    "hp": 177,
    "atk": 156,
    "def": 81,
    "targetLoss": 66,
    "mobs": 12
  },
  {
    "hp": 193,
    "atk": 175,
    "def": 90,
    "targetLoss": 69,
    "mobs": 12
  },
  {
    "hp": 213,
    "atk": 202,
    "def": 98,
    "targetLoss": 72,
    "mobs": 12
  },
  {
    "hp": 213,
    "atk": 215,
    "def": 98,
    "targetLoss": 75,
    "mobs": 12
  },
  {
    "hp": 241,
    "atk": 216,
    "def": 110,
    "targetLoss": 78,
    "mobs": 12
  },
  {
    "hp": 369,
    "atk": 289,
    "def": 171,
    "targetLoss": 81,
    "mobs": 12
  },
  {
    "hp": 373,
    "atk": 315,
    "def": 173,
    "targetLoss": 84,
    "mobs": 12
  },
  {
    "hp": 377,
    "atk": 322,
    "def": 175,
    "targetLoss": 87,
    "mobs": 12
  },
  {
    "hp": 421,
    "atk": 337,
    "def": 195,
    "targetLoss": 90,
    "mobs": 12
  },
  {
    "hp": 425,
    "atk": 357,
    "def": 197,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 442,
    "atk": 371,
    "def": 205,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 459,
    "atk": 385,
    "def": 213,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 476,
    "atk": 399,
    "def": 221,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 493,
    "atk": 413,
    "def": 229,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 510,
    "atk": 427,
    "def": 237,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 527,
    "atk": 441,
    "def": 245,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 544,
    "atk": 455,
    "def": 253,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 561,
    "atk": 469,
    "def": 261,
    "targetLoss": 94,
    "mobs": 8
  },
  {
    "hp": 578,
    "atk": 483,
    "def": 269,
    "targetLoss": 94,
    "mobs": 8
  }
]

// ---- v0.16 屏障：卡关层 / 核心层 / 精灵层 / 数值台阶倍率 / 精灵强化幅度 ----
const BARRIER = {
  "floor": 16,
  "coreFloor": 12,
  "fairyFloor": 0,
  "boost": {
    "hp": 1.1,
    "atk": 1.05,
    "def": 1.0
  },
  "charge": {
    "atk": 80,
    "def": 60,
    "hp": 1200
  }
}

// ---- 视口：屏幕一次显示的格数，地图比它大时由宿主层做跟随相机 ----
const VIEWPORT = {
  "cols": 7,
  "rows": 9
}


// ---- 查表工具（数组线性查找，表很小，不做缓存 —— 与「去 m_xxx 缓存直读配置」一致）----
function monsterByCh(ch) { return MONSTERS.find(m => m.ch === ch) || null }
function itemByCh(ch)    { return ITEMS.find(i => i.ch === ch) || null }
function itemById(id)    { return ITEMS.find(i => i.id === id) || null }
function hiddenAt(floor, x, y) {
  return HIDDEN.find(h => h.floor === floor && h.x === x && h.y === y) || null
}
function secretAt(floor, x, y) {
  return SECRET.find(s => s.floor === floor && s.x === x && s.y === y) || null
}


// ===== logic.js =====
// logic.js —— 在线版「完整内容」纯逻辑层（v0.4.0 起独立演进）
//
// 【与 M1 的分叉说明】
// 本文件是 /workspace/mota-lite-web/ 在线试玩版自己的逻辑层单一真源，
// 不 import 任何 @system.* / DOM / 资源，可被 node 直接 import 做离线校验。
// /workspace/mota-lite/src/common/logic.js 是手环端 M1 基线，已冻结（真机暂缓）。
// 未来真机移植时以本文件为准重新对齐，见 spec 附 D。
//
// 事件协议（保持 M1 的三类最小集合，不新增 UI 事件）：
//   { t:'msg', text }   提示条文本
//   { t:'vibrate' }     需要振动
//   { t:'save' }        本步改变了持久状态，宿主层应写盘
// 文本框弹层 / 战斗动画 / 音效全部由宿主层按「state + 配置表 + 本步 tile」推断，
// 逻辑层不耦合任何表现层概念，因此仍可纯 node 验证。
//
// v0.4 新增的可选机制：隐藏暗格(H) / 飞行器(fly) / 炸弹(bomb) / 商店(N)。
// 它们都是「增强或捷径」，不是通关必需 —— BFS 只枚举四方向即可通关。
//
// v0.8 新增的可选机制：图鉴(book) / 被救的 NPC(法师 M、盗贼 T) / 已探索楼层(explored)。
// 飞行器从「可多次拾取的消耗品」改为「全塔唯一的永久道具」，且只能飞往已探索过的楼层。
//
// v0.12 经典机制补全：暗门 A（伪装墙，撞开显形并结算墙后奖励）、铁门 G
// （加厚门，DOOR_COST 规定消耗 3 把黄钥匙）、商店第 4 项「黄钥匙」形成钥匙经济。
//
// v0.13 大版本（用户一轮需求）：
//   ① 门改「撞门开门、停原地」（与怪物/道具 v0.11 语义统一），不再开门即通过；
//   ② 击杀怪物得经验 exp（基础值 × 楼层档 1/2/3），8F 法师救出后常驻，
//      可反复用 30 经验兑换 攻+3 / 防+3 / 生命+100（MAGE_GOODS / mageBuy）；
//   ③ 盗贼 T 任务线（常驻 NPC）：救出 -> 找回 13F 锁匠工具 j -> 他撬开 16F 封印门 Z
//      -> 找回 19F 钱袋 q -> 给重谢并离塔；Z 是唯一通往上层的硬门槛，钥匙开不了；
//   ④ 老者 E（12F 房间）：救出后解锁炸弹能力并赠 1 枚，商店新增第 5 项「炸弹 30G」；
//      地图上的炸弹拾取全部移除（配置层已删），炸弹成为中后期能力；
//   ⑤ 「购买」按钮的首遇解锁、商店/兑换界面不自动关闭等交互在宿主层，
//      逻辑层只负责 flags 的写入。flags 位字段：1 shopSeen / 2 bombUnlocked /
//      4 lockpick / 8 moneybag / 16 mageFreed / bits5-6 thiefStage(0~3)。
//   存档升 v4：head 追加 exp 与 flags 两个字段（16 字段），v1~v3 旧档作废重开。

// ---- 逐层怪物强度：FLOOR_SCALE[层] × 每怪种权重 ----
// 经典魔塔是「固定数值、可预计算」：同一只怪在不同层数值不同，玩家可据图鉴精确算损血。
// 这修掉 v0.8 的根因：怪 ATK 全局常量、玩家 DEF 单调涨到 240，导致 100% 零伤。
// noScale（魔王）用自身终局数值；pierce（法师系）攻击为真实伤害，无视玩家 DEF。
function scaledMon(mon, floor) {
  if (!mon || mon.noScale) return mon
  // v0.14：精英怪 scaleShift 取「超前 N 层」的 FLOOR_SCALE（含 21F 之上的外推段），
  // 让同一只宝库守卫在 3F 就是 12F 强度、在 18F 更远超终局 —— 玩家须爬楼变强
  // 再回来打。普通怪 scaleShift=0，索引恒在 0~20，行为与 v0.13 完全一致。
  const idx = Math.min(
    (floor == null ? 0 : floor) + (mon.scaleShift || 0),
    (FLOOR_SCALE && FLOOR_SCALE.length - 1) || 0
  )
  const s = (FLOOR_SCALE && FLOOR_SCALE[idx]) || null
  if (!s) return mon
  // v0.16：屏障层起「常规怪」数值上一个台阶（HP/ATK/DEF 各乘 BARRIER.boost）。
  // 精英 X 保持 v0.14 的超前层语义，不叠加倍率，避免 4 处强敌宝库口径漂移；
  // 魔王 noScale 已在函数开头返回。玩家强化后靠 charge 的属性打这个台阶。
  const fl = floor == null ? 0 : floor
  const mul = (BARRIER && fl >= BARRIER.floor && !mon.elite)
    ? BARRIER.boost : { hp: 1, atk: 1, def: 1 }
  return {
    ...mon,
    hp: Math.max(1, Math.round(s.hp * (mon.hpW == null ? 1 : mon.hpW) * mul.hp)),
    atk: Math.max(1, Math.round(s.atk * (mon.atkW == null ? 1 : mon.atkW) * mul.atk)),
    def: Math.max(0, Math.round(s.def * (mon.defW == null ? 1 : mon.defW) * mul.def))
  }
}

// 全部可调参数集中在配置层，改数值不改逻辑
const CONFIG = {
  FIRST_STRIKE: true,   // 玩家先手：最后一回合怪已死，不再反击 -> (rounds-1)
  MIN_DAMAGE_1: false,  // 经典 50 层：ATK<=DEF 判「不可破防」；部分版本强制 1 点伤害
  CELL: 28,             // 格子边长 px（7 列 * 28 = 196，212 宽左右各留 8）
  SAFE_LR: 8,           // 胶囊圆角左右安全区
  VIBRATE_GAP: 300,     // ms，振动最小间隔
  SAVE_LIMIT: 4096,     // v3：21 层 13×15 大地图通关存档实测 1025B，留 4 倍余量
  HANDHELD_SAVE_LIMIT: 128, // 手环端 @system.storage 的参考上限，仅用于 UI 提示；移植时须恢复（spec 附 D）
  SHOP_COST: 20,        // 商店一次交易花费金币（经典 21 层魔塔固定价）
  KEY_COST: 20,         // v0.12：商店补 1 把黄钥匙的价格（经典魔塔商人卖钥匙）
  BOMB_COST: 30,        // v0.13：老者解锁后商店补 1 枚炸弹的价格（中后期能力，比攻防贵）
  EXP_COST: 30,         // v0.13：法师处一次经验兑换的花费（全塔总经验约 30 次兑换）
  SHOP_ATK: 3,          // 兼容旧口径：1F 买攻 +3
  SHOP_TIER_FLOORS: 7,  // 每 7 层一档：经典 50 层「更高楼层商店同价回报更好」
  SHOP_TIER_BONUS: 2    // 每档额外 +2 攻 / +2 防；血另按 20×档 递增
}

// v0.13：hero.flags 位字段（一个整数进存档，避免存档格式再次膨胀）
const FLAG = {
  SHOP_SEEN: 1,       // 首次撞过商店 N -> 宿主层「购买」按钮出现
  BOMB_UNLOCK: 2,     // 救出老者 E -> 炸弹按钮 / 商店炸弹项解锁
  LOCKPICK: 4,        // 持有锁匠工具 j（盗贼任务一）
  MONEYBAG: 8,        // 持有钱袋 q（盗贼任务二）
  MAGE_FREED: 16,     // 法师 M 已救出（此后撞 M 打开经验兑换而非再给奖励）
  CORE_HELD: 128,     // v0.16 持有能量核心 C（13F 房间，全塔唯一）
  FAY_CHARGED: 256    // v0.16 已回 1F 找小精灵完成强化（能量护盾解除）
}
// 盗贼任务阶段存 flags 的 bit5-6：0 被困 / 1 已救（等锁匠工具）/ 2 已开门（等钱袋）/ 3 已离塔
function thiefStage(hero) { return ((hero.flags || 0) >> 5) & 3 }
function setThiefStage(hero, st) { hero.flags = (hero.flags & ~(3 << 5)) | (st << 5) }

// 封印门 Z 全塔唯一（16F 上楼唯一入口）：盗贼任务推进时远程撬开，直接清成地板
function specialDoorPos() {
  for (let f = 0; f < FLOORS.length; f++) {
    const rows = FLOORS[f].rows
    for (let y = 0; y < rows.length; y++) {
      const x = rows[y].indexOf('Z')
      if (x >= 0) return { floor: f, x, y }
    }
  }
  return null
}
function setTileAt(s, floor, x, y, ch) {
  if (!s.opened[floor]) s.opened[floor] = {}
  s.opened[floor][y * FLOORS[floor].rows[0].length + x] = ch
}

// ---- 可走 / 实体：v0.8 点击交互的唯一判定标准 ----
// 寻路只穿越可走格；其余非墙格都是「实体」，玩家必须主动点击才会走到相邻格并触发交互。
// H（隐藏暗格）视觉与地板完全一致、靠走上去发现，因此必须算可走，否则永远踩不到。
const WALKABLE = { '.': 1, '@': 1, 'H': 1, 'U': 1, 'D': 1, 'W': 1 }
function isWalkable(ch) { return !!WALKABLE[ch] }
// 实体 = 既不是墙也不是可走格：门 / 钥匙 / 道具 / 怪物 / 商店 / NPC / 图鉴。
function isEntityTile(ch) { return ch !== '#' && !WALKABLE[ch] }

const DIR = {
  left:  [-1, 0], right: [1, 0],
  up:    [0, -1], down:  [0, 1]
}

function newGame() {
  const f0 = FLOORS[0]
  let sx = 1, sy = 1
  f0.rows.forEach((row, y) => {
    const x = row.indexOf('@')
    if (x >= 0) { sx = x; sy = y }
  })
  return {
    floor: 0, x: sx, y: sy,
    hero: JSON.parse(JSON.stringify(HERO0)),
    opened: {},          // { [floor]: { [idx]: newCh } } —— 只存变更集，不存整图快照
    explored: { 0: 1 },  // 到过的楼层；飞行器只允许跳回这里（出生层天然已探索）
    ended: null          // null | 'dead' | 'win'
  }
}

function clone(s) { return JSON.parse(JSON.stringify(s)) }
function width(floor) { return FLOORS[floor].rows[0].length }
function height(floor) { return FLOORS[floor].rows.length }

// 直读原始地图 + 叠加变更集；不做 m_xxx 缓存
function tileAt(s, x, y) {
  const rows = FLOORS[s.floor].rows
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return '#'
  const ov = s.opened[s.floor] && s.opened[s.floor][y * width(s.floor) + x]
  return ov !== undefined ? ov : rows[y][x]
}

// 目前所有变更都是「把该格清成地板」，serialize 依赖这一点做紧凑编码（只存下标，不存字符）。
function setTile(s, x, y, ch) {
  if (!s.opened[s.floor]) s.opened[s.floor] = {}
  s.opened[s.floor][y * width(s.floor) + x] = ch
}

// ---- 战斗结算：确定性、无随机（与经典 21/24/50 层魔塔同式）----
// 需打 rounds = ceil(敌HP/(我攻-敌防)) 回合；玩家先手故只承受 (rounds-1) 次反击；
// 每次净伤 = max(0, 敌攻-我防)。战斗一旦开始就打到底，不可撤退。
// floor：按层取实际怪物数值 —— 图鉴 / 战斗预览 / 结算 / solver 必须同源。
// pierce：法师系「真实伤害」，净伤直接取敌攻、无视 DEF（经典魔塔法师机制），
//         也是打破「堆防即可免疫一切」的关键设计。
function calcBattle(hero, mon, floor) {
  // v0.16 能量护盾（硬门槛）：屏障层起、未强化时，常规怪被能量护盾包裹，
  // 无论玩家堆多少攻防 / 商店买属性 / 法师兑经验都判「不可破防」。
  // 唯一解法是回 1F 用「能量核心 + 小精灵」完成强化（FAY_CHARGED 置位）。
  // 精英 X 与魔王 noScale 不套护盾，保持 v0.14 强敌 / 终局语义。
  const fl = floor == null ? 0 : floor
  if (BARRIER && fl >= BARRIER.floor && mon && !mon.elite && !mon.noScale &&
      !((hero.flags || 0) & FLAG.FAY_CHARGED)) {
    return { ok: false, reason: 'shield', rounds: 0, hpCost: 0,
             perHit: 0, monPerHit: 0 }
  }
  const m = scaledMon(mon, floor == null ? 0 : floor)
  let perHit = hero.atk - m.def
  if (perHit <= 0) {
    if (!CONFIG.MIN_DAMAGE_1) {
      return { ok: false, reason: 'unbreakable', rounds: 0, hpCost: 0, perHit, monPerHit: 0 }
    }
    perHit = 1
  }
  const rounds = Math.ceil(m.hp / perHit)
  const monPerHit = m.pierce ? m.atk : Math.max(0, m.atk - hero.def)
  const hpCost = (CONFIG.FIRST_STRIKE ? rounds - 1 : rounds) * monPerHit
  if (hpCost >= hero.hp) {
    return { ok: false, reason: 'lethal', rounds, hpCost, perHit, monPerHit }
  }
  return { ok: true, reason: '', rounds, hpCost, perHit, monPerHit }
}

// ---- 怪物手册：临界攻击 / 加防收益（经典魔塔怪物手册的核心策略信息）----
// 临界：还差多少攻击能把回合数从 R 降到 R-1（因为 perHit 变大）。
// 加防：每 +1 防御能少掉多少总血 = 承受的反击次数（pierce 怪为 0）。
// 纯计算、不写 state，宿主层与图鉴共用，也可被 node 校验。
function battleHint(hero, mon, floor) {
  const r = calcBattle(hero, mon, floor)
  if (r.reason === 'shield') return { breakAtk: null, nextAtk: null, defGain: 0, shield: true, r }
  if (r.reason === 'unbreakable') return { breakAtk: mon.def + 1 - hero.atk, nextAtk: null, defGain: 0, r }
  const hits = CONFIG.FIRST_STRIKE ? Math.max(0, r.rounds - 1) : r.rounds
  let nextAtk = null
  if (r.rounds > 1) {
    const m = scaledMon(mon, floor == null ? 0 : floor)
    const needPerHit = Math.ceil(m.hp / (r.rounds - 1))
    nextAtk = Math.max(0, m.def + needPerHit - hero.atk)
  }
  return {
    breakAtk: 0,
    nextAtk,                                   // 再 +nextAtk 攻，可少挨一回合
    defGain: mon.pierce ? 0 : hits,            // 每 +1 防少掉 defGain 血
    pierce: !!mon.pierce,
    r
  }
}

function applyEffect(hero, eff) {
  if (eff.hp)   hero.hp += eff.hp
  if (eff.atk)  hero.atk += eff.atk
  if (eff.def)  hero.def += eff.def
  if (eff.gold) hero.gold += eff.gold
  if (eff.fly)  hero.fly = 1          // v0.8：飞行器全塔唯一，持有即可，不累加、不消耗
  if (eff.bomb) hero.bomb += eff.bomb
  if (eff.book) hero.book = 1         // v0.8：图鉴拿到即永久解锁，不累加
  if (eff.key)  hero.keys[eff.key] += eff.n
  if (eff.flag) hero.flags = (hero.flags || 0) | eff.flag   // v0.13：任务/解锁标志位
}

// v0.13：击杀经验 = 怪物基础 exp × 楼层档（1~7F ×1 / 8~14F ×2 / 15~21F ×3）。
// 与 shopTier 同口径分档；魔王 exp=0（通关即终局）。
function monsterExp(mon, floor) {
  return (mon.exp || 0) * (shopTier(floor) + 1)
}

// ---- 一次输入 = 一次结算 = 一次视图提交 ----
// 纯函数：返回新 state + events，宿主层不参与任何数值计算
function resolveStep(prev, direction) {
  const s = clone(prev)
  const ev = []
  if (!s.explored) s.explored = {}
  if (s.ended) return { state: s, events: ev }

  const d = DIR[direction]
  if (!d) return { state: s, events: ev }
  const nx = s.x + d[0], ny = s.y + d[1]
  const t = tileAt(s, nx, ny)

  // 1. 墙 / 越界
  if (t === '#') { ev.push({ t: 'msg', text: '前方是墙' }); return { state: s, events: ev } }

  // 2. 门：按 DOOR_COST 扣钥匙 + 该格变地板。
  //    v0.13 起改为「撞门开门、停在原地」（用户原话：站在门旁边开门，开完停在原地，
  //    不要站在之前门的格子上），与 v0.11 怪物/道具的「撞一下」语义完全统一；
  //    门格已清成地板，再走一步才进去。v0.12 铁门 G 仍消耗 3 把黄钥匙。
  const needKey = DOOR_KEY[t]
  if (needKey) {
    const cost = DOOR_COST[t] || 1
    if (s.hero.keys[needKey] < cost) {
      const text = t === 'G'
        ? '铁门需要 ' + cost + ' 把黄钥匙（现有 ' + s.hero.keys[needKey] + ' 把）'
        : '缺少钥匙'
      ev.push({ t: 'msg', text }); return { state: s, events: ev }
    }
    s.hero.keys[needKey] -= cost
    setTile(s, nx, ny, '.')
    ev.push({ t: 'vibrate' }, { t: 'msg', text: '门已打开' }, { t: 'save' })
    if (t === 'G') ev.push({ t: 'msg', text: '铁门开启 · 耗 ' + cost + ' 把黄钥匙' })
    return { state: s, events: ev }
  }

  // 2.4 封印门 Z（v0.13）：16F 上楼唯一入口，三色钥匙都对不上符文锁，
  //     只有盗贼任务线（交还锁匠工具）能远程撬开。撞它只给提示。
  if (t === 'Z') {
    ev.push({ t: 'vibrate' }, {
      t: 'msg', text: '门上挂着符文锁，三色钥匙都对不上——也许盗贼有办法'
    })
    return { state: s, events: ev }
  }

  // 2.5 暗门 A（v0.12）：视觉与墙完全一致，只能主动「撞墙」才显形。
  //     墙后奖励由 SECRET 配置表给出（铁剑 / 铁盾 / 大血瓶 / 黄钥匙），直接结算；
  //     该格清成地板、英雄停在原地（沿用 v0.11「撞一下」），再走一步才进去。
  //     与 H 暗格的区别：H 在地板上、踩到就触发；A 在墙里、不撞永远看不见。
  if (t === 'A') {
    const sec = secretAt(s.floor, nx, ny)
    if (sec && itemById(sec.item)) applyEffect(s.hero, itemById(sec.item).effect)
    setTile(s, nx, ny, '.')
    ev.push({ t: 'vibrate' }, {
      t: 'msg', text: sec ? '撞开暗门：发现 ' + sec.name : '撞开暗门：后面是空墙'
    }, { t: 'save' })
    return { state: s, events: ev }
  }

  // 3. 怪物
  const mon = monsterByCh(t)
  if (mon) {
    const r = calcBattle(s.hero, mon, s.floor)
    if (!r.ok) {
      const text = r.reason === 'unbreakable'
        ? '攻击不足，无法破防'
        : r.reason === 'shield'
          ? '能量护盾挡住了攻击——带能量核心回 1F 找小精灵强化'
          : '硬拼会阵亡（需 ' + (r.hpCost + 1) + ' HP）'
      ev.push({ t: 'msg', text }, { t: 'vibrate' })
      return { state: s, events: ev }
    }
    s.hero.hp -= r.hpCost
    s.hero.gold += mon.gold
    const expGain = monsterExp(mon, s.floor)   // v0.13：击杀得经验，法师处可兑换攻防血
    s.hero.exp = (s.hero.exp || 0) + expGain
    setTile(s, nx, ny, '.')
    ev.push({ t: 'vibrate' }, {
      t: 'msg',
      text: '胜 ' + mon.name + ' -' + r.hpCost + 'HP +' + mon.gold + 'G +' + expGain + 'EXP'
    }, { t: 'save' })
    // v0.11 经典魔塔交互：撞怪 = 结算但不进入该格，英雄停在原地。
    // 怪格已清成地板，玩家再走一步才进去；门 / 楼梯 / 王座 / 暗格仍按各自语义移动。
    if (s.hero.hp <= 0) { s.ended = 'dead'; ev.push({ t: 'vibrate' }, { t: 'msg', text: '阵亡' }) }
    return { state: s, events: ev }
  }

  // 3.5 常驻 NPC（v0.13）：法师 M / 盗贼 T 救出后不清格、可反复撞上去对话，英雄停原地。
  //     它们仍在 ITEMS 表里（首次救出走 applyEffect 的通用奖励通道），
  //     但必须在本特判里拦截，否则会被下面的通用 item 分支清成地板。
  if (t === 'M') {
    if (!(s.hero.flags & FLAG.MAGE_FREED)) {
      applyEffect(s.hero, itemByCh('M').effect)
      s.hero.flags |= FLAG.MAGE_FREED
      ev.push({ t: 'vibrate' }, {
        t: 'msg', text: '已救出 被困的法师（防御 +8、生命 +100）'
      }, { t: 'save' })
    } else {
      // 已救出的法师 = 经验兑换商，真正的兑换由宿主层弹界面后调 mageBuy()
      ev.push({ t: 'msg', text: '法师：积攒的经验，要换点什么？' })
    }
    return { state: s, events: ev }
  }
  if (t === 'T') {
    const st = thiefStage(s.hero)
    if (st === 0) {
      applyEffect(s.hero, itemByCh('T').effect)
      setThiefStage(s.hero, 1)
      ev.push({ t: 'vibrate' }, {
        t: 'msg', text: '已救出 被困的盗贼（黄钥匙 +3、金币 +40）'
      }, { t: 'save' })
    } else if (st === 1) {
      if (s.hero.flags & FLAG.LOCKPICK) {
        s.hero.flags &= ~FLAG.LOCKPICK
        setThiefStage(s.hero, 2)
        const z = specialDoorPos()
        if (z) setTileAt(s, z.floor, z.x, z.y, '.')   // 远程撬开 16F 封印门
        ev.push({ t: 'vibrate' }, {
          t: 'msg', text: '盗贼掂了掂工具：16F 的封印门，开了'
        }, { t: 'save' })
      } else {
        ev.push({ t: 'msg', text: '盗贼：我的锁匠工具落在 13F 房间里，帮我找回来' })
      }
    } else if (st === 2) {
      if (s.hero.flags & FLAG.MONEYBAG) {
        s.hero.flags &= ~FLAG.MONEYBAG
        setThiefStage(s.hero, 3)
        s.hero.hp += 300; s.hero.atk += 5; s.hero.def += 5
        setTile(s, nx, ny, '.')   // 盗贼离塔，格子清空
        ev.push({ t: 'vibrate' }, {
          t: 'msg', text: '盗贼收下钱袋，留下谢礼后消失在暗道（生命 +300、攻 +5、防 +5）'
        }, { t: 'save' })
      } else {
        ev.push({ t: 'msg', text: '盗贼：19F 房间有我一袋钱，取来咱们两清' })
      }
    }
    return { state: s, events: ev }
  }

  // 3.6 v0.16 小精灵 e（1F 出生点旁常驻 NPC）：三态、可反复撞、英雄停原地、不清格。
  //   未持核心 -> 讲背景并暗示「带能量核心回来」；持核心且未强化 -> 消耗核心、
  //   一次性大幅强化（幅度在 BARRIER.charge 配置层，便于探针校准）；已强化 -> 闲聊。
  if (t === 'e') {
    const charged = !!(s.hero.flags & FLAG.FAY_CHARGED)
    const hasCore = !!(s.hero.flags & FLAG.CORE_HELD)
    if (charged) {
      ev.push({ t: 'msg', text: '小精灵：护盾已经散了，去塔顶吧' })
    } else if (hasCore) {
      const c = (BARRIER && BARRIER.charge) || { atk: 80, def: 60, hp: 1200 }
      s.hero.atk += c.atk; s.hero.def += c.def; s.hero.hp += c.hp
      s.hero.flags = (s.hero.flags & ~FLAG.CORE_HELD) | FLAG.FAY_CHARGED
      ev.push({ t: 'vibrate' }, {
        t: 'msg', text: '小精灵引动能量核心：攻 +' + c.atk + ' / 防 +' + c.def + ' / 生命 +' + c.hp
      }, { t: 'save' })
    } else {
      ev.push({ t: 'msg', text: '小精灵：塔上层被能量护盾锁着……带一枚能量核心回来找我' })
    }
    return { state: s, events: ev }
  }

  // 4. 道具 / 一次性 NPC（老者 E、任务道具 j/q 也走这里：effect.flag 写标志位后清格）
  const item = itemByCh(t)
  if (item) {
    applyEffect(s.hero, item.effect)
    setTile(s, nx, ny, '.')
    // 被救的法师 / 盗贼走同一个「一次性奖励」通道，只是文案是「救出」而不是「获得」
    const npc = item.id.indexOf('npc_') === 0
    if (npc) ev.push({ t: 'vibrate' })
    ev.push({ t: 'msg', text: (npc ? '已救出 ' : '获得 ') + item.name }, { t: 'save' })
    // v0.11：拾取 / 救出后停在原地，不踩进实体格（与战斗一致）。
    return { state: s, events: ev }
  }

  // 4.5 隐藏暗格：查 HIDDEN 配置表，触发后清成地板（不二次触发、不新增存档字段）
  if (t === 'H') {
    const h = hiddenAt(s.floor, nx, ny)
    if (h && itemById(h.item)) {
      applyEffect(s.hero, itemById(h.item).effect)
      setTile(s, nx, ny, '.')
      ev.push({ t: 'msg', text: '发现隐藏的 ' + h.name }, { t: 'vibrate' }, { t: 'save' })
    } else {
      setTile(s, nx, ny, '.')
      ev.push({ t: 'msg', text: '这里什么也没有' }, { t: 'save' })
    }
  }

  // 5. 换层（落点 = 相邻层的对向楼梯坐标）
  if (t === 'U' || t === 'D') {
    const nf = t === 'U' ? s.floor + 1 : s.floor - 1
    const target = FLOORS[nf]
    if (!target) { ev.push({ t: 'msg', text: '没有更多楼层' }); return { state: s, events: ev } }
    const landing = t === 'U' ? target.down : target.up
    s.floor = nf
    s.x = landing ? landing.x : 1
    s.y = landing ? landing.y : 1
    s.explored[nf] = 1        // v0.8：到过就算探索，飞行器只能跳回这里
    ev.push({ t: 'vibrate' }, { t: 'msg', text: '进入 ' + target.name }, { t: 'save' })
    return { state: s, events: ev }
  }

  // 6. 通关
  if (t === 'W') {
    s.x = nx; s.y = ny; s.ended = 'win'
    ev.push({ t: 'vibrate' }, { t: 'msg', text: '通关！魔王已被击败' }, { t: 'save' })
    return { state: s, events: ev }
  }

  // 7. 商店：v0.8 起商人也是「不可踩上去」的实体，撞上去只对话不移动。
  //    v0.13：首次撞商店写入 SHOP_SEEN（宿主层据此让「购买」按钮出现）；
  //    vibrate 让 step() 的 progressed 为 true，键盘撞商店也能弹交易框（补 v0.8 遗漏）。
  if (t === 'N') {
    if (!(s.hero.flags & FLAG.SHOP_SEEN)) {
      s.hero.flags |= FLAG.SHOP_SEEN
      ev.push({ t: 'save' })
    }
    ev.push({ t: 'vibrate' }, { t: 'msg', text: '商人：欢迎光临，看看货吧' })
    return { state: s, events: ev }
  }

  // 8. 落到目标格
  s.x = nx; s.y = ny
  if (s.hero.hp <= 0) {
    s.ended = 'dead'
    ev.push({ t: 'vibrate' }, { t: 'msg', text: '阵亡' }, { t: 'save' })
  }
  return { state: s, events: ev }
}

// ---- 可选机制：飞行器 ----
// v0.8：全塔唯一、拿到即永久持有（不消耗），且只能跳往「已探索过的楼层」。
// 这是中期道具：11F 房间取到后，可快速回跳已打通的层补道具，但不能当电梯无脑上顶层。
function useFly(prev, delta) {
  const s = clone(prev)
  const ev = []
  if (!s.explored) s.explored = {}
  if (s.ended) return { state: s, events: ev }
  if (!s.hero.fly) { ev.push({ t: 'msg', text: '还没有飞行器' }); return { state: s, events: ev } }
  const nf = s.floor + delta
  const target = FLOORS[nf]
  if (!target) { ev.push({ t: 'msg', text: '没有更多楼层' }); return { state: s, events: ev } }
  if (!s.explored[nf]) {
    ev.push({ t: 'msg', text: '飞行器只能前往已探索的楼层' })
    return { state: s, events: ev }
  }
  const landing = delta > 0 ? target.down : target.up
  s.floor = nf
  s.x = landing ? landing.x : 1
  s.y = landing ? landing.y : 1
  ev.push({ t: 'vibrate' }, {
    t: 'msg', text: '飞行器：' + (delta > 0 ? '上升' : '下降') + '到 ' + target.name
  }, { t: 'save' })
  return { state: s, events: ev }
}

// ---- 可选机制：炸弹 ----
// 消耗 1 个，消灭四邻格内的普通怪物（Boss 有 bombImmune，炸不动）。
// 无目标时不消耗，避免误操作浪费；炸死的怪不给金币（经典魔塔规则）。
function useBomb(prev) {
  const s = clone(prev)
  const ev = []
  if (s.ended) return { state: s, events: ev }
  if (s.hero.bomb <= 0) { ev.push({ t: 'msg', text: '没有炸弹了' }); return { state: s, events: ev } }
  const targets = []
  Object.keys(DIR).forEach(k => {
    const d = DIR[k]
    const x = s.x + d[0], y = s.y + d[1]
    const mon = monsterByCh(tileAt(s, x, y))
    if (mon && !mon.bombImmune) targets.push({ x, y, mon })
  })
  if (!targets.length) {
    ev.push({ t: 'msg', text: '四周没有可炸的怪物' })
    return { state: s, events: ev }
  }
  s.hero.bomb -= 1
  targets.forEach(t => setTile(s, t.x, t.y, '.'))
  ev.push({ t: 'vibrate' }, {
    t: 'msg', text: '炸弹！消灭 ' + targets.length + ' 个怪物'
  }, { t: 'save' })
  return { state: s, events: ev }
}

// ---- 可选机制：商店交易（经典魔塔「攻 / 防 / 生命」+ v0.12「黄钥匙」四选一）----
// 固定价 20G；攻/防/生命回报按楼层分档递增（经典 50 层「更高层同价回报更好」）。
// v0.12 钥匙经济：第 4 项 20G 补 1 把黄钥匙，专门供给铁门（原版商人卖黄/蓝钥匙）。
// 不进 BFS，纯可选增强；不新增存档字段，读档后价格与回报仍由当前层派生。
// 默认 kind='atk' 保持旧调用与 1F 断言（攻 +3）不变。
const SHOP_GOODS = [
  { kind: 'atk', label: '攻击', stat: 'atk' },
  { kind: 'def', label: '防御', stat: 'def' },
  { kind: 'hp',  label: '生命', stat: 'hp' },
  { kind: 'key', label: '黄钥匙', stat: 'key' },
  { kind: 'bomb', label: '炸弹', stat: 'bomb' }   // v0.13：需先救老者解锁
]

function shopTier(floor) {
  return Math.floor((floor || 0) / CONFIG.SHOP_TIER_FLOORS)
}

function shopOffer(kind, floor) {
  const good = SHOP_GOODS.find(g => g.kind === kind) || SHOP_GOODS[0]
  const tier = shopTier(floor)
  // 钥匙不按楼层档位加量：1 把就是 1 把，价格固定，铁门要几把就买几把
  if (good.kind === 'key') {
    return { kind: 'key', label: '黄钥匙', stat: 'key', amount: 1,
      cost: CONFIG.KEY_COST, tier }
  }
  // v0.13：炸弹也是固定量固定价（中后期能力，不随档位变强）
  if (good.kind === 'bomb') {
    return { kind: 'bomb', label: '炸弹', stat: 'bomb', amount: 1,
      cost: CONFIG.BOMB_COST, tier }
  }
  const amount = good.kind === 'hp'
    ? 100 + tier * 20 * CONFIG.SHOP_TIER_BONUS
    : CONFIG.SHOP_ATK + tier * CONFIG.SHOP_TIER_BONUS
  return { kind: good.kind, label: good.label, stat: good.stat,
    amount, cost: CONFIG.SHOP_COST, tier }
}

function shopBuy(prev, kind) {
  const s = clone(prev)
  const ev = []
  if (s.ended) return { state: s, events: ev }
  const offer = shopOffer(kind || 'atk', s.floor)
  // v0.13：炸弹是「技能型商品」，没救老者之前商人不会卖
  if (offer.kind === 'bomb' && !(s.hero.flags & FLAG.BOMB_UNLOCK)) {
    ev.push({ t: 'msg', text: '商人：这玩意儿太烈，得先懂行——听说 12F 关着位老者' })
    return { state: s, events: ev }
  }
  if (s.hero.gold < offer.cost) {
    ev.push({ t: 'msg', text: '金币不足（需 ' + offer.cost + 'G）' })
    return { state: s, events: ev }
  }
  s.hero.gold -= offer.cost
  if (offer.kind === 'key') s.hero.keys.y += offer.amount
  else s.hero[offer.stat] += offer.amount
  ev.push({ t: 'vibrate' }, {
    t: 'msg', text: '成交：' + offer.label + ' +' + offer.amount + '（-' + offer.cost + 'G）'
  }, { t: 'save' })
  return { state: s, events: ev }
}

// ---- v0.13：法师经验兑换（救出 8F 法师后常驻，30 经验换一次强化）----
// 与商店同构但花经验不花金币；量不按楼层档位（法师法力不因楼层变），
// 总量受「全塔经验约 900+」自然约束，约可换 30 次，与商店经济量级相当。
const MAGE_GOODS = [
  { kind: 'atk', label: '攻击', stat: 'atk', amount: 3 },
  { kind: 'def', label: '防御', stat: 'def', amount: 3 },
  { kind: 'hp',  label: '生命', stat: 'hp',  amount: 100 }
]

function mageBuy(prev, kind) {
  const s = clone(prev)
  const ev = []
  if (s.ended) return { state: s, events: ev }
  if (!(s.hero.flags & FLAG.MAGE_FREED)) {
    ev.push({ t: 'msg', text: '还没有救出法师（8F 房间）' })
    return { state: s, events: ev }
  }
  const g = MAGE_GOODS.find(x => x.kind === kind) || MAGE_GOODS[0]
  if ((s.hero.exp || 0) < CONFIG.EXP_COST) {
    ev.push({ t: 'msg', text: '经验不足（需 ' + CONFIG.EXP_COST + ' EXP，现有 ' + (s.hero.exp || 0) + '）' })
    return { state: s, events: ev }
  }
  s.hero.exp -= CONFIG.EXP_COST
  s.hero[g.stat] += g.amount
  ev.push({ t: 'vibrate' }, {
    t: 'msg', text: '法师施法：' + g.label + ' +' + g.amount + '（-' + CONFIG.EXP_COST + ' EXP）'
  }, { t: 'save' })
  return { state: s, events: ev }
}

// ---- 视图数据：定长 cells 数组，节点数恒定，靠整表赋值触发 diff ----
// tile 字段把原始字符透传给宿主层，供精灵表 / 音效 / 动画按配置映射；
// 逻辑层本身不引用任何资源名。
function buildCells(s) {
  const W = width(s.floor), H = height(s.floor), C = CONFIG.CELL
  const out = new Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const raw = tileAt(s, x, y)
      // '@' 只是 levels.json 里的出生点标记（仅 1F 一处），不是可渲染实体。
      // 若把它透传给宿主层，sprites.json 的 tileMap['@'] 会画成第二个英雄，
      // 出现「英雄走开后原地还站着一个单位」。在视图数据边界统一归一化成地板。
      const ch = raw === '@' ? '.' : raw
      const mon = monsterByCh(ch)
      const glyph = mon ? mon.ch : (TILE_CHAR[ch] || '')
      out[y * W + x] = {
        x: x * C, y: y * C,
        bg: mon ? mon.bg : (TILE_COLOR[ch] || TILE_COLOR['.']),
        ch: glyph,
        fg: '#ffffff',
        hasCh: !!glyph,
        tile: ch,
        isHero: x === s.x && y === s.y
      }
    }
  }
  return out
}

// ---- 存档：紧凑串，不是 JSON ----
// v4: "4|f,x,y,hp,atk,def,gold,ky,kb,kr,e,fly,bomb,book,exp,flags|fi.i.i;fi.i.i|0.3.4"
//   e     = 0 游戏中 / 1 阵亡 / 2 通关
//   book  = 0/1 是否已持有图鉴
//   exp   = 经验值（v0.13 击杀怪物获得，法师处兑换）
//   flags = 位字段（1 shopSeen / 2 bombUnlock / 4 lockpick / 8 moneybag / 16 mageFreed
//           / bit5-6 thiefStage），把「商店解锁、炸弹解锁、盗贼任务」压进一个整数。
//   第 3 段：每层已清成地板的格子下标（setTile 只会写 '.'，故不必存新字符）
//   第 4 段：已探索楼层（升序、点分）。飞行器只能跳回这里。
// v0.13 起【不再兼容 v1~v3 旧档】（用户已授权「开发阶段格式调整可放弃旧存档」）：
//   旧档若已救出 M/T/E 却带 flags=0，会与「常驻 NPC / 16F 封印门 Z」产生不可解的
//   矛盾（Z 永远开不了 -> 死档），因此旧档直接作废重开，deserialize 只认 '4'。
// 在线版用 localStorage，无 128B 硬限制；21 层 13×15 大地图通关存档实测约 1KB，
// SAVE_LIMIT 4096；真机移植时须恢复 128B 并改用位图压缩（见 spec 附 D）。
function serialize(s) {
  const h = s.hero
  const e = s.ended === 'dead' ? 1 : (s.ended === 'win' ? 2 : 0)
  const head = [
    s.floor, s.x, s.y,
    h.hp, h.atk, h.def, h.gold,
    h.keys.y, h.keys.b, h.keys.r, e,
    h.fly, h.bomb, h.book || 0,
    h.exp || 0, h.flags || 0
  ].join(',')
  const groups = []
  Object.keys(s.opened).forEach(f => {
    const idxs = Object.keys(s.opened[f])
    if (idxs.length) groups.push(f + ':' + idxs.join('.'))
  })
  const explored = Object.keys(s.explored || {})
    .filter(f => s.explored[f])
    .map(Number).sort((a, b) => a - b).join('.')
  return '4|' + head + '|' + groups.join(';') + '|' + explored
}

function deserialize(text) {
  if (typeof text !== 'string') return null
  const seg = text.split('|')
  if (seg[0] !== '4' || seg.length !== 4) return null

  const a = seg[1].split(',')
  if (a.length !== 16) return null
  const n = a.map(Number)
  if (n.some(v => !Number.isInteger(v) || v < 0)) return null
  const [floor, x, y, hp, atk, def, gold, ky, kb, kr, e, fly, bomb, book, exp, flags] = n
  // fly 在 v0.8 起语义收敛为 0/1（全塔唯一），上限仍用 99 兼容历史值；
  // v0.16：flags 用 9 个位（含 thiefStage 两位 + 能量核心 / 已强化），上限 511。
  if (!FLOORS[floor] || e > 2 || fly > 99 || bomb > 99 || book > 1 || flags > 511) return null
  const W = FLOORS[floor].rows[0].length, H = FLOORS[floor].rows.length
  if (x >= W || y >= H) return null

  const opened = {}
  if (seg[2]) {
    const groups = seg[2].split(';')
    for (let i = 0; i < groups.length; i++) {
      const kv = groups[i].split(':')
      if (kv.length !== 2) return null
      const f = Number(kv[0])
      if (!Number.isInteger(f) || !FLOORS[f]) return null
      const max = FLOORS[f].rows[0].length * FLOORS[f].rows.length
      const o = {}
      const parts = kv[1] ? kv[1].split('.') : []
      for (let j = 0; j < parts.length; j++) {
        const idx = Number(parts[j])
        if (!Number.isInteger(idx) || idx >= max) return null
        o[idx] = '.'
      }
      opened[f] = o
    }
  }

  const explored = {}
  if (seg[3]) {
    const parts = seg[3].split('.')
    for (let i = 0; i < parts.length; i++) {
      const f = Number(parts[i])
      if (!Number.isInteger(f) || !FLOORS[f]) return null
      explored[f] = 1
    }
  }
  explored[floor] = 1

  return {
    v: 4, floor, x, y,
    hero: { hp, atk, def, gold, exp, flags, keys: { y: ky, b: kb, r: kr }, fly, bomb, book },
    opened, explored,
    ended: e === 1 ? 'dead' : (e === 2 ? 'win' : null)
  }
}


// ===== 移植适配层（不改动上游逻辑，仅转换调用形态）=====
// logic.js 的 DIR 以字符串为 key，C 侧传 0..3 更自然
var DIR_BY_INDEX = ["up", "right", "down", "left"];
function stepByIndex(s, d) {
  var name = DIR_BY_INDEX[d];
  if (!name) return { state: s, events: [] };
  return resolveStep(s, name);
}
// 只取当前层地图字符，渲染层不需要 buildCells 里的颜色字符串
function floorRows(s) {
  var rows = [];
  for (var y = 0; y < FLOORS[s.floor].rows.length; y++) {
    var row = FLOORS[s.floor].rows[y], out = [];
    for (var x = 0; x < row.length; x++) out.push(tileAt(s, x, y));
    rows.push(out.join(""));
  }
  return rows;
}
// 整层压成一个字符串（行间 \n），C 侧一次 JS_ToCString 就拿到，避免 195 次跨语言调用
function floorString(s) { return floorRows(s).join("\n"); }

return { TILE_COLOR: TILE_COLOR, TILE_CHAR: TILE_CHAR, MONSTERS: MONSTERS, ITEMS: ITEMS, FLOORS: FLOORS, HERO0: HERO0, DOOR_KEY: DOOR_KEY, DOOR_COST: DOOR_COST, HIDDEN: HIDDEN, SECRET: SECRET, FLOOR_SCALE: FLOOR_SCALE, BARRIER: BARRIER, VIEWPORT: VIEWPORT, monsterByCh: monsterByCh, itemByCh: itemByCh, itemById: itemById, hiddenAt: hiddenAt, secretAt: secretAt, scaledMon: scaledMon, CONFIG: CONFIG, FLAG: FLAG, thiefStage: thiefStage, isWalkable: isWalkable, isEntityTile: isEntityTile, newGame: newGame, tileAt: tileAt, calcBattle: calcBattle, battleHint: battleHint, monsterExp: monsterExp, resolveStep: resolveStep, useFly: useFly, useBomb: useBomb, SHOP_GOODS: SHOP_GOODS, shopTier: shopTier, shopOffer: shopOffer, shopBuy: shopBuy, MAGE_GOODS: MAGE_GOODS, mageBuy: mageBuy, buildCells: buildCells, serialize: serialize, deserialize: deserialize, stepByIndex: stepByIndex, floorRows: floorRows, floorString: floorString };
})();
