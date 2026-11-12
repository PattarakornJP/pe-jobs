/**
 * Source for the Project Plan 2026 tasks.
 * Run: node seed/build-plan.js
 * Writes seed/plan.json and plan-seed.js
 */
var ITEMS = [
  ['install', 2, 'ส่งถัง TIVA (3000L)', '2026-11-03', '2026-11-03', '', '', ''],
  ['install', 3, 'The Nature (HP 12.5kw)', '2026-11-05', '2026-11-07', 'jobs', 'SO2610-045', 'ค่าติดตั้ง (สินค้า SO2610-044)'],
  ['install', 4, 'The Exporar samui', '2026-11-05', '2026-11-09', 'jobs', 'SO2610-005', ''],
  ['install', 5, 'Hyatt samui (V.2-4) EN400TW @ 3 Unit', '2026-11-10', '2026-11-12', '', '', 'ใบงาน SO2608-117 รวม Villa 2-7 จึงไม่แยกวัน'],
  ['install', 6, 'Hyatt samui V.1 HP12Kw+ EN500C @ 1 Unit', '2026-11-13', '2026-11-14', 'jobs', 'SO2608-118', ''],
  ['install', 7, 'Anantara Layan V106 (Abs*3)', '2026-11-09', '2026-11-12', 'jobs', 'SO2610-026', ''],
  ['install', 8, 'Outrigger-2', '2026-11-10', '2026-11-20', 'jobs', 'SO2609-118', 'ค่าติดตั้ง (สินค้า SO2609-117)'],
  ['install', 9, 'Grand mercure', '2026-11-16', '2026-11-16', '', '', ''],
  ['install', 10, 'Kata tani (B5) Booster tank', '2026-11-17', '2026-11-18', '', '', ''],
  ['install', 11, 'Banyantree Zone8 (8Set) HP9kw+EN500C', '2026-10-05', '2026-12-02', 'jobs', 'SO2608-087', 'ภาพรวม Zone8'],
  ['install', 12, 'Banyan Tree Zone8 / 885', '2026-10-05', '2026-10-07', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 13, 'Banyan Tree Zone8 / 881', '2026-10-08', '2026-10-12', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 14, 'Banyan Tree Zone8 / 883', '2026-10-12', '2026-10-15', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 15, 'Banyan Tree Zone8 / 882', '2026-10-16', '2026-10-19', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 16, 'Banyan Tree Zone8 / 886', '2026-11-19', '2026-11-21', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 17, 'Banyan Tree Zone8 / 888', '2026-11-23', '2026-11-25', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 18, 'Banyan Tree Zone8 / 889', '2026-11-26', '2026-11-28', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 19, 'Banyan Tree Zone8 / 887', '2026-11-30', '2026-12-02', '', '', 'งานย่อย Zone8 ของ SO2608-087'],
  ['install', 20, 'Stay Bridge', '2026-11-17', '2026-12-15', 'jobs', 'SO2608-153', 'ค่าติดตั้ง (สินค้า SO2609-001)'],
  ['install', 21, 'Avani Koh lanta (Abs 270)', '2026-11-23', '2026-11-24', 'jobs', 'SO2610-073', ''],
  ['install', 22, 'ตึก Layan Green Park (F)', '2026-11-24', '2026-12-04', 'jobs', 'SO2607-102', ''],
  ['install', 23, 'รร.ครามอันดา (Abs)', '2026-11-30', '2026-12-01', 'jobs', 'SO2606-090', ''],
  ['install', 24, 'Rayal Phuket marina', '2026-12-02', '2026-12-04', '', '', 'เกี่ยวกับ SO2609-130 และ SO2609-131'],
  ['install', 25, 'ตึก Layan Verde (A4)', '2026-12-08', '2026-12-24', 'jobs', 'SO2608-085', ''],
  ['install', 26, 'ตึก Layan Verde (A5)', '2026-12-08', '2026-12-24', 'jobs', 'SO2608-084', ''],
  ['install', 27, 'TIVA', '2026-12-15', '2027-01-09', '', '', ''],
  ['install', 28, 'Avani Maikhao (IOT)', '2026-12-21', '2026-12-22', '', '', ''],
  ['install', 29, 'Thaiga PPX', '2026-12-21', '2026-12-24', '', '', ''],
  ['install', 30, 'Anantara vication (Sub) EN200H/300H', '2026-09-14', '2026-09-16', 'jobs', 'SO2608-111', ''],
  ['install', 31, 'ตึก Layan Green Park (G) Defect-Tank', '2026-09-28', '2026-09-29', '', '', ''],
  ['install', 32, 'ตึก Layan Green Park (G,H,K) Jacket', '2026-09-28', '2026-10-03', '', '', ''],
  ['install', 33, 'Kleage Wellness ONSEN', '2026-10-05', '2026-11-26', '', '', ''],
  ['install', 34, 'Banyantree kitchen (Zone9) HP12kw+EN500C', '2026-11-30', '2026-12-01', 'jobs', 'SO2607-039', ''],
  ['install', 35, 'Paresa (HP 29kw)', '2026-11-12', '2026-11-14', '', '', ''],
  ['install', 36, 'Coutyard (HP 34kw)', '2026-11-24', '2026-11-28', 'jobs', 'SO2610-033', 'ในใบงานระบุ 43kW'],
  ['install', 37, 'Kleage Wellness HP', '2026-10-19', '2026-10-29', '', '', ''],

  ['handover', 420, 'Hotel tide (HP 29kw)', '2026-10-29', '2026-10-29', '', '', ''],
  ['handover', 421, 'Medeit chalong', '2026-10-21', '2026-10-24', 'jobs', 'SO2603-125', ''],
  ['handover', 422, 'Outrigger', '2026-10-16', '2026-10-24', '', '', 'ช่วงส่งมอบ คนละช่วงกับ Outrigger-2'],
  ['handover', 423, 'Hyatt samui (V.5-7) EN400TW @ 3 Unit', '2026-10-15', '2026-10-17', '', '', 'ใบงาน SO2608-117 รวม Villa 2-7 จึงไม่แยกวัน'],
  ['handover', 424, 'Cap yamu (Pool temper)', '2026-06-04', '2026-06-05', 'jobs', 'SO2604-033', ''],
  ['handover', 425, 'Bluesotel (HP 35Kw)', '2026-07-03', '2026-07-03', 'jobs', 'SO2605-103', ''],
  ['handover', 426, 'รร.ครามอันดา (HP)', '2026-07-16', '2026-07-23', 'jobs', 'SO2511-038', ''],
  ['handover', 427, 'ไสไทย PPT', '2026-08-13', '2026-08-15', 'jobs', 'SO2603-117', 'ค่าติดตั้ง (สินค้า SO2603-116)'],
  ['handover', 428, 'อีลิซี พูลวิลล่า', '2026-08-17', '2026-08-17', 'jobs', 'SO2603-119', 'ค่าติดตั้ง (สินค้า SO2603-118)'],

  ['cm', 431, 'ซ่อมรั่ว Patong beach', '2026-10-30', '2026-10-31', 'service', 'SO2610-052', ''],
  ['cm', 432, 'ณีรานภา (FS)', '2026-10-31', '2026-10-31', '', '', ''],
  ['cm', 433, 'Holiday inn samui (Comp)', '2026-11-02', '2026-11-03', 'service', 'SO2610-011', ''],
  ['cm', 434, 'Aleenta (PG+Foot valve)', '2026-11-04', '2026-11-04', '', '', ''],
  ['cm', 435, 'Kata tani (Evap coil)', '2026-11-16', '2026-11-17', 'service', 'SO2609-125', ''],
  ['cm', 436, 'Aleenta (Displa)', '2026-11-18', '2026-11-18', 'service', 'SO2609-132', ''],
  ['cm', 437, 'Windham (K,L,J)', '2026-11-23', '2026-11-24', 'service', 'SO2610-047', ''],
  ['cm', 438, 'Centara grand 1.7 (Valve)', '2026-07-23', '2026-07-23', 'service', 'SO2606-106', ''],

  ['pm', 662, 'Anantara maikhao 717', '2026-10-01', '2026-10-01', '', '', ''],
  ['pm', 663, 'Banyan Tree Zone9 (Rev.3)', '2026-08-26', '2026-12-08', '', '', 'ภาพรวม PM Zone9'],
  ['pm', 664, 'Banyan Tree Zone9 (ไม่มีชื่อ 664)', '2026-08-26', '2026-10-24', '', '', 'แถวในไฟล์ต้นฉบับไม่มีชื่อ'],
  ['pm', 676, 'Banyan Tree Zone9 / 914', '2026-10-31', '2026-10-31', '', '', 'งานย่อย PM Zone9'],
  ['pm', 677, 'Banyan Tree Zone9 / 906', '2026-11-09', '2026-11-09', '', '', 'งานย่อย PM Zone9'],
  ['pm', 678, 'Banyan Tree Zone9 / 903', '2026-11-09', '2026-11-10', '', '', 'งานย่อย PM Zone9'],
  ['pm', 679, 'Banyan Tree Zone9 / 909', '2026-11-10', '2026-11-10', '', '', 'งานย่อย PM Zone9'],
  ['pm', 680, 'Banyan Tree Zone9 / 907', '2026-11-26', '2026-11-26', '', '', 'งานย่อย PM Zone9'],
  ['pm', 681, 'Banyan Tree Zone9 / 926', '2026-11-26', '2026-11-27', '', '', 'งานย่อย PM Zone9'],
  ['pm', 682, 'Banyan Tree Zone9 / 929', '2026-11-27', '2026-11-27', '', '', 'งานย่อย PM Zone9'],
  ['pm', 683, 'Banyan Tree Zone9 / 925', '2026-12-08', '2026-12-08', '', '', 'งานย่อย PM Zone9'],
  ['pm', 684, 'Banyan Tree Zone9 (ไม่มีชื่อ 684)', '2026-12-08', '2026-12-08', '', '', 'แถวในไฟล์ต้นฉบับไม่มีชื่อ'],
  ['pm', 690, 'Dusit Princess Phatthalung', '2026-10-29', '2026-10-30', '', '', ''],
  ['pm', 691, 'JonoX 3/4', '2026-11-02', '2026-11-02', '', '', ''],
  ['pm', 692, 'Centara Karon 2/4', '2026-11-03', '2026-11-03', '', '', ''],
  ['pm', 693, 'Holiday inn Samui 5/6', '2026-11-03', '2026-11-05', '', '', ''],
  ['pm', 694, 'Melia Koh Samamui 2/4', '2026-11-06', '2026-11-07', '', '', ''],
  ['pm', 695, 'Bayantree Main block 1/4', '2026-11-11', '2026-11-11', '', '', ''],
  ['pm', 696, 'The Kee', '2026-11-13', '2026-11-13', '', '', ''],
  ['pm', 697, 'รพ.วัฒนแพทย์ ตรัง 1/2', '2026-11-19', '2026-11-20', '', '', ''],
  ['pm', 698, 'Avani Koh lanta 2/2', '2026-11-24', '2026-11-25', '', '', '']
];

function statusFor(group, start, finish) {
  if (group === 'handover') return 'เสร็จแล้ว';
  if (finish < '2026-11-12') return 'ครบกำหนด';
  if (start <= '2026-11-12' && finish >= '2026-11-12') return 'กำลังดำเนินการ';
  return 'วางแผน';
}

function build() {
  return ITEMS.map(function (r) {
    return {
      id: r[1],
      pdfId: r[1],
      name: r[2],
      group: r[0],
      start: r[3],
      finish: r[4],
      person: '',
      note: r[7] || '',
      so: r[6] || '',
      linkTable: r[5] || '',
      status: statusFor(r[0], r[3], r[4])
    };
  });
}

if (typeof module === 'object' && module.exports) module.exports = build();

if (require.main === module) {
  var fs = require('fs');
  var path = require('path');
  var rows = build();
  var json = JSON.stringify(rows, null, 2) + '\n';
  fs.writeFileSync(path.join(__dirname, 'plan.json'), json);
  var js = '/* Generated by seed/build-plan.js — do not edit by hand. */\n' +
    '(function (root) {\n' +
    '  var data = ' + JSON.stringify(rows) + ';\n' +
    '  if (typeof module === "object" && module.exports) module.exports = data;\n' +
    '  root.PE_PLAN_SEED = data;\n' +
    '})(typeof globalThis !== "undefined" ? globalThis : this);\n';
  fs.writeFileSync(path.join(__dirname, '..', 'plan-seed.js'), js);
  console.log('wrote ' + rows.length + ' plan items');
}
