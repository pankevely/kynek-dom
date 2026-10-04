// Dom v Kynku – 3D walk-through (first-person) + model view (orbit, cutaway, layers, sun).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const EYE = 1.65;            // eye height (m)
const RADIUS = 0.25;         // walker radius for collision (m)
const SPEED_WALK = 1.4;      // m/s
const SPEED_RUN = 3.5;       // m/s
const LAT = 48.31, LON = 18.04;   // rounded on purpose (~1 km) – enough for sun position
const SPAWN = { x: 4.5, z: -4.2, yaw: Math.PI };   // outside the entrance (street side), facing the house

const CAT_STYLE = {
  obvodove_mury: { color: 0xf1efe9, edges: true },
  nosna_pricka: { color: 0xf1efe9, edges: true },
  pricky: { color: 0xf3f1ec, edges: true },
  zateplenie: { color: 0xeeebe4, edges: true },
  zaklady: { color: 0xa8a49b, edges: true },
};

export async function createWalk(root, { rooms, walls, meta }) {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const ceilingH = meta.assumptions?.ceiling_clear_height_m ?? 2.6;
  const rot = THREE.MathUtils.degToRad(meta.assumptions?.house_rotation_deg ?? 0);

  // ── DOM
  root.innerHTML = `
    <div class="w-canvas"></div>
    <div class="w-ui ${isTouch ? 'touch' : ''}">
      <div class="w-labels"></div>
      <div class="w-cross"></div>
      <div class="w-top">
        <div class="seg glass" role="group" aria-label="Režim">
          <button type="button" data-mode="walk" aria-pressed="false">Prechádzka</button>
          <button type="button" data-mode="orbit" aria-pressed="false">Model</button>
        </div>
        <div class="w-room glass" aria-live="polite"></div>
      </div>
      <div class="w-panel glass" aria-label="Nastavenia modelu">
        <section>
          <h4>Rez</h4>
          <div class="row"><span>Výška rezu</span><b class="cut-val"></b></div>
          <input type="range" class="cut" min="0.6" max="3.2" step="0.05" value="1.2" aria-label="Výška rezu">
          <p class="note">Steny nad touto výškou sú odrezané, aby bolo vidno dovnútra. Úplne vpravo = bez rezu.</p>
        </section>
        <section>
          <h4>Slnko</h4>
          <div class="chips sun-days"></div>
          <div class="row"><span>Čas</span><b class="sun-val"></b></div>
          <input type="range" class="sun" min="300" max="1290" step="15" value="840" aria-label="Čas dňa">
          <p class="note sun-note"></p>
        </section>
        <section>
          <h4>Vrstvy</h4>
          <div class="layers"></div>
        </section>
      </div>
      <button type="button" class="w-panel-toggle glass">Nastavenia</button>
      <div class="w-joy" aria-hidden="true"><i></i></div>
      <button type="button" class="w-run glass" aria-pressed="false">Beh</button>
      <div class="w-help glass">Klik = vstup · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / šípky · myš · <kbd>Shift</kbd> beh · <kbd>Esc</kbd></div>
      <div class="w-start">
        <div class="w-start-card">
          <h3>Prejdite sa domom</h3>
          ${isTouch ? `
          <p>Stojíte pred vchodom z ulice. Ľavým palcom choďte, pravým ťahaním sa rozhliadajte. Tlačidlo <b>Beh</b> prepína rýchlosť.</p>
          <p>Posuvnými dverami sa dá vyjsť do záhrady.</p>` : `
          <p>Stojíte pred vchodom z ulice. Kliknite do obrazu – myš potom ovláda pohľad.</p>
          <div class="keys">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>alebo šípky – chôdza</span>
            <span><kbd>Shift</kbd></span><span>držte – beh</span>
            <span><kbd>Esc</kbd></span><span>uvoľní myš</span>
          </div>
          <p>Posuvnými dverami sa dá vyjsť do záhrady.</p>`}
          <button type="button" class="btn primary">Začať</button>
        </div>
      </div>
      <div class="w-loading"><div><div>Načítavam model domu…</div><div class="bar"><i></i></div></div></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const ui = $('.w-ui');

  // ── Renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  $('.w-canvas').appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;

  const scene = new THREE.Scene();
  const SKY = new THREE.Color(0xdfe6ea);
  scene.background = SKY;
  scene.fog = new THREE.Fog(SKY, 60, 160);

  const center = new THREE.Vector3((walls.bounds.min[0] + walls.bounds.max[0]) / 2, 0, (walls.bounds.min[1] + walls.bounds.max[1]) / 2);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400);
  camera.rotation.order = 'YXZ';

  const hemi = new THREE.HemisphereLight(0xeef3f6, 0xd8d2c4, 1.6);
  const fill = new THREE.AmbientLight(0xffffff, 0.0);
  scene.add(fill);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e2, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 120 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.target.position.copy(center);
  scene.add(sun, sun.target);

  // ground
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ color: 0xc9cfbc, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, -0.03, center.z);
  ground.receiveShadow = true;
  scene.add(ground);

  // clipping plane for the cutaway (model mode)
  const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2);
  const clip = [cut];

  // ceiling + roof cap (assumed – the roof is not in the export yet)
  const fpShape = new THREE.Shape(walls.footprint.map(([x, z]) => new THREE.Vector2(x, z)));
  const ceilGeo = new THREE.ShapeGeometry(fpShape); ceilGeo.rotateX(Math.PI / 2);
  const ceiling = new THREE.Mesh(ceilGeo, new THREE.MeshStandardMaterial({ color: 0xf6f5f1, roughness: 1, side: THREE.FrontSide }));
  ceiling.position.y = ceilingH;
  const roofGeo = new THREE.ShapeGeometry(fpShape); roofGeo.rotateX(-Math.PI / 2);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x8d918a, roughness: 1 }));
  roof.position.y = ceilingH + 0.02;
  // roofGeo after rotateX(-90°) maps shape y -> -z; mirror back so it matches the footprint
  roof.scale.z = -1;
  ceiling.castShadow = roof.castShadow = true;
  ceiling.receiveShadow = true;
  scene.add(ceiling, roof);

  // ── Load model
  const byCat = new Map();
  const floorMats = {
    wood: new THREE.MeshStandardMaterial({ color: 0xc9a77f, roughness: 0.75 }),
    tile: new THREE.MeshStandardMaterial({ color: 0xcfd1cd, roughness: 0.5 }),
    entry: new THREE.MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.7 }),
    slab: new THREE.MeshStandardMaterial({ color: 0x9f9b93, roughness: 1 }),
  };
  const roomKind = Object.fromEntries(rooms.map((r) => [r.id, r.kind]));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x2a2c2b, transparent: true, opacity: 0.28, clippingPlanes: clip });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xa9c1cc, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: clip });
  const catMats = {};
  for (const [k, s] of Object.entries(CAT_STYLE)) catMats[k] = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.95, side: THREE.DoubleSide, clippingPlanes: clip });

  const gltf = await new GLTFLoader().loadAsync('data/model.glb', (ev) => {
    const p = ev.total ? ev.loaded / ev.total : 0.5;
    $('.w-loading .bar i').style.width = `${Math.round(p * 100)}%`;
  });
  const model = gltf.scene;
  const tmpWhite = new THREE.Color(0xffffff);
  model.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name.includes('|') ? o.name : (o.parent?.name || '');
    const [cat = 'zariadenie', , room = ''] = name.split('|');
    o.userData.cat = cat;
    // flat per-face normals (the GLB carries none; smooth normals would blur the hard architectural edges)
    const srcGeo = o.geometry;
    o.geometry = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo;
    o.geometry.computeVertexNormals();
    const orig = o.material;
    let mat;
    if (cat === 'podlaha') {
      const top = new THREE.Box3().setFromObject(o).max.y;
      const kind = roomKind[room];
      mat = top < -0.05 ? floorMats.slab : (kind === 'bath' || kind === 'wc') ? floorMats.tile : (kind === 'entry' ? floorMats.entry : floorMats.wood);
    } else if (catMats[cat]) {
      mat = catMats[cat];
    } else if (orig.transparent || orig.opacity < 0.99) {
      mat = glassMat;
    } else {
      const c = orig.color.clone();
      if (cat === 'zariadenie') c.lerp(tmpWhite, 0.35);
      if (cat === 'okna' || cat === 'portaly') c.set(0x3c4043);
      mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide, clippingPlanes: clip });
    }
    o.material = mat;
    o.castShadow = mat !== glassMat;
    o.receiveShadow = true;
    if (CAT_STYLE[cat]?.edges || cat === 'zariadenie') {
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(srcGeo, 28), edgeMat);
      edges.raycast = () => {};
      o.add(edges);
    }
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(o);
  });
  scene.add(model);
  $('.w-loading').remove();

  // ── Layer toggles
  const catVisible = Object.fromEntries(meta.categories.map((c) => [c.key, c.visible]));
  $('.layers').innerHTML = meta.categories.filter((c) => byCat.has(c.key)).map((c) =>
    `<label><input type="checkbox" data-cat="${c.key}" ${c.visible ? 'checked' : ''}> ${c.label}</label>`).join('');
  $('.layers').addEventListener('change', (e) => {
    const k = e.target.dataset.cat; if (!k) return;
    catVisible[k] = e.target.checked; applyVisibility();
  });
  function applyVisibility() {
    for (const [k, objs] of byCat) {
      let v = catVisible[k] ?? true;
      if (mode === 'walk' && k === 'dvere') v = false;    // open passages while walking
      if (mode === 'walk' && k === 'zaklady') v = false;
      objs.forEach((o) => { o.visible = v; });
    }
    ground.visible = !(mode === 'orbit' && catVisible.zaklady);
    ceiling.visible = roof.visible = mode === 'walk';
  }

  // ── Cutaway
  const cutInput = $('.cut');
  function applyCut() {
    const v = parseFloat(cutInput.value);
    const none = v >= 3.15;
    $('.cut-val').textContent = none ? 'bez rezu' : `${v.toFixed(2).replace('.', ',')} m`;
    cut.constant = mode === 'walk' || none ? 100 : v;
  }
  cutInput.addEventListener('input', applyCut);

  // ── Sun
  const now = new Date();
  const DAYS = [
    { label: 'Dnes', m: now.getMonth(), d: now.getDate() },
    { label: '21. 12.', m: 11, d: 21, hint: 'zimný slnovrat – slnko najnižšie' },
    { label: '21. 3.', m: 2, d: 21, hint: 'rovnodennosť' },
    { label: '21. 6.', m: 5, d: 21, hint: 'letný slnovrat – slnko najvyššie' },
  ];
  let day = DAYS[0];
  $('.sun-days').innerHTML = DAYS.map((d, i) => `<button type="button" data-i="${i}" aria-pressed="${d === day}">${d.label}</button>`).join('');
  $('.sun-days').addEventListener('click', (e) => {
    const i = e.target.dataset.i; if (i === undefined) return;
    day = DAYS[+i];
    $('.sun-days').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.i === i)));
    applySun();
  });
  const sunInput = $('.sun');
  sunInput.addEventListener('input', applySun);
  function euOffsetHours(y, m, d) {        // Central European (Summer) Time
    const lastSun = (mm) => { const dt = new Date(Date.UTC(y, mm + 1, 0)); return dt.getUTCDate() - dt.getUTCDay(); };
    const t = Date.UTC(y, m, d), a = Date.UTC(y, 2, lastSun(2)), b = Date.UTC(y, 9, lastSun(9));
    return t >= a && t < b ? 2 : 1;
  }
  function applySun() {
    const mins = +sunInput.value, hh = Math.floor(mins / 60), mm = mins % 60;
    $('.sun-val').textContent = `${hh}:${String(mm).padStart(2, '0')}`;
    const y = now.getFullYear();
    const date = new Date(Date.UTC(y, day.m, day.d, hh - euOffsetHours(y, day.m, day.d), mm));
    const SC = window.SunCalc;
    let alt = 0.6, az = 0.4;
    if (SC) { const p = SC.getPosition(date, LAT, LON); alt = p.altitude; az = p.azimuth; }
    // SunCalc azimuth: from south, positive towards west. Build a true-frame vector (east, up, south).
    const east = -Math.cos(alt) * Math.sin(az), south = Math.cos(alt) * Math.cos(az), up = Math.sin(alt);
    const north = -south;
    // model x-axis points rot° CCW from true east -> express in model axes
    const xm = east * Math.cos(rot) + north * Math.sin(rot);
    const nm = -east * Math.sin(rot) + north * Math.cos(rot);
    const dir = new THREE.Vector3(xm, up, -nm).normalize();
    const above = alt > 0.01;
    sun.position.copy(center).addScaledVector(dir, 50);
    sun.intensity = above ? 2.6 * Math.min(1, alt / 0.25 + 0.15) : 0;
    hemi.intensity = (above ? 1.6 : 0.5) * (mode === 'walk' ? 1.35 : 1);
    fill.intensity = mode === 'walk' ? 0.55 : 0.0;
    renderer.toneMappingExposure = above ? 1.1 : 0.85;
    const altDeg = Math.round(THREE.MathUtils.radToDeg(alt));
    $('.sun-note').textContent = (above ? `Výška slnka ${altDeg}°. ` : 'Slnko je pod obzorom. ') +
      (day.hint ? day.hint[0].toUpperCase() + day.hint.slice(1) + '. ' : '') + 'Natočenie domu je zatiaľ odhad podľa ulice.';
  }

  // ── Room labels (model mode) + current room (walk mode)
  const labelBox = $('.w-labels');
  const labels = rooms.map((r) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'w-label';
    el.innerHTML = `${r.short || r.name}<small>${r.area_m2.toLocaleString('sk-SK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²</small>`;
    el.title = `${r.name} – vstúpiť do miestnosti`;
    el.addEventListener('click', () => { location.hash = `#/prechadzka/${encodeURIComponent(r.id)}`; });
    labelBox.appendChild(el);
    return { r, el, p: new THREE.Vector3(r.labelPos[0], 0.3, r.labelPos[1]) };
  });
  const v3 = new THREE.Vector3();
  function updateLabels() {
    if (mode !== 'orbit') return;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    for (const L of labels) {
      v3.copy(L.p).project(camera);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
      L.el.style.display = vis ? '' : 'none';
      if (vis) L.el.style.transform = `translate(-50%,-50%) translate(${(v3.x * 0.5 + 0.5) * w}px, ${(-v3.y * 0.5 + 0.5) * h}px)`;
      L.el.style.left = '0'; L.el.style.top = '0';
    }
  }
  function roomAt(x, z) {
    for (const r of rooms) {
      let inside = false; const P = r.polygon;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, zi] = P[i], [xj, zj] = P[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return r;
    }
    return null;
  }
  let lastRoomId = '-';
  const roomEl = $('.w-room');
  function updateRoomHud(force) {
    if (mode !== 'walk') { roomEl.textContent = isTouch ? 'Ťuknite na miestnosť' : 'Kliknite na miestnosť a vstúpte do nej'; lastRoomId = '-'; return; }
    const r = roomAt(pos.x, pos.y);
    const id = r ? r.id : null;
    if (id === lastRoomId && !force) return;
    lastRoomId = id;
    roomEl.innerHTML = r ? `${r.name}<small>${r.area_m2.toLocaleString('sk-SK', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m²</small>` : 'Exteriér';
  }

  // ── Orbit controls
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.copy(center);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.minDistance = 4;
  orbit.maxDistance = 70;
  const orbitCam = { pos: new THREE.Vector3(center.x + 9, 15, center.z + 16), target: center.clone().add(new THREE.Vector3(0, 0, 0.5)) };

  // ── Walk state
  const segs = new Float32Array(walls.segments.length * 4);
  walls.segments.forEach((s, i) => { segs.set([s[0][0], s[0][1], s[1][0], s[1][1]], i * 4); });
  const bmin = walls.bounds.min, bmax = walls.bounds.max;
  const pos = new THREE.Vector2(SPAWN.x, SPAWN.z);
  let yaw = SPAWN.yaw, pitch = -0.05;
  const keys = new Set();
  let runToggle = false;
  let joy = { x: 0, y: 0 };

  function resolveCollisions(p) {
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (let i = 0; i < segs.length; i += 4) {
        const ax = segs[i], az = segs[i + 1], bx = segs[i + 2], bz = segs[i + 3];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
        let t = ((p.x - ax) * dx + (p.y - az) * dz) / l2; t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cz = az + t * dz;
        let ox = p.x - cx, oz = p.y - cz; const d2 = ox * ox + oz * oz;
        if (d2 < RADIUS * RADIUS) {
          const d = Math.sqrt(d2) || 1e-6; const push = RADIUS - d;
          if (d < 1e-5) { ox = -dz; oz = dx; const n = Math.hypot(ox, oz); ox /= n; oz /= n; p.x += ox * push; p.y += oz * push; }
          else { p.x += (ox / d) * push; p.y += (oz / d) * push; }
          moved = true;
        }
      }
      if (!moved) break;
    }
    p.x = Math.max(bmin[0] - 14, Math.min(bmax[0] + 14, p.x));
    p.y = Math.max(bmin[1] - 14, Math.min(bmax[1] + 14, p.y));
  }
  const step = new THREE.Vector2();
  function updateWalk(dt) {
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    f += -joy.y; s += joy.x;
    const len = Math.hypot(f, s);
    if (len > 0.01) {
      if (len > 1) { f /= len; s /= len; }
      const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || runToggle;
      const speed = (run ? SPEED_RUN : SPEED_WALK) * dt;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      step.set((fx * f + rx * s) * speed, (fz * f + rz * s) * speed);
      const n = Math.max(1, Math.ceil(step.length() / 0.08));
      for (let i = 0; i < n; i++) { pos.x += step.x / n; pos.y += step.y / n; resolveCollisions(pos); }
      updateRoomHud();
    }
    camera.position.set(pos.x, EYE, pos.y);
    camera.rotation.set(pitch, yaw, 0);
  }

  // ── Input: keyboard
  const onKey = (e) => {
    if (mode !== 'walk' || root.hidden) return;
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
    if (!codes.includes(e.code)) return;
    if (e.type === 'keydown') { keys.add(e.code); hideStart(); } else keys.delete(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => keys.clear());

  // ── Input: mouse look (pointer lock, with drag fallback)
  const canvas = renderer.domElement;
  let dragging = false;
  const look = (dx, dy, k = 0.0022) => {
    yaw -= dx * k; pitch -= dy * k;
    pitch = Math.max(-1.35, Math.min(1.35, pitch));
  };
  canvas.addEventListener('mousedown', () => {
    if (mode !== 'walk') return;
    dragging = true;
    if (!isTouch && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* not allowed */ }
    }
    hideStart();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (mode !== 'walk') return;
    const mx = e.movementX || 0, my = e.movementY || 0;
    if (Math.abs(mx) > 250 || Math.abs(my) > 250) return;   // ignore jumps when the pointer gets locked
    if (document.pointerLockElement === canvas || dragging) look(mx, my);
  });

  // ── Input: touch (left = joystick, right = look)
  const joyEl = $('.w-joy'), knob = joyEl.querySelector('i');
  let joyId = null, lookId = null, joyC = { x: 0, y: 0 }, lookLast = { x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
    if (mode !== 'walk') return;
    hideStart();
    for (const t of e.changedTouches) {
      const left = t.clientX < window.innerWidth * 0.45;
      if (left && joyId === null) {
        joyId = t.identifier;
        const r = joyEl.getBoundingClientRect();
        joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        moveJoy(t);
      } else if (lookId === null) { lookId = t.identifier; lookLast = { x: t.clientX, y: t.clientY }; }
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) moveJoy(t);
      else if (t.identifier === lookId) { look(t.clientX - lookLast.x, t.clientY - lookLast.y, 0.005); lookLast = { x: t.clientX, y: t.clientY }; }
    }
    e.preventDefault();
  }, { passive: false });
  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; joy = { x: 0, y: 0 }; knob.style.transform = ''; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);
  function moveJoy(t) {
    let dx = t.clientX - joyC.x, dy = t.clientY - joyC.y; const m = 50, l = Math.hypot(dx, dy);
    if (l > m) { dx *= m / l; dy *= m / l; }
    joy = { x: dx / m, y: dy / m };
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  $('.w-run').addEventListener('click', (e) => {
    runToggle = !runToggle; e.currentTarget.setAttribute('aria-pressed', String(runToggle));
  });

  // ── Start overlay / panel toggle / mode switch
  const startEl = $('.w-start');
  let started = false;
  function hideStart() { if (!started) { started = true; startEl.style.display = 'none'; } }
  startEl.addEventListener('click', () => {
    hideStart();
    if (!isTouch && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* */ } }
    canvas.focus();
  });
  $('.w-panel-toggle').addEventListener('click', () => $('.w-panel').classList.add('open'));
  canvas.addEventListener('pointerdown', () => $('.w-panel').classList.remove('open'));

  let mode = 'orbit';
  function setMode(m) {
    const wasInit = camera.userData.init;
    if (m === mode && wasInit) return;
    camera.userData.init = true;
    if (wasInit && mode === 'orbit') { orbitCam.pos.copy(camera.position); orbitCam.target.copy(orbit.target); }
    mode = m;
    ui.classList.toggle('mode-walk', m === 'walk');
    ui.classList.toggle('mode-orbit', m === 'orbit');
    root.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    orbit.enabled = m === 'orbit';
    if (m === 'orbit') {
      if (document.pointerLockElement) document.exitPointerLock();
      camera.fov = 45; camera.position.copy(orbitCam.pos);
      if (!wasInit && camera.aspect < 1) camera.position.sub(orbitCam.target).multiplyScalar(Math.min(2.4, 1 / Math.pow(camera.aspect, 1.1))).add(orbitCam.target); orbit.target.copy(orbitCam.target); camera.up.set(0, 1, 0); camera.lookAt(orbit.target);
    } else {
      camera.fov = 72;
    }
    camera.updateProjectionMatrix();
    applyVisibility(); applyCut(); applySun(); updateRoomHud(true);
    labels.forEach((L) => { L.el.style.display = m === 'orbit' ? '' : 'none'; });
  }
  root.querySelector('.seg').addEventListener('click', (e) => {
    const m = e.target.dataset.mode; if (!m) return;
    if (m === 'walk' && location.hash.startsWith('#/prechadzka/')) history.replaceState(null, '', '#/prechadzka');
    setMode(m);
  });

  // ── Resize / loop
  function resize() {
    const w = root.clientWidth || 1, h = root.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(root);
  const clock = new THREE.Clock();
  let running = false, frameCount = 0;
  // adaptive quality: if the device renders slowly, drop resolution, then shadows
  let qSamples = 0, qTime = 0, qLevel = 0;
  function adaptQuality(dt) {
    if (qLevel >= 2) return;
    qSamples++; qTime += dt;
    if (qSamples < 45) return;
    const avg = qTime / qSamples; qSamples = 0; qTime = 0;
    if (avg > 0.045) {
      qLevel++;
      if (qLevel === 1) { renderer.setPixelRatio(1); resize(); }
      if (qLevel === 2) {
        renderer.shadowMap.enabled = false; sun.castShadow = false;
        scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      }
    } else qLevel = 2;   // fast enough – stop checking
  }
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    frameCount++;
    const raw = clock.getDelta();
    adaptQuality(raw);
    const dt = Math.min(0.05, raw);
    if (mode === 'walk') updateWalk(dt); else orbit.update();
    updateLabels();
    renderer.render(scene, camera);
  }

  applySun(); applyCut();

  // test hooks (used by automated QA, harmless otherwise)
  window.__kynekWalk = {
    get pos() { return { x: pos.x, z: pos.y }; }, get yaw() { return yaw; }, get mode() { return mode; },
    teleport(x, z, y = yaw, p = -0.05) { pos.set(x, z); yaw = y; pitch = p; updateRoomHud(true); },
    simulate(seconds, codes = ['KeyW']) {        // deterministic stepping for tests
      codes.forEach((c) => keys.add(c));
      for (let t = 0; t < seconds; t += 1 / 60) updateWalk(1 / 60);
      codes.forEach((c) => keys.delete(c));
      updateRoomHud(true);
      return { x: pos.x, z: pos.y, room: roomEl.textContent };
    },
    segments: walls.segments.length, get quality() { return qLevel; }, get keys() { return [...keys]; }, get frames() { return frameCount; },
  };

  return {
    show(roomId) {
      root.hidden = false;
      resize();
      if (roomId) {
        const r = rooms.find((x) => x.id === roomId);
        if (r) { pos.set(r.labelPos[0], r.labelPos[1]); resolveCollisions(pos); yaw = Math.PI; pitch = -0.05; }
        setMode('walk');
      } else if (!camera.userData.init) {
        setMode('orbit');
      }
      if (!running) { running = true; clock.getDelta(); frame(); }
    },
    pause() {
      running = false; keys.clear();
      if (document.pointerLockElement) document.exitPointerLock();
    },
  };
}
