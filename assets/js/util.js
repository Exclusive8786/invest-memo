/* ============================================================
   util.js — форматирование чисел, работа с localStorage, утилиты
   ============================================================ */
(function (global) {
  'use strict';

  const NBSP = '\u00A0';

  function num(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toLocaleString('ru-RU', {
      minimumFractionDigits: d == null ? 0 : d,
      maximumFractionDigits: d == null ? 0 : d
    }).replace(/\u00A0/g, NBSP);
  }

  function money(v, cur) {
    return num(v, 0) + NBSP + (cur || '₽');
  }

  function pct(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return num(v, d == null ? 1 : d) + NBSP + '%';
  }

  function short(v) {
    const a = Math.abs(v);
    if (a >= 1e12) return num(v / 1e12, 2) + NBSP + 'трлн';
    if (a >= 1e9) return num(v / 1e9, a >= 1e10 ? 1 : 2) + NBSP + 'млрд';
    if (a >= 1e6) return num(v / 1e6, a >= 1e7 ? 1 : 2) + NBSP + 'млн';
    if (a >= 1e3) return num(v / 1e3, a >= 1e4 ? 0 : 1) + NBSP + 'тыс';
    return num(v, 0);
  }

  /** Нормализует массив долей до 100% */
  function normalize(weights) {
    const s = weights.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    if (!s) return weights.map(() => 0);
    return weights.map(w => (w > 0 ? w : 0) / s * 100);
  }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  /* ---------- Хранилище ---------- */
  const KEY = 'invest-memo-v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function save(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }
  function get(k, def) {
    const s = load();
    return s[k] === undefined ? def : s[k];
  }
  function set(k, v) {
    const s = load();
    s[k] = v;
    return save(s);
  }
  function clearAll() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  /* ---------- DOM ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  /** Безопасное число из input */
  function valNum(el, def) {
    if (!el) return def;
    const v = parseFloat(String(el.value).replace(/\s/g, '').replace(',', '.'));
    return isFinite(v) ? v : def;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** Плавная анимация числа */
  function animateNum(el, to, fmtFn, ms) {
    if (!el) return;
    const from = parseFloat(el.dataset.v || '0') || 0;
    const dur = ms || 550;
    const t0 = performance.now();
    function step(t) {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      const v = from + (to - from) * e;
      el.textContent = fmtFn(v);
      if (k < 1) requestAnimationFrame(step);
      else { el.dataset.v = String(to); el.textContent = fmtFn(to); }
    }
    requestAnimationFrame(step);
  }

  /** Планировщик перерисовки графиков при ресайзе */
  function onResize(fn) {
    let t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(fn, 160);
    });
  }

  global.AppFormat = { num, money, pct, short, NBSP };
  global.U = {
    num, money, pct, short, normalize, clamp, esc,
    load, save, get, set, clearAll, $, $$, on, valNum, animateNum, onResize, KEY
  };
})(window);
