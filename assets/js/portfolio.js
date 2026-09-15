/* ============================================================
   portfolio.js — мой портфель, ребалансировка, план покупок
   Данные хранятся в localStorage браузера.
   ============================================================ */
(function (global) {
  'use strict';

  const { $, $$, on, num, money, pct, esc, get, set, valNum, animateNum } = global.U;
  const DATA = global.APP_DATA;

  let rows = get('portfolio', []);

  function uid() { return Math.random().toString(36).slice(2, 9); }

  function save() {
    set('portfolio', rows);
  }

  /* ---------- Цена строки ---------- */
  function resolvePrice(r) {
    const live = global.Prices ? global.Prices.livePriceByTicker(r.ticker) : null;
    if (live && live.rub != null) return { price: live.rub, src: live.src, live: true };
    if (r.price != null && r.price !== '' && isFinite(parseFloat(r.price))) {
      return { price: parseFloat(r.price), src: 'вручную', live: false };
    }
    const b = parseFloat(r.buy);
    if (isFinite(b)) return { price: b, src: 'цена покупки', live: false };
    return { price: 0, src: '—', live: false };
  }

  function compute() {
    const list = rows.map(r => {
      const p = resolvePrice(r);
      const qty = parseFloat(r.qty) || 0;
      const buy = parseFloat(r.buy) || 0;
      const value = qty * p.price;
      const cost = qty * buy;
      return Object.assign({}, r, {
        _price: p.price, _src: p.src, _live: p.live,
        _qty: qty, _buy: buy, _value: value, _cost: cost,
        _pnl: value - cost,
        _pnlPct: cost ? (value - cost) / cost * 100 : 0
      });
    });
    const total = list.reduce((s, r) => s + r._value, 0);
    const cost = list.reduce((s, r) => s + r._cost, 0);
    const targetSum = list.reduce((s, r) => s + (parseFloat(r.target) || 0), 0);
    list.forEach(r => {
      r._share = total ? r._value / total * 100 : 0;
      r._target = parseFloat(r.target) || 0;
      r._targetValue = total * r._target / 100;
      r._delta = r._targetValue - r._value;
      r._shareDev = r._share - r._target;
    });
    return { list, total, cost, pnl: total - cost, pnlPct: cost ? (total - cost) / cost * 100 : 0, targetSum };
  }

  /* ---------- Отрисовка ---------- */
  function render() {
    const tb = $('#pfBody');
    if (!tb) return;
    const c = compute();

    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="10" class="empty-row">Портфель пуст. Добавьте активы вручную или загрузите модельный портфель.</td></tr>`;
    } else {
      tb.innerHTML = c.list.map(r => {
        const devCls = Math.abs(r._shareDev) < 3 ? 'muted' : (r._shareDev > 0 ? 'pos' : 'neg');
        const act = Math.abs(r._delta) < Math.max(1000, c.total * 0.005)
          ? '<span class="muted">в норме</span>'
          : (r._delta > 0
            ? `<span class="pos">докупить ${money(r._delta, '₽')}</span>`
            : `<span class="neg">сократить ${money(-r._delta, '₽')}</span>`);
        return `<tr data-id="${r.id}">
          <td><input class="pf-in pf-name" data-f="name" value="${esc(r.name || '')}" placeholder="Название"></td>
          <td><input class="pf-in pf-tick" data-f="ticker" value="${esc(r.ticker || '')}" placeholder="Тикер"></td>
          <td><input class="pf-in num" data-f="qty" type="number" step="any" value="${r.qty != null ? esc(r.qty) : ''}" placeholder="0"></td>
          <td><input class="pf-in num" data-f="buy" type="number" step="any" value="${r.buy != null ? esc(r.buy) : ''}" placeholder="0"></td>
          <td><input class="pf-in num ${r._live ? 'is-live' : ''}" data-f="price" type="number" step="any"
                     value="${r.price != null && r.price !== '' ? esc(r.price) : ''}"
                     placeholder="${r._price ? num(r._price, 2) : 'цена'}"></td>
          <td class="num"><b>${r._value ? money(r._value, '₽') : '—'}</b>
              <span class="row-sub">${r._src === 'вручную' ? 'цена вручную' : esc(r._src)}</span></td>
          <td class="num"><input class="pf-in num" data-f="target" type="number" step="any" value="${r.target != null ? esc(r.target) : ''}" placeholder="0">
              <span class="row-sub ${devCls}">${r._share ? num(r._share, 1) + '%' : '—'}</span></td>
          <td class="num ${r._pnl >= 0 ? 'pos' : 'neg'}">${r._cost ? money(r._pnl, '₽') : '—'}
              <span class="row-sub">${r._cost ? (r._pnl >= 0 ? '+' : '') + num(r._pnlPct, 1) + '%' : ''}</span></td>
          <td class="act">${act}</td>
          <td><button class="icon-btn del" data-del="${r.id}" title="Удалить">✕</button></td>
        </tr>`;
      }).join('');
    }

    animateNum($('#pfTotal'), c.total, v => money(v, '₽'));
    animateNum($('#pfCost'), c.cost, v => money(v, '₽'));
    animateNum($('#pfPnl'), c.pnl, v => money(v, '₽'));
    animateNum($('#pfPnlPct'), c.pnlPct, v => (v >= 0 ? '+' : '') + pct(v));

    const tw = $('#pfTargetWarn');
    if (tw) {
      let msg = '';
      if (!rows.length) {
        tw.className = 'hint';
      } else if (Math.abs(c.targetSum - 100) > 0.5) {
        tw.className = 'hint warn';
        msg = `Сумма целевых долей = ${num(c.targetSum, 1)}%. Для корректной ребалансировки нужна ровно 100%.`;
      } else {
        tw.className = 'hint ok';
        msg = 'Сумма целевых долей = 100%. Ребалансировка считается корректно.';
      }
      if (rows.length && c.total === 0) {
        msg += (msg ? ' ' : '') + 'Текущие цены пока неизвестны — впишите их в колонку «Текущая цена» ' +
          'или укажите тикер из котировок Мосбиржи (SBER, GAZP, TMOS, GOLD, SU26238RMFS4).';
        if (tw.className === 'hint ok') tw.className = 'hint';
      }
      tw.textContent = msg;
    }

    const dn = $('#pfDonut');
    if (dn) {
      const items = c.list.filter(r => r._value > 0).map((r, i) => ({
        label: r.name || r.ticker || ('Актив ' + (i + 1)),
        value: Math.round(r._share),
        color: ['#22c55e', '#7dd3fc', '#facc15', '#a3a3a3', '#86efac', '#34d399', '#60a5fa', '#f472b6'][i % 8]
      }));
      global.Charts.donut(dn, {
        height: 240, items,
        centerTitle: global.U.short(c.total),
        centerSub: '₽ всего'
      });
    }

    bindRows();
    renderPlan(c);
  }

  function bindRows() {
    const tb = $('#pfBody');
    if (!tb) return;
    $$('.pf-in', tb).forEach(inp => {
      inp.addEventListener('change', () => {
        const tr = inp.closest('tr');
        const id = tr && tr.dataset.id;
        const r = rows.find(x => x.id === id);
        if (!r) return;
        const f = inp.dataset.f;
        r[f] = inp.value;
        save();
        render();
      });
    });
    $$('.del', tb).forEach(b => {
      b.addEventListener('click', () => {
        rows = rows.filter(x => x.id !== b.dataset.del);
        save(); render();
      });
    });
  }

  /* ---------- План покупок на взнос ---------- */
  function renderPlan(c) {
    const box = $('#pfPlan');
    if (!box) return;
    box.dataset.total = c.total;
    const box2 = box;
    box2._c = c;
  }

  function buildPlan() {
    const c = compute();
    const contrib = valNum($('#pfContribution'), 50000);
    const box = $('#pfPlan');
    if (!rows.length) {
      box.innerHTML = '<p class="muted">Добавьте активы и целевые доли — и получите готовый план покупок на взнос.</p>';
      return;
    }
    const newTotal = c.total + contrib;
    const deficits = c.list.map(r => {
      const need = newTotal * (r._target / 100) - r._value;
      return { r, need: Math.max(0, need) };
    });
    const sumDef = deficits.reduce((s, d) => s + d.need, 0);
    let alloc;
    if (sumDef <= 0) {
      // все доли выше целевых — распределяем по целевым весам
      const sumW = c.list.reduce((s, r) => s + (r._target || 0), 0) || 1;
      alloc = c.list.map(r => ({ r, amount: contrib * (r._target || 0) / sumW, note: 'доли в норме — распределение по целевым весам' }));
    } else {
      alloc = deficits.filter(d => d.need > 0).map(d => ({
        r: d.r, amount: contrib * d.need / sumDef,
        note: `отставание от цели ${money(d.need, '₽')}`
      }));
    }
    const usable = alloc.filter(a => a.amount >= 100);
    box.innerHTML = `
      <div class="plan-head">Взнос ${money(contrib, '₽')} распределяется в отстающие активы:</div>
      <table class="table compact">
        <thead><tr><th>Актив</th><th class="num">Купить на</th><th class="num">Кол-во</th><th>Почему</th></tr></thead>
        <tbody>${usable.map(a => `<tr>
          <td><b>${esc(a.r.name || a.r.ticker || '—')}</b></td>
          <td class="num"><b>${money(a.amount, '₽')}</b></td>
          <td class="num">${a.r._price > 0 ? num(a.amount / a.r._price, a.r._price > 1000 ? 2 : 0) : '—'}</td>
          <td class="muted small">${esc(a.note)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <p class="hint">Это механическая ребалансировка: покупка отстающих активов вместо продажи выросших. Налог не возникает.</p>`;
  }

  /* ---------- Модельные портфели ---------- */
  function loadModel(key) {
    const p = DATA.PORTFOLIOS.find(x => x.key === key);
    if (!p) return;
    rows = p.assets.map(a => ({
      id: uid(), name: a.name, ticker: a.ticker.includes('индекс') || a.ticker.length > 12 ? '' : a.ticker,
      qty: '', buy: '', price: '', target: a.w
    }));
    save(); render();
  }

  /* ---------- Экспорт / импорт ---------- */
  function exportJSON() {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'portfolio.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJSON(text) {
    try {
      const d = JSON.parse(text);
      if (!Array.isArray(d)) throw new Error('Ожидался массив');
      rows = d.map(r => Object.assign({ id: uid() }, r));
      save(); render();
      return true;
    } catch (e) { return false; }
  }

  function init() {
    const sel = $('#pfModel');
    if (sel) {
      sel.innerHTML = '<option value="">— модельный портфель —</option>' +
        DATA.PORTFOLIOS.map(p => `<option value="${p.key}">${esc(p.name)} · ${esc(p.subtitle)}</option>`).join('');
      on(sel, 'change', () => { if (sel.value) { loadModel(sel.value); sel.value = ''; } });
    }
    on($('#pfAdd'), 'click', () => {
      rows.push({ id: uid(), name: '', ticker: '', qty: '', buy: '', price: '', target: '' });
      save(); render();
    });
    on($('#pfPlanBtn'), 'click', buildPlan);
    on($('#pfExport'), 'click', exportJSON);
    on($('#pfImportBtn'), 'click', () => $('#pfImportFile') && $('#pfImportFile').click());
    on($('#pfImportFile'), 'change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const ok = importJSON(String(rd.result));
        alert(ok ? 'Портфель загружен.' : 'Не удалось прочитать файл.');
      };
      rd.readAsText(f);
    });
    on($('#pfClear'), 'click', () => {
      if (confirm('Удалить все позиции портфеля? Действие необратимо.')) { rows = []; save(); render(); }
    });
    on($('#pfContribution'), 'input', () => { if ($('#pfPlan').innerHTML) buildPlan(); });

    render();
  }

  global.Portfolio = { init, refresh: render, getRows: () => rows };
})(window);
