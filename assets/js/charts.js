/* ============================================================
   charts.js — мини-библиотека графиков на SVG (без зависимостей)
   Работает офлайн, не требует CDN.
   ============================================================ */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const fmt = global.AppFormat || {};

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function make(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function shortNum(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1).replace('.', ',') + ' млрд';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' млн';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + ' тыс';
    return String(Math.round(v));
  }

  function niceStep(range, ticks) {
    const raw = range / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    let step;
    if (norm <= 1) step = 1; else if (norm <= 2) step = 2;
    else if (norm <= 2.5) step = 2.5; else if (norm <= 5) step = 5; else step = 10;
    return step * mag;
  }

  function tip(container) {
    let t = container.querySelector('.chart-tip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'chart-tip';
      container.appendChild(t);
    }
    return t;
  }

  function base(container, height) {
    container.innerHTML = '';
    container.classList.add('chart');
    const w = Math.max(240, container.clientWidth || 640);
    const svg = make('svg', {
      viewBox: `0 0 ${w} ${height}`,
      width: '100%', height: height,
      role: 'img', preserveAspectRatio: 'xMidYMid meet'
    });
    container.appendChild(svg);
    return { svg, w, h: height };
  }

  /* ---------- Линейный график ---------- */
  function line(container, opts) {
    const series = (opts.series || []).filter(s => s.points && s.points.length);
    if (!series.length) { container.innerHTML = '<div class="chart-empty">Нет данных</div>'; return; }
    const H = opts.height || 320;
    const { svg, w, h } = base(container, H);
    const m = { t: 18, r: 16, b: 34, l: 54 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;

    const xs = [], ys = [];
    series.forEach(s => s.points.forEach(p => { xs.push(p[0]); ys.push(p[1]); }));
    let x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = opts.y0 != null ? opts.y0 : Math.min(...ys);
    let y1 = Math.max(...ys);
    if (y1 === y0) y1 = y0 + 1;
    if (opts.y0 == null) {
      const pad = (y1 - y0) * 0.08;
      y0 = y0 < 0 ? y0 - pad : Math.max(0, y0 - pad);
      y1 = y1 + pad;
    }
    const sx = v => m.l + (x1 === x0 ? pw / 2 : (v - x0) / (x1 - x0) * pw);
    const sy = v => m.t + ph - (v - y0) / (y1 - y0) * ph;

    /* сетка + подписи Y */
    const step = niceStep(y1 - y0, 4);
    for (let v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) {
      const y = sy(v);
      svg.appendChild(make('line', { x1: m.l, x2: w - m.r, y1: y, y2: y, class: 'grid' }));
      const t = make('text', { x: m.l - 8, y: y + 4, class: 'axis-y', 'text-anchor': 'end' });
      t.textContent = (opts.yFmt || shortNum)(v);
      svg.appendChild(t);
    }

    /* подписи X */
    const xt = opts.xTicks || 6;
    for (let i = 0; i <= xt; i++) {
      const v = x0 + (x1 - x0) * (i / xt);
      const x = sx(v);
      const t = make('text', { x, y: h - 10, class: 'axis-x', 'text-anchor': 'middle' });
      t.textContent = (opts.xFmt || (v => Math.round(v)))(v);
      svg.appendChild(t);
    }

    /* области и линии */
    series.forEach(s => {
      const d = s.points.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join(' ');
      if (s.area !== false && series.length <= 2) {
        const area = make('path', {
          d: d + ` L ${sx(s.points[s.points.length - 1][0]).toFixed(1)} ${m.t + ph} L ${sx(s.points[0][0]).toFixed(1)} ${m.t + ph} Z`,
          fill: s.color, opacity: 0.10
        });
        svg.appendChild(area);
      }
      const p = make('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
      if (s.dash) p.setAttribute('stroke-dasharray', s.dash);
      svg.appendChild(p);
    });

    /* интерактив */
    const crossX = make('line', { y1: m.t, y2: m.t + ph, class: 'cross' });
    svg.appendChild(crossX);
    const dots = series.map(s => {
      const c = make('circle', { r: 4, fill: s.color, class: 'dot' });
      svg.appendChild(c); return c;
    });
    const t = tip(container);
    const hit = make('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' });
    svg.appendChild(hit);
    crossX.style.display = 'none';
    dots.forEach(d => d.style.display = 'none');

    function move(ev) {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * w;
      const xv = x0 + (px - m.l) / pw * (x1 - x0);
      const s0 = series[0].points;
      let best = 0, bd = Infinity;
      s0.forEach((p, i) => { const d = Math.abs(p[0] - xv); if (d < bd) { bd = d; best = i; } });
      const X = sx(s0[best][0]);
      crossX.setAttribute('x1', X); crossX.setAttribute('x2', X);
      crossX.style.display = '';
      let rows = '';
      series.forEach((s, si) => {
        const p = s.points[best] || s.points[s.points.length - 1];
        dots[si].setAttribute('cx', sx(p[0])); dots[si].setAttribute('cy', sy(p[1]));
        dots[si].style.display = '';
        rows += `<div class="tip-row"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${esc((opts.yFmtFull || opts.yFmt || shortNum)(p[1]))}</b></div>`;
      });
      t.innerHTML = `<div class="tip-head">${esc((opts.xFmtFull || opts.xFmt || (v => Math.round(v)))(s0[best][0]))}</div>${rows}`;
      const tw = t.offsetWidth || 180;
      let left = (X / w) * r.width + 14;
      if (left + tw > r.width) left = (X / w) * r.width - tw - 14;
      t.style.left = Math.max(4, left) + 'px';
      t.style.top = '10px';
      t.style.opacity = '1';
    }
    function out() {
      t.style.opacity = '0';
      crossX.style.display = 'none';
      dots.forEach(d => d.style.display = 'none');
    }
    svg.addEventListener('mousemove', move);
    svg.addEventListener('mouseleave', out);
    svg.addEventListener('touchmove', e => { if (e.touches[0]) move(e.touches[0]); }, { passive: true });
    svg.addEventListener('touchend', out);

    /* легенда */
    if (opts.legend !== false && series.length > 1) {
      const lg = document.createElement('div');
      lg.className = 'chart-legend';
      lg.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
      container.appendChild(lg);
    }
  }

  /* ---------- Веер (Монте-Карло) ---------- */
  function fan(container, opts) {
    const H = opts.height || 340;
    const { svg, w, h } = base(container, H);
    const m = { t: 18, r: 16, b: 34, l: 54 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const years = opts.years;
    const all = [].concat(opts.p10, opts.p50, opts.p90);
    let y0 = 0, y1 = Math.max(...all) * 1.06;
    const sx = i => m.l + (i / (years.length - 1)) * pw;
    const sy = v => m.t + ph - (v - y0) / (y1 - y0) * ph;

    const step = niceStep(y1 - y0, 4);
    for (let v = 0; v <= y1 + 1e-9; v += step) {
      const y = sy(v);
      svg.appendChild(make('line', { x1: m.l, x2: w - m.r, y1: y, y2: y, class: 'grid' }));
      const t = make('text', { x: m.l - 8, y: y + 4, class: 'axis-y', 'text-anchor': 'end' });
      t.textContent = shortNum(v);
      svg.appendChild(t);
    }
    const xt = Math.min(8, years.length - 1);
    for (let i = 0; i <= xt; i++) {
      const idx = Math.round(i * (years.length - 1) / xt);
      const t = make('text', { x: sx(idx), y: h - 10, class: 'axis-x', 'text-anchor': 'middle' });
      t.textContent = years[idx] + ' г.';
      svg.appendChild(t);
    }
    const up = years.map((_, i) => `${sx(i).toFixed(1)} ${sy(opts.p90[i]).toFixed(1)}`);
    const dn = years.map((_, i) => `${sx(i).toFixed(1)} ${sy(opts.p10[i]).toFixed(1)}`).reverse();
    svg.appendChild(make('polygon', { points: up.concat(dn).join(' '), fill: '#22c55e', opacity: 0.16 }));
    svg.appendChild(make('path', {
      d: years.map((_, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(opts.p50[i]).toFixed(1)).join(' '),
      fill: 'none', stroke: '#22c55e', 'stroke-width': 2.6
    }));
    svg.appendChild(make('path', {
      d: years.map((_, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(opts.p10[i]).toFixed(1)).join(' '),
      fill: 'none', stroke: '#f87171', 'stroke-width': 1.6, 'stroke-dasharray': '5 5'
    }));
    svg.appendChild(make('path', {
      d: years.map((_, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ' ' + sy(opts.p90[i]).toFixed(1)).join(' '),
      fill: 'none', stroke: '#86efac', 'stroke-width': 1.6, 'stroke-dasharray': '5 5'
    }));
    const lg = document.createElement('div');
    lg.className = 'chart-legend';
    lg.innerHTML = `<span><i style="background:#86efac"></i>Оптимистично (90-й перцентиль)</span>
      <span><i style="background:#22c55e"></i>Медиана</span>
      <span><i style="background:#f87171"></i>Пессимистично (10-й перцентиль)</span>`;
    container.appendChild(lg);
  }

  /* ---------- Круговая диаграмма ---------- */
  function donut(container, opts) {
    const items = (opts.items || []).filter(i => i.value > 0);
    if (!items.length) { container.innerHTML = ''; return; }
    const H = opts.height || 240;
    container.innerHTML = '';
    container.classList.add('chart');
    const w = Math.max(200, container.clientWidth || 320);
    const svg = make('svg', { viewBox: `0 0 ${w} ${H}`, width: '100%', height: H });
    container.appendChild(svg);
    const cx = w / 2, cy = H / 2, R = Math.min(w, H) / 2 - 12, r = R * 0.62;
    const total = items.reduce((s, i) => s + i.value, 0);
    let a = -Math.PI / 2;
    items.forEach(it => {
      const ang = it.value / total * Math.PI * 2;
      const a2 = a + ang;
      const large = ang > Math.PI ? 1 : 0;
      const p = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
      const [x1, y1] = p(R, a), [x2, y2] = p(R, a2), [x3, y3] = p(r, a2), [x4, y4] = p(r, a);
      const d = `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${large} 0 ${x4} ${y4} Z`;
      const path = make('path', { d, fill: it.color, opacity: 0.92 });
      path.appendChild(make('title')).textContent = `${it.label}: ${it.value}%`;
      svg.appendChild(path);
      a = a2;
    });
    const t1 = make('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'donut-main' });
    t1.textContent = opts.centerTitle || '';
    svg.appendChild(t1);
    const t2 = make('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', class: 'donut-sub' });
    t2.textContent = opts.centerSub || '';
    svg.appendChild(t2);
    const lg = document.createElement('div');
    lg.className = 'chart-legend donut-legend';
    lg.innerHTML = items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.label)} — <b>${i.value}%</b></span>`).join('');
    container.appendChild(lg);
  }

  /* ---------- Столбики ---------- */
  function bars(container, opts) {
    const items = opts.items || [];
    const H = opts.height || 260;
    const { svg, w, h } = base(container, H);
    const m = { t: 20, r: 12, b: 46, l: 54 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const max = Math.max(...items.map(i => i.value)) * 1.1 || 1;
    const bw = pw / items.length * 0.6;
    const step = niceStep(max, 4);
    for (let v = 0; v <= max + 1e-9; v += step) {
      const y = m.t + ph - v / max * ph;
      svg.appendChild(make('line', { x1: m.l, x2: w - m.r, y1: y, y2: y, class: 'grid' }));
      const t = make('text', { x: m.l - 8, y: y + 4, class: 'axis-y', 'text-anchor': 'end' });
      t.textContent = (opts.yFmt || shortNum)(v);
      svg.appendChild(t);
    }
    items.forEach((it, i) => {
      const x = m.l + pw / items.length * (i + 0.5) - bw / 2;
      const bh = it.value / max * ph;
      const rect = make('rect', { x, y: m.t + ph - bh, width: bw, height: Math.max(1, bh), rx: 4, fill: it.color || '#22c55e' });
      rect.appendChild(make('title')).textContent = `${it.label}: ${(opts.yFmt || shortNum)(it.value)}`;
      svg.appendChild(rect);
      const t = make('text', { x: x + bw / 2, y: h - 26, class: 'axis-x', 'text-anchor': 'middle' });
      t.textContent = it.label;
      svg.appendChild(t);
      if (opts.showValue) {
        const v = make('text', { x: x + bw / 2, y: m.t + ph - bh - 6, class: 'axis-x bar-val', 'text-anchor': 'middle' });
        v.textContent = (opts.yFmt || shortNum)(it.value);
        svg.appendChild(v);
      }
    });
  }

  global.Charts = { line, fan, donut, bars, shortNum };
})(window);
