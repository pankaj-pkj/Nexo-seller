# ⚡ NexAPI v2 — Firebase API Reseller Gateway

A full-stack API reseller platform. Users pick a plan (Daily / Weekly / Monthly / Lifetime),
pay with USDT via Heleket, and instantly receive a sub-API key.
Your real API keys stay hidden — the gateway proxies all traffic.

```
Customer → GET /admin/paid/key?key=NK-XXX&num=919876543210
                    ↓
            NexAPI validates the key
                    ↓
            Forwards to the real API with the real key
                    ↓
            Returns the response to the customer
```

---

## Stack

| Layer | Service | Free tier |
|-------|---------|-----------|
| App (API + pages) | **Vercel** — serverless, never sleeps | 100 GB bandwidth/mo |
| Database | **Firebase Firestore** | 1 GB, 50K reads/day |
| Payments | **Heleket** | 0% commission, USDT |

Render works too — `render.yaml` and `backend/server.js` are set up for it — but
its free tier sleeps after 15 minutes of inactivity, so Vercel is the better
default.

---

## Project Structure

```
.
├── SETUP.md                        ⭐ Start here — full deployment walkthrough
├── package.json                    Root manifest (Vercel installs from this)
├── vercel.json                     Routes everything to api/index.js + cron jobs
├── render.yaml                     Render Blueprint, for the Render path
├── api/
│   └── index.js                    Vercel serverless entry — exports backend/app.js
├── backend/
│   ├── app.js                      The Express app (no server, no timers)
│   ├── server.js                   Long-lived server: app + cron + ping + poller
│   ├── .env.example                Copy → .env for local development
│   ├── db/
│   │   └── firebase.js             Admin SDK init — whole JSON, or 3 separate vars
│   ├── middleware/
│   │   ├── validateKey.js          Sub-key validation, expiry and quota checks
│   │   └── rateLimit.js            In-memory throttle (login, payments, lookups)
│   ├── routes/
│   │   ├── plans.js                GET  /api/plans
│   │   ├── payment.js              POST /api/payment/create, GET /status/:orderId
│   │   ├── webhook.js              POST /api/webhook  (Heleket callback)
│   │   ├── keys.js                 GET  /api/key/:email, /api/key/check/:subkey
│   │   ├── proxy.js                GET  /admin/paid/key  ← MAIN GATEWAY
│   │   ├── admin.js                 /api/admin/* — stats, keys, plans CRUD, seed
│   │   └── cron.js                 /api/cron/* — for Vercel Cron
│   └── utils/
│       ├── keygen.js               NK-XXXX key generator
│       ├── fulfillOrder.js         The one place money becomes a key
│       ├── paymentSync.js          Recovers orders whose webhook never arrived
│       ├── expiry.js               Marks expired keys inactive
│       ├── ping.js                 Render self-ping (prevents free-tier sleep)
│       └── seedPlans.js            The 4 default plans + seeding logic
└── frontend/                       Served by the backend — no separate deploy
    ├── config.js                   Backend URL (blank = same origin) + helpers
    ├── theme.css                   Shared design system
    ├── index.html                  Landing page + plan selection
    ├── pay.html                    Payment status + key reveal
    ├── dashboard.html              Customer key management
    ├── admin.html                  Admin panel — stats, plans, keys
    └── docs.html                   API documentation
```

---

## Setup

**→ [SETUP.md](SETUP.md) is the full walkthrough: Firebase, Vercel, Heleket, step by
step, written to be followed from a phone.** Start there.

The short version: create a Firebase project, import this repo at Vercel with the
**repository root** as the root directory, paste the Firebase service-account JSON
into `FIREBASE_SERVICE_ACCOUNT`, set `ADMIN_SECRET` and your upstream API URL, deploy.
Then open `/admin.html` and click **Seed default plans**.

### Running it locally (optional)

```bash
npm install
npm run dev        # http://localhost:3000 — serves the API and the pages
```

Fill in `backend/.env` from `backend/.env.example` first. `frontend/config.js`
resolves to the same origin, so there is nothing to edit while developing.

`npm run seed` writes the four default plans; the admin panel's **Seed default
plans** button does the same thing without a terminal. Neither overwrites plans that
already exist — use `npm run seed -- --force` or `POST /api/admin/seed?force=1` to
reset them.

### Firestore indexes — none needed

There is nothing to create. Every query here uses either a single equality filter or
a single-field `orderBy`, both of which Firestore indexes automatically.

That is a deliberate constraint, not a coincidence. Pairing `.where()` with an
`.orderBy()` on a different field would demand a hand-built composite index before
the query runs at all — an extra manual step on every fresh deployment. So `plans`
(4 documents) and a customer's key list are filtered and sorted in JS instead. Keep
it that way when adding queries.

---

## Deploying

Backend and frontend ship as one unit either way — `backend/app.js` serves
`frontend/` itself, so there is no second deploy and nothing to configure in
`config.js`.

**Step-by-step instructions, including Heleket: [SETUP.md](SETUP.md).**

### Option A — Vercel (serverless)

`api/index.js` exports the Express app; `vercel.json` rewrites every route to it
and registers two cron jobs. Import the repo at Vercel with the **repository root**
as the root directory — not `backend/` — and add the env vars.

Because a serverless process is frozen between requests, the in-process cron and
the payment poller don't run there. Their work happens through `/api/cron/expire`
and `/api/cron/sync-payments` (Vercel Cron, authenticated with `CRON_SECRET`), plus
a live check from the payment page. Nothing is lost.

### Option B — Render (long-lived Node)

`backend/server.js` runs the same app and keeps the cron, the self-ping and the
2-minute payment poller in-process. Import as a **Blueprint** (it reads
`render.yaml`) or set Root Directory `backend`, build `npm install`, start
`npm start`.

If you want the pages on their own static host instead, deploy `frontend/` there and
fill in `BACKEND_URL` at the top of `frontend/config.js`. Left empty, the pages talk
to their own origin — which is what makes the single-deploy setup need no config.

### After deploying, either way

1. Set `BACKEND_URL` to your own deployed URL, and redeploy.
2. Open `/admin.html`, log in, and click **Seed default plans**.
3. Smoke-test:
   ```bash
   curl https://<your-url>/health
   curl https://<your-url>/api/plans
   ```
4. Issue a key from the admin panel and call the gateway with it.
5. Point the Heleket webhook at `https://<your-url>/api/webhook` when you're ready
   to take payments.

---

## Environment Variables

See `backend/.env.example` for the annotated list. The ones worth calling out:

| Variable | Purpose |
|----------|---------|
| `FIREBASE_SERVICE_ACCOUNT` | The whole service-account JSON as one value — the easy path |
| `FIREBASE_PROJECT_ID`/`_CLIENT_EMAIL`/`_PRIVATE_KEY` | The same thing split in three, if you prefer |
| `SYNC_INTERVAL_MIN` | How often to re-check pending orders against Heleket (default 2) |
| `REAL_API_BASE_URL_1` / `REAL_API_KEY_1` | The upstream API you are reselling |
| `REAL_API_PATH_1` | Upstream path — defaults to `/admin/paid/key`, override if yours differs |
| `DEFAULT_API_TARGET` | `api1`, `api2`, or `both` — which upstream(s) seeded plans use |
| `UPSTREAM_TIMEOUT_MS` | How long to wait upstream before returning `504` (default 30000) |
| `ADMIN_SECRET` | Admin panel password. Use something long |
| `RENDER_URL` | Enables the 14-minute self-ping that keeps the free tier awake |

---

## API Reference

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (used by auto-ping) |
| GET | `/api/plans` | Active plans |
| POST | `/api/payment/create` | `{plan_id, email}` → Heleket payment URL |
| POST | `/api/webhook` | Heleket callback → mints the sub-key |
| GET | `/api/key/:email` | All keys for an email |
| GET | `/api/key/check/:subkey` | Validity check, does not consume a request |
| **GET** | **`/admin/paid/key`** | **Main gateway — validates, proxies, meters** |

### Admin (header `X-Admin-Token: <ADMIN_SECRET>`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | `{password}` → token |
| GET | `/api/admin/stats` | Revenue, key counts, plan split (cached 60s; `?fresh=1` to bypass) |
| GET | `/api/admin/keys?limit=50` | Keys with status |
| GET | `/api/admin/payments?limit=50` | Payment records |
| GET | `/api/admin/logs?limit=50` | Recent gateway calls |
| POST | `/api/admin/seed` | Write the 4 default plans (`?force=1` to overwrite) |
| GET | `/api/admin/plans` | All plans, including hidden ones |
| POST | `/api/admin/plans` | Create or update a plan |
| DELETE | `/api/admin/plans/:id` | Delete a plan (existing keys unaffected) |
| POST | `/api/admin/keys/create` | Issue a key by hand, no payment |
| POST | `/api/admin/keys/:id/deactivate` | Kill a key |
| POST | `/api/admin/keys/:id/activate` | Restore a key |

### Gateway response headers

`X-Gateway`, `X-Plan`, `X-Requests-Used`, `X-Requests-Left`, `X-Response-Time`.

### Error codes

| Status | Meaning |
|--------|---------|
| 401 | Key missing, malformed, unknown, deactivated, or expired |
| 429 | Plan request quota exhausted |
| 502 | Upstream unreachable |
| 504 | Upstream timed out |

Failed upstream calls (502 / 504) do **not** count against the customer's quota.

---

## Combining two upstream APIs

A plan's `api_target` decides where its keys route:

| `api_target` | Behaviour |
|---|---|
| `api1` / `api2` | One upstream. The response passes through byte-for-byte. |
| `both` | Both upstreams are called **in parallel** and merged into one response. |

Set `DEFAULT_API_TARGET=both` and re-seed with force to switch every plan over.

A combined response looks like this:

```json
{
  "success": true,
  "partial": false,
  "data":   { "name": "…", "operator": "…", "city": "…", "circle": "…" },
  "sources": {
    "api1": { "name": "…", "operator": "…" },
    "api2": { "city": "…", "circle": "…" }
  }
}
```

- `data` is a shallow merge of both APIs. If both return the same field name,
  api2 wins — which is why the untouched originals stay under `sources`.
- `partial: true` means one API answered and the other didn't. You still get the
  half that worked, and `X-Sources-Failed` names the one that broke.
- The call only costs the customer **one request** even though two go out.
- If *both* fail, the response is `502` and no quota is consumed.

Response headers `X-Sources` and `X-Sources-Failed` list which APIs contributed.

---

## How it works

**Lifetime plans.** `duration_days: null` on the plan and `expires_at: null` on the key mean
"never expires"; `requests_limit: null` means unlimited. The expiry cron and the validation
middleware both check for null explicitly, so lifetime keys are never swept up.

**Webhook idempotency.** Key minting (`utils/fulfillOrder.js`) runs inside a Firestore
transaction keyed on the order document. Heleket retrying a callback — or firing it twice —
can never mint a second key.

**Payments survive a missed webhook.** Webhooks do get lost: a wrong callback URL, or
Render's free tier asleep when Heleket fires. A customer who paid and got no key is the
worst failure this system has, so `utils/paymentSync.js` polls Heleket every couple of
minutes for orders still marked pending and fulfils any that were paid. It shares the same
transactional path as the webhook, so the two racing is harmless. Practically, this means
the webhook is an optimisation, not a hard requirement.

**Payment ordering.** The pending payment record is written *before* the Heleket invoice is
created. If it were the other way round and the write failed, a customer could pay against an
order the webhook cannot find.

**Signature verification.** Both directions use
`md5(base64(json(sorted_params)) + HELEKET_API_KEY)`, compared in constant time.

---

## Scheduled work

| Task | On Vercel | On Render |
|------|-----------|-----------|
| Expire keys past `expires_at` | `/api/cron/expire`, daily (Vercel Cron) | in-process cron, daily |
| Recover payments the webhook missed | `/api/cron/sync-payments`, daily (Hobby-tier cron cap) | in-process poller, every 2 min |
| Keep the free tier awake | not needed | `/health` self-ping every 14 min |

None of this gates access. **Expiry and request limits are enforced on every single
request** in `validateKey`; the scheduled sweep only tidies up the `is_active` flag
afterwards. A cron that never fires cannot let an expired key through.

Payments have a third path on top of the two above: while a customer waits on
`pay.html`, the page polls `/api/payment/status/:orderId`, which asks Heleket about
that order directly and issues the key the moment it reads paid.

---

## Security notes

- Real upstream keys live only in host environment variables — never in code, never in
  Firestore, and never in a response the customer can see.
- Admin auth compares the token in constant time and throttles login to 8 tries / 5 min / IP.
- Webhook signatures are verified before anything is written.
- The frontend has no database access; everything goes through the backend.
- `.env` and `firebase-service-account.json` are git-ignored.
- The admin token is the `ADMIN_SECRET` itself, held in `sessionStorage`. That is fine for a
  single-operator panel; if you ever add more operators, swap it for short-lived JWTs.

### Firestore rules

The backend uses the Admin SDK and bypasses rules, so lock the client out entirely:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## Customising

| What | Where |
|------|-------|
| Plan prices, durations, limits | Admin panel → **Plans** → New / Edit / Delete |
| Backend URL | `frontend/config.js` — only in split-deploy mode |
| Colours, fonts, spacing | `frontend/theme.css` |
| Default seeded plans | `backend/utils/seedPlans.js`, then `npm run seed` |
| Plan icons and gradients | `planMeta` in `frontend/index.html` |
| Upstream path | `REAL_API_PATH_1` / `REAL_API_PATH_2` env vars |
