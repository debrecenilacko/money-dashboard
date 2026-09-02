// Cloudflare Worker — backend for the Pénztárkönyv (money dashboard).
// It is the ONLY thing that holds the real Notion secret. The phone/browser
// app never sees it; it only knows a much weaker "APP_TOKEN" you choose
// yourself, just to keep randoms off your endpoint.
//
// Deploy: see ../README.md for the exact `wrangler` commands.

const NOTION_VERSION = '2022-06-28';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

function checkAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.APP_TOKEN}`;
}

async function notion(env, path, options = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  return res.json();
}

// Query an entire Notion database (data source), following pagination.
async function queryAll(env, databaseId, body = {}) {
  const results = [];
  let cursor;
  do {
    const page = await notion(env, `/databases/${databaseId}/query`, {
      method: 'POST',
      body: JSON.stringify({ ...body, start_cursor: cursor })
    });
    results.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ---- Property readers (Notion API -> plain JS) -----------------------------
const num = (p) => (p && p.number != null ? p.number : null);
const text = (p) => (p && p.rich_text && p.rich_text[0] ? p.rich_text[0].plain_text : '');
const title = (p) => (p && p.title && p.title[0] ? p.title[0].plain_text : '');
const select = (p) => (p && p.select ? p.select.name : null);
const date = (p) => (p && p.date ? p.date.start : null);
const checkbox = (p) => !!(p && p.checkbox);

function monthKey(isoDate) {
  return isoDate ? isoDate.slice(0, 7) : null;
}

function thisMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

// Category buckets for the fix/variable split and the flexible-spend budget cap.
// NOTE: this only works well for transactions tagged with the newer, finer
// categories. Older rows filed simply under "Egyéb" won't be split out
// automatically — recategorize them by hand in Notion if you want them to
// count here.
const FIX_CATEGORIES = new Set([
  'Rezsi', 'Hiteltörlesztés', 'Lakhatás/albérlet', 'Biztosítás', 'Előfizetések'
]);
const FLEX_BUDGET_CATEGORIES = new Set(['Vendéglátás / étkezés', 'Egyéb vásárlás / szolgáltatás']);
const VARIABLE_CATEGORIES = new Set([
  'Élelmiszer', 'Vendéglátás / étkezés', 'Egyéb vásárlás / szolgáltatás', 'Autó', 'Egészség'
]);
// Elkülönítve kezelt kategóriák — nem "elköltött" pénz, hanem tized/adomány
// illetve megtakarítás/befektetés felé irányított összeg. Kimaradnak a
// fix/rugalmas bontásból, de a saját füleiken meg vannak jelenítve.
const GIVING_CATEGORIES = new Set(['Tized', 'Gyülekezeti támogatás']);
const SAVINGS_CATEGORY = 'Megtakarítás/befektetés';
// A "Számlák" adatbázisban ezekkel a Típus-okkal jelölt sorok kerülnek a
// Megtakarítások fülre (a folyószámlák helyett).
const SAVINGS_ACCOUNT_TYPES = new Set(['Befektetés', 'Megtakarítás']);

async function loadTransactions(env, monthsBack) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - monthsBack);
  since.setUTCDate(1);
  const sinceISO = since.toISOString().slice(0, 10);

  const pages = await queryAll(env, env.DB_TRANZAKCIOK, {
    filter: { property: 'Dátum', date: { on_or_after: sinceISO } },
    sorts: [{ property: 'Dátum', direction: 'ascending' }],
    page_size: 100
  });

  return pages.map((pg) => {
    const p = pg.properties;
    return {
      name: title(p.Name),
      date: date(p['Dátum']),
      month: monthKey(date(p['Dátum'])),
      type: select(p['Típus']),
      category: select(p['Kategória']),
      amount: num(p['Összeg (Ft)']) || 0,
      oneOff: checkbox(p['Egyszeri']),
      note: text(p['Megjegyzés'])
    };
  });
}

function buildTrend(transactions) {
  const byMonth = {};
  for (const t of transactions) {
    if (!t.month) continue;
    if (!byMonth[t.month]) byMonth[t.month] = { inc: 0, exp: 0, core: 0 };
    if (t.type === 'Bevétel') byMonth[t.month].inc += t.amount;
    else if (t.type === 'Kiadás') {
      byMonth[t.month].exp += t.amount;
      if (!t.oneOff) byMonth[t.month].core += t.amount;
    }
  }
  return Object.keys(byMonth).sort().map((m) => ({ label: m, ...byMonth[m] }));
}

function buildCategoryLedger(transactions) {
  const byCat = {};
  for (const t of transactions) {
    if (t.type !== 'Kiadás') continue;
    const key = t.category || 'Egyéb';
    if (!byCat[key]) byCat[key] = { amount: 0, oneOff: 0 };
    byCat[key].amount += t.amount;
    if (t.oneOff) byCat[key].oneOff += t.amount;
  }
  return Object.entries(byCat)
    .map(([name, v]) => ({ name, amount: v.amount, mostlyOneOff: v.oneOff > v.amount / 2 }))
    .sort((a, b) => b.amount - a.amount);
}

function buildSplit(transactions) {
  let fix = 0, variable = 0, other = 0;
  for (const t of transactions) {
    if (t.type !== 'Kiadás' || t.oneOff) continue;
    if (FIX_CATEGORIES.has(t.category)) fix += t.amount;
    else if (VARIABLE_CATEGORIES.has(t.category)) variable += t.amount;
    else other += t.amount;
  }
  return { fix, variable, other };
}

function buildBudgets(transactions, env) {
  const now = new Date();
  const thisMonth = thisMonthKey();
  let food = 0, flex = 0;
  for (const t of transactions) {
    if (t.type !== 'Kiadás' || t.month !== thisMonth) continue;
    if (t.category === 'Élelmiszer') food += t.amount;
    else if (FLEX_BUDGET_CATEGORIES.has(t.category)) flex += t.amount;
  }
  const dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    month: thisMonth,
    dayOfMonth: now.getUTCDate(),
    daysInMonth: dim,
    food: { spent: food, cap: Number(env.BUDGET_FOOD_CAP || 0) },
    flex: { spent: flex, cap: Number(env.BUDGET_FLEX_CAP || 0) }
  };
}

// Tized / gyülekezeti támogatás — mennyit adtunk, és ez hogy viszonyul a
// bevételhez (hagyományos tizedelvi ökölszabály: 10%).
function buildGiving(transactions, avgIncome) {
  const thisMonth = thisMonthKey();
  let titheThisMonth = 0, churchThisMonth = 0, titheTotal = 0, churchTotal = 0;
  for (const t of transactions) {
    if (t.type !== 'Kiadás') continue;
    if (t.category === 'Tized') {
      titheTotal += t.amount;
      if (t.month === thisMonth) titheThisMonth += t.amount;
    } else if (t.category === 'Gyülekezeti támogatás') {
      churchTotal += t.amount;
      if (t.month === thisMonth) churchThisMonth += t.amount;
    }
  }
  const recommendedTithe = avgIncome ? avgIncome * 0.1 : null;
  return {
    thisMonthTithe: titheThisMonth,
    thisMonthChurch: churchThisMonth,
    periodTithe: titheTotal,
    periodChurch: churchTotal,
    recommendedTithe,
    titheGapThisMonth: recommendedTithe != null ? recommendedTithe - titheThisMonth : null
  };
}

async function loadAccounts(env) {
  const pages = await queryAll(env, env.DB_SZAMLAK, { page_size: 100 });
  return pages.map((pg) => {
    const p = pg.properties;
    return {
      name: title(p.Name),
      type: select(p['Típus']),
      bank: text(p['Bank / szolgáltató']),
      balance: num(p['Aktuális egyenleg']),
      date: date(p['Frissítve']),
      note: text(p['Megjegyzés'])
    };
  });
}

async function loadNetWorth(env) {
  if (!env.DB_NETWORTH) return { rows: [] };
  const pages = await queryAll(env, env.DB_NETWORTH, {
    sorts: [{ property: 'Dátum', direction: 'descending' }],
    page_size: 12
  });
  return {
    rows: pages.map((pg) => {
      const p = pg.properties;
      return {
        date: date(p['Dátum']),
        netWorth: num(p['Nettó vagyon (Ft)']),
        goal: num(p['Cél (FIRE)'])
      };
    })
  };
}

// A "Hitelek & Lízingek" adatbázis sémája: nincs külön "Kamat (%)" oszlopa —
// a kamat (ha ismert) a Megjegyzés szövegében szerepel ("kamat 12.49%" stb.),
// onnan próbáljuk kiolvasni.
function extractRatePct(note) {
  var m = note && note.match(/kamat[:\s]*([\d.,]+)\s*%/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

async function loadLoans(env) {
  if (!env.DB_HITELEK) return { rows: [], totalRemaining: 0, totalMonthly: 0 };
  const pages = await queryAll(env, env.DB_HITELEK, {
    sorts: [{ property: 'Name', direction: 'ascending' }],
    page_size: 100
  });
  const rows = pages.map((pg) => {
    const p = pg.properties;
    const note = text(p['Megjegyzés']);
    return {
      name: title(p.Name),
      lender: text(p['Hitelező']),
      type: select(p['Típus']),
      remaining: num(p['Fennmaradó tartozás (Ft)']) || 0,
      monthly: num(p['Havi törlesztő (Ft)']) || 0,
      ratePct: extractRatePct(note),
      endDate: date(p['Lejárat']),
      note
    };
  });
  return {
    rows,
    totalRemaining: rows.reduce((s, r) => s + r.remaining, 0),
    totalMonthly: rows.reduce((s, r) => s + r.monthly, 0)
  };
}

async function loadCash(env) {
  if (!env.DB_KESZPENZ) return { entries: [], summary: {} };
  const pages = await queryAll(env, env.DB_KESZPENZ, {
    sorts: [{ property: 'Dátum', direction: 'descending' }],
    page_size: 100
  });
  const entries = pages.map((pg) => {
    const p = pg.properties;
    return {
      name: title(p.Name),
      date: date(p['Dátum']),
      person: select(p['Személy']),
      kind: select(p['Típus']),
      amount: num(p['Összeg (Ft)']) || 0,
      note: text(p['Megjegyzés'])
    };
  });
  const summary = { 'Én': { kapott: 0, koltott: 0 }, 'Detti': { kapott: 0, koltott: 0 } };
  for (const e of entries) {
    if (!summary[e.person]) continue;
    if (e.kind === 'Kapott') summary[e.person].kapott += e.amount;
    else if (e.kind === 'Költött') summary[e.person].koltott += e.amount;
  }
  return { entries: entries.slice(0, 30), summary };
}

async function loadTodos(env) {
  if (!env.DB_TEENDOK) return { steps: [], savingIdeas: [], sellIdeas: [] };
  const pages = await queryAll(env, env.DB_TEENDOK, { page_size: 100 });
  const rows = pages.map((pg) => {
    const p = pg.properties;
    return {
      name: title(p.Name),
      description: text(p['Leírás']),
      estimatedSaving: num(p['Becsült megtakarítás (Ft)']),
      priority: select(p['Prioritás']),
      kind: select(p['Típus']),
      status: select(p['Státusz'])
    };
  });
  const notClosed = rows.filter((r) => r.status !== 'Lezárva');
  const prioRank = { 'Magas': 0, 'Közepes': 1, 'Alacsony': 2 };
  const byPrio = (a, b) => (prioRank[a.priority] ?? 3) - (prioRank[b.priority] ?? 3);
  return {
    steps: notClosed.filter((r) => r.kind === '3 lépés').sort(byPrio),
    savingIdeas: notClosed.filter((r) => r.kind === 'Spórolási ötlet').sort(byPrio),
    sellIdeas: notClosed.filter((r) => r.kind === 'Eladás/csere').sort(byPrio)
  };
}

// ---- "Ejnye-bejnye" / dicséret tanácsadó ------------------------------------
function buildAdvice(ctx) {
  const advice = [];
  const v = ctx.verdict || {};
  const savingsRate = ctx.savingsRatePct;

  if (v.deficitCore != null) {
    if (v.deficitCore < 0) {
      advice.push({
        type: 'warn',
        text: 'Ejnye-bejnye! Az elmúlt hónapok átlagában többet költötök, mint amennyi bejön ' +
          '(havi ' + Math.round(Math.abs(v.deficitCore)).toLocaleString('hu-HU') + ' Ft a hiány, az egyszeri tételek nélkül is). Ezt hosszabb távon nem lehet fenntartani.'
      });
    } else if (savingsRate != null && savingsRate >= 15) {
      advice.push({
        type: 'praise',
        text: 'Szép munka! ' + Math.round(savingsRate) + '%-os megtakarítási rátát tartotok az elmúlt lezárt hónapokban — ez kifejezetten jó arány.'
      });
    } else {
      advice.push({
        type: 'info',
        text: 'A bevétel egyelőre fedezi a core kiadásokat, de a megtakarítási ráta még szerényebb (' +
          (savingsRate != null ? Math.round(savingsRate) + '%' : '—') + '). Van hova fejlődni.'
      });
    }
  }

  const b = ctx.budgets;
  if (b && b.food && b.food.cap > 0) {
    const pace = (b.dayOfMonth / b.daysInMonth) * 100;
    const pct = (b.food.spent / b.food.cap) * 100;
    if (pct >= 100) {
      advice.push({ type: 'warn', text: 'Ejnye-bejnye! Az élelmiszerkeretet már túllépted ebben a hónapban (' + Math.round(pct) + '%).' });
    } else if (pct > pace + 15) {
      advice.push({ type: 'warn', text: 'Az élelmiszerköltés gyorsabban fogy, mint kellene: a hónap ' + Math.round(pace) + '%-ánál a keret ' + Math.round(pct) + '%-a már elment.' });
    }
  }
  if (b && b.flex && b.flex.cap > 0) {
    const pace = (b.dayOfMonth / b.daysInMonth) * 100;
    const pct = (b.flex.spent / b.flex.cap) * 100;
    if (pct >= 100) {
      advice.push({ type: 'warn', text: 'Ejnye-bejnye! A vendéglátás / egyéb vásárlás keret is elfogyott már ebben a hónapban (' + Math.round(pct) + '%).' });
    } else if (pct > pace + 15) {
      advice.push({ type: 'warn', text: 'A rugalmas keret (vendéglátás / egyéb vásárlás) gyorsabban fogy a vártnál: ' + Math.round(pct) + '% a hónap ' + Math.round(pace) + '%-ánál.' });
    }
  }

  const loans = ctx.loans;
  if (loans && loans.totalMonthly > 0 && v.avgIncome) {
    const burden = (loans.totalMonthly / v.avgIncome) * 100;
    if (burden > 40) {
      advice.push({ type: 'warn', text: 'Ejnye-bejnye! A havi hiteltörlesztések a bevétel ' + Math.round(burden) + '%-át teszik ki — ez elég magas terhelés.' });
    }
  }

  const giving = ctx.giving;
  if (giving && giving.titheGapThisMonth != null && giving.titheGapThisMonth > 0 && v.avgIncome) {
    advice.push({
      type: 'info',
      text: 'Ebben a hónapban eddig ' + Math.round(giving.thisMonthTithe).toLocaleString('hu-HU') + ' Ft tized lett rögzítve — a szokásos 10%-os elvhez képest még ' +
        Math.round(giving.titheGapThisMonth).toLocaleString('hu-HU') + ' Ft hiányzik (ha még nincs vége a hónapnak, ez lehet, hogy csak időzítés kérdése).'
    });
  }

  if (!advice.length) {
    advice.push({ type: 'info', text: 'Egyelőre nincs különösebb intő jel vagy kiugró eredmény — minden a megszokott mederben.' });
  }
  return advice;
}

async function buildDashboard(env) {
  const transactions = await loadTransactions(env, 4); // this month + 3 full prior months
  const complete = transactions.filter((t) => t.month !== thisMonthKey()); // exclude current, incomplete month from averages

  const trend = buildTrend(complete).slice(-3);
  const avgIncome = trend.length ? trend.reduce((s, m) => s + m.inc, 0) / trend.length : 0;
  const avgCore = trend.length ? trend.reduce((s, m) => s + m.core, 0) / trend.length : 0;
  const avgRaw = trend.length ? trend.reduce((s, m) => s + m.exp, 0) / trend.length : 0;

  const [accounts, netWorth, loans, cash, todos] = await Promise.all([
    loadAccounts(env),
    loadNetWorth(env),
    loadLoans(env),
    loadCash(env),
    loadTodos(env)
  ]);
  const knownBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const savingsAccounts = accounts.filter((a) => SAVINGS_ACCOUNT_TYPES.has(a.type));
  const regularAccounts = accounts.filter((a) => !SAVINGS_ACCOUNT_TYPES.has(a.type));

  const verdict = {
    avgIncome,
    avgCoreExpense: avgCore,
    avgRawExpense: avgRaw,
    avgOneOff: avgRaw - avgCore,
    deficitCore: avgIncome - avgCore,
    deficitRaw: avgIncome - avgRaw,
    knownBalance
  };
  const savingsRatePct = avgIncome ? ((avgIncome - avgCore) / avgIncome) * 100 : null;
  const budgets = buildBudgets(transactions, env);
  const giving = buildGiving(complete.length ? complete : transactions, avgIncome);

  const advice = buildAdvice({ verdict, savingsRatePct, budgets, loans, giving });

  return {
    generatedAt: new Date().toISOString(),
    verdict,
    savingsRatePct,
    trend,
    categories: buildCategoryLedger(complete),
    split: buildSplit(complete.length ? complete : transactions),
    budgets,
    accounts: regularAccounts,
    savingsAccounts,
    netWorth,
    loans,
    cash,
    todos,
    giving,
    advice
  };
}

async function createCashEntry(env, body) {
  const person = body && body.person;
  const kind = body && body.kind;
  const amount = body && Number(body.amount);
  const note = (body && body.note) || '';
  const isoDate = (body && body.date) || new Date().toISOString().slice(0, 10);

  if (!['Én', 'Detti'].includes(person)) throw new Error('érvénytelen "person"');
  if (!['Kapott', 'Költött'].includes(kind)) throw new Error('érvénytelen "kind"');
  if (!amount || amount <= 0 || isNaN(amount)) throw new Error('érvénytelen "amount"');

  const name = person + ' — ' + kind + ' — ' + amount.toLocaleString('hu-HU') + ' Ft';
  const page = await notion(env, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: env.DB_KESZPENZ },
      properties: {
        Name: { title: [{ text: { content: name } }] },
        'Dátum': { date: { start: isoDate } },
        'Személy': { select: { name: person } },
        'Típus': { select: { name: kind } },
        'Összeg (Ft)': { number: amount },
        'Megjegyzés': note ? { rich_text: [{ text: { content: note } }] } : { rich_text: [] }
      }
    })
  });
  return { id: page.id };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const url = new URL(request.url);
    if (!checkAuth(request, env)) return unauthorized();

    try {
      if (url.pathname === '/api/dashboard' && request.method === 'GET') {
        return json(await buildDashboard(env));
      }
      if (url.pathname === '/api/cash-entry' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const result = await createCashEntry(env, body);
        return json(result, 201);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }
  }
};
