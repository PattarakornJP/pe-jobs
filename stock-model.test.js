const assert = require('assert');
const fs = require('fs');
const path = require('path');
const M = require('./stock-model');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/nonstock.json'), 'utf8'));

// หมวดตามชีต
assert.deepStrictEqual(data.categories.map(c => c.name), ['งานติดตั้งระบบน้ำร้อน-น้ำเย็น', 'ฉนวน', 'งานไฟฟ้า', 'อุปกรณ์เบ็ดเตล็ดและอื่นๆ', 'ท่อดักท์']);
assert.strictEqual(data.items.length, 343);  // ไฟล์ 23 พ.ย. รวมรายการซ้ำสามทาง PPR DN32
assert.ok(!data.items.some(i => i.id === 'hw-169'));
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
assert.strictEqual(byId['el-039'].remain, 7);
assert.strictEqual(byId['hw-174'].remain, 2);           // สามทาง PPR DN32 รับ 5 เบิก 3
assert.strictEqual(byId['hw-223'].remain, 7);           // ท่อ PPR DN32 เต็มเส้น เบิก 5

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
assert.strictEqual(all.length, 344);
assert.strictEqual(all.find(r => r.item.id === 'new-1').remain, 3);
assert.strictEqual(M.thaiDate('2026-11-21'), '21/11/2569');
assert.strictEqual(M.status(1, 10), 'low');
assert.strictEqual(M.status(-1, 10), 'over');
console.log('stock-model ok');

// ---- แอดมิน: แก้/เพิ่ม/ลบรายการ และหมวด ----
let st = M.applyAll({ moves: data.seedMoves, items: [], cats: [] }, [
  { kind: 'cat', op: 'upsert', row: { id: 'c-pipe', name: 'ท่อเหล็ก' } },
  { kind: 'cat', op: 'upsert', row: { id: 'ins', name: 'ฉนวนยาง' } },
  { kind: 'item', op: 'upsert', row: { id: 'u-1', cat: 'c-pipe', name: 'ท่อเหล็กดำ 1"', unit: 'เส้น', qtyIn: 10, img: 'sheet:i1' } },
  { kind: 'item', op: 'upsert', row: Object.assign({}, data.items.find(i => i.id === 'hw-006'), { name: 'Thermowell แก้ชื่อ', qtyIn: 3 }) },
  { kind: 'item', op: 'upsert', row: Object.assign({}, data.items.find(i => i.id === 'hw-007'), { deleted: 1 }) },
  { op: 'upsert', row: { id: 'w9', itemId: 'u-1', type: 'out', date: '2026-11-21', qty: 4 } },
  { kind: 'img', op: 'upsert', row: { id: 'i1', data: 'data:image/jpeg;base64,AAAA' } }
]);
let mm = M.mergeMaster(data, st.items, st.cats);
assert.strictEqual(mm.categories.length, 6);
assert.strictEqual(mm.categories.find(c => c.id === 'ins').name, 'ฉนวนยาง');
assert.strictEqual(mm.items.length, 343);                 // +1 ใหม่ −1 ลบ
assert.ok(!mm.items.find(i => i.id === 'hw-007'));
let bb = Object.fromEntries(M.balances(mm.items, st.moves).map(r => [r.item.id, r]));
assert.strictEqual(bb['u-1'].remain, 6);
assert.strictEqual(bb['hw-006'].item.name, 'Thermowell แก้ชื่อ');
assert.strictEqual(bb['hw-006'].remain, 3);
assert.strictEqual(bb['u-1'].item.img, 'sheet:i1');
// ลบหมวด: รายการที่ค้างย้ายไปหมวดแรก
st = M.applyAll(st, [{ kind: 'cat', op: 'upsert', row: { id: 'c-pipe', name: 'ท่อเหล็ก', deleted: 1 } }]);
mm = M.mergeMaster(data, st.items, st.cats);
assert.strictEqual(mm.categories.length, 5);
assert.strictEqual(mm.items.find(i => i.id === 'u-1').cat, 'hw');
console.log('stock-model admin ok');
