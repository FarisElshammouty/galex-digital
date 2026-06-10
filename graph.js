// ===========================================================================
// GALex Digital — knowledge graph module
// Ego network of an entry:
//   center = Arabic lemma · ring 1 = Greek correspondences (glossary backlinks)
//   ring 2 = sources (author + work, weighted by citation count)
// Hand-rolled force layout (repulsion + springs), rendered as static SVG.
// No external dependencies, keeps the site fully offline-capable.
// ===========================================================================

function buildEntryGlossBacklinks() {
  if (state._glossBacklinks) return state._glossBacklinks;
  const map = new Map(); // gid -> [glossary indices]
  const byTranslit = new Map();
  for (const e of state.entries) {
    const t = (e.translit || '').replace(/[,;.]$/, '');
    if (!t) continue;
    const k = e.volume + '|' + t;
    if (!byTranslit.has(k)) byTranslit.set(k, e);
    if (!byTranslit.has('any|' + t)) byTranslit.set('any|' + t, e);
  }
  for (let i = 0; i < state.glossary.length; i++) {
    const g = state.glossary[i];
    for (const r of (g.refs || [])) {
      for (const part of r.split(/\s*,\s*/)) {
        const word = part.split(/\s/)[0];
        if (!word) continue;
        const target = byTranslit.get(g.volume + '|' + word) || byTranslit.get('any|' + word);
        if (target) {
          if (!map.has(target.gid)) map.set(target.gid, []);
          const arr = map.get(target.gid);
          if (!arr.includes(i)) arr.push(i);
        }
      }
    }
  }
  state._glossBacklinks = map;
  return map;
}

function renderGraphPanel(ul, qNorm) {
  // Sidebar: pick an entry (most-cited first), filtered by current query
  const ranked = state.entries
    .map(e => ({ e, units: (e.paragraphs || []).reduce((n, p) => n + p.belegstellen.length, 0) }))
    .filter(x => x.units > 0)
    .filter(x => state.volume === 'all' || x.e.volume === state.volume)
    .filter(x => !qNorm || matchEntry(x.e, qNorm, state.query))
    .sort((a, b) => b.units - a.units)
    .slice(0, 150);
  ul.innerHTML = '<li class="root-divider">Pick a lemma to graph its relations</li>';
  for (const { e, units } of ranked) {
    const li = document.createElement('li');
    const ar = document.createElement('span');
    ar.className = 'l-ar'; ar.textContent = e.arabic || '';
    const tr = document.createElement('span');
    tr.className = 'l-tr'; tr.textContent = e.translit || '';
    const ct = document.createElement('span');
    ct.className = 'l-gr'; ct.style.fontSize = '12px'; ct.textContent = units;
    li.append(ar, tr, ct);
    li.addEventListener('click', () => showGraph(e.gid));
    ul.appendChild(li);
  }
}

function showGraph(gid, opts = {}) {
  const e = state.entries.find(x => x.gid === gid);
  if (!e) return;
  if (!opts.skipPush) pushHash('#/graph/' + encodeURIComponent(gid));

  // ---- Build nodes & edges -------------------------------------------------
  const nodes = [{ id: 'center', kind: 'entry', label: e.translit || e.id,
                   sub: e.arabic || '', size: 26 }];
  const edges = [];

  const backlinks = buildEntryGlossBacklinks().get(gid) || [];
  const greekSeen = new Set();
  for (const gi of backlinks.slice(0, 18)) {
    const g = state.glossary[gi];
    const lemma = extractGreekLemma(g.headword || '') || g.headword;
    if (greekSeen.has(lemma)) continue;
    greekSeen.add(lemma);
    const nid = 'g' + gi;
    nodes.push({ id: nid, kind: 'greek', label: lemma, glossIdx: gi, size: 16 });
    edges.push({ a: 'center', b: nid, w: 1 });
  }

  const srcCounts = new Map();
  for (const p of (e.paragraphs || [])) {
    for (const b of p.belegstellen) {
      if (!b.author) continue;
      const key = (b.author + (b.work ? ' ' + b.work : '')).trim();
      srcCounts.set(key, (srcCounts.get(key) || 0) + 1);
    }
  }
  const topSrc = [...srcCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
  for (const [label, count] of topSrc) {
    const nid = 's' + label;
    nodes.push({ id: nid, kind: 'source', label, count,
                 size: 10 + Math.min(14, Math.sqrt(count) * 3) });
    edges.push({ a: 'center', b: nid, w: count });
  }

  // ---- Force layout (precomputed, deterministic seed positions) -------------
  const W = 860, H = 560;
  const N = nodes.length;
  const byId = new Map(nodes.map(n => [n.id, n]));
  nodes.forEach((n, i) => {
    if (n.id === 'center') { n.x = W / 2; n.y = H / 2; n.fixed = true; return; }
    const ang = (i / Math.max(1, N - 1)) * Math.PI * 2;
    const r = n.kind === 'greek' ? 150 : 240;
    n.x = W / 2 + r * Math.cos(ang);
    n.y = H / 2 + r * Math.sin(ang);
  });
  for (let tick = 0; tick < 220; tick++) {
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = (i % 2 ? 1 : -1) * 0.5; dy = (j % 2 ? 1 : -1) * 0.5; d2 = 1; }
      const f = 2600 / d2;
      const d = Math.sqrt(d2);
      const fx = f * dx / d, fy = f * dy / d;
      if (!a.fixed) { a.x -= fx; a.y -= fy; }
      if (!b.fixed) { b.x += fx; b.y += fy; }
    }
    for (const ed of edges) {
      const a = byId.get(ed.a), b = byId.get(ed.b);
      const rest = b.kind === 'greek' ? 150 : 230;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = 0.02 * (d - rest);
      const fx = f * dx / d, fy = f * dy / d;
      if (!a.fixed) { a.x += fx; a.y += fy; }
      if (!b.fixed) { b.x -= fx; b.y -= fy; }
    }
    for (const n of nodes) {
      n.x = Math.max(56, Math.min(W - 56, n.x));
      n.y = Math.max(36, Math.min(H - 36, n.y));
    }
  }

  // ---- Render SVG ------------------------------------------------------------
  const COLORS = { entry: '#7c2d12', greek: '#1e40af', source: '#166534' };
  const edgeSvg = edges.map(ed => {
    const a = byId.get(ed.a), b = byId.get(ed.b);
    const wpx = 1 + Math.min(5, Math.log2(1 + ed.w));
    return '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
           '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
           '" stroke="#d4d4d0" stroke-width="' + wpx + '" />';
  }).join('');
  const nodeSvg = nodes.map(n => {
    const fill = COLORS[n.kind];
    let action = '';
    if (n.kind === 'greek') action = 'data-gloss-node="' + n.glossIdx + '"';
    else if (n.kind === 'source') action = 'data-source-node="' + escapeHtml(n.label) + '"';
    else action = 'data-entry-node="' + escapeHtml(gid) + '"';
    const labelY = n.y + n.size + 13;
    const cnt = n.count ? ' (' + n.count + ')' : '';
    const sub = n.sub
      ? '<text x="' + n.x.toFixed(1) + '" y="' + (n.y + 5).toFixed(1) +
        '" text-anchor="middle" font-size="13" fill="#fff">' + escapeHtml(n.sub) + '</text>'
      : '';
    return '<g class="gnode" ' + action + ' style="cursor:pointer">' +
      '<circle cx="' + n.x.toFixed(1) + '" cy="' + n.y.toFixed(1) + '" r="' + n.size +
      '" fill="' + fill + '" fill-opacity="0.88" stroke="#fff" stroke-width="2"/>' +
      '<text x="' + n.x.toFixed(1) + '" y="' + labelY.toFixed(1) +
      '" text-anchor="middle" font-size="' + (n.kind === 'entry' ? 15 : 12) +
      '" fill="#1a1a1a">' + escapeHtml(n.label) + cnt + '</text>' + sub + '</g>';
  }).join('');

  const grkN = greekSeen.size, srcN = topSrc.length;
  document.getElementById('entry').innerHTML =
    '<div class="graph-view">' +
      '<header class="entry-head">' +
        '<span class="pdf-page">Relation graph</span>' +
        '<span class="arabic">' + escapeHtml(e.arabic || '') + '</span>' +
        '<span class="translit">' + escapeHtml(e.translit || '') + '</span>' +
        '<span class="grammar">— ' + grkN + ' Greek correspondence' + (grkN === 1 ? '' : 's') +
        ', ' + srcN + ' source' + (srcN === 1 ? '' : 's') + '</span>' +
      '</header>' +
      '<div class="graph-legend">' +
        '<span><i style="background:#7c2d12"></i> Arabic lemma</span>' +
        '<span><i style="background:#1e40af"></i> Greek correspondence (click → glossary)</span>' +
        '<span><i style="background:#166534"></i> source (click → citations)</span>' +
      '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="graph-svg" role="img" ' +
        'aria-label="Relation graph">' + edgeSvg + nodeSvg + '</svg>' +
      '<p class="hint">Edges to sources are weighted by citation count. ' +
        '<a href="#" id="graph-open-entry">Open the full entry →</a></p>' +
    '</div>';

  document.querySelectorAll('[data-gloss-node]').forEach(g =>
    g.addEventListener('click', () => selectGloss(parseInt(g.dataset.glossNode, 10))));
  document.querySelectorAll('[data-source-node]').forEach(g =>
    g.addEventListener('click', () => showSourceView(g.dataset.sourceNode)));
  const openLink = document.getElementById('graph-open-entry');
  if (openLink) openLink.addEventListener('click', ev => {
    ev.preventDefault(); selectEntry(gid);
  });
  state.selectedId = 'graph:' + gid;
}
