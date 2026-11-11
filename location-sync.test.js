const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sync = require('./location-sync');

const file = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/locations.json'), 'utf8'));
const pin217 = file.project.find(it => it.id === 217 && it.so === 'SO2611-058');
assert.ok(pin217, 'locations.json has job 217 SO2611-058');
assert.strictEqual(pin217.lat, 7.92185);
assert.strictEqual(pin217.lng, 98.39645);

function sheetRow(over) {
  return Object.assign({
    id: 217,
    so: 'SO2611-058',
    comp: 'คุณสุนิสา ลิ้มเจริญ',
    proj: 'บ้านส่วนตัวคุณสุนิสา ตรงข้ามซุปเปอร์ชีปใหญ่',
    st: 'มัดจำแล้ว',
    note: 'KEEP-NOTE-217',
    eng: 'ยังไม่ระบุ',
    pay: 'มัดจำแล้ว',
    loc: '',
    lat: '',
    lng: '',
    locHow: '',
    locSrc: ''
  }, over);
}

function clone(r) { return JSON.parse(JSON.stringify(r)); }

// Missing lat/lng is filled from the file. Other columns stay put.
{
  const row = sheetRow();
  const n = sync.applyFile([row], file.project, 'sync');
  assert.strictEqual(n, 1);
  assert.strictEqual(row.loc, pin217.loc);
  assert.strictEqual(row.lat, '7.92185');
  assert.strictEqual(row.lng, '98.39645');
  assert.strictEqual(row.locHow, 'approximate');
  assert.strictEqual(row.note, 'KEEP-NOTE-217');
  assert.strictEqual(row.st, 'มัดจำแล้ว');
  assert.strictEqual(row.comp, 'คุณสุนิสา ลิ้มเจริญ');
  assert.strictEqual(sync.applyFile([row], file.project, 'sync'), 0, 'second pass does not write again');
}

// A different pin is replaced, and the overlay touches only location columns.
{
  const base = sheetRow({ loc: 'old place', lat: '7.1', lng: '98.1', locHow: 'exact', locSrc: 'old' });
  const current = clone(base);
  assert.strictEqual(sync.applyFile([current], file.project, 'sync'), 1);
  assert.strictEqual(current.lat, '7.92185');
  assert.strictEqual(current.lng, '98.39645');
  const over = sync.overlayLocations([base], [current]);
  assert.strictEqual(over.length, 1);
  assert.strictEqual(over[0].lat, '7.92185');
  assert.strictEqual(over[0].lng, '98.39645');
  assert.strictEqual(over[0].loc, pin217.loc);
  assert.strictEqual(over[0].note, 'KEEP-NOTE-217');
  assert.strictEqual(over[0].st, 'มัดจำแล้ว');
  assert.strictEqual(over[0].pay, 'มัดจำแล้ว');
  assert.strictEqual(over[0].eng, 'ยังไม่ระบุ');
  assert.strictEqual(sync.driftCount([current], [base]), 1);
  assert.strictEqual(sync.driftCount([current], [current]), 0);
}

// Matching lat/lng is left alone, even if the label differs.
{
  const row = sheetRow({
    loc: 'ชื่อที่แก้บนชีต',
    lat: 7.92185,
    lng: 98.39645,
    locHow: 'approximate',
    locSrc: pin217.src
  });
  assert.strictEqual(sync.needsFileWrite(row, pin217), false);
  assert.strictEqual(sync.applyFile([row], file.project, 'sync'), 0);
  assert.strictEqual(row.loc, 'ชื่อที่แก้บนชีต');
  assert.strictEqual(sync.overlayLocations([row], [clone(row)])[0].note, 'KEEP-NOTE-217');
}

// Fill mode does not replace an existing different pin. Sync mode does.
{
  const fill = sheetRow({ lat: '8', lng: '99', loc: 'x' });
  const syncRow = clone(fill);
  assert.strictEqual(sync.applyFile([fill], file.project, 'fill'), 0);
  assert.strictEqual(fill.lat, '8');
  assert.strictEqual(sync.applyFile([syncRow], file.project, 'sync'), 1);
  assert.strictEqual(syncRow.lat, '7.92185');
}

// A manual UI edit is not overwritten by the file.
{
  const row = sheetRow({ loc: 'สถานที่ที่พิมพ์เอง', lat: '', lng: '' });
  const n = sync.applyFile([row], file.project, 'sync', r => r.id === 217);
  assert.strictEqual(n, 0);
  assert.strictEqual(row.loc, 'สถานที่ที่พิมพ์เอง');
}

// Retired Mai Khao pin is replaced. A neighbour row is not.
{
  const retired = sheetRow({ lat: 8.1661545, lng: 98.2952039, loc: 'old' });
  const other = { id: 1, so: 'SO2601-001', loc: 'Avani+Koh Lanta (The Peak building)', lat: '7.62', lng: '99.04', note: 'keep-1' };
  assert.strictEqual(sync.applyFile([retired, other], file.project, 'sync'), 1);
  assert.strictEqual(retired.lat, '7.92185');
  assert.strictEqual(other.note, 'keep-1');
  assert.strictEqual(other.lat, '7.62');
}

// Service pins use the same rule.
{
  const hit = file.service.find(it => it.so === 'PSE - PHK6909-001');
  assert.ok(hit);
  const row = { id: hit.id, so: hit.so, customer: 'KEEP-CUSTOMER', note: 'KEEP-SVC', loc: '', lat: '', lng: '' };
  assert.strictEqual(sync.applyFile([row], file.service, 'sync'), 1);
  assert.strictEqual(row.lat, sync.coordOrBlank(hit.lat));
  assert.strictEqual(row.lng, sync.coordOrBlank(hit.lng));
  assert.strictEqual(row.customer, 'KEEP-CUSTOMER');
  assert.strictEqual(row.note, 'KEEP-SVC');
  const over = sync.overlayLocations([{ id: hit.id, so: hit.so, customer: 'KEEP-CUSTOMER', note: 'KEEP-SVC', loc: '', lat: '', lng: '' }], [row]);
  assert.strictEqual(over[0].customer, 'KEEP-CUSTOMER');
  assert.strictEqual(over[0].note, 'KEEP-SVC');
  assert.strictEqual(over[0].lat, row.lat);
}

console.log('location-sync tests passed');
