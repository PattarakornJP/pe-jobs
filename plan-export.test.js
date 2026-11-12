const assert = require('assert');
const exp = require('./plan-export');

assert.strictEqual(exp.clampDayWidth(1), exp.MIN_DW);
assert.strictEqual(exp.clampDayWidth(200), exp.MAX_DW);
assert.strictEqual(exp.clampDayWidth(16), 16);
assert.strictEqual(exp.presetWidth('week'), 34);
assert.strictEqual(exp.presetWidth('month'), 16);
assert.strictEqual(exp.presetName(34), 'week');
assert.strictEqual(exp.presetName(16), 'month');
assert.strictEqual(exp.presetName(20), '');

{
  const index = exp.centerIndex(400, 1000, 220, 16);
  const back = exp.scrollLeftForCenter(index, 1000, 220, 32);
  const again = exp.centerIndex(back, 1000, 220, 32);
  assert.ok(Math.abs(again - index) < 0.01, 'zoom keeps the same center date');
}

assert.strictEqual(exp.dow('2026-11-12'), 4);
assert.deepStrictEqual(exp.monthsOf(['2026-11-30', '2026-12-01']).map(m => m.label), ['พ.ย. 2569', 'ธ.ค. 2569']);
assert.strictEqual(exp.barHex('cm', false), 'D03B3B');
assert.strictEqual(exp.barHex('project', true), 'A9C7EF');

{
  const matrix = exp.tableMatrix([
    { groupLabel: 'งานติดตั้ง', idText: 4, name: 'The Exporar samui', so: 'SO2610-005', days: 4, startText: '05/11/2569', finishText: '09/11/2569', person: 'เอ', status: 'พร้อมเข้างาน' },
    { groupLabel: 'CM (ซ่อม)', idText: 431, name: 'ซ่อมรั่ว Patong beach', days: 2, startText: '30/10/2569', finishText: '31/10/2569', person: '', status: 'รอเข้างาน' }
  ]);
  assert.deepStrictEqual(matrix.head, ['รหัส', 'ชื่องาน', 'ระยะเวลา (วัน)', 'วันเริ่ม', 'วันจบ', 'ผู้รับผิดชอบ', 'สถานะ']);
  assert.strictEqual(matrix.body[0].group, 'งานติดตั้ง');
  assert.strictEqual(matrix.body[1][1], 'The Exporar samui\nSO2610-005');
  assert.strictEqual(matrix.body[2].group, 'CM (ซ่อม)');
}

{
  const plan = exp.pagePlan({
    days: Array.from({ length: 80 }, (_, i) => '2026-11-' + String((i % 28) + 1).padStart(2, '0')),
    bars: Array.from({ length: 80 }, () => ({ name: 'งานติดตั้งยาว' }))
  });
  assert.strictEqual(plan.format, 'a3');
  assert.ok(plan.chunks.length >= 1);
  assert.ok(plan.rowChunks.length > 1, 'long plans use more than one page');
  assert.ok(plan.dayMm >= 3.2);
}

{
  const short = exp.pagePlan({ days: ['2026-11-12', '2026-11-13'], bars: [{ name: 'สั้น' }] });
  assert.strictEqual(short.format, 'a4');
  assert.strictEqual(short.chunks.length, 1);
}

console.log('plan-export tests passed');
