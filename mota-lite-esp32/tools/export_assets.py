# -*- coding: utf-8 -*-
"""
export_assets.py —— 把 mota-lite-web 的运行时资源转成 ESP32 固件可用的 C 数组。

产出（写到 main/assets/）：
  sprites.c/.h   46 帧 28x28，RGB565 + 1bit alpha
  font16.c/.h    16x16 点阵字库（ASCII + GB2312 一级汉字 + texts.js 实际用字）
  sfx.c/.h       12 段 22050Hz/16bit/mono PCM

设计约束：
  - 只读 ../mota-lite-web/，不改动 web 工程任何文件
  - 生成顺序严格跟随 sprites.json 的 frames 定义顺序，索引稳定
  - 字体按码点升序排列，C 侧二分查找

Created by Davis
"""

import json
import os
import re
import struct
import wave

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WEB = os.path.join(os.path.dirname(PROJ), 'mota-lite-web')
OUT = os.path.join(PROJ, 'main', 'assets')

TILE = 28
# 字号决策：480x480 屏上 16px 复杂汉字笔画糊成一团（实测「魔」的鬼部无法分辨），
# 24px SimHei 结构清晰。每行用 uint32 存（bit23..bit0 = x0..x23），行数即字号。
FONT_PX = 24
FONT_STRIDE = FONT_PX * 4
FONT_BASELINE = 0.86
FONT_PATH = 'C:/Windows/Fonts/simhei.ttf'

os.makedirs(OUT, exist_ok=True)


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print('  wrote %-28s %8d bytes' % (os.path.basename(path), len(text.encode('utf-8'))))


# ---------------- 精灵图集 ----------------

def rgb565(r, g, b):
    """RGB565，并做高低字节交换。
    必须与 main/gfx.h 的 rgb565_pack 保持一致：CO5300 走 QSPI 按高字节先收，
    若不交换整屏会呈现偏紫粉的错色。
    """
    v = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
    return ((v >> 8) | (v << 8)) & 0xFFFF


def export_sprites():
    print('[sprites]')
    atlas = json.load(open(os.path.join(WEB, 'assets', 'sprites.json'), encoding='utf-8'))
    img = Image.open(os.path.join(WEB, 'assets', 'sprites.png')).convert('RGBA')
    names = list(atlas['frames'].keys())
    pixels, alphas = [], []

    for name in names:
        fr = atlas['frames'][name]
        crop = img.crop((fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h']))
        crop = crop.resize((TILE, TILE)) if crop.size != (TILE, TILE) else crop
        m = crop.load()
        row_px, row_al = [], []
        acc_bits, acc_n = 0, 0
        for y in range(TILE):
            for x in range(TILE):
                r, g, b, a = m[x, y]
                row_px.append(rgb565(r, g, b) if a > 127 else 0)
                acc_bits = (acc_bits << 1) | (1 if a > 127 else 0)
                acc_n += 1
                if acc_n == 8:
                    row_al.append(acc_bits)
                    acc_bits, acc_n = 0, 0
        pixels.extend(row_px)
        alphas.extend(row_al)

    h = ['// 自动生成，勿手改。来源 mota-lite-web/assets/sprites.{png,json}',
         '// Created by Davis', '',
         '#pragma once', '#include <stdint.h>', '',
         '// 帧号常量（SPR_WALL 等），供渲染层与 tilemap.c 使用',
         '#include "sprite_index.h"', '',
         '#define SPRITE_TILE   %d' % TILE,
         '#define SPRITE_COUNT  %d' % len(names),
         '#define SPRITE_PIXELS (%d * %d)' % (TILE, TILE),
         '#define SPRITE_ALPHA_BYTES %d' % (TILE * TILE // 8), '',
         'typedef struct { const char *name; uint16_t index; } sprite_named_t;', '',
         'extern const uint16_t g_sprite_pixels[SPRITE_COUNT * SPRITE_PIXELS];',
         'extern const uint8_t  g_sprite_alpha[SPRITE_COUNT * SPRITE_ALPHA_BYTES];',
         'extern const sprite_named_t g_sprite_names[SPRITE_COUNT];', '',
         '// 按名字取帧号，未找到返回 -1', 'int sprite_find(const char *name);', '']
    write(os.path.join(OUT, 'sprites.h'), '\n'.join(h))

    c = ['// 自动生成，勿手改。', '// Created by Davis', '',
         '#include "sprites.h"', '#include <string.h>', '',
         'const uint16_t g_sprite_pixels[SPRITE_COUNT * SPRITE_PIXELS] = {']
    for i in range(0, len(pixels), 16):
        c.append('    ' + ','.join('0x%04X' % v for v in pixels[i:i + 16]) + ',')
    c.append('};')
    c.append('')
    c.append('const uint8_t g_sprite_alpha[SPRITE_COUNT * SPRITE_ALPHA_BYTES] = {')
    for i in range(0, len(alphas), 20):
        c.append('    ' + ','.join('0x%02X' % v for v in alphas[i:i + 20]) + ',')
    c.append('};')
    c.append('')
    c.append('const sprite_named_t g_sprite_names[SPRITE_COUNT] = {')
    for i, n in enumerate(names):
        c.append('    {"%s", %d},' % (n, i))
    c.append('};')
    c.append('')
    c.append('int sprite_find(const char *name)')
    c.append('{')
    c.append('    for (int i = 0; i < SPRITE_COUNT; i++) {')
    c.append('        if (strcmp(g_sprite_names[i].name, name) == 0) return i;')
    c.append('    }')
    c.append('    return -1;')
    c.append('}')
    c.append('')
    write(os.path.join(OUT, 'sprites.c'), '\n'.join(c))

    tb = os.path.join(OUT, 'sprite_index.h')
    e = ['// 自动生成：精灵帧号常量，勿手改。', '// Created by Davis', '',
         '#pragma once', '']
    for i, n in enumerate(names):
        e.append('#define SPR_%-12s %d' % (n.upper(), i))
    e.append('')
    e.append('#define SPR_COUNT %d' % len(names))
    e.append('#define SPR_NONE  -1')
    e.append('')
    write(tb, '\n'.join(e))

    return names, atlas


# ---------------- 字符集 ----------------

def gb2312_level1():
    """GB2312 一级汉字：0xB0A1 - 0xD7F9，共 3755 字。"""
    out = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                continue
    return out


def collect_charset():
    chars = set()
    for cp in range(0x20, 0x7F):
        chars.add(chr(cp))
    chars.update('，。、！？：；“”‘’「」（）《》…—·【】')
    chars.update(gb2312_level1())

    # texts.js 里实际出现的全部汉字 + 标点，确保不漏
    tp = os.path.join(WEB, 'texts.js')
    if os.path.exists(tp):
        s = open(tp, encoding='utf-8').read()
        for ch in s:
            if ord(ch) >= 0x80:
                chars.add(ch)

    # 运行时会拼接的字样：层数、数值、货币、倍率等
    chars.update('第层攻击防御生命金币经验钥匙黄蓝红铁封印伤害怪物回合临界每少掉秒无可使用拾取升层降失败胜利存档读新游戏设置')

    return sorted(chars)


# ---------------- 字库 ----------------

def export_font():
    print('[font]')
    chars = collect_charset()
    font = ImageFont.truetype(FONT_PATH, FONT_PX)
    pen_y = int(FONT_PX * FONT_BASELINE)

    glyphs, table = [], []
    for ch in chars:
        canvas = Image.new('L', (FONT_PX, FONT_PX), 0)
        # anchor='ls' 以基线左端对齐，保证所有字行高一致、地脚齐平
        ImageDraw.Draw(canvas).text((0, pen_y), ch, fill=255, font=font, anchor='ls')
        px = canvas.load()

        rows = []
        blank = True
        min_x, max_x = FONT_PX, -1
        for y in range(FONT_PX):
            bits = 0
            for x in range(FONT_PX):
                if px[x, y] > 110:
                    bits |= (1 << (FONT_PX - 1 - x))
                    blank = False
                    if x < min_x: min_x = x
                    if x > max_x: max_x = x
            rows.append(bits)
        if blank and ch != ' ':
            continue
        # 汉字/全角标点保持 24px 全宽；ASCII 用墨迹宽度 +2，避免「- 5 6 H P」
        if blank:
            adv = FONT_PX // 2
        elif ord(ch) >= 0x80:
            adv = FONT_PX
        else:
            # 用右边界推进（含左侧留白），否则数字会和下一个字重叠
            adv = max(6, min(FONT_PX, max_x + 2))
        table.append((ord(ch), len(glyphs), adv))
        glyphs.append(rows)

    h = ['// 自动生成，勿手改。%dx%d 点阵字库（simhei 渲染，基线对齐）。' % (FONT_PX, FONT_PX),
         '// Created by Davis', '',
         '#pragma once', '#include <stdint.h>', '',
         '#define FONT_PX      %d' % FONT_PX,
         '#define FONT_STRIDE  %d' % FONT_STRIDE,
         '#define FONT_COUNT   %d' % len(glyphs), '',
         '// 取字形位图：%d 个 uint32，每个 bit%d..bit0 对应 x0..x%d；缺字返回 0' % (
             FONT_PX, FONT_PX - 1, FONT_PX - 1),
         'const uint32_t *font_glyph(uint32_t codepoint);', '',
         '// 字形是否存在（缺字返回 0）',
         'int font_width(uint32_t codepoint);', '',
         '// 推进宽度：汉字 24，ASCII 按墨迹宽度 +2',
         'int font_advance(uint32_t codepoint);', '']
    write(os.path.join(OUT, 'font24.h'), '\n'.join(h))

    c = ['// 自动生成，勿手改。', '// Created by Davis', '',
         '#include "font24.h"', '#include <stddef.h>', '',
         'static const uint32_t g_font_bitmap[FONT_COUNT][FONT_PX] = {']
    for rows in glyphs:
        c.append('    {' + ','.join('0x%06X' % r for r in rows) + '},')
    c.append('};')
    c.append('')
    c.append('typedef struct { uint16_t cp; uint16_t idx; uint8_t adv; } font_entry_t;')
    c.append('')
    c.append('static const font_entry_t g_font_table[FONT_COUNT] = {')
    for cp, idx, adv in table:
        c.append('    {0x%04X, %d, %d},' % (cp, idx, adv))
    c.append('};')
    c.append('')
    c.append('const uint32_t *font_glyph(uint32_t cp)')
    c.append('{')
    c.append('    int lo = 0, hi = FONT_COUNT - 1;')
    c.append('    while (lo <= hi) {')
    c.append('        int mid = (lo + hi) >> 1;')
    c.append('        uint32_t v = g_font_table[mid].cp;')
    c.append('        if (v == cp) return g_font_bitmap[g_font_table[mid].idx];')
    c.append('        if (v < cp) lo = mid + 1; else hi = mid - 1;')
    c.append('    }')
    c.append('    return NULL;')
    c.append('}')
    c.append('')
    c.append('int font_width(uint32_t cp)')
    c.append('{')
    c.append('    return font_glyph(cp) ? FONT_PX : 0;')
    c.append('}')
    c.append('')
    c.append('int font_advance(uint32_t cp)')
    c.append('{')
    c.append('    int lo = 0, hi = FONT_COUNT - 1;')
    c.append('    while (lo <= hi) {')
    c.append('        int mid = (lo + hi) >> 1;')
    c.append('        uint32_t v = g_font_table[mid].cp;')
    c.append('        if (v == cp) return g_font_table[mid].adv;')
    c.append('        if (v < cp) lo = mid + 1; else hi = mid - 1;')
    c.append('    }')
    c.append('    return 0;')
    c.append('}')
    c.append('')
    write(os.path.join(OUT, 'font24.c'), '\n'.join(c))

    return len(glyphs)


# ---------------- 小号 ASCII 字库（HUD 数值 / 伤害飘字） ----------------

FONT20_PX = 20
FONT20_BASELINE = 0.86


def export_font20():
    print('[font20]')
    chars = [chr(cp) for cp in range(0x20, 0x7F)]
    font = ImageFont.truetype(FONT_PATH, FONT20_PX)
    pen_y = int(FONT20_PX * FONT20_BASELINE)

    glyphs, table = [], []
    for ch in chars:
        canvas = Image.new('L', (FONT20_PX, FONT20_PX), 0)
        ImageDraw.Draw(canvas).text((0, pen_y), ch, fill=255, font=font, anchor='ls')
        px = canvas.load()

        rows = []
        blank = True
        min_x, max_x = FONT20_PX, -1
        for y in range(FONT20_PX):
            bits = 0
            for x in range(FONT20_PX):
                if px[x, y] > 110:
                    bits |= (1 << (FONT20_PX - 1 - x))
                    blank = False
                    if x < min_x: min_x = x
                    if x > max_x: max_x = x
            rows.append(bits)
        if blank and ch != ' ':
            continue
        # 变宽推进：数字/标点很窄，按固定 20px 排会变成「2 0 0」
        adv = 6 if blank else max(6, max_x + 3)
        table.append((ord(ch), len(glyphs), adv))
        glyphs.append(rows)

    h = ['// 自动生成，勿手改。%dx%d ASCII 点阵（simhei 渲染）。' % (FONT20_PX, FONT20_PX),
         '// 用途：HUD 数值与伤害飘字，24px 中文放不下的地方。',
         '// Created by Davis', '',
         '#pragma once', '#include <stdint.h>', '',
         '#define FONT20_PX     %d' % FONT20_PX,
         '#define FONT20_COUNT  %d' % len(glyphs), '',
         '// 取字形位图：%d 个 uint32；缺字返回 0' % FONT20_PX,
         'const uint32_t *font20_glyph(uint32_t codepoint);', '',
         '// 变宽推进：数字/字母按实际墨迹宽度 + 3px',
         'int font20_advance(uint32_t codepoint);', '']


    write(os.path.join(OUT, 'font20.h'), '\n'.join(h))

    c = ['// 自动生成，勿手改。', '// Created by Davis', '',
         '#include "font20.h"', '#include <stddef.h>', '',
         'static const uint32_t g_font20_bitmap[FONT20_COUNT][FONT20_PX] = {']
    for rows in glyphs:
        c.append('    {' + ','.join('0x%05X' % r for r in rows) + '},')
    c.append('};')
    c.append('')
    c.append('typedef struct { uint16_t cp; uint16_t idx; uint8_t adv; } font20_entry_t;')
    c.append('')
    c.append('static const font20_entry_t g_font20_table[FONT20_COUNT] = {')
    for cp, idx, adv in table:
        c.append('    {0x%04X, %d, %d},' % (cp, idx, adv))
    c.append('};')
    c.append('')
    c.append('const uint32_t *font20_glyph(uint32_t cp)')
    c.append('{')
    c.append('    int lo = 0, hi = FONT20_COUNT - 1;')
    c.append('    while (lo <= hi) {')
    c.append('        int mid = (lo + hi) >> 1;')
    c.append('        uint32_t v = g_font20_table[mid].cp;')
    c.append('        if (v == cp) return g_font20_bitmap[g_font20_table[mid].idx];')
    c.append('        if (v < cp) lo = mid + 1; else hi = mid - 1;')
    c.append('    }')
    c.append('    return NULL;')
    c.append('}')
    c.append('')
    c.append('int font20_advance(uint32_t cp)')
    c.append('{')
    c.append('    int lo = 0, hi = FONT20_COUNT - 1;')
    c.append('    while (lo <= hi) {')
    c.append('        int mid = (lo + hi) >> 1;')
    c.append('        uint32_t v = g_font20_table[mid].cp;')
    c.append('        if (v == cp) return g_font20_table[mid].adv;')
    c.append('        if (v < cp) lo = mid + 1; else hi = mid - 1;')
    c.append('    }')
    c.append('    return 0;')
    c.append('}')
    c.append('')
    write(os.path.join(OUT, 'font20.c'), '\n'.join(c))

    return len(glyphs)


# ---------------- 音效 ----------------

def export_sfx():
    print('[sfx]')
    adir = os.path.join(WEB, 'assets', 'audio')
    files = sorted(f for f in os.listdir(adir) if f.endswith('.wav'))
    blobs, total = [], 0

    for f in files:
        w = wave.open(os.path.join(adir, f))
        if w.getsampwidth() != 2 or w.getnchannels() != 1:
            raise SystemExit('%s 不是 16bit mono，需要先转换' % f)
        rate = w.getframerate()
        if rate != 22050:
            raise SystemExit('%s 采样率 %d != 22050' % (f, rate))
        data = w.readframes(w.getnframes())
        w.close()
        blobs.append((f[:-4], len(data)))
        total += len(data)

    h = ['// 自动生成，勿手改。22050Hz / 16bit / mono PCM。',
         '// Created by Davis', '',
         '#pragma once', '#include <stdint.h>', '',
         '#define SFX_RATE 22050', '#define SFX_COUNT %d' % len(blobs), '',
         'typedef struct { const char *name; const int16_t *data; uint32_t samples; } sfx_t;',
         'extern const sfx_t g_sfx[SFX_COUNT];', '',
         '// 按名字取音效，未找到返回 -1', 'int sfx_find(const char *name);', '']
    write(os.path.join(OUT, 'sfx.h'), '\n'.join(h))

    c = ['// 自动生成，勿手改。', '// Created by Davis', '',
         '#include "sfx.h"', '#include <string.h>', '']
    for name, _ in blobs:
        w = wave.open(os.path.join(adir, name + '.wav'))
        raw = w.readframes(w.getnframes())
        w.close()
        vals = struct.unpack('<%dh' % (len(raw) // 2), raw)
        c.append('static const int16_t sfx_%s[%d] = {' % (name, len(vals)))
        for i in range(0, len(vals), 16):
            c.append('    ' + ','.join(str(v) for v in vals[i:i + 16]) + ',')
        c.append('};')
        c.append('')

    c.append('const sfx_t g_sfx[SFX_COUNT] = {')
    for name, nbytes in blobs:
        c.append('    {"%s", sfx_%s, %d},' % (name, name, nbytes // 2))
    c.append('};')
    c.append('')
    c.append('int sfx_find(const char *name)')
    c.append('{')
    c.append('    for (int i = 0; i < SFX_COUNT; i++) {')
    c.append('        if (strcmp(g_sfx[i].name, name) == 0) return i;')
    c.append('    }')
    c.append('    return -1;')
    c.append('}')
    c.append('')
    write(os.path.join(OUT, 'sfx.c'), '\n'.join(c))

    return len(blobs), total


# ---------------- 渲染映射表 ----------------

def export_tilemap(atlas, sprite_names):
    """把 sprites.json 的 tileMap 生成 C 查表，供渲染层用。"""
    print('[tilemap]')
    tm = atlas['tileMap']
    idx = {n: i for i, n in enumerate(sprite_names)}
    entries = []
    for ch, name in tm.items():
        if name not in idx:
            print('  ! tileMap 引用了不存在的帧: %s -> %s' % (ch, name))
            continue
        cp = ord(ch)
        entries.append((cp, idx[name]))
    entries.sort()

    h = ['// 自动生成：地图字符 -> 精灵帧号。勿手改。',
         '// Created by Davis', '', '#pragma once', '#include <stdint.h>', '',
         '#include "sprites.h"', '',
         '#define TILEMAP_COUNT %d' % len(entries), '',
         'extern const int16_t g_tilemap_keys[TILEMAP_COUNT];',
         'extern const int16_t g_tilemap_spr[TILEMAP_COUNT];', '',
         '// 字符取精灵帧号，未映射返回 SPR_NONE',
         'int tile_sprite(int chr);',
         '// 出生点等特殊格：字符不变但用 floor 帧',
         'int tile_sprite_or_fallback(int chr);', '']
    write(os.path.join(OUT, 'tilemap.h'), '\n'.join(h))

    c = ['// 自动生成，勿手改。', '// Created by Davis', '',
         '#include "tilemap.h"', '#include "sprites.h"', '',
         'const int16_t g_tilemap_keys[TILEMAP_COUNT] = {']
    c.append('    ' + ','.join(str(cp) for cp, _ in entries) + ',')
    c.append('};')
    c.append('')
    c.append('const int16_t g_tilemap_spr[TILEMAP_COUNT] = {')
    c.append('    ' + ','.join(str(s) for _, s in entries) + ',')
    c.append('};')
    c.append('')
    c.append('int tile_sprite(int chr)')
    c.append('{')
    c.append('    int lo = 0, hi = TILEMAP_COUNT - 1;')
    c.append('    while (lo <= hi) {')
    c.append('        int mid = (lo + hi) >> 1;')
    c.append('        if (g_tilemap_keys[mid] == chr) return g_tilemap_spr[mid];')
    c.append('        if (g_tilemap_keys[mid] < chr) lo = mid + 1; else hi = mid - 1;')
    c.append('    }')
    c.append('    return SPR_NONE;')
    c.append('}')
    c.append('')
    c.append('int tile_sprite_or_fallback(int chr)')
    c.append('{')
    c.append('    int s = tile_sprite(chr);')
    c.append('    return s == SPR_NONE ? SPR_FLOOR : s;')
    c.append('}')
    c.append('')
    write(os.path.join(OUT, 'tilemap.c'), '\n'.join(c))

    return len(entries)


if __name__ == '__main__':
    names, atlas = export_sprites()
    n_glyph = export_font()
    n_glyph20 = export_font20()
    n_sfx, sfx_bytes = export_sfx()
    n_tile = export_tilemap(atlas, names)

    print('')
    print('汇总：')
    print('  精灵   %d 帧  %d KB 像素 + %d KB alpha' % (
        len(names), len(names) * TILE * TILE * 2 // 1024, len(names) * TILE * TILE // 8 // 1024))
    print('  字库   %d 字形  %d KB' % (n_glyph, n_glyph * FONT_STRIDE // 1024))
    print('  小字库 %d 字形  %d KB' % (n_glyph20, n_glyph20 * FONT20_PX * 4 // 1024))
    print('  音效   %d 段  %d KB' % (n_sfx, sfx_bytes // 1024))
    print('  映射   %d 条' % n_tile)
