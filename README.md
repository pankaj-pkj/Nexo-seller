# ⚡ NexAPI v2 — Firebase API Reseller Gateway

A full-stack API reseller platform. Users pick a plan (Daily/Weekly/Monthly/Lifetime),
pay with USDT via Heleket, and instantly receive a sub-API key.
Your real API keys stay hidden — the gateway proxies all traffic.

```
Customer → GET /admin/paid/key?key=NK-XXX&num=919876543210
                    ↓
            NexAPI validates key
                    ↓
            Forwards to real API with real key
                    ↓
            Returns response to customer
```

---

## Stack

| Layer     | Service       | Free Tier              |
|-----------|---------------|------------------------|
| Backend   | Render.com    | 750 hrs/month          |
| Database  | Firebase      | 1 GB storage, 50K reads/day |
| Frontend  | Vercel        | Unlimited              |
| Payments  | Heleket       | 0% commission          |

---

## Project Structure

```
api-reseller/
├── backend/
│   ├── server.js                   Main Express app
│   ├── package.json
│   ├── .env.example                Copy → .env and fill values
│   ├── db/
│   │   └── firebase.js             Firebase Admin SDK init
│   ├── middleware/
│   │   └── validateKey.js          Sub-key validation middleware
│   ├── routes/
│   │   ├── plans.js                GET /api/plans
│   │   ├── payment.js              POST /api/payment/create
│   │   ├── webhook.js              POST /api/webhook  (Heleket callback)
│   │   ├── keys.js                 GET /api/key/:email
│   │   ├── proxy.js                GET /admin/paid/key  ← MAIN GATEWAY
│   │   └── admin.js                GET/POST /api/admin/*
│   └── utils/
│       ├── keygen.js               NK-XXXX key generator
│       ├── expiry.js               Daily cron cleanup
│       ├── ping.js                 Render auto-ping (prevents sleep)
│       └── seedPlans.js            Run once to seed 4 plans to Firebase
└── frontend/
    ├── index.html                  Landing page + plan selection
    ├── pay.html                    Payment status + key reveal
    ├── dashboard.html              User key management
    ├── admin.html                  Admin panel (password protected)
    └── docs.html                   API documentation
```

---

## STEP-BY-STEP SETUP

---

### STEP 1 — Firebase Project

1. Go to **https://console.firebase.google.com**
2. Click **"Add project"** → give it a name → create
3. In left sidebar → **Build → Firestore Database**
4. Click **"Create database"** → choose **Production mode** → select a region → Done

**Get service account credentials:**

5. Click the ⚙️ gear icon → **Project settings**
6. Go to **"Service accounts"** tab
7. Click **"Generate new private key"** → Download the JSON file
8. Open the JSON file — you need these 3 values:
   ```
   "project_id"    → FIREBASE_PROJECT_ID
   "client_email"  → FIREBASE_CLIENT_EMAIL
   "private_key"   → FIREBASE_PRIVATE_KEY
   ```

> ⚠️ The `private_key` looks like:
> `-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n`
> Copy the entire thing including the `-----BEGIN/END-----` lines.

**Set Firestore security rules** (so only your backend can write):

9. Firestore → Rules → paste this → Publish:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /plans/{id} {
      allow read: if true;
      allow write: if false;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

### STEP 2 — Backend on Render.com

1. Push the `backend/` folder to a **GitHub repo**
2. Go to **https://render.com** → New → **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name:** nexapi-backend (or anything)
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Click **"Add Environment Variables"** and add all of these:

```
FIREBASE_PROJECT_ID       = your-firebase-project-id
FIREBASE_CLIENT_EMAIL     = firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY      = -----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n

REAL_API_KEY_1            = your_real_upstream_api_key
REAL_API_BASE_URL_1       = https://real-api.example.com

REAL_API_KEY_2            = your_second_api_key (optional)
REAL_API_BASE_URL_2       = https://real-api-2.example.com (optional)

HELEKET_MERCHANT          = your-heleket-merchant-uuid
HELEKET_API_KEY           = your-heleket-api-key
HELEKET_BASE_URL          = https://api.heleket.com

ADMIN_SECRET              = choose_a_strong_password_here

PORT                      = 3000
BACKEND_URL               = https://nexapi-backend.onrender.com  ← fill after deploy
FRONTEND_URL              = https://your-site.vercel.app         ← fill after deploy
HELEKET_RETURN            = https://your-site.vercel.app/pay.html

RENDER_URL                = https://nexapi-backend.onrender.com  ← same as BACKEND_URL
```

6. Click **Deploy**
7. Copy your Render URL → update `BACKEND_URL`, `RENDER_URL`, `HELEKET_RETURN` in env vars

> ⚠️ For `FIREBASE_PRIVATE_KEY` in Render's env var editor:
> Paste the key with literal `\n` characters (not actual newlines).
> The code handles this automatically with `.replace(/\\n/g, '\n')`.

---

### STEP 3 — Seed Plans to Firebase

After backend is deployed, run this **once** to add the 4 plans:

**Option A — Run locally:**
```bash
cd backend
cp .env.example .env
# Fill your .env with real values
npm install
npm run seed
```

**Option B — Render Shell (if local setup is hard):**
1. Render dashboard → your service → **Shell** tab
2. Run: `node utils/seedPlans.js`

You should see:
```
✓ Daily    — $2 USDT
✓ Weekly   — $8 USDT
✓ Monthly  — $25 USDT
✓ Lifetime — $60 USDT

Done! All plans seeded.
```

---

### STEP 4 — Frontend on Vercel

1. Push the `frontend/` folder to GitHub (can be same or separate repo)
2. Go to **https://vercel.com** → New Project → Import repo
3. Set **Root Directory** to `frontend` if in the same repo
4. Deploy → copy your Vercel URL

**Update BACKEND URL in all 5 HTML files:**

Search for this line in each file and replace with your Render URL:
```javascript
const BACKEND = 'https://your-backend.onrender.com'; // ← CHANGE THIS
```

Files to update:
- `frontend/index.html`
- `frontend/pay.html`
- `frontend/dashboard.html`
- `frontend/admin.html`
- `frontend/docs.html`

---

### STEP 5 — Heleket Webhook

1. Log into your Heleket merchant dashboard
2. Find **Webhook / Callback URL** setting
3. Set it to:
   ```
   https://nexapi-backend.onrender.com/api/webhook
   ```
4. Save

This URL is called automatically when a customer's payment confirms.

---

### STEP 6 — Verify Everything

```bash
# 1. Backend health check
curl https://nexapi-backend.onrender.com/health

# Expected:
# {"status":"online","gateway":"NexAPI v2","timestamp":"..."}

# 2. Plans loading
curl https://nexapi-backend.onrender.com/api/plans

# Expected:
# {"success":true,"plans":[{"id":"daily",...},{"id":"weekly",...},...]}

# 3. Test gateway with a real key (after buying a plan)
curl "https://nexapi-backend.onrender.com/admin/paid/key?key=NK-XXXXXXXX-XXXXXXXX-XXXXXXXX&num=919876543210"
```

---

## API Reference

### Main Gateway

```
GET /admin/paid/key?key=NK-YOUR-KEY&num=PHONE_NUMBER
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `key`     | ✅ Yes   | Your sub-API key (NK-XXXX format) |
| `num`     | Optional | Phone number or primary input |
| `…others` | Optional | Any extra params forwarded to real API |

**Example response headers:**
```
X-Gateway:        NexAPI
X-Plan:           Monthly
X-Requests-Used:  143
X-Requests-Left:  9857
```

### Other Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health |
| GET | `/api/plans` | List active plans |
| POST | `/api/payment/create` | Create Heleket payment invoice |
| POST | `/api/webhook` | Heleket payment callback (auto) |
| GET | `/api/key/:email` | Get user's API keys by email |
| GET | `/api/key/check/:subkey` | Validate a key |
| POST | `/api/admin/login` | Admin login |
| GET | `/api/admin/stats` | Revenue & usage stats |
| GET | `/api/admin/keys` | All API keys |
| GET | `/api/admin/payments` | All payments |
| POST | `/api/admin/keys/:id/deactivate` | Deactivate a key |
| POST | `/api/admin/keys/:id/activate` | Re-activate a key |

---

## Plans (Edit in Firebase)

| Plan | Price | Duration | Requests |
|------|-------|----------|----------|
| Daily | $2 USDT | 1 day | 100 |
| Weekly | $8 USDT | 7 days | 1,000 |
| Monthly | $25 USDT | 30 days | 10,000 |
| Lifetime | $60 USDT | Never expires | Unlimited |

**To change prices** — edit directly in Firebase Console:
1. Firestore → `plans` collection → click a plan doc → edit `price_usd`

**To add a plan** — edit `utils/seedPlans.js`, add entry, run seed again.

---

## Local Development

```bash
cd backend
cp .env.example .env
# Fill in all values in .env
npm install
npm run dev        # nodemon auto-restarts on file changes
```

Backend: `http://localhost:3000`

For frontend, open HTML files directly in browser, or use VS Code Live Server.

---

## Render Auto-Ping (Prevents Sleep)

The `utils/ping.js` utility pings `RENDER_URL/health` every **14 minutes** automatically.
Free Render services sleep after 15 minutes of inactivity — this prevents that.

Just make sure `RENDER_URL` is set in your environment variables.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Plans not loading on frontend | Check `BACKEND` constant in `index.html` matches your Render URL |
| Firebase auth error on startup | Make sure `FIREBASE_PRIVATE_KEY` has `\n` not actual newlines in Render env vars |
| Payment not redirecting | Check `HELEKET_MERCHANT` and `HELEKET_API_KEY` in .env |
| Key not generated after payment | Go to Render logs, look for `[WEBHOOK]` lines. Check webhook URL is set in Heleket dashboard |
| Proxy returns "Real API not configured" | Set `REAL_API_KEY_1` and `REAL_API_BASE_URL_1` in env vars |
| Admin login fails | Check `ADMIN_SECRET` in env matches what you type in admin.html |
| Render service sleeping | Make sure `RENDER_URL` env var is set to your Render URL |
| Firebase "missing index" error | Check Firestore → Indexes tab, create the index it suggests |

---

## Firebase Firestore Collections

```
plans/           → Subscription plans (seeded by seedPlans.js)
payments/        → Payment records (created on checkout)
api_keys/        → Generated sub-keys (created on payment confirmation)
usage_logs/      → API call logs (created on each proxied request)
```

---

## Security Notes

- Real API keys are **never** exposed to customers
- Admin panel is password protected via `ADMIN_SECRET`
- Heleket webhooks are verified with MD5 signature
- Lifetime keys have `expires_at: null` — never expire
- All key validation happens server-side on every request
