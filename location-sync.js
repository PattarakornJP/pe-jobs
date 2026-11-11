/**
 * Decide which job-site pins should be copied onto sheet rows.
 * The sheet write still sends every row (the Apps Script replaces the tab),
 * but only location columns are taken from the page, and only for rows whose
 * lat/lng is missing or different.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PELocSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var RETIRED_LAT = 8.1661545;
  var RETIRED_LNG = 98.2952039;
  var EPS = 1e-6;

  function coordOrBlank(v) {
    if (v == null || v === '') return '';
    var n = Number(v);
    return Number.isFinite(n) ? String(n) : '';
  }

  function hasCoords(r) {
    var lat = Number(r && r.lat), lng = Number(r && r.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
  }

  function retiredPin(r) {
    var lat = Number(r && r.lat), lng = Number(r && r.lng);
    return Math.abs(lat - RETIRED_LAT) < 1e-5 && Math.abs(lng - RETIRED_LNG) < 1e-5;
  }

  function coordsClose(a, b) {
    var x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < EPS;
  }

  function normHow(v) {
    if (v === 'exact') return 'exact';
    if (v === 'approximate' || v === 'fuzzy') return 'approximate';
    return '';
  }

  function locSrcOf(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  }

  function findHit(r, items) {
    if (!r || !items) return null;
    var k = String(r.so || '').trim();
    var id = String(r.id);
    var i;
    if (k) {
      var pool = [];
      for (i = 0; i < items.length; i++) {
        if (String(items[i].so || '').trim() === k) pool.push(items[i]);
      }
      if (!pool.length) return null;
      for (i = 0; i < pool.length; i++) {
        if (String(pool[i].id) === id) return pool[i];
      }
      return pool.length === 1 ? pool[0] : null;
    }
    for (i = 0; i < items.length; i++) {
      if (String(items[i].id) === id && !String(items[i].so || '').trim()) return items[i];
    }
    return null;
  }

  function locTuple(r) {
    return [
      String((r && r.loc) || '').trim(),
      coordOrBlank(r && r.lat),
      coordOrBlank(r && r.lng),
      normHow(r && r.locHow),
      locSrcOf(r && r.locSrc)
    ].join('\u0001');
  }

  function needsFileWrite(row, hit) {
    if (!hit || !hit.loc) return false;
    if (!hasCoords(row) || retiredPin(row)) return true;
    if (!hasCoords(hit)) return false;
    return !(coordsClose(row.lat, hit.lat) && coordsClose(row.lng, hit.lng));
  }

  function applyHit(row, hit) {
    row.loc = String(hit.loc);
    row.lat = coordOrBlank(hit.lat);
    row.lng = coordOrBlank(hit.lng);
    row.locHow = normHow(hit.how != null ? hit.how : hit.locHow);
    row.locSrc = locSrcOf(hit.src != null ? hit.src : hit.locSrc);
  }

  function applyFile(list, items, mode, skip) {
    if (!list || !items) return 0;
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || (skip && skip(r))) continue;
      var hit = findHit(r, items);
      if (!needsFileWrite(r, hit)) continue;
      var missing = !hasCoords(r) || retiredPin(r);
      if (!missing && mode !== 'sync') continue;
      var before = locTuple(r);
      applyHit(r, hit);
      if (locTuple(r) !== before) n++;
    }
    return n;
  }

  function driftCount(current, base) {
    var map = {};
    (base || []).forEach(function (r) { map[String(r.id)] = locTuple(r); });
    var n = 0;
    (current || []).forEach(function (r) {
      if (!Object.prototype.hasOwnProperty.call(map, String(r.id))) return;
      if (map[String(r.id)] !== locTuple(r)) n++;
    });
    return n;
  }

  var LOC_KEYS = { loc: 1, lat: 1, lng: 1, locHow: 1, locSrc: 1 };

  function overlayLocations(base, current) {
    var cur = {};
    (current || []).forEach(function (r) { cur[String(r.id)] = r; });
    return (base || []).map(function (prev) {
      var next = {};
      Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
      var now = cur[String(prev.id)];
      if (!now || locTuple(prev) === locTuple(now)) return next;
      Object.keys(LOC_KEYS).forEach(function (k) { next[k] = now[k]; });
      return next;
    });
  }

  return {
    coordOrBlank: coordOrBlank,
    hasCoords: hasCoords,
    retiredPin: retiredPin,
    coordsClose: coordsClose,
    normHow: normHow,
    locSrcOf: locSrcOf,
    findHit: findHit,
    locTuple: locTuple,
    needsFileWrite: needsFileWrite,
    applyFile: applyFile,
    driftCount: driftCount,
    overlayLocations: overlayLocations
  };
});
