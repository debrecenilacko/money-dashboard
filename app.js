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
    rateValue: document.getElementById('rateValue'),
    rateFill: document.getElementById('rateFill'),
    tiles: document.getElementById('tiles'),
    trendSvg: document.getElementById('trendSvg'),
    ledger: document.getElementById('ledger'),
    budgets: document.getElementById('budgets'),
    splitBar: document.getElementById('splitBar'),
    splitLegend: document.getElementById('splitLegend'),
    accounts: document.getElementById('accounts'),
    goals: document.getElementById('goals'),
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
    renderRate(data.savingsRatePct);
    renderTiles(data.verdict);
    renderTrend(data.trend || []);
    renderLedger(data.categories || []);
    renderBudgets(data.budgets);
    renderSplit(data.split);
    renderAccounts(data.accounts || []);
    renderGoals(data.netWorth);
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
      return '<div class="ledger-row"><span class="cat-name">' + c.name + badge + '</span><span class="cat-amt">' + fmtFt(c.amount) + '</span></div>';
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
      ['fix', 'fix (rezsi, hiteltörlesztés)', split.fix],
      ['var', 'rugalmas (élelmiszer, vendéglátás, autó, egészség)', split.variable],
      ['other', 'egyéb', split.other]
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

  function renderAccounts(accounts) {
    if (!accounts.length) {
      els.accounts.innerHTML = '<div class="acct-card" style="color:var(--ink-3)">Nincs feltöltött számla a Notion &bdquo;Számlák&rdquo; adatbázisban.</div>';
      return;
    }
    els.accounts.innerHTML = accounts.map(function (a) {
      var dateStr = a.date ? new Date(a.date).toLocaleDateString('hu-HU') : '—';
      return '<div class="acct-card">' +
        '<div class="acct-name">' + a.name + (a.bank ? ' &middot; ' + a.bank : '') + '</div>' +
        '<div class="acct-value">' + fmtFt(a.balance) + '</div>' +
        '<div class="acct-date">frissítve: ' + dateStr + '</div>' +
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
