# -*- coding: utf-8 -*-
"""
bundle_logic.py —— 把 mota-lite-web 的 tables.js + logic.js 合成一个单文件 IIFE，
供 ESP32 侧用 QuickJS 以 GLOBAL 模式直接 eval。

为什么不用 esbuild：
  只涉及两个文件、一处 import，正则是够的，不必引入 node 构建链。

产物：main/js/logic_bundle.js
  var MotaLogic = (function () { ...; return { 全部导出 }; })();

Created by Davis
"""

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
WEB = os.path.join(os.path.dirname(PROJ), 'mota-lite-web')
OUT_DIR = os.path.join(PROJ, 'main', 'js')


def read(name):
    p = os.path.join(WEB, name)
    if not os.path.exists(p):
        raise SystemExit('缺少源文件: %s' % p)
    return open(p, encoding='utf-8').read()


def strip_import(src):
    """删除 import { ... } from './tables.js'，允许跨行。"""
    out, n = re.subn(r"import\s*\{[\s\S]*?\}\s*from\s*['\"]\./tables\.js['\"]\s*;?", '', src, count=1)
    if n != 1:
        raise SystemExit("logic.js 里没找到预期的 import 语句，源文件结构可能变了")
    return out


def assert_no_import(src, name):
    if re.search(r"^\s*import\s", src, flags=re.M):
        raise SystemExit('%s 里出现 import，bundle 只支持零依赖数据文件' % name)


def collect_exports(src):
    names = re.findall(r"^export\s+(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)", src, flags=re.M)
    if not names:
        raise SystemExit('没有解析到任何 export，检查源文件格式')
    return names


def strip_export(src):
    return re.sub(r"^export\s+", '', src, flags=re.M)


def main():
    tables_src = read('tables.js')
    logic_src = read('logic.js')
    texts_src = read('texts.js')
    assert_no_import(texts_src, 'texts.js')

    tables_exports = collect_exports(tables_src)
    texts_exports = collect_exports(texts_src)
    logic_src_wo_import = strip_import(logic_src)
    logic_exports = collect_exports(logic_src_wo_import)

    tables_body = strip_export(tables_src)
    texts_body = strip_export(texts_src)
    logic_body = strip_export(logic_src_wo_import)

    # tables/texts 的导出也要暴露给 C 侧（渲染层要读 FLOORS、剧情文案）
    merged = tables_exports + [n for n in texts_exports if n not in tables_exports]
    merged += [n for n in logic_exports if n not in merged]
    ret = ', '.join('%s: %s' % (n, n) for n in merged)

    parts = [
        '// 自动生成，勿手改。来源 mota-lite-web/{tables,texts,logic}.js',
        '// Created by Davis',
        'var MotaLogic = (function () {',
        "'use strict';",
        '',
        '// ===== texts.js（纯数据，零 DOM）=====',
        texts_body,
        '',
        '// ===== tables.js =====',
        tables_body,
        '',
        '// ===== logic.js =====',
        logic_body,
        '',
        '// ===== 移植适配层（不改动上游逻辑，仅转换调用形态）=====',
        '// logic.js 的 DIR 以字符串为 key，C 侧传 0..3 更自然',
        'var DIR_BY_INDEX = ["up", "right", "down", "left"];',
        'function stepByIndex(s, d) {',
        '  var name = DIR_BY_INDEX[d];',
        '  if (!name) return { state: s, events: [] };',
        '  return resolveStep(s, name);',
        '}',
        '// 只取当前层地图字符，渲染层不需要 buildCells 里的颜色字符串',
        'function floorRows(s) {',
        '  var rows = [];',
        '  for (var y = 0; y < FLOORS[s.floor].rows.length; y++) {',
        '    var row = FLOORS[s.floor].rows[y], out = [];',
        '    for (var x = 0; x < row.length; x++) out.push(tileAt(s, x, y));',
        '    rows.push(out.join(""));',
        '  }',
        '  return rows;',
        '}',
        '// 整层压成一个字符串（行间 \\n），C 侧一次 JS_ToCString 就拿到，避免 195 次跨语言调用',
        'function floorString(s) { return floorRows(s).join("\\n"); }',
        '',
        'return { %s, stepByIndex: stepByIndex, floorRows: floorRows, floorString: floorString };' % ret,
        '})();',
        '',
    ]
    bundle = '\n'.join(parts)

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, 'logic_bundle.js')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(bundle)

    print('tables 导出 %d 个: %s' % (len(tables_exports), ', '.join(tables_exports)))
    print('logic  导出 %d 个: %s' % (len(logic_exports), ', '.join(logic_exports)))
    print('合并后暴露 %d 个符号' % len(merged))
    print('输出 %s  %d bytes' % (out, len(bundle.encode('utf-8'))))


if __name__ == '__main__':
    main()
