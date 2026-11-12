/**
 * แท็บแผนงาน: เส้นเวลา + ตาราง
 * อ่านและเขียนใบงานผ่าน bridge ที่หน้าหลักส่งมา เพื่อใช้รหัสผู้ดูแลและบันทึกอัตโนมัติชุดเดิม
 */
(function (root) {
  var model = root.PEPlanModel;
  var KEY = 'pe-plan-data-v1';
  var bridge = {};
  var planRows = [];
  var planBase = [];
  var planRev = '';
  var planMode = 'seed';
  var planApiOk = false;
  var planNeedsUpload = false;
  var planTimer = null;
  var planSaving = false;
  var planLock = false;
  var planHold = false;
  var planQueued = false;
  var reconciling = false;
  var zoom = 'month';
  var pinToday = true;
  var ganttPos = { l: 0, t: 0 };
  var shown = [];
  var editingId = null;
  var statusText = 'พร้อมใช้งาน';
  var statusWarn = false;
  var painting = false;

  function el(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function jobs() { return bridge.jobs ? bridge.jobs() : []; }
  function services() { return bridge.services ? bridge.services() : []; }
  function readyJobs() { return bridge.jobsReady ? bridge.jobsReady() : false; }
  function readySvc() { return bridge.serviceReady ? bridge.serviceReady() : false; }

  function sig(list) {
    return (list || []).map(function (r) { return JSON.stringify(model.normalizeItem(r)); }).join('\n');
  }
  function cloneItem(r) { return model.normalizeItem(r); }
  function dirty() { return sig(planRows) !== sig(planBase); }
  function adopt(rows, rev) {
    planRows = (rows || []).map(cloneItem).filter(function (r) { return r.id && (r.name || r.so); });
    planBase = planRows.map(function (r) { return Object.assign({}, r); });
    planRev = rev || '';
  }
  function readLocal() {
    try {
      var raw = localStorage.getItem(KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data && data.v === 1 && Array.isArray(data.rows) && data.rows.length) return data.rows;
    } catch (e) {}
    return null;
  }
  function writeLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, rows: planRows.map(cloneItem) }));
    } catch (e) {}
  }
  function seedRows() {
    return (root.PE_PLAN_SEED || []).map(cloneItem);
  }
  function paint(txt, warn) {
    statusText = txt;
    statusWarn = !!warn;
    if (!bridge.view || bridge.view() !== 'plan') return;
    var node = el('saveTxt');
    var box = el('saveState');
    if (node) node.textContent = txt;
    if (box) box.classList.toggle('warn', !!warn);
  }
  function showBanner(text, bad) {
    var b = el('planBanner');
    if (!b) return;
    if (!text) { b.className = 'banner'; b.textContent = ''; return; }
    b.textContent = text;
    b.className = 'banner on' + (bad ? ' bad' : '');
  }
  function nowHHMM() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function copyBase(table, row) {
    var list = table === 'jobs' ? (bridge.baseJobs ? bridge.baseJobs() : []) : (bridge.baseServices ? bridge.baseServices() : []);
    var base = (list || []).filter(function (r) { return String(r.id) === String(row.id); })[0];
    if (!base) return;
    base.planStart = row.planStart || '';
    base.planEnd = row.planEnd || '';
    base.planSet = row.planSet || '';
  }

  function reconcile() {
    if (reconciling) return;
    if (bridge.booting && bridge.booting()) return;
    reconciling = true;
    var jobsTouched = false;
    var svcTouched = false;
    var before = sig(planRows);
    try {
      planRows.forEach(function (item) {
        var link = model.findLinked(item, jobs(), services());
        if (!link) return;
        var row = link.row;
        var set = String(row.planSet || '') === '1';
        var start = model.parseDate(row.planStart);
        var finish = model.parseDate(row.planEnd);
        if (set || start || finish) {
          if (item.start !== start) item.start = start;
          if (item.finish !== finish) item.finish = finish;
          return;
        }
        if (!item.start && !item.finish) return;
        var ready = link.table === 'jobs' ? readyJobs() : readySvc();
        var editable = link.table === 'jobs' || (bridge.svcMode && (bridge.svcMode() === 'live' || bridge.svcMode() === 'local'));
        row.planStart = item.start;
        row.planEnd = item.finish;
        if (ready && editable) row.planSet = '1';
        if (ready && editable && bridge.getKey && bridge.getKey()) {
          if (link.table === 'jobs') jobsTouched = true;
          else svcTouched = true;
        } else {
          copyBase(link.table, row);
        }
      });
    } finally {
      reconciling = false;
    }
    if (sig(planRows) !== before) schedulePlanSave();
    if (jobsTouched && bridge.commitJob) bridge.commitJob();
    if (svcTouched && bridge.commitService) bridge.commitService();
  }

  function syncFromRow(row, table) {
    planRows.forEach(function (item) {
      if (item.linkTable !== table) return;
      var hit = model.findLinked(item, table === 'jobs' ? [row] : [], table === 'service' ? [row] : []);
      if (!hit) return;
      item.start = model.parseDate(row.planStart);
      item.finish = model.parseDate(row.planEnd);
    });
    schedulePlanSave();
    render();
  }

  function writeRowDates(entry, start, finish) {
    var list = entry.jobId ? jobs() : services();
    var id = entry.jobId || entry.serviceId;
    if (!id) return;
    var row = list.filter(function (r) { return String(r.id) === String(id); })[0];
    if (!row) return;
    row.planStart = start || '';
    row.planEnd = finish || '';
    row.planSet = '1';
    if (entry.jobId) {
      if (readyJobs()) { if (bridge.commitJob) bridge.commitJob(); }
      else copyBase('jobs', row);
    } else if (bridge.svcMode && (bridge.svcMode() === 'live' || bridge.svcMode() === 'local')) {
      if (readySvc()) { if (bridge.commitService) bridge.commitService(); }
      else copyBase('service', row);
    }
  }

  function clearLink(snapshot) {
    if (!snapshot || !snapshot.so) return;
    var link = model.findLinked(snapshot, jobs(), services());
    if (!link) return;
    link.row.planStart = '';
    link.row.planEnd = '';
    link.row.planSet = '1';
    if (link.table === 'jobs') {
      if (readyJobs()) { if (bridge.commitJob) bridge.commitJob(); }
      else copyBase('jobs', link.row);
    } else if (bridge.svcMode && (bridge.svcMode() === 'live' || bridge.svcMode() === 'local')) {
      if (readySvc()) { if (bridge.commitService) bridge.commitService(); }
      else copyBase('service', link.row);
    }
  }

  function filters() {
    return {
      q: (el('planQ') && el('planQ').value) || '',
      group: (el('planGroup') && el('planGroup').value) || '',
      person: (el('planPerson') && el('planPerson').value) || '',
      from: (el('planFrom') && el('planFrom').value) || '',
      to: (el('planTo') && el('planTo').value) || ''
    };
  }

  function statusOf(entry) {
    if (entry.statusKind === 'service' && entry.serviceId && bridge.deriveStage) {
      var svc = services().filter(function (r) { return String(r.id) === String(entry.serviceId); })[0];
      if (svc) return bridge.deriveStage(svc).stage || '';
    }
    if (entry.statusKind === 'job' && entry.jobId) {
      var job = jobs().filter(function (r) { return String(r.id) === String(entry.jobId); })[0];
      if (job && job.st) return job.st;
    }
    return entry.status || model.defaultStatus(entry, model.todayIso());
  }

  function personOf(entry) {
    if (entry.jobId) {
      var job = jobs().filter(function (r) { return String(r.id) === String(entry.jobId); })[0];
      if (job) return job.eng || '';
    }
    if (entry.serviceId) {
      var svc = services().filter(function (r) { return String(r.id) === String(entry.serviceId); })[0];
      if (svc && svc.team) return svc.team;
    }
    return entry.person || '';
  }

  function isDone(entry, status) {
    return entry.group === 'handover' || status === 'เสร็จแล้ว' || status === 'เสร็จ';
  }

  function renderPeople(all) {
    var sel = el('planPerson');
    if (!sel) return;
    var cur = sel.value;
    var names = [];
    all.forEach(function (e) {
      var n = String(personOf(e) || '').trim();
      if (!n || n === 'ยังไม่ระบุ' || names.indexOf(n) >= 0) return;
      names.push(n);
    });
    names.sort(function (a, b) { return a.localeCompare(b, 'th'); });
    sel.innerHTML = '<option value="">ทุกคน</option><option value="__none__">ยังไม่ระบุ</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    if ([].some.call(sel.options, function (o) { return o.value === cur; })) sel.value = cur;
  }

  function renderKpis(list) {
    var host = el('planKpis');
    if (!host) return;
    var today = model.todayIso();
    var active = list.filter(function (e) {
      return e.barStart && e.barEnd && e.barStart <= today && e.barEnd >= today;
    }).length;
    var open = list.filter(function (e) { return !isDone(e, statusOf(e)); }).length;
    var alone = list.filter(function (e) { return e.source === 'plan' && !e.jobId && !e.serviceId; }).length;
    var tiles = [
      ['รายการที่แสดง', list.length, 'ตามตัวกรองด้านล่าง'],
      ['ทับวันนี้', active, model.formatDate(today)],
      ['ยังไม่จบ', open, 'ไม่นับกลุ่มส่งมอบและงานที่เสร็จ'],
      ['ยังไม่ผูกใบงาน', alone, 'เก็บเป็นรายการแผน']
    ];
    host.innerHTML = tiles.map(function (t) {
      return '<div class="kpi"><div class="lab">' + t[0] + '</div><div class="val">' + t[1] + '</div><div class="sm">' + esc(t[2]) + '</div></div>';
    }).join('');
  }

  function renderGantt(list) {
    var host = el('gantt');
    if (!host) return;
    var dated = list.filter(function (e) { return e.barStart && e.barEnd; });
    if (!dated.length) {
      host.innerHTML = '<p class="empty">ไม่มีแท่งงานในช่วงนี้ ใส่วันเริ่มและวันจบในตารางด้านล่าง</p>';
      return;
    }
    var prev = el('ganttScroll');
    if (prev && !pinToday) ganttPos = { l: prev.scrollLeft, t: prev.scrollTop };
    var today = model.todayIso();
    var span = model.spanOf(dated, today, 2);
    var days = model.eachDay(span.from, span.to);
    var dw = zoom === 'week' ? 34 : 16;
    var labelW = 220;
    var width = days.length * dw;
    var months = [];
    days.forEach(function (iso, i) {
      var key = iso.slice(0, 7);
      if (!months.length || months[months.length - 1].key !== key) {
        months.push({ key: key, iso: iso, n: 1, i: i });
      } else months[months.length - 1].n++;
    });
    var monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var head1 = months.map(function (m) {
      var p = m.iso.split('-');
      var label = monthNames[+p[1] - 1] + ' ' + (+p[0] + 543);
      return '<div class="gmonth" style="width:' + (m.n * dw) + 'px">' + esc(label) + '</div>';
    }).join('');
    var head2 = days.map(function (iso) {
      var n = +iso.slice(8);
      var d = model.dow(iso);
      var cls = 'gday' + (d === 0 || d === 6 ? ' end' : '') + (iso === today ? ' today' : '');
      var txt = zoom === 'week' || n === 1 || d === 1 ? String(n) : '';
      return '<div class="' + cls + '" style="width:' + dw + 'px">' + txt + '</div>';
    }).join('');
    var todayIdx = days.indexOf(today);
    var todayLine = todayIdx >= 0
      ? '<div class="gtoday" style="left:' + (labelW + todayIdx * dw + Math.floor(dw / 2)) + 'px" title="วันนี้"></div>'
      : '';
    var body = '';
    var lastGroup = '';
    dated.forEach(function (e) {
      if (e.group !== lastGroup) {
        lastGroup = e.group;
        body += '<div class="grow ggroup"><div class="gname">' + esc(model.groupOf(e.group).label) +
          '</div><div class="gtrack" style="width:' + width + 'px"></div></div>';
      }
      var i0 = days.indexOf(e.barStart);
      var i1 = days.indexOf(e.barEnd);
      if (i0 < 0) i0 = 0;
      if (i1 < 0) i1 = days.length - 1;
      if (i1 < i0) i1 = i0;
      var left = i0 * dw;
      var w = Math.max(dw * 0.55, (i1 - i0 + 1) * dw - 3);
      var st = statusOf(e);
      var cls = 'gbar ' + e.color + (isDone(e, st) ? ' done' : '');
      var tip = e.name + ' · ' + model.formatDate(e.barStart) + ' – ' + model.formatDate(e.barEnd);
      body += '<div class="grow"><div class="gname" title="' + esc(e.name) + '">' + esc(e.name) +
        '</div><div class="gtrack" style="width:' + width + 'px">' +
        '<div class="' + cls + '" data-key="' + esc(e.key) + '" style="left:' + left + 'px;width:' + w + 'px" title="' + esc(tip) + '"></div>' +
        '</div></div>';
    });
    host.innerHTML =
      '<div class="gantt-scroll" id="ganttScroll"><div class="gantt-sheet" style="width:' + (labelW + width) + 'px">' +
      '<div class="grow ghead"><div class="gname">งาน</div><div class="gtrack gmonths" style="width:' + width + 'px">' + head1 + '</div></div>' +
      '<div class="grow ghead ghead2"><div class="gname">วันนี้ ' + esc(model.formatDate(today)) + '</div><div class="gtrack gdays" style="width:' + width + 'px">' + head2 + '</div></div>' +
      '<div class="gbody">' + todayLine + body + '</div></div></div>';
    var sc = el('ganttScroll');
    if (!sc) return;
    if (pinToday) {
      var x = (todayIdx >= 0 ? todayIdx * dw : 0) - Math.max(120, sc.clientWidth * 0.28);
      sc.scrollLeft = Math.max(0, x);
      pinToday = false;
    } else {
      sc.scrollLeft = ganttPos.l;
      sc.scrollTop = ganttPos.t;
    }
  }

  function statusControl(entry, status) {
    if (entry.statusKind === 'service') return '<span class="pill"><i style="background:var(--st4)"></i>' + esc(status || '—') + '</span>';
    var options = entry.statusKind === 'job' && bridge.jobStatuses ? bridge.jobStatuses().slice() : model.STATUSES.slice();
    if (status && options.indexOf(status) < 0) options.push(status);
    return '<select class="stpick" data-key="' + esc(entry.key) + '" data-field="status" aria-label="สถานะ">' +
      options.map(function (s) {
        return '<option value="' + esc(s) + '"' + (s === status ? ' selected' : '') + '>' + esc(s) + '</option>';
      }).join('') + '</select>';
  }

  function renderTable(list) {
    var body = el('planBody');
    var count = el('planCount');
    if (count) {
      count.innerHTML = 'แสดง <b>' + list.length + '</b> รายการ จาก ' + shownAllCount() +
        ' · ระยะเวลาเป็นจำนวนวันปฏิทิน';
    }
    if (!body) return;
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">ไม่พบรายการตามตัวกรอง</td></tr>';
      return;
    }
    var html = '';
    var last = '';
    list.forEach(function (e) {
      if (e.group !== last) {
        last = e.group;
        html += '<tr class="plangroup"><td colspan="8">' + esc(model.groupOf(e.group).label) + '</td></tr>';
      }
      var st = statusOf(e);
      var person = personOf(e);
      var so = e.so ? '<small>' + esc(e.so) + '</small>' : '';
      var id = e.source === 'plan' ? (e.pdfId || e.planId) : e.pdfId;
      html += '<tr data-row="' + esc(e.key) + '">' +
        '<td class="so">' + esc(id) + '</td>' +
        '<td class="cust"><b>' + esc(e.name) + '</b>' + so + '</td>' +
        '<td class="so">' + (e.days ? e.days : '—') + '</td>' +
        '<td><input class="plandate" data-key="' + esc(e.key) + '" data-field="start" value="' + esc(model.formatDate(e.start)) + '" placeholder="12/11/2569" aria-label="วันเริ่ม" inputmode="numeric"></td>' +
        '<td><input class="plandate" data-key="' + esc(e.key) + '" data-field="finish" value="' + esc(model.formatDate(e.finish)) + '" placeholder="14/11/2569" aria-label="วันจบ" inputmode="numeric"></td>' +
        '<td><input class="planperson" data-key="' + esc(e.key) + '" data-field="person" value="' + esc(person === 'ยังไม่ระบุ' ? '' : person) + '" placeholder="ผู้รับผิดชอบ" aria-label="ผู้รับผิดชอบ" list="planPeople"></td>' +
        '<td>' + statusControl(e, st) + '</td>' +
        '<td class="act">' +
          (e.jobId ? '<button type="button" data-open-job="' + e.jobId + '">ใบงาน</button> ' : '') +
          (e.serviceId ? '<button type="button" data-open-svc="' + e.serviceId + '">ใบงาน</button> ' : '') +
          (e.source === 'plan' ? '<button type="button" data-edit-plan="' + e.planId + '">แก้ไข</button> ' : '') +
          '<button type="button" data-drop="' + esc(e.key) + '">เอาออก</button>' +
        '</td></tr>';
    });
    body.innerHTML = html;
    var listEl = el('planPeople');
    if (listEl && bridge.roster) {
      var names = bridge.roster().slice();
      list.forEach(function (e) {
        var n = String(personOf(e) || '').trim();
        if (n && n !== 'ยังไม่ระบุ' && names.indexOf(n) < 0) names.push(n);
      });
      listEl.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
    }
  }

  function shownAllCount() {
    return model.buildEntries(planRows, jobs(), services()).length;
  }

  function renderHint() {
    var node = el('planHint');
    if (!node) return;
    if (planMode === 'live') {
      node.innerHTML = 'แก้วันในตารางแล้วระบบบันทึกให้เอง เมื่อเครื่องนี้จำรหัสผู้ดูแลแล้ว · รายการที่ผูกใบงานจะเขียนวันเริ่มแผนและวันจบแผนลงใบงานเดียวกัน';
    } else if (!planApiOk) {
      node.textContent = 'แก้ได้ทันทีบนหน้านี้ รายการที่ยังไม่มีใบงานจะอยู่บนเครื่องนี้ก่อน จนกว่าจะอัปเดต Apps Script';
    } else {
      node.textContent = 'แก้วันในตารางได้เลย';
    }
  }

  function render() {
    if (painting) return;
    if (!el('viewPlan')) return;
    painting = true;
    try { renderNow(); }
    finally { painting = false; }
  }

  function renderNow() {
    reconcile();
    var all = model.sortEntries(model.buildEntries(planRows, jobs(), services()));
    renderPeople(all);
    var opts = filters();
    if (el('planFrom') && el('planFrom').value.trim() && !model.parseDate(el('planFrom').value)) opts.from = '';
    if (el('planTo') && el('planTo').value.trim() && !model.parseDate(el('planTo').value)) opts.to = '';
    shown = model.sortEntries(model.filterEntries(all, opts));
    renderKpis(shown);
    renderGantt(shown);
    renderTable(shown);
    renderHint();
    var week = el('planZoomWeek');
    var month = el('planZoomMonth');
    if (week) week.classList.toggle('on', zoom === 'week');
    if (month) month.classList.toggle('on', zoom === 'month');
    if (bridge.view && bridge.view() === 'plan' && bridge.refreshSave) bridge.refreshSave();
  }

  function entryByKey(key) {
    for (var i = 0; i < shown.length; i++) if (shown[i].key === key) return shown[i];
    var all = model.buildEntries(planRows, jobs(), services());
    for (var j = 0; j < all.length; j++) if (all[j].key === key) return all[j];
    return null;
  }

  function setEntryDates(entry, field, iso) {
    var start = field === 'start' ? iso : (entry.start || '');
    var finish = field === 'finish' ? iso : (entry.finish || '');
    if (start && finish && finish < start) {
      window.alert('วันจบต้องไม่ก่อนวันเริ่ม');
      render();
      return;
    }
    var item = planRows.filter(function (r) { return entry.planId && String(r.id) === String(entry.planId); })[0];
    if (item) {
      item.start = start;
      item.finish = finish;
    }
    writeRowDates(entry, start, finish);
    schedulePlanSave();
    render();
  }

  function setPerson(entry, name) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    var item = planRows.filter(function (r) { return entry.planId && String(r.id) === String(entry.planId); })[0];
    if (item) item.person = name;
    if (entry.jobId) {
      var job = jobs().filter(function (r) { return String(r.id) === String(entry.jobId); })[0];
      if (job) {
        job.eng = name || (bridge.noEng ? bridge.noEng() : 'ยังไม่ระบุ');
        if (bridge.commitJob) bridge.commitJob();
      }
    } else if (entry.serviceId) {
      var svc = services().filter(function (r) { return String(r.id) === String(entry.serviceId); })[0];
      if (svc) {
        svc.team = name;
        if (bridge.commitService && bridge.svcMode && (bridge.svcMode() === 'live' || bridge.svcMode() === 'local')) bridge.commitService();
      }
    }
    schedulePlanSave();
    render();
  }

  function setStatus(entry, status) {
    if (entry.statusKind === 'service') return;
    if (entry.jobId) {
      var job = jobs().filter(function (r) { return String(r.id) === String(entry.jobId); })[0];
      if (job && job.st !== status) {
        job.st = status;
        if (bridge.commitJob) bridge.commitJob();
      }
      return;
    }
    var item = planRows.filter(function (r) { return entry.planId && String(r.id) === String(entry.planId); })[0];
    if (item) item.status = status;
    schedulePlanSave();
    render();
  }

  function dropEntry(entry) {
    if (entry.planId) {
      var item = planRows.filter(function (r) { return String(r.id) === String(entry.planId); })[0];
      var msg = (entry.jobId || entry.serviceId)
        ? 'เอา "' + entry.name + '" ออกจากแผนงาน?\nวันในใบงานจะถูกล้าง ตัวใบงานยังอยู่'
        : 'ลบรายการ "' + entry.name + '" ออกจากแผนงาน?';
      if (!window.confirm(msg)) return;
      if (item) clearLink(item);
      planRows = planRows.filter(function (r) { return String(r.id) !== String(entry.planId); });
    } else {
      if (!window.confirm('ลบวันแผนของ "' + entry.name + '" ? ตัวใบงานยังอยู่')) return;
      writeRowDates(entry, '', '');
    }
    schedulePlanSave();
    render();
  }

  function onTableChange(e) {
    var t = e.target;
    var key = t.getAttribute('data-key');
    var field = t.getAttribute('data-field');
    if (!key || !field) return;
    var entry = entryByKey(key);
    if (!entry) return;
    if (field === 'start' || field === 'finish') {
      var raw = t.value.trim();
      if (!raw) { setEntryDates(entry, field, ''); return; }
      var iso = model.parseDate(raw);
      if (!iso) {
        t.style.outline = '2px solid var(--crit)';
        return;
      }
      t.style.outline = '';
      setEntryDates(entry, field, iso);
      return;
    }
    if (field === 'person') setPerson(entry, t.value);
    if (field === 'status') setStatus(entry, t.value);
  }

  function onTableClick(e) {
    var job = e.target.closest('[data-open-job]');
    if (job && bridge.openJob) { bridge.openJob(+job.getAttribute('data-open-job')); return; }
    var svc = e.target.closest('[data-open-svc]');
    if (svc && bridge.openService) { bridge.openService(+svc.getAttribute('data-open-svc')); return; }
    var edit = e.target.closest('[data-edit-plan]');
    if (edit) { openEditor(+edit.getAttribute('data-edit-plan')); return; }
    var drop = e.target.closest('[data-drop]');
    if (drop) {
      var entry = entryByKey(drop.getAttribute('data-drop'));
      if (entry) dropEntry(entry);
    }
  }

  function readDate(id) {
    var node = el(id);
    var raw = node ? node.value.trim() : '';
    if (!raw) return '';
    var iso = model.parseDate(raw);
    return iso || null;
  }

  function fillGroupSelect(id, value) {
    var sel = el(id);
    if (!sel) return;
    sel.innerHTML = model.GROUPS.map(function (g) {
      return '<option value="' + g.id + '"' + (g.id === value ? ' selected' : '') + '>' + esc(g.label) + '</option>';
    }).join('');
  }

  function openEditor(id) {
    editingId = id == null ? null : id;
    var item = editingId == null ? null : planRows.filter(function (r) { return String(r.id) === String(editingId); })[0];
    var box = el('planMask');
    if (!box) return;
    el('planTitle').textContent = item ? 'แก้ไขรายการแผน' : 'เพิ่มรายการแผน';
    el('planName').value = item ? item.name : '';
    fillGroupSelect('planGroupEdit', item ? item.group : ((el('planGroup') && el('planGroup').value) || 'install'));
    el('planStartEdit').value = item ? model.formatDate(item.start) : '';
    el('planFinishEdit').value = item ? model.formatDate(item.finish) : '';
    el('planPersonEdit').value = item ? (item.person || '') : '';
    el('planNote').value = item ? (item.note || '') : '';
    el('planSo').value = item ? (item.so || '') : '';
    el('planLink').value = item && item.linkTable ? item.linkTable : '';
    var statuses = model.STATUSES.slice();
    var st = item ? (item.status || model.defaultStatus(item, model.todayIso())) : 'วางแผน';
    if (statuses.indexOf(st) < 0) statuses.push(st);
    el('planStatus').innerHTML = statuses.map(function (s) {
      return '<option value="' + esc(s) + '"' + (s === st ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    var del = el('planDel');
    if (del) del.style.display = item ? '' : 'none';
    box.classList.add('on');
    setTimeout(function () { el('planName').focus(); }, 30);
  }

  function closeEditor() {
    var box = el('planMask');
    if (box) box.classList.remove('on');
    editingId = null;
  }

  function nextId() {
    var m = 10000;
    planRows.forEach(function (r) { if (+r.id > m) m = +r.id; });
    return m + 1;
  }

  function saveEditor() {
    var name = el('planName').value.trim();
    if (!name) { el('planName').focus(); return; }
    var start = readDate('planStartEdit');
    var finish = readDate('planFinishEdit');
    if (start === null || finish === null) {
      window.alert('วันที่ไม่ถูกต้อง ให้ใช้แบบ 12/11/2569');
      return;
    }
    if (start && finish && finish < start) {
      window.alert('วันจบต้องไม่ก่อนวันเริ่ม');
      return;
    }
    var prev = null;
    var item;
    if (editingId == null) {
      var id = nextId();
      item = model.normalizeItem({
        id: id, pdfId: id, name: name, group: el('planGroupEdit').value,
        start: start, finish: finish, person: el('planPersonEdit').value,
        note: el('planNote').value, so: el('planSo').value.trim(),
        linkTable: el('planLink').value, status: el('planStatus').value
      });
      planRows.push(item);
    } else {
      item = planRows.filter(function (r) { return String(r.id) === String(editingId); })[0];
      if (!item) return closeEditor();
      prev = Object.assign({}, item);
      item.name = name;
      item.group = el('planGroupEdit').value || 'install';
      item.start = start || '';
      item.finish = finish || '';
      item.person = el('planPersonEdit').value.replace(/\s+/g, ' ').trim();
      item.note = el('planNote').value.trim();
      item.so = el('planSo').value.trim();
      item.linkTable = el('planLink').value || '';
      item.status = el('planStatus').value;
      item = model.normalizeItem(item);
      var live = planRows.filter(function (r) { return String(r.id) === String(editingId); })[0];
      Object.assign(live, item);
      item = live;
    }
    if (prev && (prev.so !== item.so || prev.linkTable !== item.linkTable)) clearLink(prev);
    var linked = model.findLinked(item, jobs(), services());
    if (linked) {
      linked.row.planStart = item.start;
      linked.row.planEnd = item.finish;
      linked.row.planSet = '1';
      if (item.person) {
        if (linked.table === 'jobs') linked.row.eng = item.person;
        else linked.row.team = item.person;
      }
      if (linked.table === 'jobs') {
        if (readyJobs()) { if (bridge.commitJob) bridge.commitJob(); }
        else copyBase('jobs', linked.row);
      } else if (bridge.svcMode && (bridge.svcMode() === 'live' || bridge.svcMode() === 'local')) {
        if (readySvc()) { if (bridge.commitService) bridge.commitService(); }
        else copyBase('service', linked.row);
      }
    }
    closeEditor();
    schedulePlanSave();
    render();
  }

  function deleteEditing() {
    var item = planRows.filter(function (r) { return String(r.id) === String(editingId); })[0];
    if (!item) return closeEditor();
    if (!window.confirm('ลบรายการ "' + item.name + '" ออกจากแผนงาน?')) return;
    clearLink(item);
    planRows = planRows.filter(function (r) { return String(r.id) !== String(item.id); });
    closeEditor();
    schedulePlanSave();
    render();
  }

  function pending() {
    var n = dirty() || planNeedsUpload ? 1 : 0;
    if (readyJobs() && bridge.dirtyJobs) n += bridge.dirtyJobs();
    if (readySvc() && bridge.dirtyService) n += bridge.dirtyService();
    return n;
  }

  function updateSaveBtn() {
    var btn = el('saveBtn');
    if (!btn || !bridge.view || bridge.view() !== 'plan') return;
    if (planSaving || (bridge.busy && bridge.busy())) {
      btn.disabled = true;
      btn.classList.remove('ok');
      btn.textContent = 'กำลังบันทึก...';
      return;
    }
    var n = pending();
    btn.disabled = false;
    if (!planApiOk) {
      btn.classList.toggle('ok', !dirty());
      btn.textContent = dirty() ? 'บันทึกในเครื่อง' : 'บันทึกในเครื่องแล้ว';
    } else {
      btn.classList.toggle('ok', n === 0 && !planNeedsUpload);
      btn.textContent = n > 0 ? ('บันทึก (' + n + ')') : 'บันทึกแล้ว ✓';
    }
    paint(statusText, statusWarn || (n > 0 && planApiOk));
  }

  function schedulePlanSave() {
    writeLocal();
    if (planHold) return;
    if (!planApiOk) {
      paint('บันทึกในเครื่องนี้แล้ว ' + nowHHMM(), false);
      updateSaveBtn();
      return;
    }
    if (!bridge.getKey || !bridge.getKey()) {
      paint('ยังไม่ได้ส่งขึ้นชีต กดปุ่มเขียว บันทึก', true);
      updateSaveBtn();
      return;
    }
    clearTimeout(planTimer);
    planTimer = setTimeout(function () { savePlan(false, false); }, 1200);
  }

  async function savePlan(force, interactive) {
    if (!planApiOk || !bridge.apiPost) return;
    if (planLock) { planQueued = true; return; }
    if (!force && !dirty() && !planNeedsUpload) return;
    if (!planRows.length) {
      showBanner('ไม่มีรายการเหลืออยู่ จึงยังไม่บันทึก เพื่อกันแผนบนชีตหาย', true);
      return;
    }
    planLock = true;
    var retry = false;
    try {
      var key = bridge.ensureKey ? await bridge.ensureKey(!!interactive) : (bridge.getKey && bridge.getKey());
      if (!key) {
        if (interactive) showBanner('ยังไม่ได้บันทึก กด บันทึก แล้วใส่รหัสผู้ดูแล', true);
        paint('ยังไม่ได้ส่งขึ้นชีต', true);
        return;
      }
      planSaving = true;
      updateSaveBtn();
      paint('กำลังบันทึกแผน...', false);
      var payload = {
        key: key,
        table: 'plan',
        expect: 'plan',
        lastSaved: planRev,
        force: !!force,
        rows: planRows.map(cloneItem)
      };
      var data = null;
      try { data = await bridge.apiPost(payload); }
      catch (err) {
        showBanner('ยังบันทึกแผนไม่สำเร็จ ตรวจอินเทอร์เน็ต แล้วกด บันทึก อีกครั้ง', true);
        paint('ยังไม่ได้บันทึก', true);
        return;
      }
      if (!data || data.table !== 'plan') {
        planApiOk = false;
        planMode = 'local';
        showBanner('เซิร์ฟเวอร์ยังไม่รับแท็บ plan จึงยังไม่ส่งแผนขึ้นชีต รายการอยู่บนเครื่องนี้', true);
        paint('บันทึกในเครื่องนี้', true);
        return;
      }
      if (data.auth === false) {
        if (bridge.clearKey) bridge.clearKey();
        showBanner(data.error || 'รหัสไม่ถูกต้อง', true);
        paint('ยังไม่ได้บันทึก', true);
        retry = !!interactive;
        return;
      }
      if (data.conflict) {
        planHold = true;
        planQueued = false;
        paint('มีข้อมูลใหม่กว่าบนชีต', true);
        if (bridge.openConflict) bridge.openConflict();
        return;
      }
      if (data.saved !== true) {
        showBanner((data && data.error) || 'ยังบันทึกแผนไม่สำเร็จ', true);
        paint('ยังไม่ได้บันทึก', true);
        return;
      }
      planRev = data.lastSaved || planRev;
      planBase = planRows.map(function (r) { return Object.assign({}, cloneItem(r)); });
      planNeedsUpload = false;
      planMode = 'live';
      planHold = false;
      writeLocal();
      showBanner('');
      paint('บันทึกล่าสุด ' + nowHHMM(), false);
    } finally {
      planSaving = false;
      planLock = false;
      updateSaveBtn();
      var queued = planQueued;
      planQueued = false;
      if (queued && !planHold && (dirty() || planNeedsUpload)) schedulePlanSave();
    }
    if (retry && bridge.ensureKey) {
      var again = await bridge.ensureKey(true);
      if (again) return savePlan(force, true);
    }
  }

  async function saveAll(interactive) {
    if (readyJobs() && bridge.dirtyJobs && bridge.dirtyJobs() > 0 && bridge.saveJobs) {
      await bridge.saveJobs(!!interactive);
    }
    if (readySvc() && bridge.dirtyService && bridge.dirtyService() > 0 && bridge.saveService) {
      await bridge.saveService(!!interactive);
    }
    if (!planApiOk) {
      writeLocal();
      await loadRemote();
    }
    if (planApiOk) await savePlan(false, !!interactive);
    else if (interactive) {
      showBanner('อัปเดต Apps Script เป็นเวอร์ชันใหม่ก่อน แผนจึงจะลงชีตได้ ตอนนี้เก็บรายการไว้บนเครื่องนี้แล้ว', true);
      paint('บันทึกในเครื่องนี้แล้ว', true);
    }
    updateSaveBtn();
  }

  async function loadRemote() {
    if (!bridge.apiGet || !bridge.shared || !bridge.shared()) return;
    paint('กำลังโหลดแผน...', false);
    var data = null;
    try { data = await bridge.apiGet('plan'); }
    catch (e) { data = null; }
    var kind = model.responseKind(data);
    if (kind !== 'live') {
      planApiOk = false;
      planMode = 'local';
      planNeedsUpload = false;
      showBanner('แท็บแผนงานพร้อมใช้แล้ว รายการที่ไม่มีใบงานจะจำบนเครื่องนี้ก่อน ถ้าจะให้ทุกเครื่องใช้ร่วมกัน ให้อัปเดต Apps Script ครั้งเดียว: วางโค้ดจาก Code.gs แล้ว Deploy เป็นเวอร์ชันใหม่ (ลิงก์เดิมไม่เปลี่ยน) จากนั้นกดโหลดใหม่', false);
      paint(readLocal() ? 'ใช้รายการในเครื่องนี้' : 'แสดงแผนจากไฟล์ Project Plan 2026', false);
      render();
      return;
    }
    planApiOk = true;
    planRev = data.lastSaved || '';
    if (data.rows && data.rows.length) {
      var local = readLocal();
      var serverSig = sig(data.rows);
      if (local && serverSig === sig(seedRows()) && sig(local) !== serverSig) {
        adopt(local, planRev);
        planNeedsUpload = true;
        planMode = 'live';
        showBanner('พบการแก้ไขบนเครื่องนี้ที่ยังไม่ขึ้นชีต กำลังส่งให้', false);
        schedulePlanSave();
      } else {
        adopt(data.rows, planRev);
        planNeedsUpload = false;
        planMode = 'live';
        writeLocal();
        showBanner('');
        paint('บันทึกล่าสุดจากชีต', false);
      }
    } else {
      var cached = readLocal();
      adopt(cached || seedRows(), planRev);
      planNeedsUpload = true;
      planMode = 'live';
      if (bridge.getKey && bridge.getKey()) {
        showBanner('กำลังส่งแผนงานขึ้นชีต', false);
        schedulePlanSave();
      } else {
        showBanner('กดปุ่มเขียว บันทึก ครั้งหนึ่ง เพื่อเก็บแผนงานลงชีต', false);
        paint('ยังไม่ได้ส่งขึ้นชีต', true);
      }
    }
    render();
  }

  async function reload(force) {
    if (!force && (dirty() || planNeedsUpload) && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก โหลดใหม่จะทิ้งการแก้ไขบนหน้านี้')) return;
    planHold = false;
    if (bridge.reloadJobs) await bridge.reloadJobs();
    if (bridge.reloadService) await bridge.reloadService();
    await loadRemote();
  }

  async function exportXlsx() {
    var btn = el('xlsxBtn');
    var prev = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังเตรียมไฟล์...'; }
    try {
      if (bridge.loadSheetJS) await bridge.loadSheetJS();
      if (!root.XLSX) throw new Error('xlsx');
      var list = model.sortEntries(model.filterEntries(model.buildEntries(planRows, jobs(), services()), filters()));
      var aoa = [['รหัส', 'ชื่องาน', 'กลุ่ม', 'ระยะเวลา (วัน)', 'วันเริ่ม', 'วันจบ', 'ผู้รับผิดชอบ', 'สถานะ', 'เลข SO', 'หมายเหตุ']];
      list.forEach(function (e) {
        aoa.push([
          e.source === 'plan' ? (e.pdfId || e.planId) : e.pdfId,
          e.name,
          model.groupOf(e.group).label,
          e.days || '',
          model.formatDate(e.start),
          model.formatDate(e.finish),
          personOf(e),
          statusOf(e),
          e.so || '',
          e.note || ''
        ]);
      });
      var ws = root.XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [10, 42, 16, 14, 16, 16, 24, 18, 22, 36].map(function (w) { return { wch: w }; });
      var wb = root.XLSX.utils.book_new();
      root.XLSX.utils.book_append_sheet(wb, ws, 'แผนงาน');
      root.XLSX.writeFile(wb, 'PE_Plan_' + model.todayIso() + '.xlsx');
    } catch (err) {
      window.alert('ส่งออก Excel ไม่ได้ในตอนนี้');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prev; }
    }
  }

  function bindOnce() {
    var q = el('planQ');
    if (q) q.addEventListener('input', render);
    ['planGroup', 'planPerson', 'planFrom', 'planTo'].forEach(function (id) {
      var node = el(id);
      if (!node) return;
      node.addEventListener('change', render);
      node.addEventListener('input', function () {
        if (id === 'planFrom' || id === 'planTo') return;
        render();
      });
    });
    var clear = el('planClear');
    if (clear) clear.addEventListener('click', function () {
      if (el('planQ')) el('planQ').value = '';
      if (el('planGroup')) el('planGroup').value = '';
      if (el('planPerson')) el('planPerson').value = '';
      if (el('planFrom')) el('planFrom').value = '';
      if (el('planTo')) el('planTo').value = '';
      pinToday = true;
      render();
    });
    var body = el('planBody');
    if (body) {
      body.addEventListener('change', onTableChange);
      body.addEventListener('click', onTableClick);
    }
    var gantt = el('gantt');
    if (gantt) gantt.addEventListener('click', function (e) {
      var bar = e.target.closest('.gbar');
      if (!bar) return;
      var key = bar.getAttribute('data-key');
      var input = document.querySelector('#planBody input[data-key="' + key + '"][data-field="start"]');
      if (input) {
        input.focus();
        var row = input.closest('tr');
        if (row) row.scrollIntoView({ block: 'nearest' });
      }
    });
    var week = el('planZoomWeek');
    var month = el('planZoomMonth');
    if (week) week.addEventListener('click', function () { zoom = 'week'; pinToday = true; render(); });
    if (month) month.addEventListener('click', function () { zoom = 'month'; pinToday = true; render(); });
    var today = el('planToday');
    if (today) today.addEventListener('click', function () { pinToday = true; render(); });
    var add = el('planFormSave');
    if (add) add.addEventListener('click', saveEditor);
    var cancel = el('planFormCancel');
    if (cancel) cancel.addEventListener('click', closeEditor);
    var del = el('planDel');
    if (del) del.addEventListener('click', deleteEditing);
    var mask = el('planMask');
    if (mask) mask.addEventListener('click', function (e) { if (e.target === mask) closeEditor(); });
  }

  var booted = false;
  function init() {
    if (booted) return;
    booted = true;
    adopt(readLocal() || seedRows(), '');
    planMode = readLocal() ? 'local' : 'seed';
    bindOnce();
    render();
    if (bridge.shared && bridge.shared()) loadRemote();
  }

  root.PEPlan = {
    bind: function (next) { bridge = next || {}; },
    init: init,
    render: render,
    onJobs: function () { render(); },
    onService: function () { render(); },
    onShow: function () { pinToday = true; paint(statusText, statusWarn); render(); },
    openEditor: openEditor,
    closeEditor: closeEditor,
    afterJobSaved: function (row) { if (row) syncFromRow(row, 'jobs'); },
    afterServiceSaved: function (row) { if (row) syncFromRow(row, 'service'); },
    updateSaveBtn: updateSaveBtn,
    saveAll: saveAll,
    saveForce: function () { planHold = false; return savePlan(true, true); },
    reload: reload,
    dirty: function () { return dirty() || planNeedsUpload; },
    exportXlsx: exportXlsx,
    holdOff: function () { planHold = false; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
