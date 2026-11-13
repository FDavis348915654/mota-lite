# cap.py —— 通过 USB 串口抓一帧并转 PNG（配合 diag.c 的 cap 命令）
# 用法: python tools/cap.py out.png
import base64, sys, time
import serial
from PIL import Image

PORT = 'COM4'
out = sys.argv[1] if len(sys.argv) > 1 else 'cap.png'

s = serial.Serial(PORT, 115200, timeout=0.2)
s.dtr = False; s.rts = False

# 打开串口会让板子复位，等诊断命令就绪
t0 = time.time()
buf = b''
while time.time() - t0 < 12:
    buf += s.read(4096)
    if '诊断命令就绪'.encode() in buf:
        break
buf = b''
s.write(b'cap\n'); s.flush()

lines = []
started = ended = False
t0 = time.time()
while time.time() - t0 < 25:
    chunk = s.read(8192)
    if chunk:
        buf += chunk
    while b'\n' in buf:
        raw, buf = buf.split(b'\n', 1)
        line = raw.decode('utf-8', 'replace').strip()
        if line.startswith('CAP BEGIN'):
            started = True
        elif line == 'CAP END':
            ended = True
        elif started and line.startswith('C '):
            lines.append(line[2:])
    if ended:
        break
s.close()

b64 = ''.join(lines)
print('lines', len(lines), 'chars', len(b64), 'ended', ended)
raw = base64.b64decode(b64)
print('bytes', len(raw))
if len(raw) != 480 * 480 * 2:
    print('size mismatch, got', len(raw)); sys.exit(1)

im = Image.new('RGB', (480, 480))
px = []
for i in range(0, len(raw), 2):
    v = raw[i] | (raw[i + 1] << 8)
    real = ((v >> 8) | (v << 8)) & 0xFFFF
    r = (real >> 11) & 31
    g = (real >> 5) & 63
    b = real & 31
    px.append((r * 255 // 31, g * 255 // 63, b * 255 // 31))
im.putdata(px)
im.save(out)
print('saved', out)
