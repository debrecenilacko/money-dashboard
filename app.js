// Pénztárkönyv — frontend logic.
// Talks only to the Cloudflare Worker (never to Notion directly). The Worker
// URL + APP_TOKEN are entered once and kept in localStorage on the device.

(function () {
  'use strict';

  var CONFIG_KEY = 'pk_config';

  var els = {
    setup: document.getElementById('setup'),
    apiBaseInput: document.getElementById('apiBaseInput'),
    tokenInput: document.getElementById('tokenInput'),
    setupSave: document.getElementById('setupSave'),
    setupError: document.getElementById('setupError'),
    loading: document.getElementById('loading'),
    error: document.getElementById('error'),
    app: document.getElementById('app'),
    generatedAt: document.getElementById('generatedAt'),
    refreshBtn: document.getElementById('refreshBtn'),
    verdictNum: document.getElementById('verdictNum'),
    verdictLabel: document.getElementById('verdictLabel'),
    verdictRows: document.getElementById('verdictRows'),
    advice: document.getElementById('advice'),
    rateValue: document.getElementById('rateValue'),
    rateFill: document.getElementById('rateFill'),
    tiles: document.getElementById('tiles'),
    trendSvg: document.getElementById('trendSvg'),
    ledger: document.getElementById('ledger'),
    budgets: document.getElementById('budgets'),
    splitBar: document.getElementById('splitBar'),
    splitLegend: document.getElementById('splitLegend'),
    accounts: document.getElementById('accounts'),
    savingsAccounts: document.getElementById('savingsAccounts'),
    goals: document.getElementById('goals'),
    loanTotals: document.getElementById('loanTotals'),
    loans: document.getElementById('loans'),
    cashSummary: document.getElementById('cashSummary'),
    cashEntries: document.getElementById('cashEntries'),
    cashForm: document.getElementById('cashForm'),
    cashPerson: document.getElementById('cashPerson'),
    cashKind: document.getElementById('cashKind'),
    cashAmount: document.getElementById('cashAmount'),
    cashNote: document.getElementById('cashNote'),
    cashSubmit: document.getElementById('cashSubmit'),
    cashMsg: document.getElementById('cashMsg'),
    todoSteps: document.getElementById('todoSteps'),
    todoSaving: document.getElementById('todoSaving'),
    todoSell: document.getElementById('todoSell'),
    titheTiles: document.getElementById('titheTiles'),
    titheNote: document.getElementById('titheNote'),
    cutSlider: document.getElementById('cutSlider'),
    cutValue: document.getElementById('cutValue'),
    outBalance: document.getElementById('outBalance'),
    outRunway: document.getElementById('outRunway'),
    outYearly: document.getElementById('outYearly')
  };

  var latestData = null;

  // ---- config -----------------------------------------------------------
  function loadConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      if (!cfg || !cfg.apiBase || !cfg.token) return null;
      return cfg;
    } catch (e) {
      return null;
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {
      // localStorage unavailable — config just won't persist across loads.
    }
  }

  function clearConfig() {
    try { localStorage.removeItem(CONFIG_KEY); } catch (e) {}
  }

  function showSetup(message) {
    els.setup.hidden = false;
    els.loading.hidden = true;
    els.error.hidden = true;
    els.app.hidden = true;
    if (message) {
      els.setupError.textContent = message;
      els.setupError.hidden = false;
    } else {
      els.setupError.hidden = true;
    }
    var cfg = loadConfig();
    if (cfg) {
      els.apiBaseInput.value = cfg.apiBase;
    }
  }

  els.setupSave.addEventListener('click', function () {
    var apiBase = els.apiBaseInput.value.trim().replace(/\/+$/, '');
    var token = els.tokenInput.value.trim();
    if (!apiBase || !token) {
      els.setupError.textContent = 'Mindkét mező kötelező.';
      els.setupError.hidden = false;
      return;
    }
    saveConfig({ apiBase: apiBase, token: token });
    els.setup.hidden = true;
    loadDashboard();
  });

  // ---- tabs ---------------------------------------------------------------
  var TAB_KEY = 'pk_tab';
  function activateTab(tabName) {
    var panels = document.querySelectorAll('.hd-tab-panel');
    for (var i = 0; i < panels.length; i++) {
      panels[i].classList.toggle('active', panels[i].getAttribute('data-tab') === tabName);
    }
    var btnGroups = [document.querySelectorAll('#hdTabs .hd-tab-btn'), document.querySelectorAll('#hdBottomNav .hd-nav-btn')];
    btnGroups.forEach(function (btns) {
      for (var j = 0; j < btns.length; j++) {
        btns[j].classList.toggle('active', btns[j].getAttribute('data-tab') === tabName);
      }
    });
    try { localStorage.setItem(TAB_KEY, tabName); } catch (e) {}
  }

  function initTabs() {
    var buttons = document.querySelectorAll('#hdTabs .hd-tab-btn, #hdBottomNav .hd-nav-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (ev) {
        activateTab(ev.currentTarget.getAttribute('data-tab'));
        window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      });
    }
    var saved = null;
    try { saved = localStorage.getItem(TAB_KEY); } catch (e) {}
    activateTab(saved || 'attekintes');
  }
  initTabs();

  // ---- formatting helpers ------------------------------------------------
  function fmtFt(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('hu-HU') + ' Ft';
  }

  function fmtSigned(n) {
    if (n == null || isNaN(n)) return '—';
    var r = Math.round(n);
    if (r > 0) return '+' + r.toLocaleString('hu-HU') + ' Ft';
    if (r < 0) return '−' + Math.abs(r).toLocaleString('hu-HU') + ' Ft';
    return '0 Ft';
  }

  function fmtPct(n, digits) {
    if (n == null || isNaN(n)) return '—';
    var v = n.toFixed(digits == null ? 1 : digits).replace('.', ',');
    return (n > 0 ? '+' : '') + v + '%';
  }

  var MONTHS_HU = ['jan', 'feb', 'már', 'ápr', 'máj', 'jún', 'júl', 'aug', 'sze', 'okt', 'nov', 'dec'];
  function fmtMonthLabel(ym) {
    if (!ym) return '';
    var parts = ym.split('-');
    var m = parseInt(parts[1], 10) - 1;
    return MONTHS_HU[m] || ym;
  }

  function fmtGeneratedAt(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var datePart = d.toLocaleDateString('hu-HU');
    var timePart = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
    return 'frissítve: ' + datePart + ' ' + timePart;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- fetch + orchestration --------------------------------------------
  function loadDashboard() {
    var cfg = loadConfig();
    if (!cfg) {
      showSetup();
      return;
    }
    els.loading.hidden = false;
    els.error.hidden = true;
    els.app.hidden = true;
    els.setup.hidden = true;

    fetch(cfg.apiBase + '/api/dashboard', {
      headers: { Authorization: 'Bearer ' + cfg.token }
    })
      .then(function (res) {
        if (res.status === 401) {
          throw { kind: 'auth' };
        }
        if (!res.ok) {
          throw { kind: 'http', status: res.status };
        }
        return res.json();
      })
      .then(function (data) {
        latestData = data;
        render(data);
        els.loading.hidden = true;
        els.error.hidden = true;
        els.app.hidden = false;
      })
      .catch(function (err) {
        els.loading.hidden = true;
        if (err && err.kind === 'auth') {
          clearConfig();
          showSetup('Hibás vagy lejárt APP_TOKEN — add meg újra.');
          return;
        }
        els.app.hidden = true;
        els.error.hidden = false;
        els.error.textContent = 'Nem sikerült betölteni az adatokat. Ellenőrizd a Worker URL-t, a tokent, és hogy van-e internet. (' +
          (err && err.kind === 'http' ? 'HTTP ' + err.status : (err && err.message ? err.message : 'ismeretlen hiba')) + ')';
      });
  }

  els.refreshBtn.addEventListener('click', function () {
    loadDashboard();
  });

  // ---- render -------------------------------------------------------------
  function render(data) {
    els.generatedAt.textContent = fmtGeneratedAt(data.generatedAt);
    renderVerdict(data);
    renderAdvice(data.advice || []);
    renderRate(data.savingsRatePct);
    renderTiles(data.verdict);
    renderTrend(data.trend || []);
    renderLedger(data.categories || []);
    renderBudgets(data.budgets);
    renderSplit(data.split);
    renderAccounts(els.accounts, data.accounts || [], 'Nincs feltöltött számla a Notion &bdquo;Számlák&rdquo; adatbázisban.');
    renderAccounts(els.savingsAccounts, data.savingsAccounts || [], 'Még nincs feltöltve megtakarítási / befektetési számla — vedd fel a Notion &bdquo;Számlák&rdquo; adatbázisában (pl. IBKR, TBSZ, Lakástakarékpénztár).');
    renderGoals(data.netWorth);
    renderLoans(data.loans);
    renderCash(data.cash);
    renderTodos(data.todos);
    renderTithe(data.giving, data.verdict);
    renderWhatIf(data.verdict);
  }

  function renderVerdict(data) {
    var v = data.verdict || {};
    var core = v.deficitCore;
    var isSurplus = core != null && core > 0;
    els.verdictNum.textContent = fmtSigned(core);
    els.verdictNum.classList.toggle('pos', !!isSurplus);
    if (core == null) {
      els.verdictLabel.textContent = 'Még nincs elég lezárt havi adat az átlaghoz.';
    } else if (isSurplus) {
      els.verdictLabel.textContent = 'Átlagosan ennyi marad havonta a bevételből a core (nem egyszeri) kiadások után, az elmúlt lezárt hónapok alapján.';
    } else {
      els.verdictLabel.textContent = 'Átlagosan ennyivel megy többe a core (nem egyszeri) kiadás a bevételnél, havonta, az elmúlt lezárt hónapok alapján.';
    }

    var rows = [
      ['átlagos bevétel', fmtFt(v.avgIncome), null],
      ['átlagos kiadás (nyers)', fmtFt(v.avgRawExpense), null],
      ['ebből egyszeri', fmtFt(v.avgOneOff), null],
      ['egyenleg egyszerikkel együtt', fmtSigned(v.deficitRaw), v.deficitRaw > 0 ? 'pos' : 'neg'],
      ['ismert egyenleg (számlák)', fmtFt(v.knownBalance), null]
    ];
    els.verdictRows.innerHTML = rows.map(function (r) {
      var valClass = 'v' + (r[2] ? ' ' + r[2] : '');
      return '<div class="verdict-row"><span class="k">' + r[0] + '</span><span class="' + valClass + '">' + r[1] + '</span></div>';
    }).join('');
  }

  function renderAdvice(advice) {
    if (!els.advice) return;
    if (!advice.length) { els.advice.innerHTML = ''; return; }
    var icons = { warn: '⚠️', praise: '🎉', info: 'ℹ️' };
    els.advice.innerHTML = advice.map(function (a) {
      return '<div class="advice-card ' + esc(a.type) + '"><span class="ic">' + (icons[a.type] || 'ℹ️') + '</span><span>' + esc(a.text) + '</span></div>';
    }).join('');
  }

  function renderRate(pct) {
    if (pct == null || isNaN(pct)) {
      els.rateValue.textContent = '—';
      els.rateValue.classList.remove('pos', 'neg');
      els.rateFill.style.left = '50%';
      els.rateFill.style.width = '0%';
      return;
    }
    els.rateValue.textContent = fmtPct(pct);
    els.rateValue.classList.toggle('pos', pct >= 0);
    els.rateValue.classList.toggle('neg', pct < 0);

    var clamped = Math.max(-30, Math.min(30, pct));
    var pos = ((clamped + 30) / 60) * 100; // 0..100 over the −30..+30 track
    var zero = 50;
    var left = Math.min(pos, zero);
    var width = Math.abs(zero - pos);
    els.rateFill.style.left = left + '%';
    els.rateFill.style.width = width + '%';
    els.rateFill.classList.toggle('pos', pct >= 0);
    els.rateFill.classList.toggle('neg', pct < 0);
  }

  function renderTiles(v) {
    v = v || {};
    var tiles = [
      { label: 'bevétel (átlag)', value: v.avgIncome, cls: 'income' },
      { label: 'core kiadás (átlag)', value: v.avgCoreExpense, cls: 'expense' },
      { label: 'egyszeri (átlag)', value: v.avgOneOff, cls: '' }
    ];
    els.tiles.innerHTML = tiles.map(function (t) {
      return '<div class="tile ' + t.cls + '"><div class="t-label">' + t.label + '</div><div class="t-value">' + fmtFt(t.value) + '</div></div>';
    }).join('');
  }

  function renderTrend(trend) {
    var svg = els.trendSvg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!trend.length) {
      var msg = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      msg.setAttribute('x', '350');
      msg.setAttribute('y', '110');
      msg.setAttribute('text-anchor', 'middle');
      msg.setAttribute('class', 'axislabel');
      msg.textContent = 'Még nincs elég lezárt havi adat.';
      svg.appendChild(msg);
      return;
    }

    var padL = 46, padR = 20, top = 16, base = 178, labelY = 202;
    var maxVal = 1;
    trend.forEach(function (t) {
      maxVal = Math.max(maxVal, t.inc || 0, t.exp || 0, t.core || 0);
    });
    // round maxVal up to a clean-ish ceiling for nicer gridlines
    var magnitude = Math.pow(10, Math.floor(Math.log(maxVal) / Math.LN10));
    maxVal = Math.ceil(maxVal / (magnitude / 2)) * (magnitude / 2);

    var n = trend.length;
    var xStep = n > 1 ? (700 - padL - padR) / (n - 1) : 0;
    var x = function (i) { return n > 1 ? padL + i * xStep : (padL + (700 - padL - padR) / 2); };
    var y = function (v) { return base - ((v || 0) / maxVal) * (base - top); };

    var ns = 'http://www.w3.org/2000/svg';
    function el(tag, attrs) {
      var e = document.createElementNS(ns, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }

    // gridlines + axis labels (0%, 50%, 100% of maxVal)
    [0, 0.5, 1].forEach(function (f) {
      var gy = base - f * (base - top);
      svg.appendChild(el('line', { x1: padL, x2: 700 - padR, y1: gy, y2: gy, class: 'gridline' }));
      var lbl = el('text', { x: padL - 8, y: gy + 3, class: 'axislabel', 'text-anchor': 'end' });
      lbl.textContent = Math.round((maxVal * f) / 1000).toLocaleString('hu-HU') + 'E';
      svg.appendChild(lbl);
    });

    function path(key, cls) {
      var d = trend.map(function (t, i) {
        return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(t[key]).toFixed(1);
      }).join(' ');
      svg.appendChild(el('path', { d: d, class: cls }));
    }
    path('exp', 'line-expense');
    path('core', 'line-core');
    path('inc', 'line-income');

    trend.forEach(function (t, i) {
      svg.appendChild(el('circle', { cx: x(i), cy: y(t.exp), r: 4, class: 'dot exp' }));
      svg.appendChild(el('circle', { cx: x(i), cy: y(t.core), r: 3.5, class: 'dot core' }));
      svg.appendChild(el('circle', { cx: x(i), cy: y(t.inc), r: 4, class: 'dot inc' }));
      var lbl = el('text', { x: x(i), y: labelY, class: 'monthlabel' });
      lbl.textContent = fmtMonthLabel(t.label);
      svg.appendChild(lbl);
    });
  }

  function renderLedger(categories) {
    if (!categories.length) {
      els.ledger.innerHTML = '<div class="ledger-row"><span class="cat-name" style="color:var(--ink-3)">Nincs adat a kiválasztott időszakra.</span><span class="cat-amt"></span></div>';
      return;
    }
    els.ledger.innerHTML = categories.map(function (c) {
      var badge = c.mostlyOneOff ? '<span class="oneoff-badge">egyszeri</span>' : '';
      return '<div class="ledger-row"><span class="cat-name">' + esc(c.name) + badge + '</span><span class="cat-amt">' + fmtFt(c.amount) + '</span></div>';
    }).join('');
  }

  function budgetCard(label, spent, cap, dayOfMonth, daysInMonth) {
    var pct = cap > 0 ? (spent / cap) * 100 : 0;
    var pace = daysInMonth > 0 ? (dayOfMonth / daysInMonth) * 100 : 0;
    var color = pct >= 100 ? 'var(--expense)' : (pct >= 70 ? 'var(--gold)' : 'var(--income)');
    var barWidth = Math.min(100, pct);
    var pctLabel = cap > 0 ? Math.round(pct) + '%' : '—';
    var paceNote = cap > 0
      ? (pct > pace + 10 ? 'a hónap ' + Math.round(pace) + '%-ánál tartunk, de már ' + Math.round(pct) + '%-nál a keretnek — gyorsabban fogy, mint kéne'
        : 'a hónap ' + Math.round(pace) + '%-ánál tartunk')
      : 'nincs beállítva keret';
    return '<div class="budget-card">' +
      '<div class="budget-head"><span>' + label + '</span><span class="budget-pct">' + pctLabel + '</span></div>' +
      '<div class="budget-track"><div class="budget-fill" style="width:' + barWidth + '%;background:' + color + '"></div></div>' +
      '<div class="budget-foot"><span>' + fmtFt(spent) + ' / ' + (cap > 0 ? fmtFt(cap) : '—') + '</span><span>' + paceNote + '</span></div>' +
      '</div>';
  }

  function renderBudgets(budgets) {
    if (!budgets) { els.budgets.innerHTML = ''; return; }
    els.budgets.innerHTML =
      budgetCard('élelmiszer', budgets.food.spent, budgets.food.cap, budgets.dayOfMonth, budgets.daysInMonth) +
      budgetCard('vendéglátás / egyéb vásárlás', budgets.flex.spent, budgets.flex.cap, budgets.dayOfMonth, budgets.daysInMonth);
  }

  function renderSplit(split) {
    if (!split) { els.splitBar.innerHTML = ''; els.splitLegend.innerHTML = ''; return; }
    var total = (split.fix || 0) + (split.variable || 0) + (split.other || 0);
    if (total <= 0) {
      els.splitBar.innerHTML = '';
      els.splitLegend.innerHTML = '<span style="color:var(--ink-3)">Nincs elég adat.</span>';
      return;
    }
    var segs = [
      ['fix', 'fix (rezsi, hiteltörlesztés, lakhatás, biztosítás, előfizetések)', split.fix],
      ['var', 'rugalmas (élelmiszer, vendéglátás, autó, egészség)', split.variable],
      ['other', 'egyéb (tized, adomány, megtakarítás, ajándék, utazás, ...)', split.other]
    ];
    els.splitBar.innerHTML = segs.map(function (s) {
      var pct = (s[2] / total) * 100;
      return pct > 0 ? '<div class="split-seg ' + s[0] + '" style="width:' + pct + '%"></div>' : '';
    }).join('');
    els.splitLegend.innerHTML = segs.map(function (s) {
      var pct = Math.round((s[2] / total) * 100);
      return '<span><i class="' + s[0] + '"></i>' + s[1] + ' — ' + pct + '%</span>';
    }).join('');
  }

  function renderAccounts(target, accounts, emptyMsg) {
    if (!target) return;
    if (!accounts.length) {
      target.innerHTML = '<div class="acct-card" style="color:var(--ink-3)">' + emptyMsg + '</div>';
      return;
    }
    target.innerHTML = accounts.map(function (a) {
      var dateStr = a.date ? new Date(a.date).toLocaleDateString('hu-HU') : '—';
      var note = a.note ? '<div class="acct-note">' + esc(a.note) + '</div>' : '';
      return '<div class="acct-card">' +
        '<div class="acct-name">' + esc(a.name) + (a.bank ? ' &middot; ' + esc(a.bank) : '') + '</div>' +
        '<div class="acct-value">' + fmtFt(a.balance) + '</div>' +
        '<div class="acct-date">frissítve: ' + dateStr + '</div>' +
        note +
        '</div>';
    }).join('');
  }

  function renderGoals(netWorth) {
    var rows = (netWorth && netWorth.rows) || [];
    if (!rows.length) {
      els.goals.innerHTML =
        '<div class="goal-card" style="margin-bottom:10px;">' +
        '<div class="goal-name">FIRE</div>' +
        'Még nincs adat a Notion &bdquo;Nettó vagyon&rdquo; adatbázisban — tölts fel legalább egy vagyon- és célértéket, hogy itt megjelenjen a haladás.' +
        '</div>' +
        '<div class="goal-card">' +
        '<div class="goal-name">Kurjancs</div>' +
        'Még nincs meghatározva célösszeg ehhez.' +
        '</div>';
      return;
    }
    var latest = rows[0];
    var pct = (latest.goal && latest.goal > 0) ? (latest.netWorth / latest.goal) * 100 : null;
    els.goals.innerHTML =
      '<div class="goal-card">' +
      '<div class="goal-name">FIRE</div>' +
      'Nettó vagyon: ' + fmtFt(latest.netWorth) +
      (latest.goal ? ' &middot; cél: ' + fmtFt(latest.goal) + (pct != null ? ' &middot; ' + Math.round(pct) + '% teljesítve' : '') : '') +
      '</div>';
  }

  // ---- Hitelek --------------------------------------------------------------
  function renderLoans(loans) {
    loans = loans || { rows: [], totalRemaining: 0, totalMonthly: 0 };
    els.loanTotals.innerHTML =
      '<div class="tile expense"><div class="t-label">fennmaradó tőke összesen</div><div class="t-value">' + fmtFt(loans.totalRemaining) + '</div></div>' +
      '<div class="tile"><div class="t-label">havi törlesztő összesen</div><div class="t-value">' + fmtFt(loans.totalMonthly) + '</div></div>';
    if (!loans.rows.length) {
      els.loans.innerHTML = '<div class="loan-card" style="color:var(--ink-3)">Nincs rögzített hitel a Notion &bdquo;Hitelek&rdquo; adatbázisában.</div>';
      return;
    }
    els.loans.innerHTML = loans.rows.map(function (l) {
      var end = l.endDate ? new Date(l.endDate).toLocaleDateString('hu-HU') : '—';
      var lenderLabel = [l.lender, l.type].filter(Boolean).join(' · ');
      return '<div class="loan-card">' +
        '<div class="loan-head"><span class="loan-name">' + esc(l.name) + '</span><span class="loan-lender">' + esc(lenderLabel) + '</span></div>' +
        '<div class="loan-rows">' +
        '<div><span class="k">fennmaradó tőke</span><span class="v">' + fmtFt(l.remaining) + '</span></div>' +
        '<div><span class="k">havi törlesztő</span><span class="v">' + fmtFt(l.monthly) + '</span></div>' +
        '<div><span class="k">kamat</span><span class="v">' + (l.ratePct != null ? l.ratePct + '%' : '—') + '</span></div>' +
        '<div><span class="k">futamidő vége</span><span class="v">' + end + '</span></div>' +
        '</div>' +
        (l.note ? '<div class="acct-note" style="margin-top:8px;">' + esc(l.note) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // ---- Készpénz ---------------------------------------------------------------
  function renderCash(cash) {
    cash = cash || { entries: [], summary: {} };
    var s = cash.summary || {};
    var people = ['Én', 'Detti'];
    els.cashSummary.innerHTML = people.map(function (p) {
      var d = s[p] || { kapott: 0, koltott: 0 };
      return '<div class="cash-person">' +
        '<div class="cash-person-name">' + p + '</div>' +
        '<div class="cash-person-row"><span>kapott</span><span class="v" style="color:var(--income)">' + fmtFt(d.kapott) + '</span></div>' +
        '<div class="cash-person-row"><span>költött</span><span class="v" style="color:var(--expense)">' + fmtFt(d.koltott) + '</span></div>' +
        '<div class="cash-person-row"><span>egyenleg</span><span class="v">' + fmtSigned(d.kapott - d.koltott) + '</span></div>' +
        '</div>';
    }).join('');

    if (!cash.entries.length) {
      els.cashEntries.innerHTML = '<div class="cash-entry-row" style="color:var(--ink-3)">Még nincs rögzített készpénztétel.</div>';
      return;
    }
    els.cashEntries.innerHTML = cash.entries.map(function (e) {
      var dateStr = e.date ? new Date(e.date).toLocaleDateString('hu-HU') : '—';
      var isIn = e.kind === 'Kapott';
      return '<div class="cash-entry-row">' +
        '<span class="who">' + esc(e.person) + '</span>' +
        '<span class="meta">' + dateStr + (e.note ? ' &middot; ' + esc(e.note) : '') + '</span>' +
        '<span class="amt ' + (isIn ? 'in' : 'out') + '">' + (isIn ? '+' : '−') + fmtFt(e.amount).replace(/^−/, '') + '</span>' +
        '</div>';
    }).join('');
  }

  function setCashMsg(text, ok) {
    if (!text) { els.cashMsg.hidden = true; return; }
    els.cashMsg.hidden = false;
    els.cashMsg.textContent = text;
    els.cashMsg.className = 'cash-form-msg ' + (ok ? 'ok' : 'err');
  }

  els.cashForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var cfg = loadConfig();
    if (!cfg) { showSetup(); return; }
    var amount = parseInt(els.cashAmount.value, 10);
    if (!amount || amount <= 0) {
      setCashMsg('Adj meg egy érvényes összeget.', false);
      return;
    }
    var payload = {
      person: els.cashPerson.value,
      kind: els.cashKind.value,
      amount: amount,
      note: els.cashNote.value.trim()
    };
    els.cashSubmit.disabled = true;
    els.cashSubmit.textContent = 'Mentés…';
    setCashMsg('', false);

    fetch(cfg.apiBase + '/api/cash-entry', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function () {
        setCashMsg('Elmentve a Notionba.', true);
        els.cashAmount.value = '';
        els.cashNote.value = '';
        loadDashboard();
      })
      .catch(function (err) {
        setCashMsg('Nem sikerült menteni (' + (err && err.message ? err.message : 'ismeretlen hiba') + ').', false);
      })
      .then(function () {
        els.cashSubmit.disabled = false;
        els.cashSubmit.textContent = 'Mentés Notionbe';
      });
  });

  // ---- Teendők ---------------------------------------------------------------
  function todoCard(t, i, savingBadge) {
    var prioClass = t.priority ? 'prio-' + t.priority.toLowerCase() : '';
    var badges = '';
    if (t.priority) badges += '<span class="todo-badge ' + prioClass + '">' + esc(t.priority) + '</span>';
    if (savingBadge && t.estimatedSaving) badges += '<span class="todo-badge saving">~' + fmtFt(t.estimatedSaving) + ' / hó</span>';
    return '<div class="todo-card">' +
      (i != null ? '<div class="todo-num">' + (i + 1) + '</div>' : '') +
      '<div>' +
      '<div class="todo-name">' + esc(t.name) + '</div>' +
      (t.description ? '<div class="todo-desc">' + esc(t.description) + '</div>' : '') +
      '<div class="todo-meta">' + badges + '</div>' +
      '</div></div>';
  }

  function renderTodos(todos) {
    todos = todos || { steps: [], savingIdeas: [], sellIdeas: [] };
    els.todoSteps.innerHTML = todos.steps.length
      ? todos.steps.slice(0, 3).map(function (t, i) { return todoCard(t, i, false); }).join('')
      : '<div class="todo-card" style="color:var(--ink-3)">Nincs rögzített lépés a Notion &bdquo;Teendők&rdquo; adatbázisában.</div>';
    els.todoSaving.innerHTML = todos.savingIdeas.length
      ? todos.savingIdeas.map(function (t) { return todoCard(t, null, true); }).join('')
      : '<div class="todo-card" style="color:var(--ink-3)">Nincs rögzített spórolási ötlet.</div>';
    els.todoSell.innerHTML = todos.sellIdeas.length
      ? todos.sellIdeas.map(function (t) { return todoCard(t, null, true); }).join('')
      : '<div class="todo-card" style="color:var(--ink-3)">Nincs rögzített eladási / cserélési ötlet.</div>';
  }

  // ---- Tized ---------------------------------------------------------------
  function renderTithe(giving, verdict) {
    giving = giving || {};
    var tiles = [
      { label: 'tized ebben a hónapban', value: giving.thisMonthTithe },
      { label: 'gyülekezeti támogatás ebben a hónapban', value: giving.thisMonthChurch },
      { label: 'javasolt tized (bevétel 10%-a)', value: giving.recommendedTithe }
    ];
    els.titheTiles.innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="t-label">' + t.label + '</div><div class="t-value">' + fmtFt(t.value) + '</div></div>';
    }).join('');

    var note;
    if (giving.recommendedTithe == null) {
      note = 'Még nincs elég adat a bevétel átlagához, így a javasolt tizedet sem tudjuk kiszámolni.';
    } else if (giving.titheGapThisMonth != null && giving.titheGapThisMonth > 1000) {
      note = 'Ebben a hónapban eddig ' + fmtFt(giving.thisMonthTithe) + ' tized lett rögzítve a Notionban, a szokásos 10%-os elvhez képest még kb. ' + fmtFt(giving.titheGapThisMonth) + ' hiányzik.';
    } else {
      note = 'A tized ebben a hónapban eléri (vagy megközelíti) a szokásos 10%-os elvet.';
    }
    els.titheNote.textContent = note;
  }

  function renderWhatIf(v) {
    v = v || {};
    var deficitCore = v.deficitCore != null ? v.deficitCore : 0; // positive = surplus, negative = deficit
    var balance = v.knownBalance != null ? v.knownBalance : 0;

    function update() {
      var cut = parseInt(els.cutSlider.value, 10) || 0;
      els.cutValue.textContent = cut.toLocaleString('hu-HU') + ' Ft/hó';
      var newMonthly = deficitCore + cut; // cutting spend increases the monthly surplus (or shrinks the deficit)
      if (newMonthly < 0) {
        els.outBalance.textContent = '−' + Math.abs(Math.round(newMonthly)).toLocaleString('hu-HU') + ' Ft';
        els.outBalance.style.color = 'var(--expense)';
        els.outRunway.textContent = balance > 0 ? ('~' + Math.max(1, Math.round(balance / Math.abs(newMonthly))) + ' hónap') : '—';
      } else {
        els.outBalance.textContent = '+' + Math.round(newMonthly).toLocaleString('hu-HU') + ' Ft';
        els.outBalance.style.color = 'var(--income)';
        els.outRunway.textContent = 'nő a vagyon — nincs futamidő-korlát';
      }
      els.outYearly.textContent = (cut * 12).toLocaleString('hu-HU') + ' Ft/év';
    }

    els.cutSlider.oninput = update;
    update();
  }

  // ---- boot ---------------------------------------------------------------
  var cfg = loadConfig();
  if (cfg) {
    loadDashboard();
  } else {
    showSetup();
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
