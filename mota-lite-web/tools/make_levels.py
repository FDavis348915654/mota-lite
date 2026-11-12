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
ROOM_FLOORS = {1, 3, 5, 7, 10, 11, 12, 14, 16, 18}
# 房间内容（1-based 层号 -> 类型）
ROOM_KIND = {
    2: 'merchant', 4: 'treasure', 6: 'codex', 8: 'mage', 11: 'fly',
    12: 'elder', 13: 'treasure', 15: 'thief', 17: 'merchant', 19: 'treasure',
}
# v0.13：16F 上楼唯一入口改放「特殊封印门 Z」——三色钥匙都开不了，
# 只有完成盗贼任务线（15F 救盗贼 -> 13F 找回锁匠工具 -> 交给盗贼）才会被远程撬开。
# 这就是用户要求的「不开就过不去、走不到后面楼层」的硬门槛。
SPECIAL_DOOR_FLOOR = 16
FLY_FLOOR = 11      # 唯一飞行器（1-based，11F 房间）
BOSS_FLOOR = 21     # 顶层王座（1-based）

# v0.10：三色门按层段分级（经典魔塔：黄门基础 / 蓝门重要资源 / 红门关键路与 Boss）
# 正好对上主题名 12F「蓝门之后」、16F「红门厅」。
# v0.12：每 7 层一道铁门（7F / 14F / 21F），主路门升级为加厚门，消耗 3 把黄钥匙。
IRON_FLOORS = {7, 14, 21}
IRON_KEY_COST = 3

# ---- v0.14：关卡设计深度（隔间 / 加密实体 / 强敌守宝库）----
# 精英怪分散在每 3 层，与普通怪同层混放，不设独立「挑战层」（用户要求）；
# 每处守一个墙围死胡同宝库，击败后拿里面的属性成长道具，难度与收益对等。
ELITE_FLOORS = {3, 9, 14, 18}           # 1-based，共 4 处，全在开放层（避开 16F Z / 19F q / 15F T 等特殊层）
ELITE_SHIFT = 9                          # 强度超前 9 层（用户选「超前 8~10 层」）
ELITE_CH = 'X'                           # 宝库守卫字符（原字符集未占用）
BASE_MOBS = 5                            # 每层普通怪目标数（原 2~3）

# ---- v0.16：小精灵 / 能量核心 / 屏障护盾 --------------------------------
# 用户三项确认（AskUserQuestion 全选推荐）：核心 13F / 卡关 17F；
# 能量护盾硬门槛；怪 9->12 + 全塔损血上调约 30%。
#   1F 出生点旁放常驻小精灵 e：未持核心讲背景 / 持核心则一次性大幅强化；
#   13F treasure 房放全塔唯一能量核心 C（与锁匠工具 j 同房，通关必经，
#   玩家不可能「跳过核心直接卡死在 17F」）；
#   17F 起怪物数值上台阶，未强化时额外带「能量护盾」强制不可破防 ——
#   商店买攻防 / 法师兑经验都绕不过，保证「不回去强化就一定过不去」。
FAIRY_CH = 'e'
CORE_CH = 'C'
CORE_FLOOR = 13          # 1-based
BARRIER_FLOOR = 17       # 1-based
BARRIER_BOOST = {'hp': 1.5, 'atk': 1.25, 'def': 1.45}
FAIRY_CHARGE = {'atk': 80, 'def': 60, 'hp': 1200}

# 门 / 楼梯 / 房间 / 王座的保护邻域：隔间墙与宝库都不得占用
PROTECTED_BASE = {(1, 1), (2, 1), (1, 2), (11, 13), (10, 13), (11, 12),
                  (11, 11), (10, 12), (10, 11), (11, 10)}


def protected_cells(has_room):
    """隔间墙 / 宝库共用：楼梯与上楼口邻域；房间层再排除整个中央房间区。

    开放层并没有中央房间，故不保护 (6,8)/(6,6)/(6,9) 这类房间锚点 ——
    否则会白白吃掉地图中心，导致加密后找不到放宝库的连续空白。
    """
    p = set(PROTECTED_BASE)
    if has_room:
        p |= {(x, y) for y in range(3, 10) for x in range(3, 10)}
    return p


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
# v0.13：暗门轮换奖励移除炸弹（炸弹改为 12F 老者剧情解锁 + 商店购买的中后期能力），
# 空出的档位换成金币——与「炸弹不再是地图拾取物」的口径一致。
SECRET_REWARD = {
    0: ('key_y', '黄钥匙', 'secret_key'),
    1: ('potion_s', '小血瓶', 'secret_potion'),
    2: ('gold', '金币', 'secret_gold'),
    3: ('gold', '金币', 'secret_gold'),
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
CURVE_CFG = dict(loss0=24, lossK=2.4, rounds=3, defGap=6, atkFloor=16, lossMul=1.3)
# v0.16：精灵大幅强化后玩家终局 DEF 约 338，旧 atk=300 会让魔王战零伤
# （v0.15 为 -110HP）。提到 380 使终局仍有 3×(380-338)=126 左右损血，
# 保持「难度提高」下 Boss 战不至于毫无压力；裸属性仍破不了魔王的防。
BOSS_FINAL = {'hp': 950, 'atk': 380, 'def': 56}

# 分层投放：低层入门怪 → 中层进阶 → 高层高危 → 顶层精英
def tier_chars(n):
    if n <= 5:   return ['1', '2']
    if n <= 11:  return ['2', '4', '6']
    if n <= 17:  return ['4', '5', '7']
    return ['5', '7', '8']


def retier_monsters(floors, skip_by_floor=None):
    """按楼层段替换主路怪字符。

    房间开口守怪格 (6,9) 是必经典「把门怪」，保持常规怪种，不换成
    石头人等破防怪 —— 否则玩家攻击刚过防时要打几十回合（6F 尖峰根因）。
    轮替起点用层号错开 (k+fi)，保证段内每种怪都能进场（否则每层只有
    2 只主路怪，三怪种的 pool 永远取不到第 3 项，石头人/魔法警卫会缺席）。
    只做字符替换，不改变连通性 / 楼梯 / 房内宝物。
    v0.15：skip_by_floor 传入瓶颈格与凹室入口。守路怪 / 守护怪是唯一通道
    上的「必打怪」，必须保持 guard_pool 选的常规怪种；一旦被替换成破防怪
    或 pierce 真实伤害怪，进层打不过就会把主路切断成死局。
    """
    for fi, f in enumerate(floors):
        n = fi + 1
        if n == 21:
            continue  # 王座层保留魔王阵
        pool = tier_chars(n)
        rows = [list(r) for r in f['rows']]
        skip = {(6, 9)}
        if skip_by_floor:
            skip |= set(skip_by_floor[fi])
        k = 0
        for y in range(1, len(rows) - 1):
            for x in range(1, len(rows[0]) - 1):
                if (x, y) in skip:
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
        floor_loss = (c['loss0'] + c['lossK'] * f) * c.get('lossMul', 1.0)
        per_mon = floor_loss / max(1, cnt[f])
        mph = max(2, per_mon / (c['rounds'] - 1))
        per_hit = max(8, round(pa * 0.7))
        # v0.14 校准实录：曾试过把 defGap 按怪数摊薄，想抵消「加怪抬难度」，
        # 但 atk 的基数是 CURVE_D（下层玩家 DEF 建模值），solver「先捡道具再
        # 打怪」时实际 DEF 比它低，摊薄 gap 只减了零头、怪数却翻倍，低层总
        # 损血反而被放大（19F 死局）。故保留 v0.9 原曲线，改用「精英怪单独
        # 加权」拉开强度差距 —— 普通怪难度与 v0.13 同口径。
        atk = max(pd + c['defGap'], c['atkFloor'] + 4 * f) + mph
        dfn = max(0, pa - per_hit)
        hp = (c['rounds'] - 1) * per_hit + 1
        # mph 按该层怪数摊薄，怪数 2/3 交替会让 atk 出现 ±回落；
        # 前缀最大值钳制，保证「怪 ATK 逐层不回落」—— 玩家 DEF 增长始终追不上。
        atk = max(atk, out[-1]['atk']) if out else atk
        out.append({'hp': round(hp), 'atk': round(atk), 'def': round(dfn),
                    'targetLoss': round(floor_loss), 'mobs': cnt[f]})

    # v0.14：精英怪取 FLOOR_SCALE[floor + ELITE_SHIFT]。18F 精英会索引到 26，
    # 越过 21 层，故按末 3 组平均增量线性外推，保持「超前 9 层」的强度语义，
    # 避免高层精英退化成「当层就能打」。外推段只供精英使用，普通怪索引恒在 0~20。
    last, prev = out[-1], out[-4]
    step = {
        'hp': max(1, round((last['hp'] - prev['hp']) / 3)),
        'atk': max(1, round((last['atk'] - prev['atk']) / 3)),
        'def': max(1, round((last['def'] - prev['def']) / 3)),
    }
    for k in range(ELITE_SHIFT):
        out.append({
            'hp': last['hp'] + step['hp'] * (k + 1),
            'atk': last['atk'] + step['atk'] * (k + 1),
            'def': last['def'] + step['def'] * (k + 1),
            'targetLoss': last['targetLoss'], 'mobs': last['mobs'],
        })
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


def add_secret(g, rng, floor_no, has_room, extra_forbid=None, forbid_rows=None):
    """在墙上挑一格改成暗门 A，返回 (x, y)；找不到就新砌一段内墙再取。

    暗门是「撞一下才显形」的支线奖励，不是必经路：生成阶段它始终计作墙，
    因此 flood_ok 的连通性结论与不放暗门时完全一致。
    v0.14：extra_forbid 传入宝库新砌的墙，避免暗门恰好撞在宝库墙上、
    显形后形成绕过精英怪的第二个入口。
    v0.15：forbid_rows 传入闸墙所在行。闸墙是整行贯通的割点，暗门若落在
    闸墙上，撞开显形后等于凭空多出一个缺口，守路怪的拦路语义直接失效。
    """
    forbid = secret_forbidden(has_room)
    if extra_forbid:
        forbid |= set(extra_forbid)
    fr = set(forbid_rows or ())
    # v0.14 加密实体后，若只判「非墙」，会出现暗门唯一邻格是血瓶 / 宝石
    # 这类实体格的情况（8F / 14F 实测）——玩家得先捡道具清格才能撞。
    # 改为要求至少一个真正的可走格（. @ H U D W）。
    WALK_CH = '.@HUDW'
    def has_walk_neighbor(x, y):
        return any(g[ny][nx] in WALK_CH for nx, ny in
                   ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    cand = []
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if g[y][x] != '#' or (x, y) in forbid or y in fr:
                continue
            # 至少一个四邻是可走格，玩家才可能走过去撞它
            if has_walk_neighbor(x, y):
                cand.append((x, y))
    if cand:
        x, y = cand[(floor_no * 7) % len(cand)]
        g[y][x] = 'A'
        return (x, y)
    # 没有合适的现成内墙（例如顶层王座台、或被保护集全挡住）：
    # 在普通地板上砌 1 格墙，flood_ok 通过再换成暗门，保证不切断主路。
    pool = [(x, y) for y in range(2, H - 2) for x in range(2, W - 2)
            if g[y][x] == '.' and (x, y) not in forbid and y not in fr]
    rng.shuffle(pool)
    for x, y in pool:
        if not has_walk_neighbor(x, y):
            continue
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


def candidate_pool(g, has_room, avoid=None):
    """大厅可放实体的坐标：非墙、避开楼梯邻域、避开房间墙与开口外守怪位。

    v0.14：avoid 传入宝库入口的接近格，避免实体投放把「撞强敌前唯一可站格」
    占成血瓶 / 宝石（9F 实测），玩家就不必先清道具才能接近守卫。
    """
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
            if g[y][x] == '.' and (x, y) not in protected and (not avoid or (x, y) not in avoid):
                out.append((x, y))
    return out


# ---- v0.15：走廊骨架（横贯闸墙 + 单格瓶颈）+ 支路凹室 ----
# 用户反馈「基本没有怪物拦路、可以毫无阻碍进入后一层」。根因（node 探针实测）：
# v0.14 每层空地 80~92 格、怪随机撒在候选池，(1,1)->U(11,13) 最短 22 步
# = 曼哈顿直线，路上只踩 0~3 只怪；上楼门钥匙本层地上白捡，2F 甚至能
# 纯空地 24 步零战斗直达 U。
# 改法：横贯闸墙把大厅切成若干带，每道墙只留 1 格缺口（真割点），缺口站
# 「守路怪」；支路凹室三面墙 + 入口守护怪，把强化道具/补给变成清支线才有。
# 数值口径不变：怪数进 count_mobs -> build_floor_scale 按怪数摊薄目标总损血，
# 单层总损血仍等于 CURVE_CFG 的 loss0+lossK*f，战斗场次变多、每场更轻。
GATE_TARGET = 3
GUARD_LOW = ['1', '2']
GUARD_MID = ['2', '4']
GUARD_HIGH = ['4', '7']
ALCOVE_COUNT = 2
TARGET_MOBS = 12
ALCOVE_LOOT = ['a', 'd', 'P', 'g']   # 红宝石 / 蓝宝石 / 大血瓶 / 金币（不破坏攻防曲线）


def guard_pool(n):
    """守路怪只用常规怪种，且必须「进层就打得过」。

    m6 石头人 defW=1.7 会造破防尖峰（v0.9 的 6F 根因），m5/m8 法师 pierce
    真实伤害会绕开按 DEF 建模的损血曲线。瓶颈是唯一通道，一旦打不过，
    findPath 把怪当墙、上下两带断开 -> 整层死局。故严格限定常规怪种。
    """
    if n <= 5:  return GUARD_LOW
    if n <= 11: return GUARD_MID
    return GUARD_HIGH


def _reach(g, start, goal, blocked=None):
    """生成期 BFS：暗门 A 视作墙，blocked 坐标也当墙。用于割点验证。"""
    eb = set(blocked or ())
    if start in eb or g[start[1]][start[0]] in WALL:
        return False
    seen = {start}
    q = [start]
    while q:
        x, y = q.pop()
        if (x, y) == goal:
            return True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H): continue
            if (nx, ny) in seen or (nx, ny) in eb: continue
            if g[ny][nx] in WALL: continue
            seen.add((nx, ny)); q.append((nx, ny))
    return False


def start_region(g, gates):
    """「第一带」：从 (1,1) 出发、把闸墙缺口当墙后仍可达的格。

    v0.9 的 CURVE_A / CURVE_D 是按「玩家进层先捡完道具、再打怪」建模的，
    1F 裸属性 ATK10/DEF10 连史莱姆都打不过，靠的就是先捡铁剑铁盾。
    v0.15 的闸墙会把道具隔到守路怪后面，形成「打不过怪 -> 拿不到道具 ->
    更打不过」的死局（实测 1F 第 1 轮 lethal）。故成长道具 / 血瓶必须
    固定投放到第一带，其余资源才放到后带由支线怪把守。
    """
    blocked = set(gates)
    if g[1][1] in WALL:
        return set()
    seen = {(1, 1)}
    q = [(1, 1)]
    while q:
        x, y = q.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H): continue
            if (nx, ny) in seen or (nx, ny) in blocked: continue
            if g[ny][nx] in WALL or g[ny][nx] in 'YBRGZT': continue
            seen.add((nx, ny)); q.append((nx, ny))
    return seen


def gate_skeleton(g, rng, floor_no, has_room, vault_cells):
    """横贯闸墙 + 单格缺口；返回瓶颈坐标 [(x, y)]。

    每道闸墙把某一行 x=1..W-2 全砌墙、只留 gx 一格缺口。整行贯通 => 上下
    两带之间除缺口外无路可走，堵住缺口 U 即不可达（真割点）。缺口 x 按层
    号错开、下一道翻到另一侧，形成蛇形主路。逐道 flood_ok + 割点双验证，
    失败整行回退。
    房间层 y3~8 跳过：中央房间只经 (6,8)->(6,9) 连出，在 y9 封行必然把
    房内切成孤岛，flood_ok 稳定失败并自动回退，最终得到 y2 / y10~11 两道。
    y12 跳过：开放层上楼门位 (11,12) 可能落在此行，不能被闸墙覆盖。
    """
    skip = {1, 13, 12}
    if has_room:
        skip |= set(range(3, 9))
    for vx, vy in vault_cells:
        skip.add(vy)
    prot = protected_cells(has_room)
    gx0 = [2, 9, 4, 10, 3, 8, 5, 7, 2, 9, 4][(floor_no - 1) % 11]
    # 起始行从 y=4 起：
    #  ① y=3 行是校验脚本识别「房间层」的特征行（rows[3].slice(3,10)==='#######'），
    #     闸墙若落在 y=3 会让开放层被误判成房间层（实测 10 -> 12 个）。
    #  ② 第一带变成 y=1~3 三行，补给 / 钥匙有足够空间分散，不会连排堵死通道。
    cand = [y for y in range(4, 12) if y not in skip]
    gates, last_y = [], -10
    for y in cand:
        if len(gates) >= GATE_TARGET: break
        if y - last_y < 2: continue
        row = [g[y][x] for x in range(1, W - 1)]
        if any(c not in '.#' for c in row): continue
        gxc = [gx0] + [x for x in range(1, W - 1) if x != gx0]
        gx = None
        for x in gxc:
            if 1 <= x <= W - 2 and g[y][x] == '.' and (x, y) not in prot:
                gx = x; break
        if gx is None: continue
        old = [(x, g[y][x]) for x in range(1, W - 1)]
        for x in range(1, W - 1):
            if x != gx: g[y][x] = '#'
        if flood_ok(g) and not _reach(g, (1, 1), (11, 13), {(gx, y)}):
            gates.append((gx, y)); last_y = y
            gx0 = (W - 1) - gx
        else:
            for x, c in old: g[y][x] = c
    return gates


def add_alcoves(g, rng, floor_no, has_room, vault_cells, gates, count=ALCOVE_COUNT):
    """支路凹室：砌 3 面墙围出 1 格，留 1 面入口。入口站守护怪，凹室内放资源。

    返回 [{'entry':(x,y),'cell':(x,y),'walls':[(x,y)..]}]。
    逐段 flood_ok 兜底；这些墙连同瓶颈格一起传给 add_secret 的 extra_forbid，
    避免暗门显形后形成绕过守路怪 / 守护怪的第二入口。
    """
    prot = protected_cells(has_room)
    # v0.15：凹室是「打穿瓶颈后的支线」，绝不能落在第一带 —— 实测 1F 的
    # y=1 空走廊被凹室守护怪占住，开局打不过就直接堵死进层唯一通道
    # （solver 死局 + 点击模式走不到道具旁）。第一带只留给白捡补给。
    banned = set(vault_cells) | set(gates) | start_region(g, gates)
    out = []
    for _ in range(count):
        cells = [(x, y) for y in range(2, H - 2) for x in range(2, W - 2)
                 if g[y][x] == '.' and (x, y) not in prot and (x, y) not in banned]
        rng.shuffle(cells)
        for x, y in cells:
            dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
            rng.shuffle(dirs)
            done = False
            for edx, edy in dirs:
                ex, ey = x + edx, y + edy
                walls = [(x + dx, y + dy) for dx, dy in dirs if (dx, dy) != (edx, edy)]
                region = [(x, y), (ex, ey)] + walls
                if any(not (1 <= a <= W - 2 and 1 <= b <= H - 2) for a, b in region):
                    continue
                if any((a, b) in prot or (a, b) in banned for a, b in region):
                    continue
                if any(g[b][a] != '.' for a, b in region):
                    continue
                old = [(a, b, g[b][a]) for a, b in region]
                for a, b in walls:
                    g[b][a] = '#'
                if flood_ok(g):
                    out.append({'entry': (ex, ey), 'cell': (x, y), 'walls': walls})
                    banned |= set(region)
                    done = True
                    break
                for a, b, c in old:
                    g[b][a] = c
            if done:
                break
    return out


def add_corridors(g, rng, floor_no, has_room, avoid=None):
    """v0.14：把原来 5 段 2 格短墙升级为成体系的 3~4 格隔间墙，做出走廊纵深。

    逐段 flood_ok 兜底，失败即回退；避开门 / 楼梯 / 房间 / 王座保护邻域。
    只加墙、不减通路，因此不会破坏 v0.10「门封唯一入口」的结论。
    v0.15：avoid 传入「第一带」，隔间短墙绝不落在进层补给区 —— 实测 1F 的
    y=2 横贯短墙会把 y=1 空走廊与 y=3 补给行切开，点击模式规划不到钥匙旁。
    """
    prot = protected_cells(has_room)
    if avoid:
        prot |= set(avoid)
    for _ in range(18):
        L = rng.choice([3, 3, 4])
        horiz = rng.random() < 0.5
        x = rng.randint(2, W - 2 - (L if horiz else 0))
        y = rng.randint(2, H - 2 - (0 if horiz else L))
        seg = [(x + i, y) if horiz else (x, y + i) for i in range(L)]
        if any(not (1 <= a <= W - 2 and 1 <= b <= H - 2) for a, b in seg):
            continue
        if any((a, b) in prot for a, b in seg):
            continue
        if any(g[b][a] != '.' for a, b in seg):
            continue
        old = [(a, b, g[b][a]) for a, b in seg]
        for a, b in seg:
            g[b][a] = '#'
        if not flood_ok(g):
            for a, b, c in old:
                g[b][a] = c


def add_vault(g, rng, floor_no, has_room):
    """v0.14：在支线砌 2 格死胡同宝库，唯一入口由精英怪 X 把守。

    布局（vx,vy = 精英格；s/S 宝库道具；# 新砌墙；玩家从 (vx,vy+1) 接近）：
        (vx-1,vy-1)#  (vx,vy-1)s  (vx+1,vy-1)S  (vx+2,vy-1)#
        (vx-1,vy  )#  (vx,vy  )X  (vx+1,vy  )#  (vx+2,vy  )#
        (vx  ,vy-2)#  (vx+1,vy-2)#
    生成期 flood_ok 视 X 为可走格，宝库内部仍算「可达」；运行期玩家点击寻路
    findPath() 把 X 当实体阻挡，打不过时宝库道具不可达 —— 纯支线，solver
    跳过它继续上楼，不会死锁。变强后 calcBattle().ok 为真即可回来打。
    返回 (精英坐标, 宝库道具坐标列表, 新砌墙坐标列表)；找不到位置返回 None。
    """
    prot = protected_cells(has_room)
    pool = candidate_pool(g, has_room)
    rng.shuffle(pool)
    for vx, vy in pool:
        walls = [(vx - 1, vy - 1), (vx + 2, vy - 1), (vx - 1, vy),
                 (vx + 1, vy), (vx + 2, vy), (vx, vy - 2), (vx + 1, vy - 2)]
        loot = [(vx, vy - 1), (vx + 1, vy - 1)]
        gate = (vx, vy)
        approach = (vx, vy + 1)
        region = walls + loot + [gate, approach]
        if any(not (1 <= a <= W - 2 and 1 <= b <= H - 2) for a, b in region):
            continue
        if any((a, b) in prot or g[b][a] != '.' for a, b in region):
            continue
        old = [(a, b, g[b][a]) for a, b in region]
        for a, b in walls:
            g[b][a] = '#'
        g[loot[0][1]][loot[0][0]] = 's'   # 铁剑 +10 攻
        g[loot[1][1]][loot[1][0]] = 'S'   # 铁盾 +10 防
        g[gate[1]][gate[0]] = ELITE_CH     # 宝库守卫
        if not flood_ok(g):
            for a, b, c in old:
                g[b][a] = c
            continue
        return gate, loot, walls, approach
    return None


def place_entities(g, rng, floor_no, has_room, inner, special,
                   avoid=None, gates=None, alcoves=None, start_cells=None):
    """在大厅按确定性布局铺实体；返回本层 H 坐标列表（供 hidden 配置）。

    v0.15：瓶颈格站守路怪（必打）、凹室入口站守护怪、凹室内放补给；
    三色钥匙与其余道具仍撒在开阔区，保证「打穿主路即可上楼」。
    """
    gates = gates or []
    alcoves = alcoves or []
    guard_coords = set(gates) | {a['entry'] for a in alcoves}
    loot_coords = {a['cell'] for a in alcoves}
    banned = guard_coords | loot_coords | {w for a in alcoves for w in a['walls']}
    pool = [c for c in candidate_pool(g, has_room, avoid) if c not in banned]
    rng.shuffle(pool)
    # v0.15：拆成「第一带 / 后带」两个池。
    #   第一带是玩家进层唯一能先捡到补给的安全区（v0.9 的 CURVE_A/D 就是按
    #   「先捡完道具再打怪」建模的），只放成长道具 / 血瓶 / 金币 / 钥匙；
    #   散怪与暗格一律放后带。若散怪也挤进第一带，会把钥匙四邻的空格占光，
    #   点击模式 findPath(blockEntities) 就规划不到「钥匙旁边一格」（实测 11 处）。
    start_cells = start_cells or set()
    # y=1 整行保留为纯空走廊：点击模式 findPath(blockEntities) 不穿越实体，
    # 若第一带道具连排堵死 y=1，玩家就「走不到钥匙旁边一格」（实测 1F）。
    # y=1 留空后，从 (1,1) 可横向走到任意列再向下取道具，第一带全程可达。
    start_pool = [c for c in pool if c in start_cells and c[1] >= 2]
    rest_pool = [c for c in pool if c not in start_cells]

    def take_start():
        return start_pool.pop(0) if start_pool else (rest_pool.pop(0) if rest_pool else None)

    def take_rest():
        return rest_pool.pop(0) if rest_pool else (start_pool.pop(0) if start_pool else None)

    hidden_here = []

    # 0) v0.15：守路怪 / 守护怪 / 凹室补给先占位（不消耗候选池）
    gp = guard_pool(floor_no)
    for i, (gx, gy) in enumerate(gates):
        g[gy][gx] = gp[i % len(gp)]
    for i, a in enumerate(alcoves):
        ex, ey = a['entry']
        g[ey][ex] = gp[(len(gates) + i) % len(gp)]
        cx, cy = a['cell']
        g[cy][cx] = ALCOVE_LOOT[(floor_no + i) % len(ALCOVE_LOOT)]

    # 1) 强化道具 2 个（攻击/防御成长，保证后期能破魔王防）—— 第一带
    growth = ['a', 's', 'S', 'd']  # 红宝石+3atk / 铁剑+10atk / 铁盾+10def / 蓝宝石+3def
    for k in range(2):
        x, y = take_start(); g[y][x] = growth[(floor_no + k) % len(growth)]

    # 2) 血瓶 / 金币各 2 处 —— 第一带
    for k in range(2):
        x, y = take_start(); g[y][x] = 'P' if (floor_no + k) % 2 else 'p'
        x, y = take_start(); g[y][x] = 'g'

    # 3) 钥匙（三色各一，保证任意门可开）—— 第一带
    # v0.15：全部留在第一带，不被凹室守护怪 / 瓶颈怪挡住 —— 打穿主路即可上楼。
    #   且必须有至少一个可走邻格：点击模式 findPath(blockEntities) 只能规划到
    #   「实体旁边一格」，四邻全是道具/墙时玩家会看到「走不到它旁边」（1F 实测）。
    for k in 'ybr':
        x, y = take_start()
        for _ in range(40):
            if not start_pool: break
            if any(0 <= x + dx < W and 0 <= y + dy < H and g[y + dy][x + dx] == '.'
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                break
            x, y = take_start()
        g[y][x] = k

    # 4) v0.10：门不再随机撒在开放区（改由 make_floor 放在「唯一入口」）。
    #    这里仍消耗一个后带候选坐标，保持后续实体投放顺序与旧版一致。
    take_rest()

    # 5) v0.15：散怪全部放后带，补齐到 TARGET_MOBS。守路怪 / 守护怪 / 房门
    #    守怪都算在内，统一由 count_mobs 统计后交给 build_floor_scale 按怪数
    #    摊薄 —— 单层目标总损血不变，只战斗场次变多、每场更轻（保持曲线）。
    placed_guards = len(gates) + len(alcoves) + (1 if has_room else 0)
    for k in range(max(0, TARGET_MOBS - placed_guards)):
        x, y = take_rest(); g[y][x] = ['1', '2', '4'][(floor_no + k) % 3]

    # 6) 暗格 H（仅当该层有可用 story key）—— 后带
    if floor_no in HIDDEN_KEYS:
        x, y = take_rest(); g[y][x] = 'H'; hidden_here.append((x, y))

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
            g[inner[0][1]][inner[0][0]] = 'T'   # 盗贼（v0.13 起救出后常驻，走任务线）
            g[inner[1][1]][inner[1][0]] = 'g'
        elif kind == 'elder':
            g[inner[0][1]][inner[0][0]] = 'E'   # v0.13：老者（救出后解锁炸弹 + 赠 1 枚）
            g[inner[1][1]][inner[1][0]] = 'd'
        elif kind == 'codex':
            g[inner[0][1]][inner[0][0]] = 'I'   # 图鉴
            g[inner[1][1]][inner[1][0]] = 'a'
        elif kind == 'fly':
            g[inner[0][1]][inner[0][0]] = 'F'   # 唯一飞行器
            g[inner[1][1]][inner[1][0]] = 'd'
        else:  # treasure
            loot = ['S', 'P', 'a']
            # v0.13 盗贼任务线道具：13F 藏「锁匠工具」、19F 藏「钱袋」
            if floor_no == 13: loot.append('j')
            if floor_no == CORE_FLOOR: loot.append(CORE_CH)   # v0.16 能量核心（与 j 同房，通关必经）
            if floor_no == 19: loot.append('q')
            for c, (x, y) in zip(loot, inner):
                g[y][x] = c
        # 房门口守怪（中等，支线；打不过也不影响通关）
        g[9][6] = '4' if floor_no % 2 else '2'

    return hidden_here


def make_boss_floor(rng):
    """顶层 21F：王座 W 三面封墙，正面 m3 魔王把守；其余大厅放成长道具。

    v0.15：21F 原本空地 61%、只有 4 只怪，是全塔唯一还「空荡荡」的层。
    补两道竖闸墙把大厅切成三条竖带，缺口站守路怪：玩家从 D(1,1) 必须打穿
    x=3 的守路怪才靠近得了王座口 (6,6)。王座台在 x5~7 / y3~6，竖墙选
    x=3 / x=9 完全避开，不破坏 v0.10「红门封唯一入口」结构。
    """
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

    # v0.15 竖闸墙：整列贯通只留 1 格缺口 = 真割点，缺口站守路怪
    boss_walls = []
    for col, gy in ((3, 2), (9, 11)):
        for y in range(1, H - 1):
            if y == gy: continue
            if g[y][col] == '.':
                g[y][col] = '#'
                boss_walls.append((col, y))
        g[gy][col] = guard_pool(BOSS_FLOOR)[0]
    assert flood_ok(g), '21F 竖闸墙后 flood fill 不连通'
    # 左侧带（x=1~2）是进层区，不砌隔间短墙，避免把补给通道切碎
    add_corridors(g, rng, BOSS_FLOOR, False,
                  avoid={(x, y) for x in (1, 2) for y in range(1, H - 1)})

    pool = [(x, y) for y in range(1, H - 1) for x in range(1, W - 1)
            if g[y][x] == '.' and (x, y) not in
            {(1, 1), (2, 1), (1, 2), (6, 4), (6, 3), (5, 4), (7, 4), (6, 5),
             (6, 6), (5, 5), (7, 5)}]
    rng.shuffle(pool)
    # 顶层补强化道具，确保爬到时能破魔王防 + 扛住
    for c in ('s', 'a', 'S', 'd', 'P', 'P', 'a', 's'):
        x, y = pool.pop(); g[y][x] = c
    # v0.15：散怪 3 -> 6，配合竖闸墙让终局层也不空荡
    for c in ('1', '2', '1', '2', '4', '1'):
        x, y = pool.pop(); g[y][x] = c
    for k in 'ybr':
        x, y = pool.pop(); g[y][x] = k
    # 暗格（门已改由结构放置，不再随机撒）
    x, y = pool.pop(); g[y][x] = 'H'
    # v0.12：顶层也留一处暗门；v0.15 排除竖闸墙，避免显形后多出第二个缺口
    sec = add_secret(g, rng, BOSS_FLOOR, False, extra_forbid=boss_walls)
    assert sec, '顶层未能放置暗门'
    assert flood_ok(g), '顶层 flood fill 不连通'
    return g, [(x, y) for y in range(H) for x in range(W) if g[y][x] == 'H'], sec, [], []


def make_floor(floor_no):
    rng = random.Random(1000 + floor_no * 7919)
    if floor_no == BOSS_FLOOR:
        return make_boss_floor(rng)
    g = blank_grid()
    if floor_no == 1:
        g[1][1] = '@'
        g[2][1] = FAIRY_CH   # v0.16：出生点正下方，常驻小精灵（candidate_pool 已保护该格）
    else:
        g[1][1] = 'D'
    g[13][11] = 'U'

    has_room = (floor_no - 1) in ROOM_FLOORS
    inner, opening = ([], None)
    if has_room:
        inner, opening = room_rect(g)

    # v0.14：强敌宝库趁地图空白最大时先占位；后续隔间墙只挑 '.'，自动避开它。
    #       新砌的墙传给 add_secret，避免暗门显形后形成绕过精英怪的第二个入口。
    vault_walls, vault_avoid = [], set()
    vault_cells = []
    if floor_no in ELITE_FLOORS:
        v = add_vault(g, rng, floor_no, has_room)
        assert v, f'{floor_no}F 未能放置强敌宝库'
        vault_walls, vault_avoid = v[2], {v[3]}
        vault_cells = list(v[2]) + list(v[1]) + [v[0], v[3]]

    # v0.15：先立走廊骨架（要求干净的整行贯通），再砌支路凹室，最后补隔间短墙。
    # 顺序不能反 —— add_corridors 的随机短墙会破坏「整行除缺口外全是墙」的
    # 割点前提；凹室也要抢在短墙之前，才能找到三面可砌的干净空地。
    gates = gate_skeleton(g, rng, floor_no, has_room, vault_cells)
    alcoves = add_alcoves(g, rng, floor_no, has_room, vault_cells, gates)
    add_corridors(g, rng, floor_no, has_room, avoid=start_region(g, gates))

    # v0.10：门放在「唯一入口」，从此不可绕行 —— 房间口 / 上楼口
    if has_room:
        g[opening[1]][opening[0]] = door_char(floor_no)   # (6,8) 房间唯一开口
    else:
        # 上楼 U(11,13) 只有两个可走邻格：(10,13) 与 (11,12)。封其一、另一放门，
        # 门即成为「上楼唯一入口」。封哪一侧不能写死：随机短内墙可能恰好把某个角落
        # 切出去（14F 实测封 (10,13) 会把 (8,13)(9,13) 困成孤岛），故两种摆法都试，
        # 取 flood_ok 通过的那一种，保证门永远挡路且地图永远连通。
        # v0.13：16F 上楼口放「特殊封印门 Z」，三色钥匙开不了，只有盗贼任务线能撬开
        door = 'Z' if floor_no == SPECIAL_DOOR_FLOOR else door_char(floor_no)
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

    hidden = place_entities(g, rng, floor_no, has_room, inner, None,
                            avoid=vault_avoid, gates=gates, alcoves=alcoves,
                            start_cells=start_region(g, gates))

    # 飞行器兜底：11F 若因故不是房间层，仍保证全塔恰好一个 F
    if floor_no == FLY_FLOOR:
        cnt_F = sum(1 for row in g for c in row if c == 'F')
        if cnt_F == 0:
            pool = [c for c in candidate_pool(g, has_room) if g[c[1]][c[0]] == '.']
            x, y = rng.choice(pool); g[y][x] = 'F'
    # 图鉴只由 6F 房间 kind='codex' 产生，全塔唯一

    # v0.12：每层 1 处暗门（撞墙显形的支线奖励），最后放，避免占用实体候选池
    alcove_walls = [w for a in alcoves for w in a['walls']]
    guard_coords = list(gates) + [a['entry'] for a in alcoves]
    sec = add_secret(g, rng, floor_no, has_room,
                     extra_forbid=vault_walls + alcove_walls + guard_coords,
                     forbid_rows={y for _, y in gates})
    assert sec, f'{floor_no}F 未能放置暗门'
    assert flood_ok(g), f'{floor_no}F flood fill 不连通'
    return g, hidden, sec, gates, alcoves


def build():
    floors = []
    hidden_cfg = []
    secret_cfg = []
    gates_by_floor = []
    alcoves_by_floor = []
    for n in range(1, 22):
        g, hs, sec, gates, alcoves = make_floor(n)
        gates_by_floor.append(gates)
        alcoves_by_floor.append(alcoves)
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
        # v0.13：老者（12F 房间）——救出后解锁炸弹能力（flag=2 BOMB_UNLOCK）并赠 1 枚；
        # 任务道具走 applyEffect 的 eff.flag 通用通道写标志位（LOCKPICK=4 / MONEYBAG=8），
        # 逻辑层盗贼任务状态机据这两个位推进，无需按 id 特判。
        {'id': 'npc_elder', 'ch': 'E', 'name': '被困的老者', 'effect': {'flag': 2, 'bomb': 1}},
        {'id': 'quest_lockpick', 'ch': 'j', 'name': '锁匠工具', 'effect': {'flag': 4}},
        {'id': 'quest_moneybag', 'ch': 'q', 'name': '钱袋', 'effect': {'flag': 8}},
        # v0.16：能量核心（13F 房间，全塔唯一）—— effect.flag=128 写 CORE_HELD；
        # 小精灵是常驻 NPC，不放 effect（resolveStep 单独三态分支），但必须进
        # ITEMS 表，solver.scan() 才会在「持核心且未强化」时把它列为目标。
        {'id': 'core_energy', 'ch': CORE_CH, 'name': '能量核心', 'effect': {'flag': 128}},
        {'id': 'npc_fairy', 'ch': FAIRY_CH, 'name': '塔灵小精灵', 'effect': {}},
    ]
    # v0.9：8 种怪。基础数值只作「未缩放」兜底，运行时由 FLOOR_SCALE[层] × 权重派生。
    # 经典魔塔怪种分工：石头人高防低血（破防博弈）、法师/警卫真实伤害（无视防御）。
    # v0.13：exp = 击杀经验（基础值，按 1~7F×1 / 8~14F×2 / 15~21F×3 楼层档放大，
    # 全塔总经验约 900+，供 8F 法师处 30 经验/次兑换攻防血，量级与商店金币经济相当）。
    monsters = [
        {'id': 'm1', 'ch': '1', 'name': '史莱姆', 'hp': 20, 'atk': 8, 'def': 2, 'gold': 3,
         'exp': 4, 'bg': '#4caf50', 'hpW': 0.85, 'atkW': 0.9, 'defW': 0.8},
        {'id': 'm2', 'ch': '2', 'name': '蝙蝠', 'hp': 35, 'atk': 14, 'def': 5, 'gold': 6,
         'exp': 6, 'bg': '#7e57c2', 'hpW': 1.0, 'atkW': 1.0, 'defW': 1.0},
        {'id': 'm4', 'ch': '4', 'name': '骷髅兵', 'hp': 50, 'atk': 20, 'def': 8, 'gold': 10,
         'exp': 9, 'bg': '#b0bec5', 'hpW': 1.1, 'atkW': 1.05, 'defW': 1.1},
        {'id': 'm6', 'ch': '6', 'name': '石头人', 'hp': 60, 'atk': 12, 'def': 26, 'gold': 14,
         'exp': 11, 'bg': '#8d6e63', 'hpW': 0.7, 'atkW': 0.85, 'defW': 1.7},
        {'id': 'm7', 'ch': '7', 'name': '兽人', 'hp': 55, 'atk': 24, 'def': 7, 'gold': 15,
         'exp': 10, 'bg': '#d84315', 'hpW': 1.15, 'atkW': 1.15, 'defW': 0.9},
        {'id': 'm5', 'ch': '5', 'name': '暗法师', 'hp': 45, 'atk': 26, 'def': 6, 'gold': 16,
         'exp': 12, 'bg': '#5c6bc0', 'hpW': 0.9, 'atkW': 0.16, 'defW': 0.8, 'pierce': True},
        {'id': 'm8', 'ch': '8', 'name': '魔法警卫', 'hp': 50, 'atk': 20, 'def': 10, 'gold': 18,
         'exp': 13, 'bg': '#00897b', 'hpW': 1.0, 'atkW': 0.20, 'defW': 1.0, 'pierce': True},
        # v0.14 精英怪「宝库守卫」：scaleShift 让 scaledMon 取 FLOOR_SCALE[floor+9]
        # （含 21F 之上的外推段），于是同一只怪在 3F 就是 12F 强度、在 18F 更远超终局。
        # 初期 atk 破不了防 / 损血致命，被 resolveStep 拦下提示「硬拼会阵亡」；
        # 玩家爬楼变强后 calcBattle().ok 为真，findPath 才允许穿越，回来打取宝。
        # 权重在「超前层标准怪」之上再加权，与守宝收益（铁剑 + 铁盾）难度对等。
        {'id': 'm9', 'ch': ELITE_CH, 'name': '宝库守卫', 'hp': 120, 'atk': 30, 'def': 20,
         'gold': 60, 'exp': 45, 'bg': '#ef6c00',
        # v0.15：玩家因怪数 5->9 拿到更多金币/经验，属性提前追上强敌，
        # 14F/18F 的 X 在「首次进层」就能被打赢，故把 atkW 1.35->1.7、
        # defW 1.6->2.2（精英单独加权，不动普通怪 FLOOR_SCALE 摊薄）。
        # v0.16：怪数 9->12 + 全塔损血 ×1.3 + 精灵大幅强化，玩家属性进一步
        # 上涨；且 17F 屏障后玩家必须回头强化才会「首次」抵达 18F，此时
        # ATK266/DEF291/HP3612 已逼近终局 ATK303/DEF338/HP3392，旧权重下
        # 18F X 首次即可打。按同一口径再校准 atkW 1.7->1.6、defW 2.2->3.8，
        # 使 4 处首次进层全部打不过（3F/9F/14F 破不了防、18F 会阵亡），
        # 终局回头仍全部可打（损血 0/322/780/1456 HP，梯度递增）。
        # 用户明确「强敌除外」：solver.scan 排除 elite 目标与守卫中的宝库道具，
        # 故调权重不影响正式回放路线，只影响玩家手动挑战时的判定。
        'hpW': 3.0, 'atkW': 1.6, 'defW': 3.8,
         'scaleShift': ELITE_SHIFT, 'elite': True},
        # 魔王：独立终局数值，不参与逐层缩放（经典魔塔 Boss 惯例）；通关即终局，经验无意义
        {'id': 'm3', 'ch': '3', 'name': '魔王', 'hp': BOSS_FINAL['hp'],
         'atk': BOSS_FINAL['atk'], 'def': BOSS_FINAL['def'], 'gold': 0, 'exp': 0,
         'bg': '#e53935', 'bombImmune': True, 'noScale': True},
    ]
    tile_char = {
        'Y': '门', 'B': '门', 'R': '门', 'G': '铁', 'A': '', 'Z': '封',
        'y': '钥', 'b': '钥', 'r': '钥',
        'p': '+', 'P': '++', 'a': '攻', 'd': '防', 's': '剑', 'S': '盾', 'g': '金',
        'F': '飞', 'o': '炸', 'I': '鉴', 'M': '法', 'T': '盗', 'H': '',
        'E': '老', 'j': '具', 'q': '袋', 'X': '卫', 'e': '灵', 'C': '核',
        'U': '↑', 'D': '↓', 'W': '王', 'N': '商',
    }
    tile_color = {
        '#': '#37474f', '.': '#1b2430', '@': '#1b2430',
        'A': '#37474f', 'G': '#8d99a6', 'Z': '#7b5ea7',
        'Y': '#e6a23c', 'B': '#3a86e8', 'R': '#e5534b',
        'y': '#ffd54f', 'b': '#64b5f6', 'r': '#ef9a9a',
        'p': '#ef5350', 'P': '#e53935', 'a': '#ff5252', 'd': '#448aff',
        's': '#cfd8dc', 'S': '#90a4ae', 'g': '#ffca28',
        'F': '#4dd0e1', 'o': '#546e7a', 'I': '#ba68c8', 'M': '#7e57c2', 'T': '#8d6e63',
        'E': '#bcaaa4', 'j': '#b0bec5', 'q': '#ffca28', 'X': '#ff7043',
        'e': '#66e0c8', 'C': '#8c7bff',
        'H': '#1b2430', 'U': '#66bb6a', 'D': '#8d6e63', 'W': '#ab47bc', 'N': '#26c6da',
    }
    # v0.9：主题接线（拼进 name，HUD / 图鉴 / 载入日志直接可见）
    for f in floors:
        f['name'] = f['name'] + ' · ' + f['theme']
    # v0.9：分层怪种投放（只换字符，不动连通性 / 楼梯 / 房内宝物）
    # v0.15：所有「几何割点怪」都必须保持常规怪种 —— 瓶颈守路怪、凹室守护怪，
    #   以及随机散怪恰好落在唯一通道上的那些。割点 = 把它设成墙后 (1,1)->U
    #   不可达。若这类怪被 retier 换成 m6 石头人(defW1.7 破防尖峰) 或
    #   m5/m8 pierce 真实伤害怪，进层打不过就会把主路切断成死局。
    #   非割点的支线怪仍照常分层替换，保证高层出现 5/6/7/8 的图鉴口径。
    cut_by_floor = []
    for f in floors:
        rows = f['rows']
        mons = [(x, y) for y in range(1, H - 1) for x in range(1, W - 1)
                if rows[y][x] in '1245678']
        cut_by_floor.append({(x, y) for x, y in mons
                             if not _reach(rows, (1, 1), (11, 13), {(x, y)})})
    skip_by_floor = [set(gates_by_floor[i]) | {a['entry'] for a in alcoves_by_floor[i]}
                     | cut_by_floor[i] for i in range(21)]
    retier_monsters(floors, skip_by_floor)
    # v0.9：逐层强度曲线，按每层实际怪数摊薄目标损血
    mob_cnt = count_mobs(floors)
    floor_scale = build_floor_scale(mob_cnt)

    data = {
        'meta': {
            'schema': 7,
            'note': '关卡配置唯一编辑源（21 层 × 13×15 主题大地图 + v0.9 逐层强度曲线 + v0.10 三色门封唯一入口 + v0.12 暗门/铁门/钥匙经济 + v0.13 经验/盗贼任务线/老者炸弹/16F 封印门Z + v0.14 隔间/加密实体/强敌守宝库X + v0.15 走廊闸墙/单格瓶颈守路怪/支路凹室资源把守 + FLOOR_SCALE 外推供 scaleShift + v0.16 小精灵/能量核心/17F 起屏障护盾 + 怪数 12/损血 ×1.3）。改这里，然后跑 python3 tools/build_tables.py 重新生成 tables.js；不要手改 tables.js。',
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
        'hero0': {'hp': 200, 'atk': 10, 'def': 10, 'gold': 0, 'exp': 0, 'flags': 0,
                  'keys': {'y': 0, 'b': 0, 'r': 0}, 'fly': 0, 'bomb': 0, 'book': 0},
        'doorKey': {'Y': 'y', 'B': 'b', 'R': 'r', 'G': 'y'},
        'doorCost': {'Y': 1, 'B': 1, 'R': 1, 'G': IRON_KEY_COST},
        'hidden': hidden_cfg,
        'secret': secret_cfg,
        'floorScale': floor_scale,
        # v0.16：屏障配置（floor/coreFloor/fairyFloor 均为 0-based 楼层索引）。
        # boost 只作用于「屏障层起、非 elite」的常规怪；未强化时 calcBattle 再
        # 强制 unbreakable（能量护盾），强化后护盾解除、靠 charge 的强化属性打
        # 这个数值台阶。强化幅度与倍率都是可调参数，实测校准见开发盘点 0-N。
        'barrier': {
            'floor': BARRIER_FLOOR - 1,
            'coreFloor': CORE_FLOOR - 1,
            'fairyFloor': 0,
            'boost': BARRIER_BOOST,
            'charge': FAIRY_CHARGE,
        },
    }
    with open(os.path.join(ROOT, 'levels', 'levels.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 摘要
    print('生成 21 层 13×15：')
    for i, f in enumerate(floors):
        entities = sum(1 for r in f['rows'] for c in r if c not in '#.@A')
        room = '有房间' if i in ROOM_FLOORS else ('王座' if i == 20 else '开放')
        door = 'Z' if (i + 1) == SPECIAL_DOOR_FLOOR else door_char(i + 1)
        special = ['门' + {'Y': '黄', 'B': '蓝', 'R': '红', 'G': '铁', 'Z': '封'}[door]]
        joined = ''.join(f['rows'])
        if 'A' in joined: special.append('暗门A')
        if 'I' in joined: special.append('图鉴I')
        if 'F' in joined: special.append('飞行器F')
        if 'M' in joined: special.append('法师M')
        if 'T' in joined: special.append('盗贼T')
        if 'E' in joined: special.append('老者E')
        if 'j' in joined: special.append('锁匠工具j')
        if 'q' in joined: special.append('钱袋q')
        if 'N' in joined: special.append('商人N')
        print(f"  {i+1:2d}F {f['theme']:6s} {room:5s} 实体{entities:2d} " + ' '.join(special))
    tx = sum(''.join(f['rows']).count(ELITE_CH) for f in floors)
    print('v0.15 走廊闸墙瓶颈:', sum(len(g) for g in gates_by_floor), '处（每层',
          min(len(g) for g in gates_by_floor), '~', max(len(g) for g in gates_by_floor),
          '道）| 支路凹室:', sum(len(a) for a in alcoves_by_floor), '处')
    print('强敌宝库 X 处数:', tx, '（应为', len(ELITE_FLOORS), '，分布', sorted(ELITE_FLOORS), 'F）')
    print('FLOOR_SCALE 组数:', len(floor_scale), '（21 逐层 +', ELITE_SHIFT, '外推，供 scaleShift）')
    empty = sum(''.join(f['rows']).count('.') for f in floors)
    print('空地占比:', round(empty / (21 * W * H) * 100, 1), '%')
    total_F = sum(''.join(f['rows']).count('F') for f in floors)
    print('飞行器 F 总数:', total_F, '（应为 1）')
    print('图鉴 I 总数:', sum(''.join(f['rows']).count('I') for f in floors))
    print('hidden 暗格处数:', len(hidden_cfg))
    print('暗门 A 处数:', sum(''.join(f['rows']).count('A') for f in floors), '/ secret 配置:', len(secret_cfg))
    print('铁门 G 处数:', sum(''.join(f['rows']).count('G') for f in floors),
          '（7F / 14F / 21F，每道需', IRON_KEY_COST, '把黄钥匙）')


if __name__ == '__main__':
    build()
