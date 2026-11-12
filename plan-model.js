/**
 * Plan schedule math: Thai dates, linking, filters, and the Gantt scale.
 * No DOM. The page and the tests both use this file.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PEPlanModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var GROUPS = [
    { id: 'install', label: 'งานติดตั้ง', color: 'project' },
    { id: 'handover', label: 'ส่งมอบ', color: 'project' },
    { id: 'cm', label: 'CM (ซ่อม)', color: 'cm' },
    { id: 'pm', label: 'PM', color: 'pm' }
  ];
  var GROUP_IDS = { install: 1, handover: 1, cm: 1, pm: 1 };
  var STATUSES = ['วางแผน', 'กำลังดำเนินการ', 'ครบกำหนด', 'เสร็จแล้ว'];
  var WEEKDAY = /^(อา|พฤ|จ|อ|พ|ศ|ส)\s+/;

  function pad2(n) {
    n = String(n);
    return n.length < 2 ? '0' + n : n;
  }

  function parseDate(v) {
    if (v == null || v === '') return '';
    var s = String(v).replace(/^\uFEFF/, '').trim();
    if (!s) return '';
    s = s.replace(WEEKDAY, '');
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) {
      var yi = +iso[1];
      if (yi >= 2400) yi -= 543;
      return check(yi, +iso[2], +iso[3]);
    }
    var dm = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
    if (!dm) return '';
    var d = +dm[1], m = +dm[2], y = +dm[3];
    if (y < 100) y = y >= 50 ? 2500 + y : 2000 + y;
    if (y >= 2400) y -= 543;
    return check(y, m, d);
  }

  function check(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function formatDate(v) {
    var s = parseDate(v);
    if (!s) return '';
    var p = s.split('-');
    return p[2] + '/' + p[1] + '/' + (+p[0] + 543);
  }

  function todayIso(now) {
    var d = now ? new Date(now) : new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
    } catch (e) {}
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function utcMs(iso) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return NaN;
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  function inclusiveDays(start, finish) {
    var a = utcMs(start), b = utcMs(finish);
    if (!isFinite(a) || !isFinite(b) || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  function addDays(iso, n) {
    var ms = utcMs(iso);
    if (!isFinite(ms)) return '';
    var d = new Date(ms + n * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function dow(iso) {
    var ms = utcMs(iso);
    if (!isFinite(ms)) return -1;
    return new Date(ms).getUTCDay();
  }

  function defaultStatus(item, today) {
    var group = item && item.group;
    var start = item && item.start;
    var finish = item && item.finish;
    if (group === 'handover') return 'เสร็จแล้ว';
    if (finish && finish < today) return 'ครบกำหนด';
    if (start && finish && start <= today && finish >= today) return 'กำลังดำเนินการ';
    return 'วางแผน';
  }

  function groupOf(id) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].id === id) return GROUPS[i];
    return GROUPS[0];
  }

  function normalizeItem(r) {
    r = r || {};
    var group = GROUP_IDS[r.group] ? r.group : 'install';
    var link = r.linkTable === 'jobs' || r.linkTable === 'service' ? r.linkTable : '';
    var start = parseDate(r.start);
    var finish = parseDate(r.finish);
    if (start && finish && finish < start) finish = start;
    return {
      id: +r.id || 0,
      pdfId: +r.pdfId || 0,
      name: String(r.name || '').trim(),
      group: group,
      start: start,
      finish: finish,
      person: String(r.person || '').trim(),
      note: String(r.note || '').trim(),
      so: String(r.so || '').trim(),
      linkTable: link && String(r.so || '').trim() ? link : (link || ''),
      status: String(r.status || '').trim()
    };
  }

  function soMatches(got, want) {
    if (!got || !want) return false;
    if (got === want) return true;
    if (got.indexOf(want) === 0) {
      var next = got.charAt(want.length);
      return next === '' || next === ' ' || next === '\u00a0';
    }
    if (want.indexOf(got) === 0) {
      var back = want.charAt(got.length);
      return back === '' || back === ' ' || back === '\u00a0';
    }
    return false;
  }

  function findBySo(list, so) {
    var want = String(so || '').trim();
    if (!want || !list) return null;
    var exact = [];
    var loose = [];
    for (var i = 0; i < list.length; i++) {
      var got = String(list[i].so || '').trim();
      if (!got) continue;
      if (got === want) exact.push(list[i]);
      else if (soMatches(got, want)) loose.push(list[i]);
    }
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
    if (loose.length === 1) return loose[0];
    return null;
  }

  function findLinked(item, jobs, services) {
    if (!item || !item.so) return null;
    var table = item.linkTable;
    if (table !== 'jobs' && table !== 'service') return null;
    if (table === 'jobs') {
      var job = findBySo(jobs, item.so);
      return job ? { table: 'jobs', row: job } : null;
    }
    var svc = findBySo(services, item.so);
    return svc ? { table: 'service', row: svc } : null;
  }

  function isRoster(row) {
    if (!row) return false;
    if (+row.id === -1) return true;
    if (String(row.src || '') === '__roster__') return true;
    return false;
  }

  function linkedDates(row, start, finish) {
    if (String(row.planSet || '') === '1') {
      return { start: parseDate(row.planStart), finish: parseDate(row.planEnd) };
    }
    if (row.planStart || row.planEnd) {
      return {
        start: parseDate(row.planStart) || start,
        finish: parseDate(row.planEnd) || finish
      };
    }
    return { start: start, finish: finish };
  }

  function barDates(start, finish) {
    if (start && !finish) finish = start;
    if (finish && !start) start = finish;
    return { start: start || '', finish: finish || '' };
  }

  function buildEntries(planRows, jobs, services) {
    var entries = [];
    var used = {};
    (planRows || []).forEach(function (raw) {
      var item = normalizeItem(raw);
      if (!item.name && !item.so) return;
      var link = findLinked(item, jobs, services);
      var start = item.start;
      var finish = item.finish;
      var person = item.person;
      var status = item.status;
      var statusKind = 'plan';
      var jobId = 0;
      var serviceId = 0;
      if (link && link.table === 'jobs' && !isRoster(link.row)) {
        used['jobs:' + link.row.id] = 1;
        jobId = link.row.id;
        statusKind = 'job';
        var jobDates = linkedDates(link.row, start, finish);
        start = jobDates.start;
        finish = jobDates.finish;
        person = String(link.row.eng || '');
        status = String(link.row.st || status);
      } else if (link && link.table === 'service') {
        used['service:' + link.row.id] = 1;
        serviceId = link.row.id;
        statusKind = 'service';
        var svcDates = linkedDates(link.row, start, finish);
        start = svcDates.start;
        finish = svcDates.finish;
        person = String(link.row.team || person || '');
      }
      var drawn = barDates(start, finish);
      entries.push({
        key: 'plan:' + item.id,
        source: 'plan',
        planId: item.id,
        pdfId: item.pdfId || item.id,
        jobId: jobId,
        serviceId: serviceId,
        group: item.group,
        color: groupOf(item.group).color,
        name: item.name,
        start: start,
        finish: finish,
        barStart: drawn.start,
        barEnd: drawn.finish,
        person: person,
        status: status,
        statusKind: statusKind,
        note: item.note,
        so: item.so,
        linkTable: item.linkTable,
        days: inclusiveDays(drawn.start, drawn.finish)
      });
    });

    (jobs || []).forEach(function (row) {
      if (!row || isRoster(row) || used['jobs:' + row.id]) return;
      var start = parseDate(row.planStart);
      var finish = parseDate(row.planEnd);
      if (!start && !finish) return;
      var drawn = barDates(start, finish);
      var name = String(row.proj || row.comp || row.so || 'งาน Project');
      entries.push({
        key: 'job:' + row.id,
        source: 'job',
        planId: 0,
        pdfId: row.id,
        jobId: row.id,
        serviceId: 0,
        group: 'install',
        color: 'project',
        name: name,
        start: start,
        finish: finish,
        barStart: drawn.start,
        barEnd: drawn.finish,
        person: String(row.eng || ''),
        status: String(row.st || ''),
        statusKind: 'job',
        note: '',
        so: String(row.so || ''),
        linkTable: 'jobs',
        days: inclusiveDays(drawn.start, drawn.finish)
      });
    });

    (services || []).forEach(function (row) {
      if (!row || used['service:' + row.id]) return;
      var start = parseDate(row.planStart);
      var finish = parseDate(row.planEnd);
      if (!start && !finish) return;
      var drawn = barDates(start, finish);
      var pm = row.type === 'PM' || row.type === 'PM (บำรุงรักษา)';
      var name = String(row.customer || row.detail || row.so || 'งาน Service');
      name = name.split('\n')[0];
      entries.push({
        key: 'svc:' + row.id,
        source: 'service',
        planId: 0,
        pdfId: row.id,
        jobId: 0,
        serviceId: row.id,
        group: pm ? 'pm' : 'cm',
        color: pm ? 'pm' : 'cm',
        name: name,
        start: start,
        finish: finish,
        barStart: drawn.start,
        barEnd: drawn.finish,
        person: String(row.team || ''),
        status: '',
        statusKind: 'service',
        note: '',
        so: String(row.so || ''),
        linkTable: 'service',
        days: inclusiveDays(drawn.start, drawn.finish)
      });
    });
    return entries;
  }

  function overlaps(entry, from, to) {
    var start = entry.barStart || entry.start;
    var finish = entry.barEnd || entry.finish;
    if (!start && !finish) return !from && !to;
    if (!start) start = finish;
    if (!finish) finish = start;
    if (from && finish < from) return false;
    if (to && start > to) return false;
    return true;
  }

  function filterEntries(entries, opts) {
    opts = opts || {};
    var q = String(opts.q || '').trim().toLowerCase();
    var group = opts.group || '';
    var person = opts.person || '';
    var from = parseDate(opts.from);
    var to = parseDate(opts.to);
    return (entries || []).filter(function (e) {
      if (group && e.group !== group) return false;
      if (person) {
        var p = String(e.person || '').trim();
        if (person === '__none__') {
          if (p && p !== 'ยังไม่ระบุ') return false;
        } else if (p !== person) return false;
      }
      if ((from || to) && !overlaps(e, from, to)) return false;
      if (q) {
        var blob = (e.name + ' ' + e.so + ' ' + e.note + ' ' + e.person).toLowerCase();
        if (blob.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function sortEntries(entries) {
    var order = { install: 0, handover: 1, cm: 2, pm: 3 };
    return (entries || []).slice().sort(function (a, b) {
      var ga = order[a.group] == null ? 9 : order[a.group];
      var gb = order[b.group] == null ? 9 : order[b.group];
      if (ga !== gb) return ga - gb;
      var ia = a.source === 'plan' ? (+a.pdfId || 0) : 100000 + (+a.pdfId || 0);
      var ib = b.source === 'plan' ? (+b.pdfId || 0) : 100000 + (+b.pdfId || 0);
      if (ia !== ib) return ia - ib;
      if (a.barStart !== b.barStart) return String(a.barStart).localeCompare(String(b.barStart));
      return String(a.name).localeCompare(String(b.name), 'th');
    });
  }

  function eachDay(from, to) {
    var out = [];
    var cur = from;
    var guard = 0;
    while (cur && cur <= to && guard < 4000) {
      out.push(cur);
      cur = addDays(cur, 1);
      guard++;
    }
    return out;
  }

  function spanOf(entries, today, padDays) {
    var min = '';
    var max = '';
    (entries || []).forEach(function (e) {
      var a = e.barStart, b = e.barEnd;
      if (!a || !b) return;
      if (!min || a < min) min = a;
      if (!max || b > max) max = b;
    });
    if (!min) min = today || todayIso();
    if (!max) max = min;
    var pad = padDays == null ? 3 : padDays;
    if (today && today < min) min = today;
    if (today && today > max) max = today;
    return { from: addDays(min, -pad), to: addDays(max, pad) };
  }

  function responseKind(data) {
    if (!data || data.ok !== true || !Array.isArray(data.rows)) return 'bad';
    if (data.table !== 'plan') return 'old';
    if (data.rows.length) {
      var sample = data.rows[0] || {};
      var jobLike = sample.comp != null && sample.name == null && sample.group == null;
      var svcLike = sample.customer != null && sample.name == null && sample.group == null;
      if (jobLike || svcLike) return 'old';
    }
    return 'live';
  }

  function sheetHasPlanFields(data) {
    return !!(data && Array.isArray(data.fields) &&
      data.fields.indexOf('planStart') >= 0 && data.fields.indexOf('planEnd') >= 0);
  }

  return {
    GROUPS: GROUPS,
    STATUSES: STATUSES,
    parseDate: parseDate,
    formatDate: formatDate,
    todayIso: todayIso,
    inclusiveDays: inclusiveDays,
    addDays: addDays,
    dow: dow,
    defaultStatus: defaultStatus,
    groupOf: groupOf,
    normalizeItem: normalizeItem,
    findBySo: findBySo,
    findLinked: findLinked,
    buildEntries: buildEntries,
    overlaps: overlaps,
    filterEntries: filterEntries,
    sortEntries: sortEntries,
    eachDay: eachDay,
    spanOf: spanOf,
    responseKind: responseKind,
    sheetHasPlanFields: sheetHasPlanFields
  };
});
