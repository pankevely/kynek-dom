// Dom v Kynku – app shell: routing, home, notebook (Markdown reader), about.
import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';

const view = document.getElementById('view');
const walkView = document.getElementById('walk-view');
const S = { index: null, meta: null, rooms: null, walls: null, walk: null, walkLoading: null };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const PREV_VISIT = store.get('kynek.lastVisit');          // ISO date of the previous visit (or null)
store.set('kynek.lastVisit', new Date().toISOString().slice(0, 10));

const nf = (n, d = 1) => Number(n).toLocaleString('sk-SK', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateSk = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d}. ${m}. ${y}`; };
const isNew = (iso) => PREV_VISIT && iso > PREV_VISIT;

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function loadCore() {
  if (!S.index) {
    [S.index, S.meta, S.rooms, S.walls] = await Promise.all([
      getJSON('content/index.json'), getJSON('data/meta.json'), getJSON('data/rooms.json'), getJSON('data/walls.json'),
    ]);
  }
}

// ───────────────────────── Router
const routes = { domov: renderHome, prechadzka: renderWalk, zapisnik: renderNotebook, 'o-projekte': renderAbout };
async function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || 'domov').split('/').map(decodeURIComponent);
  const name = routes[parts[0]] ? parts[0] : 'domov';
  document.querySelectorAll('.nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.route === name) || a.removeAttribute('aria-current'));
  document.querySelectorAll('.nav a').forEach((a) => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); });
  const walking = name === 'prechadzka';
  walkView.hidden = !walking;
  view.hidden = walking;
  if (!walking && S.walk) S.walk.pause();
  try {
    await loadCore();
    await routes[name](parts.slice(1));
  } catch (e) {
    console.error(e);
    view.hidden = false;
    view.innerHTML = `<div class="wrap error"><h2>Niečo sa nepodarilo načítať.</h2><p>Skúste stránku obnoviť. (${esc(e.message)})</p></div>`;
  }
  if (!walking) { window.scrollTo(0, 0); }
}
window.addEventListener('hashchange', route);
route();

// ───────────────────────── Plan SVG (generated from the model data)
function planSVG({ link = true } = {}) {
  const { walls, rooms, meta } = S;
  const pad = 1.6;
  const b = walls.bounds;
  const x0 = b.min[0] - pad, y0 = b.min[1] - pad, w = b.max[0] - b.min[0] + pad * 2, h = b.max[1] - b.min[1] + pad * 2 + 0.6;
  const pts = (ring) => ring.map((p) => `${p[0]},${p[1]}`).join(' ');
  const path = (poly) => [poly.outer, ...poly.holes].map((r) => 'M' + r.map((p) => `${p[0]},${p[1]}`).join('L') + 'Z').join('');
  const roomEls = rooms.map((r) => {
    const poly = `<polygon class="room" points="${pts(r.polygon)}"><title>${esc(r.name)} – ${nf(r.area_m2)} m²</title></polygon>`;
    return link ? `<a href="#/prechadzka/${encodeURIComponent(r.id)}" aria-label="${esc(r.name)}, ${nf(r.area_m2)} m² – vstúpiť do miestnosti">${poly}</a>` : poly;
  }).join('');
  const labels = rooms.map((r) => {
    const [x, y] = r.labelPos;
    return `<text class="lbl" x="${x}" y="${y - 0.08}" text-anchor="middle">${esc(r.short || r.name)}</text>` +
      `<text class="lbl-a" x="${x}" y="${y + 0.52}" text-anchor="middle">${nf(r.area_m2)} m²</text>`;
  }).join('');
  const rot = meta.assumptions?.house_rotation_deg || 0;     // north arrow
  const nx = b.max[0] + 0.6, ny = b.min[1] + 0.2;
  const north = `<g class="north" transform="translate(${nx} ${ny}) rotate(${-rot})"><path d="M0,-0.75 L0.32,0.35 L0,0.18 L-0.32,0.35 Z"/><text y="0.95" text-anchor="middle">S</text></g>`;
  const sx = b.min[0], sy = b.max[1] + 1.1;
  const scale = `<g class="scale"><line x1="${sx}" y1="${sy}" x2="${sx + 5}" y2="${sy}"/><line x1="${sx}" y1="${sy - 0.15}" x2="${sx}" y2="${sy + 0.15}"/><line x1="${sx + 5}" y1="${sy - 0.15}" x2="${sx + 5}" y2="${sy + 0.15}"/><text x="${sx + 5.3}" y="${sy + 0.12}">5 m</text></g>`;
  return `<svg class="plan-svg" viewBox="${x0} ${y0} ${w} ${h}" role="img" aria-label="Pôdorys domu">
    ${roomEls}
    ${walls.poche_insulation.map((p) => `<path class="insul" fill-rule="evenodd" d="${path(p)}"/>`).join('')}
    ${walls.poche_walls.map((p) => `<path class="poche" fill-rule="evenodd" d="${path(p)}"/>`).join('')}
    ${labels}${north}${scale}
  </svg>`;
}

// ───────────────────────── Home
function renderHome() {
  const f = S.meta.figures;
  const entries = [...S.index.entries].sort((a, b) => (b.updated > a.updated ? 1 : -1)).slice(0, 4);
  view.innerHTML = `
  <div class="wrap fade-in">
    <section class="hero">
      <div>
        <p class="eyebrow">Rodinný dom · Nitra – Kynek</p>
        <h1>Dom, v ktorom sa <em>bude dobre žiť.</em></h1>
        <p class="lede">Pracovný priestor nášho projektu: prechádzka modelom domu, zistenia, otázky a ďalšie kroky – vždy v najnovšej verzii.</p>
        <div class="cta">
          <a class="btn primary" href="#/prechadzka"><svg viewBox="0 0 24 24"><path d="M12 3 3 8v8l9 5 9-5V8z M3 8l9 5 9-5 M12 13v8"/></svg>Prejsť sa domom</a>
          <a class="btn" href="#/zapisnik/otazky-pre-rodicov">Otázky pre vás</a>
        </div>
      </div>
      <figure class="plan-card">
        <span class="plan-hint">Kliknite na miestnosť a vstúpte do nej</span>
        ${planSVG()}
        <figcaption><span>Pôdorys z modelu · rez vo výške 1 m</span><span>Názvy miestností sú pracovné</span></figcaption>
      </figure>
    </section>

    <section class="figures" aria-label="Základné údaje">
      <div class="figure"><b>${nf(f.usable_area_m2)}<small>m²</small></b><span>úžitková plocha (${f.rooms} miestností)</span></div>
      <div class="figure"><b>${nf(f.built_up_area_m2)}<small>m²</small></b><span>zastavaná plocha</span></div>
      <div class="figure"><b>728<small>m²</small></b><span>pozemok · dom zaberá ~25 %</span></div>
      <div class="figure"><b>1<small>podlažie</small></b><span>všetko na jednej úrovni</span></div>
    </section>

    <section class="cols">
      <div>
        <div class="section-title"><h2>Čo je nové</h2><a href="#/zapisnik">Celý zápisník →</a></div>
        <ul class="news">${entries.map((e) => `
          <li><a href="#/zapisnik/${e.slug}"><time datetime="${e.updated}">${dateSk(e.updated)}</time>
            <div><h3>${esc(e.title)}${isNew(e.updated) ? '<span class="badge">Nové</span>' : ''}</h3><p>${esc(e.summary)}</p></div></a></li>`).join('')}
        </ul>
      </div>
      <div>
        <div class="section-title"><h2>Na čo čakáme</h2></div>
        <ol class="waiting">${S.index.waiting.map((w) => `<li>${esc(w.text)}${w.who ? `<small>${esc(w.who)}</small>` : ''}</li>`).join('')}</ol>
      </div>
    </section>
    ${footer()}
  </div>`;
}

function footer() {
  return `<footer class="footer"><span>Dom v Kynku · pracovná verzia</span><span>Údaje z modelu: ${esc(S.meta.generated.replace('T', ' '))}</span></footer>`;
}

// ───────────────────────── Notebook
async function renderNotebook([slug]) {
  if (slug) return renderArticle(slug);
  const cats = [];
  for (const e of S.index.entries) {
    let c = cats.find((x) => x.name === e.category);
    if (!c) cats.push((c = { name: e.category, items: [] }));
    c.items.push(e);
  }
  view.innerHTML = `
  <div class="wrap fade-in">
    <header class="page-head">
      <p class="eyebrow">Zápisník</p>
      <h1>Všetko, čo sme zistili</h1>
      <p>Poznámky, zistenia, otázky a plán. Pribúdajú postupne – čo je od vašej poslednej návštevy nové, má označenie „Nové“.</p>
    </header>
    ${cats.map((c) => `
    <section class="cat">
      <div class="section-title"><h2>${esc(c.name)}</h2></div>
      <div class="cards">${c.items.map((e) => `
        <a class="card" href="#/zapisnik/${e.slug}">
          <h3>${esc(e.title)}${isNew(e.updated) ? '<span class="badge">Nové</span>' : ''}</h3>
          <p>${esc(e.summary)}</p>
          <footer><span>${esc(e.reading || '')}</span><time datetime="${e.updated}">${dateSk(e.updated)}</time></footer>
        </a>`).join('')}
      </div>
    </section>`).join('')}
    ${footer()}
  </div>`;
}

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function renderArticle(slug, { back = true } = {}) {
  const entry = S.index.entries.find((e) => e.slug === slug);
  if (!entry) throw new Error(`Článok „${slug}“ neexistuje`);
  const r = await fetch(`content/${slug}.md`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`content/${slug}.md: ${r.status}`);
  const md = await r.text();
  const html = DOMPurify.sanitize(marked.parse(md, { gfm: true }));
  view.innerHTML = `
  <div class="wrap fade-in">
    <div class="article-layout">
      <nav class="toc" aria-label="Obsah článku"></nav>
      <article>
        ${back ? '<a class="back" href="#/zapisnik">← Zápisník</a>' : ''}
        <div class="prose">${html}</div>
      </article>
    </div>
    ${footer()}
  </div>`;
  const prose = view.querySelector('.prose');
  const h1 = prose.querySelector('h1');
  if (h1) h1.insertAdjacentHTML('afterend', `<p class="meta-line">Aktualizované ${dateSk(entry.updated)}${entry.reading ? ' · ' + esc(entry.reading) : ''}</p>`);
  prose.querySelectorAll('table').forEach((t) => { const w = document.createElement('div'); w.className = 'table-scroll'; t.replaceWith(w); w.appendChild(t); });
  const toc = view.querySelector('.toc');
  const hs = [...prose.querySelectorAll('h2')];
  hs.forEach((h) => { h.id = slugify(h.textContent); });
  toc.innerHTML = hs.length > 1 ? '<p class="eyebrow">Obsah</p>' + hs.map((h) => `<a href="#${h.id}" data-target="${h.id}">${esc(h.textContent)}</a>`).join('') : '';
  toc.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-target]'); if (!a) return;
    ev.preventDefault(); document.getElementById(a.dataset.target)?.scrollIntoView({ behavior: 'smooth' });
  });
}

// ───────────────────────── About
async function renderAbout() {
  await renderArticle('o-projekte', { back: false });
}

// ───────────────────────── Walk-through (lazy-loaded)
async function renderWalk([roomId]) {
  if (!S.walk) {
    if (!S.walkLoading) S.walkLoading = import('./walk.js').then((m) => m.createWalk(walkView, { rooms: S.rooms, walls: S.walls, meta: S.meta }));
    try { S.walk = await S.walkLoading; } catch (e) { S.walkLoading = null; throw e; }
  }
  S.walk.show(roomId || null);
}
