# -*- coding: utf-8 -*-
"""
check_sync.py —— 改完 web 版后跑一遍，检查 ESP32 侧哪些地方会"静默出错"。

检查四件事（都不需要编译）：
  1. logic/tables/texts 打包快照是否落后上游（等价于 bundle_logic.py --check）
  2. C 里硬编码的 FLAG_* 位值是否与 logic.js 的 FLAG 一致
  3. C 里 queue_story() 用到的 key 是否都存在于 texts.js
  4. 全塔地图字符是否都有 tileMap 映射、24px 字库是否覆盖文案里的汉字

用法：
    python tools/check_sync.py

退出码 0 = 全部通过；1 = 有问题（会逐条列出）。
Created by Davis
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WEB = os.path.join(os.path.dirname(PROJ), 'mota-lite-web')
MAIN = os.path.join(PROJ, 'main')

problems = []


def note(tag, msg):
    problems.append('[%s] %s' % (tag, msg))


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def check_bundle():
    """打包快照是否与上游一致。复用 bundle_logic 的生成逻辑，不落盘。"""
    sys.path.insert(0, HERE)
    import bundle_logic
    bundle, _, _, _ = bundle_logic.build_bundle()
    out = os.path.join(PROJ, 'main', 'js', 'logic_bundle.js')
    old = read(out) if os.path.exists(out) else ''
    if old != bundle:
        note('bundle', 'logic_bundle.js 落后于上游，请重跑 python tools/bundle_logic.py')
    else:
        print('  ✓ 打包快照与上游一致 (%d 字节)' % len(bundle.encode('utf-8')))


def check_flags():
    """C 里的 FLAG 位值是抄的常量，web 一旦插入新位就会错位。"""
    logic = read(os.path.join(WEB, 'logic.js'))
    block = re.search(r'export const FLAG = \{([\s\S]*?)\}', logic)
    if not block:
        note('flag', 'logic.js 里找不到 FLAG 定义')
        return
    flags = {k: int(v) for k, v in re.findall(r'(\w+):\s*(\d+)', block.group(1))}

    c = read(os.path.join(MAIN, 'game.c'))
    cdefs = {k: int(v) for k, v in re.findall(r'#define\s+FLAG_(\w+)\s+(\d+)', c)}
    if not cdefs:
        note('flag', 'game.c 里找不到 FLAG_ 宏')
        return

    bad = 0
    for name, val in sorted(cdefs.items()):
        want = flags.get(name)
        if want is None:
            note('flag', 'game.c 的 FLAG_%s 在 logic.js 里已不存在' % name)
            bad += 1
        elif want != val:
            note('flag', 'FLAG_%s: C=%d, logic.js=%d' % (name, val, want))
            bad += 1
    if not bad:
        print('  ✓ %d 个 FLAG 位值与 logic.js 一致' % len(cdefs))


def check_story_keys():
    """C 侧硬编码 17 个剧情 key，web 改名会让弹层空白。"""
    c = read(os.path.join(MAIN, 'game.c'))
    keys = sorted(set(re.findall(r'queue_story\("([A-Za-z_0-9]+)"\)', c)))
    texts = read(os.path.join(WEB, 'texts.js'))
    missing = [k for k in keys if not re.search(r'\b%s\s*:\s*\{' % re.escape(k), texts)]
    for k in missing:
        note('story', 'queue_story("%s") 在 texts.js 里没有对应条目' % k)
    if not missing:
        print('  ✓ %d 个剧情 key 都能在 texts.js 找到' % len(keys))


def check_tilemap():
    """地图里出现的每个字符都要有精灵映射，否则渲染成空帧。"""
    tables = read(os.path.join(WEB, 'tables.js'))
    tm = json.loads(read(os.path.join(WEB, 'assets', 'sprites.json')))['tileMap']

    chars = set()
    for block in re.findall(r'"rows":\s*\[([\s\S]*?)\]', tables):
        for row in re.findall(r'"([^"]{10,})"', block):
            chars |= set(row)

    missing = sorted(ch for ch in chars if ch not in tm and ch not in ' .')
    for ch in missing:
        note('tilemap', '字符 %r 没有 tileMap 映射（会渲染成空帧）' % ch)
    if not missing:
        print('  ✓ 地图 %d 种字符都有精灵映射' % len(chars))


def check_font():
    """文案里的汉字必须在 24px 字库里，否则显示为空白。"""
    font = read(os.path.join(MAIN, 'assets', 'font24.c'))
    have = {int(h, 16) for h in re.findall(r'\{\s*0x([0-9A-Fa-f]{4})\s*,', font)}

    need = set()
    for name in ('texts.js', 'tables.js'):
        for ch in read(os.path.join(WEB, name)):
            if ord(ch) >= 0x80:
                need.add(ch)
    missing = sorted(ch for ch in need if ord(ch) not in have)
    for ch in missing[:20]:
        note('font', '字库缺字 %r (U+%04X)' % (ch, ord(ch)))
    if len(missing) > 20:
        note('font', '还有 %d 个缺字未列出' % (len(missing) - 20))
    if not missing:
        print('  ✓ 字库覆盖文案里的 %d 个非 ASCII 字符' % len(need))


def main():
    print('检查 ESP32 版与 web 版的一致性 ...')
    check_bundle()
    check_flags()
    check_story_keys()
    check_tilemap()
    check_font()

    print('')
    if problems:
        print('发现 %d 个问题：' % len(problems))
        for p in problems:
            print('  ✗ ' + p)
        return 1
    print('全部通过 ✓')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
