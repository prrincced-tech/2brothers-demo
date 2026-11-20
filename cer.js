// 2 Brothers — ceramic vs bare clearcoat water demo
const st = document.getElementById('cerStage'), ld = document.getElementById('cerLoad');
let started = false;
new IntersectionObserver(([e]) => {
  if (e.isIntersecting && !started) { started = true; go().catch(err => { console.warn(err); ld.textContent = '3D недоступне на цьому пристрої'; }); }
}, { rootMargin: '400px' }).observe(st);

async function go() {
  const T = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const mob = matchMedia('(max-width:900px)').matches, still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const R = new T.WebGLRenderer({ antialias: !mob, alpha: true, powerPreference: 'high-performance' });
  R.setPixelRatio(Math.min(devicePixelRatio, mob ? 1.25 : 1.75));
  R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
  const view = document.getElementById('cerView'); view.appendChild(R.domElement);
  const S = new T.Scene(), C = new T.PerspectiveCamera(mob ? 36 : 28, 1, .05, 60);
  const pm = new T.PMREMGenerator(R);
  S.environment = pm.fromScene(new RoomEnvironment(), .02).texture;

  // ---------- car ----------
  const gltf = await new GLTFLoader().loadAsync('models/car.glb?v=1', e => {
    if (e.total) ld.textContent = 'Завантаження ' + String(Math.round(e.loaded / e.total * 100)).padStart(3, '0') + ' / 100';
  });
  const car = gltf.scene, grp = new T.Group(); grp.add(car); S.add(grp);
  let box = new T.Box3().setFromObject(car), sz = box.getSize(new T.Vector3());
  if (sz.x > sz.z) car.rotation.y = Math.PI / 2;
  car.updateMatrixWorld(true);
  const hl = car.getObjectByName('BodyHeadlights');
  if (hl) {
    const a = new T.Box3().setFromObject(hl).getCenter(new T.Vector3()), b = new T.Box3().setFromObject(car).getCenter(new T.Vector3());
    if (a.z < b.z) car.rotation.y += Math.PI;
  }
  car.updateMatrixWorld(true);
  box.setFromObject(car); sz = box.getSize(new T.Vector3());
  car.scale.multiplyScalar(4.4 / sz.z); car.updateMatrixWorld(true);
  box.setFromObject(car);
  const ctr = box.getCenter(new T.Vector3());
  car.position.x -= ctr.x; car.position.z -= ctr.z; car.position.y -= box.min.y; car.updateMatrixWorld(true);
  box.setFromObject(car);

  const paint = new T.MeshPhysicalMaterial({ color: 0x0b0c0e, metalness: .55, roughness: .4, clearcoat: 1, clearcoatRoughness: .015, envMapIntensity: 1.25 });
  const glass = new T.MeshPhysicalMaterial({ color: 0x040506, metalness: 0, roughness: .02, clearcoat: 1, envMapIntensity: 1.5 });
  const body = [];
  car.traverse(o => {
    if (!o.isMesh) return;
    const n = (o.material && o.material.name) || '';
    if (/^Paint|Panel Sides/.test(n)) { o.material = paint; if (!/Mirror/i.test(o.name)) body.push(o); }
    else if (/Glass/i.test(n)) { o.material = glass; body.push(o); }
    else if (o.material && o.material.transmission) o.material.transmission = 0;
  });

  // soft contact shadow
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g2 = cv.getContext('2d'), gr = g2.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
  const sh = new T.Mesh(new T.PlaneGeometry(sz.x * 1.0 * (4.4 / sz.z) + 1.2, 5.6), new T.MeshBasicMaterial({ map: new T.CanvasTexture(cv), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = .002; S.add(sh);

  // ---------- heightfield of the top surfaces (GPU, top-down) ----------
  const fx = box.max.x + .05, fz = box.max.z + .05, y1 = box.max.y + .01;
  const GX = mob ? 180 : 240, GZ = Math.round(GX * fz / fx);
  const hm = new T.ShaderMaterial({
    uniforms: { y1: { value: y1 }, mode: { value: 0 } }, side: T.DoubleSide,
    vertexShader: 'varying vec3 n;varying float wy;void main(){vec4 w=modelMatrix*vec4(position,1.);wy=w.y;n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*w;}',
    fragmentShader: 'uniform float y1;uniform int mode;varying vec3 n;varying float wy;void main(){vec3 m=normalize(n);if(!gl_FrontFacing)m=-m;if(mode==0){gl_FragColor=vec4(m*.5+.5,1.);}else{float h=clamp(wy/y1,0.,1.)*65535.;gl_FragColor=vec4(floor(h/256.)/255.,mod(h,256.)/255.,0.,1.);}}'
  });
  const oc = new T.OrthographicCamera(-fx, fx, fz, -fz, .1, 20); oc.position.set(0, 10, 0); oc.up.set(0, 0, -1); oc.lookAt(0, 0, 0);
  const rt = new T.WebGLRenderTarget(GX, GZ), nrm = new Uint8Array(GX * GZ * 4), hgt = new Uint8Array(GX * GZ * 4);
  const vis = []; S.traverse(o => { if (o.isMesh) { vis.push([o, o.visible]); if (!body.includes(o)) o.visible = false; } });
  const envKeep = S.environment; S.overrideMaterial = hm; R.setClearColor(0, 0);
  for (const [mode, buf] of [[0, nrm], [1, hgt]]) {
    hm.uniforms.mode.value = mode; R.setRenderTarget(rt); R.clear(); R.render(S, oc); R.readRenderTargetPixels(rt, 0, 0, GX, GZ, buf);
  }
  R.setRenderTarget(null); S.overrideMaterial = null; S.environment = envKeep; vis.forEach(([o, v]) => o.visible = v); rt.dispose();
  const N0 = new T.Vector3();
  function sam(x, z, out) {
    const i = Math.floor((x + fx) / (2 * fx) * GX), j = Math.floor((fz - z) / (2 * fz) * GZ);
    if (i < 0 || j < 0 || i >= GX || j >= GZ) return false;
    const k = (j * GX + i) * 4;
    if (nrm[k + 3] < 128) return false;
    out.h = (hgt[k] * 256 + hgt[k + 1]) / 65535 * y1;
    out.nx = nrm[k] / 127.5 - 1; out.ny = nrm[k + 1] / 127.5 - 1; out.nz = nrm[k + 2] / 127.5 - 1;
    return out.ny > .2;
  }

  const q2 = {};
  function edge(x, z, h) { for (const [a, b] of [[.045, 0], [-.045, 0], [0, .045], [0, -.045]]) if (!sam(x + a, z + b, q2) || Math.abs(q2.h - h) > .025) return true; return false; }

  // ---------- masking tape along the centre line ----------
  {
    const pos = [], idx = [], q = {}; let prev = -1;
    for (let j = 0; j < GZ; j++) {
      const z = fz - (j + .5) / GZ * 2 * fz;
      if (!sam(0, z, q) || q.ny < .35) { prev = -1; continue; }
      const v = pos.length / 3, y = q.h + .0025;
      pos.push(-.01, y, z, .01, y, z);
      if (prev >= 0) idx.push(prev, prev + 1, v, prev + 1, v + 1, v);
      prev = v;
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    S.add(new T.Mesh(g, new T.MeshStandardMaterial({ color: 0xa89f88, roughness: .9, side: T.DoubleSide })));
  }

  // ---------- water ----------
  const water = mob
    ? new T.MeshPhysicalMaterial({ color: 0x06070a, metalness: 0, roughness: .03, ior: 1.33, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 1.6 })
    : new T.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, thickness: .012, ior: 1.33, specularIntensity: 1, envMapIntensity: .9 });
  const key = new T.DirectionalLight(0xffffff, 3); key.position.set(-2, 6, 4); S.add(key);
  const bg = new T.SphereGeometry(1, mob ? 10 : 22, mob ? 6 : 14, 0, Math.PI * 2, 0, 2.05); bg.translate(0, -Math.cos(2.05), 0);
  const pg = new T.SphereGeometry(1, mob ? 12 : 26, mob ? 4 : 10, 0, Math.PI * 2, 0, 1.25); pg.translate(0, -Math.cos(1.25), 0);
  const NB = mob ? 240 : 650, NP = mob ? 220 : 600;
  const beads = new T.InstancedMesh(bg, water, NB), pud = new T.InstancedMesh(pg, water, NP);
  beads.frustumCulled = pud.frustumCulled = false; S.add(beads, pud);
  const B = [], P = [], rnd = (a, b) => a + Math.random() * (b - a), q = {};
  let rolled = 0, dry = 0;
  function drop(px, pz) {
    const x = px ?? rnd(-fx, fx), z = pz ?? rnd(-fz, fz);
    if (!sam(x, z, q) || q.ny < .6 || Math.abs(x) < .02 || edge(x, z, q.h)) return;
    if (x < 0) {
      if (dry > 0 && px === undefined) return;
      if (B.length < NB) B.push({ x, z, vx: 0, vz: 0, r: rnd(.011, .03), a: 0, f: 0, y: q.h, vy: 0, nx: q.nx, ny: q.ny, nz: q.nz });
    } else {
      let near = null; for (const p of P) if (Math.hypot(p.x - x, p.z - z) < p.r + .006) { near = p; break; }
      if (near && near.g < .055) { near.g = Math.min(.055, near.g + .004); return; }
      if (P.length < NP) P.push({ x, z, r: 0, g: Math.random() < .15 ? rnd(.035, .055) : rnd(.012, .032), e: rnd(.75, 1.3), t: rnd(0, 6.28), y: q.h, nx: q.nx, ny: q.ny, nz: q.nz });
    }
  }
  for (let i = 0; i < (mob ? 1700 : 4200); i++) drop();
  B.forEach(b => b.a = 1); P.forEach(p => p.r = p.g);

  // ---------- camera, scroll story & input ----------
  const STEP = 5.5; let tl = 0;
  const railFill = f => rail[step] && rail[step].style.setProperty('--f', f.toFixed(3));
  const hz = box.max.z * .42, hh = x => (sam(x, hz, q) ? q.h : box.max.y * .6);
  const K = [
    { t: new T.Vector3(0, box.max.y * .42, box.max.z * .18), az: .35, el: .42, d: 0 },
    { t: new T.Vector3(-.5, hh(-.5), hz), az: -.6, el: .5, m: mob ? .62 : .42 },
    { t: new T.Vector3(.5, hh(.5), hz), az: .6, el: .5, m: mob ? .62 : .42 },
    { t: new T.Vector3(0, box.max.y * .42, box.max.z * .05), az: -.15, el: .5, d: 0 },
  ];
  const TX = [
    ['01 — Дощ', 'вода<br>скочується сама', 'ліворуч від стрічки кераміка, праворуч голий лак. торкнись авто, щоб пішов дощ.'],
    ['02 — Кераміка', 'вода збирається<br>в кульки', 'гідрофобний шар не дає воді зачепитись. кульки скочуються навіть із ледь похилого капота і забирають бруд із собою.'],
    ['03 — Голий лак', 'а тут вона<br>лежить плямами', 'без захисту вода розтікається і висихає на місці. звідси вапняні плями і матовий наліт після кожної мийки.'],
    ['04 — Мийка', 'одна мийка —<br>і все видно', 'ліва половина вже суха, права ні. проведи по авто, щоб полити ще, або запишись на кераміку.'],
  ];
  const sw = document.getElementById('cSw'), eS = document.getElementById('cStep'), eH = document.getElementById('cH'), eP = document.getElementById('cP'), rail = [...st.querySelectorAll('.rail button')];
  let step = 0, uaz = 0, uel = 0, down = false, lx = 0, ly = 0, last = -1e9, wash = 0, swT = 0;
  function setStep(k) {
    if (k === step) return; const prev = step; step = k;
    rail.forEach((r, i) => r.classList.toggle('on', i === k));
    sw.classList.add('out'); clearTimeout(swT);
    swT = setTimeout(() => { eS.textContent = TX[k][0]; eH.innerHTML = TX[k][1]; eP.textContent = TX[k][2]; sw.classList.remove('out'); }, 300);
    if (k === 3 && prev < 3) wash = 1.8;
    if (k < 3 && prev === 3) for (let i = 0; i < (mob ? 1400 : 2200); i++) drop();
  }
  rail.forEach((r, i) => r.addEventListener('click', () => { tl = i * STEP + .01; }));
  const ray = new T.Raycaster(), ndc = new T.Vector2(), pp = new T.Vector3();
  function rain(cx, cy, n) {
    const r = view.getBoundingClientRect(); ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, C); const o0 = ray.ray.origin, d = ray.ray.direction;
    for (let t = .3; t < 25; t += .012) {
      pp.copy(d).multiplyScalar(t).add(o0);
      if (pp.y < 0) return;
      if (Math.abs(pp.x) < fx && Math.abs(pp.z) < fz && sam(pp.x, pp.z, q) && pp.y <= q.h + .003) {
        const hx = pp.x, hzz = pp.z;
        for (let i = 0; i < n; i++) drop(hx + rnd(-.07, .07), hzz + rnd(-.07, .07));
        return;
      }
    }
  }
  let lastRain = 0;
  st.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' || e.target.closest('button,a')) return; down = true; lx = e.clientX; ly = e.clientY; last = performance.now(); rain(e.clientX, e.clientY, 6); });
  st.addEventListener('click', e => { if (e.target.closest('button,a') || matchMedia('(pointer:fine)').matches) return; rain(e.clientX, e.clientY, 12); });
  addEventListener('pointerup', () => down = false); addEventListener('pointercancel', () => down = false);
  st.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const n = performance.now();
    if (n - lastRain > 35) { lastRain = n; rain(e.clientX, e.clientY, 3); }
    if (!down) return;
    uaz = Math.max(-1.1, Math.min(1.1, uaz - (e.clientX - lx) * .006));
    if (e.pointerType === 'mouse') uel = Math.max(-.25, Math.min(.35, uel + (e.clientY - ly) * .004));
    lx = e.clientX; ly = e.clientY; last = n;
  });
  const wb = document.getElementById('cerWash');
  wb.addEventListener('click', () => { wash = 1.8; wb.classList.add('on'); setTimeout(() => wb.classList.remove('on'), 1800); });
  const ease = f => f * f * (3 - 2 * f), wide = () => mob ? 5.4 / Math.min(1, C.aspect * 1.6) : 8.6 / Math.min(1, C.aspect * .75);
  const tg = new T.Vector3(), tA = new T.Vector3();
  let az = .35, el = .42, dist = 8, first = true;
  function cam(n, dt) {
    if (!still && dt > 0) tl += dt;
    const k3 = ((Math.floor(tl / STEP) % 4) + 4) % 4 || 0; setStep(k3);
    const a = K[k3]; tA.copy(a.t);
    let taz = a.az, tel = a.el;
    const td = wide() * (a.m || 1);
    railFill(((tl % STEP) / STEP));
    if (!down && n - last > 3000) { uaz *= .97; uel *= .97; }
    if (!still) taz += .08 * Math.sin(n / 4200);
    taz += uaz; tel += uel;
    const k = first ? 1 : 1 - Math.pow(.3, dt); first = false;
    tg.lerp(tA, k); az += (taz - az) * k; el += (tel - el) * k; dist += (td - dist) * k;
    C.position.set(tg.x + Math.sin(az) * Math.cos(el) * dist, tg.y + Math.sin(el) * dist, tg.z + Math.cos(az) * Math.cos(el) * dist);
    C.lookAt(tg);
  }

  function size() {
    const w = view.clientWidth, h = view.clientHeight; R.setSize(w, h, false); C.aspect = w / h;
    if (mob) C.clearViewOffset(); else C.setViewOffset(w, h, -w * .15, h * .02, w, h);
    C.updateProjectionMatrix();
  }
  new ResizeObserver(size).observe(view); size();
  let on = true; new IntersectionObserver(([e]) => on = e.isIntersecting).observe(st);

  // ---------- loop ----------
  const o = new T.Object3D(), UP = new T.Vector3(0, 1, 0), nv = new T.Vector3(), qr = new T.Quaternion();
  const eN = document.getElementById('cL'), eR = document.getElementById('cRt'), eA = document.getElementById('cA');
  let pt = performance.now(), acc = 0, hud = 0;
  ld.classList.add('off'); setTimeout(() => ld.style.display = 'none', 700);
  function frame(n) {
    requestAnimationFrame(frame); if (!on) { pt = n; return; }
    const dt = Math.max(0, Math.min(.05, (n - pt) / 1000)); pt = n;
    cam(n, dt);

    if (wash > 0) dry = 3.5; else dry = Math.max(0, dry - dt);
    wash = Math.max(0, wash - dt);
    acc += dt * (wash > 0 ? (mob ? 160 : 260) : (still ? 0 : (mob ? 10 : 16)));
    while (acc > 1) { acc--; drop(); }

    // ceramic beads
    for (let i = B.length - 1; i >= 0; i--) {
      const d = B[i]; d.a = Math.min(1, d.a + dt * 6);
      if (d.f) {
        d.vy -= 9.8 * dt; d.y += d.vy * dt; d.x += d.vx * dt; d.z += d.vz * dt; d.a -= dt * 1.4;
        if (d.y < 0 || d.a <= 0) B.splice(i, 1); continue;
      }
      if (!sam(d.x, d.z, q) || q.ny < .5) { d.f = 1; rolled++; continue; }
      const sl = Math.hypot(q.nx, q.nz);
      if (wash > 0 || sl > .16) {
        const k = wash > 0 ? 4 : 3.2, dx = sl > .02 ? q.nx / sl : 0, dz = sl > .02 ? q.nz / sl : 1;
        d.vx += (wash > 0 ? dx * k : q.nx * k) * dt; d.vz += (wash > 0 ? dz * k : q.nz * k) * dt;
      } else { d.vx *= .8; d.vz *= .8; }
      d.vx *= Math.pow(.25, dt); d.vz *= Math.pow(.25, dt);
      const nx = d.x + d.vx * dt, nz = d.z + d.vz * dt, ph = q.h;
      if (nx > -.02 || !sam(nx, nz, q) || q.ny < .5 || ph - q.h > .05 || edge(nx, nz, q.h)) { d.f = 1; d.vy = 0; rolled++; if (nx > -.02) { d.f = 0; d.vx = -Math.abs(d.vx) * .3; } continue; }
      d.x = nx; d.z = nz; d.y = q.h; d.nx = q.nx; d.ny = q.ny; d.nz = q.nz;
    }
    // bare clearcoat puddles: stick, spread, barely move
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.r += (p.g - p.r) * Math.min(1, dt * 3);
      if (wash > 0) p.g = Math.min(.06, p.g + dt * .004);
      if (sam(p.x, p.z, q)) {
        const sl = Math.hypot(q.nx, q.nz);
        if (sl > .55) { p.x += q.nx * dt * .01; p.z += q.nz * dt * .01; }
        if (p.x < .03) p.x = .03;
        p.y = q.h; p.nx = q.nx; p.ny = q.ny; p.nz = q.nz;
      }
    }

    B.forEach((d, i) => {
      nv.set(d.nx, d.ny, d.nz).normalize(); o.quaternion.setFromUnitVectors(UP, nv);
      o.position.set(d.x, d.y + .0008, d.z); const r = d.r * (.3 + .7 * Math.max(0, d.a)); o.scale.set(r, r * .92, r);
      o.updateMatrix(); beads.setMatrixAt(i, o.matrix);
    });
    P.forEach((p, i) => {
      nv.set(p.nx, p.ny, p.nz).normalize(); o.quaternion.setFromUnitVectors(UP, nv); qr.setFromAxisAngle(UP, p.t); o.quaternion.multiply(qr);
      o.position.set(p.x, p.y + .0006, p.z); o.scale.set(p.r * p.e, p.r * .5, p.r / p.e);
      o.updateMatrix(); pud.setMatrixAt(i, o.matrix);
    });
    beads.count = B.length; pud.count = P.length; beads.instanceMatrix.needsUpdate = pud.instanceMatrix.needsUpdate = true;
    R.render(S, C);
    if ((hud = (hud + 1) % 12)) return;
    eN.textContent = String(B.filter(d => !d.f).length).padStart(3, '0');
    eR.textContent = String(P.length).padStart(3, '0');
    eA.textContent = String(Math.round(Math.abs(az) * 57.3)).padStart(2, '0') + '°';
  }
  requestAnimationFrame(frame);
}
