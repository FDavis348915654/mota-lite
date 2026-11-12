#!/usr/bin/env python3
# gen_assets.py —— 在线版《腕上魔塔 Lite》全部美术 / 动画 / 音频资源的生成脚本。
# 用法：python3 tools/gen_assets.py
# 全部资源程序化生成，可复现、透明通道精确对齐 28px 网格、无外链。
# 产物：assets/sprites.png + sprites.json / hero_idle.gif / slime_idle.gif /
#       title.png（像素风兜底，可被 AI 插画覆盖）/ audio/*.wav / manifest.json
import os, json, math, wave, re
import numpy as np
from PIL import Image, ImageDraw

ROOT = '/workspace/mota-lite-web'
OUT = os.path.join(ROOT, 'assets')
AUD = os.path.join(OUT, 'audio')
os.makedirs(AUD, exist_ok=True)
T = 28  # 与 CONFIG.CELL 一致，1:1 无需缩放

# 资源清单版本号从 version.js 单一真源读取，避免两处硬编码漂移
# （tools/validate_assets.mjs 会断言 manifest.version === VERSION）
def read_version():
    with open(os.path.join(ROOT, 'version.js'), 'r', encoding='utf-8') as f:
        m = re.search(r"export const VERSION = '(v\d+\.\d+\.\d+)'", f.read())
    if not m:
        raise RuntimeError('无法从 version.js 解析 VERSION')
    return m.group(1)[1:]   # 去掉前导 v

def read_floor_count():
    with open(os.path.join(ROOT, 'levels', 'levels.json'), 'r', encoding='utf-8') as f:
        return len(json.load(f)['floors'])

APP_VERSION = read_version()
FLOOR_COUNT = read_floor_count()   # 塔景插画的层数与关卡表同源


def tile(bg=(0, 0, 0, 0)):
    im = Image.new('RGBA', (T, T), bg)
    return im, ImageDraw.Draw(im)


def R(d, box, fill, outline=None): d.rectangle(box, fill=fill, outline=outline)
def E(d, box, fill, outline=None): d.ellipse(box, fill=fill, outline=outline)
def P(d, pts, fill, outline=None): d.polygon(pts, fill=fill, outline=outline)


# ---------------- 地形 ----------------
def draw_wall():
    im, d = tile((55, 71, 79, 255))
    d.line([(0, 0), (28, 0)], fill=(96, 125, 139, 255))
    d.line([(0, 9), (28, 9)], fill=(38, 50, 57, 255))
    d.line([(0, 19), (28, 19)], fill=(38, 50, 57, 255))
    d.line([(14, 0), (14, 9)], fill=(38, 50, 57, 255))
    d.line([(7, 9), (7, 19)], fill=(38, 50, 57, 255))
    d.line([(21, 19), (21, 28)], fill=(38, 50, 57, 255))
    d.rectangle([0, 0, 27, 27], outline=(30, 41, 48, 255))
    return im


def draw_floor():
    im, d = tile((27, 36, 48, 255))
    for x, y in [(6, 6), (20, 6), (6, 20), (20, 20), (13, 13)]:
        d.point((x, y), fill=(44, 58, 74, 255))
        d.point((x + 1, y), fill=(38, 50, 64, 255))
    d.rectangle([0, 0, 27, 27], outline=(20, 28, 38, 255))
    return im


# ---------------- 英雄（两帧用于待机 / 战斗）----------------
def draw_hero(frame=0):
    im, d = tile()
    E(d, [6, 23, 22, 27], (0, 0, 0, 90))
    R(d, [10, 19, 12, 24], (58, 70, 92, 255)); R(d, [16, 19, 18, 24], (58, 70, 92, 255))
    R(d, [9, 11, 19, 20], (41, 98, 160, 255))
    R(d, [8, 11, 20, 13], (66, 135, 200, 255))
    E(d, [10, 3, 18, 12], (245, 205, 165, 255))
    R(d, [9, 2, 19, 5], (110, 70, 40, 255))
    d.point((13, 8), fill=(30, 30, 40, 255)); d.point((16, 8), fill=(30, 30, 40, 255))
    if frame == 0:
        R(d, [21, 9, 23, 20], (207, 216, 220, 255))
        P(d, [(21, 9), (22, 6), (23, 9)], (240, 245, 250, 255))
        R(d, [20, 19, 24, 21], (150, 100, 50, 255))
    else:
        R(d, [22, 5, 24, 16], (207, 216, 220, 255))
        P(d, [(22, 5), (23, 2), (24, 5)], (240, 245, 250, 255))
        R(d, [21, 15, 25, 17], (150, 100, 50, 255))
    return im


# ---------------- 门 / 钥匙 ----------------
DOOR_COL = {'y': (249, 168, 37, 255), 'b': (30, 136, 229, 255), 'r': (229, 57, 53, 255)}


def make_door(k):
    def f():
        im, d = tile((30, 38, 48, 255))
        R(d, [4, 2, 24, 26], (96, 70, 46, 255))
        R(d, [6, 4, 22, 26], DOOR_COL[k], outline=(20, 20, 20, 255))
        d.line([(6, 4), (6, 26)], fill=(255, 255, 255, 70))
        E(d, [14, 13, 18, 17], (28, 28, 32, 255))
        R(d, [15, 16, 17, 20], (28, 28, 32, 255))
        return im
    return f


def draw_door_iron():
    # v0.12 铁门：加厚铁板 + 三道横杠 + 铆钉，与三色木门一眼可分（需 3 把黄钥匙）
    im, d = tile((30, 38, 48, 255))
    R(d, [3, 2, 25, 26], (69, 79, 88, 255))
    R(d, [5, 3, 23, 26], (141, 153, 165, 255), outline=(45, 54, 62, 255))
    for yy in (8, 14, 20):
        d.line([(5, yy), (23, yy)], fill=(86, 97, 108, 255))
    for xx in (7, 21):
        for yy in (6, 12, 18, 24):
            E(d, [xx - 1, yy - 1, xx + 1, yy + 1], (214, 222, 230, 255))
    E(d, [13, 12, 17, 16], (40, 46, 52, 255))
    R(d, [14, 16, 16, 20], (40, 46, 52, 255))
    return im


def make_key(k):
    def f():
        im, d = tile()
        c = DOOR_COL[k]
        E(d, [3, 8, 13, 18], c, outline=(255, 255, 255, 120))
        E(d, [6, 11, 10, 15], (0, 0, 0, 0))
        R(d, [11, 12, 24, 14], c)
        R(d, [20, 14, 22, 18], c)
        R(d, [23, 14, 25, 17], c)
        return im
    return f


# ---------------- 道具 ----------------
def make_potion(large):
    def f():
        im, d = tile()
        top = 8 if large else 11
        R(d, [9, top, 19, 26], (200, 225, 235, 170), outline=(150, 175, 190, 255))
        R(d, [10, top + 6, 18, 25], (183, 28, 28, 255) if large else (239, 83, 80, 255))
        R(d, [11, top - 4, 17, top + 1], (150, 160, 170, 255))
        R(d, [10, top + 1, 18, top + 3], (120, 130, 140, 255))
        d.line([(11, top + 3), (11, 23)], fill=(255, 255, 255, 140))
        if large:
            d.line([(12, 18), (16, 18)], fill=(255, 220, 220, 255))
            d.line([(14, 16), (14, 20)], fill=(255, 220, 220, 255))
        return im
    return f


def make_gem(atk):
    def f():
        im, d = tile()
        c = (255, 82, 82, 255) if atk else (68, 138, 255, 255)
        hi = (255, 160, 160, 255) if atk else (140, 190, 255, 255)
        P(d, [(14, 3), (24, 12), (14, 25), (4, 12)], c)
        P(d, [(14, 3), (14, 25), (4, 12)], hi)
        d.line([(14, 3), (14, 25)], fill=(255, 255, 255, 130))
        return im
    return f


def draw_sword():
    im, d = tile()
    P(d, [(13, 2), (17, 2), (17, 18), (13, 18)], (207, 216, 220, 255))
    P(d, [(13, 2), (15, 0), (17, 2)], (240, 245, 250, 255))
    d.line([(15, 3), (15, 17)], fill=(255, 255, 255, 160))
    R(d, [8, 18, 22, 20], (150, 100, 50, 255))
    R(d, [13, 20, 16, 26], (110, 70, 40, 255))
    return im


def draw_shield():
    im, d = tile()
    P(d, [(5, 4), (23, 4), (23, 15), (14, 26), (5, 15)], (144, 164, 174, 255))
    P(d, [(5, 4), (14, 4), (14, 26), (5, 15)], (176, 190, 197, 255))
    R(d, [13, 7, 15, 20], (240, 245, 250, 255))
    R(d, [8, 11, 20, 13], (240, 245, 250, 255))
    return im


def draw_gold():
    im, d = tile()
    E(d, [4, 4, 24, 24], (255, 193, 7, 255))
    E(d, [7, 7, 21, 21], (255, 213, 79, 255))
    d.ellipse([7, 7, 21, 21], outline=(200, 140, 0, 255))
    R(d, [13, 10, 15, 19], (200, 140, 0, 255))
    d.line([(10, 13), (18, 13)], fill=(200, 140, 0, 255))
    d.line([(10, 16), (18, 16)], fill=(200, 140, 0, 255))
    return im


def draw_fly():
    im, d = tile()
    P(d, [(14, 4), (26, 9), (21, 22), (14, 18)], (77, 208, 225, 255))
    P(d, [(14, 4), (2, 9), (7, 22), (14, 18)], (38, 166, 190, 255))
    d.line([(14, 5), (22, 11)], fill=(255, 255, 255, 120))
    d.line([(14, 5), (6, 11)], fill=(255, 255, 255, 90))
    E(d, [10, 9, 18, 18], (255, 213, 79, 255), outline=(200, 140, 0, 255))
    d.point((14, 13), fill=(160, 100, 0, 255))
    return im


def draw_bomb():
    im, d = tile()
    E(d, [5, 9, 23, 26], (45, 50, 58, 255))
    E(d, [8, 11, 14, 16], (95, 105, 118, 255))
    d.line([(15, 9), (19, 4)], fill=(160, 120, 60, 255), width=2)
    E(d, [18, 1, 24, 7], (255, 152, 0, 255))
    E(d, [20, 3, 22, 5], (255, 235, 59, 255))
    return im


# ---------------- 怪物 ----------------
def draw_m1():
    im, d = tile()
    E(d, [3, 10, 25, 26], (76, 175, 80, 255))
    E(d, [3, 8, 25, 23], (102, 187, 105, 255))
    E(d, [7, 12, 13, 18], (255, 255, 255, 255)); d.point((10, 15), fill=(20, 30, 20, 255))
    E(d, [15, 12, 21, 18], (255, 255, 255, 255)); d.point((18, 15), fill=(20, 30, 20, 255))
    d.arc([10, 18, 18, 23], 0, 180, fill=(40, 110, 45, 255))
    E(d, [6, 9, 10, 12], (255, 255, 255, 110))
    return im


def draw_m2():
    im, d = tile()
    P(d, [(14, 11), (2, 5), (5, 18), (14, 16)], (126, 87, 194, 255))
    P(d, [(14, 11), (26, 5), (23, 18), (14, 16)], (126, 87, 194, 255))
    E(d, [9, 9, 19, 22], (149, 117, 205, 255))
    P(d, [(10, 9), (14, 5), (14, 10)], (126, 87, 194, 255))
    P(d, [(18, 9), (14, 5), (14, 10)], (126, 87, 194, 255))
    d.point((12, 14), fill=(255, 235, 59, 255)); d.point((16, 14), fill=(255, 235, 59, 255))
    return im


def draw_m3():
    im, d = tile()
    P(d, [(6, 9), (3, 1), (11, 7)], (229, 57, 53, 255))
    P(d, [(22, 9), (25, 1), (17, 7)], (229, 57, 53, 255))
    E(d, [5, 6, 23, 25], (183, 28, 28, 255))
    E(d, [8, 9, 20, 21], (229, 57, 53, 255))
    E(d, [9, 12, 13, 16], (255, 235, 59, 255)); d.point((11, 14), fill=(60, 10, 10, 255))
    E(d, [15, 12, 19, 16], (255, 235, 59, 255)); d.point((17, 14), fill=(60, 10, 10, 255))
    P(d, [(11, 19), (17, 19), (14, 23)], (60, 10, 10, 255))
    return im


def draw_m4():
    im, d = tile()
    E(d, [6, 3, 22, 20], (207, 216, 220, 255))
    R(d, [9, 18, 19, 25], (176, 190, 197, 255))
    E(d, [9, 9, 14, 15], (38, 44, 50, 255)); E(d, [14, 9, 19, 15], (38, 44, 50, 255))
    P(d, [(13, 14), (15, 14), (14, 18)], (38, 44, 50, 255))
    d.line([(10, 21), (18, 21)], fill=(60, 66, 72, 255))
    d.line([(13, 21), (13, 24)], fill=(60, 66, 72, 255))
    d.line([(16, 21), (16, 24)], fill=(60, 66, 72, 255))
    return im


def draw_m5():
    im, d = tile()
    P(d, [(14, 1), (4, 12), (24, 12)], (60, 70, 130, 255))
    R(d, [3, 11, 25, 14], (49, 58, 110, 255))
    P(d, [(7, 13), (21, 13), (24, 26), (4, 26)], (92, 107, 192, 255))
    E(d, [10, 15, 13, 19], (77, 208, 225, 255))
    E(d, [15, 15, 18, 19], (77, 208, 225, 255))
    E(d, [14, 21, 18, 24], (255, 213, 79, 255))
    return im


def draw_m6():
    """石头人：方块岩体 + 裂纹，高防低血的视觉暗示。"""
    im, d = tile()
    R(d, [5, 5, 23, 25], (141, 110, 99, 255), (90, 65, 55, 255))
    R(d, [8, 8, 20, 20], (161, 130, 116, 255))
    R(d, [9, 12, 13, 15], (60, 45, 40, 255)); R(d, [16, 12, 20, 15], (60, 45, 40, 255))
    d.line([(11, 20), (14, 22), (17, 20)], fill=(90, 65, 55, 255))
    d.line([(7, 10), (10, 8), (12, 10)], fill=(190, 160, 145, 255))
    d.line([(18, 22), (21, 20)], fill=(190, 160, 145, 255))
    return im


def draw_m7():
    """兽人：獠牙 + 斧刃，高攻的视觉暗示。"""
    im, d = tile()
    E(d, [6, 5, 22, 24], (150, 92, 40, 255), (100, 58, 24, 255))
    P(d, [(8, 7), (12, 2), (14, 8)], (216, 150, 80, 255))
    P(d, [(20, 7), (16, 2), (14, 8)], (216, 150, 80, 255))
    R(d, [9, 12, 13, 15], (40, 30, 20, 255)); R(d, [15, 12, 19, 15], (40, 30, 20, 255))
    P(d, [(11, 18), (13, 22), (15, 18)], (255, 245, 230, 255))
    P(d, [(15, 18), (17, 22), (19, 18)], (255, 245, 230, 255))
    R(d, [22, 3, 25, 22], (120, 80, 50, 255))
    P(d, [(20, 3), (27, 6), (27, 12), (20, 10)], (207, 216, 220, 255))
    return im


def draw_m8():
    """魔法警卫：头盔 + 法术光环，真实伤害的视觉暗示。"""
    im, d = tile()
    E(d, [3, 3, 25, 25], (0, 137, 123, 90))
    R(d, [8, 4, 20, 22], (38, 120, 112, 255), (20, 80, 74, 255))
    R(d, [6, 8, 22, 11], (0, 150, 136, 255))
    R(d, [10, 13, 18, 18], (20, 70, 66, 255))
    R(d, [11, 14, 13, 16], (120, 255, 230, 255)); R(d, [15, 14, 17, 16], (120, 255, 230, 255))
    R(d, [12, 20, 16, 21], (120, 255, 230, 255))
    P(d, [(14, 1), (11, 4), (17, 4)], (255, 213, 79, 255))
    return im


# ---------------- 地形 / 出口 ----------------
def draw_up():
    im, d = tile((27, 36, 48, 255))
    P(d, [(14, 3), (24, 13), (19, 13), (19, 25), (9, 25), (9, 13), (4, 13)], (102, 187, 106, 255))
    d.line([(14, 5), (14, 22)], fill=(255, 255, 255, 110))
    return im


def draw_down():
    im, d = tile((27, 36, 48, 255))
    P(d, [(14, 25), (4, 15), (9, 15), (9, 3), (19, 3), (19, 15), (24, 15)], (141, 110, 99, 255))
    d.line([(14, 6), (14, 23)], fill=(255, 255, 255, 90))
    return im


def draw_throne():
    im, d = tile((27, 36, 48, 255))
    R(d, [7, 4, 21, 21], (171, 71, 188, 255))
    R(d, [9, 6, 19, 18], (186, 104, 200, 255))
    R(d, [4, 18, 24, 24], (142, 36, 170, 255))
    E(d, [11, 6, 17, 12], (255, 213, 79, 255))
    d.point((14, 9), fill=(255, 255, 255, 255))
    return im


def draw_shop():
    im, d = tile((27, 36, 48, 255))
    P(d, [(2, 11), (14, 3), (26, 11)], (38, 198, 218, 255))
    R(d, [4, 11, 24, 22], (38, 150, 170, 255))
    R(d, [4, 11, 24, 12], (255, 213, 79, 255))
    R(d, [8, 17, 20, 23], (120, 90, 60, 255))
    R(d, [10, 13, 18, 16], (255, 213, 79, 255))
    return im


# ---------------- v0.8 新增：图鉴 / 法师 / 盗贼 ----------------
def draw_codex():
    im, d = tile((27, 36, 48, 255))
    R(d, [5, 4, 23, 24], (74, 20, 100, 255), (40, 10, 60, 255))
    R(d, [7, 6, 21, 22], (186, 104, 200, 255))
    R(d, [9, 8, 19, 20], (245, 240, 255, 235))
    for y in (11, 14, 17):
        d.line([(11, y), (17, y)], fill=(140, 80, 165, 255))
    R(d, [13, 2, 15, 5], (255, 213, 79, 255))
    return im


def draw_npc_mage():
    im, d = tile((27, 36, 48, 255))
    P(d, [(14, 1), (6, 12), (22, 12)], (126, 87, 194, 255), (70, 40, 120, 255))
    R(d, [7, 11, 21, 13], (94, 53, 177, 255))
    E(d, [10, 13, 18, 21], (200, 180, 235, 255))
    d.point((12, 16), fill=(45, 30, 70, 255)); d.point((16, 16), fill=(45, 30, 70, 255))
    P(d, [(6, 27), (22, 27), (19, 19), (9, 19)], (126, 87, 194, 255))
    R(d, [13, 21, 15, 27], (255, 213, 79, 255))
    return im


def draw_npc_thief():
    im, d = tile((27, 36, 48, 255))
    E(d, [8, 5, 20, 17], (141, 110, 99, 255), (90, 65, 55, 255))
    R(d, [9, 10, 19, 13], (52, 34, 30, 255))
    d.point((12, 9), fill=(255, 213, 79, 255)); d.point((16, 9), fill=(255, 213, 79, 255))
    P(d, [(6, 27), (22, 27), (20, 15), (8, 15)], (109, 76, 65, 255))
    R(d, [4, 19, 7, 21], (255, 213, 79, 255))
    R(d, [4, 21, 5, 24], (255, 213, 79, 255))
    return im


# ---------------- v0.13 新增：老者 / 任务道具 / 封印门 ----------------
def draw_npc_elder():
    """老者：灰白兜帽 + 拐杖，12F 房间救出后解锁炸弹。"""
    im, d = tile((27, 36, 48, 255))
    P(d, [(14, 1), (6, 12), (22, 12)], (188, 170, 164, 255), (120, 105, 100, 255))
    R(d, [7, 11, 21, 13], (161, 136, 127, 255))
    E(d, [10, 13, 18, 21], (239, 224, 210, 255))
    d.point((12, 16), fill=(60, 45, 40, 255)); d.point((16, 16), fill=(60, 45, 40, 255))
    P(d, [(11, 19), (17, 19), (16, 23), (12, 23)], (222, 213, 205, 255))  # 白胡须
    P(d, [(6, 27), (22, 27), (19, 20), (9, 20)], (161, 136, 127, 255))
    R(d, [22, 14, 24, 27], (141, 110, 99, 255))   # 拐杖
    R(d, [21, 13, 25, 15], (141, 110, 99, 255))
    return im


def draw_lockpick():
    """锁匠工具：撬棍 + 钩针，盗贼任务线道具一。"""
    im, d = tile((27, 36, 48, 255))
    d.line([(7, 21), (19, 9)], fill=(176, 190, 197, 255), width=3)
    P(d, [(19, 9), (23, 5), (25, 7), (21, 11)], (207, 216, 220, 255))
    d.line([(10, 24), (16, 18)], fill=(120, 144, 156, 255), width=2)
    R(d, [5, 21, 9, 25], (141, 110, 99, 255))
    return im


def draw_moneybag():
    """钱袋：束口布袋 + 金币，盗贼任务线道具二。"""
    im, d = tile((27, 36, 48, 255))
    E(d, [7, 10, 21, 25], (202, 168, 106, 255), (150, 116, 62, 255))
    R(d, [11, 6, 17, 11], (150, 116, 62, 255))
    d.line([(10, 8), (18, 8)], fill=(110, 82, 40, 255), width=2)
    E(d, [12, 14, 16, 18], (255, 202, 40, 255))
    d.point((14, 16), fill=(255, 245, 200, 255))
    return im


def draw_door_seal():
    """封印门 Z：紫黑门板 + 符文锁，三色钥匙无效，只有盗贼能撬。"""
    im, d = tile((27, 36, 48, 255))
    R(d, [3, 2, 25, 26], (74, 52, 107, 255), (42, 28, 66, 255))
    R(d, [5, 4, 23, 24], (94, 68, 133, 255))
    R(d, [7, 6, 21, 22], (58, 38, 88, 255))
    E(d, [11, 10, 17, 17], (123, 94, 167, 255), (216, 180, 254, 255))  # 锁孔符文圈
    R(d, [13, 12, 15, 15], (216, 180, 254, 255))
    d.line([(14, 15), (14, 18)], fill=(216, 180, 254, 255), width=2)
    for x, y in [(8, 6), (20, 6), (8, 21), (20, 21)]:
        d.point((x, y), fill=(216, 180, 254, 255))
    return im


# ---------------- 特效 ----------------
def draw_fx_hit():
    im, d = tile()
    P(d, [(14, 2), (17, 11), (26, 14), (17, 17), (14, 26), (11, 17), (2, 14), (11, 11)], (255, 255, 255, 235))
    E(d, [11, 11, 17, 17], (255, 213, 79, 255))
    return im


def draw_fx_boom():
    im, d = tile()
    E(d, [3, 3, 25, 25], (255, 112, 67, 230))
    E(d, [7, 7, 21, 21], (255, 213, 79, 255))
    E(d, [11, 11, 17, 17], (255, 255, 255, 255))
    for a in range(0, 360, 45):
        x = 14 + 13 * math.cos(math.radians(a)); y = 14 + 13 * math.sin(math.radians(a))
        d.line([(14, 14), (x, y)], fill=(255, 152, 0, 255), width=2)
    return im


def draw_fx_pick():
    im, d = tile()
    P(d, [(14, 3), (17, 11), (25, 14), (17, 17), (14, 25), (11, 17), (3, 14), (11, 11)], (255, 213, 79, 240))
    E(d, [12, 12, 16, 16], (255, 255, 255, 255))
    return im


# ---------------- 精灵表 ----------------
SPRITES = [
    ('wall', draw_wall), ('floor', draw_floor),
    ('hero_a', lambda: draw_hero(0)), ('hero_b', lambda: draw_hero(1)),
    ('door_y', make_door('y')), ('door_b', make_door('b')), ('door_r', make_door('r')),
    ('door_iron', draw_door_iron),
    ('key_y', make_key('y')), ('key_b', make_key('b')), ('key_r', make_key('r')),
    ('potion_s', make_potion(False)), ('potion_l', make_potion(True)),
    ('gem_atk', make_gem(True)), ('gem_def', make_gem(False)),
    ('sword', draw_sword), ('shield', draw_shield), ('gold', draw_gold),
    ('fly', draw_fly), ('bomb', draw_bomb),
    ('m1', draw_m1), ('m2', draw_m2), ('m3', draw_m3), ('m4', draw_m4), ('m5', draw_m5),
    ('m6', draw_m6), ('m7', draw_m7), ('m8', draw_m8),
    ('up', draw_up), ('down', draw_down), ('throne', draw_throne),
    ('shop', draw_shop), ('hidden', draw_floor),
    ('codex', draw_codex), ('npc_mage', draw_npc_mage), ('npc_thief', draw_npc_thief),
    ('npc_elder', draw_npc_elder), ('lockpick', draw_lockpick),
    ('moneybag', draw_moneybag), ('door_seal', draw_door_seal),
    ('fx_hit', draw_fx_hit), ('fx_boom', draw_fx_boom), ('fx_pick', draw_fx_pick),
]

TILE_MAP = {
    # '@' 是 levels.json 的出生点标记，不是实体；与 logic.js buildCells() 一样归一化成地板，
    # 避免任何绕过 buildCells 的渲染路径把它画成第二个英雄（v0.6.0 修复 1F 残留单位）。
    '#': 'wall', '.': 'floor', '@': 'floor',
    # v0.12：暗门 A 伪装成普通砖墙（与 # 共用 wall 帧），只有撞开才显形；
    # 铁门 G 用独立加厚铁板帧。两者都进 atlas，像素图模式下不会回退成色块。
    'A': 'wall', 'G': 'door_iron',
    'Y': 'door_y', 'B': 'door_b', 'R': 'door_r',
    'y': 'key_y', 'b': 'key_b', 'r': 'key_r',
    'p': 'potion_s', 'P': 'potion_l', 'a': 'gem_atk', 'd': 'gem_def',
    's': 'sword', 'S': 'shield', 'g': 'gold', 'F': 'fly', 'o': 'bomb',
    '1': 'm1', '2': 'm2', '3': 'm3', '4': 'm4', '5': 'm5',
    '6': 'm6', '7': 'm7', '8': 'm8',
    'U': 'up', 'D': 'down', 'W': 'throne', 'N': 'shop', 'H': 'hidden',
    'I': 'codex', 'M': 'npc_mage', 'T': 'npc_thief',
    'E': 'npc_elder', 'j': 'lockpick', 'q': 'moneybag', 'Z': 'door_seal'
}

cols = 8
rows = math.ceil(len(SPRITES) / cols)
sheet = Image.new('RGBA', (cols * T, rows * T), (0, 0, 0, 0))
frames = {}
made = {}
for i, (name, fn) in enumerate(SPRITES):
    im = fn()
    made[name] = im
    x, y = (i % cols) * T, (i // cols) * T
    sheet.paste(im, (x, y))
    frames[name] = {'x': x, 'y': y, 'w': T, 'h': T}
sheet.save(os.path.join(OUT, 'sprites.png'), 'PNG')
atlas = {
    'file': 'sprites.png', 'tile': T, 'cols': cols, 'rows': rows,
    'width': cols * T, 'height': rows * T, 'count': len(SPRITES),
    'frames': frames, 'tileMap': TILE_MAP
}
with open(os.path.join(OUT, 'sprites.json'), 'w', encoding='utf-8') as f:
    json.dump(atlas, f, ensure_ascii=False, indent=2)


# ---------------- 循环 GIF 动画 ----------------
def to_rgb(im, bg=(11, 16, 23)):
    base = Image.new('RGBA', (T, T), bg + (255,))
    base.alpha_composite(im)
    return base.convert('RGB')


def write_gif(name, frames_img, duration=280, scale=3):
    ims = [to_rgb(f).resize((T * scale, T * scale), Image.NEAREST).convert('P', palette=Image.ADAPTIVE)
           for f in frames_img]
    ims[0].save(os.path.join(OUT, name), save_all=True, append_images=ims[1:],
                duration=duration, loop=0, disposal=2, optimize=False)


write_gif('hero_idle.gif', [made['hero_a'], made['hero_b'], made['hero_a'], made['hero_b']])
# 史莱姆：原帧 / 压扁 / 原帧 / 拉高
squash = made['m1'].resize((T, 23), Image.NEAREST)
sq = Image.new('RGBA', (T, T), (0, 0, 0, 0)); sq.paste(squash, (0, 5))
tall = made['m1'].resize((T, 25), Image.NEAREST)
tl = Image.new('RGBA', (T, T), (0, 0, 0, 0)); tl.paste(tall, (0, 0))
write_gif('slime_idle.gif', [made['m1'], sq, made['m1'], tl], duration=320)


# ---------------- 标题氛围插画（像素风兜底，可被 AI 插画覆盖）----------------
def draw_title():
    W, H = 480, 260
    im = Image.new('RGB', (W, H), (9, 14, 24))
    d = ImageDraw.Draw(im)
    # 星空
    import random
    random.seed(7)
    for _ in range(90):
        x, y = random.randint(0, W - 1), random.randint(0, 170)
        c = random.choice([(90, 110, 140), (140, 160, 190), (200, 210, 230)])
        d.point((x, y), fill=c)
    # 月亮
    d.ellipse([370, 30, 430, 90], fill=(255, 240, 190))
    d.ellipse([382, 34, 442, 94], fill=(9, 14, 24))
    # 远山
    d.polygon([(0, 190), (70, 130), (150, 195), (230, 145), (330, 200), (420, 150), (480, 195), (480, 260), (0, 260)],
              fill=(20, 30, 46))
    # 塔身（逐层收窄）：层数取自 levels.json，窗带高度按层数自适应
    d.rectangle([196, 60, 284, 240], fill=(38, 52, 66))
    d.rectangle([196, 60, 284, 240], outline=(70, 92, 110))
    band = 174.0 / FLOOR_COUNT
    for i in range(FLOOR_COUNT):
        y = 64 + i * band
        inset = i * (12.0 / FLOOR_COUNT)
        d.rectangle([208 + inset, y, 272 - inset, y + max(5, band * 0.6)], fill=(24, 34, 46))
        for wx in (218, 238, 258):
            d.rectangle([wx, y + 1, wx + 5, min(y + 6, y + max(5, band * 0.6))], fill=(255, 200, 90))
    # 塔尖 + 旗
    d.polygon([(196, 60), (240, 22), (284, 60)], fill=(90, 40, 110))
    d.line([(240, 22), (240, 8)], fill=(200, 190, 170))
    d.polygon([(240, 8), (256, 12), (240, 16)], fill=(229, 57, 53))
    # 底层门
    d.rectangle([232, 222, 248, 240], fill=(120, 80, 40))
    # 地面
    d.rectangle([0, 240, W, H], fill=(16, 24, 34))
    im.save(os.path.join(OUT, 'title.png'), 'PNG')


draw_title()


# ---------------- 8-bit WAV 音效 ----------------
SR = 22050


def env(t, k=9):
    return np.exp(-t * k)


def tone(freq, dur, kind='square', decay=9, vol=0.42):
    t = np.linspace(0, dur, int(SR * dur), False)
    if kind == 'square':
        s = np.sign(np.sin(2 * np.pi * freq * t))
    elif kind == 'tri':
        s = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * freq * t))
    else:
        s = np.sin(2 * np.pi * freq * t)
    return (s * env(t, decay) * vol * 32767).astype(np.int16)


def slide(f0, f1, dur, vol=0.42):
    t = np.linspace(0, dur, int(SR * dur), False)
    f = np.linspace(f0, f1, len(t))
    s = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR))
    return (s * env(t, 7) * vol * 32767).astype(np.int16)


def noise(dur, vol=0.35, decay=11):
    t = np.linspace(0, dur, int(SR * dur), False)
    s = np.random.default_rng(42).uniform(-1, 1, len(t))
    return (s * env(t, decay) * vol * 32767).astype(np.int16)


def seq(*parts):
    out = []
    for p in parts:
        out.append(p)
        out.append(np.zeros(int(SR * 0.012), dtype=np.int16))
    return np.concatenate(out) if out else np.zeros(1, dtype=np.int16)


def melody(notes, dur=0.11, kind='square'):
    return seq(*[tone(n, dur, kind, 8) for n in notes])


AUDIO = {
    'footstep': seq(tone(70, 0.05, 'tri', 22, 0.30), noise(0.03, 0.10, 30)),
    'pickup': melody([523, 659, 784], 0.075),
    'door': seq(tone(110, 0.12, 'square', 9), noise(0.05, 0.22, 20)),
    'battle_hit': seq(noise(0.10, 0.42, 16), tone(150, 0.10, 'square', 14, 0.30)),
    'hurt': slide(320, 110, 0.28, 0.40),
    'powerup': melody([392, 523, 659, 784, 1047], 0.085),
    'hidden': seq(tone(1047, 0.16, 'tri', 6), tone(1319, 0.20, 'tri', 5), noise(0.04, 0.08, 25)),
    'bomb': seq(noise(0.38, 0.50, 7), tone(60, 0.32, 'tri', 8, 0.40)),
    'win': melody([523, 659, 784, 1047, 784, 1047], 0.14),
    'lose': melody([392, 330, 262, 196], 0.19),
    'click': tone(1000, 0.025, 'square', 30, 0.22),
    'story': tone(660, 0.10, 'tri', 10, 0.28),
}

for name, data in AUDIO.items():
    with wave.open(os.path.join(AUD, name + '.wav'), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(np.clip(data, -32768, 32767).astype('<i2').tobytes())


# ---------------- 资源清单 ----------------
manifest = {
    'version': APP_VERSION,
    'sprites': {'image': 'assets/sprites.png', 'atlas': 'assets/sprites.json',
                'tile': T, 'count': len(SPRITES)},
    'animations': ['assets/hero_idle.gif', 'assets/slime_idle.gif'],
    'illustration': 'assets/title.png',
    'audio': {'dir': 'assets/audio', 'files': sorted(n + '.wav' for n in AUDIO)},
    'texts': {'file': 'texts.js', 'sfxKeys': sorted(AUDIO)},
    'levels': {'file': 'levels/levels.json', 'floors': FLOOR_COUNT},
    'note': '全部由 tools/gen_assets.py 程序化生成；版本号取自 version.js、塔层数取自 levels.json；title.png 可被 AI 插画覆盖，风格需与像素精灵协调'
}
with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print('sprites.png :', sheet.size, len(SPRITES), '帧')
print('GIF         : hero_idle.gif / slime_idle.gif')
print('title.png   : 480x260 像素风兜底')
print('WAV         :', len(AUDIO), '个 ->', ', '.join(sorted(AUDIO)))
print('manifest.json 已生成（version = ' + APP_VERSION + '，取自 version.js）')
