// smoke_test.js —— 在 Node 里验证打包后的 logic_bundle 可用（无 DOM、无浏览器 API）。
// 这一步过了，QuickJS 侧才有意义。
// 用法：node tools/smoke_test.js
// Created by Davis

const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, '..', 'main', 'js', 'logic_bundle.js');
eval(fs.readFileSync(bundlePath, 'utf8'));

const L = MotaLogic;
let pass = 0, fail = 0;

function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok   ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
}

console.log('== 结构 ==');
ok(L.FLOORS.length === 21, '21 层，实际 ' + L.FLOORS.length);
ok(L.FLOORS[0].rows.length === 15, '15 行，实际 ' + L.FLOORS[0].rows.length);
ok(L.FLOORS[0].rows[0].length === 13, '13 列，实际 ' + L.FLOORS[0].rows[0].length);

console.log('== newGame ==');
const s = L.newGame();
ok(s.floor === 0, 'floor = ' + s.floor);
ok(s.hero.hp === 200 && s.hero.atk === 10, 'hero hp/atk = ' + s.hero.hp + '/' + s.hero.atk);
ok(typeof s.x === 'number' && typeof s.y === 'number', '出生点 (' + s.x + ',' + s.y + ')');
ok(L.tileAt(s, s.x, s.y) === '@', '英雄脚下是出生点 @');

console.log('== 四方向 resolveStep ==');
for (let d = 0; d < 4; d++) {
  const r = L.stepByIndex(s, d);
  const ev = r.events.map(e => e.t + (e.text ? ':' + e.text : '')).join('|') || '(无事件)';
  console.log('  dir ' + d + ' -> (' + r.state.x + ',' + r.state.y + ')  ' + ev);
}
ok(L.stepByIndex(s, 99).state.x === s.x, '非法方向不移动');

console.log('== 地图遍历 ==');
let tiles = 0, walls = 0;
const rows = L.floorRows(s);
for (const row of rows) {
  for (const ch of row) { tiles++; if (ch === '#') walls++; }
}
ok(tiles === 195, '1F 共 195 格，实际 ' + tiles);
ok(walls > 40, '墙体 ' + walls + ' 格');

console.log('== 战斗计算 ==');
const mon = L.MONSTERS[0];
const b = L.calcBattle(s.hero, mon, 0);
console.log('  对 ' + (mon.name || mon.ch) + ': ' + JSON.stringify(b).slice(0, 120));
ok(b && typeof b === 'object', 'calcBattle 返回对象');

console.log('== 存档往返 ==');
const saved = L.serialize(s);
ok(typeof saved === 'string' && saved.length > 10, '序列化 ' + saved.length + ' 字节');
const s2 = L.deserialize(saved);
ok(s2.hero.hp === s.hero.hp && s2.x === s.x && s2.y === s.y, '反序列化一致');
console.log('  存档: ' + saved.slice(0, 100));

console.log('');
console.log(pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
