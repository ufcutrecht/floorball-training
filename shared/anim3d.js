/* 3D-animaties bij oefeningen (gedeeld door alle programmapagina's).
   Tekent een zaal in perspectief met SVG, puur als functie van de tijd, zonder bibliotheken.

   Opbouw
   - V: kleine vectorrekenhulp (meters; x en y over de vloer, z omhoog).
   - W.cam: camera die om een punt draait; W.rink (floorballveld) en W.gym (gymzaal met pionnen en bank).
   - W.rig(st): skelet van een speler met vaste botlengtes. Benen en armen met inverse kinematica,
     een stick van vaste lengte (bovenhand bij de heup, onderhand schuift langs de steel), een blad met
     krul, forehand- en backhandkant en kantelen (open/dicht). De bal ligt tegen de gekozen kant van het blad.
   - W.player(...).render(cam, pose): tekent romp en hoofd als volumes met licht en schaduw.
   - W.dribble(...): balbehandeling (forehand/backhand wisselen, blad over de bal heen).
   - Scènes per oefening in SCENES; de pagina roept FB3D.mount(box, id, reduceMotion, isPaused) aan.

   Nieuwe technische oefening: maak een scène met W.rig + W.player en geef per speler per moment
   de positie, kijkrichting en een (eventueel denkbeeldig) balpunt op met de kant van het blad. */
(function () {
  'use strict';
  const PI = Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), clamp01 = (x) => clamp(x, 0, 1);
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const hz = (a) => norm([a[0], a[1], 0]);
  const UP = [0, 0, 1], LIGHT = norm([0.35, -0.65, 0.75]);
  const seg = (t, a, b) => clamp01((t - a) / (b - a)), lerp = (a, b, k) => a + (b - a) * k;
  const eo = (x) => 1 - (1 - x) * (1 - x), ei = (x) => x * x, eio = (x) => x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
  const L2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  const angLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  const local = (p, dir, f, l) => [p[0] + Math.cos(dir) * f - Math.sin(dir) * l, p[1] + Math.sin(dir) * f + Math.cos(dir) * l];
  const toLocal = (p, dir, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], c = Math.cos(dir), s = Math.sin(dir); return [dx * c + dy * s, -dx * s + dy * c]; };
  const n2 = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  const fx1 = (v) => v.toFixed(1);
  const R_BALL = 0.055;   // iets groter dan echt (72 mm), zodat de bal op een telefoon zichtbaar blijft

  // Twee-botten-IK: van a naar c met botlengtes l1 en l2; het gewricht buigt naar 'pole'.
  function ik(a, c, l1, l2, pole) {
    const d = sub(c, a), D0 = len(d) || 1e-6, u = mul(d, 1 / D0), D = Math.min(D0, l1 + l2 - 1e-4);
    const x = (l1 * l1 - l2 * l2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const p = norm(sub(pole, mul(u, dot(pole, u))));
    return add(a, add(mul(u, x), mul(p, h)));
  }
  // Convex omhulsel van 2D-punten (monotone chain).
  function hull(P) {
    if (P.length < 3) return P;
    P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    lo.pop(); hi.pop(); return lo.concat(hi);
  }
  const poly2 = (P) => P.length < 3 ? '' : 'M' + P.map((q) => fx1(q[0]) + ' ' + fx1(q[1])).join('L') + 'Z';

  const W = {
    // Camera die om een doelpunt draait; P() zet een punt in meters om naar beeldpixels.
    cam(kit, o) {
      if (window.FB3D_CAM) o = Object.assign({}, o, window.FB3D_CAM(o));   // alleen voor testen
      const F = o.F || 1500, cp = Math.cos(o.pitch), sp = Math.sin(o.pitch), cy = Math.cos(o.yaw), sy = Math.sin(o.yaw);
      const px = o.tx + o.d * cp * cy, py = o.ty + o.d * cp * sy, pz = (o.tz || 0) + o.d * sp;
      const fx = -cp * cy, fy = -cp * sy, fz = -sp;
      let rx = fy, ry = -fx; const rl = Math.hypot(rx, ry) || 1; rx /= rl; ry /= rl;
      const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
      const CX = kit.W / 2, CY = kit.H / 2 + (o.oy || 0);
      return {
        sp, pos: [px, py, pz],
        P(x, y, z) {
          const vx = x - px, vy = y - py, vz = z - pz, zc = Math.max(vx * fx + vy * fy + vz * fz, 0.5), s = F / zc;
          return [CX + (vx * rx + vy * ry) * s, CY - (vx * ux + vy * uy + vz * uz) * s, zc, s];
        },
        Q(p) { return this.P(p[0], p[1], p[2]); },
      };
    },
    path(cam, pts, close) {
      let s = '';
      for (let i = 0; i < pts.length; i++) { const q = cam.P(pts[i][0], pts[i][1], pts[i][2]); s += (i ? 'L' : 'M') + fx1(q[0]) + ' ' + fx1(q[1]); }
      return s + (close ? 'Z' : '');
    },
    ring(cx, cy, r, z, n) { const p = []; for (let k = 0; k < n; k++) { const a = k / n * PI * 2; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]); } return p; },
    // Omtrek van een rechthoek met ronde hoeken (halve lengte L, halve breedte B) op hoogte z.
    outline(L, B, r, z) {
      const pts = [], cs = [[L - r, B - r, 0], [-L + r, B - r, 90], [-L + r, -B + r, 180], [L - r, -B + r, 270]];
      for (const c of cs) for (let k = 0; k <= 6; k++) { const a = (c[2] + k * 15) * PI / 180; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z]); }
      return pts;
    },
    // Wanden of boarding rond een omtrek: de kant naar de camera toe ('near') en de verre kant ('far').
    walls(cam, lo, hi) {
      let far = '', near = '';
      const c = cam.P(0, 0, 0);
      for (let i = 0; i < lo.length; i++) {
        const j = (i + 1) % lo.length, n = Math.max(1, Math.ceil(Math.hypot(lo[j][0] - lo[i][0], lo[j][1] - lo[i][1]) / 1.0));
        for (let m = 0; m < n; m++) {   // lange wanden in stukken van 1 m, zodat een stuk achter de camera de rest niet wegneemt
          const k0 = m / n, k1 = (m + 1) / n, P3 = (p, q, k) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)];
          const a = P3(lo[i], lo[j], k0), b = P3(lo[i], lo[j], k1), ha = P3(hi[i], hi[j], k0), hb = P3(hi[i], hi[j], k1);
          const qa = cam.P(a[0], a[1], 0), qb = cam.P(b[0], b[1], 0);
          if (qa[2] < 1 || qb[2] < 1) continue;
          const quad = W.path(cam, [a, b, hb, ha], true), mid = cam.P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
          if (mid[2] < c[2]) near += quad; else far += quad;
        }
      }
      return { far, near };
    },
    // Floorballveld (40 x 20 m) met boarding, lijnen en doelen.
    rink(kit, cls) {
      const names = ['floor', 'wallfar', 'lines', 'goals', 'wallnear', 'cap'];
      const markup = '<g class="' + cls + '">' +
        '<path class="' + cls + '-floor" style="fill:var(--floor)"/>' +
        '<path class="' + cls + '-wallfar" style="fill:var(--boardshade)"/>' +
        '<path class="' + cls + '-lines" style="fill:none;stroke:var(--paint);stroke-width:3;stroke-linejoin:round"/>' +
        '<path class="' + cls + '-goals" style="fill:none;stroke:var(--accent);stroke-width:5;stroke-linejoin:round;stroke-linecap:round"/>' +
        '<path class="' + cls + '-wallnear" style="fill:var(--board);opacity:.82"/>' +
        '<path class="' + cls + '-cap" style="fill:none;stroke:var(--second);stroke-width:2;opacity:.8"/></g>';
      const el = {}, lo = W.outline(20, 10, 2.5, 0), hi = W.outline(20, 10, 2.5, 0.5);
      return {
        markup,
        bind(root) { for (const n of names) el[n] = root.querySelector('.' + cls + '-' + n); },
        render(cam) {
          el.floor.setAttribute('d', W.path(cam, lo, true));
          const w = W.walls(cam, lo, hi);
          el.wallfar.setAttribute('d', w.far); el.wallnear.setAttribute('d', w.near);
          el.cap.setAttribute('d', W.path(cam, hi, true));
          let ln = W.path(cam, [[0, -10, 0], [0, 10, 0]]) + W.path(cam, W.ring(0, 0, 3, 0, 32), true) + W.path(cam, W.ring(0, 0, 0.15, 0, 8), true);
          for (const sg of [1, -1]) {
            ln += W.path(cam, [[sg * 13.15, -2.5, 0], [sg * 17.15, -2.5, 0], [sg * 17.15, 2.5, 0], [sg * 13.15, 2.5, 0]], true);
            ln += W.path(cam, [[sg * 16.5, -0.5, 0], [sg * 15.5, -0.5, 0], [sg * 15.5, 0.5, 0], [sg * 16.5, 0.5, 0]]);
            for (const fy of [-6.5, 6.5]) ln += W.path(cam, [[sg * 14 - 0.15, fy, 0], [sg * 14 + 0.15, fy, 0]]);
          }
          el.lines.setAttribute('d', ln);
          let g = '';
          for (const sg of [1, -1]) {
            const x = sg * 16.5, bx = x + sg * 0.65;
            g += W.path(cam, [[x, -0.8, 0], [x, -0.8, 1.15], [x, 0.8, 1.15], [x, 0.8, 0]]);
            g += W.path(cam, [[x, -0.8, 1.15], [bx, -0.8, 0.3], [bx, -0.8, 0], [bx, 0.8, 0], [bx, 0.8, 0.3], [x, 0.8, 1.15]]);
          }
          el.goals.setAttribute('d', g);
        },
      };
    },
    // Gymzaal (halve lengte L, halve breedte B) met houten vloer, zaallijnen, wanden met wandrekken.
    gym(kit, cls, L, B) {
      const markup = '<g class="' + cls + '">' +
        '<path data-g="floor" style="fill:var(--wood)"/>' +
        '<path data-g="planks" style="fill:none;stroke:var(--woodline);stroke-width:1.2"/>' +
        '<path data-g="wall" style="fill:var(--wall)"/>' +
        '<path data-g="skirt" style="fill:var(--wallshade)"/>' +
        '<path data-g="bars" style="fill:none;stroke:var(--bars);stroke-width:3;stroke-linecap:round"/>' +
        '<path data-g="lines" style="fill:none;stroke:var(--gymline);stroke-width:3;stroke-linejoin:round"/>' +
        '<path data-g="lines2" style="fill:none;stroke:var(--gymline2);stroke-width:3;stroke-linejoin:round"/></g>';
      const el = {}, lo = W.outline(L, B, 0.01, 0), hi = W.outline(L, B, 0.01, 3.2), sk = W.outline(L, B, 0.01, 0.35);
      return {
        markup,
        bind(root) { root.querySelectorAll('[data-g]').forEach((e) => { el[e.dataset.g] = e; }); },
        render(cam) {
          el.floor.setAttribute('d', W.path(cam, lo, true));
          let pl = '';
          for (let y = -B + 0.9; y < B; y += 0.9) pl += W.path(cam, [[-L, y, 0], [L, y, 0]]);
          el.planks.setAttribute('d', pl);
          el.wall.setAttribute('d', W.walls(cam, lo, hi).far);
          el.skirt.setAttribute('d', W.walls(cam, lo, sk).far);
          // Wandrekken tegen de lange wand die het verst van de camera ligt.
          const yw = cam.pos[1] < 0 ? B - 0.02 : -B + 0.02;
          let bars = '';
          for (let x = -L + 2; x <= -L + 7.2; x += 0.9) {
            bars += W.path(cam, [[x, yw, 0], [x, yw, 2.6]]) + W.path(cam, [[x + 0.8, yw, 0], [x + 0.8, yw, 2.6]]);
            for (let z = 0.3; z < 2.6; z += 0.28) bars += W.path(cam, [[x, yw, z], [x + 0.8, yw, z]]);
          }
          el.bars.setAttribute('d', bars);
          el.lines.setAttribute('d', W.path(cam, W.outline(L - 1, B - 1, 0.01, 0), true) + W.path(cam, [[0, -B + 1, 0], [0, B - 1, 0]]) + W.path(cam, W.ring(0, 0, 1.8, 0, 40), true));
          el.lines2.setAttribute('d', W.path(cam, W.outline(L - 3.5, B - 2.2, 0.01, 0), true));
        },
      };
    },
    // Painter's algorithm: verste eerst.
    sortInto(parent, items) { items.sort((a, b) => b.d - a.d); for (const it of items) parent.appendChild(it.el); },
  };

  // Bal: lichte bal met gaatjes, schaduw op de vloer.
  W.ball = function (cls) {
    return {
      markup: '<g class="' + cls + '"><ellipse style="fill:rgba(0,0,0,.35)"/><circle style="fill:var(--ballc);stroke:color-mix(in srgb, var(--ballc) 55%, #000);stroke-width:1.2"/>' +
        '<circle style="fill:color-mix(in srgb, var(--ballc) 55%, #000)"/><circle style="fill:color-mix(in srgb, var(--ballc) 55%, #000)"/><circle style="fill:color-mix(in srgb, var(--ballc) 55%, #000)"/></g>',
      bind(g) { this.g = g; [this.sh, this.b, this.h1, this.h2, this.h3] = g.children; },
      render(cam, p) {
        const f = cam.P(p[0], p[1], 0), q = cam.P(p[0], p[1], p[2] == null ? R_BALL : p[2]), r = Math.max(R_BALL * q[3], 4);
        this.sh.setAttribute('cx', fx1(f[0])); this.sh.setAttribute('cy', fx1(f[1]));
        this.sh.setAttribute('rx', fx1(r * 1.15)); this.sh.setAttribute('ry', fx1(r * 1.15 * cam.sp));
        this.b.setAttribute('cx', fx1(q[0])); this.b.setAttribute('cy', fx1(q[1])); this.b.setAttribute('r', fx1(r));
        // Gaatjes draaien mee als de bal rolt.
        const rot = (p[0] + p[1]) / R_BALL;
        [this.h1, this.h2, this.h3].forEach((h, i) => {
          const a = rot + i * 2.1, c = Math.cos(a);
          h.setAttribute('cx', fx1(q[0] + r * 0.55 * Math.sin(a))); h.setAttribute('cy', fx1(q[1] - r * 0.25 + r * 0.2 * i - r * 0.15));
          h.setAttribute('r', fx1(r * 0.16 * Math.max(0.15, c))); h.style.opacity = c > 0 ? 1 : 0;
        });
        return f[2];
      },
    };
  };

  // Pion: kegel met een witte band.
  W.cone = function (cls) {
    return {
      markup: '<g class="' + cls + '"><ellipse style="fill:rgba(0,0,0,.3)"/><path style="fill:var(--conec)"/><path style="fill:#fff;opacity:.85"/></g>',
      bind(g) { this.g = g; [this.sh, this.body, this.band] = g.children; },
      render(cam, x, y) {
        const f = cam.P(x, y, 0), base = W.ring(x, y, 0.11, 0, 14).map((p) => cam.Q(p)), top = cam.P(x, y, 0.26);
        this.sh.setAttribute('cx', fx1(f[0])); this.sh.setAttribute('cy', fx1(f[1])); this.sh.setAttribute('rx', fx1(0.16 * f[3])); this.sh.setAttribute('ry', fx1(0.16 * f[3] * cam.sp));
        this.body.setAttribute('d', poly2(hull(base.concat([top]))));
        const b1 = W.ring(x, y, 0.065, 0.11, 12).map((p) => cam.Q(p)), b2 = W.ring(x, y, 0.045, 0.16, 12).map((p) => cam.Q(p));
        this.band.setAttribute('d', poly2(hull(b1.concat(b2))));
        return f[2];
      },
    };
  };

  // Gymbank op zijn zij tegen de muur: de zitplank staat rechtop en is de kaatswand; poten en balk wijzen naar de muur.
  // (cx, cy) = midden van de voorkant van de plank op de vloer, yaw = richting van de plank, Lh = halve lengte.
  W.bench = function (cls) {
    return {
      markup: '<g class="' + cls + '"><path style="fill:rgba(0,0,0,.22)"/><path style="fill:none;stroke:var(--benchside);stroke-linecap:round"/><path style="fill:var(--benchside)"/><path style="fill:var(--benchtop)"/><path style="fill:var(--benchside)"/></g>',
      bind(g) { this.g = g; [this.sh, this.legs, this.end, this.face, this.top] = g.children; },
      render(cam, cx, cy, yaw, Lh) {
        const c = Math.cos(yaw), s = Math.sin(yaw), n = [-s, c];   // n wijst van het vak naar de muur
        const at = (f, d, z) => [cx + c * f + n[0] * d, cy + s * f + n[1] * d, z];
        const H = 0.3, T = 0.035;
        this.sh.setAttribute('d', W.path(cam, [at(-Lh, 0, 0), at(Lh, 0, 0), at(Lh, 0.36, 0), at(-Lh, 0.36, 0)], true));
        this.face.setAttribute('d', W.path(cam, [at(-Lh, 0, 0), at(Lh, 0, 0), at(Lh, 0, H), at(-Lh, 0, H)], true));
        this.top.setAttribute('d', W.path(cam, [at(-Lh, 0, H), at(Lh, 0, H), at(Lh, T, H), at(-Lh, T, H)], true));
        const sideEnd = cam.pos[0] * c + cam.pos[1] * s > cx * c + cy * s ? Lh : -Lh;
        this.end.setAttribute('d', W.path(cam, [at(sideEnd, 0, 0), at(sideEnd, T, 0), at(sideEnd, T, H), at(sideEnd, 0, H)], true));
        // Poten (liggend) en de evenwichtsbalk tussen de poten, richting de muur.
        let lg = '';
        for (const f of [-Lh + 0.25, Lh - 0.25]) lg += W.path(cam, [at(f, T, 0.15), at(f, 0.33, 0.15)]) + W.path(cam, [at(f - 0.12, 0.33, 0.05), at(f + 0.12, 0.33, 0.25)]);
        lg += W.path(cam, [at(-Lh + 0.25, 0.33, 0.15), at(Lh - 0.25, 0.33, 0.15)]);
        this.legs.setAttribute('d', lg); this.legs.style.strokeWidth = fx1(Math.max(0.05 * cam.P(cx, cy, 0)[3], 2));
        // De wand staat tussen camera en poten: poten eerst tekenen (ze liggen erachter).
        return cam.P(cx, cy, 0)[2];
      },
    };
  };

  /* Het skelet. st:
     x, y      voeten (midden tussen beide voeten), dir = kijkrichting van heupen en voeten (radialen)
     hand      'L' = stick links (linkerhand laag, rechterhand boven), 'R' = stick rechts
     k         lengteschaal (1 = volwassen ±1,75 m, 0.8 = kind ±1,40 m); de stick schaalt mee
     crouch    0..1 kniebuiging, lean 0..1 voorover buigen, twist = romp gedraaid t.o.v. heupen, look = kijkrichting hoofd
     run, amp  fase van de pas (radialen, één pas per PI) en paslengte 0..1 (0 = stilstaan)
     ball      [x, y] het balpunt waar het blad tegenaan moet (echt of denkbeeldig)
     side      kant van het blad naar de bal: +1 forehand, -1 backhand, 0 = blad bovenop de bal
     gap       afstand tussen blad en bal (m), lift = blad van de vloer (m), tilt = blad dicht over de bal (radialen, + = naar de forehandkant) */
  W.rig = function (st) {
    const k = st.k || 1, o = [st.x, st.y, 0];
    const sc = (p) => [o[0] + (p[0] - o[0]) * k, o[1] + (p[1] - o[1]) * k, p[2] * k];
    const un = (p) => [o[0] + (p[0] - o[0]) / k, o[1] + (p[1] - o[1]) / k];
    const H = st.hand === 'R' ? -1 : 1, crouch = st.crouch == null ? 0.3 : st.crouch, lean0 = st.lean == null ? 0.25 : st.lean;
    const run = st.run || 0, yaw = st.dir;
    // Snelheid (m/s in de wereld) en pasritme (stappen per seconde per been). Zonder speed: oude 'amp' (0..1).
    const speed = st.speed != null ? st.speed : (st.amp || 0) * 1.6, cad = st.cad || 1.45, act = clamp01(speed / 0.45);
    const F = [Math.cos(yaw), Math.sin(yaw), 0], Lv = [-F[1], F[0], 0];
    // Heup: zakt bij het neerkomen, schuift naar het standbeen en draait mee met het zwaaibeen.
    const beta = clamp(0.62 - 0.1 * speed, 0.38, 0.6);                 // deel van de pas dat de voet op de grond staat
    const bob = 0.022 * act * (1 + Math.cos(2 * run - 2 * PI * beta / 2 * 2)) / 2;
    const sway = 0.022 * act * Math.cos(run - PI * beta), psi = -0.1 * act * Math.cos(run);
    const lean = lean0 + 0.12 * act * Math.min(1, speed / 2);
    const hipZ = 0.94 - 0.17 * crouch - bob, back = -0.06 * lean;
    const ox = st.x + Lv[0] * sway, oy = st.y + Lv[1] * sway;
    const at = (f, l, z) => [ox + F[0] * f + Lv[0] * l, oy + F[1] * f + Lv[1] * l, z];
    const hy = yaw + psi, HF = [Math.cos(hy), Math.sin(hy), 0], HL = [-HF[1], HF[0], 0];
    const atH = (f, l, z) => [ox + HF[0] * f + HL[0] * l, oy + HF[1] * f + HL[1] * l, z];
    // Benen: standfase (voet plat en stil op de vloer, rolt af van hak naar teen) en zwaaifase (knie buigt, voet naar voren).
    const SL = speed * beta / cad / (st.k || 1), Hs = act * Math.min(0.16, 0.05 + 0.045 * speed) / (st.k || 1);
    const stance = 0.1 + 0.07 * crouch, legs = [];
    for (const side of [1, -1]) {
      const u = (((run + (side > 0 ? 0 : PI)) / (2 * PI)) % 1 + 1) % 1;
      let x, z, pitch;
      if (u < beta) { const k = u / beta; x = SL / 2 - SL * k; z = 0; pitch = act * (k < 0.12 ? 0.3 * (1 - k / 0.12) : k > 0.7 ? -0.75 * ((k - 0.7) / 0.3) ** 2 : 0); }
      else { const k = (u - beta) / (1 - beta); x = -SL / 2 + SL * (k - Math.sin(2 * PI * k) / (2 * PI)); z = Hs * Math.sin(PI * k) * (1.15 - 0.3 * k); pitch = act * (-0.75 * (1 - k) ** 2 + 0.3 * k * k); }
      x += -0.05 * crouch * side * H;                                   // voet aan de stickkant iets naar achteren
      const fy = yaw + 0.12 * side, FF = [Math.cos(fy), Math.sin(fy), 0], FL = [-FF[1], FF[0], 0];
      const ax = norm(add(mul(FF, Math.cos(pitch)), mul(UP, Math.sin(pitch)))), nUp = norm(add(mul(FF, -Math.sin(pitch)), mul(UP, Math.cos(pitch))));
      const g = at(x, stance * side, z);
      let heel, toe;
      if (pitch < 0) { toe = add(g, mul(FF, 0.17)); heel = sub(toe, mul(ax, 0.235)); }
      else { heel = add(g, mul(FF, -0.065)); toe = add(heel, mul(ax, 0.235)); }
      const ankle = add(add(heel, mul(ax, 0.06)), mul(nUp, 0.08));
      const hip = atH(back, 0.09 * side, hipZ);
      const knee = ik(hip, ankle, 0.45, 0.45, add(F, [0, 0, 0.1]));
      // Schoen: zool en bovenwerk als rij doorsneden van hak naar neus.
      const WD = [0.032, 0.041, 0.046, 0.048, 0.046, 0.038, 0.022], HT = [0.075, 0.076, 0.068, 0.056, 0.046, 0.038, 0.028];
      const upper = [], sole = [];
      for (let i = 0; i < 7; i++) {
        const b0 = add(heel, mul(ax, 0.235 * i / 6));
        for (const sd of [1, -1]) {
          sole.push(add(b0, mul(FL, sd * (WD[i] + 0.004))), add(add(b0, mul(FL, sd * WD[i])), mul(nUp, 0.02)));
          upper.push(add(add(b0, mul(FL, sd * WD[i])), mul(nUp, 0.016)), add(add(b0, mul(FL, sd * WD[i] * 0.8)), mul(nUp, HT[i])));
        }
      }
      const stripe = [add(add(add(heel, mul(ax, 0.05)), mul(FL, side * 0.042)), mul(nUp, 0.045)), add(add(add(heel, mul(ax, 0.15)), mul(FL, side * 0.049)), mul(nUp, 0.03))];
      legs.push({ side, hip, knee, ankle, heel, toe, upper, sole, stripe });
    }
    // Romp: doorsneden (ellipsen) langs een ruggengraat die voorover buigt en meedraait.
    const tw = st.twist || 0, la = 0.12 + 0.62 * lean;
    const yawAt = (s) => yaw + psi + (tw - 1.5 * psi) * clamp01(s / 0.45), my = yaw + tw * 0.5;
    const S = norm(add(mul(UP, Math.cos(la)), mul([Math.cos(my), Math.sin(my), 0], Math.sin(la))));
    const base = at(back, 0, hipZ + 0.03);
    const frame = (s) => {
      const y = yawAt(s), f = [Math.cos(y), Math.sin(y), 0], l = [-f[1], f[0], 0];
      return { c: add(base, mul(S, s)), f: norm(sub(f, mul(S, dot(f, S)))), l: norm(sub(l, mul(S, dot(l, S)))) };
    };
    const ring = (fr, a, b, n) => {
      const pts = [];
      for (let i = 0; i < n; i++) { const q = i / n * PI * 2, cq = Math.cos(q), sq = Math.sin(q); pts.push({ p: add(fr.c, add(mul(fr.l, a * cq), mul(fr.f, b * sq))), n: norm(add(mul(fr.l, cq), mul(fr.f, sq))) }); }
      return pts;
    };
    const torso = [[0.04, 0.16, 0.105], [0.17, 0.145, 0.098], [0.32, 0.172, 0.112], [0.44, 0.19, 0.1], [0.51, 0.12, 0.08]].map(([s, a, b]) => ring(frame(s), a, b, 14));
    const shf = frame(0.44), shoulder = { 1: add(shf.c, mul(shf.l, 0.175)), '-1': add(shf.c, mul(shf.l, -0.175)) };
    const nb = frame(0.5).c, neckTop = add(nb, mul(norm(add(S, mul(UP, 1.4))), 0.045));
    let ly = st.look == null ? yawAt(1) : st.look;
    ly = yawAt(1) + clamp(Math.atan2(Math.sin(ly - yawAt(1)), Math.cos(ly - yawAt(1))), -1.2, 1.2);
    const hF = [Math.cos(ly), Math.sin(ly), 0], head = add(add(neckTop, mul(norm(add(mul(S, 0.3), mul(UP, 0.7))), 0.095)), mul(hF, 0.025));
    // Broek: rond het bekken en de bovenkant van de dijen.
    const pf = frame(0.0), shorts = ring(pf, 0.168, 0.112, 12).map((q) => q.p);
    for (const lg of legs) { const m = add(lg.hip, mul(sub(lg.knee, lg.hip), 0.5)); for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; shorts.push(add(m, [0.085 * Math.cos(a), 0.085 * Math.sin(a), 0])); } }

    // Stick: blad bij de bal, steel van vaste lengte naar de bovenhand bij de heup.
    const LS = 0.93, REACH = 0.57, chest = frame(0.3);
    const shT = shoulder[-H], shL = shoulder[H];
    // Bovenhand bij de heup aan de kant zonder stick (stick links = rechterhand boven), steel schuin naar het blad.
    const Tpref = add(add(pf.c, mul(pf.f, 0.2)), add(mul(pf.l, -H * 0.13), [0, 0, 0.02]));
    const bp = st.ball ? un(st.ball) : local([st.x, st.y], yaw, 0.62, 0.34 * H);
    const ball = [bp[0], bp[1], R_BALL];
    const side = st.side == null ? 1 : st.side, gap = st.gap || 0, lift = st.lift || 0, tilt = st.tilt || 0;
    let u = hz(sub(ball, Tpref)), nfh = [0, 0, 0], heel = ball, T = Tpref, off = [0, 0, 0];
    for (let i = 0; i < 6; i++) {
      nfh = H > 0 ? [u[1], -u[0], 0] : [-u[1], u[0], 0];
      const contact = add(sub(ball, mul(nfh, side * (R_BALL + 0.012 + gap))), off);
      heel = add(sub(contact, mul(u, 0.11)), mul(nfh, 0.015)); heel[2] = lift;
      T = add(heel, mul(norm(sub(Tpref, heel)), LS));
      let ex = len(sub(T, shT)) - REACH;
      if (ex > 0) {   // bovenhand buiten bereik: hand terug naar de schouder, stick blijft even lang
        const Tn = add(shT, mul(norm(sub(T, shT)), REACH));
        T = add(heel, mul(norm(sub(Tn, heel)), LS));
        ex = len(sub(T, shT)) - REACH;
        if (ex > 0.004) { const pull = mul(hz(sub(T, heel)), ex); off = add(off, pull); heel = add(heel, pull); T = add(T, pull); }
      }
      u = hz(sub(heel, T));
    }
    nfh = H > 0 ? [u[1], -u[0], 0] : [-u[1], u[0], 0];
    const dS = norm(sub(heel, T)), want = add(add(shL, [0, 0, -0.42]), mul(chest.f, 0.12));
    let low = add(T, mul(dS, clamp(dot(sub(want, T), dS), 0.28, 0.5)));
    if (len(sub(low, shL)) > REACH) low = add(T, mul(dS, clamp(dot(sub(shL, T), dS), 0.2, 0.55)));
    const elbowPole = (sd) => norm(add(add(mul(UP, -0.7), mul(chest.l, 0.65 * sd)), mul(chest.f, -0.2)));
    const elT = ik(shT, T, 0.29, 0.29, elbowPole(-H)), elL = ik(shL, low, 0.29, 0.29, elbowPole(H));
    const bUp = norm(add(mul(UP, Math.cos(tilt)), mul(nfh, Math.sin(tilt))));
    const toe = add(add(heel, mul(u, 0.26)), mul(nfh, 0.012)), mid = add(add(heel, mul(u, 0.13)), mul(nfh, -0.03));
    const arms = {}; arms[-H] = { sh: shT, el: elT, hand: T }; arms[H] = { sh: shL, el: elL, hand: low };

    const pose = {
      k, H, pelvis: base, legs, torso, shorts, shoulder, neckBase: nb, neckTop, head, hF, arms, S,
      grip: sub(T, mul(dS, 0.06)), top: T, shaftEnd: add(heel, mul(bUp, 0.04)), heel, toe, mid, bUp, nfh, u,
    };
    if (k !== 1) {   // kind: alles schalen vanaf de voeten
      const walk = (v) => Array.isArray(v) ? (typeof v[0] === 'number' ? sc(v) : v.map(walk)) : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, (a === 'n' || a === 'side') ? b : walk(b)])) : v);
      for (const key of ['pelvis', 'legs', 'torso', 'shorts', 'shoulder', 'neckBase', 'neckTop', 'head', 'arms', 'grip', 'top', 'shaftEnd', 'heel', 'toe', 'mid']) pose[key] = walk(pose[key]);
    }
    pose.x = st.x; pose.y = st.y;
    return pose;
  };

  /* Dribbelen voor het lichaam: de bal gaat van links naar rechts (amplitude A, tempo w in rad/s),
     het blad zit steeds aan de kant waar de bal vandaan komt en gaat bij het keren over de bal heen.
     Geeft lokale balplek [vooruit, opzij] en de bladinstellingen terug. h = +1 stick links, -1 stick rechts. */
  W.dribble = function (t, h, f0, l0, A, w) {
    const sn = Math.sin(w * t), cs = Math.cos(w * t), s = -Math.tanh(3 * cs);
    return { f: f0 + 0.04 * Math.abs(sn), l: h * (l0 + A * sn), side: s, lift: 0.12 * (1 - s * s), tilt: 0.3 * s };
  };

  // Huid- en haarkleuren: kinderen en spelers zien er verschillend uit.
  const LOOKS = [['#E8B894', '#2B1D14'], ['#C68A64', '#16110E'], ['#8A5636', '#120D0A'], ['#F2CFB2', '#C79A5A'], ['#B37A55', '#5A3A22'], ['#EDC3A0', '#7A4A28'], ['#9C6644', '#1E1510'], ['#F4D6BD', '#E0C083']];

  /* Speler tekenen. col = shirtkleur (CSS), look = index in LOOKS. Onderdelen worden per beeld op diepte
     gesorteerd: wat achter de romp zit, komt achter de benen; wat ervoor zit, komt vooraan. */
  W.player = function (cls, col, look) {
    const [skin, hair] = LOOKS[(look || 0) % LOOKS.length];
    const sk = 'fill:none;stroke-linecap:round;stroke-linejoin:round;stroke:';
    const leg = (s) => '<g data-p="leg' + s + '"><path data-e="thigh" style="' + sk + skin + '"/><path data-e="shin" style="' + sk + skin + '"/><path data-e="sock" style="' + sk + col + '"/><path data-e="sole" style="fill:var(--sole);stroke:var(--sole);stroke-linejoin:round"/><path data-e="shoe" style="fill:var(--shoe);stroke:var(--shoe);stroke-linejoin:round"/><path data-e="stripe" style="' + sk + col + '"/></g>';
    const arm = (s) => '<g data-p="arm' + s + '"><path data-e="upper" style="' + sk + skin + '"/><path data-e="sleeve" style="' + sk + col + '"/><path data-e="fore" style="' + sk + skin + '"/><circle data-e="hand" style="fill:' + skin + '"/></g>';
    const markup = '<g class="' + cls + '"><ellipse data-p="shadow" style="fill:rgba(0,0,0,.32)"/>' + leg('L') + leg('R') +
      '<g data-p="shorts"><path style="fill:var(--shorts);stroke:var(--shorts);stroke-linejoin:round"/></g>' +
      '<g data-p="torso"><path data-e="shirt" style="fill:' + col + ';stroke:' + col + ';stroke-linejoin:round"/><path data-e="shade" style="fill:#000;opacity:.13"/><path data-e="lit" style="fill:#fff;opacity:.1"/><path data-e="collar" style="' + sk + 'color-mix(in srgb, ' + col + ' 70%, #000);opacity:.55"/></g>' +
      '<g data-p="head"><path data-e="neck" style="' + sk + skin + '"/><circle data-e="skull" style="fill:' + skin + '"/><path data-e="hshade" style="fill:#000;opacity:.13"/><path data-e="hair" style="fill:' + hair + ';stroke:' + hair + ';stroke-linejoin:round"/></g>' +
      arm('L') + arm('R') +
      '<g data-p="stick"><path data-e="shaft" style="' + sk + 'var(--stick)"/><path data-e="tape" style="' + sk + 'var(--grip)"/></g>' +
      '<g data-p="blade"><path data-e="bl" style="stroke-linejoin:round"/></g></g>';
    return {
      markup,
      bind(g) {
        this.g = g; this.p = {}; this.e = {};
        g.querySelectorAll('[data-p]').forEach((n) => { this.p[n.dataset.p] = n; });
        for (const n of ['legL', 'legR', 'armL', 'armR']) { const o = {}; this.p[n].querySelectorAll('[data-e]').forEach((x) => { o[x.dataset.e] = x; }); this.e[n] = o; }
        g.querySelectorAll('[data-p="torso"] [data-e],[data-p="head"] [data-e],[data-p="stick"] [data-e],[data-p="blade"] [data-e]').forEach((x) => { this.e[x.dataset.e] = x; });
        this.shorts = this.p.shorts.firstChild;
      },
      render(cam, ps) {
        const Q = (p) => cam.Q(p), s = cam.P(ps.x, ps.y, ps.k)[3], e = this.e;
        const line = (el, pts, w, min) => { el.setAttribute('d', W.path(cam, pts)); el.style.strokeWidth = fx1(Math.max(w * ps.k * s, min || 1)); };
        const foot = cam.P(ps.x, ps.y, 0);
        const sh = this.p.shadow;
        sh.setAttribute('cx', fx1(foot[0])); sh.setAttribute('cy', fx1(foot[1])); sh.setAttribute('rx', fx1(0.42 * ps.k * foot[3])); sh.setAttribute('ry', fx1(0.42 * ps.k * foot[3] * cam.sp));
        // Benen
        const legDepth = {};
        for (const lg of ps.legs) {
          const n = lg.side > 0 ? 'legL' : 'legR', o = e[n];
          line(o.thigh, [lg.hip, lg.knee], 0.15, 2);
          const sockTop = add(lg.knee, mul(sub(lg.ankle, lg.knee), 0.3));
          line(o.shin, [lg.knee, sockTop], 0.11, 2);
          line(o.sock, [sockTop, lg.ankle], 0.1, 2);
          o.sole.setAttribute('d', poly2(hull(lg.sole.map(Q)))); o.sole.style.strokeWidth = fx1(Math.max(0.01 * ps.k * s, 0.6));
          o.shoe.setAttribute('d', poly2(hull(lg.upper.map(Q)))); o.shoe.style.strokeWidth = fx1(Math.max(0.01 * ps.k * s, 0.6));
          line(o.stripe, lg.stripe, 0.014, 0.8);
          legDepth[n] = Q(lg.knee)[2];
        }
        this.shorts.setAttribute('d', poly2(hull(ps.shorts.map(Q)))); this.shorts.style.strokeWidth = fx1(Math.max(0.03 * ps.k * s, 1));
        // Romp met licht en schaduw
        const all = [].concat(...ps.torso);
        e.shirt.setAttribute('d', poly2(hull(all.map((q) => Q(q.p))))); e.shirt.style.strokeWidth = fx1(Math.max(0.035 * ps.k * s, 1));
        const lit = all.filter((q) => dot(q.n, LIGHT) > 0.5).map((q) => Q(q.p)), dark = all.filter((q) => dot(q.n, LIGHT) < -0.45).map((q) => Q(q.p));
        e.lit.setAttribute('d', poly2(hull(lit))); e.shade.setAttribute('d', poly2(hull(dark)));
        e.collar.setAttribute('d', W.path(cam, ps.torso[4].map((q) => q.p), true)); e.collar.style.strokeWidth = fx1(Math.max(0.012 * ps.k * s, 0.8));
        // Hoofd: bol met haar aan de achter- en bovenkant
        line(e.neck, [ps.neckBase, ps.neckTop], 0.09, 2);
        const hc = Q(ps.head), r = 0.105 * ps.k * hc[3];
        e.skull.setAttribute('cx', fx1(hc[0])); e.skull.setAttribute('cy', fx1(hc[1])); e.skull.setAttribute('r', fx1(r));
        const hL = [-ps.hF[1], ps.hF[0], 0], hp = [], sp = [], R = 0.108 * ps.k;
        for (let a = 0; a < 16; a++) for (let b = -2; b <= 4; b++) {
          const th = a / 16 * PI * 2, ph = b / 4 * PI / 2, cph = Math.cos(ph), sph = Math.sin(ph);
          const dv = add(add(mul(ps.hF, cph * Math.cos(th)), mul(hL, cph * Math.sin(th))), mul(UP, sph)), pt = add(ps.head, mul(dv, R));
          if ((dot(dv, ps.hF) < 0.15 && sph > -0.55) || sph > 0.5) hp.push(Q(pt));
          if (dot(dv, LIGHT) < -0.2) sp.push(Q(add(ps.head, mul(dv, R * 0.98))));
        }
        e.hair.setAttribute('d', poly2(hull(hp))); e.hair.style.strokeWidth = fx1(Math.max(0.012 * ps.k * s, 0.5));
        e.hshade.setAttribute('d', poly2(hull(sp)));
        // Armen
        const armDepth = {};
        for (const sd of [1, -1]) {
          const n = sd > 0 ? 'armL' : 'armR', o = e[n], a = ps.arms[sd];
          line(o.upper, [a.sh, a.el], 0.09, 2);
          line(o.sleeve, [a.sh, add(a.sh, mul(sub(a.el, a.sh), 0.55))], 0.105, 2);
          line(o.fore, [a.el, a.hand], 0.075, 1.5);
          const hq = Q(a.hand); o.hand.setAttribute('cx', fx1(hq[0])); o.hand.setAttribute('cy', fx1(hq[1])); o.hand.setAttribute('r', fx1(Math.max(0.045 * ps.k * hq[3], 1.5)));
          armDepth[n] = (Q(a.el)[2] + Q(a.hand)[2]) / 2;
        }
        // Stick en blad
        line(e.shaft, [ps.grip, ps.shaftEnd], 0.032, 1.5);
        line(e.tape, [ps.grip, add(ps.grip, mul(sub(ps.shaftEnd, ps.grip), 0.3))], 0.04, 1.5);
        const bh = 0.075 * ps.k, up = mul(ps.bUp, bh);
        const h0 = Q(ps.heel), m0 = Q(ps.mid), t0 = Q(ps.toe), h1 = Q(add(ps.heel, up)), m1 = Q(add(ps.mid, up)), t1 = Q(add(ps.toe, mul(ps.bUp, bh * 0.85)));
        e.bl.setAttribute('d', 'M' + fx1(h0[0]) + ' ' + fx1(h0[1]) + 'Q' + fx1(m0[0]) + ' ' + fx1(m0[1]) + ' ' + fx1(t0[0]) + ' ' + fx1(t0[1]) + 'L' + fx1(t1[0]) + ' ' + fx1(t1[1]) + 'Q' + fx1(m1[0]) + ' ' + fx1(m1[1]) + ' ' + fx1(h1[0]) + ' ' + fx1(h1[1]) + 'Z');
        const camDir = sub(cam.pos, ps.mid), fhVisible = dot(ps.nfh, camDir) > 0;
        e.bl.style.fill = fhVisible ? 'var(--bladefh)' : 'var(--bladebh)'; e.bl.style.stroke = 'var(--bladeedge)'; e.bl.style.strokeWidth = fx1(Math.max(0.008 * s, 0.8));
        // Volgorde: achter de romp - benen - broek - romp - hoofd - voor de romp
        const tD = Q(ps.torso[2][0].p)[2] * 0.5 + Q(ps.torso[2][7].p)[2] * 0.5;
        const extra = [['armL', armDepth.armL], ['armR', armDepth.armR], ['stick', Q(mul(add(ps.grip, ps.shaftEnd), 0.5))[2]], ['blade', Q(ps.mid)[2] + 0.05]];
        const behind = extra.filter((x) => x[1] > tD + 0.01).sort((a, b) => b[1] - a[1]), front = extra.filter((x) => x[1] <= tD + 0.01).sort((a, b) => b[1] - a[1]);
        const legs = [['legL', legDepth.legL], ['legR', legDepth.legR]].sort((a, b) => b[1] - a[1]);
        for (const [n] of behind.concat(legs, [['shorts'], ['torso'], ['head']], front)) this.g.appendChild(this.p[n]);
        return foot[2];
      },
    };
  };

  // Hoepel die rechtop staat in twee pionnen (hoepelhouder). Geeft twee tekendelen terug (achterste en voorste helft),
  // zodat een bal er echt doorheen kan rollen.
  W.hoop = function (cls) {
    return {
      markup: '<g class="' + cls + '"><g class="' + cls + '-far"><path style="fill:none;stroke:var(--hoop);stroke-linecap:round"/></g><g class="' + cls + '-near"><path style="fill:none;stroke:var(--hoop);stroke-linecap:round"/><path style="fill:var(--conec)"/><path style="fill:var(--conec)"/><ellipse style="fill:rgba(0,0,0,.22)"/></g></g>',
      bind(g) { this.far = g.firstChild; this.near = g.lastChild; this.fp = this.far.firstChild; [this.np, this.c1, this.c2, this.sh] = this.near.children; },
      render(cam, c, dir) {
        const r = 0.36, lx = -Math.sin(dir), ly = Math.cos(dir), pts = [];
        for (let i = 0; i <= 40; i++) { const a = i / 40 * PI * 2; pts.push([c[0] + lx * r * Math.sin(a), c[1] + ly * r * Math.sin(a), r + 0.02 - r * Math.cos(a)]); }
        const mid = cam.P(c[0], c[1], r)[2];
        let far = '', near = '';
        for (let i = 0; i < 40; i++) { const a = pts[i], b = pts[i + 1], m = cam.P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); const sgm = W.path(cam, [a, b]); if (m[2] > mid) far += sgm; else near += sgm; }
        const sw = fx1(Math.max(0.028 * cam.P(c[0], c[1], r)[3], 1.5));
        this.fp.setAttribute('d', far); this.np.setAttribute('d', near); this.fp.style.strokeWidth = this.np.style.strokeWidth = sw;
        [this.c1, this.c2].forEach((el, i) => { const sg = i ? 1 : -1, x = c[0] + lx * r * 0.75 * sg, y = c[1] + ly * r * 0.75 * sg; el.setAttribute('d', poly2(hull(W.ring(x, y, 0.08, 0, 12).map((p) => cam.Q(p)).concat([cam.P(x, y, 0.16)])))); });
        const f = cam.P(c[0], c[1], 0); this.sh.setAttribute('cx', fx1(f[0])); this.sh.setAttribute('cy', fx1(f[1])); this.sh.setAttribute('rx', fx1(r * f[3])); this.sh.setAttribute('ry', fx1(r * 0.25 * f[3]));
        return [{ el: this.far, d: mid + 0.15 }, { el: this.near, d: mid - 0.15 }];
      },
    };
  };
  // Gymles-app: gymzaal met bruine houten vloer; trainersapp: blauw grootveld met boarding.
  const isGym = () => !!(window.FB_APP && window.FB_APP.id === 'gymzaal') || window.FB3D_GYM === true;

  /* ---------- Kit: tekstblokken, fluitje, ritmebalk ---------- */
  function makeKit(stage) {
    return {
      W: 1920, H: 1080, stage,
      h(s) { const d = document.createElement('div'); d.innerHTML = s; return d.firstElementChild; },
      fade(el, t, t0) { const k = clamp01((t - t0) / 0.5), e = eo(k); el.style.opacity = e; el.style.transform = 'translateX(' + ((1 - e) * 30).toFixed(1) + 'px)'; },
    };
  }
  const WHISTLE = '<svg class="d3-art fx-wh" viewBox="0 0 1920 1080"><g class="fx-rings" style="fill:none;stroke:var(--accent);stroke-width:6"><circle cx="1712" cy="150"/><circle cx="1712" cy="150"/></g>' +
    '<g class="fx-whistle"><path d="M-16 -60 Q-60 -110 -96 -150" style="fill:none;stroke:var(--main);stroke-width:6;stroke-linecap:round"/><path d="M-70 -30 a46 46 0 1 0 60 -34 h70 a12 12 0 0 0 12 -12 v-16 a12 12 0 0 0 -12 -12 h-96 Q-82 -64 -70 -30 Z" style="fill:var(--second)"/><circle cx="-36" cy="-4" r="18" style="fill:color-mix(in srgb, var(--second) 55%, var(--ground))"/><rect x="40" y="-74" width="34" height="14" rx="4" style="fill:var(--ground)"/><circle cx="-16" cy="-60" r="10" style="fill:none;stroke:var(--main);stroke-width:5"/></g></svg>';
  function whistle(sc, q) { sc.whistle = q('.fx-whistle'); sc.rings = Array.from(q('.fx-rings').children); }
  function renderWhistle(sc, t, TW) {
    const wi = eo(seg(t, TW - 0.6, TW - 0.1)), sh = Math.sin((t - TW) * 30) * Math.exp(-Math.max(0, t - TW) * 5) * (t > TW ? 8 : 0);
    sc.whistle.setAttribute('transform', 'translate(1712 190) scale(' + (wi * (1 + 0.02 * Math.sin(t * 2.1))).toFixed(3) + ') rotate(' + (sh - 8).toFixed(2) + ')');
    sc.whistle.style.opacity = wi;
    sc.rings.forEach((r, j) => { const k = seg(t, TW + j * 0.25, TW + 1.1 + j * 0.25); r.setAttribute('r', lerp(70, 240, eo(k)).toFixed(1)); r.style.opacity = (k > 0 && k < 1 ? 1 - k : 0).toFixed(3); });
  }
  const tagHtml = (cls, bg) => '<div class="' + cls + '" style="position:absolute;left:0;top:0;padding:10px 22px;border-radius:999px;background:' + bg + ';color:var(--ground);font-size:42px;font-weight:700;white-space:nowrap;opacity:0"></div>';
  function placeTag(el, cam, p, z, text, op) {
    if (text != null && el.textContent !== text) el.textContent = text;
    const q = cam.P(p[0], p[1], z);
    el.style.transform = 'translate(' + fx1(q[0]) + 'px,' + fx1(q[1]) + 'px) translate(-50%,-100%) scale(' + lerp(0.85, 1, op).toFixed(3) + ')';
    el.style.opacity = op.toFixed(3);
  }

  /* ================= Scène: Duel (O14, O18) ================= */
  const DUEL = (function () {
    const TW = 5.5, TS = 11.0, TE = 16, PW = 0.85;
    const DUOS = [{ c: [-12, -5], ph: 0.3, P: 1.3 }, { c: [-6, 5], ph: 2.1, P: 1.5, steal: true }, { c: [0, -5], ph: 4.0, P: 1.25 }, { c: [12, -5], ph: 1.2, P: 1.45 }, { c: [6, 5], ph: 5.0, P: 1.35 }];
    DUOS.forEach((d) => { d.off = (((0.15 * d.P - TW) % (2 * d.P)) + 2 * d.P) % (2 * d.P); });
    // A speelt met de stick links, B rechts: zo spelen ze elkaar allebei met de forehand aan.
    const HA = 1, HB = -1;
    function spelPass(d, t) {
      const q = PW * t + d.ph, c = [d.c[0] + 2.4 * Math.cos(q), d.c[1] + 1.2 * Math.sin(q)];
      const v = Math.atan2(1.2 * Math.cos(q), -2.4 * Math.sin(q)), pl = v + PI / 2, fx = Math.cos(v), fy = Math.sin(v);
      const ox = Math.cos(pl) * 2.0, oy = Math.sin(pl) * 2.0, lead = 0.4 * Math.sin(1.7 * t + d.ph);
      return { c, v, pl, A: [c[0] + ox + fx * lead, c[1] + oy + fy * lead], B: [c[0] - ox - fx * lead, c[1] - oy - fy * lead] };
    }
    const passPos = (d, t) => { const ps = spelPass(d, t); return { A: ps.A, B: ps.B, dA: ps.v - 0.45, dB: ps.v + 0.45, v: ps.v }; };
    const spot = (p, dir, h) => local(p, dir, 0.55, 0.3 * h);
    function spelCenter(d, t) { const p = spelPass(d, TW).c, k = Math.max(0, t - TW); return [p[0] + 0.25 * Math.sin(0.5 * k + d.ph), p[1] + 0.2 * Math.sin(0.4 * k + d.ph * 1.3)]; }
    // Passen: aannemen, bal meenemen naar achteren, door de bal vegen, loslaten en uitzwaaien naar de ander.
    function passBall(d, t) {
      const ps = passPos(d, t), u = (t + d.off) / d.P, n = Math.floor(u), f = u - n, aPass = ((n % 2) + 2) % 2 === 0;
      const who = (pp, a) => a ? { p: pp.A, dir: pp.dA, h: HA } : { p: pp.B, dir: pp.dB, h: HB };
      const P = who(ps, aPass), Q = who(ps, !aPass), to = n2([Q.p[0] - P.p[0], Q.p[1] - P.p[1]]);
      const sp = spot(P.p, P.dir, P.h), wind = [sp[0] - to[0] * 0.25, sp[1] - to[1] * 0.25], rel = [sp[0] + to[0] * 0.22, sp[1] + to[1] * 0.22];
      const recv = { pt: spot(Q.p, Q.dir, Q.h), side: 1, tilt: -0.1 };
      let ball, vp;
      if (f < 0.06) { ball = sp; vp = { pt: ball, side: 1, tilt: 0.15 }; }
      else if (f < 0.24) { ball = L2(sp, wind, eio((f - 0.06) / 0.18)); vp = { pt: ball, side: 1, tilt: 0.25 }; }
      else if (f < 0.32) { const k = ei((f - 0.24) / 0.08); ball = L2(wind, rel, k); vp = { pt: ball, side: 1, tilt: 0.25 * (1 - k) }; }
      else {
        const tArr = t + (1 - f) * d.P, Qa = who(passPos(d, tArr), !aPass), k = (f - 0.32) / 0.68;
        ball = L2(rel, spot(Qa.p, Qa.dir, Qa.h), k + 0.2 * k * (1 - k));
        const fol = [rel[0] + to[0] * 0.35, rel[1] + to[1] * 0.35];
        if (f < 0.5) { const k2 = eo((f - 0.32) / 0.18); vp = { pt: L2(rel, fol, k2), side: 1, lift: 0.07 * Math.sin(k2 * PI) }; }
        else vp = { pt: L2(fol, sp, eio(clamp01((f - 0.5) / 0.35))), side: 1 };
        if (f > 0.85) recv.gap = 0.0; else recv.gap = 0.04;
      }
      return aPass ? { ball, A: vp, B: recv, ps } : { ball, A: recv, B: vp, ps };
    }
    function duo(d, i, t) {
      if (t < TW) { const pb = passBall(d, t); return { A: pb.ps.A, B: pb.ps.B, dA: pb.ps.dA, dB: pb.ps.dB, vA: pb.A, vB: pb.B, ball: pb.ball, e: 0, c: pb.ps.A }; }
      const e = eio(seg(t, TW, TW + 0.6)), p0 = passBall(d, TW), ps = passPos(d, Math.min(t, TW + 0.6)), c = spelCenter(d, t);
      const a = spelPass(d, TW).pl + 0.8 * Math.sin(1.3 * (t - TW)) * eo(seg(t, TW, TW + 0.8)), ca = Math.cos(a), sa = Math.sin(a);
      const A = L2(ps.A, [c[0] + ca * 0.5, c[1] + sa * 0.5], e), B = L2(ps.B, [c[0] - ca * 0.5, c[1] - sa * 0.5], e);
      const w = d.steal ? eio(seg(t, TS, TS + 0.5)) : 0;
      const aBA = Math.atan2(A[1] - B[1], A[0] - B[0]), aAB = aBA + PI, sway = 0.12 * Math.sin(2.1 * t + i);
      // Wie de bal heeft draait zich half weg en houdt de tegenstander aan de kant zonder stick.
      const holdA = aBA + PI + 2.0 * HA + sway, holdB = aAB + PI + 2.0 * HB + sway;
      const dAd = angLerp(holdA, aAB, w), dBd = angLerp(aBA, holdB, w);
      const dA = angLerp(ps.dA, dAd, e), dB = angLerp(ps.dB, dBd, e);
      const dr = (h) => W.dribble(t - TW, h, 0.5, 0.3, 0.12, 2 * PI * 1.1);
      const drA = dr(HA), drB = dr(HB);
      const ballA = local(A, dA, drA.f, drA.l), ballB = local(B, dB, drB.f, drB.l);
      // Overgang van passen naar duel: de bal blijft bij A (die had hem op het fluitsignaal).
      const a0 = passPos(d, TW), loc0 = toLocal(a0.A, a0.dA, p0.ball);
      const ballDuel = L2(ballA, ballB, w), ballPass = local(A, dA, loc0[0], loc0[1]);
      const ball = L2(ballPass, ballDuel, e);
      const poke = 0.03 + 0.2 * (0.5 + 0.5 * Math.sin(3.1 * t + i * 1.7));
      const mixV = (p, q, k) => ({ pt: L2(p.pt, q.pt, k), side: lerp(p.side || 0, q.side || 0, k), gap: lerp(p.gap || 0, q.gap || 0, k), lift: lerp(p.lift || 0, q.lift || 0, k), tilt: lerp(p.tilt || 0, q.tilt || 0, k) });
      const holdV = (dd) => ({ pt: ball, side: dd.side, lift: dd.lift, tilt: dd.tilt }), defV = { pt: ball, side: 1, gap: poke };
      const vAd = mixV(holdV(drA), defV, w), vBd = mixV(defV, holdV(drB), w);
      const vA0 = { pt: local(A, dA, ...toLocal(a0.A, a0.dA, p0.A.pt)), side: p0.A.side, tilt: p0.A.tilt, lift: p0.A.lift };
      const vB0 = { pt: local(B, dB, ...toLocal(a0.B, a0.dB, p0.B.pt)), side: p0.B.side, gap: p0.B.gap };
      return { A, B, dA, dB, vA: mixV(vA0, vAd, e), vB: mixV(vB0, vBd, e), ball, e, c };
    }
    return {
      id: 'duel', programs: ['o14', 'o18'], loop: 17, end: 16, still: 12.5,
      label: 'Duel: duo\'s passen al lopend door de zaal en duelleren op het fluitsignaal',
      init(kit) {
        const o14 = window.FB_PROGRAM === 'o14';
        this.rink = W.rink(kit, 'spel-rink');
        this.duos = DUOS.map((d, i) => ({ a: W.player('spel-pa' + i, 'var(--team-a)', i * 2), b: W.player('spel-pb' + i, 'var(--teamb)', i * 2 + 1), ball: W.ball('spel-ball' + i) }));
        const people = this.duos.map((o) => o.a.markup + o.b.markup + o.ball.markup).join('');
        kit.stage.append(kit.h('<div class="d3-ground"><div class="d3-air"></div>' +
          '<svg class="d3-art" viewBox="0 0 1920 1080">' + this.rink.markup + '<g class="spel-people">' + people + '</g></svg>' +
          '<div class="d3-edge"></div><div class="d3-calm"></div>' + WHISTLE + tagHtml('spel-tag', 'var(--accent)') +
          '<div class="d3-words spel-g1" style="left:110px;top:80px;width:1000px"><p class="d3-eyebrow spel-e1">Stap 1 · ' + (o14 ? '40 seconden' : '30–40 seconden') + '</p></div>' +
          '<div class="d3-words spel-g2" style="left:110px;top:80px;width:1000px"><p class="d3-eyebrow spel-e2">Stap 2 · fluitsignaal · ' + (o14 ? '8' : '10') + ' seconden</p></div>' +
          '<div style="position:absolute;left:110px;bottom:64px;width:820px;padding:18px 22px 14px;border-radius:14px;background:color-mix(in srgb, var(--ground) 86%, transparent)">' +
          '<div style="position:relative;height:16px;border-radius:8px;overflow:hidden;background:color-mix(in srgb, var(--second) 18%, var(--ground))"><div class="spel-fill" style="position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg, var(--main) 0 78%, var(--accent) 78% 100%)"></div><div style="position:absolute;left:78%;top:0;bottom:0;width:4px;background:var(--ground)"></div></div>' +
          '<div style="display:flex;margin-top:10px;font-size:40px;white-space:nowrap"><span style="width:78%;color:var(--main)">passen ' + (o14 ? '40 s' : '30–40 s') + '</span><span style="color:var(--accent)">duel ' + (o14 ? '8' : '10') + ' s</span></div></div></div>'));
        const q = (s) => kit.stage.querySelector(s);
        this.rink.bind(q('.spel-rink'));
        this.duos.forEach((o, i) => { o.a.bind(q('.spel-pa' + i)); o.b.bind(q('.spel-pb' + i)); o.ball.bind(q('.spel-ball' + i)); });
        Object.assign(this, { people: q('.spel-people'), g1: q('.spel-g1'), g2: q('.spel-g2'), e1: q('.spel-e1'), e2: q('.spel-e2'), fill: q('.spel-fill'), tag: q('.spel-tag') });
        whistle(this, q);
        this.c1 = spelCenter(DUOS[1], TW);
      },
      render(t, kit) {
        // Camera zoals bij schaduwdribbel: na een overzicht dichtbij één duo, van schuin voor, rustig meedraaiend.
        const D = DUOS[1], dd = (tt) => { const s = duo(D, 1, tt); return { m: L2(s.A, s.B, 0.5), ab: [s.B[0] - s.A[0], s.B[1] - s.A[1]] }; };
        let ax = 0, ay = 0;
        for (let j = -6; j <= 6; j++) { const tt = clamp(t + j * 0.25, 0, TE), q = dd(Math.min(tt, TW - 0.01)), wj = 1 - Math.abs(j) / 7; ax += q.ab[0] * wj; ay += q.ab[1] * wj; }
        const here = dd(t), k0 = 1, k2 = eio(seg(t, TW - 0.5, TW + 1.0));
        const yaw = Math.atan2(ay, ax) - PI / 2 + 0.45;
        const cam = W.cam(kit, { yaw: angLerp(-0.7, yaw, k0), pitch: lerp(0.62, lerp(0.4, 0.34, k2), k0), d: lerp(30, lerp(8.2, 5.6, k2), k0),
          tx: lerp(0, here.m[0], k0), ty: lerp(0, here.m[1], k0), tz: lerp(0, 0.45, k0), oy: lerp(110, 90, k0) });
        this.rink.render(cam);
        const items = [];
        this.duos.forEach((o, i) => {
          const s = duo(DUOS[i], i, t), s1 = duo(DUOS[i], i, t + 0.05), s0 = duo(DUOS[i], i, t - 0.05);
          const vA = Math.hypot(s1.A[0] - s0.A[0], s1.A[1] - s0.A[1]) / 0.1, vB = Math.hypot(s1.B[0] - s0.B[0], s1.B[1] - s0.B[1]) / 0.1;
          const lean = lerp(0.2, 0.55, s.e), crouch = lerp(0.25, 0.6, s.e), run = 2 * PI * 1.45 * t + i * 1.3;
          const pa = W.rig({ x: s.A[0], y: s.A[1], dir: s.dA, hand: 'L', run, speed: Math.max(vA, 0.5 * s.e), lean, crouch, twist: 0.25 * s.e, ball: s.vA.pt, side: s.vA.side, gap: s.vA.gap, lift: s.vA.lift, tilt: s.vA.tilt });
          const pb = W.rig({ x: s.B[0], y: s.B[1], dir: s.dB, hand: 'R', run: run + 1.6, speed: Math.max(vB, 0.5 * s.e), lean, crouch, twist: -0.25 * s.e, ball: s.vB.pt, side: s.vB.side, gap: s.vB.gap, lift: s.vB.lift, tilt: s.vB.tilt });
          items.push({ el: o.a.g, d: o.a.render(cam, pa) }, { el: o.b.g, d: o.b.render(cam, pb) }, { el: o.ball.g, d: o.ball.render(cam, [s.ball[0], s.ball[1], R_BALL]) });
          if (i === 1) placeTag(this.tag, cam, s.c, 1.95, 'Bal veroverd', eo(seg(t, TS + 0.2, TS + 0.6)));
        });
        W.sortInto(this.people, items);
        kit.fade(this.e1, t, 0.1); this.g1.style.opacity = 1 - eo(seg(t, TW - 0.5, TW - 0.1));
        kit.fade(this.e2, t, TW + 0.15); this.g2.style.opacity = t < TW ? 0 : 1;
        const pr = t < TW ? 0.78 * seg(t, 0, TW) : 0.78 + 0.22 * seg(t, TW, TE);
        this.fill.style.clipPath = 'inset(0 ' + (100 - 100 * pr).toFixed(2) + '% 0 0)';
        renderWhistle(this, t, TW);
      },
    };
  })();

  /* ================= Scène: Schaduwdribbel (O10 / gymles) =================
     Voorganger en schaduw lopen dezelfde route; de schaduw volgt 1,3 s later maar nooit dichter dan 1,9 m.
     Op de route: links en rechts dribbelen, stoppen, versnellen, de bal door een staande hoepel spelen
     (zelf eromheen lopen) en een pass tegen de bank (in de trainersapp: de boarding), en een draai. */
  const SHADOW = (function () {
    const KID = 0.8, TAU = 1.3, GAP = 1.9, CAD = 1.6;
    // Route als rij stukken: rechtdoor (len) of bocht (r, ang; + = linksom). mark = naam van het begin van het stuk.
    function buildPath(start, a0, segs) {
      const pts = [[start[0], start[1], a0, 0]], marks = {};
      let x = start[0], y = start[1], a = a0, sl = 0;
      for (const g of segs) {
        if (g.mark) marks[g.mark] = sl;
        const L = g.r ? Math.abs(g.ang) * g.r : g.len, n = Math.max(1, Math.ceil(L / 0.02)), st = L / n, da = g.r ? g.ang / n : 0;
        for (let i = 0; i < n; i++) { a += da / 2; x += Math.cos(a) * st; y += Math.sin(a) * st; a += da / 2; sl += st; pts.push([x, y, a, sl]); }
      }
      marks.end = sl;
      return {
        marks, len: sl,
        at(q) {
          if (q <= 0) { const p = pts[0]; return { x: p[0] + Math.cos(p[2]) * q, y: p[1] + Math.sin(p[2]) * q, dir: p[2] }; }
          if (q >= sl) { const p = pts[pts.length - 1]; return { x: p[0] + Math.cos(p[2]) * (q - sl), y: p[1] + Math.sin(p[2]) * (q - sl), dir: p[2] }; }
          let lo = 0, hi = pts.length - 1;
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][3] <= q) lo = m; else hi = m; }
          const A = pts[lo], B = pts[hi], f = (q - A[3]) / (B[3] - A[3] || 1);
          return { x: lerp(A[0], B[0], f), y: lerp(A[1], B[1], f), dir: lerp(A[2], B[2], f) };
        },
      };
    }
    function make(gym) {
      const zc = gym ? [0, 0] : [0, 4], WALL = zc[1] + 6.0;     // muurlijn: voorkant van de bank of de boarding
      const P = buildPath([zc[0] - 6, zc[1] - 3.6], 0, [
        { len: 3.0 }, { len: 2.6, mark: 'wide' }, { len: 0.9, mark: 'wideEnd' }, { len: 2.4, mark: 'stop' },
        { r: 2.0, ang: PI / 2, mark: 'arc' },
        { r: 1.8, ang: -0.7, mark: 'hoop' }, { r: 1.8, ang: 1.4 }, { r: 1.8, ang: -0.7 },
        { r: 0.8, ang: PI / 2, mark: 'hoopEnd' },
        { len: 0.2, mark: 'top' }, { len: 3.4, mark: 'wall' }, { len: 1.6, mark: 'wallEnd' },
        { r: 0.9, ang: PI, mark: 'turn' }, { len: 1.6, mark: 'turnEnd' }]);
      const M = P.marks;
      // Snelheid van de voorganger per plek op de route (m/s), met een stop van 0,9 s.
      const HOLD = 0.9;
      const keys = [[-9, 1.5], [M.wide - 0.6, 1.5], [M.wide, 1.1], [M.wideEnd, 1.1]];
      const vAfter = [[M.stop, 0], [M.stop + 2.4, 2.4], [M.arc + 0.6, 1.9], [M.hoop, 1.6], [M.hoopEnd, 1.5], [M.wall, 1.35], [M.wallEnd, 1.35], [M.turn, 1.0], [M.turnEnd, 1.0], [M.end, 0]];
      const pw = (K, q) => { if (q <= K[0][0]) return K[0][1]; for (let i = 1; i < K.length; i++) if (q <= K[i][0]) return lerp(K[i - 1][1], K[i][1], (q - K[i - 1][0]) / (K[i][0] - K[i - 1][0])); return K[K.length - 1][1]; };
      const vprof = (q) => {
        if (q < M.wideEnd) return pw(keys, q);
        if (q < M.stop) return Math.max(0.1, 1.1 * Math.sqrt((M.stop - q) / (M.stop - M.wideEnd)));
        if (q < M.stop + 2.4) return Math.min(2.4, 0.3 + Math.sqrt(2 * 2.3 * (q - M.stop)));
        if (q >= M.end - 1.2) return Math.max(0.1, 1.0 * Math.sqrt((M.end - q) / 1.2));
        return pw(vAfter, q);
      };
      // Voorganger: s(t) door optellen; voor t < 0 loopt hij al rustig in.
      const DT = 1 / 120, sT = [];
      let q = 0, hold = 0, tEnd = 0;
      for (let i = 0; i < 60 * 120; i++) {
        sT.push(q);
        if (q >= M.end - 0.002) { if (!tEnd) tEnd = i * DT; continue; }
        if (q >= M.stop - 0.003 && q < M.stop + 0.01 && hold < HOLD) { hold += DT; if (hold >= HOLD) q = M.stop + 0.011; continue; }
        q = Math.min(M.end, q + vprof(q) * DT);
      }
      const sL = (t) => { if (t <= 0) return 1.5 * t; const i = Math.min(t / DT, sT.length - 1.001), j = Math.floor(i); return lerp(sT[j], sT[j + 1], i - j); };
      const smin = (a, b, k) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));
      const sS = (t) => smin(sL(t - TAU), sL(t) - GAP, 0.25);
      const kids = [sL, sS].map((fs) => {
        const tab = []; for (let t = -3; t <= tEnd + 4; t += 1 / 60) tab.push(fs(t));
        return { s: fs, tAt(q) { let lo = 0, hi = tab.length - 1; if (tab[hi] < q) return 1e9; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tab[m] < q) lo = m; else hi = m; } return -3 + hi / 60; } };
      });
      // Passen: hoepel (rechtdoor, de speler loopt eromheen) en tegen de bank/boarding (bal kaatst terug).
      const spot = (q, f, l) => { const p = P.at(q); return local([p.x, p.y], p.dir, f * KID, l * KID); };
      const hp0 = M.hoop + 0.25, hp1 = M.hoopEnd - 0.55;
      const hoopA = spot(hp0, 0.62, 0.26), hoopB = spot(hp1, 0.62, 0.26);
      const hoopC = L2(hoopA, hoopB, 0.5), hoopDir = Math.atan2(hoopB[1] - hoopA[1], hoopB[0] - hoopA[0]);
      const wp0 = M.wall + 0.3, wp1 = M.wallEnd + 0.3;
      const wallA = spot(wp0, 0.62, 0.26), wallB = spot(wp1, 0.62, 0.26);
      const mir = [wallB[0], 2 * WALL - wallB[1]], kw = (WALL - wallA[1]) / (mir[1] - wallA[1]);
      const wallHit = [lerp(wallA[0], mir[0], kw), WALL];
      const passes = [
        { s0: hp0, s1: hp1, A: hoopA, B: hoopB, word: 'Door de hoepel' },
        { s0: wp0, s1: wp1, A: wallA, B: wallB, hit: wallHit, word: gym ? 'Pass tegen de bank' : 'Pass tegen de boarding' }];
      const acts = [
        { a: M.wide, b: M.wideEnd, word: 'Links en rechts' }, { a: M.wideEnd + 0.2, b: M.stop + 0.005, word: 'Stoppen' },
        { a: M.stop + 0.02, b: M.arc, word: 'Versnellen' }, { a: hp0 - 0.6, b: hp1, word: passes[0].word },
        { a: wp0 - 0.6, b: wp1, word: passes[1].word }, { a: M.turn, b: M.turnEnd - 0.4, word: 'Draaien' }];
      return { gym, zc, WALL, P, M, kids, passes, acts, hoopC, hoopDir, wallHit, tEnd };
    }
    // Balbehandeling en bal voor één kind (index 0 = voorganger, 1 = schaduw) op tijd t.
    function kidState(R, ki, t) {
      const K = R.kids[ki], q = K.s(t), v = Math.max(0, (K.s(t + 0.04) - K.s(t - 0.04)) / 0.08), p = R.P.at(q), pos = [p.x, p.y], dir = p.dir;
      const wWide = clamp01((q - R.M.wide + 0.3) / 0.5) * (1 - clamp01((q - R.M.wideEnd + 0.2) / 0.4)), wStop = (1 - clamp01(v / 0.45)) * (1 - wWide);
      const wCarry = 1 - wWide - wStop, push = 0.5 + 0.5 * Math.sin(2 * PI * 1.5 * t);
      const carry = { f: 0.6 + 0.1 * push, l: 0.32, side: 1, lift: 0, tilt: 0.22, gap: 0 };
      const stop = { f: 0.55, l: 0.3, side: 0, lift: 2 * R_BALL * 0.97 / KID, tilt: 0, gap: 0 };
      const wide = W.dribble(t, 1, 0.58, 0.14, 0.3, 2 * PI * 0.95); wide.gap = 0;
      const m = (k) => carry[k] * wCarry + stop[k] * wStop + wide[k] * wWide;
      let h = { f: m('f'), l: m('l'), side: m('side'), lift: m('lift'), tilt: m('tilt'), gap: 0 };
      let ball = local(pos, dir, h.f * KID, h.l * KID), blade = null;
      for (const ps of R.passes) {
        const tp = K.tAt(ps.s0), tr = K.tAt(ps.s1);
        if (t < tp - 0.5 || t > tr + 0.4) continue;
        const pp = R.P.at(ps.s0), tgt = ps.hit || ps.B, dl = n2(toLocal([pp.x, pp.y], pp.dir, tgt));
        const front = [0.62, 0.26], backS = [front[0] - dl[0] * 0.35, front[1] - dl[1] * 0.35];
        if (t < tp) {                                                // uithalen en door de bal vegen
          const k1 = eio(seg(t, tp - 0.5, tp - 0.14)), k2 = ei(seg(t, tp - 0.14, tp));
          const f = lerp(lerp(h.f, backS[0], k1), front[0], k2), l = lerp(lerp(h.l, backS[1], k1), front[1], k2);
          h = { f, l, side: 1, lift: 0, tilt: 0.25 * (1 - k2), gap: 0 }; ball = local(pos, dir, f * KID, l * KID);
        } else if (t < tr) {                                         // bal onderweg
          const u = (t - tp) / (tr - tp);
          if (ps.hit) {
            const d1 = Math.hypot(ps.hit[0] - ps.A[0], ps.hit[1] - ps.A[1]), d2 = Math.hypot(ps.B[0] - ps.hit[0], ps.B[1] - ps.hit[1]), uh = d1 / (d1 + d2 * 1.5);
            ball = u < uh ? L2(ps.A, ps.hit, u / uh) : L2(ps.hit, ps.B, 1 - (1 - (u - uh) / (1 - uh)) ** 1.5);
          } else ball = L2(ps.A, ps.B, 1 - (1 - u) ** 1.7);
          const fo = eo(seg(t, tp, tp + 0.3)) * (1 - eio(seg(t, tp + 0.3, tp + 0.8)));
          const fl = lerp(lerp(front[0], carry.f, eio(seg(t, tp + 0.3, tp + 0.8))), front[0] + dl[0] * 0.3, fo);
          const ll = lerp(lerp(front[1], carry.l, eio(seg(t, tp + 0.3, tp + 0.8))), front[1] + dl[1] * 0.3, fo);
          const kr = eio(seg(t, tr - 0.55, tr));                     // blad klaar voor het aannemen
          const bf = lerp(fl, front[0], kr), bl = lerp(ll, front[1], kr);
          blade = { pt: local(pos, dir, bf * KID, bl * KID), side: 1, gap: 0.03 * (1 - kr), lift: 0.05 * fo, tilt: -0.1 * kr };
        } else {                                                     // aangenomen: terug naar meenemen
          const k = eio(seg(t, tr, tr + 0.4)), f = lerp(front[0], h.f, k), l = lerp(front[1], h.l, k);
          h = { f, l, side: lerp(1, h.side, k), lift: h.lift * k, tilt: lerp(0, h.tilt, k), gap: 0 }; ball = local(pos, dir, f * KID, l * KID);
        }
      }
      return { q, v, pos, dir, ball, blade: blade || { pt: ball, side: h.side, gap: h.gap, lift: h.lift, tilt: h.tilt } };
    }
    // Andere tweetallen: elk op een eigen ovaal in het midden van het vak, allemaal linksom en in dezelfde fase,
    // zodat ze steeds even ver van elkaar blijven. De schaduw loopt 2 m achter.
    const OVALS = [{ c: [-2.6, 0.0], rx: 1.5, ry: 0.85, v: 1.15 }, { c: [1.4, 0.0], rx: 1.5, ry: 0.85, v: 1.15 }, { c: [-6.0, 0.6], rx: 0.8, ry: 1.6, v: 1.05, lag: 2.6 }];
    function ovalKid(R, o, t, lagM) {
      const per = PI * (3 * (o.rx + o.ry) - Math.sqrt((3 * o.rx + o.ry) * (o.rx + 3 * o.ry))), w = 2 * PI * o.v / per;
      const th = w * t - 2 * PI * lagM / per + 0.6, x = R.zc[0] + o.c[0] + o.rx * Math.cos(th), y = R.zc[1] + o.c[1] + o.ry * Math.sin(th);
      const dir = Math.atan2(o.ry * Math.cos(th), -o.rx * Math.sin(th));
      const wd = 0.5 + 0.5 * Math.sin(0.7 * t + lagM), sw = clamp01((wd - 0.6) / 0.15);
      const c = { f: 0.6 + 0.1 * (0.5 + 0.5 * Math.sin(2 * PI * 1.4 * t)), l: 0.32, side: 1, lift: 0, tilt: 0.22 }, d = W.dribble(t, 1, 0.58, 0.14, 0.26, 2 * PI * 0.9);
      const h = {}; for (const k of ['f', 'l', 'side', 'lift', 'tilt']) h[k] = lerp(c[k], d[k], sw);
      return { pos: [x, y], dir, v: o.v, h, ball: local([x, y], dir, h.f * KID, h.l * KID) };
    }
    const MODEL = {};
    const model = (gym) => MODEL[gym] || (MODEL[gym] = make(gym));
    return {
      id: 'schaduw', programs: ['gymles'],
      get loop() { return model(isGym()).tEnd + 3.2; }, get end() { return model(isGym()).tEnd + 2.6; }, still: 9.0,
      label: 'Schaduwdribbel: de voorganger dribbelt door het vak en de schaduw doet alles na op twee meter',
      model, kidState, ovalKid, OVALS,
      init(kit) {
        const R = this.R = model(isGym());
        this.env = R.gym ? W.gym(kit, 'sh-env', 13, 6.4) : W.rink(kit, 'sh-env');
        this.lead = W.player('sh-lead', 'var(--team-a)', 3); this.shad = W.player('sh-shad', 'var(--teamb)', 1);
        this.b1 = W.ball('sh-b1'); this.b2 = W.ball('sh-b2');
        this.others = OVALS.map((c, i) => ({ a: W.player('sh-oa' + i, 'var(--team-a)', 4 + i), b: W.player('sh-ob' + i, 'var(--teamb)', 6 + i), ba: W.ball('sh-oba' + i), bb: W.ball('sh-obb' + i) }));
        this.cones = [0, 1, 2, 3].map((i) => W.cone('sh-cone' + i));
        this.hoop = W.hoop('sh-hoop');
        this.bench = R.gym ? W.bench('sh-bench') : null;
        const parts = [this.lead, this.shad, this.b1, this.b2, ...this.others.flatMap((o) => [o.a, o.b, o.ba, o.bb]), ...this.cones, this.bench].filter(Boolean);
        kit.stage.append(kit.h('<div class="d3-ground"><div class="d3-air"></div>' +
          '<svg class="d3-art" viewBox="0 0 1920 1080">' + this.env.markup + '<path class="sh-zone" style="fill:none;stroke:var(--conec);stroke-width:3;stroke-dasharray:14 12;opacity:.7"/>' +
          '<g class="sh-meter"><path style="fill:none;stroke:var(--second);stroke-width:4;stroke-dasharray:10 9;stroke-linecap:round"/></g><g class="sh-people">' + parts.map((x) => x.markup).join('') + this.hoop.markup + '</g></svg>' +
          '<div class="d3-edge"></div><div class="d3-calm"></div>' + WHISTLE + tagHtml('sh-tag1', 'var(--accent)') + tagHtml('sh-tag2', 'var(--main)') + tagHtml('sh-m', 'var(--second)') +
          '<div class="d3-words sh-g1" style="left:110px;top:80px;width:1100px"><p class="d3-eyebrow sh-e1">Schaduw volgt op 2 meter</p></div>' +
          '<div class="d3-words sh-g2" style="left:110px;top:80px;width:1100px"><p class="d3-eyebrow sh-e2">Fluitsignaal · wissel van rol</p></div></div>'));
        const q = (s) => kit.stage.querySelector(s);
        this.env.bind(q('.sh-env'));
        for (const [o, c] of [[this.lead, 'sh-lead'], [this.shad, 'sh-shad'], [this.b1, 'sh-b1'], [this.b2, 'sh-b2']]) o.bind(q('.' + c));
        if (this.bench) this.bench.bind(q('.sh-bench'));
        this.hoop.bind(q('.sh-hoop'));
        this.others.forEach((o, i) => { o.a.bind(q('.sh-oa' + i)); o.b.bind(q('.sh-ob' + i)); o.ba.bind(q('.sh-oba' + i)); o.bb.bind(q('.sh-obb' + i)); });
        this.cones.forEach((c, i) => c.bind(q('.sh-cone' + i)));
        Object.assign(this, { people: q('.sh-people'), zone: q('.sh-zone'), meter: q('.sh-meter path'), tag1: q('.sh-tag1'), tag2: q('.sh-tag2'), mtag: q('.sh-m'), g1: q('.sh-g1'), g2: q('.sh-g2'), e1: q('.sh-e1'), e2: q('.sh-e2') });
        whistle(this, q);
      },
      render(t, kit) {
        const R = this.R, TW = R.tEnd + 0.3, Ls = kidState(R, 0, t), Ss = kidState(R, 1, t), mid = L2(Ls.pos, Ss.pos, 0.5);
        // Camera aan de binnenkant van het vak, van opzij op het tweetal: wand, bank en hoepel staan erachter.
        let mx = 0, my = 0, ws = 0;
        for (let j = -6; j <= 6; j++) { const tt = t + j * 0.25, a = R.P.at(R.kids[0].s(tt)), b = R.P.at(R.kids[1].s(tt)), wj = 1 - Math.abs(j) / 7; mx += (a.x + b.x) / 2 * wj; my += (a.y + b.y) / 2 * wj; ws += wj; }
        mx /= ws; my /= ws;
        const side = Math.atan2(R.zc[1] - my, R.zc[0] - mx) + 0.35, k0 = 1;   // meteen ingezoomd
        const cam = W.cam(kit, { yaw: angLerp(-1.9, side, k0), pitch: lerp(0.62, 0.4, k0), d: lerp(18, 7.2, k0), tx: lerp(R.zc[0], mid[0], k0), ty: lerp(R.zc[1], mid[1], k0), tz: 0.4, oy: lerp(120, 90, k0) });
        this.env.render(cam);
        const z = R.zc;
        this.zone.setAttribute('d', W.path(cam, [[z[0] - 7.5, z[1] - 5, 0], [z[0] + 7.5, z[1] - 5, 0], [z[0] + 7.5, z[1] + 5, 0], [z[0] - 7.5, z[1] + 5, 0]], true));
        const items = [];
        [[-7.5, -5], [7.5, -5], [7.5, 5], [-7.5, 5]].forEach((c, i) => items.push({ el: this.cones[i].g, d: this.cones[i].render(cam, z[0] + c[0], z[1] + c[1]) }));
        if (this.bench) items.push({ el: this.bench.g, d: this.bench.render(cam, R.wallHit[0], R.WALL, 0, 2) });
        items.push(...this.hoop.render(cam, R.hoopC, R.hoopDir));
        const lookAt = Math.atan2(Ls.pos[1] - Ss.pos[1], Ls.pos[0] - Ss.pos[0]), glance = clamp01(1.4 * Math.sin(t * 1.3) - 0.2);
        const pose = (k, look, ph) => W.rig({ x: k.pos[0], y: k.pos[1], dir: k.dir, hand: 'L', k: KID, run: 2 * PI * CAD * t + ph, speed: k.v, cad: CAD, crouch: 0.35 + 0.15 * (1 - clamp01(k.v / 1.5)), lean: 0.28,
          look, ball: k.blade.pt, side: k.blade.side, gap: k.blade.gap, lift: k.blade.lift, tilt: k.blade.tilt });
        items.push({ el: this.lead.g, d: this.lead.render(cam, pose(Ls, undefined, 0)) }, { el: this.shad.g, d: this.shad.render(cam, pose(Ss, angLerp(Ss.dir, lookAt, glance), 1.1)) });
        items.push({ el: this.b1.g, d: this.b1.render(cam, [Ls.ball[0], Ls.ball[1], R_BALL]) }, { el: this.b2.g, d: this.b2.render(cam, [Ss.ball[0], Ss.ball[1], R_BALL]) });
        const dMain = cam.P(mid[0], mid[1], 0)[2];
        this.others.forEach((o, i) => {
          for (const [pl2, bl, lag, ph] of [[o.a, o.ba, 0, 0.5 + i], [o.b, o.bb, OVALS[i].lag || 2.0, 1.7 + i]]) {
            const k = ovalKid(R, OVALS[i], t, lag);
            const ps = W.rig({ x: k.pos[0], y: k.pos[1], dir: k.dir, hand: 'L', k: KID, run: 2 * PI * CAD * t + ph, speed: k.v, cad: CAD, crouch: 0.4, lean: 0.28, ball: k.ball, side: k.h.side, lift: k.h.lift, tilt: k.h.tilt });
            items.push({ el: pl2.g, d: pl2.render(cam, ps) }, { el: bl.g, d: bl.render(cam, [k.ball[0], k.ball[1], R_BALL]) });
            const near = clamp01((dMain - 1.2 - cam.P(k.pos[0], k.pos[1], 0)[2]) / 1.5);
            pl2.g.style.opacity = bl.g.style.opacity = (1 - 0.85 * near).toFixed(2);
          }
        });
        W.sortInto(this.people, items);
        const mo = eo(seg(t, 0.8, 1.4)) * (1 - eo(seg(t, 3.6, 4.2)));
        this.meter.setAttribute('d', W.path(cam, [[Ss.pos[0], Ss.pos[1], 0.02], [Ls.pos[0], Ls.pos[1], 0.02]])); this.meter.style.opacity = mo;
        placeTag(this.mtag, cam, mid, 0.25, '2 m', mo);
        const act = (q) => R.acts.find((a) => q >= a.a && q < a.b);
        const fadeQ = (q, a) => a ? clamp01((q - a.a) / 0.25) * clamp01((a.b - q) / 0.25) : 0;
        const intro = 1 - eo(seg(t, 2.0, 2.4)), aL = act(Ls.q), aS = act(Ss.q);
        const opL = aL ? Math.max(fadeQ(Ls.q, aL), aL.word === 'Stoppen' && Ls.v < 0.2 ? 1 : 0) : intro * eo(seg(t, 0.2, 0.6));
        const opS = aS ? Math.max(fadeQ(Ss.q, aS), aS.word === 'Stoppen' && Ss.v < 0.2 ? 1 : 0) : intro * eo(seg(t, 0.4, 0.8));
        placeTag(this.tag1, cam, Ls.pos, 1.5, aL ? aL.word : 'Voorganger', opL);
        placeTag(this.tag2, cam, Ss.pos, 1.5, aS ? 'Nadoen' : 'Schaduw', opS);
        kit.fade(this.e1, t, 0.1); this.g1.style.opacity = 1 - eo(seg(t, TW - 0.5, TW - 0.1));
        kit.fade(this.e2, t, TW + 0.15); this.g2.style.opacity = t < TW ? 0 : 1;
        renderWhistle(this, t, TW);
      },
    };
  })();

  const SCENES = { duel: DUEL, schaduw: SHADOW };

  const CSS = '.d3-tabs{display:inline-grid;grid-template-columns:1fr 1fr;border:1.5px solid var(--ink);border-radius:9px;overflow:hidden;justify-self:start}' +
    '.d3-tabs button{font:inherit;font-size:14px;font-weight:700;padding:7px 14px;border:none;background:var(--surface);color:var(--ink);cursor:pointer}' +
    '.d3-tabs button+button{border-left:1.5px solid var(--ink)}.d3-tabs button[aria-pressed="true"]{background:var(--ink);color:var(--surface)}' +
    '.d3{position:relative;width:100%;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#12171D}' +
    '.d3-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;' +
    '--ground:#12171D;--main:#6FC0CF;--second:#E8EDF2;--accent:#FF6B5E;color:var(--second);font-family:var(--body);line-height:1.3;' +
    '--floor:#2D63A6;--teamb:#5BB0F2;--board:color-mix(in srgb, var(--second) 82%, var(--main));--boardshade:color-mix(in srgb, var(--second) 40%, var(--ground));' +
    '--paint:rgba(255,255,255,.85);--stick:#F4F6F8;--grip:#22272E;--shorts:#1E2630;--shoe:#F1F3F5;--sole:#2E343B;--ballc:#F7F8F4;' +
    '--bladefh:#FFFFFF;--bladebh:#C9D1D9;--bladeedge:#5B6570;--conec:#F28C28;--hoop:#F2C230;' +
    '--wood:#B9854F;--woodline:rgba(90,55,20,.18);--wall:#DCE3E8;--wallshade:#9AA6AF;--bars:#B07D46;--gymline:#E85A4F;--gymline2:#2F7FC1;--benchtop:#E2BF8A;--benchside:#A97A48}' +
    '.d3-stage svg{overflow:visible}.d3-ground{position:absolute;inset:0;background:var(--ground)}' +
    '.d3-air{position:absolute;inset:0;background:radial-gradient(80% 70% at 50% 42%, color-mix(in srgb, var(--main) 16%, var(--ground)), var(--ground) 70%)}' +
    '.d3-art{position:absolute;inset:0;width:100%;height:100%}' +
    '.d3-edge{position:absolute;inset:0;pointer-events:none;background:radial-gradient(95% 85% at 50% 50%, transparent 58%, color-mix(in srgb, var(--ground) 70%, transparent))}' +
    '.d3-calm{position:absolute;left:0;top:0;width:62%;height:40%;background:radial-gradient(100% 100% at 0 0, color-mix(in srgb, var(--ground) 92%, transparent) 50%, transparent)}' +
    '.d3-words{position:absolute;margin:0;display:flex;flex-direction:column;gap:18px}.d3-words>*{margin:0}' +
    '.d3-eyebrow{font-family:var(--display);font-weight:800;font-size:72px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);line-height:1.05}' +
    '.d3-play{position:absolute;right:10px;bottom:10px;font:inherit;font-size:14px;font-weight:700;border:none;border-radius:999px;padding:6px 14px;background:rgb(232 237 242 / .92);color:#12171D;cursor:pointer}';
  function css() {
    if (document.getElementById('fb3d-css')) return;
    const s = document.createElement('style'); s.id = 'fb3d-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function mount(box, id, reduce, isPaused) {
    const sc = SCENES[id]; if (!sc) return () => {};
    css();
    box.innerHTML = '<div class="d3-stage"></div><button type="button" class="d3-play"></button>';
    const stage = box.firstChild, btn = box.lastChild, kit = makeKit(stage), scene = Object.create(sc);
    scene.init(kit);
    const draw = (t) => scene.render(t, kit);
    const fit = () => { stage.style.transform = 'scale(' + (box.clientWidth / 1920) + ')'; }; fit();
    const ro = new ResizeObserver(fit); ro.observe(box);
    let run = !reduce && !isPaused(), t = reduce ? sc.still : 0, last = null, raf = 0;
    const label = () => { btn.textContent = run ? 'Pauze' : 'Afspelen'; }; label(); draw(t);
    box.fb3dDraw = draw;   // voor testen: box.fb3dDraw(t) tekent één beeld
    const step = (now) => { if (last !== null) t = (t + (now - last) / 1000) % sc.loop; last = now; draw(Math.min(t, sc.end)); raf = requestAnimationFrame(step); };
    const go = () => { last = null; cancelAnimationFrame(raf); if (run) raf = requestAnimationFrame(step); }; go();
    btn.addEventListener('click', () => { run = !run; label(); go(); });
    return () => { cancelAnimationFrame(raf); ro.disconnect(); box.innerHTML = ''; };
  }

  const program = () => window.FB_PROGRAM;
  window.FB3D = {
    W, R_BALL,
    has: (id) => !!SCENES[id] && SCENES[id].programs.indexOf(program()) >= 0,
    label: (id) => SCENES[id] ? '3D-animatie van ' + SCENES[id].label : '',
    scene: (id) => SCENES[id],   // voor testen
    mount,
  };
  window.Duel3D = { mount: (box, reduce, isPaused) => mount(box, 'duel', reduce, isPaused) };
})();
