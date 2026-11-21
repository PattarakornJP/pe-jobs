/* วัสดุงานติดตั้งนอกสต๊อก — ตรรกะคำนวณยอด (ใช้ได้ทั้งเบราว์เซอร์และ node) */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PEStockModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = {
    out: { label: 'เบิกใช้', sign: -1 },
    ret: { label: 'คืนคลัง', sign: 1 },
    'in': { label: 'รับเข้าเพิ่ม', sign: 1 },
    item: { label: 'เพิ่มรายการใหม่', sign: 1 }
  };
  var FIELDS = ['id', 'itemId', 'cat', 'code', 'name', 'unit', 'type', 'date', 'qty', 'so', 'project', 'by', 'doc', 'note', 'src', 'updatedAt'];
  var LOW_RATIO = 0.2;

  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function round(n) { return Math.round(n * 1000) / 1000; }
  function isoDate(v) {
    var s = str(v);
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      var y = +m[1]; if (y > 2400) y -= 543;
      return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      var yy = +m[3]; if (yy < 100) yy += 2500; if (yy > 2400) yy -= 543;
      return yy + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    }
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
    return '';
  }
  function thaiDate(iso) {
    var m = str(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return (+m[3]) + '/' + (+m[2]) + '/' + (+m[1] + 543);
  }

  function normalizeMove(r) {
    r = r || {};
    var type = str(r.type);
    if (!TYPES[type]) type = 'out';
    return {
      id: str(r.id),
      itemId: str(r.itemId),
      cat: str(r.cat),
      code: str(r.code),
      name: str(r.name),
      unit: str(r.unit),
      type: type,
      date: isoDate(r.date),
      qty: round(Math.abs(num(r.qty))),
      so: str(r.so),
      project: str(r.project),
      by: str(r.by),
      doc: str(r.doc),
      note: str(r.note),
      src: str(r.src) || 'web'
    };
  }

  /** ใช้คำสั่ง upsert/delete กับรายการเคลื่อนไหว คืนชุดใหม่ (ไม่แก้ของเดิม) */
  function applyOps(moves, ops) {
    var list = (moves || []).map(normalizeMove);
    (ops || []).forEach(function (op) {
      if (!op) return;
      if (op.op === 'delete') {
        list = list.filter(function (m) { return m.id !== str(op.id); });
      } else if (op.op === 'upsert' && op.row) {
        var row = normalizeMove(op.row);
        if (!row.id) return;
        var i = list.findIndex(function (m) { return m.id === row.id; });
        if (i >= 0) list[i] = row; else list.push(row);
      }
    });
    return list;
  }

  /** รวมรายการตั้งต้นกับรายการใหม่ที่เพิ่มผ่านเว็บ (type item) */
  function allItems(master, moves) {
    var items = (master || []).map(function (it) { return Object.assign({}, it); });
    var seen = {};
    items.forEach(function (it) { seen[it.id] = true; });
    (moves || []).forEach(function (m) {
      if (m.type !== 'item' || !m.itemId || seen[m.itemId]) return;
      seen[m.itemId] = true;
      items.push({ id: m.itemId, cat: m.cat || 'misc', code: m.code, name: m.name || '(ไม่มีชื่อ)', unit: m.unit, qtyIn: 0, recv: m.date, note: m.note, img: '', added: true });
    });
    return items;
  }

  function status(rem, total) {
    if (rem < 0) return 'over';
    if (rem === 0) return total > 0 ? 'zero' : 'zero';
    if (total > 0 && rem <= total * LOW_RATIO) return 'low';
    return 'ok';
  }

  /** คำนวณยอดต่อรายการ: total = รับเข้าในไฟล์ + รับเพิ่ม, used = เบิก − คืน, remain = total − used */
  function balances(master, moves) {
    var items = allItems(master, moves);
    var map = {};
    items.forEach(function (it) {
      map[it.id] = { item: it, base: num(it.qtyIn), added: 0, out: 0, ret: 0, moves: [], lastOut: '' };
    });
    (moves || []).forEach(function (m) {
      var b = map[m.itemId];
      if (!b) return;
      var q = num(m.qty);
      if (m.type === 'out') { b.out += q; if (m.date > b.lastOut) b.lastOut = m.date; }
      else if (m.type === 'ret') b.ret += q;
      else b.added += q;
      b.moves.push(m);
    });
    return items.map(function (it) {
      var b = map[it.id];
      var total = round(b.base + b.added);
      var used = round(b.out - b.ret);
      var remain = round(total - used);
      b.moves.sort(function (a, c) { return (c.date || '').localeCompare(a.date || '') || (c.id || '').localeCompare(a.id || ''); });
      return { item: it, total: total, used: used, out: round(b.out), ret: round(b.ret), added: round(b.added), remain: remain, status: status(remain, total), lastOut: b.lastOut, moves: b.moves };
    });
  }

  function summarize(rows, cats) {
    return (cats || []).map(function (c) {
      var mine = rows.filter(function (r) { return r.item.cat === c.id; });
      return {
        id: c.id,
        name: c.name,
        items: mine.length,
        touched: mine.filter(function (r) { return r.out > 0; }).length,
        low: mine.filter(function (r) { return r.status === 'low'; }).length,
        zero: mine.filter(function (r) { return r.status === 'zero' || r.status === 'over'; }).length,
        moves: mine.reduce(function (s, r) { return s + r.moves.filter(function (m) { return m.type === 'out'; }).length; }, 0)
      };
    });
  }

  function newId(prefix) {
    return (prefix || 'w') + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  return {
    TYPES: TYPES, FIELDS: FIELDS, LOW_RATIO: LOW_RATIO,
    num: num, isoDate: isoDate, thaiDate: thaiDate, normalizeMove: normalizeMove,
    applyOps: applyOps, allItems: allItems, balances: balances, summarize: summarize, status: status, newId: newId
  };
});
