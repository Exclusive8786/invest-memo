/* ============================================================
   prices.js — актуальные цены: акции, облигации, фонды, индексы
   Основной источник: Московская биржа (ISS API, без ключа, CORS есть)
   Курсы валют: ЦБ РФ · Мировые ETF: Twelve Data (свой бесплатный ключ)
   ============================================================ */
(function (global) {
  'use strict';

  const { $, $$, on, num, money, pct, esc, get, set } = global.U;

  /* ---------- Что отслеживаем по умолчанию ---------- */
  const WATCH = {
    indices: [
      { secid: 'IMOEX', name: 'Индекс МосБиржи' },
      { secid: 'RGBI', name: 'Индекс гособлигаций RGBI' }
    ],
    shares: [
      { secid: 'SBER', name: 'Сбербанк' },
      { secid: 'GAZP', name: 'Газпром' },
      { secid: 'LKOH', name: 'Лукойл' },
      { secid: 'GMKN', name: 'Норникель' }
    ],
    funds: [
      { secid: 'TMOS', name: 'Индекс МосБиржи (БПИФ)' },
      { secid: 'SBMX', name: 'Индекс МосБиржи (БПИФ, Сбер)' },
      { secid: 'GOLD', name: 'Золото (фонд)' },
      { secid: 'LQDT', name: 'Денежный рынок / ликвидность' }
    ],
    bonds: [
      { secid: 'SU26232RMFS7', name: 'ОФЗ 26232 (погашение 2027)' },
      { secid: 'SU26242RMFS6', name: 'ОФЗ 26242 (погашение 2029)' },
      { secid: 'SU26246RMFS7', name: 'ОФЗ 26246 (погашение 2036)' },
      { secid: 'SU26238RMFS4', name: 'ОФЗ 26238 (погашение 2041)' }
    ],
    fx: [
      { code: 'USD', name: 'Доллар США' },
      { code: 'EUR', name: 'Евро' },
      { code: 'CNY', name: 'Юань' }
    ],
    global: [
      { ticker: 'SPY', name: 'S&P 500 (SPY)' },
      { ticker: 'QQQ', name: 'Nasdaq 100 (QQQ)' },
      { ticker: 'VOO', name: 'S&P 500 (VOO)' }
    ]
  };

  const GROUP_TITLES = {
    indices: 'Индексы',
    shares: 'Акции',
    funds: 'Фонды и БПИФ',
    bonds: 'Облигации (ОФЗ)',
    fx: 'Курсы валют (ЦБ РФ)',
    global: 'Мировые фонды (нужен ключ Twelve Data)',
    custom: 'Мои тикеры'
  };

  const CACHE_TTL = 10 * 60 * 1000;

  const state = {
    items: {},        // key -> { group, name, ticker, price, rub, change, cur, extra, src, ts }
    fx: { USD: null, EUR: null, CNY: null },
    custom: get('customTickers', []),      // ['SNGSP','SU26238RMFS4', ...]
    manual: get('manualPrices', {}),       // key -> цена
    updated: null,
    errors: [],
    status: ''
  };

  /* ---------- Сеть ---------- */
  function fetchJSON(url, ms) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch недоступен'));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 12000);
    return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(t));
  }

  function moexUrl(market, board, secids) {
    return 'https://iss.moex.com/iss/engines/stock/markets/' + market +
      '/boards/' + board + '/securities.json?iss.meta=off&securities=' +
      encodeURIComponent(secids.join(','));
  }

  /** Разбирает ответ ISS: возвращает { SECID: {sec, md} } */
  function parseISS(json) {
    const toObj = blk => {
      const out = {};
      if (!blk || !blk.columns) return out;
      const cols = blk.columns;
      blk.data.forEach(row => {
        const o = {};
        cols.forEach((c, i) => { o[c] = row[i]; });
        if (o.SECID) out[o.SECID] = o;
      });
      return out;
    };
    const sec = toObj(json.securities), md = toObj(json.marketdata);
    const keys = new Set([...Object.keys(sec), ...Object.keys(md)]);
    const res = {};
    keys.forEach(k => { res[k] = { sec: sec[k] || {}, md: md[k] || {} }; });
    return res;
  }

  function pick() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (v !== null && v !== undefined && v !== '' && isFinite(v)) return +v;
    }
    return null;
  }

  function fetchBoard(market, board, secids) {
    if (!secids.length) return Promise.resolve({});
    return fetchJSON(moexUrl(market, board, secids)).then(parseISS);
  }

  /* ---------- Загрузка с MOEX ---------- */
  function applyIndex(secid, d, meta) {
    const v = pick(d.md.CURRENTVALUE, d.md.LASTVALUE, d.sec.PREVPRICE);
    if (v == null) return;
    state.items['idx:' + secid] = {
      group: 'indices', name: (meta && meta.name) || d.sec.SHORTNAME || secid,
      ticker: secid, price: v, rub: v, cur: 'RUB', isIndex: true, dec: pick(d.sec.DECIMALS, 2), src: 'MOEX',
      change: pick(d.md.LASTCHANGEPRC, d.md.LASTCHANGEPRCNT),
      extra: {
        'Изм. за месяц': pick(d.md.MONTHCHANGEPRC),
        'Изм. с начала года': pick(d.md.YEARCHANGEPRC),
        'Макс/мин за год': (d.sec.ANNUALHIGH && d.sec.ANNUALLOW) ? num(d.sec.ANNUALLOW, 2) + ' – ' + num(d.sec.ANNUALHIGH, 2) : null
      },
      ts: Date.now()
    };
  }

  function applyShare(secid, d, meta) {
    const v = pick(d.md.LAST, d.md.LCURRENTPRICE, d.md.MARKETPRICE, d.sec.PREVPRICE);
    if (v == null) return;
    const lot = pick(d.sec.LOTSIZE, 1);
    state.items['sh:' + secid] = {
      group: (meta && meta.group) || 'shares',
      name: (meta && meta.name) || d.sec.SHORTNAME || secid,
      ticker: secid, price: v, rub: v, cur: 'RUB', src: 'MOEX',
      dec: pick(d.sec.DECIMALS, 2),
      change: pick(d.md.LASTCHANGEPRCNT, d.md.LASTCHANGEPRC),
      extra: {
        'Лот': num(lot, 0) + ' шт',
        'Цена лота': money(v * lot, '₽'),
        'Оборот за день': d.md.VALTODAY ? global.U.short(d.md.VALTODAY) + ' ₽' : null,
        'Ближайший дивиденд': null
      },
      ts: Date.now()
    };
  }

  function applyBond(secid, d, meta) {
    const v = pick(d.md.LAST, d.md.LCURRENTPRICE, d.md.MARKETPRICE, d.sec.PREVPRICE);
    if (v == null) return;
    const face = pick(d.sec.FACEVALUE, 1000);
    const rubPrice = v * face / 100;                 // котировка в % от номинала
    const nkd = pick(d.sec.ACCRUEDINT);
    const couponRub = pick(d.sec.COUPONVALUE);
    const yieldPct = pick(d.md.YIELD, d.sec.YIELDATPREVWAPRICE);
    const durDays = pick(d.md.DURATION);
    state.items['bd:' + secid] = {
      group: 'bonds',
      name: (meta && meta.name) || d.sec.SHORTNAME || secid,
      ticker: secid, price: v, rub: rubPrice, cur: 'RUB', src: 'MOEX',
      change: pick(d.md.LASTCHANGEPRCNT, d.md.LASTCHANGEPRC),
      isBond: true,
      extra: {
        'Цена, ₽': money(rubPrice, '₽'),
        'НКД': nkd != null ? money(nkd, '₽') : null,
        'Купон': couponRub != null ? (money(couponRub, '₽') + (d.sec.COUPONPERIOD ? ' / ' + d.sec.COUPONPERIOD + ' дн.' : '')) : null,
        'Доходность': yieldPct != null ? num(yieldPct, 2) + '%' : null,
        'Погашение': d.sec.MATDATE && d.sec.MATDATE !== '0000-00-00' ? new Date(d.sec.MATDATE).toLocaleDateString('ru-RU') : null,
        'Дюрация': durDays != null ? num(durDays / 365, 1) + ' лет' : null,
        'Номинал': money(face, '₽')
      },
      bond: { yield: yieldPct, durYears: durDays != null ? durDays / 365 : null, matDate: d.sec.MATDATE },
      ts: Date.now()
    };
  }

  function loadMoex() {
    const custom = state.custom.map(s => String(s).toUpperCase().trim()).filter(Boolean);
    const shareList = WATCH.shares.concat(WATCH.funds.map(f => Object.assign({ group: 'funds' }, f)));
    const shareIds = shareList.map(s => s.secid).concat(custom);
    const idxIds = WATCH.indices.map(s => s.secid);
    const bondIds = WATCH.bonds.map(s => s.secid);

    const metaBy = {};
    shareList.forEach(s => { metaBy[s.secid] = s; });
    WATCH.indices.forEach(s => { metaBy[s.secid] = s; });
    WATCH.bonds.forEach(s => { metaBy[s.secid] = s; });

    const jobs = [
      fetchBoard('shares', 'TQBR', shareIds).then(rows => {
        Object.keys(rows).forEach(id => {
          const meta = metaBy[id] || { name: id, group: 'custom' };
          const d = rows[id];
          const isFund = /ETF|ПИФ/i.test(String(d.sec.SHORTNAME || '') + String(d.sec.SECNAME || ''));
          if (meta.group === 'custom' && isFund) meta.group = 'funds';
          applyShare(id, d, meta);
        });
      }),
      fetchBoard('bonds', 'TQOB', bondIds).then(rows => {
        Object.keys(rows).forEach(id => applyBond(id, rows[id], metaBy[id] || { name: id }));
      }),
      fetchBoard('index', 'SNDX', idxIds).then(rows => {
        Object.keys(rows).forEach(id => applyIndex(id, rows[id], metaBy[id] || { name: id }));
      })
    ];

    return Promise.all(jobs).then(() => {
      // тикеры из «своего списка», не найденные на TQBR, ищем среди облигаций и индексов
      const notFound = custom.filter(t => !state.items['sh:' + t]);
      if (!notFound.length) return;
      return fetchBoard('bonds', 'TQOB', notFound).then(rows => {
        Object.keys(rows).forEach(id => applyBond(id, rows[id], { name: id }));
        const left = notFound.filter(t => !state.items['bd:' + t]);
        if (!left.length) return;
        return fetchBoard('index', 'SNDX', left).then(rows2 => {
          Object.keys(rows2).forEach(id => applyIndex(id, rows2[id], { name: id }));
        });
      });
    });
  }

  /* ---------- Курсы валют ЦБ РФ ---------- */
  function loadCBR() {
    return fetchJSON('https://www.cbr-xml-daily.ru/daily_json.js').then(d => {
      const v = d.Valute || {};
      WATCH.fx.forEach(f => {
        const row = v[f.code];
        if (!row) return;
        const rate = row.Value / (row.Nominal || 1);
        state.fx[f.code] = rate;
        state.items['fx:' + f.code] = {
          group: 'fx', name: f.name + ' (' + f.code + '/RUB)', ticker: f.code + '/RUB',
          price: rate, rub: rate, cur: 'RUB', src: 'ЦБ РФ', dec: 4,
          change: row.Previous ? (row.Value - row.Previous) / row.Previous * 100 : null,
          extra: {}, ts: Date.now()
        };
      });
    });
  }

  /* ---------- Мировые ETF (Twelve Data) ---------- */
  function loadGlobal() {
    const key = get('tdKey', '');
    if (!key) return Promise.resolve(null);
    const syms = WATCH.global.map(g => g.ticker).join(',');
    return fetchJSON('https://api.twelvedata.com/quote?symbol=' + encodeURIComponent(syms) +
      '&apikey=' + encodeURIComponent(key), 12000).then(d => {
      WATCH.global.forEach(g => {
        const row = d[g.ticker];
        if (!row || row.close == null) return;
        const usd = parseFloat(row.close);
        state.items['gl:' + g.ticker] = {
          group: 'global', name: g.name, ticker: g.ticker,
          price: usd, rub: state.fx.USD ? usd * state.fx.USD : null, cur: 'USD', src: 'Twelve Data',
          change: row.percent_change != null ? parseFloat(row.percent_change) : null,
          extra: { 'Валюта': row.currency || 'USD' }, ts: Date.now()
        };
      });
    });
  }

  /* ---------- Основная загрузка ---------- */
  function loadAll(force) {
    const cached = get('priceCache', null);
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL) {
      state.items = cached.items || {};
      state.fx = cached.fx || state.fx;
      state.updated = cached.ts;
      setStatus('Из кэша · обновлено ' + new Date(cached.ts).toLocaleTimeString('ru-RU'), '');
      render();
      return Promise.resolve();
    }

    setStatus('Обновляю данные с Московской биржи…', 'loading');
    state.errors = [];
    const safe = fn => { try { return fn(); } catch (e) { return Promise.resolve(null); } };

    return Promise.all([
      safe(loadMoex).catch(() => { state.errors.push('MOEX недоступен'); }),
      safe(loadCBR).catch(() => { state.errors.push('ЦБ РФ недоступен'); })
    ])
      .then(() => safe(loadGlobal).catch(() => { state.errors.push('Twelve Data недоступен'); }))
      .then(() => {
        state.updated = Date.now();
        const got = Object.keys(state.items).length;
        if (got) {
          set('priceCache', { ts: state.updated, items: state.items, fx: state.fx });
          setStatus('Обновлено ' + new Date(state.updated).toLocaleTimeString('ru-RU') +
            ' · инструментов: ' + got + (state.errors.length ? ' · ' + state.errors.join(', ') : ''), 'ok');
        } else {
          const old = get('priceCache', null);
          if (old && old.items) { state.items = old.items; state.fx = old.fx || state.fx; }
          setStatus('Нет доступа к сети — показаны последние сохранённые данные. Любую цену можно ввести вручную.', 'warn');
        }
        render();
        global.Portfolio && global.Portfolio.refresh();
      });
  }

  function setStatus(text, kind) {
    state.status = text;
    const el = $('#marketStatus');
    if (el) { el.textContent = text; el.className = 'market-status ' + (kind || ''); }
  }

  /* ---------- Доступ к данным ---------- */
  /** Ищет инструмент по тикеру (для портфеля) */
  function livePriceByTicker(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return null;
    for (const k in state.items) {
      const it = state.items[k];
      if (it.ticker.toUpperCase() === t) {
        return { price: it.price, rub: it.rub, src: it.src, change: it.change, ts: it.ts, cur: it.cur, isBond: !!it.isBond };
      }
    }
    if (state.manual[t] != null && state.manual[t] !== '') {
      const p = parseFloat(state.manual[t]);
      if (isFinite(p)) return { price: p, rub: p, src: 'вручную', change: null, ts: null, cur: 'RUB' };
    }
    return null;
  }

  function groupOf(name) {
    return Object.keys(state.items).map(k => state.items[k]).filter(it => it.group === name);
  }

  /** Порядок как в списке наблюдения: индексы, акции, фонды, облигации по сроку */
  const DEFAULT_ORDER = [].concat(
    WATCH.indices.map(x => x.secid), WATCH.shares.map(x => x.secid),
    WATCH.funds.map(x => x.secid), WATCH.bonds.map(x => x.secid),
    WATCH.fx.map(x => x.code), WATCH.global.map(x => x.ticker)
  );
  function sortItems(items) {
    return items.slice().sort((a, b) => {
      if (a.isBond && b.isBond && a.bond && b.bond) {
        const am = a.bond.matDate || '9999', bm = b.bond.matDate || '9999';
        if (am !== bm) return am < bm ? -1 : 1;
      }
      const ai = DEFAULT_ORDER.indexOf(a.ticker.replace('/RUB', ''));
      const bi = DEFAULT_ORDER.indexOf(b.ticker.replace('/RUB', ''));
      const av = ai === -1 ? 999 : ai, bv = bi === -1 ? 999 : bi;
      if (av !== bv) return av - bv;
      return String(a.ticker).localeCompare(String(b.ticker));
    });
  }

  /* ---------- Отрисовка ---------- */
  function render() {
    renderTicker();
    renderGroups();
    const up = $('#marketUpdated');
    if (up && state.updated) up.textContent = new Date(state.updated).toLocaleString('ru-RU');
    global.Portfolio && global.Portfolio.refresh();
  }

  function fmtPrice(it) {
    if (it.price == null) return '—';
    if (it.cur === 'USD') return '$' + num(it.price, 2);
    const d = it.dec != null ? it.dec : 2;
    const suffix = it.isBond ? '%' : (it.isIndex ? '\u00A0п.' : '\u00A0₽');
    return num(it.price, d) + suffix;
  }

  function chgHtml(ch) {
    if (ch == null || !isFinite(ch)) return '<span class="muted">—</span>';
    const cls = ch >= 0 ? 'pos' : 'neg';
    return `<span class="${cls}">${ch >= 0 ? '+' : ''}${num(ch, 2)}%</span>`;
  }

  function renderTicker() {
    const box = $('#ticker');
    if (!box) return;
    const want = ['idx:IMOEX', 'idx:RGBI', 'sh:SBER', 'sh:GAZP', 'sh:LKOH', 'fx:USD', 'fx:CNY', 'sh:GOLD', 'sh:TMOS'];
    const items = want.map(k => state.items[k]).filter(Boolean).map(it => {
      const ch = it.change;
      const cls = ch == null ? '' : (ch >= 0 ? 'up' : 'down');
      const arrow = ch == null ? '' : (ch >= 0 ? '▲' : '▼');
      return `<span class="tick"><b>${esc(it.ticker)}</b> ${fmtPrice(it)}
        <i class="${cls}">${arrow}${ch == null ? '' : num(Math.abs(ch), 2) + '%'}</i></span>`;
    });
    box.innerHTML = items.length
      ? items.join('<span class="tick-sep">•</span>') + '<span class="tick-sep">•</span>' + items.join('<span class="tick-sep">•</span>')
      : 'Загружаю данные Московской биржи…';
  }

  function renderGroups() {
    const box = $('#marketGroups');
    if (!box) return;

    const order = ['indices', 'shares', 'funds', 'bonds', 'custom', 'global', 'fx'];
    let html = '';

    order.forEach(g => {
      const items = sortItems(groupOf(g));
      if (!items.length) return;
      html += `<h3 class="market-group-title">${esc(GROUP_TITLES[g])}</h3>`;
      if (g === 'bonds') html += renderBondTable(items);
      else if (g === 'indices') html += renderIndexTable(items);
      else html += renderSimpleTable(items, g);
    });

    if (!html) html = '<p class="muted" style="padding:20px">Данные ещё не загружены. Нажмите «Обновить данные».</p>';
    box.innerHTML = html;

    // ручной ввод цены
    $$('.manual-price', box).forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.key;
        const v = parseFloat(inp.value);
        if (isFinite(v) && v > 0) state.manual[k] = v; else delete state.manual[k];
        set('manualPrices', state.manual);
        render();
      });
    });
    // кнопка «в лесенку»
    $$('[data-ladder]', box).forEach(btn => {
      btn.addEventListener('click', () => {
        const it = state.items[btn.dataset.ladder];
        if (!it || !it.bond) return;
        const yieldEl = $('#lCoupon'), yearsEl = $('#lYears'), yearsR = $('#lYearsR');
        if (it.bond.yield != null && yieldEl) {
          yieldEl.value = numRaw(it.bond.yield, 2);
          yieldEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (it.bond.durYears != null && yearsEl) {
          const y = Math.max(2, Math.min(15, Math.round(it.bond.durYears)));
          yearsEl.value = y;
          if (yearsR) yearsR.value = y;
          yearsEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const ladder = $('#ladderBox');
        if (ladder) ladder.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  function numRaw(v, d) { return Number(v).toFixed(d); }

  function manualCell(key) {
    const v = state.manual[key] != null ? state.manual[key] : '';
    return `<input class="manual-price" data-key="${key}" type="number" step="any" inputmode="decimal"
      placeholder="вручную" value="${v}" aria-label="Своя цена">`;
  }

  function renderIndexTable(items) {
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Индекс</th><th class="num">Значение</th><th class="num">За день</th>
      <th class="num">За месяц</th><th class="num">С начала года</th><th>Диапазон за год</th><th>Источник</th></tr></thead>
      <tbody>${items.map(it => `<tr>
        <td><b>${esc(it.name)}</b><span class="row-sub">${esc(it.ticker)}</span></td>
        <td class="num"><b>${fmtPrice(it)}</b></td>
        <td class="num">${chgHtml(it.change)}</td>
        <td class="num">${chgHtml(it.extra['Изм. за месяц'])}</td>
        <td class="num">${chgHtml(it.extra['Изм. с начала года'])}</td>
        <td class="muted small">${esc(it.extra['Макс/мин за год'] || '—')}</td>
        <td class="muted small">${esc(it.src)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function renderSimpleTable(items, group) {
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Инструмент</th><th>Тикер</th><th class="num">Цена</th><th class="num">За день</th>
      <th>${group === 'fx' ? 'Источник' : 'Детали'}</th><th class="num">Своя цена</th></tr></thead>
      <tbody>${items.map(it => {
        const key = Object.keys(state.items).find(k => state.items[k] === it);
        const details = Object.keys(it.extra).filter(k => it.extra[k] != null)
          .map(k => `<span class="row-sub">${esc(k)}: ${esc(it.extra[k])}</span>`).join('') || '—';
        return `<tr>
          <td><b>${esc(it.name)}</b></td>
          <td><code>${esc(it.ticker)}</code></td>
          <td class="num"><b>${fmtPrice(it)}</b>${it.cur === 'USD' && it.rub ? `<span class="row-sub">${money(it.rub, '₽')}</span>` : ''}</td>
          <td class="num">${chgHtml(it.change)}</td>
          <td class="muted small">${group === 'fx' ? esc(it.src) : details}</td>
          <td class="num">${manualCell(key)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function renderBondTable(items) {
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>Выпуск</th><th>Тикер</th><th class="num">Цена, %</th><th class="num">Цена, ₽</th>
      <th class="num">НКД</th><th class="num">Купон</th><th class="num">Доходность</th>
      <th class="num">Погашение</th><th class="num">Дюрация</th><th>За день</th><th></th></tr></thead>
      <tbody>${items.map(it => {
        const key = Object.keys(state.items).find(k => state.items[k] === it);
        return `<tr>
          <td><b>${esc(it.name)}</b><span class="row-sub">номинал ${esc(it.extra['Номинал'])}</span></td>
          <td><code>${esc(it.ticker)}</code></td>
          <td class="num">${num(it.price, 3)}%</td>
          <td class="num"><b>${esc(it.extra['Цена, ₽'])}</b></td>
          <td class="num muted">${esc(it.extra['НКД'] || '—')}</td>
          <td class="num">${esc(it.extra['Купон'] || '—')}</td>
          <td class="num pos"><b>${esc(it.extra['Доходность'] || '—')}</b></td>
          <td class="num">${esc(it.extra['Погашение'] || '—')}</td>
          <td class="num">${esc(it.extra['Дюрация'] || '—')}</td>
          <td class="num">${chgHtml(it.change)}</td>
          <td><button class="btn small ghost" data-ladder="${key}" title="Подставить доходность и срок в конструктор лесенки">в лесенку</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <p class="hint">Цена облигации котируется в процентах от номинала: 52,7% при номинале 1 000 ₽ — это 527 ₽.
        Доходность — эффективная к погашению на текущий момент. Дюрация показывает чувствительность к ставке:
        падение ставки на 1 п.п. поднимает цену примерно на величину дюрации в процентах.
        К сумме покупки добавляется НКД — накопленный купонный доход продавцу.</p>`;
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
    const cusInput = $('#customTickers');
    if (cusInput) {
      cusInput.value = state.custom.join(', ');
      on($('#customSave'), 'click', () => {
        state.custom = cusInput.value.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
        set('customTickers', state.custom);
        setStatus('Список сохранён. Загружаю котировки…', 'loading');
        loadAll(true);
      });
    }
    on($('#marketRefresh'), 'click', () => { set('priceCache', null); loadAll(true); });
    render();
    loadAll(false);
    setInterval(() => { if (!document.hidden) loadAll(false); }, CACHE_TTL);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAll(false); });
  }

  global.Prices = { init, loadAll, livePriceByTicker, state, WATCH, render, renderGroups };
})(window);
