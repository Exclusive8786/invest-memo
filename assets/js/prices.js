/* ============================================================
   prices.js — актуальные цены: ЦБ РФ, CoinGecko, Twelve Data
   Всё бесплатное и без обязательного ключа (кроме акций).
   Если сеть недоступна — используются последние сохранённые данные.
   ============================================================ */
(function (global) {
  'use strict';

  const { $, $$, on, num, money, pct, esc, get, set } = global.U;

  /* ---------- Список отслеживаемых активов ---------- */
  const ASSETS = [
    { key: 'btc', name: 'Биткоин', ticker: 'BTC', src: 'coingecko', cg: 'bitcoin', cls: 'Крипта', unit: '$' },
    { key: 'eth', name: 'Эфириум', ticker: 'ETH', src: 'coingecko', cg: 'ethereum', cls: 'Крипта', unit: '$' },
    { key: 'xau', name: 'Золото (1 унция)', ticker: 'XAU', src: 'coingecko', cg: 'pax-gold', cls: 'Металл', unit: '$' },
    { key: 'usd', name: 'Доллар США', ticker: 'USD/RUB', src: 'cbr', cbr: 'USD', cls: 'Валюта', unit: '₽' },
    { key: 'eur', name: 'Евро', ticker: 'EUR/RUB', src: 'cbr', cbr: 'EUR', cls: 'Валюта', unit: '₽' },
    { key: 'cny', name: 'Юань', ticker: 'CNY/RUB', src: 'cbr', cbr: 'CNY', cls: 'Валюта', unit: '₽' },
    { key: 'spy', name: 'S&P 500 ETF', ticker: 'SPY', src: 'twelvedata', cls: 'Акции', unit: '$' },
    { key: 'qqq', name: 'Nasdaq 100 ETF', ticker: 'QQQ', src: 'twelvedata', cls: 'Акции', unit: '$' },
    { key: 'voo', name: 'S&P 500 (VOO)', ticker: 'VOO', src: 'twelvedata', cls: 'Акции', unit: '$' },
    { key: 'imoex', name: 'Индекс МосБиржи', ticker: 'IMOEX', src: 'manual', cls: 'Индекс', unit: '₽' },
    { key: 'ofz', name: 'ОФЗ (любой выпуск)', ticker: 'ОФЗ', src: 'manual', cls: 'Облигация', unit: '₽' }
  ];

  const CACHE_TTL = 10 * 60 * 1000; // 10 минут

  const state = {
    live: {},        // key -> { price, change, currency, ts }
    manual: get('manualPrices', {}),   // key -> price
    fx: { USD: null, EUR: null, CNY: null },
    updated: null,
    status: '',
    errors: []
  };

  /* ---------- Утилиты сети ---------- */
  function fetchJSON(url, ms) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch недоступен'));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 9000);
    return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(t));
  }

  /* ---------- Провайдеры ---------- */
  function loadCBR() {
    return fetchJSON('https://www.cbr-xml-daily.ru/daily_json.js').then(d => {
      const v = d.Valute || {};
      ['USD', 'EUR', 'CNY'].forEach(c => {
        if (v[c]) {
          state.fx[c] = v[c].Value / (v[c].Nominal || 1);
          state.live[c.toLowerCase()] = {
            price: state.fx[c],
            change: v[c].Previous ? (v[c].Value - v[c].Previous) / v[c].Previous * 100 : 0,
            currency: 'RUB', ts: Date.now(), src: 'ЦБ РФ'
          };
        }
      });
      return 'ЦБ РФ: ' + (d.Date ? new Date(d.Date).toLocaleDateString('ru-RU') : 'ок');
    });
  }

  function loadFXFallback() {
    if (state.fx.USD) return Promise.resolve(null);
    return fetchJSON('https://open.er-api.com/v6/latest/USD').then(d => {
      const r = d.rates || {};
      if (!r.RUB) throw new Error('нет курса RUB');
      state.fx.USD = r.RUB;
      state.fx.EUR = r.RUB / (r.EUR || 1);
      state.fx.CNY = r.RUB / (r.CNY || 1);
      state.live.usd = { price: r.RUB, change: 0, currency: 'RUB', ts: Date.now(), src: 'exchangerate-api' };
      return 'exchangerate-api: резервный курс';
    }).catch(() => fetchJSON('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=rub').then(d => {
      const v = d.tether && d.tether.rub;
      if (!v) throw new Error('нет курса');
      state.fx.USD = v;
      state.live.usd = { price: v, change: 0, currency: 'RUB', ts: Date.now(), src: 'CoinGecko (USDT/RUB)' };
      return 'CoinGecko: курс USDT/RUB как ориентир';
    }));
  }

  function loadCoinGecko() {
    const ids = ASSETS.filter(a => a.src === 'coingecko').map(a => a.cg).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    return fetchJSON(url).then(d => {
      ASSETS.filter(a => a.src === 'coingecko').forEach(a => {
        const row = d[a.cg];
        if (row && row.usd != null) {
          state.live[a.key] = {
            price: row.usd,
            change: row.usd_24h_change != null ? row.usd_24h_change : 0,
            currency: 'USD', ts: Date.now(), src: 'CoinGecko'
          };
        }
      });
      return 'CoinGecko: крипта и золото';
    });
  }

  function loadTwelveData() {
    const key = get('tdKey', '');
    if (!key) return Promise.resolve(null);
    const syms = ASSETS.filter(a => a.src === 'twelvedata').map(a => a.ticker).join(',');
    if (!syms) return Promise.resolve(null);
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(syms)}&apikey=${encodeURIComponent(key)}`;
    return fetchJSON(url, 12000).then(d => {
      ASSETS.filter(a => a.src === 'twelvedata').forEach(a => {
        const row = d[a.ticker] || (d.data && d.data[a.ticker]);
        if (row && row.close != null) {
          state.live[a.key] = {
            price: parseFloat(row.close),
            change: row.percent_change != null ? parseFloat(row.percent_change) : 0,
            currency: row.currency || 'USD', ts: Date.now(), src: 'Twelve Data'
          };
        }
      });
      return 'Twelve Data: акции и ETF';
    });
  }

  /* ---------- Основная загрузка ---------- */
  function loadAll(force) {
    const cached = get('priceCache', null);
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL) {
      state.live = cached.live || {};
      state.fx = cached.fx || state.fx;
      state.updated = cached.ts;
      state.status = 'Из кэша, обновлено ' + new Date(cached.ts).toLocaleTimeString('ru-RU');
      render();
      return Promise.resolve();
    }

    setStatus('Обновляю цены…', 'loading');
    state.errors = [];

    const safe = fn => { try { return fn(); } catch (e) { return Promise.resolve(null); } };
    const tasks = [
      safe(loadCBR).catch(e => { state.errors.push('ЦБ РФ недоступен'); return null; }),
      safe(loadCoinGecko).catch(e => { state.errors.push('CoinGecko недоступен'); return null; })
    ];
    return Promise.all(tasks)
      .then(() => safe(loadFXFallback).catch(() => null))
      .then(() => safe(loadTwelveData).catch(e => { state.errors.push('Twelve Data: ' + e.message); return null; }))
      .then(() => {
        state.updated = Date.now();
        set('priceCache', { ts: state.updated, live: state.live, fx: state.fx });
        const got = Object.keys(state.live).length;
        if (got) {
          setStatus(`Обновлено: ${new Date(state.updated).toLocaleTimeString('ru-RU')} · источников: ${got}` +
            (state.errors.length ? ' · ' + state.errors.join(', ') : ''), 'ok');
        } else {
          const old = get('priceCache', null);
          if (old && old.live) { state.live = old.live; state.fx = old.fx || state.fx; }
          setStatus('Нет доступа к сети. Показаны последние сохранённые цены — можно ввести вручную.', 'warn');
        }
        render();
        global.Portfolio && global.Portfolio.refresh();
      });
  }

  function setStatus(text, kind) {
    state.status = text;
    const el = $('#marketStatus');
    if (el) {
      el.textContent = text;
      el.className = 'market-status ' + (kind || '');
    }
  }

  /* ---------- Цена актива ---------- */
  function priceOf(a) {
    const live = state.live[a.key];
    const man = state.manual[a.key];
    const manualNum = man != null && man !== '' ? parseFloat(man) : null;
    let price = null, src = '—', change = null, ts = null, cur = a.unit === '$' ? 'USD' : 'RUB';
    if (live) { price = live.price; src = live.src; change = live.change; ts = live.ts; cur = live.currency; }
    if (manualNum != null && isFinite(manualNum)) { price = manualNum; src = 'вручную'; change = null; cur = a.unit === '$' ? 'USD' : 'RUB'; }
    let rub = null;
    if (price != null) {
      if (cur === 'USD' && state.fx.USD) rub = price * state.fx.USD;
      else if (cur === 'RUB') rub = price;
      else if (cur === 'EUR' && state.fx.EUR) rub = price * state.fx.EUR;
    }
    return { price, rub, src, change, ts, cur };
  }

  function livePriceByTicker(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return null;
    const a = ASSETS.find(x => x.ticker.toUpperCase() === t);
    if (a) return priceOf(a);
    if (state.manual[t] != null && state.manual[t] !== '') {
      const p = parseFloat(state.manual[t]);
      if (isFinite(p)) return { price: p, rub: p, src: 'вручную', change: null, ts: null, cur: 'RUB' };
    }
    return null;
  }

  /* ---------- Отрисовка ---------- */
  function render() {
    renderTicker();
    renderTable();
    const up = $('#marketUpdated');
    if (up && state.updated) up.textContent = new Date(state.updated).toLocaleString('ru-RU');
    global.Portfolio && global.Portfolio.refresh();
  }

  function fmtPrice(p, cur) {
    if (p == null) return '—';
    if (cur === 'USD') return '$' + num(p, p >= 1000 ? 0 : 2);
    return num(p, p >= 1000 ? 0 : 2) + ' ₽';
  }

  function renderTicker() {
    const box = $('#ticker');
    if (!box) return;
    const items = ASSETS.filter(a => a.key !== 'ofz' && a.key !== 'imoex').map(a => {
      const p = priceOf(a);
      if (p.price == null) return '';
      const ch = p.change;
      const cls = ch == null ? '' : (ch >= 0 ? 'up' : 'down');
      const arrow = ch == null ? '' : (ch >= 0 ? '▲' : '▼');
      return `<span class="tick"><b>${esc(a.ticker)}</b> ${fmtPrice(p.price, p.cur)}
        <i class="${cls}">${arrow}${ch == null ? '' : num(Math.abs(ch), 2) + '%'}</i></span>`;
    }).filter(Boolean).join('<span class="tick-sep">•</span>');
    box.innerHTML = items ? items + '<span class="tick-sep">•</span>' + items : 'Цены загружаются…';
  }

  function renderTable() {
    const tb = $('#marketBody');
    if (!tb) return;
    tb.innerHTML = ASSETS.map(a => {
      const p = priceOf(a);
      const ch = p.change;
      const chCls = ch == null ? 'muted' : (ch >= 0 ? 'pos' : 'neg');
      const chTxt = ch == null ? '—' : (ch >= 0 ? '+' : '') + num(ch, 2) + '%';
      const manVal = state.manual[a.key] != null ? state.manual[a.key] : '';
      return `<tr>
        <td><b>${esc(a.name)}</b><span class="row-sub">${esc(a.cls)}</span></td>
        <td><code>${esc(a.ticker)}</code></td>
        <td class="num"><b>${fmtPrice(p.price, p.cur)}</b></td>
        <td class="num ${chCls}">${chTxt}</td>
        <td class="num muted">${p.rub != null ? money(p.rub, '₽') : '—'}</td>
        <td class="muted small">${esc(p.src)}${p.ts ? '<span class="row-sub">' + new Date(p.ts).toLocaleTimeString('ru-RU') + '</span>' : ''}</td>
        <td class="num">
          <input class="manual-price" data-key="${a.key}" type="number" step="any" inputmode="decimal"
                 placeholder="вручную" value="${manVal}" aria-label="Цена вручную для ${esc(a.name)}">
        </td>
      </tr>`;
    }).join('');

    $$('.manual-price', tb).forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.key;
        const v = parseFloat(inp.value);
        if (isFinite(v) && v > 0) state.manual[k] = v; else delete state.manual[k];
        set('manualPrices', state.manual);
        render();
      });
    });
  }

  /* ---------- Инициализация ---------- */
  function init() {
    const keyInput = $('#tdKey');
    if (keyInput) {
      keyInput.value = get('tdKey', '');
      on($('#tdKeySave'), 'click', () => {
        set('tdKey', keyInput.value.trim());
        setStatus('Ключ сохранён. Обновляю…', 'loading');
        loadAll(true);
      });
    }
    on($('#marketRefresh'), 'click', () => { set('priceCache', null); loadAll(true); });
    render();
    loadAll(false);
    setInterval(() => { if (!document.hidden) loadAll(false); }, CACHE_TTL);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAll(false); });
  }

  global.Prices = { init, loadAll, priceOf, livePriceByTicker, state, ASSETS, render };
})(window);
