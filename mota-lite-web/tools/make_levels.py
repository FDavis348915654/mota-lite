#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 21 层 13×15 主题大地图 levels.json（v0.12：暗门 / 铁门 / 钥匙经济）。

设计原则（保证可解 + 主题感 + 房间）：
- 13 列 × 15 行，边框全墙，内部 11×13 大厅。
- U 固定在 (11,13)、D 固定在 (1,1)（首层 @ 在 (1,1)，顶层无 U 改王座）。
  上楼落点取上层 D(1,1)，下楼落点取下层 U(11,13)，与 resolveStep 一致。
- 所有非墙格 flood fill 连通（门/怪/道具视为可通行，暗门 A 视作墙）；U/D 邻域保持开放，
  保证 solver 的贪心不会因「必经格被强怪/无钥匙门挡住」而死锁。
- 部分层用内墙围出「房间」，唯一开口放「门」，门外一格放守怪，房内放宝物 / 商人 / 法师 / 盗贼
  （NPC 与图鉴都用 ITEMS 里的字符表达，逻辑层零改动，仅新增 book 标志）。
- 飞行器 F 全塔唯一、放 11F；图鉴 I 放 5F；顶层 21F 王座 W 三面封墙 + 魔王把守。
- v0.10：门是「不可绕行的障碍」（经典魔塔规则），按层段分三色：黄 1~7F / 蓝 8~14F / 红 15~21F。
  房间层门封房间唯一开口 (6,8)；开放层砌墙封住上楼 U 的另一邻格、门放 (11,12)；
  顶层红门封王座唯一入口 (6,6)。每层三色钥匙各一，保证门可开；门必须主动点开才通行。
- v0.12 经典机制补全（联网核验经典 21/24/50 层魔塔后定的 Lite 口径）：
  · 暗门 A：伪装成普通砖墙（精灵/色块都与 # 一致），只能主动「撞墙」显形；撞开后墙后
    露出的宝物（铁剑 / 铁盾 / 大血瓶 / 黄钥匙）直接结算，格子清成地板，英雄停原地。
    对应原版 5F 撞假墙取铁剑、9F 暗墙取铁盾、19F 十字暗墙取十字架、16F 暗墙取圣水。
    每层 1 处，放在非关键内墙上，绝不碰房间墙 / 门 / 楼梯 / 王座邻域（不破坏唯一入口）。
  · 铁门 G：加厚门，需 3 把黄钥匙（对齐原版 34F「8 黄钥匙」、38F「三把蓝钥匙」的
    加厚门钥匙经济）。7F / 14F / 21F 的主路门升级为铁门，其余仍按三色分级。
  · 钥匙经济：地图每层三色钥匙各 1 + 暗门偶发黄钥匙 + 盗贼救出 +3 黄钥匙 + 商店
    20G 补黄钥匙，形成「攒 / 花 / 买」闭环；黄钥匙因此从 8F 起主要供给铁门。

v0.9 数值完整化（对齐经典魔塔「固定数值、可预计算」）：
- floorScale：21 组逐层「标准怪」数值，按每层玩家实测属性反推，
  目标「战斗回合数稳定 + 逐层损血递增」，彻底修掉 v0.8 的 100% 零伤。
- 怪物表扩到 8 种，按楼层段分层投放；石头人（高防低血）、法师/警卫（真实伤害
  无视防御）等经典怪种进场；房间开口守怪保持常规怪种，避免破防惩罚。
- theme 拼进 FLOORS[].name，运行时 HUD / 图鉴 / 日志直接可见。
- 魔王改为独立终局数值（noScale），成为真正的通关门槛。
生成逻辑与 /probe_final/gen_curve.py 的 s1 候选同源，可用 validate_levels.mjs 防漂移。
"""
import json, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 工程根目录（levels/ 在此）
W, H = 13, 15

THEMES = [
    '潮湿石厅', '商队歇脚', '骨与火把', '倾斜回廊', '藏书回廊',
    '断剑武库', '风井', '铁盾厅', '补给长廊', '塔之中点',
    '囚徒囚室', '蓝门之后', '断刃与骨', '风井回声', '半途之盾',
    '红门厅', '锈铁冷光', '收窄石阶', '最后的暗格', '王座下的静', '王座之间',
]

# 有房间的层（0-based）
ROOM_FLOORS = {1, 3, 5, 7, 10, 12, 14, 16, 18}
# 房间内容（1-based 层号 -> 类型）
ROOM_KIND = {
    2: 'merchant', 4: 'treasure', 6: 'codex', 8: 'mage', 11: 'fly',
    13: 'treasure', 15: 'thief', 17: 'merchant', 19: 'treasure',
}
FLY_FLOOR = 11      # 唯一飞行器（1-based，11F 房间）
BOSS_FLOOR = 21     # 顶层王座（1-based）

# v0.10：三色门按层段分级（经典魔塔：黄门基础 / 蓝门重要资源 / 红门关键路与 Boss）
# 正好对上主题名 12F「蓝门之后」、16F「红门厅」。
# v0.12：每 7 层一道铁门（7F / 14F / 21F），主路门升级为加厚门，消耗 3 把黄钥匙。
IRON_FLOORS = {7, 14, 21}
IRON_KEY_COST = 3


def door_char(n):   # n 为 1-based 层号
    if n in IRON_FLOORS: return 'G'
    if n <= 7:  return 'Y'
    if n <= 14: return 'B'
    return 'R'


def want_door(n):   # 校验脚本与摘要共用的门色口径
    return door_char(n)


# 暗门奖励：story key 对应 texts.js 的短剧情（按奖励类型复用，不写 21 段重复文案）。
# 【为什么不塞满铁剑/铁盾/大血瓶】v0.9 刚按每层实测属性校准了逐层难度曲线，
# 21 处暗门若每处 +10 攻防 / +200 HP，玩家 DEF 会提前越过怪 ATK，把「21/21 层掉血」
# 打回 v0.8 的 100% 零伤。所以暗门以「钥匙 + 小额补给」为主，只留 3 处经典彩蛋。
SECRET_REWARD = {
    0: ('key_y', '黄钥匙', 'secret_key'),
    1: ('potion_s', '小血瓶', 'secret_potion'),
    2: ('gold', '金币', 'secret_gold'),
    3: ('bomb', '炸弹', 'secret_bomb'),
}


def secret_reward(n):
    # 经典暗墙的叙事彩蛋（5F 假墙里的铁剑、9F 暗墙里的铁盾、19F 十字暗墙），
    # 但只给「锈剑上还亮着的宝石」+3 攻 / +3 防：直接给铁剑铁盾（+10）会让 DEF
    # 提前越过怪 ATK，把 v0.9 校准的 21/21 层掉血打回零伤，收益远大于这点彩蛋。
    if n == 5:  return ('gem_atk', '红宝石', 'secret_sword')
    if n == 9:  return ('gem_def', '蓝宝石', 'secret_shield')
    if n == 19: return ('key_y', '黄钥匙', 'secret_gem')
    # 1~7F：前 6 层普通黄门要花掉 6 把黄钥匙，7F 铁门又要 3 把，
    # 地图每层 1 把刚好卡在临界；前期暗门全补黄钥匙，第一道铁门才不会变成死局。
    if n <= 7:  return ('key_y', '黄钥匙', 'secret_key')
    return SECRET_REWARD[n % 4]

# hidden_Nf 文案 -> (item id, name)，保证「暗格奖励」与既有剧情文本一致
HIDDEN_REWARD = {
    1: ('gem_atk', '红宝石'), 3: ('potion_l', '大血瓶'), 4: ('key_r', '红钥匙'),
    5: ('shield', '铁盾'), 6: ('gem_def', '蓝宝石'), 7: ('potion_l', '大血瓶'),
    8: ('sword', '铁剑'), 10: ('potion_l', '大血瓶'), 11: ('gem_atk', '红宝石'),
    12: ('gem_def', '蓝宝石'), 13: ('sword', '铁剑'), 14: ('shield', '铁盾'),
    15: ('potion_s', '小血瓶'), 16: ('potion_l', '大血瓶'), 17: ('gem_atk', '红宝石'),
    18: ('gem_def', '蓝宝石'), 19: ('sword', '铁剑'), 20: ('shield', '铁盾'),
    21: ('gem_atk', '红宝石'),
}
HIDDEN_KEYS = set(HIDDEN_REWARD.keys())

# 房间内 NPC / 宝物字符（都在 ITEMS 里）
NPC_CHARS = ['M', 'T']  # 法师 / 盗贼

# ---- v0.9 数值曲线参数（与 /probe_final/gen_curve.py 的 s1 候选同源）----
# A/D 是 diag.mjs 实测的每层【首次进入时】玩家 ATK / DEF。玩家在层内
# 「先捡完道具再打怪」，故打该层怪时属性接近下一层首次进入值，用 A[f+1]/D[f+1] 建模。
CURVE_A = [23, 23, 26, 42, 52, 55, 58, 81, 91, 91, 97, 110, 133, 133,
           136, 149, 162, 162, 178, 191, 191]
CURVE_D = [20, 43, 46, 56, 76, 92, 95, 103, 113, 126, 132, 135, 155, 178,
           181, 181, 201, 217, 230, 240, 240]
CURVE_CFG = dict(loss0=24, lossK=2.4, rounds=3, defGap=6, atkFloor=16)
BOSS_FINAL = {'hp': 950, 'atk': 300, 'def': 56}

# 分层投放：低层入门怪 → 中层进阶 → 高层高危 → 顶层精英
def tier_chars(n):
    if n <= 5:   return ['1', '2']
    if n <= 11:  return ['2', '4', '6']
    if n <= 17:  return ['4', '5', '7']
    return ['5', '7', '8']


def retier_monsters(floors):
    """按楼层段替换主路怪字符。

    房间开口守怪格 (6,9) 是必经典「把门怪」，保持常规怪种，不换成
    石头人等破防怪 —— 否则玩家攻击刚过防时要打几十回合（6F 尖峰根因）。
    轮替起点用层号错开 (k+fi)，保证段内每种怪都能进场（否则每层只有
    2 只主路怪，三怪种的 pool 永远取不到第 3 项，石头人/魔法警卫会缺席）。
    只做字符替换，不改变连通性 / 楼梯 / 房内宝物。
    """
    for fi, f in enumerate(floors):
        n = fi + 1
        if n == 21:
            continue  # 王座层保留魔王阵
        pool = tier_chars(n)
        rows = [list(r) for r in f['rows']]
        k = 0
        for y in range(1, len(rows) - 1):
            for x in range(1, len(rows[0]) - 1):
                if x == 6 and y == 9:
                    continue
                if rows[y][x] in ('1', '2', '4'):
                    rows[y][x] = pool[(k + fi) % len(pool)]
                    k += 1
        f['rows'] = [''.join(r) for r in rows]


def count_mobs(floors):
    return [sum(''.join(f['rows']).count(c) for c in '1245678') for f in floors]


def build_floor_scale(cnt):
    """21 组逐层「标准怪」数值：按每层目标总损血 / 该层怪数摊薄，消除曲线锯齿。"""
    c = CURVE_CFG
    out = []
    for f in range(21):
        g = min(f + 1, 20)
        pa, pd = CURVE_A[g], CURVE_D[g]
        floor_loss = c['loss0'] + c['lossK'] * f
        per_mon = floor_loss / max(1, cnt[f])
        mph = max(2, per_mon / (c['rounds'] - 1))
        per_hit = max(8, round(pa * 0.7))
        atk = max(pd + c['defGap'], c['atkFloor'] + 4 * f) + mph
        dfn = max(0, pa - per_hit)
        hp = (c['rounds'] - 1) * per_hit + 1
        # mph 按该层怪数摊薄，怪数 2/3 交替会让 atk 出现 ±回落；
        # 前缀最大值钳制，保证「怪 ATK 逐层不回落」—— 玩家 DEF 增长始终追不上。
        atk = max(atk, out[-1]['atk']) if out else atk
        out.append({'hp': round(hp), 'atk': round(atk), 'def': round(dfn),
                    'targetLoss': round(floor_loss), 'mobs': cnt[f]})
    return out


def blank_grid():
    g = [['#'] * W for _ in range(H)]
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            g[y][x] = '.'
    return g


WALL = '#A'   # v0.12：暗门 A 视觉与墙完全一致，连通性判定也必须当墙，否则会凭空多出通路


def flood_ok(g):
    """所有非墙格从 (1,1) 可达则 True（暗门 A 视作墙）。"""
    start = (1, 1)
    if g[start[1]][start[0]] in WALL:
        return False
    seen = {start}
    q = [start]
    while q:
        x, y = q.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and g[ny][nx] not in WALL and (nx, ny) not in seen:
                seen.add((nx, ny)); q.append((nx, ny))
    for y in range(H):
        for x in range(W):
            if g[y][x] not in WALL and (x, y) not in seen:
                return False
    return True


def secret_forbidden(has_room):
    """暗门绝不能碰的坐标：房间墙/房内、门/楼梯/王座/出生点及其曼哈顿距离 2 邻域。

    关键：撞开暗门会把墙变成地板，若这面墙正好在门旁，就会绕过门形成第二个入口，
    v0.10 的「门封唯一入口」直接失效。所以宁可主动新砌一段内墙，也不动这些位置。
    """
    forbid = set()
    if has_room:
        for y in range(3, 10):
            for x in range(3, 10):
                forbid.add((x, y))
    anchors = [(1, 1), (11, 13), (10, 13), (11, 12), (6, 8), (6, 6), (6, 4), (6, 9)]
    for ax, ay in anchors:
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                forbid.add((ax + dx, ay + dy))
    return forbid


def add_secret(g, rng, floor_no, has_room):
    """在墙上挑一格改成暗门 A，返回 (x, y)；找不到就新砌一段内墙再取。

    暗门是「撞一下才显形」的支线奖励，不是必经路：生成阶段它始终计作墙，
    因此 flood_ok 的连通性结论与不放暗门时完全一致。
    """
    forbid = secret_forbidden(has_room)
    cand = []
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if g[y][x] != '#' or (x, y) in forbid:
                continue
            # 至少一个四邻是可站格，玩家才可能走过去撞它
            if any(g[ny][nx] not in WALL for nx, ny in
                   ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))):
                cand.append((x, y))
    if cand:
        x, y = cand[(floor_no * 7) % len(cand)]
        g[y][x] = 'A'
        return (x, y)
    # 没有合适的现成内墙（例如顶层王座台、或被保护集全挡住）：
    # 在普通地板上砌 1 格墙，flood_ok 通过再换成暗门，保证不切断主路。
    pool = [(x, y) for y in range(2, H - 2) for x in range(2, W - 2)
            if g[y][x] == '.' and (x, y) not in forbid]
    rng.shuffle(pool)
    for x, y in pool:
        g[y][x] = '#'
        if flood_ok(g):
            g[y][x] = 'A'
            return (x, y)
        g[y][x] = '.'
    return None


def room_rect(g):
    """在中央围一个 7×6 房间，留底部开口 (6,8)。返回 (房内坐标列表, 开口坐标)。"""
    for x in range(3, 10):
        g[3][x] = '#'
        if x != 6:
            g[8][x] = '#'
    for y in range(3, 9):
        g[y][3] = '#'
        g[y][9] = '#'
    g[8][6] = '.'  # 唯一开口
    inner = [(x, y) for y in range(4, 8) for x in range(4, 9)]
    return inner, (6, 8)


def candidate_pool(g, has_room):
    """大厅可放实体的坐标：非墙、避开楼梯邻域、避开房间墙与开口外守怪位。"""
    out = []
    protected = {(1, 1), (2, 1), (1, 2), (11, 13), (10, 13), (11, 12),
                 (11, 11), (10, 12), (10, 11), (11, 10)}  # v0.10：门口通路留空
    if has_room:
        protected |= {(6, 9)}
        for y in range(3, 9):
            for x in range(3, 10):
                protected.add((x, y))
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if g[y][x] == '.' and (x, y) not in protected:
                out.append((x, y))
    return out


def place_entities(g, rng, floor_no, has_room, inner, special):
    """在大厅按确定性布局铺实体；返回本层 H 坐标列表（供 hidden 配置）。"""
    pool = candidate_pool(g, has_room)
    rng.shuffle(pool)
    idx = 0

    def take():
        nonlocal idx
        c = pool[idx]; idx += 1
        return c

    hidden_here = []

    # 1) 强化道具 2 个（攻击/防御成长，保证后期能破魔王防）
    growth = ['a', 's', 'S', 'd']  # 红宝石+3atk / 铁剑+10atk / 铁盾+10def / 蓝宝石+3def
    for k in range(2):
        x, y = take(); g[y][x] = growth[(floor_no + k) % len(growth)]

    # 2) 血瓶 + 金币
    x, y = take(); g[y][x] = 'P' if floor_no % 2 else 'p'
    x, y = take(); g[y][x] = 'g'

    # 3) 钥匙（三色各一，保证任意门可开）
    for k in 'ybr':
        x, y = take(); g[y][x] = k

    # 4) v0.10：门不再随机撒在开放区（改由 make_floor 放在「唯一入口」）。
    #    这里仍消耗一个候选坐标，保持后续实体投放顺序与旧版完全一致，回归面最小。
    take()

    # 5) 弱怪 2 个（主路附近，早期即可打赢）
    weak = ['1', '2']
    for k in range(2):
        x, y = take(); g[y][x] = weak[(floor_no + k) % 2]

    # 6) 暗格 H（仅当该层有可用 story key）
    if floor_no in HIDDEN_KEYS:
        x, y = take(); g[y][x] = 'H'; hidden_here.append((x, y))

    # 7) 房间内容：宝物 / NPC / 商人 / 图鉴 / 飞行器
    if has_room:
        kind = ROOM_KIND.get(floor_no)
        rng.shuffle(inner)
        if kind == 'merchant':
            g[inner[0][1]][inner[0][0]] = 'N'   # 商人（商店）
            g[inner[1][1]][inner[1][0]] = 'S'   # 房内铁盾
        elif kind == 'mage':
            g[inner[0][1]][inner[0][0]] = 'M'   # 法师（救援奖励）
            g[inner[1][1]][inner[1][0]] = 'P'
        elif kind == 'thief':
            g[inner[0][1]][inner[0][0]] = 'T'   # 盗贼（救援奖励）
            g[inner[1][1]][inner[1][0]] = 'g'
        elif kind == 'codex':
            g[inner[0][1]][inner[0][0]] = 'I'   # 图鉴
            g[inner[1][1]][inner[1][0]] = 'a'
        elif kind == 'fly':
            g[inner[0][1]][inner[0][0]] = 'F'   # 唯一飞行器
            g[inner[1][1]][inner[1][0]] = 'd'
        else:  # treasure
            for c, (x, y) in zip(['S', 'P', 'a'], inner[:3]):
                g[y][x] = c
        # 房门口守怪（中等，支线；打不过也不影响通关）
        g[9][6] = '4' if floor_no % 2 else '2'

    return hidden_here


def make_boss_floor(rng):
    """顶层 21F：王座 W 三面封墙，正面 m3 魔王把守；其余大厅放成长道具。"""
    g = blank_grid()
    g[1][1] = 'D'
    # 王座台：W 在 (6,4)，上/左/右封墙，正面 (6,5) 放魔王
    wx, wy = 6, 4
    g[wy - 1][wx] = '#'
    g[wy][wx - 1] = '#'
    g[wy][wx + 1] = '#'
    g[wy][wx] = 'W'
    g[wy + 1][wx] = '3'   # 魔王 (6,5) 把守正面
    # v0.10：红门封王座唯一入口 (6,6)，左右 (5,5)/(7,5) 砌墙防止绕过门去打魔王
    g[5][5] = '#'; g[5][7] = '#'; g[6][6] = door_char(BOSS_FLOOR)
    pool = [(x, y) for y in range(1, H - 1) for x in range(1, W - 1)
            if g[y][x] == '.' and (x, y) not in
            {(1, 1), (2, 1), (1, 2), (6, 4), (6, 3), (5, 4), (7, 4), (6, 5),
             (6, 6), (5, 5), (7, 5)}]
    rng.shuffle(pool)
    # 顶层补强化道具，确保爬到时能破魔王防 + 扛住
    for c in ('s', 'a', 'S', 'd', 'P', 'P', 'a', 's'):
        x, y = pool.pop(); g[y][x] = c
    for c in ('1', '2', '1'):
        x, y = pool.pop(); g[y][x] = c
    for k in 'ybr':
        x, y = pool.pop(); g[y][x] = k
    # 暗格（门已改由结构放置，不再随机撒）
    x, y = pool.pop(); g[y][x] = 'H'
    # v0.12：顶层也留一处暗门（王座台附近的墙都在保护集里，会自动新砌内墙）
    sec = add_secret(g, rng, BOSS_FLOOR, False)
    assert sec, '顶层未能放置暗门'
    assert flood_ok(g), '顶层 flood fill 不连通'
    return g, [(x, y) for y in range(H) for x in range(W) if g[y][x] == 'H'], sec


def make_floor(floor_no):
    rng = random.Random(1000 + floor_no * 7919)
    if floor_no == BOSS_FLOOR:
        return make_boss_floor(rng)
    g = blank_grid()
    if floor_no == 1:
        g[1][1] = '@'
    else:
        g[1][1] = 'D'
    g[13][11] = 'U'

    has_room = (floor_no - 1) in ROOM_FLOORS
    inner, opening = ([], None)
    if has_room:
        inner, opening = room_rect(g)

    # 开放层：加几段短内墙增加走廊复杂度（不切断连通，失败则回退）
    if not has_room:
        for _ in range(5):
            x = rng.randint(2, 9); y = rng.randint(2, 12)
            horiz = rng.random() < 0.5
            seg = [(x + i if horiz else x, y if horiz else y + i) for i in range(2)]
            seg = [(a, b) for a, b in seg if 1 <= a <= 11 and 1 <= b <= 13]
            if len(seg) < 2:
                continue
            if any((a, b) in {(1, 1), (2, 1), (1, 2), (11, 13), (10, 13), (11, 12),
                            (11, 11), (10, 12), (10, 11), (11, 10)} for a, b in seg):
                continue
            old = [(a, b, g[b][a]) for a, b in seg]
            if any(g[b][a] != '.' for a, b in seg):
                continue
            for a, b in seg:
                g[b][a] = '#'
            if not flood_ok(g):
                for a, b, c in old:
                    g[b][a] = c

    # v0.10：门放在「唯一入口」，从此不可绕行 —— 房间口 / 上楼口
    if has_room:
        g[opening[1]][opening[0]] = door_char(floor_no)   # (6,8) 房间唯一开口
    else:
        # 上楼 U(11,13) 只有两个可走邻格：(10,13) 与 (11,12)。封其一、另一放门，
        # 门即成为「上楼唯一入口」。封哪一侧不能写死：随机短内墙可能恰好把某个角落
        # 切出去（14F 实测封 (10,13) 会把 (8,13)(9,13) 困成孤岛），故两种摆法都试，
        # 取 flood_ok 通过的那一种，保证门永远挡路且地图永远连通。
        door = door_char(floor_no)
        placed = False
        for wall, gate in [((10, 13), (11, 12)), ((11, 12), (10, 13))]:
            ow, og = g[wall[1]][wall[0]], g[gate[1]][gate[0]]
            g[wall[1]][wall[0]] = '#'
            g[gate[1]][gate[0]] = door
            if flood_ok(g):
                placed = True
                break
            g[wall[1]][wall[0]] = ow
            g[gate[1]][gate[0]] = og
        assert placed, f'{floor_no}F 上楼口无法封成唯一入口'

    hidden = place_entities(g, rng, floor_no, has_room, inner, None)

    # 飞行器兜底：11F 若因故不是房间层，仍保证全塔恰好一个 F
    if floor_no == FLY_FLOOR:
        cnt_F = sum(1 for row in g for c in row if c == 'F')
        if cnt_F == 0:
            pool = [c for c in candidate_pool(g, has_room) if g[c[1]][c[0]] == '.']
            x, y = rng.choice(pool); g[y][x] = 'F'
    # 图鉴只由 6F 房间 kind='codex' 产生，全塔唯一

    # v0.12：每层 1 处暗门（撞墙显形的支线奖励），最后放，避免占用实体候选池
    sec = add_secret(g, rng, floor_no, has_room)
    assert sec, f'{floor_no}F 未能放置暗门'
    assert flood_ok(g), f'{floor_no}F flood fill 不连通'
    return g, hidden, sec


def build():
    floors = []
    hidden_cfg = []
    secret_cfg = []
    for n in range(1, 22):
        g, hs, sec = make_floor(n)
        rows = [''.join(row) for row in g]
        f = {
            'name': f'{n}F',
            'theme': THEMES[n - 1],
            'story': f'floor_{n}f',
            'rows': rows,
        }
        if n > 1:
            f['down'] = {'x': 1, 'y': 1}
        if n < 21:
            f['up'] = {'x': 11, 'y': 13}
        floors.append(f)
        for (x, y) in hs:
            item_id, item_name = HIDDEN_REWARD[n]
            hidden_cfg.append({
                'floor': n - 1, 'x': x, 'y': y,
                'item': item_id, 'name': item_name,
                'story': f'hidden_{n}f',
            })
        if sec:
            item_id, item_name, story_key = secret_reward(n)
            secret_cfg.append({
                'floor': n - 1, 'x': sec[0], 'y': sec[1],
                'item': item_id, 'name': item_name, 'story': story_key,
            })

    items = [
        {'id': 'potion_s', 'ch': 'p', 'name': '小血瓶', 'effect': {'hp': 50}},
        {'id': 'potion_l', 'ch': 'P', 'name': '大血瓶', 'effect': {'hp': 200}},
        {'id': 'gem_atk', 'ch': 'a', 'name': '红宝石', 'effect': {'atk': 3}},
        {'id': 'gem_def', 'ch': 'd', 'name': '蓝宝石', 'effect': {'def': 3}},
        {'id': 'sword', 'ch': 's', 'name': '铁剑', 'effect': {'atk': 10}},
        {'id': 'shield', 'ch': 'S', 'name': '铁盾', 'effect': {'def': 10}},
        {'id': 'key_y', 'ch': 'y', 'name': '黄钥匙', 'effect': {'key': 'y', 'n': 1}},
        {'id': 'key_b', 'ch': 'b', 'name': '蓝钥匙', 'effect': {'key': 'b', 'n': 1}},
        {'id': 'key_r', 'ch': 'r', 'name': '红钥匙', 'effect': {'key': 'r', 'n': 1}},
        {'id': 'gold', 'ch': 'g', 'name': '金币', 'effect': {'gold': 20}},
        {'id': 'fly', 'ch': 'F', 'name': '飞行器', 'effect': {'fly': 1}},
        {'id': 'bomb', 'ch': 'o', 'name': '炸弹', 'effect': {'bomb': 1}},
        {'id': 'codex', 'ch': 'I', 'name': '怪物图鉴', 'effect': {'book': 1}},
        {'id': 'npc_mage', 'ch': 'M', 'name': '被困的法师', 'effect': {'def': 8, 'hp': 100}},
        {'id': 'npc_thief', 'ch': 'T', 'name': '被困的盗贼', 'effect': {'key': 'y', 'n': 3, 'gold': 40}},
    ]
    # v0.9：8 种怪。基础数值只作「未缩放」兜底，运行时由 FLOOR_SCALE[层] × 权重派生。
    # 经典魔塔怪种分工：石头人高防低血（破防博弈）、法师/警卫真实伤害（无视防御）。
    monsters = [
        {'id': 'm1', 'ch': '1', 'name': '史莱姆', 'hp': 20, 'atk': 8, 'def': 2, 'gold': 3,
         'bg': '#4caf50', 'hpW': 0.85, 'atkW': 0.9, 'defW': 0.8},
        {'id': 'm2', 'ch': '2', 'name': '蝙蝠', 'hp': 35, 'atk': 14, 'def': 5, 'gold': 6,
         'bg': '#7e57c2', 'hpW': 1.0, 'atkW': 1.0, 'defW': 1.0},
        {'id': 'm4', 'ch': '4', 'name': '骷髅兵', 'hp': 50, 'atk': 20, 'def': 8, 'gold': 10,
         'bg': '#b0bec5', 'hpW': 1.1, 'atkW': 1.05, 'defW': 1.1},
        {'id': 'm6', 'ch': '6', 'name': '石头人', 'hp': 60, 'atk': 12, 'def': 26, 'gold': 14,
         'bg': '#8d6e63', 'hpW': 0.7, 'atkW': 0.85, 'defW': 1.7},
        {'id': 'm7', 'ch': '7', 'name': '兽人', 'hp': 55, 'atk': 24, 'def': 7, 'gold': 15,
         'bg': '#d84315', 'hpW': 1.15, 'atkW': 1.15, 'defW': 0.9},
        {'id': 'm5', 'ch': '5', 'name': '暗法师', 'hp': 45, 'atk': 26, 'def': 6, 'gold': 16,
         'bg': '#5c6bc0', 'hpW': 0.9, 'atkW': 0.16, 'defW': 0.8, 'pierce': True},
        {'id': 'm8', 'ch': '8', 'name': '魔法警卫', 'hp': 50, 'atk': 20, 'def': 10, 'gold': 18,
         'bg': '#00897b', 'hpW': 1.0, 'atkW': 0.20, 'defW': 1.0, 'pierce': True},
        # 魔王：独立终局数值，不参与逐层缩放（经典魔塔 Boss 惯例）
        {'id': 'm3', 'ch': '3', 'name': '魔王', 'hp': BOSS_FINAL['hp'],
         'atk': BOSS_FINAL['atk'], 'def': BOSS_FINAL['def'], 'gold': 0,
         'bg': '#e53935', 'bombImmune': True, 'noScale': True},
    ]
    tile_char = {
        'Y': '门', 'B': '门', 'R': '门', 'G': '铁', 'A': '',
        'y': '钥', 'b': '钥', 'r': '钥',
        'p': '+', 'P': '++', 'a': '攻', 'd': '防', 's': '剑', 'S': '盾', 'g': '金',
        'F': '飞', 'o': '炸', 'I': '鉴', 'M': '法', 'T': '盗', 'H': '',
        'U': '↑', 'D': '↓', 'W': '王', 'N': '商',
    }
    tile_color = {
        '#': '#37474f', '.': '#1b2430', '@': '#1b2430',
        'A': '#37474f', 'G': '#8d99a6',
        'Y': '#e6a23c', 'B': '#3a86e8', 'R': '#e5534b',
        'y': '#ffd54f', 'b': '#64b5f6', 'r': '#ef9a9a',
        'p': '#ef5350', 'P': '#e53935', 'a': '#ff5252', 'd': '#448aff',
        's': '#cfd8dc', 'S': '#90a4ae', 'g': '#ffca28',
        'F': '#4dd0e1', 'o': '#546e7a', 'I': '#ba68c8', 'M': '#7e57c2', 'T': '#8d6e63',
        'H': '#1b2430', 'U': '#66bb6a', 'D': '#8d6e63', 'W': '#ab47bc', 'N': '#26c6da',
    }
    # v0.9：主题接线（拼进 name，HUD / 图鉴 / 载入日志直接可见）
    for f in floors:
        f['name'] = f['name'] + ' · ' + f['theme']
    # v0.9：分层怪种投放（只换字符，不动连通性 / 楼梯 / 房内宝物）
    retier_monsters(floors)
    # v0.9：逐层强度曲线，按每层实际怪数摊薄目标损血
    mob_cnt = count_mobs(floors)
    floor_scale = build_floor_scale(mob_cnt)

    data = {
        'meta': {
            'schema': 4,
            'note': '关卡配置唯一编辑源（21 层 × 13×15 主题大地图 + v0.9 逐层强度曲线 + v0.10 三色门封唯一入口 + v0.12 暗门/铁门/钥匙经济）。改这里，然后跑 python3 tools/build_tables.py 重新生成 tables.js；不要手改 tables.js。',
            'generator': 'tools/make_levels.py', 'output': 'tables.js',
            'mapSize': {'cols': W, 'rows': H},
            'viewport': {'cols': 7, 'rows': 9},
            'curve': CURVE_CFG,
        },
        'tileColor': tile_color,
        'tileChar': tile_char,
        'monsters': monsters,
        'items': items,
        'floors': floors,
        'hero0': {'hp': 200, 'atk': 10, 'def': 10, 'gold': 0,
                  'keys': {'y': 0, 'b': 0, 'r': 0}, 'fly': 0, 'bomb': 0, 'book': 0},
        'doorKey': {'Y': 'y', 'B': 'b', 'R': 'r', 'G': 'y'},
        'doorCost': {'Y': 1, 'B': 1, 'R': 1, 'G': IRON_KEY_COST},
        'hidden': hidden_cfg,
        'secret': secret_cfg,
        'floorScale': floor_scale,
    }
    with open(os.path.join(ROOT, 'levels', 'levels.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 摘要
    print('生成 21 层 13×15：')
    for i, f in enumerate(floors):
        entities = sum(1 for r in f['rows'] for c in r if c not in '#.@A')
        room = '有房间' if i in ROOM_FLOORS else ('王座' if i == 20 else '开放')
        special = ['门' + {'Y': '黄', 'B': '蓝', 'R': '红', 'G': '铁'}[door_char(i + 1)]]
        joined = ''.join(f['rows'])
        if 'A' in joined: special.append('暗门A')
        if 'I' in joined: special.append('图鉴I')
        if 'F' in joined: special.append('飞行器F')
        if 'M' in joined: special.append('法师M')
        if 'T' in joined: special.append('盗贼T')
        if 'N' in joined: special.append('商人N')
        print(f"  {i+1:2d}F {f['theme']:6s} {room:5s} 实体{entities:2d} " + ' '.join(special))
    total_F = sum(''.join(f['rows']).count('F') for f in floors)
    print('飞行器 F 总数:', total_F, '（应为 1）')
    print('图鉴 I 总数:', sum(''.join(f['rows']).count('I') for f in floors))
    print('hidden 暗格处数:', len(hidden_cfg))
    print('暗门 A 处数:', sum(''.join(f['rows']).count('A') for f in floors), '/ secret 配置:', len(secret_cfg))
    print('铁门 G 处数:', sum(''.join(f['rows']).count('G') for f in floors),
          '（7F / 14F / 21F，每道需', IRON_KEY_COST, '把黄钥匙）')


if __name__ == '__main__':
    build()
