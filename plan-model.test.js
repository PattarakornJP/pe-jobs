const assert = require('assert');
const fs = require('fs');
const path = require('path');
const model = require('./plan-model');
const seed = require('./plan-seed');
const built = require('./seed/build-plan');

assert.deepStrictEqual(seed, built, 'plan-seed.js matches seed/build-plan.js');
assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(__dirname, 'seed/plan.json'), 'utf8')), built);

assert.strictEqual(model.parseDate('พ 12/11/69'), '2026-11-12');
assert.strictEqual(model.parseDate('อ 3/11/69'), '2026-11-03');
assert.strictEqual(model.parseDate('ส 9/1/70'), '2027-01-09');
assert.strictEqual(model.parseDate('พฤ 1/11/69'), '2026-11-01');
assert.strictEqual(model.parseDate('12/11/2569'), '2026-11-12');
assert.strictEqual(model.parseDate('2026-11-12'), '2026-11-12');
assert.strictEqual(model.parseDate(''), '');
assert.strictEqual(model.parseDate('ไม่ใช่วันที่'), '');
assert.strictEqual(model.parseDate('31/02/2569'), '');
assert.strictEqual(model.formatDate('2026-11-12'), '12/11/2569');
assert.strictEqual(model.inclusiveDays('2026-11-05', '2026-11-07'), 3);
assert.strictEqual(model.inclusiveDays('2026-11-16', '2026-11-16'), 1);
assert.strictEqual(model.inclusiveDays('2026-11-10', '2026-11-09'), 0);
assert.strictEqual(model.addDays('2026-11-30', 2), '2026-12-02');

assert.strictEqual(seed.length, 74);
var groups = { install: 0, handover: 0, cm: 0, pm: 0 };
var ids = {};
seed.forEach(function (item) {
  assert.ok(item.name, 'name ' + item.pdfId);
  assert.ok(groups[item.group] != null, 'group ' + item.pdfId);
  groups[item.group]++;
  assert.ok(!ids[item.pdfId], 'duplicate ' + item.pdfId);
  ids[item.pdfId] = 1;
  assert.strictEqual(model.parseDate(item.start), item.start);
  assert.strictEqual(model.parseDate(item.finish), item.finish);
  assert.ok(item.finish >= item.start, 'order ' + item.pdfId);
});
assert.deepStrictEqual(groups, { install: 36, handover: 9, cm: 8, pm: 21 });
[2, 12, 19, 37, 420, 428, 431, 438, 662, 664, 676, 684, 698].forEach(function (id) {
  assert.ok(ids[id], 'missing pdf ' + id);
});
[1, 38, 430, 661, 699].forEach(function (id) {
  assert.ok(!ids[id], 'summary should stay out ' + id);
});
['885', '881', '883', '882', '886', '888', '889', '887'].forEach(function (n) {
  assert.ok(seed.some(function (item) { return item.name.indexOf(n) >= 0; }), n);
});

var jobs = [
  { id: 178, so: 'SO2610-045', proj: 'The Nature ตึก9', eng: 'วรวิทย์ เกษร์แก้ว', st: 'รอมัดจำ', planStart: '', planEnd: '', planSet: '' },
  { id: 174, so: 'SO2610-005', proj: 'The Explorar Samui', eng: 'ยังไม่ระบุ', st: 'พร้อมเข้างาน', planStart: '', planEnd: '' },
  { id: -1, so: '__ผู้รับผิดชอบ__', src: '__roster__', planStart: '2026-11-01', planEnd: '2026-11-02', proj: 'roster' }
];
var services = [
  { id: 28, so: 'SO2610-052', customer: 'Patong Beach Hotel', type: 'งานซ่อม', team: 'พี่ตี๋', planStart: '', planEnd: '' }
];
var entries = model.buildEntries(seed, jobs, services);
var nature = entries.filter(function (e) { return e.pdfId === 3 || e.so === 'SO2610-045'; });
assert.strictEqual(nature.length, 1, 'linked job is one bar');
assert.strictEqual(nature[0].start, '2026-11-05');
assert.strictEqual(nature[0].jobId, 178);
assert.strictEqual(nature[0].person, 'วรวิทย์ เกษร์แก้ว');
assert.strictEqual(nature[0].status, 'รอมัดจำ');
assert.ok(!entries.some(function (e) { return e.name === 'roster'; }));

jobs[0].planStart = '2026-11-06';
jobs[0].planEnd = '2026-11-08';
var edited = model.buildEntries(seed, jobs, services).find(function (e) { return e.pdfId === 3; });
assert.strictEqual(edited.start, '2026-11-06');
assert.strictEqual(edited.finish, '2026-11-08');
assert.strictEqual(edited.days, 3);
jobs[0].planStart = '';
jobs[0].planEnd = '';
jobs[0].planSet = '1';
var cleared = model.buildEntries(seed, jobs, services).find(function (e) { return e.pdfId === 3; });
assert.strictEqual(cleared.start, '');
assert.strictEqual(cleared.finish, '');
jobs[0].planSet = '';
jobs[0].planStart = '';
jobs[0].planEnd = '';

var patong = model.buildEntries(seed, jobs, services).find(function (e) { return e.pdfId === 431; });
assert.strictEqual(patong.serviceId, 28);
assert.strictEqual(patong.color, 'cm');
assert.strictEqual(patong.person, 'พี่ตี๋');

var zoneChild = seed.find(function (item) { return item.pdfId === 12; });
assert.strictEqual(zoneChild.so, '');
assert.strictEqual(model.findLinked(zoneChild, jobs, services), null);
var sai = seed.find(function (item) { return item.pdfId === 427; });
var saiJob = model.findBySo([{ id: 49, so: 'SO2603-117 ค่าติดตั้ง' }, { id: 48, so: 'SO2603-116 สินค้า' }], sai.so);
assert.ok(saiJob);
assert.strictEqual(saiJob.id, 49);
assert.strictEqual(model.findBySo([{ id: 1, so: 'SO2608-111' }, { id: 2, so: 'SO2608-118' }], 'SO2608-11'), null);

jobs.push({ id: 999, so: 'SO-NEW', proj: 'งานทดลอง', eng: 'บี', st: 'พร้อมเข้างาน', planStart: '2026-11-01', planEnd: '2026-11-02' });
var extra = model.buildEntries(seed, jobs, services).find(function (e) { return e.jobId === 999 && e.source === 'job'; });
assert.ok(extra);
assert.strictEqual(extra.group, 'install');

var nov = model.filterEntries(model.buildEntries(seed, [], []), { from: '2026-11-01', to: '2026-11-30' });
assert.ok(nov.length >= 20, 'November 2026 has the seeded window, got ' + nov.length);
assert.ok(nov.some(function (e) { return e.pdfId === 5; }));
assert.ok(!nov.some(function (e) { return e.pdfId === 424; }));

var people = model.filterEntries(entries, { person: 'วรวิทย์ เกษร์แก้ว', group: 'install' });
assert.ok(people.some(function (e) { return e.pdfId === 3; }));
assert.ok(!people.some(function (e) { return e.pdfId === 431; }));

assert.strictEqual(model.responseKind({ ok: true, rows: [{ comp: 'x', st: 'y' }] }), 'old');
assert.strictEqual(model.responseKind({ ok: true, table: 'plan', rows: [] }), 'live');
assert.strictEqual(model.responseKind({ ok: true, table: 'plan', rows: [{ comp: 'x' }] }), 'old');
assert.strictEqual(model.responseKind({ ok: false }), 'bad');
assert.strictEqual(model.sheetHasPlanFields({ fields: ['id', 'planStart', 'planEnd'] }), true);
assert.strictEqual(model.sheetHasPlanFields({ rows: [] }), false);

var gs = fs.readFileSync(path.join(__dirname, 'apps-script/Code.gs'), 'utf8');
assert.ok(gs.indexOf("t === 'plan'") >= 0, 'Apps Script routes table=plan');
assert.ok(gs.indexOf("'planStart', 'planEnd', 'planSet'") >= 0);
assert.strictEqual(gs.split("'planStart', 'planEnd', 'planSet'").length - 1, 2, 'jobs and service headers');
assert.ok(gs.indexOf('function postPlan_') >= 0);
assert.ok(gs.indexOf('payloadNotPlan_') >= 0);

var span = model.spanOf(nov, '2026-11-12', 0);
assert.ok(span.from <= '2026-11-12' && span.to >= '2026-11-12');
var days = model.eachDay('2026-11-10', '2026-11-12');
assert.deepStrictEqual(days, ['2026-11-10', '2026-11-11', '2026-11-12']);

console.log('plan-model tests passed (' + seed.length + ' seed items, ' + nov.length + ' in Nov 2026)');
