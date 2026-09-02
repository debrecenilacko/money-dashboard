# Pénztárkönyv

Személyes pénzügyi dashboard telefonra: havi trend, megtakarítási ráta,
keretek, fix/rugalmas kiadás bontás, számlaegyenlegek, "mi lenne, ha
kevesebbet költenél" szimulátor — **élőben szinkronban a Notionoddal**.

## Hogyan függ össze

```
telefon (index.html + app.js)
        │  fetch, Bearer APP_TOKEN
        ▼
Cloudflare Worker (worker/)
        │  Notion API, Bearer NOTION_TOKEN
        ▼
Notion — a "💰 Pénzügyek" oldal alatti táblák:
  · Tranzakciók   (bevétel/kiadás tételek, kategória, "Egyszeri" jelölő)
  · Számlák        (bankszámlák/kártyák aktuális egyenlege)
  · Nettó vagyon   (opcionális — FIRE cél követéséhez, ha feltöltöd)
```

A telefon **soha nem** látja a Notion tokent — csak a Worker látja. A
telefon egy sokkal gyengébb, magad választotta `APP_TOKEN`-nel jelentkezik
be a Workerbe, hogy ne bárki tudja hívogatni.

Minden számot a Worker élőben számol a Notion aktuális tartalmából —
nincs a kódban semmilyen kőbe vésett Ft-összeg.

## 1. lépés — Notion integráció létrehozása (te csinálod)

Ezt neked kell megtenned, mert ez egy fiók-szintű titkos kulcs, amit nem
oszthatok meg/kezelhetek helyetted:

1. Menj ide: <https://www.notion.so/my-integrations>
2. "New integration" → adj neki nevet (pl. "Pénztárkönyv Dashboard") →
   Create.
3. Másold ki az "Internal Integration Secret"-et (`ntn_...` vagy
   `secret_...` kezdetű) — ez lesz a `NOTION_TOKEN`.
4. Notionban nyisd meg a **"💰 Pénzügyek"** oldalt, és a jobb felső
   "..." → "Connections" → add hozzá az imént létrehozott integrációt.
   Ez az alatta lévő táblákra (Tranzakciók, Számlák, Nettó vagyon) is
   kiterjed.

## 2. lépés — Cloudflare Worker deploy (te csinálod, én megírtam a kódot)

Szükséged lesz egy ingyenes Cloudflare fiókra.

```bash
cd money-dashboard/worker
npm install -g wrangler   # ha még nincs telepítve
wrangler login             # böngészőben bejelentkezés a saját Cloudflare fiókodba

wrangler secret put NOTION_TOKEN
# illeszd be az 1. lépésben kapott tokent

wrangler secret put APP_TOKEN
# gondolj ki egy saját jelszót, pl. egy hosszú random string — ezt kéri majd az app

wrangler deploy
```

A `wrangler deploy` a végén kiírja a Worker URL-jét, valami ilyesmi:
`https://penztarkonyv-dashboard-api.<felhasznalonev>.workers.dev` — ez
kell a következő lépéshez.

A `wrangler.toml`-ban már benne vannak a Notion adatbázis ID-k és a
javasolt havi keretek (`BUDGET_FOOD_CAP`, `BUDGET_FLEX_CAP`) — ezeket
bátran átírhatod a fájlban a sajátodra, deploy előtt vagy után is
(utóbbi esetben csak újra kell `wrangler deploy`-olni).

## 3. lépés — Frontend

```bash
cd money-dashboard
git remote add origin https://github.com/<felhasznalonev>/money-dashboard.git
git push -u origin main
```

Utána a GitHub repo → Settings → Pages → Source: `main` / `/ (root)`.
Pár perc múlva elérhető: `https://<felhasznalonev>.github.io/money-dashboard/`

Nyisd meg a telefonon. Első betöltéskor két mezőt kér:
1. a Worker URL-jét (2. lépés végén kaptad)
2. az `APP_TOKEN`-t (amit te választottál)

Ezeket egyszer kell megadni, utána a telefon localStorage-ában marad.
Ha valamikor hibás tokent ad vissza a Worker, az app automatikusan
visszadob erre a beállító képernyőre.

**"Kezdőképernyőhöz adás"**: Safari/Chrome megosztás menü → így egy
önálló app-ikonként fog megnyílni, böngészősáv nélkül.

## Amit magamtól megcsináltam (nincs más teendőd rajta)

- A Notion "Tranzakciók" táblát kiegészítettem egy "Egyszeri" jelölővel
  (checkbox) és néhány finomabb kategóriával (Hiteltörlesztés,
  Vendéglátás / étkezés, Egyéb vásárlás / szolgáltatás), hogy a fix/
  rugalmas bontás és a havi keretek élőben, kézi utómunka nélkül
  számolhatók legyenek — ez csak az ezután rögzített tételekre vonatkozik
  automatikusan, a régi "Egyéb"-be sorolt tételeket érdemes utólag
  átkategorizálni, ha szeretnéd, hogy azok is beleszámítsanak.
- A teljes Worker backend kód (`worker/src/index.js`), ami lekérdezi és
  összesíti a Notion adatokat.
- A teljes frontend (`index.html`, `app.js`, `manifest.json`, `sw.js`,
  ikonok), ami ehhez a backendhez van drótozva.
- Mostantól amikor itt a chatben rögzítesz egy tranzakciót, az továbbra
  is bekerül a Notionba — és a telefonos app ugyanazt fogja mutatni,
  mert onnan olvas.

## Amit neked kell csinálnod (fiók/titok miatt nem tehetem meg helyetted)

- Notion integráció létrehozása + megosztása (1. lépés)
- Cloudflare fiók + `wrangler login` + `wrangler deploy` (2. lépés)
- GitHub repo push + Pages bekapcsolása (3. lépés)

Ha bármelyik lépésnél elakadsz, másold ide a hibaüzenetet és
végigmegyünk rajta.

## Fájlstruktúra

```
money-dashboard/
├── index.html            — UI (kártyák, grafikon, szimulátor)
├── app.js                 — frontend logika, API-hívások a Workerhez
├── manifest.json           — PWA manifeszt (kezdőképernyő ikon)
├── sw.js                    — service worker (offline fallback)
├── icons/                   — app ikonok
├── worker/
│   ├── src/index.js        — Cloudflare Worker: Notion API híd
│   └── wrangler.toml        — Worker konfiguráció (database ID-k, keretek)
└── README.md                — ez a fájl
```
