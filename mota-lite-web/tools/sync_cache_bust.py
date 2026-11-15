#!/usr/bin/env python3
# 从 version.js 的 VERSION 派生静态资源 cache-bust 参数，批量同步 index.html 里所有 ?r=。
# 用法：python3 tools/sync_cache_bust.py            # 写入
#       python3 tools/sync_cache_bust.py --check   # 只校验（供 validate_version / CI 使用）
# 约定：参数 = VERSION 去掉前缀 v（如 v0.20.2 -> 0.20.2）；每次递增版本必变，浏览器无法命中旧缓存。
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / 'version.js').read_text(encoding='utf-8')
m = re.search(r"export const VERSION = 'v([0-9]+\.[0-9]+\.[0-9]+)'", src)
if not m:
    sys.exit('FAIL: 无法从 version.js 读取 VERSION')
key = m.group(1)
html_path = ROOT / 'index.html'
html = html_path.read_text(encoding='utf-8')
keys = re.findall(r'\?r=([0-9.]+)', html)
if '--check' in sys.argv:
    ok = len(keys) >= 8 and all(k == key for k in keys)
    print(('OK' if ok else 'FAIL') + ': cache-bust key=' + key + '，index.html 共 ' + str(len(keys)) + ' 处')
    sys.exit(0 if ok else 1)
new, n = re.subn(r'\?r=[0-9.]+', '?r=' + key, html)
html_path.write_text(new, encoding='utf-8')
print('已同步 ' + str(n) + ' 处 ?r=' + key)
