# NexAPI — Vercel Setup Guide

Deploy the whole thing — backend, frontend, gateway, admin panel — to Vercel.
One project, one deploy.

- **Time:** ~25 minutes, once
- **Cost:** ₹0 (Vercel Hobby + Firebase Spark, both free)
- **Laptop:** not needed. Every step works in a phone browser.

---

## छोटा सा overview (Hinglish)

3 cheezein chahiye: **Firebase** (database), **Vercel** (hosting), **Heleket** (payment).
Heleket sabse aakhir me — pehle bina payment ke test kar lena.

| Step | Kya karna hai | Time |
|---|---|---|
| 1 | Firebase project banao, JSON download karo | 5 min |
| 2 | Vercel pe deploy karo + env vars daalo | 10 min |
| 3 | URL milne pe `BACKEND_URL` add karke redeploy | 2 min |
| 4 | Admin panel me plans banao | 3 min |
| 5 | Manual key bana ke test karo | 2 min |
| 6 | Heleket jodo (jab bechna ho) | 5 min |

---

## Before you start

Create these three free accounts:

| Service | What it does | Sign up |
|---|---|---|
| **Firebase** | Stores your keys, plans and payments | console.firebase.google.com |
| **Vercel** | Runs the whole app | vercel.com (sign in with GitHub) |
| **Heleket** | Takes USDT payments | heleket.com — *skip for now* |

You also need your repo on GitHub. If you are reading this from the repo, that's done.

---

# Step 1 — Firebase

### 1.1 Create the project

1. Open **console.firebase.google.com**
2. **Add project** → type any name (e.g. `nexapi`) → **Continue**
3. Google Analytics: turn it **off** → **Create project**
4. Wait ~30 seconds → **Continue**

### 1.2 Turn on the database

1. Left menu → **Build** → **Firestore Database**
2. **Create database**
3. Choose **Production mode** → **Next**
4. Pick a region close to your users (`asia-south1` for India) → **Enable**

### 1.3 Get your credentials

1. Click the **⚙️ gear** icon (top left) → **Project settings**
2. Open the **Service accounts** tab
3. Click **Generate new private key** → **Generate key**
4. A `.json` file downloads

### 1.4 Copy the file contents

Open that `.json` file and copy **everything** — from the very first `{` to the
very last `}`.

> 📱 **On a phone:** the file lands in Downloads. Open it with any text editor,
> or with Google Drive. Select all, copy.

You'll paste this as **one single value** in Step 2. Don't try to pull individual
fields out of it.

✅ **You should now have:** a long block of text starting with
`{"type":"service_account","project_id":"..."`

### 1.5 Lock the database down

1. Firestore Database → **Rules** tab
2. Delete what's there, paste this in:

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

3. **Publish**

This blocks everyone. Your backend uses the Admin SDK, which bypasses these
rules, so it keeps working — but nobody else can touch your data.

> **No indexes to create.** Firestore sometimes demands hand-built composite
> indexes. This app deliberately avoids the query shapes that need them, so
> there is nothing to do here.

---

# Step 2 — Deploy to Vercel

### 2.1 Import the project

1. Open **vercel.com** → sign in with GitHub
2. **Add New** → **Project**
3. Find your `Nexo-seller` repo → **Import**

### 2.2 Settings — read this carefully

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Root Directory | **leave it alone** (repository root) |
| Build Command | leave empty |
| Output Directory | leave empty |

> ⚠️ **Do not set Root Directory to `backend` or `frontend`.** Vercel needs the
> repo root — `api/index.js` lives there and pulls in both halves.

### 2.3 Environment variables

Expand **Environment Variables** and add each of these:

**Required:**

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the whole JSON from Step 1.4 |
| `ADMIN_SECRET` | a long random password you invent |
| `CRON_SECRET` | another long random string |
| `REAL_API_BASE_URL_1` | `https://sms-api-hub.vercel.app` |
| `REAL_API_PATH_1` | `/api/trigger` |

**For a second API (merged responses):**

| Name | Value |
|---|---|
| `REAL_API_BASE_URL_2` | `https://sms-api-hub2.vercel.app` |
| `REAL_API_PATH_2` | `/api/trigger` |
| `DEFAULT_API_TARGET` | `both` |

**If your upstream API needs a key:**

| Name | Value |
|---|---|
| `REAL_API_KEY_1` | your upstream secret |
| `REAL_API_KEY_PARAM_1` | the param name it expects — `key`, `apikey`, `token`… |

Leave these out entirely if your API is open.

#### How to split a URL

```
https://sms-api-hub.vercel.app/api/trigger
└──────────── BASE_URL ──────┘└── PATH ──┘
```

The domain goes in `REAL_API_BASE_URL_1`. Everything after it goes in
`REAL_API_PATH_1`. Query params (`?num=…`) go in neither — customers supply
those, and they're forwarded automatically.

### 2.4 Deploy

Click **Deploy**. Takes 2–3 minutes.

✅ **You should see:** a congratulations screen with your URL, something like
`https://nexo-seller-abc123.vercel.app`

**Copy that URL.** It's referred to as `<YOUR-URL>` from here on.

---

# Step 3 — Point the app at itself

The app needs to know its own address for payment redirects.

1. Vercel → your project → **Settings** → **Environment Variables**
2. Add one more:

| Name | Value |
|---|---|
| `BACKEND_URL` | `<YOUR-URL>` |

3. Go to **Deployments** → newest one → **⋯** menu → **Redeploy** → **Redeploy**

✅ **Test it:** open `<YOUR-URL>/health` in a browser. You should see:

```json
{"status":"online","gateway":"NexAPI v2","platform":"vercel",...}
```

If you see that, the backend is alive.

---

# Step 4 — Create your plans

1. Open `<YOUR-URL>/admin.html`
2. Enter your `ADMIN_SECRET` → **Enter Dashboard**

You'll see an orange **One-time setup** box because there are no plans yet.

### Quick way

Click **Seed default plans** — creates Daily ($2), Weekly ($8), Monthly ($25)
and Lifetime ($60).

### Your own plans

**Plans** section → **+ New Plan**:

| Field | What it does |
|---|---|
| Plan name | Shown to customers |
| Price (USDT) | What they pay |
| Request limit | How many API calls they get. **Blank = unlimited** |
| Validity | A number + Days / Weeks / Months / Years, or **Lifetime** |
| Routes to | **Both APIs (merged)** hits api1 and api2 together |
| Colour | The card colour on the pricing page |
| Description | One line under the plan name |
| Features | One per line — shown as a ticked list |

**Edit** changes a plan any time. **Delete** removes it from the pricing page;
keys already sold keep working until they expire.

✅ **Check:** open `<YOUR-URL>` — your plans should be on the landing page.

---

# Step 5 — Test the gateway (no payment needed)

Still in the admin panel:

1. **Issue a Key Manually** → your email → pick a plan → **Create Key**
2. A key appears: `NK-XXXXXXXX-XXXXXXXX-XXXXXXXX` — copy it
3. Open this in a browser tab:

```
<YOUR-URL>/admin/paid/key?key=NK-XXXXXXXX-XXXXXXXX-XXXXXXXX&num=919876543210
```

✅ **You should see** JSON with both APIs' data merged:

```json
{
  "success": true,
  "partial": false,
  "data":    { "...api1 fields...", "...api2 fields..." },
  "sources": {
    "api1": { "...api1's untouched response..." },
    "api2": { "...api2's untouched response..." }
  }
}
```

…and the OTP should actually arrive on that number.

**That's the product working.** This URL is what you sell.

4. Open `<YOUR-URL>/dashboard.html`, type that email — you'll see the key, its
   usage ring and a live expiry countdown.

---

# Step 6 — Heleket (when you're ready to sell)

Everything above works without this. Do it when you want to take real money.

### 6.1 Get your credentials

1. Sign up at **heleket.com**, complete merchant verification
2. Dashboard → API section → copy **Merchant UUID** and **API key**

### 6.2 Add them to Vercel

Settings → Environment Variables:

| Name | Value |
|---|---|
| `HELEKET_MERCHANT` | your merchant UUID |
| `HELEKET_API_KEY` | your API key |
| `HELEKET_BASE_URL` | `https://api.heleket.com` |

Then **Redeploy**.

### 6.3 Set the webhook

In the Heleket dashboard, find **Webhook URL** / **Callback URL** and set it to:

```
<YOUR-URL>/api/webhook
```

**What a webhook is:** when a customer's payment clears, Heleket sends a message
to your app saying "order NX123 is paid". Your app then creates the key.

**If you can't find that setting, don't worry.** Two other things already cover
it:

1. While the customer waits on the payment page, that page asks Heleket about
   their order directly every 5 seconds — and the key is created the moment
   Heleket says paid.
2. An hourly scheduled job sweeps up anything still pending.

So the webhook only makes keys arrive a few seconds sooner. **No customer's
payment can get lost without it.**

### 6.4 Test a real purchase

1. Open `<YOUR-URL>` → click a cheap plan → enter an email → **Pay with USDT**
2. Complete the payment on Heleket's page
3. You'll land back on the payment page — the key appears within seconds

---

# What runs automatically

You don't have to do anything for these.

| Job | When it runs |
|---|---|
| Reject expired keys | Every single request |
| Reject keys past their request limit | Every single request |
| Mark expired keys inactive | Daily at midnight (Vercel Cron) |
| Recover payments the webhook missed | Hourly (Vercel Cron) + live on the payment page |
| Count requests used | Every successful call |

---

# Troubleshooting

### "Could not load plans" on the home page

Firebase credentials aren't right. Vercel → your project → **Logs**.

- `FIREBASE_SERVICE_ACCOUNT is not valid JSON` → the paste got cut off. Copy the
  file again; make sure it starts with `{` and ends with `}`.
- `No Firebase credentials found` → the variable name is misspelled, or you
  never redeployed after adding it.

### Admin panel says "Cannot reach …"

`ADMIN_SECRET` isn't set, or you didn't redeploy after adding it. Environment
variable changes only take effect on the next deploy.

### Gateway says "Real API not configured"

`REAL_API_BASE_URL_1` is missing or wrong. It must be **only the domain**:

- ✅ `https://sms-api-hub.vercel.app`
- ❌ `https://sms-api-hub.vercel.app/api/trigger` (the path goes in `REAL_API_PATH_1`)

### Gateway returns 504

Your upstream took longer than the 30-second default. Add
`UPSTREAM_TIMEOUT_MS` = `55000`. Don't go past 55000 — Vercel kills the function
at 60 seconds regardless.

### Gateway returns `"partial": true`

One API answered, the other didn't. The customer still got the half that worked.
Check `X-Sources-Failed` in the response headers to see which one broke.

### A customer paid but got no key

1. Open `<YOUR-URL>/dashboard.html` and look up their email — the hourly sweep
   has probably already issued it
2. If not, check `HELEKET_API_KEY` is correct in Vercel
3. As a stopgap, issue the key by hand from the admin panel

### 404 on every page

Root Directory is set to `backend` or `frontend` in Vercel. It must be the
repository root. Settings → General → Root Directory → clear it → Redeploy.

---

# Environment variable reference

### Required

| Name | Example |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | `{"type":"service_account",...}` |
| `ADMIN_SECRET` | `NexApi#7Kx9-mQz4Lp2-Vw8Rt6Nb` |
| `CRON_SECRET` | `c8f2a91b4d7e3006` |
| `REAL_API_BASE_URL_1` | `https://sms-api-hub.vercel.app` |
| `BACKEND_URL` | `https://your-project.vercel.app` |

### Optional

| Name | Default | What it does |
|---|---|---|
| `REAL_API_PATH_1` | `/admin/paid/key` | Path on your upstream API |
| `REAL_API_KEY_1` | *(none)* | Secret for your upstream, if it needs one |
| `REAL_API_KEY_PARAM_1` | `key` | Query param the secret travels in |
| `REAL_API_BASE_URL_2` etc. | — | Same four settings for a second API |
| `DEFAULT_API_TARGET` | `api1` | `api1`, `api2`, or `both` for new plans |
| `UPSTREAM_TIMEOUT_MS` | `30000` | Give up on the upstream after this |
| `HELEKET_MERCHANT` | — | Merchant UUID |
| `HELEKET_API_KEY` | — | Heleket API key |
| `HELEKET_BASE_URL` | `https://api.heleket.com` | Heleket endpoint |

### Not needed on Vercel

`PORT`, `RENDER_URL`, `SYNC_INTERVAL_MIN`, `FRONTEND_URL`, `HELEKET_RETURN` —
these are for the Render setup or are derived automatically.

---

# Changing things later

| What | Where |
|---|---|
| Prices, durations, limits, new plans | Admin panel → Plans |
| Which API a plan routes to | Admin panel → Plans → Edit → Routes to |
| Your upstream API URLs | Vercel → Settings → Environment Variables |
| Colours, fonts | `frontend/theme.css` |
| Landing page wording | `frontend/index.html` |

Push to GitHub and Vercel redeploys on its own. Environment variable changes
need a manual redeploy.

---

# Running it on Render instead

Everything also runs as a normal long-lived Node server, where the cron and the
payment poller run in-process instead of via Vercel Cron.

Import the repo at Render as a **Blueprint** (it reads `render.yaml`), or create
a Web Service with Root Directory `backend`, build `npm install`, start
`npm start`. Add `RENDER_URL` so the self-ping keeps the free tier awake.

The rest of this guide applies unchanged.
