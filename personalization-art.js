/**
 * StudyMate AI — Presets: procedural art engine (pure functions, no DOM access)
 * ─────────────────────────────────────────────────────────────────────────
 * Backgrounds and Bagley are drawn as ORIGINAL vector scenes generated from
 * tiny data specs (see personalization-data.js). Nothing here is scraped,
 * licensed, or hot-linked, and there are no image files to download: a
 * background is ~4–12 KB of SVG text produced on demand for the ONE scene
 * being shown (plus lazily-rendered thumbnails), so 100 backgrounds cost no
 * start-up time and no bandwidth.
 *
 *   SMArt.scene(spec, {key, live})  → SVG string (viewBox 400×800, "slice")
 *   SMArt.bagley(spec, {key, size}) → SVG string (viewBox 120×130)
 *   SMArt.hueOf(hex) / SMArt.contrast(a, b) / SMArt.fitContrast(hex, bg, min)
 *
 * `key` makes gradient ids unique when several SVGs share one page.
 * `live` adds the CSS-animated groups (twinkle, drift, rain…); thumbnails
 * are static. Animations are defined in the app stylesheet and are disabled
 * for prefers-reduced-motion and by the "Animations" toggle.
 */
(function (root) {
  'use strict';
  const W = 400, H = 800;

  // ───────────── helpers ─────────────
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const f = (n) => Math.round(n * 10) / 10;
  function hex2rgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  }
  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }
  function lum(h) {
    const c = hex2rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0); else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s, l];
  }
  function hsl2hex(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const t = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; };
    return rgb2hex(t(h + 1 / 3) * 255, t(h) * 255, t(h - 1 / 3) * 255);
  }
  function hueOf(hex) { const c = hex2rgb(hex); return rgb2hsl(c[0], c[1], c[2])[0]; }
  // Nudge a colour's lightness until it reaches `min` contrast against `bg`.
  function fitContrast(hex, bg, min) {
    if (contrast(hex, bg) >= min) return hex;
    const c = hex2rgb(hex), hsl = rgb2hsl(c[0], c[1], c[2]);
    const goLighter = lum(bg) < 0.4;
    let l = hsl[2];
    for (let i = 0; i < 40; i++) {
      l += goLighter ? 0.02 : -0.02;
      l = Math.max(0.04, Math.min(0.96, l));
      const t = hsl2hex(hsl[0], hsl[1], l);
      if (contrast(t, bg) >= min) return t;
    }
    return goLighter ? '#ffffff' : '#000000';
  }

  // Render context: unique gradient ids + collected <defs>.
  function ctx(key, seed, live) {
    return { p: key || 'k', n: 0, defs: [], r: rng(seed || 1), live: !!live };
  }
  function rg(c, stops, cx, cy, r) { // radial gradient → url(#id)
    const id = c.p + 'r' + (c.n++);
    c.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}">` +
      stops.map(s => `<stop offset="${s[0]}" stop-color="${s[1]}" stop-opacity="${s[2] == null ? 1 : s[2]}"/>`).join('') + '</radialGradient>');
    return `url(#${id})`;
  }
  function lg(c, stops, x1, y1, x2, y2) { // linear gradient → url(#id)
    const id = c.p + 'l' + (c.n++);
    c.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}">` +
      stops.map(s => `<stop offset="${s[0]}" stop-color="${s[1]}" stop-opacity="${s[2] == null ? 1 : s[2]}"/>`).join('') + '</linearGradient>');
    return `url(#${id})`;
  }
  const anim = (c, cls, i, extra) => c.live ? ` class="${cls}" style="animation-delay:${-(i * 0.73 % 7).toFixed(2)}s${extra || ''}"` : '';

  // ───────────── scene generators ─────────────
  // Each takes (c, ...args) and returns SVG markup. Coordinates are in the
  // 400×800 viewBox. Colours are hex strings.
  const G = {
    stars(c, n, col, rmax, ymax) {
      col = col || '#ffffff'; rmax = rmax || 1.3; ymax = ymax == null ? 0.72 : ymax;
      let s = '<g fill="' + col + '">';
      for (let i = 0; i < n; i++) {
        const x = c.r() * W, y = c.r() * H * ymax, r = 0.3 + c.r() * rmax, o = 0.35 + c.r() * 0.65;
        s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" opacity="${f(o)}"${i % 4 === 0 ? anim(c, 'tw', i) : ''}/>`;
      }
      return s + '</g>';
    },
    glow(c, x, y, r, col, op) {
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${rg(c, [[0, col, op == null ? 0.6 : op], [1, col, 0]], x, y, r)}"/>`;
    },
    nebula(c, x, y, r, c1, c2, op) {
      op = op == null ? 0.5 : op;
      return G.glow(c, x, y, r, c1, op) + G.glow(c, x + r * 0.45, y + r * 0.2, r * 0.8, c2, op * 0.85) + G.glow(c, x - r * 0.4, y + r * 0.35, r * 0.6, c2, op * 0.6);
    },
    planet(c, x, y, r, c1, c2, ring) {
      let s = '';
      const rc = ring ? (typeof ring === 'string' ? ring : mix(c1, '#ffffff', 0.35)) : null;
      if (rc) s += `<ellipse cx="${x}" cy="${y}" rx="${f(r * 1.9)}" ry="${f(r * 0.45)}" fill="none" stroke="${rc}" stroke-width="${f(r * 0.16)}" opacity=".55" transform="rotate(-18 ${x} ${y})"/>`;
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${rg(c, [[0, c1], [1, c2]], x - r * 0.35, y - r * 0.35, r * 1.5)}"/>`;
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${rg(c, [[0.55, '#000', 0], [1, '#000', 0.6]], x - r * 0.4, y - r * 0.4, r * 1.45)}"/>`;
      if (rc) s += `<path d="M${f(x - r * 1.9 * 0.95)} ${f(y + r * 0.12)} A${f(r * 1.9)} ${f(r * 0.45)} -18 0 0 ${f(x + r * 1.9 * 0.95)} ${f(y - r * 0.12)}" fill="none" stroke="${rc}" stroke-width="${f(r * 0.16)}" opacity=".7" transform="rotate(-18 ${x} ${y})"/>`;
      return s;
    },
    moon(c, x, y, r, col, gcol) {
      col = col || '#f2efe2';
      let s = G.glow(c, x, y, r * 3.2, gcol || '#9fb4ff', 0.35);
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${rg(c, [[0, '#ffffff'], [1, col]], x - r * 0.3, y - r * 0.3, r * 1.4)}"/>`;
      for (let i = 0; i < 5; i++) s += `<circle cx="${f(x + (c.r() - 0.5) * r * 1.2)}" cy="${f(y + (c.r() - 0.5) * r * 1.2)}" r="${f(r * (0.08 + c.r() * 0.14))}" fill="#000" opacity=".07"/>`;
      return s;
    },
    sun(c, x, y, r, col, gcol) {
      return G.glow(c, x, y, r * 4, gcol || col, 0.45) + G.glow(c, x, y, r * 2, col, 0.5) +
        `<circle cx="${x}" cy="${y}" r="${r}" fill="${mix(col, '#ffffff', 0.55)}"/>`;
    },
    blackhole(c, x, y, r) {
      let s = G.glow(c, x, y, r * 3, '#ff9a3c', 0.35);
      s += `<ellipse cx="${x}" cy="${y}" rx="${r * 2.6}" ry="${f(r * 0.55)}" fill="${lg(c, [[0, '#ff5a1f', 0], [0.35, '#ffb347', 0.95], [0.5, '#fff1c9'], [0.65, '#ffb347', 0.95], [1, '#ff5a1f', 0]], x - r * 2.6, y, x + r * 2.6, y)}"/>`;
      s += `<circle cx="${x}" cy="${y}" r="${r * 1.08}" fill="none" stroke="#ffd9a0" stroke-width="2.5" opacity=".7"/>`;
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="#000"/>`;
      s += `<path d="M${x - r * 2.5} ${y} A${r * 2.5} ${r * 0.5} 0 0 0 ${x + r * 2.5} ${y}" fill="none" stroke="#ffcf8a" stroke-width="3" opacity=".8"/>`;
      return s;
    },
    eclipse(c, x, y, r, col) {
      col = col || '#ffd27a';
      let s = G.glow(c, x, y, r * 4, col, 0.5);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        s += `<path d="M${f(x + Math.cos(a) * r)} ${f(y + Math.sin(a) * r)} L${f(x + Math.cos(a + 0.05) * r * 2.6)} ${f(y + Math.sin(a + 0.05) * r * 2.6)} L${f(x + Math.cos(a + 0.12) * r)} ${f(y + Math.sin(a + 0.12) * r)}Z" fill="${col}" opacity=".16"/>`;
      }
      return s + `<circle cx="${x}" cy="${y}" r="${f(r * 1.06)}" fill="none" stroke="${col}" stroke-width="3" opacity=".85"/><circle cx="${x}" cy="${y}" r="${r}" fill="#020204"/>`;
    },
    ridge(c, col, base, amp, seed, jag, op, snow) {
      const r = rng(seed || 1); jag = jag || 1; amp = amp || 60;
      let d = `M-10 ${H} L-10 ${base}`, pts = [];
      for (let x = -10; x <= W + 30; x += 24 / jag) {
        const y = base - amp * (0.25 + r() * 0.75) * (0.55 + 0.45 * Math.sin(x / 70 + (seed || 1)));
        pts.push([x, y]); d += ` L${f(x)} ${f(y)}`;
      }
      d += ` L${W + 30} ${H}Z`;
      let s = `<path d="${d}" fill="${col}" opacity="${op == null ? 1 : op}"/>`;
      if (snow) pts.forEach(p => { if (p[1] < base - amp * 0.62) s += `<path d="M${f(p[0] - 9)} ${f(p[1] + 14)} L${f(p[0])} ${f(p[1])} L${f(p[0] + 9)} ${f(p[1] + 14)} L${f(p[0] + 3)} ${f(p[1] + 11)} L${f(p[0] - 2)} ${f(p[1] + 15)}Z" fill="${snow}" opacity=".85"/>`; });
      return s;
    },
    hills(c, col, base, amp, seed, op, edge) {
      const r = rng(seed || 2); amp = amp || 40;
      let d = `M-10 ${H} L-10 ${base}`;
      const ph = r() * 6;
      for (let x = -10; x <= W + 20; x += 20) d += ` L${f(x)} ${f(base - amp * (0.5 + 0.5 * Math.sin(x / 55 + ph) * 0.7 + 0.3 * Math.sin(x / 23 + ph * 2)))}`;
      d += ` L${W + 20} ${H}Z`;
      return `<path d="${d}" fill="${col}" opacity="${op == null ? 1 : op}"${edge ? ` stroke="${edge}" stroke-width="1.2"` : ''} stroke-linejoin="round"/>`;
    },
    dunes(c, col, base, amp, seed, hi) {
      const r = rng(seed || 3); amp = amp || 50;
      let d = `M-10 ${H} L-10 ${base}`, top = '';
      const ph = r() * 5;
      for (let x = -10; x <= W + 20; x += 10) {
        const y = base - amp * (0.5 + 0.5 * Math.sin(x / 90 + ph)) - amp * 0.25 * Math.sin(x / 37 + ph);
        d += ` L${f(x)} ${f(y)}`; top += (top ? ' L' : 'M') + f(x) + ' ' + f(y);
      }
      d += ` L${W + 20} ${H}Z`;
      return `<path d="${d}" fill="${col}"/>` + (hi ? `<path d="${top}" fill="none" stroke="${hi}" stroke-width="1.6" opacity=".7"/>` : '');
    },
    forest(c, col, base, n, seed, kind, hmin, hmax) {
      const r = rng(seed || 4); hmin = hmin || 40; hmax = hmax || 110; kind = kind || 'pine';
      let s = `<g fill="${col}">`;
      for (let i = 0; i < n; i++) {
        const x = (i + r() * 0.8) * (W / n) - 6, h = hmin + r() * (hmax - hmin), w = h * 0.34;
        if (kind === 'pine') {
          for (let t = 0; t < 4; t++) { const y0 = base - h * (0.18 + t * 0.22), ww = w * (1 - t * 0.2); s += `<path d="M${f(x - ww)} ${f(y0)} L${f(x)} ${f(y0 - h * 0.36)} L${f(x + ww)} ${f(y0)}Z"/>`; }
          s += `<rect x="${f(x - 1.5)}" y="${f(base - h * 0.18)}" width="3" height="${f(h * 0.2)}"/>`;
        } else if (kind === 'round') {
          s += `<rect x="${f(x - 1.6)}" y="${f(base - h * 0.5)}" width="3.2" height="${f(h * 0.52)}"/><circle cx="${f(x)}" cy="${f(base - h * 0.62)}" r="${f(w * 0.85)}"/><circle cx="${f(x - w * 0.5)}" cy="${f(base - h * 0.5)}" r="${f(w * 0.55)}"/><circle cx="${f(x + w * 0.5)}" cy="${f(base - h * 0.52)}" r="${f(w * 0.55)}"/>`;
        } else if (kind === 'palm') {
          s += `<path d="M${f(x)} ${base} Q${f(x + w * 0.4)} ${f(base - h * 0.5)} ${f(x + w * 0.2)} ${f(base - h)}" stroke="${col}" stroke-width="3" fill="none"/>`;
          for (let k = 0; k < 6; k++) { const a = -2.9 + k * 0.58, ex = x + w * 0.2 + Math.cos(a) * h * 0.42, ey = base - h + Math.sin(a) * h * 0.2 + 10; s += `<path d="M${f(x + w * 0.2)} ${f(base - h)} Q${f((x + w * 0.2 + ex) / 2)} ${f(base - h - 18)} ${f(ex)} ${f(ey)} Q${f((x + w * 0.2 + ex) / 2)} ${f(base - h - 5)} ${f(x + w * 0.2)} ${f(base - h)}Z"/>`; }
        } else if (kind === 'bamboo') {
          s += `<rect x="${f(x)}" y="${f(base - h * 1.4)}" width="4" height="${f(h * 1.4)}"/>`;
          for (let k = 1; k < 6; k++) s += `<rect x="${f(x - 1)}" y="${f(base - h * 0.25 * k)}" width="6" height="1.5" opacity=".6"/>`;
        } else if (kind === 'willow') {
          s += `<rect x="${f(x - 2)}" y="${f(base - h * 0.55)}" width="4" height="${f(h * 0.55)}"/>`;
          for (let k = 0; k < 7; k++) s += `<path d="M${f(x)} ${f(base - h * 0.55)} Q${f(x - 14 + k * 5)} ${f(base - h * 0.5)} ${f(x - 20 + k * 7)} ${f(base - h * 0.1)}" stroke="${col}" stroke-width="1.6" fill="none"/>`;
          s += `<ellipse cx="${f(x)}" cy="${f(base - h * 0.6)}" rx="${f(w * 0.6)}" ry="${f(h * 0.14)}"/>`;
        }
      }
      return s + `<rect x="-10" y="${base - 2}" width="${W + 20}" height="${H - base + 2}"/></g>`;
    },
    city(c, col, base, seed, win, hmax, n, neon) {
      const r = rng(seed || 5); hmax = hmax || 220; n = n || 18;
      let s = `<g fill="${col}">`, lights = '';
      let x = -8;
      for (let i = 0; i < n && x < W; i++) {
        const w = 18 + r() * 34, h = 40 + r() * hmax;
        s += `<rect x="${f(x)}" y="${f(base - h)}" width="${f(w)}" height="${f(h + 2)}"/>`;
        if (r() > 0.6) s += `<rect x="${f(x + w / 2 - 1)}" y="${f(base - h - 22)}" width="2" height="22"/>`;
        if (win) for (let wy = base - h + 8; wy < base - 6; wy += 12) for (let wx = x + 4; wx < x + w - 5; wx += 8) if (r() > 0.62) lights += `<rect x="${f(wx)}" y="${f(wy)}" width="3.4" height="5" fill="${r() > 0.85 ? (neon || win) : win}" opacity="${f(0.45 + r() * 0.5)}"/>`;
        if (neon && r() > 0.55) lights += `<rect x="${f(x)}" y="${f(base - h * (0.3 + r() * 0.5))}" width="${f(w)}" height="2.2" fill="${neon}" opacity=".9"/>`;
        x += w + r() * 5;
      }
      return s + '</g>' + lights;
    },
    waves(c, col, base, amp, op, layers) {
      layers = layers || 3; let s = '';
      for (let k = 0; k < layers; k++) {
        const y0 = base + k * amp * 1.3; let d = `M-10 ${H} L-10 ${y0}`;
        for (let x = -10; x <= W + 20; x += 12) d += ` L${x} ${f(y0 + Math.sin(x / (38 + k * 12) + k * 1.7) * amp)}`;
        s += `<path d="${d} L${W + 20} ${H}Z" fill="${col}" opacity="${f((op == null ? 0.5 : op) * (0.55 + k * 0.25))}"/>`;
      }
      return s;
    },
    water(c, c1, c2, base) {
      let s = `<rect x="0" y="${base}" width="${W}" height="${H - base}" fill="${lg(c, [[0, c1], [1, c2]], 0, base, 0, H)}"/>`;
      for (let i = 0; i < 14; i++) { const y = base + 6 + i * (H - base) / 15, w = 30 + c.r() * 120, x = c.r() * (W - w); s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="1.4" fill="#fff" opacity="${f(0.05 + c.r() * 0.12)}"${i % 3 === 0 ? anim(c, 'dr', i) : ''}/>`; }
      return s;
    },
    aurora(c, cols, y, amp) {
      let s = ''; amp = amp || 60;
      cols.forEach((col, k) => {
        const y0 = y + k * 34; let top = `M-20 ${y0}`, bot = '';
        for (let x = -20; x <= W + 20; x += 20) top += ` L${x} ${f(y0 + Math.sin(x / 60 + k * 1.3) * amp * 0.5 + Math.sin(x / 27 + k) * 12)}`;
        for (let x = W + 20; x >= -20; x -= 20) bot += ` L${x} ${f(y0 + 150 + Math.sin(x / 50 + k) * 24)}`;
        s += `<path d="${top}${bot}Z" fill="${lg(c, [[0, col, 0.0], [0.25, col, 0.55], [1, col, 0]], 0, y0 - 20, 0, y0 + 160)}"${anim(c, 'dr', k * 2)}/>`;
      });
      return s;
    },
    clouds(c, col, y, n, seed, op, sc) {
      const r = rng(seed || 6); sc = sc || 1; let s = `<g fill="${col}" opacity="${op == null ? 0.5 : op}">`;
      for (let i = 0; i < n; i++) {
        const x = r() * W, yy = y + (r() - 0.5) * 120, k = (0.7 + r() * 0.8) * sc;
        s += `<g${anim(c, 'dr', i)}><ellipse cx="${f(x)}" cy="${f(yy)}" rx="${f(46 * k)}" ry="${f(12 * k)}"/><ellipse cx="${f(x - 22 * k)}" cy="${f(yy - 6 * k)}" rx="${f(26 * k)}" ry="${f(14 * k)}"/><ellipse cx="${f(x + 18 * k)}" cy="${f(yy - 9 * k)}" rx="${f(30 * k)}" ry="${f(16 * k)}"/></g>`;
      }
      return s + '</g>';
    },
    islands(c, n, seed, top, rock, fall) {
      const r = rng(seed || 7); let s = '';
      for (let i = 0; i < n; i++) {
        const x = 40 + r() * (W - 80), y = 110 + (i * (H * 0.5 / n)) + r() * 60, w = 40 + r() * 50, k = w / 60;
        s += `<g${anim(c, 'fl', i)}>`;
        if (fall && r() > 0.4) s += `<rect x="${f(x - 1.5)}" y="${f(y + 4)}" width="3" height="${f(70 * k + 60)}" fill="${fall}" opacity=".35"/>`;
        s += `<path d="M${f(x - w)} ${f(y)} Q${f(x)} ${f(y + 8)} ${f(x + w)} ${f(y)} L${f(x + w * 0.5)} ${f(y + 36 * k)} L${f(x + w * 0.1)} ${f(y + 62 * k)} L${f(x - w * 0.35)} ${f(y + 30 * k)}Z" fill="${rock}"/>`;
        s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(w)}" ry="${f(7 * k + 3)}" fill="${top}"/>`;
        s += `<circle cx="${f(x - w * 0.3)}" cy="${f(y - 10 * k)}" r="${f(9 * k + 2)}" fill="${top}"/><circle cx="${f(x + w * 0.2)}" cy="${f(y - 14 * k)}" r="${f(11 * k + 2)}" fill="${top}"/></g>`;
      }
      return s;
    },
    castle(c, col, x, base, s, win) {
      s = s || 1; let o = `<g fill="${col}">`; const lights = [];
      const tower = (tx, tw, th, cone) => {
        o += `<rect x="${f(x + tx * s)}" y="${f(base - th * s)}" width="${f(tw * s)}" height="${f(th * s)}"/>`;
        if (cone) o += `<path d="M${f(x + (tx - 3) * s)} ${f(base - th * s)} L${f(x + (tx + tw / 2) * s)} ${f(base - (th + cone) * s)} L${f(x + (tx + tw + 3) * s)} ${f(base - th * s)}Z"/>`;
        else for (let k = 0; k < tw; k += 7) o += `<rect x="${f(x + (tx + k) * s)}" y="${f(base - (th + 6) * s)}" width="${f(4 * s)}" height="${f(6 * s)}"/>`;
        if (win) lights.push(`<rect x="${f(x + (tx + tw / 2 - 1.5) * s)}" y="${f(base - (th * 0.7) * s)}" width="${f(3 * s)}" height="${f(7 * s)}" fill="${win}"/>`);
      };
      tower(-70, 34, 150, 44); tower(-26, 52, 110, 0); tower(36, 30, 190, 56); tower(70, 40, 120, 38); tower(-100, 26, 90, 0);
      o += `<rect x="${f(x - 100 * s)}" y="${f(base - 40 * s)}" width="${f(210 * s)}" height="${f(42 * s)}"/>`;
      return o + '</g>' + lights.join('');
    },
    temple(c, col, x, base, s, glow) {
      s = s || 1; let o = `<g fill="${col}">`;
      for (let i = 0; i < 3; i++) o += `<rect x="${f(x - (88 - i * 6) * s)}" y="${f(base - (10 + i * 8) * s)}" width="${f((176 - i * 12) * s)}" height="${f(9 * s)}"/>`;
      for (let i = 0; i < 6; i++) o += `<rect x="${f(x - 70 * s + i * 27 * s)}" y="${f(base - 116 * s)}" width="${f(9 * s)}" height="${f(92 * s)}"/>`;
      o += `<rect x="${f(x - 84 * s)}" y="${f(base - 126 * s)}" width="${f(168 * s)}" height="${f(10 * s)}"/><path d="M${f(x - 90 * s)} ${f(base - 126 * s)} L${f(x)} ${f(base - 176 * s)} L${f(x + 90 * s)} ${f(base - 126 * s)}Z"/></g>`;
      return (glow ? G.glow(c, x, base - 70 * s, 90 * s, glow, 0.35) : '') + o;
    },
    pagoda(c, col, x, base, s) {
      s = s || 1; let o = `<g fill="${col}">`;
      for (let i = 0; i < 4; i++) {
        const y = base - i * 34 * s, w = (62 - i * 10) * s;
        o += `<rect x="${f(x - w * 0.6)}" y="${f(y - 26 * s)}" width="${f(w * 1.2)}" height="${f(26 * s)}"/><path d="M${f(x - w - 8 * s)} ${f(y - 26 * s)} Q${f(x - w * 0.5)} ${f(y - 30 * s)} ${f(x)} ${f(y - 40 * s)} Q${f(x + w * 0.5)} ${f(y - 30 * s)} ${f(x + w + 8 * s)} ${f(y - 26 * s)}Z"/>`;
      }
      return o + `<rect x="${f(x - 1)}" y="${f(base - 190 * s)}" width="2" height="${f(30 * s)}"/></g>`;
    },
    torii(c, col, x, base, s) {
      s = s || 1;
      return `<g fill="${col}"><rect x="${f(x - 52 * s)}" y="${f(base - 120 * s)}" width="${f(9 * s)}" height="${f(120 * s)}"/><rect x="${f(x + 43 * s)}" y="${f(base - 120 * s)}" width="${f(9 * s)}" height="${f(120 * s)}"/><path d="M${f(x - 74 * s)} ${f(base - 120 * s)} Q${f(x)} ${f(base - 110 * s)} ${f(x + 74 * s)} ${f(base - 120 * s)} L${f(x + 82 * s)} ${f(base - 134 * s)} Q${f(x)} ${f(base - 124 * s)} ${f(x - 82 * s)} ${f(base - 134 * s)}Z"/><rect x="${f(x - 58 * s)}" y="${f(base - 98 * s)}" width="${f(116 * s)}" height="${f(7 * s)}"/></g>`;
    },
    crystals(c, c1, c2, base, n, seed, glow) {
      const r = rng(seed || 8); let s = glow ? G.glow(c, W / 2, base - 40, 220, glow, 0.28) : '';
      for (let i = 0; i < n; i++) {
        const x = (i + 0.2 + r() * 0.6) * (W / n), h = 50 + r() * 150, w = 12 + r() * 18, l = r() > 0.5;
        s += `<path d="M${f(x - w)} ${base} L${f(x - w * 0.5)} ${f(base - h * 0.8)} L${f(x)} ${f(base - h)} L${f(x + w * 0.6)} ${f(base - h * 0.75)} L${f(x + w)} ${base}Z" fill="${lg(c, [[0, c1], [1, c2]], x - w, base - h, x + w, base)}"/>`;
        s += `<path d="M${f(x)} ${f(base - h)} L${f(x + (l ? 1 : -1) * w * 0.15)} ${base} L${f(x + w)} ${base} L${f(x + w * 0.6)} ${f(base - h * 0.75)}Z" fill="#fff" opacity=".13"/>`;
      }
      return s;
    },
    cave(c, col, inner) {
      let s = `<path d="M0 0 H${W} V${H} H0Z M${W / 2} 150 C${W * 0.95} 170 ${W * 0.98} 560 ${W * 0.85} 640 L${W * 0.15} 640 C${W * 0.02} 560 ${W * 0.05} 170 ${W / 2} 150Z" fill="${col}" fill-rule="evenodd"/>`;
      for (let i = 0; i < 9; i++) { const x = 20 + i * 44 + c.r() * 14, h = 30 + c.r() * 80; s += `<path d="M${f(x - 9)} 0 L${f(x)} ${f(h)} L${f(x + 9)} 0Z" fill="${col}"/>`; }
      if (inner) s += `<ellipse cx="${W / 2}" cy="560" rx="150" ry="30" fill="${rg(c, [[0, inner, 0.55], [1, inner, 0]], W / 2, 560, 150)}"/>`;
      return s;
    },
    bookshelves(c, wood, seed, rows, glow) {
      const r = rng(seed || 9); rows = rows || 8; let s = `<rect width="${W}" height="${H}" fill="${wood}"/>`;
      const cols = ['#8c3b3b', '#2f5d8a', '#3d7a52', '#a8782f', '#5a3d7a', '#7a4a2a', '#2a6d74', '#a54f6a'];
      const rh = H * 0.74 / rows;
      for (let k = 0; k < rows; k++) {
        const y = 30 + k * rh; let x = 6;
        while (x < W - 6) { const w = 6 + r() * 9, h = rh * (0.55 + r() * 0.35); s += `<rect x="${f(x)}" y="${f(y + rh - 6 - h)}" width="${f(w)}" height="${f(h)}" fill="${cols[(r() * cols.length) | 0]}" opacity="${f(0.7 + r() * 0.3)}"/>`; x += w + 0.8; }
        s += `<rect x="0" y="${f(y + rh - 6)}" width="${W}" height="6" fill="${mix(wood, '#000', 0.45)}"/>`;
      }
      return s + (glow ? G.glow(c, W / 2, H * 0.55, 330, glow, 0.35) : '');
    },
    arches(c, col, n, y, win) {
      let s = `<g fill="${col}">`; const aw = W / n;
      for (let i = 0; i <= n; i++) s += `<rect x="${f(i * aw - 8)}" y="${y}" width="16" height="${H - y}"/>`;
      for (let i = 0; i < n; i++) s += `<path d="M${f(i * aw + 8)} ${y + 70} Q${f(i * aw + aw / 2)} ${y - 40} ${f((i + 1) * aw - 8)} ${y + 70} V${y} H${f(i * aw + 8)}Z"/>`;
      s += `<rect x="0" y="${y - 10}" width="${W}" height="14"/></g>`;
      return s + (win ? `<g fill="${win}" opacity=".5">${Array.from({ length: n }, (_, i) => `<path d="M${f(i * aw + aw / 2 - 9)} ${y + 140} V${y + 90} Q${f(i * aw + aw / 2)} ${y + 70} ${f(i * aw + aw / 2 + 9)} ${y + 90} V${y + 140}Z"/>`).join('')}</g>` : '');
    },
    pillars(c, col, n, seed) {
      const r = rng(seed || 10); let s = `<g fill="${col}">`;
      for (let i = 0; i < n; i++) { const left = i % 2 === 0, k = 1 - Math.floor(i / 2) / (n / 2), x = left ? 10 + (1 - k) * 90 : W - 10 - (1 - k) * 90 - 36 * k, w = 36 * k, y = 150 + (1 - k) * 160; s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(H - y)}" opacity="${f(0.6 + k * 0.4)}"/><rect x="${f(x - 4 * k)}" y="${f(y - 6)}" width="${f(w + 8 * k)}" height="${f(10 * k + 4)}" opacity="${f(0.6 + k * 0.4)}"/>`; }
      return s + '</g>';
    },
    grid(c, col, y) {
      let s = '<g stroke="' + col + '" stroke-width="1" fill="none" opacity=".65">';
      for (let i = -10; i <= 10; i++) s += `<path d="M${f(W / 2 + i * 14)} ${y} L${f(W / 2 + i * 120)} ${H}"/>`;
      for (let k = 1; k < 11; k++) { const yy = y + Math.pow(k / 10, 2.1) * (H - y); s += `<path d="M0 ${f(yy)} H${W}"/>`; }
      return s + '</g>' + `<rect x="0" y="${y}" width="${W}" height="${f((H - y) * 0.35)}" fill="${lg(c, [[0, col, 0.35], [1, col, 0]], 0, y, 0, y + (H - y) * 0.35)}"/>`;
    },
    matrix(c, col, seed, n) {
      const r = rng(seed || 11); let s = `<g fill="${col}">`;
      for (let i = 0; i < n; i++) {
        const x = i * (W / n) + r() * 6, len = 60 + r() * 260, y = r() * H * 0.8;
        s += `<g${anim(c, 'rn', i)}>`;
        for (let k = 0; k < 14; k++) s += `<rect x="${f(x)}" y="${f(y + k * len / 14)}" width="3" height="${f(3 + r() * 4)}" opacity="${f(1 - k / 14)}"/>`;
        s += '</g>';
      }
      return s + '</g>';
    },
    rain(c, col, n, seed, len) {
      const r = rng(seed || 12); len = len || 16; let s = `<g stroke="${col}" stroke-width="1" opacity=".5">`;
      for (let i = 0; i < n; i++) { const x = r() * (W + 60), y = r() * H; s += `<path d="M${f(x)} ${f(y)} l-4 ${len}"${anim(c, 'rn', i)}/>`; }
      return s + '</g>';
    },
    particles(c, kind, n, col, seed, ymin, ymax) {
      const r = rng(seed || 13); ymin = ymin == null ? 0 : ymin; ymax = ymax == null ? H : ymax;
      const cls = { snow: 'sn', embers: 'em', fireflies: 'fl', bubbles: 'bu', dust: 'fl', petals: 'sn', lanterns: 'em', sparks: 'fl' }[kind] || 'fl';
      let s = `<g fill="${col}">`;
      for (let i = 0; i < n; i++) {
        const x = r() * W, y = ymin + r() * (ymax - ymin), rr = (kind === 'embers' || kind === 'sparks') ? 0.8 + r() * 1.8 : kind === 'bubbles' ? 2 + r() * 6 : kind === 'lanterns' ? 4 + r() * 3 : kind === 'dust' ? 0.6 + r() * 1.2 : 1 + r() * 2.4;
        if (kind === 'bubbles') s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="none" stroke="${col}" stroke-width=".9" opacity="${f(0.3 + r() * 0.5)}"${anim(c, cls, i)}/>`;
        else if (kind === 'petals') s += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rr * 1.7)}" ry="${f(rr)}" transform="rotate(${(r() * 90) | 0} ${f(x)} ${f(y)})" opacity="${f(0.5 + r() * 0.45)}"${anim(c, cls, i)}/>`;
        else if (kind === 'lanterns') s += `<g${anim(c, cls, i)} opacity="${f(0.55 + r() * 0.4)}"><rect x="${f(x - rr)}" y="${f(y - rr * 1.3)}" width="${f(rr * 2)}" height="${f(rr * 2.6)}" rx="2"/>${G.glow(c, f(x), f(y), rr * 4, col, 0.4)}</g>`;
        else s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" opacity="${f(0.35 + r() * 0.65)}"${anim(c, cls, i)}/>`;
      }
      return s + '</g>';
    },
    lightning(c, x, col, seed) {
      const r = rng(seed || 14); let d = `M${x} 0`, px = x, py = 0;
      while (py < H * 0.55) { px += (r() - 0.5) * 60; py += 30 + r() * 40; d += ` L${f(px)} ${f(py)}`; }
      return `<g${anim(c, 'zap', 1)}><path d="${d}" fill="none" stroke="${col}" stroke-width="6" opacity=".25"/><path d="${d}" fill="none" stroke="#fff" stroke-width="1.8"/></g>`;
    },
    godrays(c, x, col, n) {
      let s = ''; n = n || 5;
      for (let i = 0; i < n; i++) { const o = (i - n / 2) * 46; s += `<path d="M${f(x + o * 0.2)} -10 L${f(x + o - 18)} ${H * 0.8} L${f(x + o + 22)} ${H * 0.8}Z" fill="${lg(c, [[0, col, 0.3], [1, col, 0]], 0, 0, 0, H * 0.8)}"${anim(c, 'dr', i)}/>`; }
      return s;
    },
    mist(c, col, y, op) {
      return `<ellipse cx="120" cy="${y}" rx="240" ry="34" fill="${rg(c, [[0, col, op == null ? 0.4 : op], [1, col, 0]], 120, y, 240)}"${anim(c, 'dr', 1)}/><ellipse cx="300" cy="${y + 40}" rx="240" ry="30" fill="${rg(c, [[0, col, (op == null ? 0.4 : op) * 0.8], [1, col, 0]], 300, y + 40, 240)}"${anim(c, 'dr', 3)}/>`;
    },
    lava(c, base, seed, c1, c2) {
      const r = rng(seed || 15); let s = '';
      for (let k = 0; k < 4; k++) {
        let d = `M${f(r() * W)} ${base - 10}`;
        for (let i = 0; i < 6; i++) d += ` Q${f(r() * W)} ${f(base + i * (H - base) / 6 + 12)} ${f(r() * W)} ${f(base + (i + 1) * (H - base) / 6)}`;
        s += `<path d="${d}" fill="none" stroke="${c1}" stroke-width="8" opacity=".25"/><path d="${d}" fill="none" stroke="${c2}" stroke-width="2.4" opacity=".95"/>`;
      }
      return s;
    },
    gears(c, col, seed, n) {
      const r = rng(seed || 16); let s = '';
      for (let i = 0; i < n; i++) {
        const x = r() * W, y = r() * H * 0.8, R = 26 + r() * 56, teeth = 10 + ((r() * 8) | 0);
        let d = ''; for (let t = 0; t < teeth; t++) { const a1 = (t / teeth) * Math.PI * 2, a2 = ((t + 0.5) / teeth) * Math.PI * 2; d += `${t ? 'L' : 'M'}${f(x + Math.cos(a1) * R)} ${f(y + Math.sin(a1) * R)} L${f(x + Math.cos(a1 + 0.05) * (R + 8))} ${f(y + Math.sin(a1 + 0.05) * (R + 8))} L${f(x + Math.cos(a2 - 0.05) * (R + 8))} ${f(y + Math.sin(a2 - 0.05) * (R + 8))} L${f(x + Math.cos(a2) * R)} ${f(y + Math.sin(a2) * R)} `; }
        s += `<g${anim(c, 'sp', i)} style="transform-origin:${f(x)}px ${f(y)}px"><path d="${d}Z" fill="${col}" opacity="${f(0.35 + r() * 0.4)}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(R * 0.4)}" fill="#000" opacity=".35"/></g>`;
      }
      return s;
    },
    jelly(c, col, n, seed) {
      const r = rng(seed || 17); let s = '';
      for (let i = 0; i < n; i++) {
        const x = r() * W, y = 80 + r() * H * 0.6, R = 16 + r() * 26;
        s += `<g${anim(c, 'fl', i)} opacity="${f(0.5 + r() * 0.45)}">${G.glow(c, f(x), f(y), R * 2.4, col, 0.35)}<path d="M${f(x - R)} ${f(y)} Q${f(x)} ${f(y - R * 1.6)} ${f(x + R)} ${f(y)} Q${f(x)} ${f(y + R * 0.3)} ${f(x - R)} ${f(y)}Z" fill="${col}" opacity=".7"/>`;
        for (let k = 0; k < 5; k++) s += `<path d="M${f(x - R * 0.8 + k * R * 0.4)} ${f(y + 2)} q${k % 2 ? 6 : -6} ${f(R * 0.8)} 0 ${f(R * 1.6)}" stroke="${col}" fill="none" stroke-width="1.2" opacity=".6"/>`;
        s += '</g>';
      }
      return s;
    },
    coral(c, c1, c2, base, seed) {
      const r = rng(seed || 18); let s = '';
      for (let i = 0; i < 9; i++) {
        const x = i * 46 + r() * 20, col = r() > 0.5 ? c1 : c2; let d = '';
        const branch = (bx, by, len, ang, depth) => { const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len; d += `M${f(bx)} ${f(by)} L${f(ex)} ${f(ey)} `; if (depth > 0) { branch(ex, ey, len * 0.7, ang - 0.5, depth - 1); branch(ex, ey, len * 0.7, ang + 0.5, depth - 1); } };
        branch(x, base, 34 + r() * 30, -Math.PI / 2 + (r() - 0.5) * 0.5, 3);
        s += `<path d="${d}" stroke="${col}" stroke-width="3.4" stroke-linecap="round" fill="none"/>`;
      }
      return s;
    },
    tree(c, col, x, base, s, canopy) {
      s = s || 1;
      let o = `<path d="M${f(x - 18 * s)} ${base} Q${f(x - 8 * s)} ${f(base - 90 * s)} ${f(x - 30 * s)} ${f(base - 170 * s)} Q${f(x)} ${f(base - 120 * s)} ${f(x + 6 * s)} ${f(base - 190 * s)} Q${f(x + 10 * s)} ${f(base - 90 * s)} ${f(x + 22 * s)} ${base}Z" fill="${col}"/>`;
      o += `<g fill="${canopy || col}">`;
      [[-60, -190, 60], [0, -230, 70], [58, -185, 58], [-20, -170, 50]].forEach(a => { o += `<circle cx="${f(x + a[0] * s)}" cy="${f(base + a[1] * s)}" r="${f(a[2] * s)}"/>`; });
      return o + '</g>';
    },
    station(c, col, x, y, s) {
      s = s || 1;
      return `<g fill="${col}" opacity=".9"${anim(c, 'fl', 2)}><rect x="${f(x - 8 * s)}" y="${f(y - 30 * s)}" width="${f(16 * s)}" height="${f(60 * s)}" rx="4"/><rect x="${f(x - 70 * s)}" y="${f(y - 4 * s)}" width="${f(140 * s)}" height="${f(8 * s)}"/><rect x="${f(x - 70 * s)}" y="${f(y - 18 * s)}" width="${f(40 * s)}" height="${f(36 * s)}" opacity=".6"/><rect x="${f(x + 30 * s)}" y="${f(y - 18 * s)}" width="${f(40 * s)}" height="${f(36 * s)}" opacity=".6"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(14 * s)}" opacity=".85"/></g>`;
    },
    horizon(c, y, col, op) {
      return `<rect x="0" y="${y - 90}" width="${W}" height="180" fill="${lg(c, [[0, col, 0], [0.5, col, op == null ? 0.6 : op], [1, col, 0]], 0, y - 90, 0, y + 90)}"/>`;
    },
    icebergs(c, col, base, seed) {
      const r = rng(seed || 19); let s = '';
      for (let i = 0; i < 4; i++) { const x = r() * W, w = 50 + r() * 70, h = 40 + r() * 70; s += `<path d="M${f(x - w)} ${base} L${f(x - w * 0.5)} ${f(base - h * 0.6)} L${f(x - w * 0.1)} ${f(base - h)} L${f(x + w * 0.4)} ${f(base - h * 0.5)} L${f(x + w)} ${base}Z" fill="${col}"/><path d="M${f(x - w * 0.1)} ${f(base - h)} L${f(x + w * 0.4)} ${f(base - h * 0.5)} L${f(x + w * 0.05)} ${base}Z" fill="#fff" opacity=".18"/>`; }
      return s;
    },
    dragon(c, col, x, y, s) {
      s = s || 1;
      return `<g fill="${col}"${anim(c, 'fl', 4)}><path d="M${f(x - 90 * s)} ${f(y + 10 * s)} Q${f(x - 40 * s)} ${f(y - 40 * s)} ${f(x)} ${f(y)} Q${f(x + 40 * s)} ${f(y + 30 * s)} ${f(x + 80 * s)} ${f(y - 10 * s)} L${f(x + 96 * s)} ${f(y - 22 * s)} L${f(x + 84 * s)} ${f(y - 2 * s)} Q${f(x + 40 * s)} ${f(y + 46 * s)} ${f(x)} ${f(y + 14 * s)} Q${f(x - 40 * s)} ${f(y - 20 * s)} ${f(x - 90 * s)} ${f(y + 10 * s)}Z"/><path d="M${f(x - 10 * s)} ${f(y)} L${f(x - 50 * s)} ${f(y - 70 * s)} L${f(x - 22 * s)} ${f(y - 50 * s)} L${f(x - 20 * s)} ${f(y - 80 * s)} L${f(x + 8 * s)} ${f(y - 30 * s)}Z"/><path d="M${f(x + 18 * s)} ${f(y + 8 * s)} L${f(x + 50 * s)} ${f(y - 56 * s)} L${f(x + 52 * s)} ${f(y - 30 * s)} L${f(x + 74 * s)} ${f(y - 48 * s)} L${f(x + 44 * s)} ${f(y + 14 * s)}Z"/></g>`;
    },
    windowglow(c, col, seed, n) { // warm lit windows on the near ground (cottages/lanterns)
      const r = rng(seed || 20); let s = '';
      for (let i = 0; i < n; i++) { const x = 30 + r() * (W - 60), y = H * 0.7 + r() * 90; s += G.glow(c, f(x), f(y), 18, col, 0.7) + `<rect x="${f(x - 3)}" y="${f(y - 4)}" width="6" height="8" fill="${col}"/>`; }
      return s;
    },
    sakura(c, col, seed) {
      const r = rng(seed || 21); let s = '<g stroke="#2a1420" stroke-width="3" fill="none"><path d="M-10 120 Q120 150 200 90 T420 70"/><path d="M60 140 Q90 190 70 240"/><path d="M200 90 Q240 150 300 160"/></g><g fill="' + col + '">';
      for (let i = 0; i < 70; i++) { const t = r(), x = -10 + t * 430, y = 70 + Math.sin(t * 5) * 40 + r() * 70; s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(3 + r() * 5)}" opacity="${f(0.45 + r() * 0.5)}"/>`; }
      return s + '</g>';
    },
    skylanterns(c, col, seed, n) { return G.particles(c, 'lanterns', n, col, seed || 22, 40, H * 0.8); },
    sandstorm(c, col) { return `<rect width="${W}" height="${H}" fill="${lg(c, [[0, col, 0], [0.6, col, 0.28], [1, col, 0.5]], 0, 0, 0, H)}"${anim(c, 'dr', 2)}/>`; },
    scan(c, col) { let s = ''; for (let y = 0; y < H; y += 6) s += `<rect x="0" y="${y}" width="${W}" height="1" fill="${col}" opacity=".05"/>`; return s; },
    rings(c, col, x, y, n, step) { let s = ''; for (let i = 1; i <= n; i++) s += `<circle cx="${x}" cy="${y}" r="${i * step}" fill="none" stroke="${col}" stroke-width="1" opacity="${f(0.5 / i + 0.05)}"/>`; return s; },
    hex(c, col, seed) { const r = rng(seed || 23); let s = `<g fill="none" stroke="${col}" stroke-width="1" opacity=".35">`; for (let i = 0; i < 26; i++) { const x = r() * W, y = r() * H, R = 14 + r() * 30; let d = ''; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; d += (k ? 'L' : 'M') + f(x + Math.cos(a) * R) + ' ' + f(y + Math.sin(a) * R); } s += `<path d="${d}Z"/>`; } return s + '</g>'; },
    meteors(c, col, n, seed) { const r = rng(seed || 24); let s = `<g stroke="${col}" stroke-linecap="round">`; for (let i = 0; i < n; i++) { const x = r() * W, y = r() * H * 0.5; s += `<path d="M${f(x)} ${f(y)} l-44 26" stroke-width="${f(1 + r() * 1.4)}" opacity=".7"${anim(c, 'mt', i)}/>`; } return s + '</g>'; },
    waterfall(c, col, x, top, bot) { return `<rect x="${x - 14}" y="${top}" width="28" height="${bot - top}" fill="${lg(c, [[0, col, 0.1], [0.5, col, 0.7], [1, col, 0.25]], 0, top, 0, bot)}"${anim(c, 'wf', 1)}/>` + G.glow(c, x, bot, 40, '#fff', 0.35); },
    tent(c, col, x, y, s) { s = s || 1; return `<path d="M${f(x - 24 * s)} ${y} L${x} ${f(y - 34 * s)} L${f(x + 24 * s)} ${y}Z" fill="${col}"/>` + G.glow(c, x, f(y - 8 * s), 34 * s, '#ffb45a', 0.55); },
    rocket(c, col, x, y, s) { s = s || 1; return `<g fill="${col}"><path d="M${x} ${f(y - 40 * s)} Q${f(x + 12 * s)} ${f(y - 10 * s)} ${f(x + 10 * s)} ${f(y + 16 * s)} H${f(x - 10 * s)} Q${f(x - 12 * s)} ${f(y - 10 * s)} ${x} ${f(y - 40 * s)}Z"/><path d="M${f(x - 10 * s)} ${f(y + 6 * s)} L${f(x - 22 * s)} ${f(y + 22 * s)} L${f(x - 10 * s)} ${f(y + 16 * s)}Z M${f(x + 10 * s)} ${f(y + 6 * s)} L${f(x + 22 * s)} ${f(y + 22 * s)} L${f(x + 10 * s)} ${f(y + 16 * s)}Z"/></g>` + G.glow(c, x, f(y + 26 * s), 22 * s, '#ffa24a', 0.8); },
    ground(c, col, y) { return `<rect x="-10" y="${y}" width="${W + 20}" height="${H - y + 10}" fill="${col}"/>`; },
    fog(c, col, op) { return `<rect width="${W}" height="${H}" fill="${lg(c, [[0, col, 0], [0.55, col, 0], [1, col, op == null ? 0.5 : op]], 0, 0, 0, H)}"/>`; }
  };


  // ───────────── extra generators ─────────────
  G.warp = function (c, col, n, seed) {
    const r = rng(seed || 31); let s = `<g stroke="${col}" stroke-linecap="round">`;
    for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d1 = 20 + r() * 80, d2 = d1 + 30 + r() * 180; s += `<path d="M${f(W / 2 + Math.cos(a) * d1)} ${f(H / 2 + Math.sin(a) * d1 * 1.6)} L${f(W / 2 + Math.cos(a) * d2)} ${f(H / 2 + Math.sin(a) * d2 * 1.6)}" stroke-width="${f(0.6 + r() * 1.6)}" opacity="${f(0.25 + r() * 0.7)}"/>`; }
    return s + '</g>' + G.glow(c, W / 2, H / 2, 120, col, 0.35);
  };
  G.beams = function (c, x, y, col, n) {
    let s = ''; n = n || 2;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI + 0.5; s += `<path d="M${x} ${y} L${f(x + Math.cos(a) * 700)} ${f(y + Math.sin(a) * 700)} L${f(x + Math.cos(a + 0.04) * 700)} ${f(y + Math.sin(a + 0.04) * 700)}Z M${x} ${y} L${f(x - Math.cos(a) * 700)} ${f(y - Math.sin(a) * 700)} L${f(x - Math.cos(a + 0.04) * 700)} ${f(y - Math.sin(a + 0.04) * 700)}Z" fill="${col}" opacity=".22"${anim(c, 'dr', i)}/>`; }
    return s + G.glow(c, x, y, 70, col, 0.8) + `<circle cx="${x}" cy="${y}" r="5" fill="#fff"/>`;
  };
  G.comet = function (c, x, y, col, len) {
    len = len || 260;
    return `<path d="M${x} ${y} L${f(x - len)} ${f(y - len * 0.5)} L${f(x - len)} ${f(y - len * 0.5 + 18)}Z" fill="${lg(c, [[0, col, 0.9], [1, col, 0]], x, y, x - len, y - len * 0.5)}"/>` + G.glow(c, x, y, 26, col, 0.9) + `<circle cx="${x}" cy="${y}" r="5" fill="#fff"/>`;
  };
  G.rocks = function (c, col, n, seed, hi) {
    const r = rng(seed || 32); let s = '';
    for (let i = 0; i < n; i++) { const x = r() * W, y = r() * H * 0.85, R = 4 + r() * 22; let d = ''; for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2, rr = R * (0.7 + r() * 0.5); d += (k ? 'L' : 'M') + f(x + Math.cos(a) * rr) + ' ' + f(y + Math.sin(a) * rr); } s += `<g${anim(c, 'fl', i)}><path d="${d}Z" fill="${col}"/><path d="${d}Z" fill="${rg(c, [[0, hi || '#fff', 0.35], [1, '#000', 0.4]], x - R * 0.4, y - R * 0.4, R * 1.4)}"/></g>`; }
    return s;
  };
  G.whale = function (c, col, x, y, s) {
    s = s || 1;
    return `<g fill="${col}"${anim(c, 'fl', 3)}><path d="M${f(x - 90 * s)} ${f(y)} Q${f(x - 30 * s)} ${f(y - 46 * s)} ${f(x + 40 * s)} ${f(y - 14 * s)} Q${f(x + 80 * s)} ${f(y - 4 * s)} ${f(x + 112 * s)} ${f(y - 38 * s)} Q${f(x + 106 * s)} ${f(y - 4 * s)} ${f(x + 128 * s)} ${f(y + 10 * s)} Q${f(x + 90 * s)} ${f(y + 8 * s)} ${f(x + 64 * s)} ${f(y + 14 * s)} Q${f(x - 20 * s)} ${f(y + 50 * s)} ${f(x - 90 * s)} ${f(y)}Z"/><circle cx="${f(x - 62 * s)}" cy="${f(y - 4 * s)}" r="${f(2.4 * s)}" fill="#fff" opacity=".7"/></g>`;
  };
  G.moonpath = function (c, x, col, y0) {
    let s = ''; y0 = y0 || 520;
    for (let i = 0; i < 16; i++) { const y = y0 + i * 14, w = 8 + i * 5 + c.r() * 10; s += `<rect x="${f(x - w / 2)}" y="${y}" width="${f(w)}" height="2.4" rx="1.2" fill="${col}" opacity="${f(0.7 - i * 0.04)}"/>`; }
    return s;
  };
  G.cabin = function (c, col, x, base, s, win) {
    s = s || 1;
    return `<g><rect x="${f(x - 30 * s)}" y="${f(base - 36 * s)}" width="${f(60 * s)}" height="${f(36 * s)}" fill="${col}"/><path d="M${f(x - 38 * s)} ${f(base - 36 * s)} L${x} ${f(base - 64 * s)} L${f(x + 38 * s)} ${f(base - 36 * s)}Z" fill="${col}"/><rect x="${f(x - 8 * s)}" y="${f(base - 26 * s)}" width="${f(16 * s)}" height="${f(14 * s)}" fill="${win}"/></g>` + G.glow(c, x, f(base - 20 * s), 46 * s, win, 0.55);
  };
  G.ship = function (c, col, x, y, s) {
    s = s || 1;
    return `<g fill="${col}"><path d="M${f(x - 50 * s)} ${y} H${f(x + 50 * s)} L${f(x + 36 * s)} ${f(y + 18 * s)} H${f(x - 36 * s)}Z"/><rect x="${f(x - 1.5)}" y="${f(y - 70 * s)}" width="3" height="${f(70 * s)}"/><path d="M${f(x + 3)} ${f(y - 66 * s)} Q${f(x + 38 * s)} ${f(y - 40 * s)} ${f(x + 3)} ${f(y - 8 * s)}Z"/><path d="M${f(x - 3)} ${f(y - 56 * s)} Q${f(x - 30 * s)} ${f(y - 34 * s)} ${f(x - 3)} ${f(y - 10 * s)}Z"/></g>`;
  };
  G.flowers = function (c, cols, base, n, seed) {
    const r = rng(seed || 33); let s = '';
    for (let i = 0; i < n; i++) { const x = r() * W, y = base + r() * (H - base - 10), col = cols[(r() * cols.length) | 0]; s += `<path d="M${f(x)} ${f(y)} v${f(10 + r() * 14)}" stroke="#2c6b3a" stroke-width="1.4" opacity=".8"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(2 + r() * 2.4)}" fill="${col}"${i % 5 === 0 ? anim(c, 'sn', i) : ''}/>`; }
    return s;
  };
  G.stripes = function (c, cols, y, h) {
    let s = ''; cols.forEach((col, i) => { s += `<rect x="0" y="${f(y + i * h / cols.length)}" width="${W}" height="${f(h / cols.length + 1)}" fill="${col}" opacity=".55"/>`; }); return s;
  };
  G.bridge = function (c, col, y) {
    return `<g fill="none" stroke="${col}" stroke-width="3"><path d="M-10 ${y} H${W + 10}"/><path d="M40 ${y} V${y - 90} M360 ${y} V${y - 90}"/><path d="M40 ${y - 90} Q200 ${y - 10} 360 ${y - 90}"/>${Array.from({ length: 12 }, (_, i) => `<path d="M${f(60 + i * 24.5)} ${y} V${f(y - 16 - Math.abs(6 - i) * 2)}" stroke-width="1.2"/>`).join('')}</g>`;
  };
  G.shell = function (c, col, x, y, r) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${col}" stroke-width="2" opacity=".5"/><circle cx="${x}" cy="${y}" r="${f(r * 0.6)}" fill="none" stroke="${col}" stroke-width="1" opacity=".35"/>`; };

  // ───────────── scene renderer ─────────────
  function scene(spec, opts) {
    opts = opts || {};
    const key = opts.key || 'k';
    const seed = (spec.seed || 1) * 7919;
    const c = ctx(key, seed, !!opts.live);
    const sky = spec.sky || ['#0b1020', '#10182e', '#18223f'];
    let body = `<rect width="${W}" height="${H}" fill="${lg(c, sky.map((s, i) => [i / (sky.length - 1), s]), 0, 0, 0, H)}"/>`;
    (spec.t || []).forEach((l) => {
      const fn = G[l[0]];
      if (fn) { try { body += fn.apply(null, [c].concat(l.slice(1))); } catch (e) { /* a bad layer must never break the page */ } }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${c.defs.join('')}</defs>${body}</svg>`;
  }

  // ───────────── Bagley character renderer ─────────────
  // Every variant keeps Bagley's signature: a rounded-square head with a
  // dark face plate, two eyes, a dry little smirk, an antenna, and a small
  // body. Variants change hull colours, eyes, headgear, neckwear, back
  // pieces, antenna, aura, particles and idle animation.
  const HAT = {
    none: () => '',
    wizard: (p) => `<path d="M30 28 Q60 -26 92 28Z" fill="${p.h2}"/><ellipse cx="60" cy="28" rx="40" ry="7" fill="${p.h1}"/><circle cx="60" cy="-2" r="3" fill="${p.glow}"/><path d="M52 18 q8 -6 16 0" stroke="${p.glow}" stroke-width="2" fill="none"/>`,
    crown: (p) => `<path d="M32 28 L36 6 L48 18 L60 2 L72 18 L84 6 L88 28Z" fill="#f6c453" stroke="#b8861f" stroke-width="1.5"/><circle cx="60" cy="10" r="3" fill="${p.glow}"/><circle cx="40" cy="14" r="2" fill="#e04a5a"/><circle cx="80" cy="14" r="2" fill="#4a9be0"/>`,
    helmet: (p) => `<path d="M22 46 Q22 4 60 4 Q98 4 98 46Z" fill="${p.h1}" stroke="${p.h2}" stroke-width="2"/><rect x="26" y="38" width="68" height="8" rx="4" fill="${p.h2}"/><path d="M60 4 V30" stroke="${p.glow}" stroke-width="3"/>`,
    goggles: (p) => `<rect x="22" y="22" width="76" height="9" rx="4" fill="#3a2b22"/><circle cx="42" cy="22" r="11" fill="#2a2018" stroke="#c89a4a" stroke-width="3"/><circle cx="78" cy="22" r="11" fill="#2a2018" stroke="#c89a4a" stroke-width="3"/><circle cx="42" cy="22" r="6" fill="${p.glow}" opacity=".8"/><circle cx="78" cy="22" r="6" fill="${p.glow}" opacity=".8"/>`,
    phones: (p) => `<path d="M24 52 Q24 8 60 8 Q96 8 96 52" fill="none" stroke="${p.h2}" stroke-width="6" stroke-linecap="round"/><rect x="14" y="44" width="14" height="24" rx="6" fill="${p.h1}" stroke="${p.glow}" stroke-width="2"/><rect x="92" y="44" width="14" height="24" rx="6" fill="${p.h1}" stroke="${p.glow}" stroke-width="2"/>`,
    halo: (p) => `<ellipse cx="60" cy="10" rx="26" ry="6" fill="none" stroke="${p.glow}" stroke-width="4"/><ellipse cx="60" cy="10" rx="26" ry="6" fill="none" stroke="#fff" stroke-width="1.2" opacity=".8"/>`,
    horns: (p) => `<path d="M30 30 Q16 14 24 -2 Q34 10 42 24Z" fill="${p.h2}"/><path d="M90 30 Q104 14 96 -2 Q86 10 78 24Z" fill="${p.h2}"/>`,
    leaf: (p) => `<path d="M60 26 Q40 22 34 6 Q54 6 60 26Z" fill="#4fae5b"/><path d="M60 26 Q80 22 86 6 Q66 6 60 26Z" fill="#3c9a4a"/><path d="M60 26 Q52 8 60 -4 Q68 8 60 26Z" fill="#6bd07a"/><circle cx="60" cy="24" r="3" fill="${p.glow}"/>`,
    cap: (p) => `<path d="M24 36 Q24 8 60 8 Q96 8 96 36Z" fill="${p.h2}"/><path d="M24 36 Q4 38 -2 46 Q30 44 52 38Z" fill="${p.h1}"/><circle cx="60" cy="6" r="3" fill="${p.glow}"/>`,
    beanie: (p) => `<path d="M24 34 Q24 6 60 6 Q96 6 96 34Z" fill="${p.h2}"/><rect x="22" y="28" width="76" height="10" rx="5" fill="${p.h1}"/><circle cx="60" cy="3" r="6" fill="${p.glow}"/>`,
    tophat: (p) => `<rect x="38" y="-6" width="44" height="30" rx="3" fill="#15151f"/><rect x="28" y="22" width="64" height="7" rx="3" fill="#15151f"/><rect x="38" y="14" width="44" height="6" fill="${p.glow}"/>`,
    flame: (p) => `<path d="M40 30 Q34 8 48 -4 Q46 12 56 16 Q54 -2 66 -10 Q64 8 76 14 Q86 12 82 30Z" fill="${p.glow}"/><path d="M50 30 Q48 14 58 8 Q60 18 70 30Z" fill="#fff3c4"/>`,
    ice: (p) => `<path d="M34 30 L40 4 L48 24 L58 -6 L68 24 L78 6 L86 30Z" fill="${p.glow}" opacity=".9"/><path d="M58 -6 L60 26 L68 24Z" fill="#fff" opacity=".5"/>`,
    visor: (p) => `<path d="M24 38 Q24 12 60 12 Q96 12 96 38Z" fill="${p.h2}"/><rect x="28" y="28" width="64" height="12" rx="6" fill="${p.glow}" opacity=".35"/>`,
    hood: (p) => `<path d="M16 60 Q10 6 60 4 Q110 6 104 60 Q96 30 60 28 Q24 30 16 60Z" fill="${p.h2}"/>`,
    headset: (p) => `<path d="M24 50 Q26 12 60 12 Q94 12 96 50" fill="none" stroke="${p.h2}" stroke-width="5"/><rect x="12" y="42" width="12" height="22" rx="5" fill="${p.h1}"/><path d="M18 64 Q22 84 44 82" fill="none" stroke="${p.h2}" stroke-width="3"/><circle cx="46" cy="82" r="4" fill="${p.glow}"/>`,
    bandana: (p) => `<path d="M18 38 Q60 22 102 38 L102 48 Q60 34 18 48Z" fill="${p.h2}"/><path d="M100 40 L116 34 L112 48 L118 56 L100 48Z" fill="${p.h2}"/><circle cx="40" cy="38" r="2" fill="#fff" opacity=".7"/><circle cx="62" cy="34" r="2" fill="#fff" opacity=".7"/>`,
    mortar: (p) => `<path d="M60 4 L102 20 L60 34 L18 20Z" fill="#17181f"/><rect x="42" y="24" width="36" height="10" fill="#17181f"/><path d="M60 20 L100 24 V40" stroke="${p.glow}" stroke-width="2" fill="none"/><circle cx="100" cy="42" r="3" fill="${p.glow}"/>`,
    miner: (p) => `<path d="M22 44 Q22 8 60 8 Q98 8 98 44Z" fill="#e0a43a"/><rect x="50" y="10" width="20" height="14" rx="4" fill="#fff6c9"/><path d="M60 14 L36 -20 L84 -20Z" fill="#fff6c9" opacity=".18"/>`,
    pirate: (p) => `<path d="M16 34 Q60 -14 104 34 Q60 22 16 34Z" fill="#1b1b24"/><circle cx="60" cy="10" r="5" fill="#eee"/><path d="M56 6 l8 8 M64 6 l-8 8" stroke="#1b1b24" stroke-width="1.6"/>`,
    antlers: (p) => `<path d="M38 28 L30 4 M34 16 L22 10 M33 10 L24 -2 M82 28 L90 4 M86 16 L98 10 M87 10 L96 -2" stroke="${p.h2}" stroke-width="4" stroke-linecap="round" fill="none"/>`,
    cat: (p) => `<path d="M26 34 L30 6 L50 24Z" fill="${p.h1}"/><path d="M94 34 L90 6 L70 24Z" fill="${p.h1}"/><path d="M32 28 L33 14 L44 24Z" fill="${p.glow}" opacity=".7"/><path d="M88 28 L87 14 L76 24Z" fill="${p.glow}" opacity=".7"/>`,
    star: (p) => `<path d="M60 -12 L65 4 L82 4 L68 14 L73 30 L60 20 L47 30 L52 14 L38 4 L55 4Z" fill="${p.glow}" stroke="#fff" stroke-width="1"/>`,
    laurel: (p) => `<path d="M26 44 Q16 24 30 12 M30 40 Q22 28 34 20 M94 44 Q104 24 90 12 M90 40 Q98 28 86 20" stroke="#cdb04a" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="30" cy="14" r="3" fill="#e2c564"/><circle cx="90" cy="14" r="3" fill="#e2c564"/>`,
    solar: (p) => `<g stroke="${p.glow}" stroke-width="3" stroke-linecap="round">${Array.from({ length: 9 }, (_, i) => { const a = -Math.PI + (i / 8) * Math.PI; return `<path d="M${f(60 + Math.cos(a) * 34)} ${f(30 + Math.sin(a) * 26)} L${f(60 + Math.cos(a) * 50)} ${f(30 + Math.sin(a) * 38)}"/>`; }).join('')}</g>`,
    moon: (p) => `<path d="M72 4 A18 18 0 1 0 72 38 A14 14 0 1 1 72 4Z" fill="${p.glow}"/>`,
    snowcap: (p) => `<path d="M26 34 Q30 12 60 12 Q90 12 94 34 Q84 26 74 32 Q64 24 54 32 Q42 26 26 34Z" fill="#f4f8ff"/><circle cx="60" cy="9" r="5" fill="#f4f8ff"/>`,
    sprout: (p) => `<path d="M60 28 V14" stroke="#58b55f" stroke-width="3"/><path d="M60 16 Q46 14 44 2 Q58 2 60 16Z" fill="#6fd27a"/><path d="M60 16 Q74 14 76 2 Q62 2 60 16Z" fill="#4fae5b"/>`,
    antennae: (p) => `<path d="M44 26 Q38 6 28 4 M76 26 Q82 6 92 4" stroke="${p.h2}" stroke-width="3" fill="none"/><circle cx="28" cy="4" r="4" fill="${p.glow}"/><circle cx="92" cy="4" r="4" fill="${p.glow}"/>`,
    radar: (p) => `<path d="M60 26 V14" stroke="${p.h2}" stroke-width="3"/><path d="M42 10 Q60 28 78 10 Q60 -2 42 10Z" fill="${p.h1}" stroke="${p.h2}" stroke-width="2"/><circle cx="60" cy="10" r="3" fill="${p.glow}"/>`,
    spiral: (p) => `<path d="M60 26 C56 14 70 10 68 20 C66 28 54 24 58 14" fill="none" stroke="${p.glow}" stroke-width="3" stroke-linecap="round"/>`
  };
  const EYES = {
    dry: (p) => `<g class="b-eyes"><circle cx="44" cy="58" r="8.5" fill="${p.eye}"/><circle cx="76" cy="58" r="8.5" fill="${p.eye}"/><rect x="33" y="48" width="22" height="9" fill="${p.face}"/><rect x="65" y="48" width="22" height="9" fill="${p.face}"/><circle cx="46" cy="60" r="2.2" fill="#fff" opacity=".85"/><circle cx="78" cy="60" r="2.2" fill="#fff" opacity=".85"/></g>`,
    wide: (p) => `<g class="b-eyes"><circle cx="44" cy="57" r="10" fill="${p.eye}"/><circle cx="76" cy="57" r="10" fill="${p.eye}"/><circle cx="47" cy="54" r="3.6" fill="#fff"/><circle cx="79" cy="54" r="3.6" fill="#fff"/></g>`,
    bar: (p) => `<g class="b-eyes"><rect x="32" y="52" width="24" height="9" rx="4.5" fill="${p.eye}"/><rect x="64" y="52" width="24" height="9" rx="4.5" fill="${p.eye}"/></g>`,
    star: (p) => `<g class="b-eyes" fill="${p.eye}"><path d="M44 47 L47 55 L55 57 L47 59 L44 67 L41 59 L33 57 L41 55Z"/><path d="M76 47 L79 55 L87 57 L79 59 L76 67 L73 59 L65 57 L73 55Z"/></g>`,
    slit: (p) => `<g class="b-eyes"><ellipse cx="44" cy="57" rx="6" ry="11" fill="${p.eye}"/><ellipse cx="76" cy="57" rx="6" ry="11" fill="${p.eye}"/><ellipse cx="44" cy="57" rx="2" ry="9" fill="${p.face}"/><ellipse cx="76" cy="57" rx="2" ry="9" fill="${p.face}"/></g>`,
    dot: (p) => `<g class="b-eyes"><circle cx="44" cy="58" r="5.5" fill="${p.eye}"/><circle cx="76" cy="58" r="5.5" fill="${p.eye}"/></g>`,
    glitch: (p) => `<g class="b-eyes" fill="${p.eye}"><rect x="35" y="50" width="20" height="5" /><rect x="38" y="57" width="20" height="5"/><rect x="35" y="64" width="14" height="4"/><rect x="65" y="50" width="20" height="5"/><rect x="62" y="57" width="20" height="5"/><rect x="71" y="64" width="14" height="4"/></g>`,
    happy: (p) => `<g class="b-eyes" fill="none" stroke="${p.eye}" stroke-width="5" stroke-linecap="round"><path d="M35 62 Q44 49 53 62"/><path d="M67 62 Q76 49 85 62"/></g>`,
    sleepy: (p) => `<g class="b-eyes" fill="none" stroke="${p.eye}" stroke-width="5" stroke-linecap="round"><path d="M35 56 Q44 66 53 56"/><path d="M67 56 Q76 66 85 56"/></g>`,
    angry: (p) => `<g class="b-eyes"><circle cx="44" cy="59" r="8" fill="${p.eye}"/><circle cx="76" cy="59" r="8" fill="${p.eye}"/><path d="M32 46 L56 54 V44 H32Z M88 46 L64 54 V44 H88Z" fill="${p.face}"/></g>`,
    ring: (p) => `<g class="b-eyes" fill="none" stroke="${p.eye}" stroke-width="4"><circle cx="44" cy="58" r="8"/><circle cx="76" cy="58" r="8"/><circle cx="44" cy="58" r="2.4" fill="${p.eye}"/><circle cx="76" cy="58" r="2.4" fill="${p.eye}"/></g>`,
    heart: (p) => `<g class="b-eyes" fill="${p.eye}"><path d="M44 66 C30 56 34 46 44 51 C54 46 58 56 44 66Z"/><path d="M76 66 C62 56 66 46 76 51 C86 46 90 56 76 66Z"/></g>`
  };
  const WEAR = {
    none: () => '',
    shades: (p) => `<path d="M28 50 H92 V58 Q92 70 80 70 H66 Q60 70 58 64 H62 Q60 70 54 70 H40 Q28 70 28 58Z" fill="#0a0c14" opacity=".92"/><path d="M34 54 L48 54" stroke="#fff" stroke-width="2" opacity=".5"/>`,
    monocle: (p) => `<circle cx="76" cy="58" r="14" fill="#fff" fill-opacity=".1" stroke="#d5b45a" stroke-width="3"/><path d="M88 66 Q96 84 90 98" stroke="#d5b45a" stroke-width="1.6" fill="none"/>`,
    specs: (p) => `<circle cx="44" cy="58" r="13" fill="#fff" fill-opacity=".08" stroke="${p.h2}" stroke-width="3"/><circle cx="76" cy="58" r="13" fill="#fff" fill-opacity=".08" stroke="${p.h2}" stroke-width="3"/><path d="M57 58 H63" stroke="${p.h2}" stroke-width="3"/>`,
    mask: (p) => `<path d="M26 50 Q60 42 94 50 L90 66 Q76 58 60 66 Q44 58 30 66Z" fill="#12121c" opacity=".92"/>`,
    scar: (p) => `<path d="M80 44 L90 72" stroke="#ffffff" stroke-width="2" opacity=".5"/><path d="M84 54 l-5 3 M86 60 l-5 3" stroke="#fff" stroke-width="1.4" opacity=".45"/>`,
    blush: (p) => `<ellipse cx="30" cy="68" rx="5" ry="3" fill="#ff7a9a" opacity=".5"/><ellipse cx="90" cy="68" rx="5" ry="3" fill="#ff7a9a" opacity=".5"/>`,
    tear: (p) => `<path d="M44 70 q-3 6 0 9 q3 -3 0 -9" fill="#8fd0ff" opacity=".85"/>`,
    cyber: (p) => `<rect x="30" y="52" width="60" height="2" fill="${p.glow}" opacity=".5"/><path d="M30 76 H48 M72 76 H90" stroke="${p.glow}" stroke-width="2"/><circle cx="92" cy="48" r="2.4" fill="${p.glow}"/>`
  };
  const NECK = {
    none: () => '',
    scarf: (p) => `<path d="M36 92 Q60 104 84 92 L84 100 Q60 112 36 100Z" fill="${p.glow}" opacity=".95"/><path d="M78 98 L86 118 L74 114Z" fill="${p.glow}"/>`,
    bowtie: (p) => `<path d="M60 98 L44 90 V108Z M60 98 L76 90 V108Z" fill="${p.glow}"/><circle cx="60" cy="98" r="4" fill="${p.h2}"/>`,
    cape: (p) => `<path d="M34 92 Q60 102 86 92 L100 124 Q60 112 20 124Z" fill="${p.glow}" opacity=".9"/><circle cx="60" cy="96" r="4" fill="#f6c453"/>`,
    medal: (p) => `<path d="M48 92 L60 108 L72 92" stroke="${p.glow}" stroke-width="3" fill="none"/><circle cx="60" cy="110" r="6" fill="#f6c453" stroke="#b8861f" stroke-width="1.5"/>`,
    collar: (p) => `<path d="M32 92 Q60 108 88 92 L88 98 Q60 114 32 98Z" fill="${p.h2}"/><circle cx="60" cy="106" r="3" fill="${p.glow}"/>`,
    tie: (p) => `<path d="M56 94 H64 L68 100 L62 120 L58 120 L52 100Z" fill="${p.glow}"/>`,
    amulet: (p) => `<path d="M44 92 Q60 114 76 92" stroke="#c9b27a" stroke-width="2" fill="none"/><path d="M60 106 L66 114 L60 122 L54 114Z" fill="${p.glow}" stroke="#fff" stroke-width="1"/>`,
    ruff: (p) => `<path d="M30 94 Q36 88 42 96 Q48 88 54 98 Q60 90 66 98 Q72 88 78 96 Q84 88 90 94 L88 104 Q60 114 32 104Z" fill="#f0eadb"/>`,
    lei: (p) => `<path d="M34 94 Q60 112 86 94" stroke="#f08a4a" stroke-width="5" fill="none" stroke-dasharray="3 3" stroke-linecap="round"/><path d="M38 98 Q60 114 82 98" stroke="#e0527a" stroke-width="4" fill="none" stroke-dasharray="3 4" stroke-linecap="round"/>`
  };
  const BACK = {
    none: () => '',
    wings: (p) => `<path d="M30 76 Q-6 50 2 94 Q18 84 30 90Z" fill="${p.glow}" opacity=".85"/><path d="M90 76 Q126 50 118 94 Q102 84 90 90Z" fill="${p.glow}" opacity=".85"/><path d="M28 84 Q8 74 8 100 Q20 92 28 94Z" fill="#fff" opacity=".35"/><path d="M92 84 Q112 74 112 100 Q100 92 92 94Z" fill="#fff" opacity=".35"/>`,
    jet: (p) => `<rect x="22" y="72" width="14" height="30" rx="5" fill="${p.h2}"/><rect x="84" y="72" width="14" height="30" rx="5" fill="${p.h2}"/><path d="M24 104 Q29 124 34 104Z" fill="${p.glow}"${p.live ? ' class="b-flame"' : ''}/><path d="M86 104 Q91 124 96 104Z" fill="${p.glow}"${p.live ? ' class="b-flame"' : ''}/>`,
    ring: (p) => `<ellipse cx="60" cy="70" rx="58" ry="14" fill="none" stroke="${p.glow}" stroke-width="3" opacity=".8" transform="rotate(-14 60 70)"/>`,
    tail: (p) => `<path d="M82 110 Q116 112 112 86 Q108 100 86 100Z" fill="${p.h2}"/><circle cx="112" cy="86" r="4" fill="${p.glow}"/>`,
    fins: (p) => `<path d="M20 52 L2 40 L6 70 L18 74Z" fill="${p.glow}" opacity=".8"/><path d="M100 52 L118 40 L114 70 L102 74Z" fill="${p.glow}" opacity=".8"/>`,
    roots: (p) => `<path d="M40 112 q-12 6 -14 14 M60 114 v14 M80 112 q12 6 14 14" stroke="${p.h2}" stroke-width="4" stroke-linecap="round" fill="none"/>`,
    orbit: (p) => `<ellipse cx="60" cy="66" rx="56" ry="18" fill="none" stroke="${p.glow}" stroke-width="1.2" opacity=".6" transform="rotate(20 60 66)"/><circle cx="108" cy="82" r="5" fill="${p.glow}"/><circle cx="14" cy="50" r="3.4" fill="#fff" opacity=".9"/>`,
    drone: (p) => `<path d="M10 40 H34 M86 40 H110" stroke="${p.h2}" stroke-width="3"/><ellipse cx="14" cy="38" rx="12" ry="2.6" fill="${p.glow}" opacity=".7"${p.live ? ' class="b-rotor"' : ''}/><ellipse cx="106" cy="38" rx="12" ry="2.6" fill="${p.glow}" opacity=".7"${p.live ? ' class="b-rotor"' : ''}/>`
  };
  const ANT = {
    none: () => '',
    orb: (p) => `<path d="M60 20 V8" stroke="${p.h2}" stroke-width="3"/><circle cx="60" cy="6" r="5" fill="${p.glow}"/><circle cx="58.5" cy="4.5" r="1.6" fill="#fff" opacity=".9"/>`,
    bolt: (p) => `<path d="M60 20 V12" stroke="${p.h2}" stroke-width="3"/><path d="M64 -2 L56 8 H61 L57 17 L68 5 H62Z" fill="${p.glow}"/>`,
    leaf: (p) => `<path d="M60 20 V10" stroke="${p.h2}" stroke-width="3"/><path d="M60 12 Q74 10 78 -2 Q62 0 60 12Z" fill="#5bc069"/><path d="M60 12 Q48 8 44 -2 Q58 -2 60 12Z" fill="#46a455"/>`,
    star: (p) => `<path d="M60 20 V12" stroke="${p.h2}" stroke-width="3"/><path d="M60 -4 L63 4 L71 5 L65 10 L67 18 L60 14 L53 18 L55 10 L49 5 L57 4Z" fill="${p.glow}"/>`,
    flame: (p) => `<path d="M60 20 V14" stroke="${p.h2}" stroke-width="3"/><path d="M60 -6 Q70 4 66 12 Q64 16 60 16 Q54 16 54 10 Q54 4 60 -6Z" fill="${p.glow}"/><path d="M60 4 Q64 9 62 13 Q58 13 58 9Z" fill="#fff6c9"/>`,
    crystal: (p) => `<path d="M60 20 V12" stroke="${p.h2}" stroke-width="3"/><path d="M60 -6 L67 4 L63 14 H57 L53 4Z" fill="${p.glow}" opacity=".95"/><path d="M60 -6 L63 14 H57Z" fill="#fff" opacity=".35"/>`,
    dish: (p) => `<path d="M60 20 V12" stroke="${p.h2}" stroke-width="3"/><path d="M48 6 Q60 20 72 6 Q60 -2 48 6Z" fill="${p.h2}" stroke="${p.glow}" stroke-width="1.5"/><circle cx="60" cy="4" r="2" fill="${p.glow}"/>`,
    flower: (p) => `<path d="M60 20 V10" stroke="#58b55f" stroke-width="3"/><g fill="${p.glow}"><circle cx="60" cy="0" r="4"/><circle cx="54" cy="6" r="4"/><circle cx="66" cy="6" r="4"/><circle cx="56" cy="-4" r="4"/><circle cx="64" cy="-4" r="4"/></g><circle cx="60" cy="3" r="3" fill="#ffe27a"/>`,
    twin: (p) => `<path d="M52 21 Q46 10 40 8 M68 21 Q74 10 80 8" stroke="${p.h2}" stroke-width="3" fill="none"/><circle cx="40" cy="7" r="4" fill="${p.glow}"/><circle cx="80" cy="7" r="4" fill="${p.glow}"/>`,
    ring: (p) => `<path d="M60 20 V14" stroke="${p.h2}" stroke-width="3"/><circle cx="60" cy="6" r="7" fill="none" stroke="${p.glow}" stroke-width="3"/>`
  };

  // Particles orbiting Bagley (static positions; the CSS class animates them).
  const FXP = [[14, 24], [104, 30], [8, 78], [112, 84], [24, 108], [98, 112], [60, 2], [4, 52], [116, 56], [40, 124], [82, 126]];
  function fxMarkup(kind, p, live) {
    if (!kind || kind === 'none') return '';
    let s = '<g class="b-fx">';
    FXP.forEach((pt, i) => {
      const x = pt[0], y = pt[1], a = live ? ` class="bf" style="animation-delay:${-(i * 0.57).toFixed(2)}s"` : '';
      if (kind === 'sparkle') s += `<path${a} d="M${x} ${y - 4} L${x + 1.2} ${y - 1.2} L${x + 4} ${y} L${x + 1.2} ${y + 1.2} L${x} ${y + 4} L${x - 1.2} ${y + 1.2} L${x - 4} ${y} L${x - 1.2} ${y - 1.2}Z" fill="${p.glow}"/>`;
      else if (kind === 'stars') s += `<circle${a} cx="${x}" cy="${y}" r="${i % 3 ? 1.3 : 2}" fill="#fff"/>`;
      else if (kind === 'embers') s += `<circle${a} cx="${x}" cy="${y}" r="${1.2 + (i % 3) * 0.6}" fill="${i % 2 ? p.glow : '#ffd27a'}"/>`;
      else if (kind === 'bubbles') s += `<circle${a} cx="${x}" cy="${y}" r="${2 + (i % 4)}" fill="none" stroke="${p.glow}" stroke-width="1.1"/>`;
      else if (kind === 'snow') s += `<circle${a} cx="${x}" cy="${y}" r="${1.4 + (i % 3) * 0.5}" fill="#eaf6ff"/>`;
      else if (kind === 'binary') s += `<rect${a} x="${x}" y="${y}" width="${i % 2 ? 2 : 4}" height="5" fill="${p.glow}"/>`;
      else if (kind === 'leaves') s += `<path${a} d="M${x} ${y} q4 -5 8 0 q-4 5 -8 0Z" fill="${i % 2 ? '#6fd27a' : '#4fae5b'}"/>`;
      else if (kind === 'petals') s += `<ellipse${a} cx="${x}" cy="${y}" rx="3.2" ry="1.8" fill="${i % 2 ? '#ffc0d4' : '#ff9cbc'}"/>`;
      else if (kind === 'bolts') s += `<path${a} d="M${x + 1} ${y - 5} L${x - 2} ${y + 1} H${x + 1} L${x - 1} ${y + 6} L${x + 4} ${y - 1} H${x + 1}Z" fill="${p.glow}"/>`;
      else if (kind === 'coins') s += `<circle${a} cx="${x}" cy="${y}" r="3" fill="#f6c453" stroke="#b8861f" stroke-width=".8"/>`;
      else if (kind === 'runes') s += `<path${a} d="M${x} ${y - 4} V${y + 4} M${x - 3} ${y - 1} L${x + 3} ${y + 2}" stroke="${p.glow}" stroke-width="1.4" fill="none"/>`;
      else if (kind === 'notes') s += `<path${a} d="M${x} ${y} v-7 l5 -1.4 v6" stroke="${p.glow}" stroke-width="1.4" fill="none"/>`;
    });
    return s + '</g>';
  }

  function bagley(spec, opts) {
    opts = opts || {};
    const key = opts.key || 'b';
    const live = !!opts.live;
    const p = { h1: spec.h[0], h2: spec.h[1], face: spec.face || '#0b1224', eye: spec.eye, glow: spec.glow, live: live };
    const c = ctx(key, 1, live);
    const aura = rg(c, [[0, p.glow, 0.34], [0.6, p.glow, 0.08], [1, p.glow, 0]], 60, 66, 62);
    const hull = lg(c, [[0, p.h1], [1, p.h2]], 20, 20, 100, 92);
    const body = lg(c, [[0, mix(p.h1, '#000', 0.12)], [1, mix(p.h2, '#000', 0.25)]], 38, 90, 82, 120);
    const idle = spec.idle || 'float';
    const parts =
      `<circle cx="60" cy="66" r="62" fill="${aura}"/>` +
      fxMarkup(spec.fx, p, live) +
      `<g class="b-rig b-${idle}">` +
      (BACK[spec.back || 'none'] || BACK.none)(p) +
      `<rect x="38" y="88" width="44" height="30" rx="14" fill="${body}"/><circle cx="60" cy="104" r="5" fill="${p.glow}" opacity=".9"/><circle cx="60" cy="104" r="2" fill="#fff" opacity=".8"/>` +
      (NECK[spec.neck || 'none'] || NECK.none)(p) +
      `<circle cx="14" cy="58" r="6" fill="${p.h2}"/><circle cx="106" cy="58" r="6" fill="${p.h2}"/>` +
      `<rect x="16" y="20" width="88" height="72" rx="32" fill="${hull}"/><rect x="16" y="20" width="88" height="72" rx="32" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="1.6"/>` +
      `<path d="M30 30 Q60 18 90 30" stroke="#fff" stroke-opacity=".3" stroke-width="3" fill="none" stroke-linecap="round"/>` +
      `<rect x="26" y="36" width="68" height="46" rx="21" fill="${p.face}"/><rect x="26" y="36" width="68" height="46" rx="21" fill="none" stroke="${p.glow}" stroke-opacity=".35" stroke-width="1.4"/>` +
      (EYES[spec.eyes || 'dry'] || EYES.dry)(p) +
      (WEAR[spec.wear || 'none'] || WEAR.none)(p) +
      `<path d="M50 72 Q60 77 71 71" stroke="${p.eye}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".9"/>` +
      (ANT[spec.ant || 'none'] || ANT.none)(p) +
      (HAT[spec.hat || 'none'] || HAT.none)(p) +
      '</g>';
    const sz = opts.size || 120;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -16 132 150" width="${sz}" height="${Math.round(sz * 150 / 132)}" role="img" aria-label="${(spec.n || 'Bagley').replace(/"/g, '')}" class="bagley-svg"><defs>${c.defs.join('')}</defs>${parts}</svg>`;
  }

  root.SMArt = { scene, bagley, G, HAT, EYES, WEAR, NECK, BACK, ANT, hueOf, contrast, fitContrast, mix, lum, rgb2hsl, hsl2hex, hex2rgb, rng };
})(typeof window !== 'undefined' ? window : globalThis);
