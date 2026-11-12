/**
 * Zoom math and Excel/PDF builders for the plan tab.
 * Excel colors need ExcelJS. PDF text uses an embedded Sarabun font.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PEPlanExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var MIN_DW = 8;
  var MAX_DW = 64;
  var MONTH_DW = 16;
  var WEEK_DW = 34;
  var MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  function clampDayWidth(w) {
    var n = Number(w);
    if (!isFinite(n)) return MONTH_DW;
    if (n < MIN_DW) return MIN_DW;
    if (n > MAX_DW) return MAX_DW;
    return Math.round(n * 10) / 10;
  }

  function presetWidth(name) {
    return name === 'week' ? WEEK_DW : MONTH_DW;
  }

  function presetName(width) {
    if (Math.abs(width - WEEK_DW) < 0.05) return 'week';
    if (Math.abs(width - MONTH_DW) < 0.05) return 'month';
    return '';
  }

  function centerIndex(scrollLeft, clientWidth, labelW, dayWidth) {
    var dw = Number(dayWidth) || 1;
    var view = Math.max(1, Number(clientWidth) - Number(labelW || 0));
    return (Number(scrollLeft) + view / 2) / dw;
  }

  function scrollLeftForCenter(index, clientWidth, labelW, dayWidth) {
    var dw = Number(dayWidth) || 1;
    var view = Math.max(1, Number(clientWidth) - Number(labelW || 0));
    var x = Number(index) * dw - view / 2;
    return x > 0 ? x : 0;
  }

  function dow(iso) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return -1;
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  }

  function monthLabel(iso) {
    var p = String(iso).split('-');
    return (MONTHS[+p[1] - 1] || '') + ' ' + (+p[0] + 543);
  }

  function monthsOf(days) {
    var out = [];
    (days || []).forEach(function (iso, i) {
      var key = iso.slice(0, 7);
      if (!out.length || out[out.length - 1].key !== key) out.push({ key: key, label: monthLabel(iso), start: i, span: 1 });
      else out[out.length - 1].span++;
    });
    return out;
  }

  function barHex(color, done) {
    if (done) {
      if (color === 'cm') return 'E7A3A3';
      if (color === 'pm') return '8FCFC6';
      return 'A9C7EF';
    }
    if (color === 'cm') return 'D03B3B';
    if (color === 'pm') return '0F9D8F';
    return '2A78D6';
  }

  function argb(hex) {
    return 'FF' + String(hex || '000000').replace('#', '').toUpperCase();
  }

  function fill(hex) {
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } };
  }

  function thinBorder(color) {
    var edge = { style: 'thin', color: { argb: argb(color || 'E1E0D9') } };
    return { top: edge, left: edge, bottom: edge, right: edge };
  }

  function tableMatrix(rows) {
    var head = ['รหัส', 'ชื่องาน', 'ระยะเวลา (วัน)', 'วันเริ่ม', 'วันจบ', 'ผู้รับผิดชอบ', 'สถานะ'];
    var body = [];
    var last = '';
    (rows || []).forEach(function (e) {
      if (e.groupLabel && e.groupLabel !== last) {
        last = e.groupLabel;
        body.push({ group: e.groupLabel });
      }
      var name = e.name || '';
      if (e.so) name += '\n' + e.so;
      body.push([
        e.idText == null ? '' : e.idText,
        name,
        e.days || '',
        e.startText || '',
        e.finishText || '',
        e.person || '',
        e.status || ''
      ]);
    });
    return { head: head, body: body };
  }

  function buildXlsx(ExcelJS, spec) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'PE Jobs';
    var table = wb.addWorksheet('ตาราง', {
      views: [{ state: 'frozen', ySplit: 3 }]
    });
    table.mergeCells(1, 1, 1, 7);
    table.getCell(1, 1).value = 'แผนงาน Project';
    table.getCell(1, 1).font = { name: 'Sarabun', size: 16, bold: true, color: { argb: 'FF0B0B0B' } };
    table.mergeCells(2, 1, 2, 7);
    table.getCell(2, 1).value = 'ส่งออก ' + (spec.exportedOn || '') + (spec.filterText ? ' · ' + spec.filterText : '');
    table.getCell(2, 1).font = { name: 'Sarabun', size: 11, color: { argb: 'FF52514E' } };
    var matrix = tableMatrix(spec.rows);
    matrix.head.forEach(function (label, i) {
      var cell = table.getCell(3, i + 1);
      cell.value = label;
      cell.font = { name: 'Sarabun', size: 11, bold: true, color: { argb: 'FF0B0B0B' } };
      cell.fill = fill('F3F1EA');
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = thinBorder();
    });
    var r = 4;
    matrix.body.forEach(function (row) {
      if (row.group) {
        table.mergeCells(r, 1, r, 7);
        var g = table.getCell(r, 1);
        g.value = row.group;
        g.font = { name: 'Sarabun', size: 12, bold: true };
        g.fill = fill('E7E6DF');
        r++;
        return;
      }
      row.forEach(function (value, i) {
        var cell = table.getCell(r, i + 1);
        cell.value = value;
        cell.font = { name: 'Sarabun', size: 11 };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = thinBorder();
      });
      r++;
    });
    table.columns = [12, 42, 16, 16, 16, 24, 18].map(function (w) { return { width: w }; });

    var grid = wb.addWorksheet('เส้นเวลา', {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }]
    });
    var days = spec.days || [];
    var lastCol = Math.max(2, days.length + 1);
    grid.mergeCells(1, 1, 1, lastCol);
    grid.getCell(1, 1).value = 'แผนงาน Project';
    grid.getCell(1, 1).font = { name: 'Sarabun', size: 16, bold: true };
    grid.mergeCells(2, 1, 2, lastCol);
    grid.getCell(2, 1).value = 'ส่งออก ' + (spec.exportedOn || '') + (spec.filterText ? ' · ' + spec.filterText : '');
    grid.getCell(2, 1).font = { name: 'Sarabun', size: 11, color: { argb: 'FF52514E' } };
    grid.getCell(3, 1).value = 'งาน';
    grid.getCell(4, 1).value = 'วัน';
    [3, 4].forEach(function (rr) {
      var cell = grid.getCell(rr, 1);
      cell.font = { name: 'Sarabun', size: 11, bold: true };
      cell.fill = fill('F3F1EA');
      cell.border = thinBorder();
    });
    monthsOf(days).forEach(function (m) {
      var c1 = m.start + 2;
      var c2 = m.start + m.span + 1;
      if (c2 > c1) grid.mergeCells(3, c1, 3, c2);
      var cell = grid.getCell(3, c1);
      cell.value = m.label;
      cell.font = { name: 'Sarabun', size: 11, bold: true };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      cell.fill = fill('F7F6F1');
      for (var c = c1; c <= c2; c++) grid.getCell(3, c).border = thinBorder();
    });
    var todayCol = -1;
    days.forEach(function (iso, i) {
      var cell = grid.getCell(4, i + 2);
      var weekend = dow(iso) === 0 || dow(iso) === 6;
      cell.value = +iso.slice(8);
      cell.font = { name: 'Sarabun', size: 9, color: { argb: iso === spec.today ? 'FFD03B3B' : 'FF52514E' } };
      cell.alignment = { horizontal: 'center' };
      cell.fill = fill(weekend ? 'F4F3EE' : 'FFFFFF');
      cell.border = thinBorder();
      if (iso === spec.today) todayCol = i + 2;
    });
    var rr = 5;
    (spec.bars || []).forEach(function (bar) {
      if (bar.group) {
        grid.mergeCells(rr, 1, rr, lastCol);
        var g = grid.getCell(rr, 1);
        g.value = bar.group;
        g.font = { name: 'Sarabun', size: 11, bold: true };
        g.fill = fill('E7E6DF');
        rr++;
        return;
      }
      var nameCell = grid.getCell(rr, 1);
      nameCell.value = bar.name || '';
      nameCell.font = { name: 'Sarabun', size: 10 };
      nameCell.alignment = { vertical: 'middle', wrapText: true };
      nameCell.border = thinBorder();
      var hex = barHex(bar.color, bar.done);
      for (var i = 0; i < days.length; i++) {
        var cell = grid.getCell(rr, i + 2);
        var weekend = dow(days[i]) === 0 || dow(days[i]) === 6;
        var on = bar.startIndex != null && i >= bar.startIndex && i <= bar.endIndex;
        cell.fill = fill(on ? hex : (weekend ? 'F4F3EE' : 'FFFFFF'));
        cell.border = thinBorder(i + 2 === todayCol ? 'D03B3B' : 'E1E0D9');
      }
      rr++;
    });
    var widths = [{ width: 36 }];
    for (var d = 0; d < days.length; d++) widths.push({ width: 3.2 });
    grid.columns = widths;
    return wb;
  }

  function pagePlan(spec) {
    var days = spec.days || [];
    var n = days.length;
    var rows = spec.bars || [];
    var useA3 = n > 42 || rows.length > 28;
    var pageW = useA3 ? 420 : 297;
    var pageH = useA3 ? 297 : 210;
    var margin = 8;
    var nameMm = 58;
    var minDay = 3.2;
    var maxDay = 8;
    var usable = pageW - margin * 2 - nameMm;
    var chunks = [];
    var dayMm;
    if (!n) {
      chunks = [[0, 0]];
      dayMm = minDay;
    } else if (usable / n >= minDay) {
      dayMm = Math.min(maxDay, usable / n);
      chunks = [[0, n]];
    } else {
      dayMm = minDay;
      var per = Math.max(1, Math.floor(usable / minDay));
      for (var i = 0; i < n; i += per) chunks.push([i, Math.min(n, i + per)]);
    }
    var head = 20;
    var colHead = 10;
    var rowMm = 6.2;
    var rowsPer = Math.max(1, Math.floor((pageH - margin - head - colHead - margin) / rowMm));
    var rowChunks = [];
    if (!rows.length) rowChunks = [[0, 0]];
    else {
      for (var r = 0; r < rows.length; r += rowsPer) rowChunks.push([r, Math.min(rows.length, r + rowsPer)]);
    }
    return {
      format: useA3 ? 'a3' : 'a4',
      pageW: pageW,
      pageH: pageH,
      margin: margin,
      nameMm: nameMm,
      dayMm: dayMm,
      head: head,
      colHead: colHead,
      rowMm: rowMm,
      chunks: chunks,
      rowChunks: rowChunks
    };
  }

  function buildPdf(JsPDF, fonts, spec) {
    var plan = pagePlan(spec);
    var doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: plan.format, compress: true });
    doc.addFileToVFS('Sarabun-Regular.ttf', fonts.regular);
    doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
    doc.addFileToVFS('Sarabun-Bold.ttf', fonts.bold);
    doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
    var pages = plan.chunks.length * plan.rowChunks.length;
    var pageNo = 0;
    plan.rowChunks.forEach(function (rc) {
      plan.chunks.forEach(function (cc) {
        if (pageNo) doc.addPage();
        pageNo++;
        drawPdfPage(doc, spec, plan, rc, cc, pageNo, pages);
      });
    });
    return doc;
  }

  function drawPdfPage(doc, spec, plan, rc, cc, pageNo, pages) {
    var m = plan.margin;
    var days = (spec.days || []).slice(cc[0], cc[1]);
    var bars = (spec.bars || []).slice(rc[0], rc[1]);
    doc.setFillColor(249, 249, 247);
    doc.rect(0, 0, plan.pageW, plan.pageH, 'F');
    doc.setFont('Sarabun', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(11, 11, 11);
    doc.text('แผนงาน Project', m, m + 6);
    doc.setFont('Sarabun', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(82, 81, 78);
    var sub = 'ส่งออก ' + (spec.exportedOn || '');
    if (days.length) sub += '  ·  ' + beDate(days[0]) + ' – ' + beDate(days[days.length - 1]);
    if (spec.filterText) sub += '  ·  ' + spec.filterText;
    doc.text(sub, m, m + 12);
    doc.text('หน้า ' + pageNo + '/' + pages, plan.pageW - m, m + 6, { align: 'right' });
    var top = m + plan.head;
    var nameW = plan.nameMm;
    var dayW = plan.dayMm;
    var gridW = days.length * dayW;
    doc.setFillColor(243, 241, 234);
    doc.rect(m, top, nameW, plan.colHead, 'F');
    doc.setFont('Sarabun', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(11, 11, 11);
    doc.text('งาน', m + 2, top + 6.4);
    var x0 = m + nameW;
    monthsOf(days).forEach(function (month) {
      doc.setFillColor(247, 246, 241);
      doc.rect(x0 + month.start * dayW, top, month.span * dayW, 5, 'F');
      doc.setFont('Sarabun', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(11, 11, 11);
      doc.text(month.label, x0 + month.start * dayW + 1, top + 3.6);
    });
    days.forEach(function (iso, i) {
      var weekend = dow(iso) === 0 || dow(iso) === 6;
      var today = iso === spec.today;
      doc.setFillColor(weekend ? 244 : 255, weekend ? 243 : 255, weekend ? 238 : 255);
      doc.rect(x0 + i * dayW, top + 5, dayW, 5, 'F');
      doc.setFont('Sarabun', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(today ? 208 : 82, today ? 59 : 81, today ? 59 : 78);
      doc.text(String(+iso.slice(8)), x0 + i * dayW + dayW / 2, top + 8.6, { align: 'center' });
    });
    var y = top + plan.colHead;
    bars.forEach(function (bar) {
      if (bar.group) {
        doc.setFillColor(231, 230, 223);
        doc.rect(m, y, nameW + gridW, plan.rowMm, 'F');
        doc.setFont('Sarabun', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(11, 11, 11);
        doc.text(bar.group, m + 2, y + 4.3);
        y += plan.rowMm;
        return;
      }
      days.forEach(function (iso, i) {
        if (dow(iso) === 0 || dow(iso) === 6) {
          doc.setFillColor(244, 243, 238);
          doc.rect(x0 + i * dayW, y, dayW, plan.rowMm, 'F');
        }
      });
      if (bar.startIndex != null && bar.endIndex != null) {
        var a = Math.max(bar.startIndex, cc[0]);
        var b = Math.min(bar.endIndex, cc[1] - 1);
        if (b >= a) {
          var rgb = hexRgb(barHex(bar.color, bar.done));
          doc.setFillColor(rgb[0], rgb[1], rgb[2]);
          doc.rect(x0 + (a - cc[0]) * dayW + 0.3, y + 1.3, (b - a + 1) * dayW - 0.6, plan.rowMm - 2.6, 'F');
        }
      }
      doc.setDrawColor(225, 224, 217);
      doc.rect(m, y, nameW, plan.rowMm);
      doc.setFont('Sarabun', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(11, 11, 11);
      doc.text(fitText(doc, bar.name || '', nameW - 3), m + 1.5, y + 4.2);
      y += plan.rowMm;
    });
    if (spec.today) {
      var ti = days.indexOf(spec.today);
      if (ti >= 0) {
        doc.setDrawColor(208, 59, 59);
        doc.setLineWidth(0.4);
        var lx = x0 + ti * dayW + dayW / 2;
        doc.line(lx, top, lx, y);
      }
    }
  }

  function fitText(doc, text, maxW) {
    var s = String(text || '');
    if (doc.getTextWidth(s) <= maxW) return s;
    while (s.length > 1 && doc.getTextWidth(s + '…') > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function beDate(iso) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return '';
    return p[2] + '/' + p[1] + '/' + (+p[0] + 543);
  }

  function hexRgb(hex) {
    var h = String(hex).replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  return {
    MIN_DW: MIN_DW,
    MAX_DW: MAX_DW,
    MONTH_DW: MONTH_DW,
    WEEK_DW: WEEK_DW,
    clampDayWidth: clampDayWidth,
    presetWidth: presetWidth,
    presetName: presetName,
    centerIndex: centerIndex,
    scrollLeftForCenter: scrollLeftForCenter,
    dow: dow,
    monthsOf: monthsOf,
    barHex: barHex,
    tableMatrix: tableMatrix,
    pagePlan: pagePlan,
    buildXlsx: buildXlsx,
    buildPdf: buildPdf
  };
});
