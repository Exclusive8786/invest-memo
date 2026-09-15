/* ============================================================
   calc.js — финансовая математика и калькуляторы
   ============================================================ */
(function (global) {
  'use strict';

  const { $, valNum, money, pct, num, short, animateNum } = global.U;
  const D = global.APP_DATA.DEFAULTS;

  /* =================  МАТЕМАТИКА  ================= */

  /**
   * Накопление с ежемесячными взносами.
   * Взнос в начале месяца, реинвест всего.
   */
  function growth(o) {
    const months = Math.round(o.years * 12);
    const rNet = (o.ret - (o.fee || 0)) / 100;
    const rm = Math.pow(1 + rNet, 1 / 12) - 1;
    const infl = o.inflation / 100;
    const contribIdx = (o.index || 0) / 100;

    let bal = o.start || 0;
    let contrib = o.start || 0;
    let monthly = o.monthly || 0;
    const rows = [];
    rows.push({
      year: 0, contributed: contrib, nominal: bal,
      real: bal, gain: 0, monthly: monthly
    });

    for (let m = 1; m <= months; m++) {
      bal += monthly;
      contrib += monthly;
      bal *= (1 + rm);
      if (m % 12 === 0) {
        const y = m / 12;
        rows.push({
          year: y,
          contributed: contrib,
          nominal: bal,
          real: bal / Math.pow(1 + infl, y),
          gain: bal - contrib,
          monthly: monthly
        });
        monthly *= (1 + contribIdx);
      }
    }
    const last = rows[rows.length - 1];
    return {
      rows,
      contributed: last.contributed,
      nominal: last.nominal,
      real: last.real,
      gain: last.nominal - last.contributed,
      multiple: last.contributed ? last.nominal / last.contributed : 0
    };
  }

  /** Нужный капитал под заданный месячный доход */
  function capitalForIncome(o) {
    const infl = o.inflation / 100;
    const annualNeedFuture = o.targetMonthly * 12 * Math.pow(1 + infl, o.years);
    const gross = annualNeedFuture / (1 - (o.tax || 0) / 100);
    const capital = gross / (o.withdrawal / 100);
    return {
      annualNeedFuture,
      grossAnnual: gross,
      capital,
      capitalToday: capital / Math.pow(1 + infl, o.years),
      multipleOfExpenses: 1 / (o.withdrawal / 100)
    };
  }

  /** Подбор месячного взноса под цель (бисекция по симуляции) */
  function requiredMonthly(o) {
    let lo = 0, hi = 1e8;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const g = growth({ start: o.start || 0, monthly: mid, years: o.years, ret: o.ret, fee: o.fee || 0, inflation: o.inflation, index: o.index || 0 });
      if (g.nominal < o.target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Монте-Карло */
  function monteCarlo(o) {
    const runs = Math.min(20000, Math.max(200, Math.round(o.runs || 3000)));
    const years = Math.max(1, Math.round(o.years));
    const months = years * 12;
    const muA = o.ret / 100;
    const sigA = (o.vol || 15) / 100;
    const rm = Math.pow(1 + muA, 1 / 12) - 1;
    const sm = sigA / Math.sqrt(12);
    const lump = o.mode === 'lump';
    const lumpSum = lump ? (o.start || 0) + (o.monthly || 0) * months : 0;

    const cols = [];
    for (let y = 0; y <= years; y++) cols.push(new Float64Array(runs));
    const finals = new Float64Array(runs);
    let contributedTotal = 0;

    // генератор нормальных чисел (Box-Muller)
    let spare = null;
    function gauss() {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0, s = 0;
      do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
      const mul = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * mul;
      return u * mul;
    }

    for (let r = 0; r < runs; r++) {
      let bal = o.start || 0;
      let contrib = o.start || 0;
      if (lump) { bal = lumpSum; contrib = lumpSum; }
      cols[0][r] = bal;
      for (let m = 1; m <= months; m++) {
        if (!lump) { bal += o.monthly || 0; contrib += o.monthly || 0; }
        bal *= (1 + rm + sm * gauss());
        if (bal < 0) bal = 0;
        if (m % 12 === 0) cols[m / 12][r] = bal;
      }
      finals[r] = bal;
      contributedTotal = contrib;
    }

    function pick(arr, p) {
      const a = Float64Array.from(arr);
      a.sort();
      const idx = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
      return a[idx];
    }
    const yearsArr = [], p10 = [], p50 = [], p90 = [];
    for (let y = 0; y <= years; y++) {
      yearsArr.push(y);
      p10.push(pick(cols[y], 0.10));
      p50.push(pick(cols[y], 0.50));
      p90.push(pick(cols[y], 0.90));
    }
    let below = 0, half = 0;
    finals.forEach(v => { if (v < contributedTotal) below++; if (v < contributedTotal * 0.6) half++; });
    const fSorted = Float64Array.from(finals); fSorted.sort();
    const mean = Array.prototype.reduce.call(finals, (a, b) => a + b, 0) / runs;

    return {
      years: yearsArr, p10, p50, p90, runs,
      contributed: contributedTotal,
      finalP10: p10[years], finalP50: p50[years], finalP90: p90[years],
      mean,
      probBelowContrib: below / runs * 100,
      probDeepLoss: half / runs * 100,
      multiple: contributedTotal ? p50[years] / contributedTotal : 0
    };
  }

  /** Лесенка облигаций (buy & hold, равные ступени) */
  function bondLadder(o) {
    const N = Math.max(1, Math.min(20, Math.round(o.years)));
    const amount = o.amount;
    const c = o.coupon / 100;
    const par = amount / N;
    const rows = [];
    let totalCoupon = 0;
    const cash = [];
    for (let i = 1; i <= N; i++) {
      const couponYear = par * c;
      const couponLife = couponYear * i;
      totalCoupon += couponLife;
      rows.push({
        step: i, year: i, par: par, couponYear: couponYear,
        couponLife: couponLife, yieldToMaturity: o.coupon
      });
    }
    for (let t = 1; t <= N; t++) {
      const alive = N - t + 1;
      const coupon = par * c * alive;
      cash.push({ year: t, coupon: coupon, principal: par, total: coupon + par });
    }
    const avgTerm = (N + 1) / 2;
    const annualAvg = totalCoupon / N;
    return {
      rows, cash, N, par,
      totalCoupon,
      avgTerm,
      totalReturn: amount + totalCoupon,
      yieldAvg: amount ? (totalCoupon / amount / avgTerm * 100) : 0,
      annualAvg,
      incomeStart: amount * c
    };
  }

  /** Влияние комиссии */
  function feeImpact(o) {
    const a = growth({ start: o.start, monthly: o.monthly, years: o.years, ret: o.ret, fee: o.fee1, inflation: 0, index: 0 });
    const b = growth({ start: o.start, monthly: o.monthly, years: o.years, ret: o.ret, fee: o.fee2, inflation: 0, index: 0 });
    const diff = a.nominal - b.nominal;
    /* доля потерь считается от того капитала, который был бы без высокой комиссии */
    return { a: a.nominal, b: b.nominal, diff, diffPct: a.nominal ? diff / a.nominal * 100 : 0 };
  }

  /* =================  ОТРИСОВКА  ================= */

  /* --- Капитал --- */
  function readCapital() {
    return {
      start: valNum($('#cStart'), D.start),
      monthly: valNum($('#cMonthly'), D.monthly),
      index: valNum($('#cIndex'), 0),
      years: valNum($('#cYears'), D.years),
      ret: valNum($('#cRet'), D.ret),
      inflation: valNum($('#cInfl'), D.inflation),
      fee: valNum($('#cFee'), D.fee)
    };
  }

  function renderCapital() {
    const o = readCapital();
    const g = growth(o);
    const cur = $('#cCurrency') ? $('#cCurrency').value : '₽';

    animateNum($('#cOutNom'), g.nominal, v => money(v, cur));
    animateNum($('#cOutReal'), g.real, v => money(v, cur));
    animateNum($('#cOutContrib'), g.contributed, v => money(v, cur));
    animateNum($('#cOutGain'), g.gain, v => money(v, cur));
    animateNum($('#cOutMult'), g.multiple, v => num(v, 2) + '×');

    const realContrib = o.monthly * 12 * o.years; // грубая оценка без индексации
    const geEl = $('#cGainExplain');
    if (geEl) {
      geEl.innerHTML = `Из итога <b>${money(g.nominal, cur)}</b> вы внесли <b>${money(g.contributed, cur)}</b>,
        а рынок добавил <b>${money(g.gain, cur)}</b> — это <b>${pct(g.contributed ? g.gain / g.nominal * 100 : 0)}</b> капитала.
        В сегодняшних деньгах (инфляция ${pct(o.inflation)}) это <b>${money(g.real, cur)}</b>.`;
    }

    global.Charts.line($('#cChart'), {
      height: 300,
      series: [
        { name: 'Номинал', color: '#22c55e', points: g.rows.map(r => [r.year, r.nominal]) },
        { name: 'В сегодняшних деньгах', color: '#7dd3fc', points: g.rows.map(r => [r.year, r.real]) }
      ],
      yFmt: v => short(v),
      yFmtFull: v => money(v, cur),
      xFmt: v => Math.round(v) + ' г.',
      xFmtFull: v => 'Год ' + Math.round(v)
    });

    const tb = $('#cTable');
    if (tb) {
      tb.innerHTML = g.rows.map(r => {
        const y = r.year;
        if (y % (g.rows.length > 26 ? 2 : 1) !== 0) return '';
        return `<tr>
          <td>${y}</td>
          <td>${money(r.monthly, cur)}</td>
          <td>${money(r.contributed, cur)}</td>
          <td><b>${money(r.nominal, cur)}</b></td>
          <td class="muted">${money(r.real, cur)}</td>
          <td class="pos">${money(r.gain, cur)}</td>
        </tr>`;
      }).join('');
    }
    saveState({ capital: o });
    return g;
  }

  /* --- Доход --- */
  function readIncome() {
    return {
      targetMonthly: valNum($('#iTarget'), 150000),
      years: valNum($('#iYears'), 18),
      inflation: valNum($('#iInfl'), D.inflation),
      withdrawal: valNum($('#iWithdraw'), 4),
      tax: valNum($('#iTax'), 13),
      ret: valNum($('#iRet'), D.ret),
      fee: valNum($('#iFee'), D.fee),
      index: valNum($('#iIndex'), 0)
    };
  }

  function renderIncome() {
    const o = readIncome();
    const cur = $('#iCurrency') ? $('#iCurrency').value : '₽';
    const c = capitalForIncome(o);

    animateNum($('#iOutCapital'), c.capital, v => money(v, cur));
    animateNum($('#iOutToday'), c.capitalToday, v => money(v, cur));
    animateNum($('#iOutAnnual'), c.grossAnnual, v => money(v, cur));
    animateNum($('#iOutMultiple'), c.multipleOfExpenses, v => num(v, 1) + '×');

    const need = requiredMonthly({
      start: valNum($('#iStart'), 100000),
      years: o.years, ret: o.ret, fee: o.fee, inflation: o.inflation, index: o.index,
      target: c.capital
    });
    const have = valNum($('#iMonthly'), D.monthly);
    animateNum($('#iOutNeed'), need, v => money(v, cur));

    const gap = need - have;
    const v = $('#iOutVerdict');
    if (v) {
      if (gap <= 0) {
        v.className = 'verdict ok';
        v.innerHTML = `<b>План сходится.</b> При взносе ${money(have, cur)} в месяц вы выходите на цель с запасом
          ${money(-gap, cur)}/мес. Можно снизить риск: доходность ${pct(o.ret)} в этом расчёте — оптимистичное допущение.`;
      } else {
        v.className = 'verdict warn';
        v.innerHTML = `<b>Не хватает ${money(gap, cur)} в месяц.</b> Варианты: поднять взнос, продлить срок на
          ${Math.max(1, Math.round(o.years * 0.15))} лет, повысить норму сбережений или снизить целевой доход.
          Ждать «удачного года» — не вариант.`;
      }
    }

    const proj = growth({
      start: valNum($('#iStart'), 100000), monthly: have, years: o.years,
      ret: o.ret, fee: o.fee, inflation: o.inflation, index: o.index
    });
    global.Charts.line($('#iChart'), {
      height: 300,
      series: [
        { name: 'Ваш прогноз', color: '#22c55e', points: proj.rows.map(r => [r.year, r.nominal]) },
        { name: 'Нужно для цели', color: '#facc15', points: proj.rows.map(r => [r.year, c.capital]), dash: '6 6', area: false }
      ],
      yFmt: v2 => short(v2),
      yFmtFull: v2 => money(v2, cur),
      xFmt: v2 => Math.round(v2) + ' г.',
      xFmtFull: v2 => 'Год ' + Math.round(v2)
    });
    saveState({ income: o });
    return { c, need, have, proj };
  }

  /* --- Монте-Карло --- */
  function renderMonte() {
    const o = {
      start: valNum($('#mStart'), 100000),
      monthly: valNum($('#mMonthly'), D.monthly),
      years: valNum($('#mYears'), 18),
      ret: valNum($('#mRet'), D.ret),
      vol: valNum($('#mVol'), 15),
      runs: valNum($('#mRuns'), 3000),
      mode: $('#mMode') ? $('#mMode').value : 'dca'
    };
    const cur = '₽';
    const r = monteCarlo(o);

    global.Charts.fan($('#mChart'), {
      height: 340, years: r.years, p10: r.p10, p50: r.p50, p90: r.p90
    });

    animateNum($('#mP10'), r.finalP10, v => money(v, cur));
    animateNum($('#mP50'), r.finalP50, v => money(v, cur));
    animateNum($('#mP90'), r.finalP90, v => money(v, cur));
    animateNum($('#mContrib'), r.contributed, v => money(v, cur));
    animateNum($('#mProbLoss'), r.probBelowContrib, v => pct(v));

    const n = $('#mNote');
    if (n) {
      n.innerHTML = `<b>${num(r.runs, 0)}</b> симуляций, волатильность ${pct(o.vol)}.
        В медианном сценарии капитал <b>${money(r.finalP50, cur)}</b> — это <b>${num(r.multiple, 2)}×</b> от внесённого.
        В плохих 10% случаев (сценарий «затяжной кризис») — <b>${money(r.finalP10, cur)}</b>.
        Вероятность, что через ${num(o.years, 0)} лет капитал окажется <b>меньше внесённого</b> — <b>${pct(r.probBelowContrib)}</b>.
        ${o.mode === 'lump'
          ? 'Режим «Всё сразу»: вся сумма вносится в первый месяц.'
          : 'Режим «Усреднение»: равные взносы каждый месяц.'}`;
    }
    saveState({ monte: o });
    return r;
  }

  /* --- Издержки --- */
  function renderFees() {
    const o = {
      start: valNum($('#fStart'), 100000),
      monthly: valNum($('#fMonthly'), D.monthly),
      years: valNum($('#fYears'), 18),
      ret: valNum($('#fRet'), D.ret),
      fee1: valNum($('#fFee1'), 0.15),
      fee2: valNum($('#fFee2'), 1.5)
    };
    const r = feeImpact(o);
    animateNum($('#fOutA'), r.a, v => money(v, '₽'));
    animateNum($('#fOutB'), r.b, v => money(v, '₽'));
    animateNum($('#fDiff'), r.diff, v => money(v, '₽'));
    animateNum($('#fDiffPct'), r.diffPct, v => pct(v));
    global.Charts.bars($('#fChart'), {
      height: 260,
      showValue: true,
      yFmt: v => short(v),
      items: [
        { label: 'Комиссия ' + num(o.fee1, 2) + '%', value: r.a, color: '#22c55e' },
        { label: 'Комиссия ' + num(o.fee2, 2) + '%', value: r.b, color: '#f87171' }
      ]
    });
    saveState({ fees: o });
    return r;
  }

  /* --- Лесенка --- */
  function renderLadder() {
    const o = {
      amount: valNum($('#lAmount'), 3000000),
      years: valNum($('#lYears'), 5),
      coupon: valNum($('#lCoupon'), 15),
      reinvest: valNum($('#lReinvest'), 12)
    };
    const r = bondLadder(o);
    animateNum($('#lOutPar'), r.par, v => money(v, '₽'));
    animateNum($('#lOutCoupon'), r.annualAvg, v => money(v, '₽'));
    animateNum($('#lOutTotalCoupon'), r.totalCoupon, v => money(v, '₽'));
    animateNum($('#lOutAvgTerm'), r.avgTerm, v => num(v, 1) + ' лет');

    const tb = $('#lTable');
    if (tb) {
      tb.innerHTML = r.rows.map(row => `<tr>
        <td>${row.step}</td>
        <td>${row.year}</td>
        <td>${money(row.par, '₽')}</td>
        <td>${money(row.couponYear, '₽')}</td>
        <td class="pos">${money(row.couponLife, '₽')}</td>
      </tr>`).join('');
    }
    global.Charts.bars($('#lChart'), {
      height: 300,
      yFmt: v => short(v),
      items: r.cash.map(c => ({
        label: c.year + ' г.',
        value: c.total,
        color: c.year === r.N ? '#facc15' : '#22c55e'
      }))
    });
    const note = $('#lNote');
    if (note) {
      note.innerHTML = `Лесенка на <b>${num(r.N, 0)}</b> ступеней, по <b>${money(r.par, '₽')}</b> в каждой.
        Средний срок до погашения — <b>${num(r.avgTerm, 1)} года</b>: именно он определяет чувствительность к ставке.
        Каждый год гасится одна ступень, и деньги можно реинвестировать под текущую ставку
        (в расчёте заложено ${pct(o.reinvest)}). За полный цикл купоны дадут <b>${money(r.totalCoupon, '₽')}</b>
        — это <b>${pct(o.amount ? r.totalCoupon / o.amount * 100 : 0)}</b> от вложенной суммы.`;
    }
    saveState({ ladder: o });
    return r;
  }

  /* --- Сохранение состояния всех калькуляторов --- */
  let stateTimer = null;
  function saveState(patch) {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      const s = global.U.get('calc', {});
      s.capital = readCapital();
      s.income = readIncome();
      s.fees = { start: valNum($('#fStart'), D.start), monthly: valNum($('#fMonthly'), D.monthly), years: valNum($('#fYears'), D.years), ret: valNum($('#fRet'), D.ret), fee1: valNum($('#fFee1'), 0.15), fee2: valNum($('#fFee2'), 1.5) };
      s.ladder = { amount: valNum($('#lAmount'), 3000000), years: valNum($('#lYears'), 5), coupon: valNum($('#lCoupon'), 15), reinvest: valNum($('#lReinvest'), 12) };
      s.monte = { start: valNum($('#mStart'), D.start), monthly: valNum($('#mMonthly'), D.monthly), years: valNum($('#mYears'), D.years), ret: valNum($('#mRet'), D.ret), vol: valNum($('#mVol'), 15), runs: valNum($('#mRuns'), 3000), mode: $('#mMode') ? $('#mMode').value : 'dca' };
      global.U.set('calc', s);
    }, 400);
  }

  function restoreState() {
    const s = global.U.get('calc', null);
    if (!s) return;
    const put = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
    if (s.capital) { put('#cStart', s.capital.start); put('#cMonthly', s.capital.monthly); put('#cIndex', s.capital.index); put('#cYears', s.capital.years); put('#cRet', s.capital.ret); put('#cInfl', s.capital.inflation); put('#cFee', s.capital.fee); }
    if (s.income) { put('#iTarget', s.income.targetMonthly); put('#iYears', s.income.years); put('#iInfl', s.income.inflation); put('#iWithdraw', s.income.withdrawal); put('#iTax', s.income.tax); put('#iRet', s.income.ret); put('#iFee', s.income.fee); put('#iIndex', s.income.index); }
    if (s.fees) { put('#fStart', s.fees.start); put('#fMonthly', s.fees.monthly); put('#fYears', s.fees.years); put('#fRet', s.fees.ret); put('#fFee1', s.fees.fee1); put('#fFee2', s.fees.fee2); }
    if (s.ladder) { put('#lAmount', s.ladder.amount); put('#lYears', s.ladder.years); put('#lCoupon', s.ladder.coupon); put('#lReinvest', s.ladder.reinvest); }
    if (s.monte) { put('#mStart', s.monte.start); put('#mMonthly', s.monte.monthly); put('#mYears', s.monte.years); put('#mRet', s.monte.ret); put('#mVol', s.monte.vol); put('#mRuns', s.monte.runs); if ($('#mMode')) $('#mMode').value = s.monte.mode || 'dca'; }
    syncRanges();
  }

  /** Синхронизация ползунков и полей */
  function bindPair(rangeId, numId, onChange) {
    const r = $(rangeId), n = $(numId);
    if (r && n) {
      r.addEventListener('input', () => { n.value = r.value; onChange(); });
      n.addEventListener('input', () => { r.value = n.value; onChange(); });
    } else if (n) {
      n.addEventListener('input', onChange);
    }
  }
  function bindAll(rangeId, numId, onChange) {
    const n = $(numId);
    if (n) n.addEventListener('input', onChange);
    const r = $(rangeId);
    if (r) r.addEventListener('input', () => { if (n) n.value = r.value; onChange(); });
  }
  function syncRanges() {
    [['#cYearsR', '#cYears'], ['#cRetR', '#cRet'], ['#iYearsR', '#iYears'], ['#iWithdrawR', '#iWithdraw'],
     ['#mYearsR', '#mYears'], ['#mVolR', '#mVol'], ['#fYearsR', '#fYears'], ['#lYearsR', '#lYears']]
      .forEach(([r, n]) => { const R = $(r), N = $(n); if (R && N) R.value = N.value; });
    syncLabels();
  }

  /** Подписи-значения рядом с ползунками: input#cYears -> b#cYearsV */
  function syncLabels() {
    global.U.$$('input[id], select[id]').forEach(el => {
      const l = $('#' + el.id + 'V');
      if (l) l.textContent = el.value;
    });
  }

  function debounce(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms || 160); };
  }

  function init() {
    restoreState();
    const rc = debounce(renderCapital, 120);
    const ri = debounce(renderIncome, 120);
    const rf = debounce(renderFees, 120);
    const rl = debounce(renderLadder, 120);

    ['#cStart', '#cMonthly', '#cIndex', '#cFee'].forEach(id => {
      const el = $(id); if (el) el.addEventListener('input', rc);
    });
    bindPair('#cYearsR', '#cYears', rc);
    bindPair('#cRetR', '#cRet', rc);
    const ci = $('#cInfl'); if (ci) ci.addEventListener('input', rc);

    ['#iTarget', '#iInfl', '#iTax', '#iRet', '#iFee', '#iIndex', '#iStart', '#iMonthly'].forEach(id => {
      const el = $(id); if (el) el.addEventListener('input', ri);
    });
    bindPair('#iYearsR', '#iYears', ri);
    bindPair('#iWithdrawR', '#iWithdraw', ri);

    ['#mStart', '#mMonthly', '#mRet', '#mRuns'].forEach(id => {
      const el = $(id); if (el) el.addEventListener('input', debounce(renderMonte, 200));
    });
    bindPair('#mYearsR', '#mYears', debounce(renderMonte, 200));
    bindPair('#mVolR', '#mVol', debounce(renderMonte, 200));
    const mm = $('#mMode'); if (mm) mm.addEventListener('change', renderMonte);
    const mr = $('#mRun'); if (mr) mr.addEventListener('click', () => renderMonte());

    ['#fStart', '#fMonthly', '#fRet', '#fFee1', '#fFee2'].forEach(id => {
      const el = $(id); if (el) el.addEventListener('input', rf);
    });
    bindPair('#fYearsR', '#fYears', rf);

    ['#lAmount', '#lCoupon', '#lReinvest'].forEach(id => {
      const el = $(id); if (el) el.addEventListener('input', rl);
    });
    bindPair('#lYearsR', '#lYears', rl);

    renderCapital(); renderIncome(); renderFees(); renderLadder(); renderMonte();

    // единая точка обновления подписей ползунков
    document.addEventListener('input', e => {
      const t = e.target;
      if (t && t.id) {
        const l = $('#' + t.id + 'V');
        if (l) l.textContent = t.value;
      }
    });
    syncLabels();

    global.U.onResize(() => {
      renderCapital(); renderIncome(); renderFees(); renderLadder(); renderMonte();
    });
  }

  global.Calc = {
    growth, capitalForIncome, requiredMonthly, monteCarlo, bondLadder, feeImpact,
    renderCapital, renderIncome, renderMonte, renderFees, renderLadder, init
  };
})(window);
