#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导表脚本：levels/levels.json（唯一编辑源） -> tables.js（运行时配置层）。

沿用项目「配置层优先 + Excel/表 -> Python 导出 JS 数据表」的习惯：
策划改 levels.json（或以后接 Excel 导表），跑本脚本重新生成 tables.js；
运行时页面 / 逻辑层 / 求解器都只 import tables.js，不认识 JSON。

用法：
    python3 tools/build_tables.py              # 生成根 tables.js
    python3 tools/build_tables.py --check      # 只校验「生成结果 == 现有 tables.js」，不写盘
    python3 tools/build_tables.py --stdout     # 打印到标准输出，供 diff / 调试

本脚本只依赖标准库，输出确定（同一份 JSON 永远生成同样的字节），
便于 tools/validate_levels.mjs 做防漂移断言。
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'levels', 'levels.json')
DST = os.path.join(ROOT, 'tables.js')

REQUIRED = ('tileColor', 'tileChar', 'monsters', 'items', 'floors', 'hero0',
            'doorKey', 'doorCost', 'hidden', 'secret', 'floorScale', 'barrier')


def js(value, indent=0):
    """把 Python 值渲染成 JS 字面量；对象 key 一律双引号，输出确定。"""
    pad = '  ' * indent
    pad2 = '  ' * (indent + 1)
    if isinstance(value, dict):
        if not value:
            return '{}'
        items = [pad2 + json.dumps(k, ensure_ascii=False) + ': ' + js(v, indent + 1)
                 for k, v in value.items()]
        return '{\n' + ',\n'.join(items) + '\n' + pad + '}'
    if isinstance(value, list):
        if not value:
            return '[]'
        # 楼层 rows / 短标量数组走紧凑单行，长对象数组逐项展开
        if all(not isinstance(x, (dict, list)) for x in value):
            return '[' + ', '.join(json.dumps(x, ensure_ascii=False) for x in value) + ']'
        items = [pad2 + js(x, indent + 1) for x in value]
        return '[\n' + ',\n'.join(items) + '\n' + pad + ']'
    return json.dumps(value, ensure_ascii=False)


HEADER = """// tables.js —— 由 tools/build_tables.py 从 levels/levels.json 生成，请勿手改。
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
"""

FOOTER = """
// ---- 查表工具（数组线性查找，表很小，不做缓存 —— 与「去 m_xxx 缓存直读配置」一致）----
export function monsterByCh(ch) { return MONSTERS.find(m => m.ch === ch) || null }
export function itemByCh(ch)    { return ITEMS.find(i => i.ch === ch) || null }
export function itemById(id)    { return ITEMS.find(i => i.id === id) || null }
export function hiddenAt(floor, x, y) {
  return HIDDEN.find(h => h.floor === floor && h.x === x && h.y === y) || null
}
export function secretAt(floor, x, y) {
  return SECRET.find(s => s.floor === floor && s.x === x && s.y === y) || null
}
"""

# 导出顺序固定，保证输出确定；注释写明每段含义
SECTIONS = [
    ('TILE_COLOR', 'tileColor', 'tile 字符 -> 色块颜色'),
    ('TILE_CHAR',  'tileChar',  'tile 字符 -> 色块模式下的字形'),
    ('MONSTERS',   'monsters',  '怪物表：id 唯一，勿重复；bombImmune 表示炸弹不可炸'),
    ('ITEMS',      'items',     '道具表：effect 为对 hero 的增量'),
    ('FLOORS',     'floors',    '楼层表：rows 等宽；up/down 为楼梯落点；story 为剧情 key'),
    ('HERO0',      'hero0',     '初始属性'),
    ('DOOR_KEY',   'doorKey',   '门的字符 -> 需要的钥匙（铁门 G 也用黄钥匙）'),
    ('DOOR_COST',  'doorCost',  '门的字符 -> 消耗钥匙数量（普通 1 / 铁门 3）'),
    ('HIDDEN',     'hidden',    '隐藏暗格：坐标 -> 奖励 + 文本框 key'),
    ('SECRET',     'secret',    '暗门：坐标 -> 墙后奖励 + 文本框 key（撞墙显形）'),
    ('FLOOR_SCALE','floorScale','逐层怪物标准数值（hp/atk/def），运行时按层派生实际数值'),
    ('BARRIER',    'barrier',   'v0.16 屏障：卡关层 / 核心层 / 精灵层 / 数值台阶倍率 / 精灵强化幅度'),
]


def build(data):
    missing = [k for k in REQUIRED if k not in data]
    if missing:
        raise ValueError('levels.json 缺少字段: ' + ', '.join(missing))
    parts = [HEADER]
    for export_name, key, note in SECTIONS:
        parts.append('// ---- ' + note + ' ----\n')
        parts.append('export const ' + export_name + ' = ' + js(data[key]) + '\n\n')
    # 视口尺寸来自 meta.viewport（宿主层据此裁剪 + 跟随相机），缺省 7×9 = 手环 10 一屏
    vp = (data.get('meta') or {}).get('viewport') or {}
    viewport = {'cols': vp.get('cols', 7), 'rows': vp.get('rows', 9)}
    parts.append('// ---- 视口：屏幕一次显示的格数，地图比它大时由宿主层做跟随相机 ----\n')
    parts.append('export const VIEWPORT = ' + js(viewport) + '\n\n')
    parts.append(FOOTER)
    return ''.join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只比对，不写盘')
    ap.add_argument('--stdout', action='store_true', help='打印生成结果')
    args = ap.parse_args()

    with open(SRC, 'r', encoding='utf-8') as f:
        data = json.load(f)
    out = build(data)

    if args.stdout:
        sys.stdout.write(out)
        return 0
    if args.check:
        with open(DST, 'r', encoding='utf-8') as f:
            current = f.read()
        if current == out:
            print('OK: tables.js 与 levels.json 一致（无需重新生成）')
            return 0
        print('DRIFT: tables.js 落后于 levels.json，请跑 python3 tools/build_tables.py', file=sys.stderr)
        return 1

    with open(DST, 'w', encoding='utf-8') as f:
        f.write(out)
    print('已生成 tables.js：%d 层 / %d 怪 / %d 道具 / %d 暗格 / %d 暗门 / %d 字节' % (
        len(data['floors']), len(data['monsters']), len(data['items']),
        len(data['hidden']), len(data['secret']), len(out.encode('utf-8'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
