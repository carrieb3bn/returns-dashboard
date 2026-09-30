// ── Loop export import ───────────────────────────────────────────────────────
// Rebuilds DATA, TREND_DATA, SKU_DATA, OUTLIERS_DATA (and the return columns of
// RETENTION_DATA) from a Loop returns CSV, entirely in the browser.
// The result is kept in this browser (localStorage) and can be downloaded as a
// new data.js to commit to GitHub so everyone sees it.

(function () {
  const LS_KEY = 'tbn-returns-import-v1';
  const PUBLISHED = JSON.parse(JSON.stringify({ DATA, TREND_DATA, SKU_DATA, RETENTION_DATA, OUTLIERS_DATA }));
  const TYPE_BY_NAME = {};
  PUBLISHED.DATA.products.forEach(p => { if (p.type) TYPE_BY_NAME[p.name] = p.type; });

  // Column detection: first header matching any pattern wins.
  const FIELDS = [
    { key: 'product', label: 'Product title', required: true, pats: [/^product[ _]?title$/i, /^line[ _]?item[ _]?(title|name)$/i, /^product[ _]?name$/i, /^item[ _]?(title|name)$/i, /^product$/i, /product.*title/i, /title/i] },
    { key: 'reason', label: 'Return reason', required: true, pats: [/^return[ _]?reason$/i, /^reason$/i, /^child[ _]?reason$/i, /(?<!parent[ _]?)reason(?!.*(parent|comment|note))/i] },
    { key: 'variant', label: 'Variant title (size)', pats: [/^variant[ _]?title$/i, /^variant[ _]?name$/i, /^variant$/i, /^size$/i, /variant/i] },
    { key: 'sku', label: 'SKU', pats: [/^sku$/i, /^variant[ _]?sku$/i, /sku/i] },
    { key: 'comment', label: 'Customer comment', pats: [/comment/i, /customer[ _]?note/i, /^notes?$/i, /feedback/i, /explanation/i] },
    { key: 'date', label: 'Return date', pats: [/^return[ _]?created[ _]?at$/i, /^created[ _]?at$/i, /^created$/i, /^return[ _]?date$/i, /^date$/i, /created/i, /date/i] },
    { key: 'returnId', label: 'Return ID', pats: [/^return[ _]?id$/i, /^return[ _]?(number|#)$/i, /^id$/i, /return.*id/i] },
    { key: 'type', label: 'Product type', pats: [/^product[ _]?type$/i, /^type$/i, /category/i] },
    { key: 'qty', label: 'Quantity', pats: [/^quantity$/i, /^qty$/i, /quantity/i] },
  ];

  const SIZE_TOKENS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '1X', '2X', '3X', 'OS', 'S/M', 'M/L', 'L/XL', 'SM', 'ML'];
  const SIZE_ORDER = ['XXS', 'XS', 'S', 'S/M', 'M', 'M/L', 'L', 'L/XL', 'XL', 'XXL', '1X', '2X', '3X', 'OS'];
  function normSize(raw) {
    if (!raw) return '';
    const s = String(raw).trim().toUpperCase().replace(/\s+/g, ' ');
    if (/ONE ?SIZE|^OS$|^O\/S$/.test(s)) return 'OS';
    const WORDS = { 'EXTRA SMALL': 'XS', 'X-SMALL': 'XS', 'SMALL': 'S', 'MEDIUM': 'M', 'LARGE': 'L', 'EXTRA LARGE': 'XL', 'X-LARGE': 'XL', 'XX-LARGE': 'XXL', '2X-LARGE': 'XXL' };
    if (WORDS[s]) return WORDS[s];
    if (s === '2XL') return 'XXL';
    if (s === 'SM') return 'S/M';
    if (s === 'ML') return 'M/L';
    if (SIZE_TOKENS.includes(s) || /^\d{1,2}$/.test(s)) return s;
    return '';
  }
  function sizeOf(variant, sku) {
    if (variant) {
      const parts = String(variant).split(/\s*[\/|,]\s*|\s+-\s+/);
      for (let i = parts.length - 1; i >= 0; i--) { const z = normSize(parts[i]); if (z) return z; }
      const whole = normSize(variant); if (whole) return whole;
    }
    if (sku) { const z = normSize(String(sku).split('-').pop()); if (z) return z; }
    return '';
  }
  function inferType(name) {
    if (TYPE_BY_NAME[name]) return TYPE_BY_NAME[name];
    const n = name.toLowerCase();
    const rules = [
      [/jumpsuit|overall|romper/, 'Jumpsuits'], [/dress/, 'Dresses'], [/\bset\b/, 'Sets'],
      [/pant|jean|jogger|skirt|short|legging|trouser/, 'Bottoms'], [/sweater|cardigan|pullover|ruana|poncho/, 'Sweaters'],
      [/jacket|coat|vest|shacket|blazer/, 'Jackets'], [/kimono|duster/, 'Kimonos'],
      [/necklace|earring|bracelet|ring\b|jewelry/, 'Jewelry'], [/boot|sandal|shoe|sneaker|clog/, 'Shoes'],
      [/bralette|brami|bra\b|slip\b|intimate/, 'Intimates'], [/bag|purse|tote|clutch|wallet/, 'Handbags'], [/hat\b|beanie|cap\b/, 'Hats'],
      [/top|tee|tank|blouse|tunic|henley|shirt|cami|hoodie|bodysuit/, 'Tops'],
    ];
    for (const [rx, t] of rules) if (rx.test(n)) return t;
    return 'Other';
  }
  const isBig = r => /too (big|large|loose|long)|runs (big|large)/i.test(r);
  const isSmall = r => /too (small|tight|short)|runs small/i.test(r);
  const isDamage = r => r === DAMAGE_REASON || /damag|defect|broken|flaw/i.test(r);
  const fitDirOf = (b, s) => (!b && !s) ? 'none' : b >= s * 1.5 && b > 0 ? 'big' : s >= b * 1.5 && s > 0 ? 'small' : 'mixed';
  const round1 = n => Math.round(n * 10) / 10;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (d, yr) => `${MONTHS[d.getMonth()]} ${d.getDate()}${yr ? ', ' + d.getFullYear() : ''}`;

  function detect(headers) {
    const map = {}, used = new Set();
    FIELDS.forEach(f => {
      for (const rx of f.pats) {
        const h = headers.find(h => !used.has(h) && rx.test(h.trim()));
        if (h) { map[f.key] = h; used.add(h); break; }
      }
    });
    return map;
  }

  // ── Build all datasets from normalized rows ─────────────────────────────────
  function build(rows, map, fileName) {
    const get = (r, k) => map[k] ? String(r[map[k]] ?? '').trim() : '';
    const recs = [];
    rows.forEach((r, idx) => {
      const name = get(r, 'product');
      if (!name || /unlock free returns|shipping protection|package protection/i.test(name)) return;
      const q = parseInt(get(r, 'qty'), 10);
      const d = map.date ? new Date(get(r, 'date')) : null;
      recs.push({
        name, reason: get(r, 'reason') || 'No reason given', comment: get(r, 'comment'), sku: get(r, 'sku'),
        size: sizeOf(get(r, 'variant'), get(r, 'sku')), type: get(r, 'type') || '',
        qty: q > 0 && q < 50 ? q : 1, date: d && !isNaN(d) ? d : null,
        seq: map.returnId ? (parseFloat(get(r, 'returnId').replace(/[^\d.]/g, '')) || idx) : idx,
      });
    });
    if (!recs.length) throw new Error('No return rows found. Check the Product title column.');

    // Week buckets: by date when available, otherwise by return ID sequence (13 buckets).
    const dated = recs.filter(r => r.date).length >= recs.length * 0.9;
    let weekOf, weeks, dateRange, weekBasis;
    if (dated) {
      const t = recs.filter(r => r.date).map(r => r.date.getTime());
      const min = new Date(Math.min(...t)), max = new Date(Math.max(...t));
      const start = new Date(min.getFullYear(), min.getMonth(), min.getDate());
      const n = Math.max(1, Math.ceil((max - start + 1) / (7 * 864e5)));
      weeks = Array.from({ length: n }, (_, i) => 'W' + String(i + 1).padStart(2, '0'));
      weekOf = r => r.date ? weeks[Math.min(n - 1, Math.floor((r.date - start) / (7 * 864e5)))] : null;
      dateRange = `${fmtDate(min, min.getFullYear() !== max.getFullYear())} – ${fmtDate(max, true)}`;
      weekBasis = 'date';
    } else {
      const sorted = recs.map(r => r.seq).sort((a, b) => a - b);
      const n = 13, cuts = Array.from({ length: n - 1 }, (_, i) => sorted[Math.floor((i + 1) * sorted.length / n)]);
      weeks = Array.from({ length: n }, (_, i) => 'W' + String(i + 1).padStart(2, '0'));
      weekOf = r => { let i = 0; while (i < cuts.length && r.seq >= cuts[i]) i++; return weeks[i]; };
      dateRange = fileName.replace(/\.csv$/i, '');
      weekBasis = 'sequence';
    }

    // Per product aggregation
    const P = {};
    recs.forEach(r => {
      const p = P[r.name] || (P[r.name] = { name: r.name, count: 0, reasons: {}, comments: [], fitBig: 0, fitSmall: 0, damage: 0, type: r.type || inferType(r.name), weekly: {}, sizes: {} });
      p.count += r.qty;
      p.reasons[r.reason] = (p.reasons[r.reason] || 0) + r.qty;
      if (r.comment && p.comments.length < 60 && !p.comments.includes(r.comment)) p.comments.push(r.comment);
      if (isBig(r.reason)) p.fitBig += r.qty; else if (isSmall(r.reason)) p.fitSmall += r.qty;
      if (isDamage(r.reason)) p.damage += r.qty;
      const w = weekOf(r); if (w) p.weekly[w] = (p.weekly[w] || 0) + r.qty;
      if (r.size) {
        const s = p.sizes[r.size] || (p.sizes[r.size] = { size: r.size, count: 0, tooBig: 0, tooSmall: 0, reasons: {}, comments: [], skus: {} });
        s.count += r.qty;
        if (isBig(r.reason)) s.tooBig += r.qty; else if (isSmall(r.reason)) s.tooSmall += r.qty;
        s.reasons[r.reason] = (s.reasons[r.reason] || 0) + r.qty;
        if (r.comment && s.comments.length < 10 && !s.comments.includes(r.comment)) s.comments.push(r.comment);
        if (r.sku) { const k = s.skus[r.sku] || (s.skus[r.sku] = { sku: r.sku, count: 0, reasons: {} }); k.count += r.qty; k.reasons[r.reason] = (k.reasons[r.reason] || 0) + r.qty; }
      }
    });
    const all = Object.values(P).sort((a, b) => b.count - a.count);
    all.forEach(p => { p.fitDir = fitDirOf(p.fitBig, p.fitSmall); });
    const top = all.slice(0, 100);

    const total = recs.reduce((a, r) => a + r.qty, 0);
    const fit = all.reduce((a, p) => a + p.fitBig + p.fitSmall, 0);
    const dmg = all.reduce((a, p) => a + p.damage, 0);
    const byType = {};
    all.forEach(p => { byType[p.type] = (byType[p.type] || 0) + p.count; });

    const newDATA = {
      totalReturns: total, fitIssues: fit, fitIssuePct: round1(fit / total * 100),
      damageIssues: dmg, damagePct: round1(dmg / total * 100),
      byType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
      dateRange, weekBasis, source: fileName, importedAt: new Date().toISOString(),
      products: top.map(p => ({ name: p.name, count: p.count, reasons: Object.fromEntries(Object.entries(p.reasons).sort((a, b) => b[1] - a[1])), comments: p.comments, skus: [], fitDir: p.fitDir, fitBig: p.fitBig, fitSmall: p.fitSmall, damage: p.damage, type: p.type })),
    };

    // Trends (top 50)
    const half = Math.floor(weeks.length / 2);
    const newTREND = {
      weeks,
      products: all.slice(0, 50).map(p => {
        const vals = weeks.map(w => p.weekly[w] || 0);
        const first = vals.slice(0, half).reduce((a, b) => a + b, 0), last = vals.slice(weeks.length - half).reduce((a, b) => a + b, 0);
        const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
        const pct = first > 0 ? Math.round(Math.abs(last - first) / first * 100) : (last > 0 ? 100 : 0);
        const direction = first === 0 && last === 0 ? 'flat' : last >= first * 1.2 ? 'up' : last <= first * 0.8 ? 'down' : 'flat';
        return { name: p.name, weekly: Object.fromEntries(weeks.map((w, i) => [w, vals[i]])), direction, pctChange: pct, hasSpike: vals.some(v => v >= 5 && v >= avg * 2.5) };
      }),
    };

    // Sizes
    const gs = {};
    let sizedTotal = 0;
    all.forEach(p => Object.values(p.sizes).forEach(s => { gs[s.size] = (gs[s.size] || 0) + s.count; sizedTotal += s.count; }));
    const orderIdx = z => { const i = SIZE_ORDER.indexOf(z); return i < 0 ? 100 + (parseInt(z, 10) || 0) : i; };
    const topReasonOf = o => Object.entries(o).sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const newSKU = {
      globalSizes: Object.keys(gs).sort((a, b) => orderIdx(a) - orderIdx(b)).map(z => ({ size: z, count: gs[z], pct: round1(gs[z] / (sizedTotal || 1) * 100) })),
      products: top.filter(p => Object.keys(p.sizes).length).map(p => {
        const st = Object.values(p.sizes).reduce((a, s) => a + s.count, 0);
        return {
          name: p.name, total: p.count,
          sizes: Object.values(p.sizes).sort((a, b) => b.count - a.count).map(s => ({
            size: s.size, count: s.count, pct: Math.round(s.count / st * 100), tooBig: s.tooBig, tooSmall: s.tooSmall,
            fitDir: fitDirOf(s.tooBig, s.tooSmall), reasons: Object.fromEntries(Object.entries(s.reasons).sort((a, b) => b[1] - a[1])),
            comments: s.comments,
            skus: Object.values(s.skus).sort((a, b) => b.count - a.count).map(k => { const [tr, tc] = topReasonOf(k.reasons); return { sku: k.sku, count: k.count, topReason: tr, topReasonCount: tc }; }),
          })),
        };
      }),
    };

    // Outliers
    const byCat = {};
    all.forEach(p => (byCat[p.type] = byCat[p.type] || []).push(p.count));
    const stats = {};
    Object.entries(byCat).forEach(([c, xs]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length); stats[c] = { m, sd }; });
    const volumeOutliers = all.map(p => { const s = stats[p.type]; const z = s.sd > 0 ? (p.count - s.m) / s.sd : 0; return { p, z, s }; })
      .filter(o => o.z >= 2 && o.p.count >= 10).sort((a, b) => b.z - a.z).slice(0, 15)
      .map(({ p, z, s }) => ({ name: p.name, count: p.count, cat: p.type, zScore: round1(z), catAvg: round1(s.m), topReason: topReasonOf(p.reasons)[0], fitDir: p.fitDir, damage: p.damage }));
    const spikeOutliers = newTREND.products.map(tp => {
      const vals = weeks.map(w => tp.weekly[w]); const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      let best = null; vals.forEach((v, i) => { if (v >= 5 && avg > 0 && v >= avg * 2.5 && (!best || v / avg > best.multiple)) best = { week: weeks[i], weekNum: i + 1, count: v, weekAvg: round1(avg), multiple: round1(v / avg) }; });
      return best && { name: tp.name, ...best, cat: P[tp.name].type };
    }).filter(Boolean).sort((a, b) => b.multiple - a.multiple).slice(0, 10);
    const sizeAnomalies = [];
    newSKU.products.forEach(p => { const st = p.sizes.reduce((a, s) => a + s.count, 0); if (st < 20) return; p.sizes.forEach(s => { if (s.size !== 'OS' && s.count / st > 0.4) sizeAnomalies.push({ name: p.name, size: s.size, count: s.count, pct: Math.round(s.count / st * 100), total: st, fitDir: s.fitDir, tooBig: s.tooBig, tooSmall: s.tooSmall }); }); });
    sizeAnomalies.sort((a, b) => b.count - a.count);
    const newOUT = { volumeOutliers, spikeOutliers, sizeAnomalies: sizeAnomalies.slice(0, 10), dateRange };

    // Retention: customer data stays; refresh return columns from this export.
    const R = JSON.parse(JSON.stringify(PUBLISHED.RETENTION_DATA));
    const qc = {};
    R.products.forEach(p => {
      const src = P[p.name];
      p.returnCount = src ? src.count : 0;
      p.hasReturnData = !!src;
      p.returnRatePct = p.orders > 0 ? round1(p.returnCount / p.orders * 100) : 0;
      const hi = p.returnRatePct >= R.highReturnThreshold, lo = p.retGap < 0;
      p.quadrant = !p.hasReturnData ? (lo ? 'silent_no_data' : 'star_no_data') : hi ? (lo ? 'danger' : 'beloved') : (lo ? 'silent' : 'star');
      qc[p.quadrant] = (qc[p.quadrant] || 0) + 1;
    });
    R.quadrantCounts = qc;
    R.methodology = R.methodology.replace(/Loop data [^.]*/, `Loop data ${dateRange}`);

    return { DATA: newDATA, TREND_DATA: newTREND, SKU_DATA: newSKU, RETENTION_DATA: R, OUTLIERS_DATA: newOUT };
  }

  // ── Apply to the live page ──────────────────────────────────────────────────
  const replace = (target, src) => { Object.keys(target).forEach(k => delete target[k]); Object.assign(target, JSON.parse(JSON.stringify(src))); };
  function applyDatasets(ds) {
    replace(DATA, ds.DATA); replace(TREND_DATA, ds.TREND_DATA); replace(SKU_DATA, ds.SKU_DATA);
    replace(RETENTION_DATA, ds.RETENTION_DATA); replace(OUTLIERS_DATA, ds.OUTLIERS_DATA);
    if (typeof applyShopifyRates === 'function') applyShopifyRates();
    const sel = $('filter-type'); while (sel.options.length > 1) sel.remove(1);
    ['ai-out', 'fb-ai-out'].forEach(id => { const el = $(id); if (el) el.textContent = ''; });
    const on = document.querySelector('.tab.on')?.dataset.t || 'overview';
    Object.keys(rendered).forEach(k => { rendered[k] = false; });
    renderOverview(); renderFit(); rendered.overview = rendered.fit = true;
    if (on !== 'overview' && on !== 'fit') switchTab(on);
    updateBar();
  }

  function updateBar() {
    const imported = !!DATA.importedAt;
    $('imp-src').textContent = imported
      ? `Data: ${DATA.source} · imported ${new Date(DATA.importedAt).toLocaleDateString()}`
      : 'Data: published snapshot';
    $('imp-dl').hidden = !imported;
    $('imp-reset').hidden = !imported;
  }

  function dataJs(ds) {
    return '// Returns snapshot data. Generated by the dashboard importer from ' + ds.DATA.source + ' on ' + ds.DATA.importedAt + '\n' +
      ['DATA', 'TREND_DATA', 'SKU_DATA', 'RETENTION_DATA', 'OUTLIERS_DATA'].map(k => `const ${k} = ${JSON.stringify(ds[k])};`).join('\n') + '\n';
  }

  // ── Mapping dialog ──────────────────────────────────────────────────────────
  let _parsed = null;
  function openMap(fileName, headers, rows) {
    _parsed = { fileName, rows };
    const map = detect(headers);
    const opts = h => `<option value="">— none —</option>` + headers.map(x => `<option ${x === h ? 'selected' : ''}>${esc(x)}</option>`).join('');
    $('imp-fields').innerHTML = FIELDS.map(f => `<label class="imp-row"><span>${f.label}${f.required ? ' <b class="bad">*</b>' : ''}</span>
      <select data-k="${f.key}">${opts(map[f.key])}</select></label>`).join('');
    $('imp-meta').textContent = `${fileName} · ${rows.length.toLocaleString()} rows · ${headers.length} columns`;
    $('imp-err').textContent = '';
    $('imp-dlg').showModal();
  }
  function runBuild() {
    const map = {};
    document.querySelectorAll('#imp-fields select').forEach(s => { if (s.value) map[s.dataset.k] = s.value; });
    const miss = FIELDS.filter(f => f.required && !map[f.key]).map(f => f.label);
    if (miss.length) { $('imp-err').textContent = 'Pick a column for: ' + miss.join(', '); return; }
    try {
      const ds = build(_parsed.rows, map, _parsed.fileName);
      try { localStorage.setItem(LS_KEY, JSON.stringify(ds)); } catch (e) { /* too big or blocked: still applies for this visit */ }
      applyDatasets(ds);
      $('imp-dlg').close();
    } catch (e) { $('imp-err').textContent = e.message; }
  }

  function onFile(file) {
    if (!file) return;
    if (!window.Papa) { alertBar('CSV parser didn’t load. Refresh and try again.'); return; }
    $('imp-src').textContent = 'Reading ' + file.name + '…';
    Papa.parse(file, {
      header: true, skipEmptyLines: 'greedy', worker: false,
      complete: res => {
        const headers = (res.meta.fields || []).filter(Boolean);
        if (!headers.length || !res.data.length) { alertBar('That file has no rows.'); updateBar(); return; }
        updateBar();
        openMap(file.name, headers, res.data);
      },
      error: err => { alertBar('Couldn’t read the file: ' + err.message); updateBar(); },
    });
  }
  function alertBar(msg) { $('imp-src').innerHTML = '<span class="err">' + esc(msg) + '</span>'; }

  // ── Wire up ─────────────────────────────────────────────────────────────────
  $('imp-btn').addEventListener('click', () => $('imp-file').click());
  $('imp-file').addEventListener('change', e => { onFile(e.target.files[0]); e.target.value = ''; });
  $('imp-go').addEventListener('click', runBuild);
  $('imp-cancel').addEventListener('click', () => $('imp-dlg').close());
  $('imp-dl').addEventListener('click', () => {
    const ds = { DATA, TREND_DATA, SKU_DATA, RETENTION_DATA, OUTLIERS_DATA };
    const url = URL.createObjectURL(new Blob([dataJs(ds)], { type: 'text/javascript' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'data.js' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('imp-reset').addEventListener('click', () => { try { localStorage.removeItem(LS_KEY); } catch (e) {} applyDatasets(PUBLISHED); });

  // Restore a previous import in this browser, unless the published data is newer.
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    const pubAt = PUBLISHED.DATA.importedAt ? Date.parse(PUBLISHED.DATA.importedAt) : 0;
    if (saved?.DATA?.importedAt && Date.parse(saved.DATA.importedAt) > pubAt) applyDatasets(saved);
    else { if (saved) localStorage.removeItem(LS_KEY); updateBar(); }
  } catch (e) { updateBar(); }

  window.__loopImport = { build, detect, sizeOf };
})();
