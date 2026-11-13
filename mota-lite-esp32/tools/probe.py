# probe.py —— 一次连接内执行多条命令并抓图：
#   python tools/probe.py tap:240,390 sleep:400 cap:/c/tmp/a.png ...
import base64, sys, time
import serial
from PIL import Image

PORT = 'COM4'
s = serial.Serial(PORT, 115200, timeout=0.2)
s.dtr = False; s.rts = False

buf = b''
t0 = time.time()
while time.time() - t0 < 12:
    buf += s.read(4096)
    if '诊断命令就绪'.encode() in buf:
        break

def drain(seconds=0.4):
    t = time.time()
    while time.time() - t < seconds:
        s.read(8192)

def capture(path):
    s.write(b'cap\n'); s.flush()
    lines = []
    started = ended = False
    local = b''
    t0 = time.time()
    while time.time() - t0 < 25:
        chunk = s.read(8192)
        if chunk:
            local += chunk
        while b'\n' in local:
            raw, local = local.split(b'\n', 1)
            line = raw.decode('utf-8', 'replace').strip()
            if line.startswith('CAP BEGIN'):
                started = True
            elif line == 'CAP END':
                ended = True
            elif started and line.startswith('C '):
                lines.append(line[2:])
        if ended:
            break
    raw = base64.b64decode(''.join(lines))
    if len(raw) != 480 * 480 * 2:
        print('cap failed', len(raw)); return
    im = Image.new('RGB', (480, 480))
    px = []
    for i in range(0, len(raw), 2):
        v = raw[i] | (raw[i + 1] << 8)
        real = ((v >> 8) | (v << 8)) & 0xFFFF
        px.append((((real >> 11) & 31) * 255 // 31,
                   ((real >> 5) & 63) * 255 // 63,
                   (real & 31) * 255 // 31))
    im.putdata(px)
    im.save(path)
    print('saved', path)

for cmd in sys.argv[1:]:
    if cmd.startswith('tap:'):
        x, y = cmd[4:].split(',')
        s.write(('tap %s %s\n' % (x, y)).encode()); s.flush()
        drain(0.45)
    elif cmd.startswith('tapq:'):
        x, y = cmd[4:].split(',')
        s.write(('tap %s %s\n' % (x, y)).encode()); s.flush()
        drain(0.10)
    elif cmd.startswith('sleep:'):
        drain(int(cmd[6:]) / 1000.0)
    elif cmd.startswith('cap:'):
        capture(cmd[4:])
    elif cmd.startswith('load:'):
        s.write(('load ' + cmd[5:] + '\n').encode()); s.flush(); drain(0.4)
    elif cmd.startswith('waitlog:'):
        needle = cmd[8:].encode()
        t0 = time.time(); acc = b''
        while time.time() - t0 < 8:
            acc += s.read(4096)
            if needle in acc:
                print('log seen:', cmd[8:])
                break
        else:
            print('log timeout:', cmd[8:])
    elif cmd == 'newgame':
        s.write(b'newgame\n'); s.flush(); drain(0.5)
    elif cmd == 'state':
        s.write(b'state\n'); s.flush()
        t0=time.time(); st=b''
        while time.time()-t0 < 0.6:
            st += s.read(4096)
        for line in st.decode('utf-8','replace').split('\n'):
            if 'STATE' in line:
                print(line.strip())
s.close()
