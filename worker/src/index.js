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
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

// Category buckets for the fix/variable split and the flexible-spend budget cap.
// NOTE: this only works well for transactions tagged with the newer, finer
// categories (Hiteltörlesztés / Vendéglátás / étkezés / Egyéb vásárlás /
// szolgáltatás). Older rows filed simply under "Egyéb" won't be split out
// automatically — recategorize them by hand in Notion if you want them to
// count here.
const FIX_CATEGORIES = new Set(['Rezsi', 'Hiteltörlesztés']);
const FLEX_BUDGET_CATEGORIES = new Set(['Vendéglátás / étkezés', 'Egyéb vásárlás / szolgáltatás']);
const VARIABLE_CATEGORIES = new Set([
  'Élelmiszer', 'Vendéglátás / étkezés', 'Egyéb vásárlás / szolgáltatás', 'Autó', 'Egészség'
]);

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
  const thisMonth = now.toISOString().slice(0, 7);
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

async function loadAccounts(env) {
  const pages = await queryAll(env, env.DB_SZAMLAK, { page_size: 100 });
  return pages.map((pg) => {
    const p = pg.properties;
    return {
      name: title(p.Name),
      type: select(p['Típus']),
      bank: text(p['Bank / szolgáltató']),
      balance: num(p['Aktuális egyenleg']),
      date: date(p['Frissítve'])
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

async function buildDashboard(env) {
  const transactions = await loadTransactions(env, 4); // this month + 3 full prior months
  const complete = transactions.filter((t) => t.month !== new Date().toISOString().slice(0, 7)); // exclude current, incomplete month from averages

  const trend = buildTrend(complete).slice(-3);
  const avgIncome = trend.length ? trend.reduce((s, m) => s + m.inc, 0) / trend.length : 0;
  const avgCore = trend.length ? trend.reduce((s, m) => s + m.core, 0) / trend.length : 0;
  const avgRaw = trend.length ? trend.reduce((s, m) => s + m.exp, 0) / trend.length : 0;

  const [accounts, netWorth] = await Promise.all([loadAccounts(env), loadNetWorth(env)]);
  const knownBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    verdict: {
      avgIncome,
      avgCoreExpense: avgCore,
      avgRawExpense: avgRaw,
      avgOneOff: avgRaw - avgCore,
      deficitCore: avgIncome - avgCore,
      deficitRaw: avgIncome - avgRaw,
      knownBalance
    },
    savingsRatePct: avgIncome ? ((avgIncome - avgCore) / avgIncome) * 100 : null,
    trend,
    categories: buildCategoryLedger(complete),
    split: buildSplit(complete.length ? complete : transactions),
    budgets: buildBudgets(transactions, env),
    accounts,
    netWorth
  };
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
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message ? err.message : err) }, 500);
    }
  }
};
