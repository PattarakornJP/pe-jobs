const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('./stock-model');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/nonstock.json'), 'utf8'));

// หมวดตามชีต
assert.deepStrictEqual(data.categories.map(c => c.name), ['งานติดตั้งระบบน้ำร้อน-น้ำเย็น', 'ฉนวน', 'งานไฟฟ้า', 'อุปกรณ์เบ็ดเตล็ดและอื่นๆ', 'ท่อดักท์']);
assert.strictEqual(data.items.length, 344);
data.categories.forEach(c => assert.strictEqual(data.items.filter(i => i.cat === c.id).length, c.count));
const ids = new Set(data.items.map(i => i.id));
assert.strictEqual(ids.size, data.items.length, 'item ids unique');

// ยอดคงเหลือตรงกับไฟล์
const rows = M.balances(data.items, data.seedMoves.map(M.normalizeMove));
rows.forEach(r => {
  assert.strictEqual(r.used, r.item.fileUsed, 'used ' + r.item.id);
  assert.strictEqual(r.remain, r.item.fileRemain, 'remain ' + r.item.id);
});
const byId = Object.fromEntries(rows.map(r => [r.item.id, r]));
assert.strictEqual(byId['ins-008'].remain, 25);         // ฉนวน 1-3/8" รับ 37 เบิก 12
assert.strictEqual(byId['el-037'].remain, 0);           // คอนเน็คเตอร์ 3/4" เบิกหมด
assert.strictEqual(byId['misc-054'].used, 150);         // สกรู No.7 เบิก 10, 20, 21 พ.ย.
assert.strictEqual(byId['el-039'].remain, 7);           // ไฟล์โชว์ 2 เพราะสูตรอ้างผิดแถว

// เบิก คืน รับเพิ่ม ลบ แก้
let moves = data.seedMoves.map(M.normalizeMove);
moves = M.applyOps(moves, [{ op: 'upsert', row: { id: 'w1', itemId: 'hw-006', type: 'out', date: '21/11/2569', qty: '1' } }]);
assert.strictEqual(moves.find(m => m.id === 'w1').date, '2026-11-21');
let b = Object.fromEntries(M.balances(data.items, moves).map(r => [r.item.id, r]));
assert.strictEqual(b['hw-006'].remain, 0);
assert.strictEqual(b['hw-006'].status, 'zero');
moves = M.applyOps(moves, [{ op: 'upsert', row: { id: 'w2', itemId: 'hw-006', type: 'ret', date: '2026-11-22', qty: 1 } }, { op: 'upsert', row: { id: 'w3', itemId: 'hw-006', type: 'in', date: '2026-11-22', qty: 4 } }]);
b = Object.fromEntries(M.balances(data.items, moves).map(r => [r.item.id, r]));
assert.strictEqual(b['hw-006'].total, 5);
assert.strictEqual(b['hw-006'].remain, 5);
moves = M.applyOps(moves, [{ op: 'delete', id: 'w1' }, { op: 'upsert', row: { id: 'w3', itemId: 'hw-006', type: 'in', date: '2026-11-22', qty: 2 } }]);
b = Object.fromEntries(M.balances(data.items, moves).map(r => [r.item.id, r]));
assert.strictEqual(b['hw-006'].remain, 4);
// รายการใหม่
moves = M.applyOps(moves, [{ op: 'upsert', row: { id: 'n1', itemId: 'new-1', type: 'item', cat: 'el', name: 'สายไฟ VCT 2x2.5', unit: 'ม้วน', qty: 3, date: '2026-11-21' } }]);
const all = M.balances(data.items, moves);
assert.strictEqual(all.length, 345);
assert.strictEqual(all.find(r => r.item.id === 'new-1').remain, 3);
assert.strictEqual(M.thaiDate('2026-11-21'), '21/11/2569');
assert.strictEqual(M.status(1, 10), 'low');
assert.strictEqual(M.status(-1, 10), 'over');
console.log('stock-model ok');
