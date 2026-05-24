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
  render();
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

function selectEntry(gid) {
  state.selectedId = gid;
  state.tab = 'a';
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === 'a'));
  // gid is "volume:id"; find entry by gid first, fall back to bare id for legacy links
  let e = state.entries.find(x => x.gid === gid);
  if (!e) e = state.entries.find(x => x.id === gid);
  if (!e) return;
  const grammar = e.stem ? `<span class="grammar">${e.stem}. ${escapeHtml(e.grammar || '')}</span>`
                         : `<span class="grammar">${escapeHtml(e.grammar || '')}</span>`;
  const volLabel = e.volume === 'alif' ? 'Vol. 1 (Alif)' : 'Vol. 2 (Bāʾ)';
  document.getElementById('entry').innerHTML = `
    <div class="entry-head">
      <span class="pdf-page">${volLabel} · PDF page ${e.pdf_page_start}</span>
      <div class="root">root ${escapeHtml(e.root || '')}</div>
      <span class="arabic">${escapeHtml(e.arabic || '')}</span>
      <span class="translit">${escapeHtml(e.translit || '')}</span>
      ${grammar}
    </div>
    <div class="entry-body">${e.body_html || '<em>(no body parsed)</em>'}</div>
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
    body.querySelectorAll('a[data-jump]').forEach(a => {
      a.addEventListener('click', ev => {
        ev.preventDefault();
        selectEntry(a.dataset.jump);
      });
    });
  }
  document.querySelectorAll('#list li').forEach(li =>
    li.classList.toggle('selected', li.dataset.id === e.gid));
  const sel = document.querySelector('#list li.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function selectGloss(idx) {
  const g = state.glossary[idx];
  state.selectedId = 'g_' + idx;
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

loadData().catch(err => {
  document.getElementById('entry').innerHTML =
    `<div class="welcome"><h2>Couldn't load data</h2><p>${err.message}</p></div>`;
});
