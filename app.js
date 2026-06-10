// GALex Digital - static site logic

const state = {
  // Combined data across volumes
  entries: [],     // Part A entries from all volumes (each carries .volume)
  roots: [],       // unique roots union
  glossary: [],    // Part B entries from all volumes
  tab: 'a',
  query: '',
  volume: 'all',   // 'all' | 'alif' | 'ba'
  selectedId: null,
};

const VOLUME_FILES = [
  { key: 'alif', lex: 'data/lexicon.json',    gloss: 'data/glossary.json' },
  { key: 'ba',   lex: 'data/lexicon_ba.json', gloss: 'data/glossary_ba.json' },
];

async function loadData() {
  const datasets = await Promise.all(
    VOLUME_FILES.map(async v => ({
      key: v.key,
      lex:   await fetch(v.lex).then(r => r.json()),
      gloss: await fetch(v.gloss).then(r => r.json()),
    }))
  );
  // Merge entries, tagging each with volume (already done by parser, but defensive)
  const allEntries = [];
  const allGloss   = [];
  const rootsByKey = new Map();
  for (const d of datasets) {
    for (const e of d.lex.entries) {
      if (!e.volume) e.volume = d.key;
      allEntries.push(e);
    }
    for (const r of d.lex.roots) {
      const k = (r.root_arabic || '') + ':' + d.key;
      rootsByKey.set(k, { ...r, volume: d.key });
    }
    for (const g of d.gloss) {
      if (!g.volume) g.volume = d.key;
      allGloss.push(g);
    }
  }
  state.entries = allEntries;
  state.roots   = [...rootsByKey.values()];
  state.glossary = allGloss;

  // Reassign globally-unique IDs across volumes — Alif has e.id="abadun",
  // Bāʾ could conflict in future. Prefix with volume so cross-links remain stable.
  for (const e of state.entries) e.gid = e.volume + ':' + e.id;

  document.getElementById('stats').textContent =
    `Part A: ${state.entries.length} entries · ${state.roots.length} roots · Part B: ${state.glossary.length} glossary lemmata`;

  // Non-blocking: canonical source bibliography + sign/abbrev tooltips
  fetch('data/sources.json').then(r => r.json()).then(d => {
    state.sourcesMeta = d.sources || {};
    state.abbrevDict  = d.abbreviations || {};
    state.signsDict   = d.signs || {};
  }).catch(() => {});

  render();
}

// Morphological register — loaded lazily on first use of the Forms tab
async function ensureForms() {
  if (state.forms) return state.forms;
  if (!state._formsPromise) {
    state._formsPromise = fetch('data/forms.json').then(r => r.json()).then(d => {
      state.forms = d;
      return d;
    });
  }
  return state._formsPromise;
}

// ---------- search ----------
function normalize(s) {
  return (s || '').toLowerCase()
    // strip Arabic diacritics
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')
    // strip Latin diacritics for forgiving match (ʾ ʿ ḥ ḍ ḫ etc.)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[ʾʿ]/g, '');
}

function matchEntry(entry, qNorm, qRaw) {
  if (!qNorm) return true;
  if (entry._hayRaw === undefined) {
    const hay = [
      entry.arabic || '',
      entry.translit || '',
      entry.grammar || '',
      entry.root || '',
      entry.body_text || '',
    ].join(' ');
    entry._hayRaw = hay;
    entry._hayNorm = normalize(hay);
  }
  if (entry._hayNorm.includes(qNorm)) return true;
  if (qRaw && entry._hayRaw.includes(qRaw)) return true;
  return false;
}

function matchGloss(g, qNorm, qRaw) {
  if (!qNorm) return true;
  if (g._hayRaw === undefined) {
    const hay = (g.headword || '') + ' ' + (g.body || '');
    g._hayRaw = hay;
    g._hayNorm = normalize(hay);
  }
  if (g._hayNorm.includes(qNorm)) return true;
  if (qRaw && g._hayRaw.includes(qRaw)) return true;
  return false;
}

// ---------- render ----------
function render() {
  renderList();
}

function renderList() {
  const ul = document.getElementById('list');
  const q = state.query;
  const qNorm = normalize(q);
  ul.innerHTML = '';

  const inVolume = (item) => state.volume === 'all' || item.volume === state.volume;

  if (state.tab === 'browse') {
    renderBrowsePanel(ul);
    return;
  }
  if (state.tab === 'evidence') {
    renderEvidencePanel(ul, qNorm, q);
    return;
  }
  if (state.tab === 'forms') {
    renderFormsPanel(ul, qNorm);
    return;
  }

  if (state.tab === 'a') {
    const filtered = state.entries.filter(e => inVolume(e) && matchEntry(e, qNorm, q));
    let currentRoot = null;
    let currentVol = null;
    for (const e of filtered) {
      if (e.volume !== currentVol) {
        currentVol = e.volume;
        if (state.volume === 'all') {
          const div = document.createElement('li');
          div.className = 'root-divider';
          div.textContent = e.volume === 'alif' ? '— Vol. 1 (Alif) —' : '— Vol. 2 (Bāʾ) —';
          ul.appendChild(div);
        }
        currentRoot = null;
      }
      if (e.root !== currentRoot) {
        currentRoot = e.root;
        const div = document.createElement('li');
        div.className = 'root-divider';
        div.textContent = e.root;
        ul.appendChild(div);
      }
      const li = document.createElement('li');
      li.dataset.id = e.gid;
      if (e.gid === state.selectedId) li.classList.add('selected');
      li.innerHTML = `
        <span class="l-ar">${escapeHtml(e.arabic || '')}</span>
        <span class="l-tr">${escapeHtml(e.translit || '')}</span>
      `;
      li.addEventListener('click', () => selectEntry(e.gid));
      ul.appendChild(li);
    }
    if (filtered.length === 0) {
      ul.innerHTML = '<li class="root-divider">No matches</li>';
    }
  } else {
    // Collect filtered entries with their absolute indexes — avoids O(n²) indexOf later
    const filtered = [];
    for (let i = 0; i < state.glossary.length; i++) {
      const g = state.glossary[i];
      if (inVolume(g) && matchGloss(g, qNorm, q)) filtered.push({ g, idx: i });
    }
    const max = 500;
    const slice = filtered.slice(0, max);
    let currentLetter = null;
    let currentVol = null;
    for (const { g, idx } of slice) {
      if (g.volume !== currentVol) {
        currentVol = g.volume;
        if (state.volume === 'all') {
          const div = document.createElement('li');
          div.className = 'root-divider';
          div.textContent = g.volume === 'alif' ? '— Vol. 1 (Alif) —' : '— Vol. 2 (Bāʾ) —';
          ul.appendChild(div);
          currentLetter = null;
        }
      }
      if (g.letter && g.letter !== currentLetter) {
        currentLetter = g.letter;
        const div = document.createElement('li');
        div.className = 'root-divider';
        div.textContent = g.letter;
        ul.appendChild(div);
      }
      const li = document.createElement('li');
      const gid = 'g_' + idx;
      li.dataset.gid = idx;
      if (state.selectedId === gid) li.classList.add('selected');
      li.innerHTML = `<span class="l-gr">${escapeHtml(g.headword || '')}</span>`;
      li.addEventListener('click', () => selectGloss(idx));
      ul.appendChild(li);
    }
    if (filtered.length === 0) {
      ul.innerHTML = '<li class="root-divider">No matches</li>';
    } else if (filtered.length > max) {
      const more = document.createElement('li');
      more.className = 'root-divider';
      more.textContent = `… ${filtered.length - max} more (refine search)`;
      ul.appendChild(more);
    }
  }
}

function selectEntry(gid, opts = {}) {
  state.selectedId = gid;
  state.tab = 'a';
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === 'a'));
  let e = state.entries.find(x => x.gid === gid);
  if (!e) e = state.entries.find(x => x.id === gid);
  if (!e) return;
  if (!opts.skipPush) pushHash('#/entry/' + encodeURIComponent(e.gid));
  const grammar = e.stem ? `<span class="grammar">${e.stem}. ${escapeHtml(e.grammar || '')}</span>`
                         : `<span class="grammar">${escapeHtml(e.grammar || '')}</span>`;
  const volLabel = e.volume === 'alif' ? 'Vol. 1 (Alif)' : 'Vol. 2 (Bāʾ)';
  const bodyHtml = renderEntryBody(e);
  document.getElementById('entry').innerHTML = `
    <div class="entry-head">
      <span class="pdf-page">${volLabel} · PDF page ${e.pdf_page_start}</span>
      <div class="root">root ${escapeHtml(e.root || '')}</div>
      <span class="arabic">${escapeHtml(e.arabic || '')}</span>
      <span class="translit">${escapeHtml(e.translit || '')}</span>
      ${grammar}
    </div>
    <div class="entry-body">${bodyHtml}</div>
  `;
  // For cross-ref entries, turn "→target_word" patterns into clickable jumps
  if (e.is_cross_ref) {
    const body = document.querySelector('.entry-body');
    body.innerHTML = body.innerHTML.replace(
      /→\s*([A-Za-zĀāḌḍḤḥḪḫḎḏṢṣṬṭẒẓʿʾĞğŠšÜüÖöÉéÄäĪīŪūʿʾ\-]+)/g,
      (match, word) => {
        const target = state.entries.find(x => x.volume === e.volume &&
          (x.translit || '').replace(/[,;.]$/, '') === word);
        return target ? `→<a href="#" data-jump="${target.gid}">${word}</a>` : match;
      }
    );
  }
  // Hook up all data-jump links (cross-references inside entries)
  document.querySelectorAll('#entry a[data-jump]').forEach(a => {
    a.addEventListener('click', ev => {
      ev.preventDefault();
      selectEntry(a.dataset.jump);
    });
  });
  // Hook up Greek-word → glossary links
  document.querySelectorAll('#entry a[data-gloss]').forEach(a => {
    a.addEventListener('click', ev => {
      ev.preventDefault();
      selectGloss(parseInt(a.dataset.gloss, 10));
    });
  });
  document.querySelectorAll('#list li').forEach(li =>
    li.classList.toggle('selected', li.dataset.id === e.gid));
  const sel = document.querySelector('#list li.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// Render an entry body using the new paragraphs[] structure if available,
// falling back to legacy body_html.
function renderEntryBody(e) {
  if (!e.paragraphs || e.paragraphs.length === 0) {
    return e.body_html || '<em>(no body parsed)</em>';
  }
  const out = [];
  for (const para of e.paragraphs) {
    out.push(renderParagraph(para, e));
  }
  return out.join('\n');
}

function renderParagraph(para, entry) {
  const headerHtml = para.header
    ? `<div class="para-header">${markScripts(escapeHtml(para.header))}</div>`
    : '';
  const cardsHtml = para.belegstellen.map((bs, i) => renderBelegstelle(bs, para, entry, i)).join('\n');
  return `
    <section class="para" data-num="${escapeHtml(para.num)}" id="para-${escapeHtml(para.num)}">
      <header class="para-num"><span class="num">${escapeHtml(para.num)}.</span></header>
      ${headerHtml}
      <div class="belegstellen">${cardsHtml || '<em class="empty">(no evidence units)</em>'}</div>
    </section>
  `;
}

// Build a normalised-Greek-lemma → glossary index. Cached after first use.
function buildGlossaryIndex() {
  if (state._glossaryIndex) return state._glossaryIndex;
  const idx = new Map();
  for (let i = 0; i < state.glossary.length; i++) {
    const g = state.glossary[i];
    const lemma = extractGreekLemma(g.headword || '');
    if (!lemma || lemma.length < 2) continue;
    const key = normGreek(lemma);
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(i);
  }
  state._glossaryIndex = idx;
  return idx;
}

function extractGreekLemma(headword) {
  // The headword typically starts with an optional bullet then the lemma.
  const m = headword.replace(/^[●◆]\s*/, '').match(/^[Ͱ-Ͽἀ-῿\-]+/);
  return m ? m[0] : '';
}

function normGreek(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Linkify any Greek word that matches a glossary lemma. Operates on text that
// has ALREADY been HTML-escaped, so we can safely insert <a> tags.
function linkifyGreek(escapedText, preferredVolume) {
  const idx = buildGlossaryIndex();
  return escapedText.replace(
    /[Ͱ-Ͽἀ-῿]+/g,
    (word) => {
      if (word.length < 2) return word;
      const key = normGreek(word);
      if (!idx.has(key)) return word;
      const matches = idx.get(key);
      // Prefer same-volume; fall back to first match
      let gIdx = matches[0];
      if (preferredVolume) {
        const same = matches.find(i => state.glossary[i].volume === preferredVolume);
        if (same !== undefined) gIdx = same;
      }
      return `<a class="gr-link" href="#/gloss/${gIdx}" data-gloss="${gIdx}">${word}</a>`;
    }
  );
}

// Wrap GALex editorial signs (▬ * ⊗ ! ≅ ≠ ¶ ●) with hover tooltips explaining
// their meaning, sourced from the official Signs list.
function signTooltips(html) {
  if (!state.signsDict) return html;
  return html.replace(/[▬⊗●≅≠¶†]|\*/g, ch => {
    const expl = state.signsDict[ch];
    return expl ? `<abbr class="sign" title="${escapeHtml(expl)}">${ch}</abbr>` : ch;
  });
}

function unitLetter(idx) {
  // 0→a … 25→z, 26→aa, 27→ab … (matches parser's _unit_letter)
  let s = '', n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(97 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function renderBelegstelle(bs, para, entry, idx) {
  const letter = unitLetter(idx);
  const contClass = bs._continuation ? 'continuation' : '';
  const refOnly = bs.ref_only || (!bs.greek && !bs.arabic);
  const refOnlyClass = refOnly ? 'ref-only' : '';
  // Sub-header (Arnzen B1: text between previous unit's end and this unit's
  // colon — e.g. '(a) al-muʾabbadu' or '1.2 αἰών in expr. …')
  const introHtml = bs.intro
    ? `<div class="bs-intro">${linkifyGreek(escapeHtml(bs.intro), entry.volume)}</div>`
    : '';

  // Source line — clickable to filter by author+work
  let sourceLine = '';
  if (bs.author || bs.source_raw) {
    const authorWork = (bs.author || '') + (bs.work ? ' ' + bs.work : '');
    const author = bs.author ? `<span class="bs-author">${escapeHtml(bs.author)}</span>` : '';
    const work = bs.work ? `, <span class="bs-work">${escapeHtml(bs.work)}</span>` : '';
    const ref = bs.reference ? ` <span class="bs-ref">${escapeHtml(bs.reference)}</span>` : '';
    const filterUrl = '#/source/' + encodeURIComponent(authorWork.trim());
    sourceLine = `<a class="bs-source" href="${filterUrl}" data-source="${escapeHtml(authorWork.trim())}" title="Show all citations from this source">${author}${work}${ref}</a>`;
  }

  // Version badge
  const versionBadge = bs.version
    ? `<span class="bs-version" title="Manuscript version">v. ${escapeHtml(bs.version)}</span>`
    : '';

  const greekHtml = bs.greek
    ? `<div class="bs-greek" lang="grc">${linkifyGreek(escapeHtml(bs.greek), entry.volume)}</div>`
    : '';
  const arabicHtml = bs.arabic
    ? `<div class="bs-arabic">${escapeHtml(bs.arabic)}</div>`
    : '';

  const refRow = (bs.arabic_ref || bs.notes)
    ? `<div class="bs-meta">
         ${bs.arabic_ref ? `<span class="bs-aref">Ar. ref: ${signTooltips(escapeHtml(bs.arabic_ref))}</span>` : ''}
         ${bs.notes ? `<span class="bs-notes">${signTooltips(escapeHtml(bs.notes))}</span>` : ''}
       </div>`
    : '';

  return `
    <article class="bs ${contClass} ${refOnlyClass}" id="bs-${escapeHtml(bs.id)}">
      ${introHtml}
      <header class="bs-head">
        <span class="bs-label">${escapeHtml(para.num)}<sub>${letter}</sub></span>
        ${sourceLine}
        ${versionBadge}
      </header>
      ${greekHtml}
      ${arabicHtml}
      ${refRow}
    </article>
  `;
}

function renderEvidencePanel(ul, qNorm, qRaw) {
  if (!qNorm) {
    ul.innerHTML = `<li class="root-divider">Type a query above to search evidence units</li>
      <li class="root-divider">(searches inside Greek &amp; Arabic of every Belegstelle)</li>`;
    return;
  }
  const inVolume = (item) => state.volume === 'all' || item.volume === state.volume;
  const matches = [];
  for (const m of allBelegstellen()) {
    if (!inVolume(m.entry)) continue;
    const hay = [m.bs.greek, m.bs.arabic, m.bs.source_raw, m.bs.author, m.bs.work].join(' ');
    const hayN = normalize(hay);
    if (hayN.includes(qNorm) || (qRaw && hay.includes(qRaw))) {
      matches.push(m);
      if (matches.length >= 300) break;
    }
  }
  ul.innerHTML = `
    <li class="root-divider">${matches.length}${matches.length === 300 ? '+' : ''} matching Belegstellen</li>
    ${matches.map(m => {
      const gid = m.entry.gid;
      const fragment = 'bs-' + m.bs.id;
      const preview = (m.bs.greek || m.bs.arabic || '').slice(0, 80);
      return `<li data-jump-bs="${escapeHtml(gid)}|${escapeHtml(fragment)}" class="ev-item">
        <span class="l-ar">${escapeHtml(m.entry.translit || m.entry.id)} §${escapeHtml(m.paragraph.num)}</span>
        <span class="l-tr">${escapeHtml(preview)}</span>
      </li>`;
    }).join('')}`;
  ul.querySelectorAll('li[data-jump-bs]').forEach(li => {
    li.addEventListener('click', () => {
      const [gid, fragment] = li.dataset.jumpBs.split('|');
      applyHash('#/entry/' + encodeURIComponent(gid) + '/' + fragment);
    });
  });
}

function renderFormsPanel(ul, qNorm) {
  if (!state.forms) {
    ul.innerHTML = '<li class="root-divider">Loading morphological register…</li>';
    ensureForms().then(() => renderList());
    return;
  }
  const list = state.forms;
  let matches;
  if (!qNorm) {
    matches = list.slice(0, 200);
    ul.innerHTML = `<li class="root-divider">${list.length} attested forms — type to filter</li>`;
  } else {
    matches = list.filter(f => {
      if (f._n === undefined) f._n = normalize(f.form + ' ' + f.lemma);
      return f._n.includes(qNorm);
    }).slice(0, 300);
    ul.innerHTML = `<li class="root-divider">${matches.length} matching forms</li>`;
  }
  for (const f of matches) {
    const idx = list.indexOf(f);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="l-tr"><em>${escapeHtml(f.form)}</em></span>
      <span class="l-gr" style="font-size:13px">← ${escapeHtml(f.lemma)}</span>`;
    li.addEventListener('click', () => selectForm(idx));
    ul.appendChild(li);
  }
}

function selectForm(idx) {
  const f = state.forms[idx];
  if (!f) return;
  // Try to link the lemma to a Part A entry. The register's lemma is the bare
  // stem ('aṯṯar'); entry transliterations carry endings ('aṯṯara', 'abadun').
  const lemmaBare = f.lemma.replace(/^al-/, '');
  const target = state.entries.find(e => {
    const t = (e.translit || '').replace(/[,;.]$/, '');
    if (!t) return false;
    const tBare = t.replace(/(un|an|in|a|u|i)$/, '');
    return t === f.lemma || t === lemmaBare ||
           tBare === f.lemma || tBare === lemmaBare;
  });
  const lemmaHtml = target
    ? `<a href="#" data-jump="${target.gid}">${escapeHtml(f.lemma)}</a>`
    : escapeHtml(f.lemma);
  document.getElementById('entry').innerHTML = `
    <div class="entry-head">
      <span class="pdf-page">Morphological register · p. ${f.page}</span>
      <div class="root">attested form</div>
      <span class="translit">${escapeHtml(f.form)}</span>
      <span class="grammar">→ lemma ${lemmaHtml}</span>
    </div>
    <div class="belegstellen">
      ${f.citations.map(c => `
        <article class="bs">
          <div class="bs-greek">${markScripts(escapeHtml(c))}</div>
        </article>`).join('')}
    </div>
  `;
  document.querySelectorAll('#entry a[data-jump]').forEach(a => {
    a.addEventListener('click', ev => {
      ev.preventDefault();
      selectEntry(a.dataset.jump);
    });
  });
}

function renderBrowsePanel(ul) {
  // Group A: by Arabic root
  // Group B: by ancient author (extracted from belegstellen)
  const roots = new Map(); // root_arabic → [entries]
  for (const e of state.entries) {
    if (state.volume !== 'all' && e.volume !== state.volume) continue;
    if (!roots.has(e.root)) roots.set(e.root, []);
    roots.get(e.root).push(e);
  }
  const authors = new Map(); // 'author work' → count
  for (const m of allBelegstellen()) {
    if (state.volume !== 'all' && m.entry.volume !== state.volume) continue;
    if (!m.bs.author) continue;
    const key = (m.bs.author + (m.bs.work ? ' ' + m.bs.work : '')).trim();
    authors.set(key, (authors.get(key) || 0) + 1);
  }
  const sortedAuthors = [...authors.entries()].sort((a, b) => b[1] - a[1]);

  ul.innerHTML = `
    <li class="root-divider">By Arabic root (${roots.size})</li>
    ${[...roots.entries()].map(([r, es]) => `
      <li data-browse-root="${escapeHtml(r)}">
        <span class="l-ar">${escapeHtml(r)}</span>
        <span class="l-tr">${es.length}</span>
      </li>
    `).join('')}
    <li class="root-divider">By ancient author / work (${sortedAuthors.length})</li>
    ${sortedAuthors.slice(0, 80).map(([a, n]) => `
      <li data-browse-source="${escapeHtml(a)}">
        <span class="l-tr">${escapeHtml(a)}</span>
        <span class="l-ar">${n}</span>
      </li>
    `).join('')}
    ${sortedAuthors.length > 80 ? `<li class="root-divider">… ${sortedAuthors.length - 80} more (long tail)</li>` : ''}
  `;
  ul.querySelectorAll('li[data-browse-root]').forEach(li => {
    li.addEventListener('click', () => {
      // Switch back to Part A, search by root
      state.tab = 'a';
      document.querySelectorAll('.tab').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === 'a'));
      // Render Part A scoped to this root by faking a search
      const root = li.dataset.browseRoot;
      const targets = state.entries.filter(e => e.root === root);
      if (targets.length === 1) selectEntry(targets[0].gid);
      else if (targets.length > 0) selectEntry(targets[0].gid);
    });
  });
  ul.querySelectorAll('li[data-browse-source]').forEach(li => {
    li.addEventListener('click', () => {
      applyHash('#/source/' + encodeURIComponent(li.dataset.browseSource));
    });
  });
}

function selectGloss(idx, opts = {}) {
  const g = state.glossary[idx];
  if (!g) return;
  state.selectedId = 'g_' + idx;
  if (!opts.skipPush) pushHash('#/gloss/' + idx);
  // Each raw ref may bundle multiple refs separated by commas.
  // Resolve to an entry in the SAME volume first; fall back to other volume.
  const refLinks = (g.refs || []).flatMap(r => {
    return r.split(/\s*,\s*/).map(part => {
      const word = part.split(/\s/)[0];
      let target = state.entries.find(e =>
        e.volume === g.volume && (e.translit || '').replace(/[,;.]$/, '') === word);
      if (!target) {
        target = state.entries.find(e =>
          (e.translit || '').replace(/[,;.]$/, '') === word);
      }
      if (target) {
        return `<a href="#" data-jump="${target.gid}">${escapeHtml(part)}</a>`;
      }
      return escapeHtml(part);
    });
  });
  const volLabel = g.volume === 'alif' ? 'Vol. 1 (Alif)' : 'Vol. 2 (Bāʾ)';
  document.getElementById('entry').innerHTML = `
    <div class="entry-head">
      <span class="pdf-page">${volLabel} · PDF page ${g.pdf_page}</span>
      <div class="root">letter ${escapeHtml(g.letter)}</div>
      <div class="headword glossary-entry">${escapeHtml(g.headword)}</div>
    </div>
    <div class="glossary-entry">
      <div class="body">${markScripts(escapeHtml(g.body || ''))}</div>
      ${refLinks.length ? `<p style="margin-top:18px"><strong>Links to Part A:</strong> ${refLinks.join(' · ')}</p>` : ''}
    </div>
  `;
  document.querySelectorAll('a[data-jump]').forEach(a => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      selectEntry(a.dataset.jump);
    });
  });
}

// Wrap Arabic and Greek runs in the body string of glossary entries
function markScripts(s) {
  // Greek
  s = s.replace(/([Ͱ-Ͽἀ-῿]+(?:[\s.,;:·()…\-—]+[Ͱ-Ͽἀ-῿]+)*)/g,
    m => `<span class="gr">${m}</span>`);
  // Arabic (rarely appears in Part B but just in case)
  s = s.replace(/([؀-ۿ]+(?:\s+[؀-ۿ]+)*)/g,
    m => `<span class="ar" dir="rtl">${m}</span>`);
  return s;
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// ---------- events ----------
let searchTimer = null;
document.getElementById('q').addEventListener('input', (e) => {
  const v = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = v;
    renderList();
  }, 80);
});

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    state.tab = t.dataset.tab;
    renderList();
  });
});

document.getElementById('vol').addEventListener('change', (e) => {
  state.volume = e.target.value;
  renderList();
});

// Keyboard: '/' focuses search
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== document.getElementById('q')) {
    e.preventDefault();
    document.getElementById('q').focus();
  }
});

// ---------- URL routing ----------
// Hash format:
//   #/                     → welcome screen
//   #/entry/alif:abadun    → open entry in Part A
//   #/entry/alif:abadun/7.4 → open entry, scroll to paragraph 7.4
//   #/entry/alif:abadun/bs-arun_6-7.4-b  → open entry, highlight specific belegstelle
//   #/gloss/12             → open glossary entry by index
//   #/search/<query>       → run a search
//   #/vol/ba               → set volume filter
function applyHash(hash, opts = {}) {
  const h = hash.replace(/^#\/?/, '');
  if (!h) {
    // welcome screen
    state.selectedId = null;
    return;
  }
  const parts = h.split('/');
  if (parts[0] === 'entry' && parts[1]) {
    state.tab = 'a';
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === 'a'));
    // gid is percent-encoded in stored URLs (colon → %3A); decode before matching.
    selectEntry(decodeURIComponent(parts[1]), { skipPush: true });
    if (parts[2]) {
      // Defer to let the entry render fully
      setTimeout(() => {
        const id = parts[2].startsWith('bs-') ? parts[2] : 'para-' + parts[2];
        const target = document.getElementById(id);
        if (!target) return;
        // Scroll the main pane (overflow-y: auto). Use the 2-arg form because
        // the smooth-behavior option is intercepted in some embed contexts.
        const main = document.querySelector('main');
        if (main) main.scrollTo(0, Math.max(0, target.offsetTop - 12));
        else target.scrollIntoView();
        if (parts[2].startsWith('bs-')) {
          document.querySelectorAll('.bs.highlighted').forEach(el => el.classList.remove('highlighted'));
          target.classList.add('highlighted');
        }
      }, 80);
    }
  } else if (parts[0] === 'source' && parts[1]) {
    showSourceView(decodeURIComponent(parts[1]));
    return;
  } else if (parts[0] === 'gloss' && parts[1]) {
    state.tab = 'b';
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === 'b'));
    selectGloss(parseInt(parts[1], 10), { skipPush: true });
  } else if (parts[0] === 'search' && parts[1]) {
    state.query = decodeURIComponent(parts[1]);
    document.getElementById('q').value = state.query;
    renderList();
  } else if (parts[0] === 'vol' && parts[1]) {
    state.volume = parts[1];
    document.getElementById('vol').value = state.volume;
    renderList();
  }
}

function pushHash(hash) {
  if (location.hash !== hash) {
    history.pushState({}, '', hash);
  }
}

// Iterate over every belegstelle in the data and yield matches for a predicate.
function* allBelegstellen() {
  for (const e of state.entries) {
    if (!e.paragraphs) continue;
    for (const p of e.paragraphs) {
      for (const bs of p.belegstellen) {
        yield { bs, paragraph: p, entry: e };
      }
    }
  }
}

function showSourceView(sourceLabel) {
  // Strip volume scope from source label normalisation
  const target = sourceLabel.trim().toLowerCase();
  const matches = [];
  for (const m of allBelegstellen()) {
    const candidate = ((m.bs.author || '') + ' ' + (m.bs.work || '')).trim().toLowerCase();
    if (candidate === target) matches.push(m);
  }
  // Canonical bibliography from the official GALex List of Sources
  const biblio = lookupSourceMeta(sourceLabel);
  const biblioHtml = biblio ? `
    <details class="source-biblio">
      <summary>Bibliography (GALex List of Sources: <strong>${escapeHtml(biblio.abbrev)}</strong>)</summary>
      ${biblio.greek_edition ? `<p><span class="bib-marker">=</span> ${escapeHtml(biblio.greek_edition)}</p>` : ''}
      ${(biblio.arabic_titles || []).filter(Boolean).map(t =>
        `<p><span class="bib-marker">&gt;</span> ${escapeHtml(t)}</p>`).join('')}
      ${(biblio.arabic_editions || []).filter(Boolean).map(t =>
        `<p><span class="bib-marker">¶</span> ${escapeHtml(t)}</p>`).join('')}
      ${(biblio.secondary || []).filter(Boolean).map(t =>
        `<p class="bib-secondary">${escapeHtml(t)}</p>`).join('')}
    </details>` : '';

  const html = `
    <div class="source-view">
      <header class="source-header">
        <span class="source-label">Citations from</span>
        <h2>${escapeHtml(sourceLabel)}</h2>
        <p class="source-meta">${matches.length} belegstelle${matches.length === 1 ? '' : 'n'}</p>
        ${biblioHtml}
      </header>
      <div class="source-list">
        ${matches.slice(0, 200).map(m => `
          <article class="source-item">
            <header class="source-item-head">
              <a class="source-item-ref" href="#/entry/${encodeURIComponent(m.entry.gid)}/bs-${escapeHtml(m.bs.id)}"
                 data-jump-bs="${escapeHtml(m.entry.gid)}|bs-${escapeHtml(m.bs.id)}">
                <strong>${escapeHtml(m.entry.translit || m.entry.arabic || m.entry.id)}</strong>
                <span class="source-item-section">§${escapeHtml(m.paragraph.num)}</span>
                · ${escapeHtml(m.bs.reference || '')}
              </a>
            </header>
            ${m.bs.greek ? `<div class="bs-greek" lang="grc">${linkifyGreek(escapeHtml(m.bs.greek), m.entry.volume)}</div>` : ''}
            ${m.bs.arabic ? `<div class="bs-arabic">${escapeHtml(m.bs.arabic)}</div>` : ''}
          </article>
        `).join('')}
        ${matches.length > 200 ? `<p class="source-truncated">+${matches.length - 200} more</p>` : ''}
      </div>
    </div>
  `;
  document.getElementById('entry').innerHTML = html;
  document.querySelectorAll('a[data-jump-bs]').forEach(a => {
    a.addEventListener('click', ev => {
      ev.preventDefault();
      const [gid, fragment] = a.dataset.jumpBs.split('|');
      applyHash('#/entry/' + encodeURIComponent(gid) + '/' + fragment);
    });
  });
  document.querySelectorAll('#entry a[data-gloss]').forEach(a => {
    a.addEventListener('click', ev => {
      ev.preventDefault();
      selectGloss(parseInt(a.dataset.gloss, 10));
    });
  });
  state.selectedId = 'source:' + sourceLabel;
  document.querySelectorAll('#list li').forEach(li => li.classList.remove('selected'));
}

// Map a source-view label like 'Aristotle Cael.' back to the canonical GALex
// abbreviation ('Arist. Cael.') and return its bibliography record.
const AUTHOR_TO_ABBREV = {
  'Aristotle': 'Arist.', 'Pseudo-Aristotle': 'Ps.-Arist.',
  'Galen': 'Galen', 'Hippocrates': 'Hippocr.', 'Artemidorus': 'Artem.',
  'Alexander of Aphrodisias': 'Alex.', 'Themistius': 'Them.',
  'Philoponus': 'Philop.', 'Porphyry': 'Porph.', 'Euclid': 'Eucl.',
  'Nicomachus': 'Nicom.', 'Dioscorides': 'Diosc.', 'Aelian': 'Aelian.',
  'Pseudo-Plutarch': 'Ps.-Plut.', 'Theology of Aristotle': 'Theol. Arist.',
  'Plato': 'Plato', 'Ptolemy': 'Ptol.',
};

function lookupSourceMeta(label) {
  if (!state.sourcesMeta) return null;
  // label = '<author full> <work>'; split on first space-run after the author name
  for (const [full, abbr] of Object.entries(AUTHOR_TO_ABBREV)) {
    if (label.startsWith(full)) {
      const work = label.slice(full.length).trim();
      const key1 = (abbr + ' ' + work).trim();
      if (state.sourcesMeta[key1]) return state.sourcesMeta[key1];
      // Fuzzy: find a key starting with the abbreviation whose tail matches
      const hit = Object.keys(state.sourcesMeta).find(k =>
        k.startsWith(abbr) && work && k.toLowerCase().includes(work.toLowerCase().split(' ')[0] || ''));
      if (hit) return state.sourcesMeta[hit];
      // Author-only fallback (e.g. 'Plato')
      if (state.sourcesMeta[abbr]) return state.sourcesMeta[abbr];
    }
  }
  return null;
}

// Both events: popstate fires on back/forward when pushState was used; hashchange
// fires on any hash change (more reliable in some embed contexts).
window.addEventListener('popstate', () => applyHash(location.hash));
window.addEventListener('hashchange', () => applyHash(location.hash));

loadData().then(() => {
  if (location.hash) applyHash(location.hash);
}).catch(err => {
  document.getElementById('entry').innerHTML =
    `<div class="welcome"><h2>Couldn't load data</h2><p>${err.message}</p></div>`;
});
