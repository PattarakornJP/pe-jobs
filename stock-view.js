/* แท็บ วัสดุนอกสต๊อก — รายการวัสดุงานติดตั้งนอกสต๊อก แยกหมวดตามชีต ตัดยอดตามการเบิก แสดงคงเหลือ */
(function (root) {
  'use strict';
  var M = root.PEStockModel;
  var DATA_URL = 'data/nonstock.json';
  var PENDING_KEY = 'pe-nonstock-pending-v1';
  var CACHE_KEY = 'pe-nonstock-cache-v1';
  var bridge = {};
  var master = null;          // { categories, items, seedMoves, fileNotes }
  var serverMoves = [];
  var serverItems = [];
  var serverCats = [];
  var mm = null;              // ข้อมูลรวม: หมวดและรายการหลังทับด้วยที่แอดมินแก้
  var cur = { moves: [], items: [], cats: [] };
  var imgCache = {};
  var imgLoading = {};
  var pending = [];
  var mode = 'loading';       // loading | live | local
  var lastSaved = '';
  var lastLoad = 0;
  var flushing = false;
  var flushTimer = null;
  var retryTimer = null;
  var needKey = false;
  var statusMsg = '';
  var statusWarn = false;
  var booted = false;
  var rowsCache = [];
  var f = { cat: '', q: '', st: '', sort: 'file' };
  var histLimit = 40;
  var editing = null;         // { id, fixedItem, kind }

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtN(n) {
    var v = Math.round(n * 1000) / 1000;
    return v.toLocaleString('th-TH', { maximumFractionDigits: 3 });
  }
  function todayIso() { return M.isoDate(new Date()); }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toLocaleString('th-TH'); }
  }
  function catName(id) {
    var c = (mm && mm.allCategories || []).find(function (x) { return x.id === id; });
    return c ? c.name : id;
  }

  // ---------- รูป ----------
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  function imgTag(img, attrs) {
    if (!img) return '';
    var m = String(img).match(/^sheet:(.+)$/);
    if (!m) return '<img loading="lazy" src="' + esc(img) + '" alt="" ' + (attrs || '') + '>';
    var id = m[1];
    if (imgCache[id]) return '<img src="' + imgCache[id] + '" alt="" ' + (attrs || '') + '>';
    loadImg(id);
    return '<img src="' + BLANK + '" data-simg="' + esc(id) + '" alt="" class="loading" ' + (attrs || '') + '>';
  }
  var imgQueue = [];
  var imgActive = 0;
  function loadImg(id) {
    if (imgCache[id] || imgLoading[id] || !bridge.apiGetImg || mode !== 'live') return;
    imgLoading[id] = true;
    imgQueue.push(id);
    pumpImg();
  }
  function pumpImg() {
    while (imgActive < 3 && imgQueue.length) {
      (function (id) {
        imgActive++;
        bridge.apiGetImg(id).then(function (res) {
          if (res && res.ok && res.img && res.img.data) {
            imgCache[id] = res.img.data;
            document.querySelectorAll('img[data-simg="' + id + '"]').forEach(function (el) { el.src = res.img.data; el.classList.remove('loading'); });
          }
        }).catch(function () {}).then(function () { imgActive--; delete imgLoading[id]; pumpImg(); });
      })(imgQueue.shift());
    }
  }
  /** ย่อรูปบนเครื่องเป็น JPEG (ด้านยาวไม่เกิน 800px) ให้ data URL ไม่เกิน ~140,000 ตัวอักษร */
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        var max = 800, q = 0.8, out = '';
        for (var tries = 0; tries < 8; tries++) {
          var sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * sc));
          c.height = Math.max(1, Math.round(im.naturalHeight * sc));
          var g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(im, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', q);
          if (out.length <= 140000) break;
          if (q > 0.55) q -= 0.1; else max = Math.round(max * 0.8);
        }
        if (!out || out.length > 340000) reject(new Error('big')); else resolve(out);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('img')); };
      im.src = url;
    });
  }

  // ---------- เก็บในเครื่อง ----------
  function loadPending() {
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') || []; } catch (e) { pending = []; }
    if (!Array.isArray(pending)) pending = [];
  }
  function savePending() {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); }
    catch (e) {
      // เก็บในเครื่องไม่พอ (รูปใหญ่) เก็บเฉพาะที่ไม่ใช่รูป รูปยังอยู่ในหน่วยความจำจนกว่าจะส่งขึ้นชีต
      try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending.filter(function (op) { return op.kind !== 'img'; }))); } catch (e2) {}
    }
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rows: serverMoves, items: serverItems, cats: serverCats, lastSaved: lastSaved })); } catch (e) {}
  }
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }

  function moves() { return cur.moves; }
  function compute() {
    cur = M.applyAll({ moves: serverMoves, items: serverItems, cats: serverCats }, pending);
    pending.forEach(function (op) { if (op && op.kind === 'img' && op.op === 'upsert' && op.row) imgCache[op.row.id] = op.row.data; });
    mm = M.mergeMaster(master, cur.items, cur.cats);
    rowsCache = M.balances(mm.items, cur.moves);
    return rowsCache;
  }

  // ---------- โหลด ----------
  async function boot() {
    if (booted) return;
    booted = true;
    renderShell();
    loadPending();
    try {
      var res = await fetch(DATA_URL, { cache: 'no-store' });
      master = await res.json();
    } catch (e) {
      $('#stkRoot').innerHTML = '<div class="banner on bad">โหลดรายการวัสดุไม่ได้ ลองรีเฟรชหน้าอีกครั้ง</div>';
      return;
    }
    var cache = readCache();
    serverMoves = (cache && cache.rows) || master.seedMoves.map(M.normalizeMove);
    serverItems = (cache && cache.items) || [];
    serverCats = (cache && cache.cats) || [];
    renderAll();
    await reload();
  }

  async function reload() {
    var shared = bridge.shared ? bridge.shared() : false;
    if (!shared || !bridge.apiGet) { goLocal(); return; }
    setStatus('กำลังโหลดจากชีต…', false);
    try {
      var data = await bridge.apiGet('nonstock');
      if (data && data.ok && data.table === 'nonstock' && Array.isArray(data.rows)) {
        mode = 'live';
        serverMoves = data.rows.map(M.normalizeMove);
        serverItems = (data.items || []).map(M.normalizeItem);
        serverCats = (data.cats || []).map(M.normalizeCat);
        lastSaved = data.lastSaved || '';
        lastLoad = Date.now();
        saveCache();
        setStatus(pending.length ? ('รอส่งขึ้นชีต ' + pending.length + ' รายการ') : (lastSaved ? 'บันทึกล่าสุด ' + fmtTime(lastSaved) : 'โหลดจากชีตแล้ว'), !!pending.length);
        renderAll();
        if (pending.length) scheduleFlush(50);
        return;
      }
      if (data && data.ok === false && data.table === 'nonstock') {
        setStatus(data.error || 'โหลดจากชีตไม่สำเร็จ', true);
        renderAll();
        return;
      }
      goLocal();
    } catch (e) {
      setStatus('ต่อชีตไม่ได้ ใช้ข้อมูลล่าสุดในเครื่องนี้', true);
      if (mode === 'loading') mode = 'offline';
      renderAll();
    }
  }

  function goLocal() {
    mode = 'local';
    serverMoves = master.seedMoves.map(M.normalizeMove);
    serverItems = []; serverCats = [];
    setStatus(pending.length ? ('บันทึกไว้ในเครื่องนี้ ' + pending.length + ' รายการ') : 'ข้อมูลตามไฟล์ Excel', !!pending.length);
    renderAll();
  }

  // ---------- บันทึกอัตโนมัติ ----------
  function queue(op) {
    pending.push(op);
    savePending();
    renderAll();
    kick();
  }
  function queueOps(ops) {
    ops.forEach(function (op) { pending.push(op); });
    savePending();
    renderAll();
    kick();
  }
  function kick() {
    if (mode === 'live') {
      setStatus('กำลังบันทึก…', false);
      if (bridge.getKey && !bridge.getKey()) flush(true);
      else scheduleFlush(400);
    } else {
      setStatus('บันทึกไว้ในเครื่องนี้ ' + pending.length + ' รายการ', true);
    }
  }
  function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flush(false); }, ms);
  }
  async function flush(interactive) {
    if (mode !== 'live' || flushing || !pending.length) return;
    var key = bridge.ensureKey ? await bridge.ensureKey(!!interactive) : null;
    if (!key) {
      needKey = true;
      setStatus('ยังไม่ได้บันทึกขึ้นชีต ' + pending.length + ' รายการ', true);
      renderBanner();
      return;
    }
    needKey = false;
    flushing = true;
    var sent = pending.slice();
    setStatus('กำลังบันทึก…', false);
    try {
      var res = await bridge.apiPost({ table: 'nonstock', expect: 'nonstock', key: key, ops: sent });
      if (res && res.ok) {
        if (bridge.setKey && bridge.getKey && bridge.getKey() !== key) bridge.setKey(key);
        pending = pending.slice(sent.length);
        savePending();
        if (Array.isArray(res.rows)) serverMoves = res.rows.map(M.normalizeMove);
        if (Array.isArray(res.items)) serverItems = res.items.map(M.normalizeItem);
        if (Array.isArray(res.cats)) serverCats = res.cats.map(M.normalizeCat);
        lastSaved = res.lastSaved || lastSaved;
        saveCache();
        setStatus('บันทึกแล้ว ' + fmtTime(lastSaved), false);
      } else if (res && res.auth === false) {
        if (bridge.clearKey) bridge.clearKey();
        needKey = true;
        setStatus(res.error || 'รหัสไม่ถูกต้อง', true);
      } else {
        setStatus((res && res.error) || 'บันทึกไม่สำเร็จ จะลองใหม่อัตโนมัติ', true);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () { retryTimer = null; flush(false); }, 15000);
      }
    } catch (e) {
      setStatus('ต่อชีตไม่ได้ จะลองบันทึกใหม่อัตโนมัติ', true);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { retryTimer = null; flush(false); }, 15000);
    } finally {
      flushing = false;
      renderAll();
      if (pending.length && !needKey && mode === 'live' && !retryTimer) scheduleFlush(300);
    }
  }

  function setStatus(txt, warn) {
    statusMsg = txt; statusWarn = !!warn;
    var el = $('#stkState');
    if (!el) return;
    el.classList.toggle('warn', !!warn);
    $('#stkStateTxt').textContent = txt;
  }

  // ---------- โครงหน้า ----------
  function renderShell() {
    var host = $('#viewStock');
    if (!host || $('#stkRoot')) return;
    host.innerHTML =
      '<div id="stkRoot">' +
      '<div class="banner" id="stkBanner"></div>' +
      '<div class="stk-head"><p class="sub">ตัดยอดตามวันที่เบิก · บันทึกอัตโนมัติ <span class="saveState" id="stkState"><i></i><span id="stkStateTxt">กำลังโหลด…</span></span></p>' +
      '<div class="topbtns stk-main"><button class="primary stk-big" id="stkSlipBtn" type="button">ตั้งเบิก / เบิกของ</button>' +
      '<button id="stkAdd" type="button">รับเข้า / คืนคลัง</button>' +
      '<details class="stk-admin"><summary>แอดมิน ▾</summary><div class="stk-adminmenu">' +
      '<button id="stkNewItem" type="button">+ เพิ่มรายการวัสดุ</button>' +
      '<button id="stkCatsBtn" type="button">จัดการหมวด</button>' +
      '<button id="stkReload" type="button">โหลดใหม่</button>' +
      '<button id="stkXlsx" type="button">ส่งออก Excel</button></div></details></div></div>' +
      '<div class="stk-cats" id="stkCats"></div>' +
      '<div class="kpis stk-kpis" id="stkKpis"></div>' +
      '<section class="card"><h2 id="stkTitle">รายการวัสดุ</h2><p class="desc">เลือกหมวดด้านบน · กด <b>เบิก</b> ที่รายการเพื่อตั้งเบิก · กดชื่อเพื่อดูประวัติ · คงเหลือ = รับเข้า − เบิกใช้ + คืนคลัง</p>' +
      '<div class="toolbar stk"><input type="search" id="stkQ" class="full" placeholder="ค้นหา ชื่อ รหัส เลข SO โครงการ ผู้เบิก">' +
      '<select id="stkCat"></select>' +
      '<select id="stkSt"><option value="">ทุกสถานะ</option><option value="used">เบิกแล้ว</option><option value="low">เหลือน้อย</option><option value="zero">หมด / เบิกเกิน</option><option value="unused">ยังไม่เคยเบิก</option></select>' +
      '<select id="stkSort"><option value="file">เรียงตามไฟล์</option><option value="remainAsc">คงเหลือน้อย → มาก</option><option value="recent">เบิกล่าสุดก่อน</option><option value="usedDesc">เบิกมาก → น้อย</option><option value="name">ชื่อ ก–ฮ</option></select>' +
      '<button id="stkClear" type="button">ล้างตัวกรอง</button></div>' +
      '<p class="count" id="stkCount"></p>' +
      '<div class="tblwrap"><table class="stk-table"><thead><tr><th>#</th><th>รูป</th><th>รายการ</th><th>หน่วย</th><th class="num">รับเข้า</th><th class="num">เบิกแล้ว</th><th class="num">คงเหลือ</th><th>เบิกล่าสุด</th><th></th></tr></thead><tbody id="stkBody"></tbody></table></div>' +
      '</section>' +
      '<section class="card"><h2>ประวัติการเบิก</h2><p class="desc">เรียงวันที่ล่าสุดก่อน · ตามหมวดและคำค้นด้านบน · กด แก้ไข เพื่อแก้หรือลบ</p>' +
      '<div class="tblwrap"><table class="stk-table"><thead><tr><th>วันที่</th><th>ประเภท</th><th>รายการ</th><th class="num">จำนวน</th><th>เลขที่ SO</th><th>โครงการ</th><th>ผู้เบิก</th><th>ใบเบิก</th><th>หมายเหตุ</th><th></th></tr></thead><tbody id="stkHist"></tbody></table></div>' +
      '<div class="stk-more"><button id="stkMore" type="button" hidden>ดูเพิ่ม</button></div>' +
      '</section>' +
      '<section class="card"><details id="stkNotes"><summary><b>ข้อสังเกตจากไฟล์ Excel</b> <span class="muted" id="stkNotesN"></span></summary><ul id="stkNotesList"></ul></details></section>' +
      '</div>';

    var m = document.createElement('div');
    m.innerHTML =
      '<div class="mask" id="slipMask"><div class="modal slip" role="dialog" aria-modal="true"><h3>ใบตั้งเบิกวัสดุ</h3>' +
      '<h4 class="slip-h"><span>1</span> เลือกหมวด แล้วแตะรายการที่จะเบิก</h4>' +
      '<div class="slip-cats" id="slipCats"></div>' +
      '<input type="search" id="slipQ" class="slip-q" placeholder="ค้นหาชื่อ / รหัส เช่น งอ 90 PPR 32">' +
      '<p class="muted slip-n" id="slipResN"></p><div class="slip-res" id="slipRes"></div>' +
      '<h4 class="slip-h"><span>2</span> รายการในใบเบิก (<b id="slipN">0</b>) · ใส่จำนวน</h4><div id="slipLines"></div>' +
      '<h4 class="slip-h"><span>3</span> รายละเอียดการเบิก</h4>' +
      '<div class="fgrid slip-f">' +
      '<div class="f"><label>วันที่เบิก</label><input type="date" id="slipDate"></div>' +
      '<div class="f"><label>ผู้เบิก</label><input type="text" id="slipBy" list="slipPeople" placeholder="ชื่อผู้เบิก" autocomplete="off"></div>' +
      '<div class="f full"><label>นำไปใช้งาน (ชื่องาน / โครงการ)</label><input type="text" id="slipJob" list="slipJobs" placeholder="พิมพ์ชื่องานหรือ SO เพื่อเลือกจาก PE Jobs" autocomplete="off"></div>' +
      '<div class="f"><label>เลขที่ SO</label><input type="text" id="slipSo" placeholder="SO2611-064" autocomplete="off"></div>' +
      '<div class="f"><label>เลขที่ใบเบิก (ไม่ใส่ ระบบออกให้)</label><input type="text" id="slipDoc" placeholder="FPU04-…"></div>' +
      '<div class="f full"><label>หมายเหตุ</label><input type="text" id="slipNote"></div>' +
      '</div><p class="hint" id="slipMsg"></p>' +
      '<div class="mact slip-act"><button id="slipCancel" type="button">ยกเลิก</button><button class="primary" id="slipSave" type="button">บันทึกเบิก (ตัดสต๊อก)</button></div>' +
      '<datalist id="slipJobs"></datalist><datalist id="slipPeople"></datalist></div></div>' +
      '<div class="stk-toast" id="stkToast" role="status"></div>' +
      '<div class="mask" id="stkMask"><div class="modal" role="dialog" aria-modal="true">' +
      '<h3 id="stkMTitle">บันทึกการเบิก</h3>' +
      '<div class="fgrid">' +
      '<div class="f full" id="stkPickWrap"><label>รายการวัสดุ</label><input type="search" id="stkPickQ" placeholder="พิมพ์ชื่อหรือรหัสเพื่อค้นหา"><select id="stkPick" size="6"></select></div>' +
      '<div class="f full" id="stkFixedWrap"><label>รายการวัสดุ</label><div class="stk-fixed" id="stkFixed"></div></div>' +
      '<div class="f" id="stkNewCatWrap"><label>หมวด</label><select id="stkNewCat"></select></div>' +
      '<div class="f" id="stkNewCodeWrap"><label>รหัส/Part No.</label><input type="text" id="stkNewCode"></div>' +
      '<div class="f full" id="stkNewNameWrap"><label>ชื่อรายการ / รายละเอียด</label><input type="text" id="stkNewName"></div>' +
      '<div class="f" id="stkNewUnitWrap"><label>หน่วย</label><input type="text" id="stkNewUnit" list="stkUnits"></div>' +
      '<div class="f" id="stkTypeWrap"><label>ประเภท</label><select id="stkType"><option value="out">เบิกใช้</option><option value="ret">คืนคลัง</option><option value="in">รับเข้าเพิ่ม</option></select></div>' +
      '<div class="f"><label>วันที่</label><input type="date" id="stkDate"></div>' +
      '<div class="f"><label id="stkQtyLab">จำนวน</label><input type="number" id="stkQty" min="0" step="any" inputmode="decimal"></div>' +
      '<div class="f"><label>เลขที่ SO</label><input type="text" id="stkSo" placeholder="SO2611-064"></div>' +
      '<div class="f"><label>ผู้เบิก</label><input type="text" id="stkBy" list="stkPeople"></div>' +
      '<div class="f full"><label>โครงการ</label><input type="text" id="stkProject"></div>' +
      '<div class="f"><label>เลขที่ใบเบิก</label><input type="text" id="stkDoc" placeholder="FPU04-…"></div>' +
      '<div class="f"><label>หมายเหตุ</label><input type="text" id="stkNote"></div>' +
      '</div><p class="hint" id="stkMMsg"></p>' +
      '<div class="mact"><button class="danger left" id="stkMDel" type="button">ลบรายการนี้</button><button id="stkMCancel" type="button">ยกเลิก</button><button class="primary" id="stkMSave" type="button">บันทึก</button></div>' +
      '<datalist id="stkPeople"></datalist><datalist id="stkUnits"></datalist>' +
      '</div></div>' +
      '<div class="mask" id="stkItemMask"><div class="modal stk-item" role="dialog" aria-modal="true"><div id="stkItemBody"></div>' +
      '<div class="mact"><button class="danger left" id="stkItemDel" type="button">ลบรายการ</button><button id="stkItemEdit" type="button">แก้ไขรายการ / รูป</button><button id="stkItemClose" type="button">ปิด</button><button class="primary" id="stkItemOut" type="button">+ เบิกรายการนี้</button></div></div></div>' +
      '<div class="mask" id="stkEdMask"><div class="modal" role="dialog" aria-modal="true"><h3 id="stkEdTitle">เพิ่มรายการวัสดุ</h3>' +
      '<div class="fgrid">' +
      '<div class="f"><label>หมวด</label><select id="stkEdCat"></select></div>' +
      '<div class="f" id="stkEdNewCatWrap"><label>ชื่อหมวดใหม่</label><input type="text" id="stkEdNewCat" placeholder="เช่น ท่อเหล็ก"></div>' +
      '<div class="f"><label>รหัส/Part No.</label><input type="text" id="stkEdCode"></div>' +
      '<div class="f full"><label>ชื่อรายการ / รายละเอียด</label><input type="text" id="stkEdName"></div>' +
      '<div class="f"><label>หน่วย</label><input type="text" id="stkEdUnit" list="stkUnits"></div>' +
      '<div class="f"><label>จำนวนรับเข้า (ตั้งต้น)</label><input type="number" id="stkEdQty" min="0" step="any" inputmode="decimal"></div>' +
      '<div class="f"><label>วันที่รับเข้า</label><input type="date" id="stkEdRecv"></div>' +
      '<div class="f"><label>หมายเหตุ</label><input type="text" id="stkEdNote"></div>' +
      '<div class="f full"><label>รูปวัสดุ</label><div class="stk-imgedit"><div class="stk-imgprev" id="stkEdPrev"></div>' +
      '<div class="stk-imgbtns"><label class="stk-filebtn">เลือกรูป / ถ่ายรูป<input type="file" id="stkEdFile" accept="image/*"></label>' +
      '<button type="button" id="stkEdImgDel">เอารูปออก</button><small class="muted">ระบบย่อรูปให้อัตโนมัติก่อนบันทึก</small></div></div></div>' +
      '</div><p class="hint" id="stkEdMsg"></p>' +
      '<div class="mact"><button class="danger left" id="stkEdDel" type="button">ลบรายการนี้</button><button id="stkEdCancel" type="button">ยกเลิก</button><button class="primary" id="stkEdSave" type="button">บันทึก</button></div>' +
      '</div></div>' +
      '<div class="mask" id="stkCatMask"><div class="modal" role="dialog" aria-modal="true"><h3>จัดการหมวด</h3>' +
      '<p class="desc">แก้ชื่อหมวดแล้วกดนอกช่อง ระบบบันทึกให้เอง · ลบหมวดได้เมื่อไม่มีรายการเหลือในหมวด</p>' +
      '<div class="rlist" id="stkCatList"></div>' +
      '<div class="radd" style="margin-top:12px"><input type="text" id="stkCatNew" placeholder="ชื่อหมวดใหม่"><button class="primary" type="button" id="stkCatAdd">+ เพิ่มหมวด</button></div>' +
      '<div id="stkTrash"></div>' +
      '<div class="mact"><button id="stkCatClose" type="button">ปิด</button></div></div></div>';
    while (m.firstChild) document.body.appendChild(m.firstChild);
    bindShell();
  }

  function bindShell() {
    $('#stkAdd').addEventListener('click', function () { openForm(null, null, 'move'); $('#stkType').value = 'in'; });
    bindSlip();
    $('#stkNewItem').addEventListener('click', function () { openEditor(null); });
    $('#stkCatsBtn').addEventListener('click', openCats);
    $('#stkEdCat').addEventListener('change', function () { show('#stkEdNewCatWrap', $('#stkEdCat').value === '__new'); if ($('#stkEdCat').value === '__new') $('#stkEdNewCat').focus(); });
    $('#stkEdFile').addEventListener('change', pickImage);
    $('#stkEdImgDel').addEventListener('click', function () { edImg = { data: '', removed: true }; paintEdImg(); });
    $('#stkEdCancel').addEventListener('click', closeEditor);
    $('#stkEdSave').addEventListener('click', saveEditor);
    $('#stkEdDel').addEventListener('click', function () { if (edId) deleteItem(edId, closeEditor); });
    $('#stkEdMask').addEventListener('click', function (e) { if (e.target.id === 'stkEdMask') closeEditor(); });
    $('#stkItemEdit').addEventListener('click', function () { var id = $('#stkItemMask').dataset.item; closeItem(); openEditor(id); });
    $('#stkItemDel').addEventListener('click', function () { var id = $('#stkItemMask').dataset.item; deleteItem(id, closeItem); });
    $('#stkCatClose').addEventListener('click', closeCats);
    $('#stkCatAdd').addEventListener('click', addCat);
    $('#stkCatNew').addEventListener('keydown', function (e) { if (e.key === 'Enter') addCat(); });
    $('#stkCatList').addEventListener('change', function (e) {
      var inp = e.target.closest('input[data-rename]');
      if (inp) renameCat(inp.dataset.rename, inp.value);
    });
    $('#stkCatMask').addEventListener('click', function (e) {
      if (e.target.id === 'stkCatMask') { closeCats(); return; }
      var b = e.target.closest('button[data-catdel],button[data-catup],button[data-restore],button[data-catrestore]');
      if (!b) return;
      if (b.dataset.catdel) deleteCat(b.dataset.catdel);
      else if (b.dataset.catup) moveCat(b.dataset.catup);
      else if (b.dataset.restore) restoreItem(b.dataset.restore);
      else if (b.dataset.catrestore) restoreCat(b.dataset.catrestore);
    });
    $('#stkReload').addEventListener('click', function () { reload(); });
    $('#stkXlsx').addEventListener('click', exportXlsx);
    $('#stkQ').addEventListener('input', function (e) { f.q = e.target.value; histLimit = 40; renderTable(); renderHist(); });
    $('#stkCat').addEventListener('change', function (e) { f.cat = e.target.value; histLimit = 40; renderAll(); });
    $('#stkSt').addEventListener('change', function (e) { f.st = e.target.value; renderTable(); });
    $('#stkSort').addEventListener('change', function (e) { f.sort = e.target.value; renderTable(); });
    $('#stkClear').addEventListener('click', function () { f = { cat: '', q: '', st: '', sort: 'file' }; $('#stkQ').value = ''; renderAll(); });
    $('#stkMore').addEventListener('click', function () { histLimit += 60; renderHist(); });
    $('#stkCats').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]');
      if (!b) return;
      f.cat = b.dataset.cat; histLimit = 40; renderAll();
    });
    $('#stkKpis').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-st]');
      if (!b) return;
      f.st = f.st === b.dataset.st ? '' : b.dataset.st; renderAll();
    });
    $('#stkBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-out]');
      if (b) { openSlip(b.dataset.out); return; }
      var ed = e.target.closest('[data-editem]');
      if (ed) { openEditor(ed.dataset.editem); return; }
      var ei = e.target.closest('[data-editimg]');
      if (ei) { openEditor(ei.dataset.editimg, true); return; }
      var v = e.target.closest('[data-item]');
      if (v) openItem(v.dataset.item);
    });
    $('#stkHist').addEventListener('click', function (e) {
      var b = e.target.closest('[data-edit]');
      if (b) { openForm(b.dataset.edit, null, 'move'); return; }
      var v = e.target.closest('[data-item]');
      if (v) openItem(v.dataset.item);
    });
    $('#stkBanner').addEventListener('click', function (e) {
      if (e.target.closest('[data-key]')) flush(true);
    });
    $('#stkPickQ').addEventListener('input', fillPick);
    $('#stkPick').addEventListener('change', paintPickInfo);
    $('#stkType').addEventListener('change', paintPickInfo);
    $('#stkMCancel').addEventListener('click', closeForm);
    $('#stkMSave').addEventListener('click', saveForm);
    $('#stkMDel').addEventListener('click', deleteFromForm);
    $('#stkMask').addEventListener('click', function (e) { if (e.target.id === 'stkMask') closeForm(); });
    $('#stkItemMask').addEventListener('click', function (e) {
      if (e.target.id === 'stkItemMask') closeItem();
      var ei = e.target.closest('[data-editimg]');
      if (ei) { closeItem(); openEditor(ei.dataset.editimg, true); return; }
      var b = e.target.closest('[data-edit]');
      if (b) { closeItem(); openForm(b.dataset.edit, null, 'move'); }
    });
    $('#stkItemClose').addEventListener('click', closeItem);
    $('#stkItemOut').addEventListener('click', function () { var id = $('#stkItemMask').dataset.item; closeItem(); openSlip(id); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('#slipMask').classList.contains('on')) { closeSlip(); return; }
      if ($('#stkEdMask').classList.contains('on')) closeEditor();
      else if ($('#stkCatMask').classList.contains('on')) closeCats();
      else if ($('#stkMask').classList.contains('on')) closeForm();
      else if ($('#stkItemMask').classList.contains('on')) closeItem();
    });
  }

  // ---------- วาด ----------

  // ---------- ใบตั้งเบิก (หลายรายการในใบเดียว) ----------
  var BY_KEY = 'pe-jobs-stock-by';
  var slip = null;
  function rowOf(id) { return rowsCache.find(function (x) { return x.item.id === id; }); }
  function jobOptions() {
    var seen = {}, out = [];
    function add(so, name) {
      so = String(so || '').trim(); name = String(name || '').trim();
      if (!so && !name) return;
      var v = so && name ? so + ' · ' + name : (so || name);
      if (seen[v]) return; seen[v] = 1; out.push(v);
    }
    try { (bridge.jobs ? bridge.jobs() : []).forEach(function (j) { add(j.so, j.proj || j.comp); }); } catch (e) {}
    moves().slice().reverse().forEach(function (m) { if (m.type === 'out') add(m.so, m.project); });
    return out;
  }
  function peopleList() {
    var p = {};
    try { (bridge.roster ? bridge.roster() : []).forEach(function (n) { if (n) p[n] = 1; }); } catch (e) {}
    moves().forEach(function (m) { if (m.by) m.by.split(' / ').forEach(function (n) { if (n) p[n] = 1; }); });
    return Object.keys(p).sort(function (a, b) { return a.localeCompare(b, 'th'); });
  }
  function openSlip(itemId) {
    if (!master) return;
    slip = { cat: itemId ? '' : (f.cat || ''), q: '', lines: [] };
    $('#slipDate').value = todayIso();
    var by = ''; try { by = localStorage.getItem(BY_KEY) || ''; } catch (e) {}
    $('#slipBy').value = by;
    ['#slipJob', '#slipSo', '#slipDoc', '#slipNote', '#slipQ'].forEach(function (s) { $(s).value = ''; });
    $('#slipJobs').innerHTML = jobOptions().map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    $('#slipPeople').innerHTML = peopleList().map(function (v) { return '<option value="' + esc(v) + '">'; }).join('');
    $('#slipMsg').textContent = '';
    if (itemId) addLine(itemId, true);
    paintSlip();
    $('#slipMask').classList.add('on');
    if (!itemId) setTimeout(function () { $('#slipQ').focus(); }, 30);
  }
  function closeSlip() { $('#slipMask').classList.remove('on'); slip = null; }
  function addLine(id, silent) {
    var ln = slip.lines.find(function (l) { return l.itemId === id; });
    if (ln) ln.qty = (M.num(ln.qty) || 0) + 1;
    else slip.lines.push({ itemId: id, qty: 1 });
    if (!silent) { paintLines(); paintRes(); }
  }
  function paintSlip() {
    var cats = [{ id: '', name: 'ทุกหมวด' }].concat(mm.categories);
    $('#slipCats').innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip' + (slip.cat === c.id ? ' on' : '') + '" data-scat="' + c.id + '">' + esc(c.name) + '</button>';
    }).join('');
    paintRes(); paintLines();
  }
  function paintRes() {
    var q = slip.q.trim().toLowerCase(), terms = q.split(/\s+/).filter(Boolean).map(function (t) { return t.length > 4 && t.indexOf('ข้อ') === 0 ? t.slice(3) : t; });
    var list = rowsCache.filter(function (r) {
      if (slip.cat && r.item.cat !== slip.cat) return false;
      if (!terms.length) return true;
      var hay = (r.item.name + ' ' + r.item.code).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    });
    var inSlip = {}; slip.lines.forEach(function (l) { inSlip[l.itemId] = l.qty; });
    if (terms.length) {
      var score = function (r) { var nm = r.item.name.toLowerCase(); return terms.filter(function (t) { return nm.indexOf(t) >= 0; }).length; };
      list = list.map(function (r, i) { return { r: r, s: score(r), i: i }; }).sort(function (a, b) { return b.s - a.s || a.i - b.i; }).map(function (x) { return x.r; });
    }
    var shown = list.slice(0, 60);
    $('#slipResN').textContent = list.length > shown.length ? 'แสดง ' + shown.length + ' จาก ' + list.length + ' รายการ · พิมพ์ค้นหาเพื่อกรอง' : list.length + ' รายการ';
    $('#slipRes').innerHTML = shown.length ? shown.map(function (r) {
      var it = r.item;
      return '<button type="button" class="slip-card st-' + r.status + (inSlip[it.id] ? ' picked' : '') + '" data-sadd="' + esc(it.id) + '">' +
        '<span class="th">' + (it.img ? imgTag(it.img, '') : '<span class="noimg">ไม่มีรูป</span>') + '</span>' +
        '<span class="tx"><b>' + esc(it.name) + '</b><small>' + (it.code ? esc(it.code) + ' · ' : '') + esc(catName(it.cat)) + '</small>' +
        '<span class="bal">คงเหลือ <b>' + fmtN(r.remain) + '</b> ' + esc(it.unit || '') + '</span></span>' +
        '<span class="add">' + (inSlip[it.id] ? '✓ ' + fmtN(M.num(inSlip[it.id])) : '+ เบิก') + '</span></button>';
    }).join('') : '<p class="empty">ไม่พบรายการ</p>';
    pumpImg();
  }
  function paintLines() {
    $('#slipN').textContent = slip.lines.length;
    $('#slipLines').innerHTML = slip.lines.length ? slip.lines.map(function (l, i) {
      var r = rowOf(l.itemId); if (!r) return '';
      var it = r.item, q = M.num(l.qty), over = q > r.remain;
      return '<div class="slip-line' + (over ? ' over' : '') + '">' +
        '<span class="th">' + (it.img ? imgTag(it.img, '') : '<span class="noimg">–</span>') + '</span>' +
        '<span class="tx"><b>' + esc(it.name) + '</b><small>คงเหลือ ' + fmtN(r.remain) + ' ' + esc(it.unit || '') + (q > 0 ? ' → หลังเบิก <b>' + fmtN(r.remain - q) + '</b>' : '') + (over ? ' · เกินคงเหลือ' : '') + '</small></span>' +
        '<span class="qty"><button type="button" data-sminus="' + i + '" aria-label="ลด">−</button>' +
        '<input type="number" inputmode="decimal" min="0" step="any" data-sqty="' + i + '" value="' + esc(l.qty) + '">' +
        '<button type="button" data-splus="' + i + '" aria-label="เพิ่ม">+</button><em>' + esc(it.unit || '') + '</em></span>' +
        '<button type="button" class="rm" data-srm="' + i + '" aria-label="เอาออก">×</button></div>';
    }).join('') : '<p class="empty">ยังไม่มีรายการ แตะรายการด้านบนเพื่อเพิ่มลงใบเบิก</p>';
    $('#slipSave').textContent = slip.lines.length ? 'บันทึกเบิก ' + slip.lines.length + ' รายการ (ตัดสต๊อก)' : 'บันทึกเบิก (ตัดสต๊อก)';
    pumpImg();
  }
  function splitJob(v) {
    var m = String(v || '').match(/^\s*(SO[\w-]+)\s*·\s*(.*)$/i);
    return m ? { so: m[1], project: m[2].trim() } : null;
  }
  function slipBad(el, msg) {
    $('#slipMsg').textContent = msg;
    if (el) { el.classList.add('bad'); el.focus(); setTimeout(function () { el.classList.remove('bad'); }, 2500); }
  }
  function saveSlip() {
    if (!slip) return;
    if (!slip.lines.length) return slipBad($('#slipQ'), 'เลือกรายการที่จะเบิกอย่างน้อย 1 รายการ');
    for (var i = 0; i < slip.lines.length; i++) {
      if (!(M.num(slip.lines[i].qty) > 0)) return slipBad($('[data-sqty="' + i + '"]'), 'ใส่จำนวนเบิกให้ครบ (มากกว่า 0)');
    }
    var date = $('#slipDate').value;
    if (!date) return slipBad($('#slipDate'), 'ใส่วันที่เบิก');
    var job = $('#slipJob').value.trim(), so = $('#slipSo').value.trim();
    var sp = splitJob(job); if (sp) { job = sp.project; if (!so) so = sp.so; }
    if (!job && !so) return slipBad($('#slipJob'), 'ระบุงานที่นำไปใช้ หรือเลขที่ SO');
    var by = $('#slipBy').value.trim();
    if (!by) return slipBad($('#slipBy'), 'ใส่ชื่อผู้เบิก');
    var over = slip.lines.filter(function (l) { var r = rowOf(l.itemId); return r && M.num(l.qty) > r.remain; });
    if (over.length && !confirm('มี ' + over.length + ' รายการที่เบิกเกินคงเหลือ ยอดจะติดลบ ยืนยันบันทึกหรือไม่?')) return;
    var doc = $('#slipDoc').value.trim();
    if (!doc) { var d = new Date(); doc = 'W' + date.slice(2).replace(/-/g, '') + '-' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2) + ('0' + d.getSeconds()).slice(-2); }
    var note = $('#slipNote').value.trim();
    try { localStorage.setItem(BY_KEY, by); } catch (e) {}
    var ops = slip.lines.map(function (l) {
      var it = rowOf(l.itemId).item;
      return { op: 'upsert', row: M.normalizeMove({ id: M.newId('w'), itemId: it.id, type: 'out', cat: it.cat, code: it.code, name: it.name, unit: it.unit,
        date: date, qty: M.num(l.qty), so: so, project: job, by: by, doc: doc, note: note, src: 'web' }) };
    });
    var n = ops.length;
    closeSlip();
    queueOps(ops);
    toast('บันทึกใบเบิก ' + doc + ' แล้ว ' + n + ' รายการ ตัดสต๊อกเรียบร้อย');
  }
  var toastTimer = null;
  function toast(msg) {
    var t = $('#stkToast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 3500);
  }
  function bindSlip() {
    $('#stkSlipBtn').addEventListener('click', function () { openSlip(null); });
    $('#slipCancel').addEventListener('click', closeSlip);
    $('#slipSave').addEventListener('click', saveSlip);
    $('#slipMask').addEventListener('click', function (e) {
      if (e.target.id === 'slipMask') { closeSlip(); return; }
      var b;
      if ((b = e.target.closest('[data-scat]'))) { slip.cat = b.dataset.scat; paintSlip(); return; }
      if ((b = e.target.closest('[data-sadd]'))) { addLine(b.dataset.sadd); return; }
      if ((b = e.target.closest('[data-splus]'))) { var l = slip.lines[+b.dataset.splus]; l.qty = (M.num(l.qty) || 0) + 1; paintLines(); paintRes(); return; }
      if ((b = e.target.closest('[data-sminus]'))) { var l2 = slip.lines[+b.dataset.sminus]; l2.qty = Math.max(0, (M.num(l2.qty) || 0) - 1); paintLines(); paintRes(); return; }
      if ((b = e.target.closest('[data-srm]'))) { slip.lines.splice(+b.dataset.srm, 1); paintLines(); paintRes(); return; }
    });
    $('#slipLines').addEventListener('change', function (e) {
      var inp = e.target.closest('[data-sqty]'); if (!inp) return;
      slip.lines[+inp.dataset.sqty].qty = inp.value; paintLines(); paintRes();
    });
    $('#slipQ').addEventListener('input', function (e) { slip.q = e.target.value; paintRes(); });
    $('#slipJob').addEventListener('change', function () {
      var sp = splitJob($('#slipJob').value);
      if (sp) { $('#slipJob').value = sp.project; if (!$('#slipSo').value.trim()) $('#slipSo').value = sp.so; }
    });
  }

  function renderAll() {
    if (!master || !$('#stkRoot')) return;
    compute();
    renderBanner();
    renderKpis();
    renderCats();
    renderFilters();
    renderTable();
    renderHist();
    renderNotes();
    setStatus(statusMsg || 'พร้อมใช้งาน', statusWarn);
  }

  function renderBanner() {
    var el = $('#stkBanner');
    if (!el) return;
    var html = '', bad = false;
    if (mode === 'local') {
      html = 'ตอนนี้แสดงยอดตามไฟล์ Excel · ชีตกลางยังไม่เปิดรับข้อมูลวัสดุนอกสต๊อก (ต้องอัปเดต Apps Script ตาม SETUP.md) การเบิกที่บันทึกตอนนี้<b>เก็บไว้ในเครื่องนี้ก่อน</b> แล้วจะส่งขึ้นชีตให้เองเมื่อพร้อม';
    } else if (mode === 'offline') {
      html = 'ต่อชีตไม่ได้ในตอนนี้ แสดงข้อมูลล่าสุดที่เครื่องนี้เคยโหลด';
      bad = true;
    } else if (mode === 'live' && needKey && pending.length) {
      html = 'มีการเบิก ' + pending.length + ' รายการที่ยังไม่ได้บันทึกขึ้นชีต <button type="button" data-key="1">ใส่รหัสแล้วบันทึก</button>';
      bad = true;
    }
    el.innerHTML = html;
    el.classList.toggle('on', !!html);
    el.classList.toggle('bad', bad);
  }

  function filtered(rows) {
    var q = f.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (f.cat && r.item.cat !== f.cat) return false;
      if (f.st === 'used' && !(r.out > 0)) return false;
      if (f.st === 'low' && r.status !== 'low') return false;
      if (f.st === 'zero' && r.status !== 'zero' && r.status !== 'over') return false;
      if (f.st === 'unused' && r.out > 0) return false;
      if (!q) return true;
      var hay = [r.item.name, r.item.code, r.item.note, r.item.unit].join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) return true;
      return r.moves.some(function (m) { return [m.so, m.project, m.by, m.doc, m.note].join(' ').toLowerCase().indexOf(q) >= 0; });
    });
  }

  function renderKpis() {
    var rows = f.cat ? rowsCache.filter(function (r) { return r.item.cat === f.cat; }) : rowsCache;
    var used = rows.filter(function (r) { return r.out > 0; }).length;
    var low = rows.filter(function (r) { return r.status === 'low'; }).length;
    var zero = rows.filter(function (r) { return r.status === 'zero' || r.status === 'over'; }).length;
    var outs = [];
    rows.forEach(function (r) { r.moves.forEach(function (m) { if (m.type === 'out') outs.push(m); }); });
    var last = outs.reduce(function (a, m) { return m.date > a ? m.date : a; }, '');
    function k(lab, val, sm, st, cls) {
      return '<button type="button" class="kpi ' + (cls || '') + (st && f.st === st ? ' on' : '') + '" ' + (st ? 'data-st="' + st + '"' : 'data-st=""') + '><div class="lab">' + lab + '</div><div class="val">' + val + '</div><div class="sm">' + sm + '</div></button>';
    }
    $('#stkKpis').innerHTML =
      k('รายการวัสดุ', rows.length, f.cat ? catName(f.cat) : 'ทุกหมวด ' + mm.categories.length + ' หมวด', '') +
      k('เบิกแล้ว', used, 'รายการที่มีการเบิก', 'used') +
      k('เหลือน้อย', low, 'คงเหลือ ≤ 20% ของรับเข้า', 'low', low ? 'flag' : '') +
      k('หมดแล้ว', zero, 'คงเหลือ 0 หรือเบิกเกิน', 'zero', zero ? 'crit' : '') +
      k('ครั้งที่เบิก', outs.length, last ? 'ล่าสุด ' + M.thaiDate(last) : 'ยังไม่มีการเบิก', '');
  }

  function renderCats() {
    var sums = M.summarize(rowsCache, mm.categories);
    var all = { items: rowsCache.length, touched: 0, low: 0, zero: 0, moves: 0 };
    sums.forEach(function (s) { all.touched += s.touched; all.low += s.low; all.zero += s.zero; all.moves += s.moves; });
    function card(id, name, s) {
      return '<button type="button" class="stk-cat' + (f.cat === id ? ' on' : '') + '" data-cat="' + id + '">' +
        '<span class="nm">' + esc(name) + '</span><span class="big">' + s.items + ' <small>รายการ</small></span>' +
        '<span class="sm">เบิกแล้ว ' + s.touched + ' · เบิก ' + s.moves + ' ครั้ง</span>' +
        '<span class="tags">' + (s.zero ? '<i class="tg zero">หมด ' + s.zero + '</i>' : '') + (s.low ? '<i class="tg low">เหลือน้อย ' + s.low + '</i>' : '') + (!s.zero && !s.low ? '<i class="tg ok">ปกติ</i>' : '') + '</span></button>';
    }
    $('#stkCats').innerHTML = card('', 'ทุกหมวด', all) + sums.map(function (s) { return card(s.id, s.name, s); }).join('');
  }

  function renderFilters() {
    var sel = $('#stkCat');
    sel.innerHTML = '<option value="">ทุกหมวด</option>' + mm.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    sel.value = f.cat;
    $('#stkSt').value = f.st;
    $('#stkSort').value = f.sort;
    $('#stkTitle').textContent = f.cat ? 'รายการวัสดุ — ' + catName(f.cat) : 'รายการวัสดุทุกหมวด';
  }

  var ST_LABEL = { ok: '', low: 'เหลือน้อย', zero: 'หมด', over: 'เบิกเกิน' };
  function remainCell(r) {
    var pct = r.total > 0 ? Math.max(0, Math.min(100, r.remain / r.total * 100)) : 0;
    return '<td class="num rem ' + r.status + '"><b>' + fmtN(r.remain) + '</b>' + (ST_LABEL[r.status] ? ' <i class="tg ' + r.status + '">' + ST_LABEL[r.status] + '</i>' : '') +
      '<span class="rbar"><span style="width:' + pct.toFixed(1) + '%"></span></span></td>';
  }
  function hl(text) {
    var t = String(text || ''), q = f.q.trim();
    if (!q) return esc(t);
    var i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
  }

  function renderTable() {
    var rows = filtered(rowsCache);
    var order = {};
    mm.categories.forEach(function (c, i) { order[c.id] = i; });
    var s = f.sort;
    rows.sort(function (a, b) {
      if (s === 'remainAsc') return (a.total ? a.remain / a.total : 0) - (b.total ? b.remain / b.total : 0) || a.remain - b.remain;
      if (s === 'recent') return (b.lastOut || '').localeCompare(a.lastOut || '');
      if (s === 'usedDesc') return b.out - a.out;
      if (s === 'name') return a.item.name.localeCompare(b.item.name, 'th');
      return (order[a.item.cat] - order[b.item.cat]) || ((a.item.row || 1e9) - (b.item.row || 1e9));
    });
    $('#stkCount').innerHTML = 'แสดง <b>' + rows.length + '</b> จาก ' + rowsCache.length + ' รายการ';
    if (!rows.length) { $('#stkBody').innerHTML = '<tr><td colspan="9" class="empty">ไม่พบรายการตามตัวกรอง</td></tr>'; return; }
    var lastCat = null;
    $('#stkBody').innerHTML = rows.map(function (r, i) {
      var it = r.item, head = '';
      if (!f.cat && s === 'file' && it.cat !== lastCat) {
        lastCat = it.cat;
        head = '<tr class="plangroup"><td colspan="9">' + esc(catName(it.cat)) + '</td></tr>';
      }
      return head + '<tr class="st-' + r.status + '">' +
        '<td class="muted">' + (it.no || (i + 1)) + '</td>' +
        '<td class="img">' + (it.img ? imgTag(it.img, 'data-item="' + esc(it.id) + '" title="กดเพื่อดูรายละเอียด / เปลี่ยนรูป"') + (it.imgSrc === 'web' || it.imgSrc === 'similar' ? '<i class="webimg" title="รูปตัวอย่างจากเว็บ โปรดตรวจ">ตัวอย่าง</i>' : '') : '<button type="button" class="stk-addimg" data-editimg="' + esc(it.id) + '">+ รูป</button>') + '</td>' +
        '<td class="nm"><button type="button" class="textbtn" data-item="' + esc(it.id) + '">' + hl(it.name) + '</button>' +
        '<small>' + (it.code ? hl(it.code) + ' · ' : '') + (f.cat ? '' : esc(catName(it.cat)) + ' · ') + (it.recv ? 'รับ ' + M.thaiDate(it.recv) : '') + (it.added ? ' · เพิ่มจากเว็บ' : '') + (it.note ? ' · ' + esc(it.note) : '') + '</small></td>' +
        '<td>' + esc(it.unit) + '</td>' +
        '<td class="num">' + fmtN(r.total) + '</td>' +
        '<td class="num">' + (r.used ? fmtN(r.used) : '<span class="muted">–</span>') + '</td>' +
        remainCell(r) +
        '<td class="dt">' + (r.lastOut ? M.thaiDate(r.lastOut) : '<span class="muted">–</span>') + '</td>' +
        '<td class="act"><button type="button" class="primary" data-out="' + esc(it.id) + '">เบิก</button> <button type="button" class="ghost" data-editem="' + esc(it.id) + '" title="แก้ไขรายการ / รูป">แก้ไข</button></td></tr>';
    }).join('');
  }

  function histRows() {
    var q = f.q.trim().toLowerCase();
    var byId = {};
    rowsCache.forEach(function (r) { byId[r.item.id] = r.item; });
    var list = moves().filter(function (m) {
      var it = byId[m.itemId];
      if (!it) return false;
      if (f.cat && it.cat !== f.cat) return false;
      if (!q) return true;
      return [it.name, it.code, m.so, m.project, m.by, m.doc, m.note].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    list.sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''); });
    return { list: list, byId: byId };
  }

  function renderHist() {
    var h = histRows();
    var pend = {};
    pending.forEach(function (op) { if (op.op === 'upsert' && op.row) pend[op.row.id] = 1; });
    if (!h.list.length) { $('#stkHist').innerHTML = '<tr><td colspan="10" class="empty">ยังไม่มีประวัติการเบิก</td></tr>'; $('#stkMore').hidden = true; return; }
    $('#stkHist').innerHTML = h.list.slice(0, histLimit).map(function (m) {
      var it = h.byId[m.itemId];
      var t = M.TYPES[m.type] || M.TYPES.out;
      return '<tr><td class="dt">' + M.thaiDate(m.date) + '</td>' +
        '<td><i class="tg mv-' + m.type + '">' + t.label + '</i></td>' +
        '<td class="nm"><button type="button" class="textbtn" data-item="' + esc(it.id) + '">' + esc(it.name) + '</button><small>' + esc(catName(it.cat)) + '</small></td>' +
        '<td class="num"><b>' + (t.sign < 0 ? '−' : '+') + fmtN(m.qty) + '</b> ' + esc(it.unit) + '</td>' +
        '<td class="so">' + esc(m.so) + '</td><td class="work">' + esc(m.project) + '</td><td>' + esc(m.by) + '</td><td>' + esc(m.doc) + '</td>' +
        '<td class="work">' + esc(m.note) + (pend[m.id] ? ' <i class="tg low">รอส่ง</i>' : '') + '</td>' +
        '<td class="act"><button type="button" data-edit="' + esc(m.id) + '">แก้ไข</button></td></tr>';
    }).join('');
    $('#stkMore').hidden = h.list.length <= histLimit;
  }

  function renderNotes() {
    var notes = master.fileNotes || [];
    $('#stkNotesN').textContent = notes.length ? '(' + notes.length + ' ข้อ)' : '';
    $('#stkNotesList').innerHTML = notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
  }

  // ---------- รายละเอียดรายการ ----------
  function openItem(id) {
    var r = rowsCache.find(function (x) { return x.item.id === id; });
    if (!r) return;
    var it = r.item;
    $('#stkItemMask').dataset.item = id;
    $('#stkItemBody').innerHTML =
      '<div class="stk-ihead"><div class="stk-iimg">' + (it.img ? imgTag(it.img, '') : '<div class="stk-noimg">ยังไม่มีรูป</div>') +
      '<button type="button" class="stk-chgimg" data-editimg="' + esc(it.id) + '">' + (it.img ? 'เปลี่ยนรูป' : '+ ใส่รูป') + '</button>' +
      (it.imgSrc === 'web' || it.imgSrc === 'similar' ? '<small class="warnline">รูปตัวอย่างจากเว็บ โปรดตรวจว่าตรงรุ่น</small>' : '') + '</div>' +
      '<div><h3>' + esc(it.name) + '</h3><p class="desc">' + esc(catName(it.cat)) + (it.code ? ' · รหัส ' + esc(it.code) : '') + ' · หน่วย ' + esc(it.unit) + (it.recv ? ' · รับเข้า ' + M.thaiDate(it.recv) : '') + (it.note ? ' · ' + esc(it.note) : '') + '</p>' +
      '<div class="stk-nums"><span>รับเข้า<b>' + fmtN(r.total) + '</b></span><span>เบิกแล้ว<b>' + fmtN(r.used) + '</b></span><span class="rem ' + r.status + '">คงเหลือ<b>' + fmtN(r.remain) + '</b></span></div></div></div>' +
      '<h4>ประวัติการเบิก</h4>' +
      (r.moves.length ? '<div class="rlist">' + r.moves.map(function (m) {
        var t = M.TYPES[m.type] || M.TYPES.out;
        return '<div class="rrow"><span class="cnt">' + M.thaiDate(m.date) + '</span><i class="tg mv-' + m.type + '">' + t.label + '</i>' +
          '<span class="nm">' + (t.sign < 0 ? '−' : '+') + fmtN(m.qty) + ' ' + esc(it.unit) + (m.so ? ' · ' + esc(m.so) : '') + (m.project ? ' · ' + esc(m.project) : '') +
          '<small class="muted">' + [m.by, m.doc, m.note].filter(Boolean).map(esc).join(' · ') + '</small></span>' +
          '<span class="ops"><button type="button" data-edit="' + esc(m.id) + '">แก้ไข</button></span></div>';
      }).join('') + '</div>' : '<p class="muted">ยังไม่มีการเบิก</p>');
    $('#stkItemMask').classList.add('on');
  }
  function closeItem() { $('#stkItemMask').classList.remove('on'); }

  // ---------- ฟอร์มเบิก ----------
  function fillPick() {
    var q = $('#stkPickQ').value.trim().toLowerCase();
    var sel = $('#stkPick');
    var keep = sel.value;
    var list = rowsCache.filter(function (r) {
      if (!q) return !f.cat || r.item.cat === f.cat;
      return (r.item.name + ' ' + r.item.code).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 300);
    sel.innerHTML = list.map(function (r) {
      return '<option value="' + esc(r.item.id) + '">' + esc(r.item.name) + ' — คงเหลือ ' + fmtN(r.remain) + ' ' + esc(r.item.unit) + '</option>';
    }).join('');
    if (keep && list.some(function (r) { return r.item.id === keep; })) sel.value = keep;
    else if (list.length === 1) sel.value = list[0].item.id;
    paintPickInfo();
  }
  function currentItemId() {
    if (editing && editing.fixedItem) return editing.fixedItem;
    return $('#stkPick').value;
  }
  function paintPickInfo() {
    var id = currentItemId();
    var r = rowsCache.find(function (x) { return x.item.id === id; });
    if (editing && editing.kind === 'item') { $('#stkQtyLab').textContent = 'จำนวนรับเข้า'; return; }
    var lab = 'จำนวน';
    if (r) lab += ' (' + (r.item.unit || 'หน่วย') + ') · คงเหลือ ' + fmtN(r.remain);
    $('#stkQtyLab').textContent = lab;
    if (editing && editing.fixedItem && r) {
      $('#stkFixed').innerHTML = '<b>' + esc(r.item.name) + '</b><small>' + esc(catName(r.item.cat)) + (r.item.code ? ' · ' + esc(r.item.code) : '') + ' · คงเหลือ ' + fmtN(r.remain) + ' ' + esc(r.item.unit) + '</small>';
    }
  }

  function show(id, on) { $(id).style.display = on ? '' : 'none'; }

  function openForm(moveId, itemId, kind) {
    var mv = moveId ? moves().find(function (m) { return m.id === moveId; }) : null;
    if (mv && mv.type === 'item') kind = 'item';
    editing = { id: mv ? mv.id : null, fixedItem: mv ? mv.itemId : (itemId || null), kind: kind };
    if (kind === 'item' && !mv) editing.fixedItem = null;
    var isItem = kind === 'item';
    $('#stkMTitle').textContent = isItem ? (mv ? 'แก้ไขรายการวัสดุที่เพิ่ม' : 'เพิ่มรายการวัสดุใหม่') : (mv ? 'แก้ไขการเบิก' : 'บันทึกการเบิก');
    show('#stkPickWrap', !isItem && !editing.fixedItem);
    show('#stkFixedWrap', !isItem && !!editing.fixedItem);
    ['#stkNewCatWrap', '#stkNewCodeWrap', '#stkNewNameWrap', '#stkNewUnitWrap'].forEach(function (s) { show(s, isItem); });
    show('#stkTypeWrap', !isItem);
    $('#stkNewCat').innerHTML = mm.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    var people = {}, units = {};
    moves().forEach(function (m) { if (m.by) m.by.split(' / ').forEach(function (p) { people[p] = 1; }); });
    mm.items.forEach(function (i) { if (i.unit) units[i.unit] = 1; });
    $('#stkPeople').innerHTML = Object.keys(people).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    $('#stkUnits').innerHTML = Object.keys(units).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    $('#stkPickQ').value = '';
    $('#stkType').value = mv ? mv.type : 'out';
    $('#stkDate').value = mv ? mv.date : todayIso();
    $('#stkQty').value = mv ? mv.qty : '';
    $('#stkSo').value = mv ? mv.so : '';
    $('#stkBy').value = mv ? mv.by : '';
    $('#stkProject').value = mv ? mv.project : '';
    $('#stkDoc').value = mv ? mv.doc : '';
    $('#stkNote').value = mv ? mv.note : '';
    $('#stkNewCat').value = mv && isItem ? (mv.cat || 'misc') : (f.cat || 'misc');
    $('#stkNewCode').value = mv && isItem ? mv.code : '';
    $('#stkNewName').value = mv && isItem ? mv.name : '';
    $('#stkNewUnit').value = mv && isItem ? mv.unit : '';
    $('#stkMDel').style.display = mv ? '' : 'none';
    $('#stkMMsg').textContent = mv && mv.src === 'file' ? 'รายการนี้นำเข้าจากไฟล์ Excel แก้หรือลบได้ ยอดคงเหลือจะคำนวณใหม่ทันที' : '';
    if (!isItem && !editing.fixedItem) fillPick(); else paintPickInfo();
    $('#stkMask').classList.add('on');
    setTimeout(function () { (isItem ? $('#stkNewName') : (editing.fixedItem ? $('#stkQty') : $('#stkPickQ'))).focus(); }, 30);
  }
  function closeForm() { $('#stkMask').classList.remove('on'); editing = null; }

  function bad(el, msg) {
    el.style.outline = '2px solid var(--crit)';
    $('#stkMMsg').textContent = msg;
    el.focus();
    setTimeout(function () { el.style.outline = ''; }, 2500);
  }

  function saveForm() {
    if (!editing) return;
    var isItem = editing.kind === 'item';
    var qty = M.num($('#stkQty').value);
    var date = $('#stkDate').value;
    var old = editing.id ? moves().find(function (m) { return m.id === editing.id; }) : null;
    var row;
    if (isItem) {
      var name = $('#stkNewName').value.trim();
      if (!name) return bad($('#stkNewName'), 'ใส่ชื่อรายการ');
      if (!(qty >= 0) || $('#stkQty').value === '') return bad($('#stkQty'), 'ใส่จำนวนรับเข้า');
      row = { id: old ? old.id : M.newId('n'), itemId: old ? old.itemId : M.newId('new-'), type: 'item', cat: $('#stkNewCat').value, code: $('#stkNewCode').value.trim(), name: name, unit: $('#stkNewUnit').value.trim() };
    } else {
      var itemId = currentItemId();
      if (!itemId) return bad($('#stkPickQ'), 'เลือกรายการวัสดุก่อน');
      if (!(qty > 0)) return bad($('#stkQty'), 'ใส่จำนวนมากกว่า 0');
      var r = rowsCache.find(function (x) { return x.item.id === itemId; });
      var type = $('#stkType').value;
      if (type === 'out' && r) {
        var avail = r.remain + (old && old.type === 'out' && old.itemId === itemId ? old.qty : 0);
        if (qty > avail && !confirm('เบิก ' + fmtN(qty) + ' แต่คงเหลือ ' + fmtN(avail) + ' ' + (r.item.unit || '') + ' ยืนยันบันทึกหรือไม่? (ยอดจะติดลบ)')) return;
      }
      row = { id: old ? old.id : M.newId('w'), itemId: itemId, type: type, cat: r ? r.item.cat : '', code: r ? r.item.code : '', name: r ? r.item.name : '', unit: r ? r.item.unit : '' };
    }
    if (!date) return bad($('#stkDate'), 'ใส่วันที่');
    row.date = date;
    row.qty = qty;
    row.so = $('#stkSo').value.trim();
    row.project = $('#stkProject').value.trim();
    row.by = $('#stkBy').value.trim();
    row.doc = $('#stkDoc').value.trim();
    row.note = $('#stkNote').value.trim();
    row.src = old ? old.src : 'web';
    closeForm();
    queue({ op: 'upsert', row: M.normalizeMove(row) });
  }

  function deleteFromForm() {
    if (!editing || !editing.id) return;
    var mv = moves().find(function (m) { return m.id === editing.id; });
    if (!mv) return closeForm();
    var it = rowsCache.find(function (x) { return x.item.id === mv.itemId; });
    var nm = it ? it.item.name : 'รายการนี้';
    if (!confirm('ลบ' + (mv.type === 'item' ? 'รายการวัสดุ' : 'การเบิก') + ' "' + nm + '" ' + M.thaiDate(mv.date) + ' จำนวน ' + fmtN(mv.qty) + ' ใช่หรือไม่?')) return;
    var ops = [{ op: 'delete', id: mv.id }];
    if (mv.type === 'item') {
      moves().forEach(function (m) { if (m.itemId === mv.itemId && m.id !== mv.id) ops.push({ op: 'delete', id: m.id }); });
    }
    closeForm();
    ops.forEach(function (op) { pending.push(op); });
    savePending();
    renderAll();
    kick();
  }

  // ---------- แก้/เพิ่ม/ลบ รายการวัสดุ ----------
  var edId = null;
  var edImg = null;   // { data } รูปใหม่ · { removed:true } เอาออก · null ไม่เปลี่ยน
  function curItem(id) {
    return (mm.items || []).find(function (x) { return x.id === id; }) || (mm.deletedItems || []).find(function (x) { return x.id === id; });
  }
  function fillCatSelect(sel, val, withNew) {
    sel.innerHTML = mm.categories.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>'; }).join('') +
      (withNew ? '<option value="__new">＋ สร้างหมวดใหม่…</option>' : '');
    sel.value = val && mm.categories.some(function (c) { return c.id === val; }) ? val : (mm.categories[0] ? mm.categories[0].id : '__new');
  }
  function paintEdImg() {
    var it = edId ? curItem(edId) : null;
    var src = edImg && edImg.data ? edImg.data : (edImg && edImg.removed ? '' : (it && it.img) || '');
    $('#stkEdPrev').innerHTML = src ? (src.indexOf('data:') === 0 ? '<img src="' + src + '" alt="">' : imgTag(src, '')) : '<span class="muted">ยังไม่มีรูป</span>';
    $('#stkEdImgDel').style.display = src ? '' : 'none';
    if (!(edImg && edImg.data) && src && it && (it.imgSrc === 'web' || it.imgSrc === 'similar')) $('#stkEdPrev').insertAdjacentHTML('beforeend', '<i class="webimg">ตัวอย่าง</i>');
  }
  function openEditor(id, pickNow) {
    var it = id ? curItem(id) : null;
    edId = it ? it.id : null;
    edImg = null;
    $('#stkEdTitle').textContent = it ? 'แก้ไขรายการวัสดุ' : 'เพิ่มรายการวัสดุ';
    fillCatSelect($('#stkEdCat'), it ? it.cat : f.cat, true);
    show('#stkEdNewCatWrap', $('#stkEdCat').value === '__new');
    $('#stkEdNewCat').value = '';
    $('#stkEdCode').value = it ? (it.code || '') : '';
    $('#stkEdName').value = it ? (it.name || '') : '';
    $('#stkEdUnit').value = it ? (it.unit || '') : '';
    $('#stkEdQty').value = it ? (it.qtyIn == null ? '' : it.qtyIn) : '';
    $('#stkEdRecv').value = it ? (it.recv || '') : todayIso();
    $('#stkEdNote').value = it ? (it.note || '') : '';
    $('#stkEdFile').value = '';
    $('#stkEdDel').style.display = it ? '' : 'none';
    $('#stkEdMsg').textContent = it && !it.added ? 'จำนวนรับเข้าตั้งต้นมาจากไฟล์ Excel แก้ได้ถ้าไฟล์ผิด · รับของเพิ่มให้ใช้ บันทึกการเบิก › รับเข้าเพิ่ม' : '';
    var units = {};
    mm.items.forEach(function (i) { if (i.unit) units[i.unit] = 1; });
    $('#stkUnits').innerHTML = Object.keys(units).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    paintEdImg();
    $('#stkEdMask').classList.add('on');
    if (pickNow) { try { $('#stkEdFile').click(); } catch (e) {} }
    else setTimeout(function () { $('#stkEdName').focus(); }, 30);
  }
  function closeEditor() { $('#stkEdMask').classList.remove('on'); edId = null; edImg = null; }
  async function pickImage(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    $('#stkEdMsg').textContent = 'กำลังย่อรูป…';
    try {
      edImg = { data: await shrinkImage(file) };
      $('#stkEdMsg').textContent = 'ได้รูปแล้ว ขนาดหลังย่อประมาณ ' + Math.round(edImg.data.length * 0.75 / 1024) + ' KB';
      paintEdImg();
    } catch (err) {
      $('#stkEdMsg').textContent = 'เปิดรูปนี้ไม่ได้ ลองเลือกรูป JPG หรือ PNG';
    }
  }
  function saveEditor() {
    var name = $('#stkEdName').value.trim();
    if (!name) { $('#stkEdName').focus(); $('#stkEdMsg').textContent = 'ใส่ชื่อรายการ'; return; }
    var ops = [];
    var cat = $('#stkEdCat').value;
    if (cat === '__new' || !cat) {
      var cname = $('#stkEdNewCat').value.trim();
      if (!cname) { $('#stkEdNewCat').focus(); $('#stkEdMsg').textContent = 'ใส่ชื่อหมวดใหม่'; return; }
      cat = M.newId('c');
      ops.push({ kind: 'cat', op: 'upsert', row: { id: cat, name: cname, order: nextCatOrder() } });
    }
    var it = edId ? curItem(edId) : null;
    var img = it ? (it.img || '') : '';
    var imgSrc = it ? (it.imgSrc || (img ? 'file' : '')) : '';
    var oldSheet = /^sheet:/.test(img) ? img.slice(6) : '';
    if (edImg && edImg.data) {
      var imgId = M.newId('i');
      imgSrc = 'admin';
      ops.push({ kind: 'img', op: 'upsert', row: { id: imgId, data: edImg.data } });
      imgCache[imgId] = edImg.data;
      img = 'sheet:' + imgId;
    } else if (edImg && edImg.removed) { img = ''; imgSrc = ''; }
    if (oldSheet && img !== 'sheet:' + oldSheet) ops.push({ kind: 'img', op: 'delete', id: oldSheet });
    ops.push({ kind: 'item', op: 'upsert', row: {
      id: it ? it.id : M.newId('u'), cat: cat, code: $('#stkEdCode').value.trim(), name: name, unit: $('#stkEdUnit').value.trim(),
      qtyIn: M.num($('#stkEdQty').value), recv: $('#stkEdRecv').value, note: $('#stkEdNote').value.trim(), img: img, imgSrc: imgSrc, deleted: 0
    } });
    closeEditor();
    queueOps(ops);
  }
  function itemRow(it, patch) {
    return Object.assign({ id: it.id, cat: it.cat, code: it.code, name: it.name, unit: it.unit, qtyIn: it.qtyIn, recv: it.recv, note: it.note, img: it.img, imgSrc: it.imgSrc || '', deleted: 0 }, patch || {});
  }
  function deleteItem(id, after) {
    var it = curItem(id);
    if (!it) return;
    var r = rowsCache.find(function (x) { return x.item.id === id; });
    var n = r ? r.moves.length : 0;
    if (!confirm('ลบรายการ "' + it.name + '" ใช่หรือไม่?' + (n ? '\nประวัติการเบิก ' + n + ' ครั้งจะถูกซ่อนไปด้วย' : '') + '\nกู้คืนได้ที่ จัดการหมวด › รายการที่ลบแล้ว')) return;
    if (after) after();
    queueOps([{ kind: 'item', op: 'upsert', row: itemRow(it, { deleted: 1 }) }]);
  }
  function restoreItem(id) {
    var it = curItem(id);
    if (!it) return;
    var catOk = mm.categories.some(function (c) { return c.id === it.cat; });
    queueOps([{ kind: 'item', op: 'upsert', row: itemRow(it, { deleted: 0, cat: catOk ? it.cat : (mm.categories[0] || {}).id }) }]);
    paintCats();
  }

  // ---------- จัดการหมวด ----------
  function catRow(c, patch) { return Object.assign({ id: c.id, name: c.name, order: c.order, deleted: c.deleted ? 1 : 0 }, patch || {}); }
  function nextCatOrder() { return mm.allCategories.reduce(function (a, c) { return Math.max(a, +c.order || 0); }, 0) + 1; }
  function openCats() { paintCats(); $('#stkCatMask').classList.add('on'); }
  function closeCats() { $('#stkCatMask').classList.remove('on'); }
  function paintCats() {
    if (!$('#stkCatMask')) return;
    var counts = {};
    mm.items.forEach(function (it) { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    $('#stkCatList').innerHTML = mm.categories.map(function (c, i) {
      var n = counts[c.id] || 0;
      return '<div class="rrow"><input type="text" data-rename="' + esc(c.id) + '" value="' + esc(c.name) + '" style="flex:1;min-width:140px">' +
        '<span class="cnt">' + n + ' รายการ</span><span class="ops">' +
        (i > 0 ? '<button type="button" data-catup="' + esc(c.id) + '" title="เลื่อนขึ้น">↑</button>' : '') +
        '<button type="button" class="danger" data-catdel="' + esc(c.id) + '"' + (n ? ' disabled title="ย้ายหรือลบรายการในหมวดนี้ก่อน"' : '') + '>ลบหมวด</button></span></div>';
    }).join('');
    var delCats = mm.allCategories.filter(function (c) { return c.deleted; });
    var delItems = mm.deletedItems || [];
    $('#stkTrash').innerHTML = (delItems.length || delCats.length) ? '<h4 style="margin:18px 0 8px">รายการที่ลบแล้ว</h4><div class="rlist">' +
      delCats.map(function (c) { return '<div class="rrow"><span class="nm">หมวด: ' + esc(c.name) + '</span><span class="ops"><button type="button" data-catrestore="' + esc(c.id) + '">กู้คืน</button></span></div>'; }).join('') +
      delItems.map(function (it) { return '<div class="rrow"><span class="nm">' + esc(it.name) + '<small class="muted" style="display:block;font-weight:400">' + esc(catName(it.cat)) + '</small></span><span class="ops"><button type="button" data-restore="' + esc(it.id) + '">กู้คืน</button></span></div>'; }).join('') +
      '</div>' : '';
  }
  function addCat() {
    var name = $('#stkCatNew').value.trim();
    if (!name) { $('#stkCatNew').focus(); return; }
    if (mm.categories.some(function (c) { return c.name === name; })) { alert('มีหมวดชื่อนี้แล้ว'); return; }
    $('#stkCatNew').value = '';
    queueOps([{ kind: 'cat', op: 'upsert', row: { id: M.newId('c'), name: name, order: nextCatOrder() } }]);
    paintCats();
  }
  function renameCat(id, name) {
    name = String(name || '').trim();
    var c = mm.allCategories.find(function (x) { return x.id === id; });
    if (!c || !name || name === c.name) { paintCats(); return; }
    queueOps([{ kind: 'cat', op: 'upsert', row: catRow(c, { name: name }) }]);
    paintCats();
  }
  function deleteCat(id) {
    var c = mm.allCategories.find(function (x) { return x.id === id; });
    if (!c) return;
    if (mm.items.some(function (it) { return it.cat === id; })) { alert('ยังมีรายการในหมวดนี้ ย้ายหรือลบรายการก่อน'); return; }
    if (!confirm('ลบหมวด "' + c.name + '" ใช่หรือไม่? (กู้คืนได้)')) return;
    if (f.cat === id) f.cat = '';
    queueOps([{ kind: 'cat', op: 'upsert', row: catRow(c, { deleted: 1 }) }]);
    paintCats();
  }
  function restoreCat(id) {
    var c = mm.allCategories.find(function (x) { return x.id === id; });
    if (!c) return;
    queueOps([{ kind: 'cat', op: 'upsert', row: catRow(c, { deleted: 0 }) }]);
    paintCats();
  }
  function moveCat(id) {
    var list = mm.categories.slice();
    var i = list.findIndex(function (c) { return c.id === id; });
    if (i <= 0) return;
    var tmp = list[i - 1]; list[i - 1] = list[i]; list[i] = tmp;
    queueOps(list.map(function (c, k) { return { kind: 'cat', op: 'upsert', row: catRow(c, { order: k }) }; }));
    paintCats();
  }

  // ---------- ส่งออก Excel ----------
  async function exportXlsx() {
    var btn = $('#stkXlsx'); var prev = btn.textContent;
    btn.disabled = true; btn.textContent = 'กำลังเตรียมไฟล์…';
    try {
      if (bridge.loadSheetJS) await bridge.loadSheetJS();
      var X = root.XLSX;
      var wb = X.utils.book_new();
      var head = ['หมวด', 'ลำดับ', 'รหัส/Part No.', 'ชื่อรายการ / รายละเอียด', 'หน่วย', 'วันที่รับเข้า', 'รับเข้า', 'เบิกใช้', 'คืนคลัง', 'คงเหลือ', 'สถานะ', 'เบิกล่าสุด'];
      function line(r) { return [catName(r.item.cat), r.item.no || '', r.item.code, r.item.name, r.item.unit, M.thaiDate(r.item.recv), r.total, r.out, r.ret, r.remain, ST_LABEL[r.status] || 'ปกติ', M.thaiDate(r.lastOut)]; }
      var all = X.utils.aoa_to_sheet([head].concat(rowsCache.map(line)));
      all['!cols'] = [24, 6, 18, 60, 8, 12, 9, 9, 9, 9, 10, 12].map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, all, 'สรุปคงเหลือ');
      mm.categories.forEach(function (c) {
        var ws = X.utils.aoa_to_sheet([head].concat(rowsCache.filter(function (r) { return r.item.cat === c.id; }).map(line)));
        ws['!cols'] = all['!cols'];
        X.utils.book_append_sheet(wb, ws, c.name.slice(0, 31));
      });
      var byId = {}; rowsCache.forEach(function (r) { byId[r.item.id] = r.item; });
      var hs = X.utils.aoa_to_sheet([['วันที่', 'ประเภท', 'หมวด', 'รหัส', 'รายการ', 'จำนวน', 'หน่วย', 'เลขที่ SO', 'โครงการ', 'ผู้เบิก', 'เลขที่ใบเบิก', 'หมายเหตุ']].concat(moves().slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); }).filter(function (m) { return byId[m.itemId]; }).map(function (m) {
        var it = byId[m.itemId];
        return [M.thaiDate(m.date), (M.TYPES[m.type] || M.TYPES.out).label, catName(it.cat), it.code, it.name, m.qty, it.unit, m.so, m.project, m.by, m.doc, m.note];
      })));
      hs['!cols'] = [12, 12, 24, 18, 60, 8, 8, 14, 36, 22, 16, 30].map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, hs, 'ประวัติการเบิก');
      X.writeFile(wb, 'วัสดุนอกสต๊อก_' + todayIso() + '.xlsx');
    } catch (e) {
      alert('ส่งออก Excel ไม่ได้ในตอนนี้');
    } finally {
      btn.disabled = false; btn.textContent = prev;
    }
  }

  root.PEStock = {
    bind: function (b) { bridge = b || {}; },
    onShow: function () {
      if (!booted) { boot(); return; }
      if (mode === 'live' && Date.now() - lastLoad > 60000 && !flushing && !pending.length) reload();
      else renderAll();
    },
    state: function () { return { mode: mode, pending: pending.length, moves: moves().length, items: rowsCache.length, flushing: flushing, needKey: needKey, retry: !!retryTimer }; }
  };
})(typeof self !== 'undefined' ? self : this);
