# -*- coding: utf-8 -*-
"""
preview_font.py —— 用与 export_assets.py 完全相同的渲染参数，把点阵打印成 ASCII art。
用途：改字体前先看效果，避免直接烧录后才发现字糊了。

用法：python tools/preview_font.py 魔塔第层
Created by Davis
"""

import sys

from PIL import Image, ImageDraw, ImageFont

FONT_PX = 16
FONT_PATH = 'C:/Windows/Fonts/simhei.ttf'
THRESHOLD = 110


def render(ch):
    font = ImageFont.truetype(FONT_PATH, FONT_PX)
    canvas = Image.new('L', (FONT_PX, FONT_PX), 0)
    ImageDraw.Draw(canvas).text((0, 0), ch, fill=255, font=font)
    px = canvas.load()
    rows = []
    for y in range(FONT_PX):
        bits = 0
        for x in range(FONT_PX):
            if px[x, y] > THRESHOLD:
                bits |= (0x8000 >> x)
        rows.append(bits)
    return rows


def show(ch):
    rows = render(ch)
    print('--- %s (U+%04X) ---' % (ch, ord(ch)))
    for r in rows:
        line = ''.join('##' if (r & (0x8000 >> x)) else '..' for x in range(FONT_PX))
        print('  ' + line)
    print('')


if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else '魔塔'
    for c in arg:
        show(c)
