/* ============================================================
   app.js — сборка страницы, навигация, тест, чек-лист, бэкап
   ============================================================ */
(function (global) {
  'use strict';

  const { $, $$, on, num, money, pct, esc, get, set, clearAll } = global.U;
  const D = global.APP_DATA;

  /* ---------- Правила ---------- */
  function renderRules() {
    const box = $('#rulesGrid');
    if (!box) return;
    box.innerHTML = D.RULES.map(r => `
      <article class="card rule reveal">
        <div class="rule-top"><span class="rule-n">${r.n}</span><span class="chip">${esc(r.tag)}</span></div>
        <h3>${esc(r.t)}</h3>
        <p>${esc(r.d)}</p>
      </article>`).join('');
  }

  /* ---------- Дорожная карта ---------- */
  function renderRoadmap() {
    const box = $('#roadmap');
    if (!box) return;
    box.innerHTML = D.PHASES.map((p, i) => `
      <article class="phase reveal" style="--phase:${p.color}">
        <div class="phase-line">
          <span class="phase-dot"></span>
          <span class="phase-num">Фаза ${i}</span>
        </div>
        <div class="phase-body card">
          <header class="phase-head">
            <div>
              <span class="chip years">${esc(p.years)}</span>
              <h3>${esc(p.title)}</h3>
              <p class="phase-goal">${esc(p.goal)}</p>
            </div>
            <button class="ghost-btn phase-toggle" aria-expanded="false">Развернуть</button>
          </header>
          <div class="phase-targets">
            ${p.targets.map(t => `<span class="target">${esc(t)}</span>`).join('')}
          </div>
          <div class="phase-more" hidden>
            <div class="phase-cols">
              <div>
                <h4><span class="ico">🛒</span> Что покупать</h4>
                <ul class="list">${p.buy.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
              </div>
              <div>
                <h4><span class="ico">⚙️</span> Что делать</h4>
                <ul class="list">${p.actions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
              </div>
            </div>
            <div class="phase-rule"><b>Правило фазы:</b> ${esc(p.rule)}</div>
          </div>
        </div>
      </article>`).join('');

    $$('.phase-toggle', box).forEach(btn => {
      btn.addEventListener('click', () => {
        const art = btn.closest('.phase');
        const more = $('.phase-more', art);
        const open = !more.hidden;
        more.hidden = open;
        btn.textContent = open ? 'Развернуть' : 'Свернуть';
        btn.setAttribute('aria-expanded', String(!open));
      });
    });
    // первая фаза открыта
    const first = $('.phase-more', box);
    if (first) {
      first.hidden = false;
      const b = $('.phase-toggle', box);
      if (b) { b.textContent = 'Свернуть'; b.setAttribute('aria-expanded', 'true'); }
    }
  }

  /* ---------- Портфели ---------- */
  let activePortfolio = 'balanced';

  function renderPortfolioTabs() {
    const tabs = $('#portfolioTabs');
    if (!tabs) return;
    tabs.innerHTML = D.PORTFOLIOS.map(p =>
      `<button class="tab ${p.key === activePortfolio ? 'active' : ''}" data-p="${p.key}" role="tab">${esc(p.name)}</button>`
    ).join('');
    $$('.tab', tabs).forEach(b => on(b, 'click', () => {
      activePortfolio = b.dataset.p;
      renderPortfolioTabs();
      renderPortfolioBody();
    }));
  }

  function renderPortfolioBody() {
    const p = D.PORTFOLIOS.find(x => x.key === activePortfolio);
    const box = $('#portfolioBody');
    const meta = $('#portfolioMeta');
    if (!p || !box) return;

    box.innerHTML = `
      <table class="table portfolio-table">
        <thead><tr><th>Класс актива</th><th>Инструмент</th><th class="num">Доля</th><th class="num">На 1 млн ₽</th></tr></thead>
        <tbody>
          ${p.assets.map(a => `<tr>
            <td><span class="dot-cls" style="background:${D.CLASS_COLORS[a.cls]}"></span>${esc(a.name)}</td>
            <td class="muted">${esc(a.ticker)}</td>
            <td class="num"><b>${a.w}%</b></td>
            <td class="num">${money(a.w * 10000, '₽')}</td>
          </tr>`).join('')}
          <tr class="total-row"><td colspan="2">Итого</td><td class="num">100%</td><td class="num">1 000 000 ₽</td></tr>
        </tbody>
      </table>`;

    if (meta) {
      meta.innerHTML = `
        <div class="meta-grid">
          <div><span class="meta-k">Горизонт</span><span class="meta-v">${esc(p.horizon)}</span></div>
          <div><span class="meta-k">Просадка, которую надо пережить</span><span class="meta-v neg">${esc(p.drawdown)}</span></div>
          <div><span class="meta-k">Ожидаемая доходность</span><span class="meta-v pos">${esc(p.expect)}</span></div>
        </div>
        <p class="muted">${esc(p.comment)}</p>`;
    }

    const byClass = {};
    p.assets.forEach(a => { byClass[a.cls] = (byClass[a.cls] || 0) + a.w; });
    global.Charts.donut($('#portfolioChart'), {
      height: 260,
      items: Object.keys(byClass).map(k => ({
        label: D.CLASS_NAMES[k], value: byClass[k], color: D.CLASS_COLORS[k]
      })),
      centerTitle: p.name,
      centerSub: 'доли классов'
    });
  }

  function renderPortfolioCompare() {
    const box = $('#compareTable');
    if (!box) return;
    const classes = ['equity', 'bond', 'fx', 'gold', 'cash'];
    const head = `<thead><tr><th>Класс</th>${D.PORTFOLIOS.map(p => `<th class="num">${esc(p.name)}</th>`).join('')}</tr></thead>`;
    const body = classes.map(c => {
      const cells = D.PORTFOLIOS.map(p => {
        const w = p.assets.filter(a => a.cls === c).reduce((s, a) => s + a.w, 0);
        return `<td class="num">${w ? w + '%' : '—'}</td>`;
      }).join('');
      return `<tr><td><span class="dot-cls" style="background:${D.CLASS_COLORS[c]}"></span>${esc(D.CLASS_NAMES[c])}</td>${cells}</tr>`;
    }).join('');
    const dd = `<tr class="muted"><td>Просадка</td>${D.PORTFOLIOS.map(p => `<td class="num">${esc(p.drawdown)}</td>`).join('')}</tr>`;
    box.innerHTML = `<table class="table">${head}<tbody>${body}${dd}</tbody></table>`;
  }

  /* ---------- Методы покупки ---------- */
  function renderMethods() {
    const box = $('#methodsGrid');
    if (!box) return;
    box.innerHTML = D.METHODS.map(m => `
      <article class="card method reveal">
        <h3>${esc(m.t)}</h3>
        <p class="method-s">${esc(m.s)}</p>
        <p>${esc(m.how)}</p>
        <div class="method-rows">
          <div class="mr plus"><span>+</span>${esc(m.plus)}</div>
          <div class="mr minus"><span>−</span>${esc(m.minus)}</div>
        </div>
        <div class="method-use"><b>Когда:</b> ${esc(m.use)}</div>
      </article>`).join('');
  }

  /* ---------- Светофор ---------- */
  function renderSignals() {
    const box = $('#signalTable');
    if (!box) return;
    box.innerHTML = `
      <table class="table signal-table">
        <thead><tr><th>Индикатор</th><th>Что смотрим</th><th class="good">Хорошо</th><th class="neut">Нейтрально</th><th class="bad">Плохо</th></tr></thead>
        <tbody>${D.SIGNALS.map(s => `<tr>
          <td><b>${esc(s.name)}</b></td>
          <td class="muted small">${esc(s.metric)}</td>
          <td class="good small">${esc(s.good)}</td>
          <td class="neut small">${esc(s.neutral)}</td>
          <td class="bad small">${esc(s.bad)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  /* ---------- Просадки ---------- */
  function renderDrawdown() {
    const box = $('#drawdownTable');
    if (!box) return;
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>Падение</th><th>Как это называется</th><th>Что делать</th><th class="num">Взнос</th><th>Что вы будете чувствовать</th></tr></thead>
        <tbody>${D.DRAWDOWN_TABLE.map(d => `<tr>
          <td><b class="neg">${esc(d.drop)}</b></td>
          <td>${esc(d.name)}</td>
          <td>${esc(d.action)}</td>
          <td class="num"><b class="pos">${esc(d.contrib)}</b></td>
          <td class="muted small">${esc(d.emotion)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  }

  /* ---------- Чек-лист ---------- */
  function renderChecklist() {
    const box = $('#checklist');
    if (!box) return;
    const saved = get('checklist', {});
    box.innerHTML = D.CHECKLIST.map((t, i) => `
      <label class="check ${saved[i] ? 'done' : ''}">
        <input type="checkbox" data-i="${i}" ${saved[i] ? 'checked' : ''}>
        <span class="check-box"></span>
        <span class="check-text">${esc(t)}</span>
      </label>`).join('');
    const upd = () => {
      const st = {};
      $$('input[type=checkbox]', box).forEach(c => { st[c.dataset.i] = c.checked; c.closest('.check').classList.toggle('done', c.checked); });
      set('checklist', st);
      const done = Object.values(st).filter(Boolean).length;
      const p = $('#checkProgress');
      if (p) p.style.setProperty('--p', (done / D.CHECKLIST.length * 100) + '%');
      const pc = $('#checkProgressCount');
      if (pc) pc.textContent = done + ' / ' + D.CHECKLIST.length;
    };
    $$('input[type=checkbox]', box).forEach(c => on(c, 'change', upd));
    upd();
  }

  /* ---------- Тест риск-профиля ---------- */
  function renderQuiz() {
    const box = $('#quizBox');
    if (!box) return;
    box.innerHTML = D.QUIZ.map((q, qi) => `
      <div class="quiz-q" data-q="${qi}">
        <p class="quiz-title"><span>${qi + 1}</span>${esc(q.q)}</p>
        <div class="quiz-opts">
          ${q.a.map((a, ai) => `<label class="quiz-opt">
            <input type="radio" name="q${qi}" value="${a.s}" data-q="${qi}">
            <span>${esc(a.t)}</span>
          </label>`).join('')}
        </div>
      </div>`).join('') + `
      <div class="quiz-actions">
        <button class="btn primary" id="quizRun">Показать результат</button>
        <button class="btn ghost" id="quizReset">Сбросить</button>
      </div>
      <div id="quizResult" class="quiz-result" hidden></div>`;

    on($('#quizRun'), 'click', () => {
      let sum = 0, answered = 0;
      D.QUIZ.forEach((_, qi) => {
        const sel = box.querySelector(`input[name="q${qi}"]:checked`);
        if (sel) { sum += parseFloat(sel.value); answered++; }
      });
      const res = $('#quizResult');
      res.hidden = false;
      if (answered < D.QUIZ.length) {
        res.className = 'quiz-result warn';
        res.innerHTML = `<b>Ответьте на все вопросы.</b> Отвечено ${answered} из ${D.QUIZ.length}.`;
        return;
      }
      let key, label, advice;
      if (sum <= 13) {
        key = 'conservative'; label = 'Консервативный профиль';
        advice = 'Ваш приоритет — сохранность. Начните с 30–40% акций и не увеличивайте, пока не переживёте первую просадку спокойно.';
      } else if (sum <= 20) {
        key = 'balanced'; label = 'Умеренный профиль';
        advice = 'Классические 60/40 — ваш вариант. Этого достаточно для цели за 15–20 лет при норме сбережений 25%+.';
      } else if (sum <= 26) {
        key = 'aggressive'; label = 'Агрессивный профиль';
        advice = 'Вы способны держать 80% акций. Обязательно проверьте себя на просадке −50% в деньгах: посмотрите на сумму в калькуляторе.';
      } else {
        key = 'aggressive'; label = 'Агрессивный профиль (высокая устойчивость)';
        advice = 'Вы готовы к максимальному риску. Всё равно оставьте 10% золота и кэш-буфер — они нужны не для доходности, а для возможности покупать в кризис.';
      }
      const p = D.PORTFOLIOS.find(x => x.key === key);
      res.className = 'quiz-result ok';
      res.innerHTML = `
        <div class="quiz-score">${sum} / 30 баллов</div>
        <h3>${esc(label)}</h3>
        <p>${esc(advice)}</p>
        <p class="muted">Рекомендуемая модель: <b>${esc(p.name)}</b> — ${esc(p.subtitle)}.
          Ожидаемая просадка: <b class="neg">${esc(p.drawdown)}</b>.</p>
        <button class="btn primary" id="quizApply">Подставить в «Мой портфель»</button>`;
      on($('#quizApply'), 'click', () => {
        const sel = $('#pfModel');
        if (sel) { sel.value = key; sel.dispatchEvent(new Event('change')); }
        location.hash = '#portfolio-mine';
      });
    });
    on($('#quizReset'), 'click', () => {
      $$('input[type=radio]', box).forEach(r => { r.checked = false; });
      $('#quizResult').hidden = true;
    });
  }

  /* ---------- Литература ---------- */
  function renderBooks() {
    const box = $('#booksGrid');
    if (!box) return;
    box.innerHTML = D.BOOKS.map(b => `
      <article class="card book reveal">
        <span class="book-a">${esc(b.a)}</span>
        <h3>${esc(b.t)}</h3>
        <p>${esc(b.w)}</p>
      </article>`).join('');
  }

  /* ---------- Навигация, анимации, прочее ---------- */
  function initNav() {
    const nav = $('#mainNav');
    const toggle = $('#navToggle');
    on(toggle, 'click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? '✕' : '☰';
    });
    $$('#mainNav a').forEach(a => on(a, 'click', () => {
      nav.classList.remove('open');
      if (toggle) { toggle.textContent = '☰'; toggle.setAttribute('aria-expanded', 'false'); }
    }));

    const links = $$('#mainNav a');
    const sections = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id));
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      sections.forEach(s => io.observe(s));
    }

    const progress = $('#readProgress');
    const onScroll = () => {
      const h = document.documentElement;
      const p = h.scrollTop / (h.scrollHeight - h.clientHeight) * 100;
      if (progress) progress.style.width = Math.max(0, Math.min(100, p)) + '%';
      const top = $('#toTop');
      if (top) top.classList.toggle('show', h.scrollTop > 800);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    on($('#toTop'), 'click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    // подсветка активного раздела в оглавлении "темы"
    const secTabs = $$('.sec-tab');
    secTabs.forEach(t => on(t, 'click', () => {
      const el = document.querySelector(t.dataset.target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function initReveal() {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal').forEach(el => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    $$('.reveal').forEach(el => io.observe(el));
  }

  function initTabs() {
    const tabs = $$('.calc-tab');
    tabs.forEach(t => on(t, 'click', () => {
      tabs.forEach(x => x.classList.toggle('active', x === t));
      $$('.calc-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + t.dataset.calc));
      if (t.dataset.calc === 'monte') global.Calc.renderMonte();
      if (t.dataset.calc === 'fees') global.Calc.renderFees();
      set('activeCalcTab', t.dataset.calc);
    }));
    const saved = get('activeCalcTab', 'capital');
    const st = tabs.find(t => t.dataset.calc === saved);
    if (st) st.click();
  }

  function initBackup() {
    on($('#btnExportAll'), 'click', () => {
      const data = { app: 'invest-memo', version: 1, exported: new Date().toISOString(), storage: global.U.load() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'invest-memo-backup.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    on($('#btnImportAll'), 'click', () => $('#fileImportAll') && $('#fileImportAll').click());
    on($('#fileImportAll'), 'change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(String(rd.result));
          if (d && d.storage) { global.U.save(d.storage); location.reload(); }
          else alert('Неверный формат файла.');
        } catch (err) { alert('Не удалось прочитать файл.'); }
      };
      rd.readAsText(f);
    });
    on($('#btnPrint'), 'click', () => window.print());
    on($('#btnReset'), 'click', () => {
      if (confirm('Сбросить все данные сайта: портфель, калькуляторы, чек-лист?')) {
        clearAll();
        location.reload();
      }
    });
  }

  function initHero() {
    // анимированные цифры в hero
    $$('[data-count]').forEach(el => {
      const to = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      global.U.animateNum(el, to, v => num(v, el.dataset.dec ? parseInt(el.dataset.dec, 10) : 0) + suffix, 900);
    });
    const y = $('#heroYear');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  /* ---------- Старт ---------- */
  function start() {
    renderRules();
    renderRoadmap();
    renderPortfolioTabs();
    renderPortfolioBody();
    renderPortfolioCompare();
    renderMethods();
    renderSignals();
    renderDrawdown();
    renderChecklist();
    renderQuiz();
    renderBooks();
    initHero();
    initNav();
    initTabs();
    initBackup();
    global.Calc.init();
    global.Portfolio.init();
    global.Prices.init();
    initReveal();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
