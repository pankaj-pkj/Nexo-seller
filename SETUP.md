# NexAPI — Setup Guide (Vercel + Heleket)

Everything on Vercel: backend, frontend, gateway, admin panel. One deploy.
Firebase stores the data. Heleket takes the payments.

**Time needed:** about 25 minutes, one time.
**Laptop needed:** no. All of this works from a phone browser.

---

## What you will end up with

```
https://your-project.vercel.app                 ← landing page + plans
https://your-project.vercel.app/admin.html      ← your admin panel
https://your-project.vercel.app/dashboard.html  ← where customers find their keys
https://your-project.vercel.app/docs.html       ← API docs for customers

https://your-project.vercel.app/admin/paid/key?key=NK-XXXX&num=7282828
                                                ← what you actually sell
```

Your real API URL never appears anywhere a customer can see.

---

## Step 1 — Firebase (the database)

1. Open **console.firebase.google.com** → **Add project** → name it → Create.
   (Google Analytics can be turned off.)
2. Left menu → **Build → Firestore Database** → **Create database**
   → choose **Production mode** → pick a region (`asia-south1` for India) → Enable.
3. ⚙️ **Project settings** → **Service accounts** tab → **Generate new private key**.
   A `.json` file downloads.
4. Open that file and **copy the whole thing** — from the first `{` to the last `}`.
   You will paste it as a single value in Step 3. There is no need to pick
   individual fields out of it.

### Lock the database down

Firestore → **Rules** tab → replace everything with this → **Publish**:

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

The backend uses the Admin SDK, which bypasses these rules. This blocks
everyone else. No indexes need creating — the app avoids queries that require
them.

---

## Step 2 — Heleket (the payments)

Skip this whole step if you just want to test first. Keys can be issued by hand
from the admin panel without any payment provider.

1. Sign up at **heleket.com** and complete merchant verification.
2. In the dashboard find the API section and copy two values:
   - **Merchant UUID**
   - **API key**
3. Leave the webhook alone for now — it is set in Step 5, once you have a URL.

---

## Step 3 — Deploy to Vercel

1. Go to **vercel.com** → sign in with GitHub.
2. **Add New → Project** → import your `Nexo-seller` repository.
3. **Do not change the Root Directory.** Leave it at the repository root.
   Framework Preset: **Other**.
4. Expand **Environment Variables** and add these:

| Name | Value |
|------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | the entire JSON you copied in Step 1 |
| `ADMIN_SECRET` | a long random password you invent — this logs you into the admin panel |
| `REAL_API_BASE_URL_1` | `https://sms-api-hub.vercel.app` |
| `REAL_API_PATH_1` | `/api/trigger` |
| `REAL_API_BASE_URL_2` | `https://sms-api-hub2.vercel.app` |
| `REAL_API_PATH_2` | `/api/trigger` |
| `DEFAULT_API_TARGET` | `both` |
| `CRON_SECRET` | another long random string (Vercel uses it to call the scheduled jobs) |

Add these too if you did Step 2:

| Name | Value |
|------|-------|
| `HELEKET_MERCHANT` | your merchant UUID |
| `HELEKET_API_KEY` | your Heleket API key |
| `HELEKET_BASE_URL` | `https://api.heleket.com` |

5. **Deploy**. Two to three minutes.
6. Vercel gives you a URL like `https://nexo-seller-abc123.vercel.app`.
   Copy it.
7. Go to **Settings → Environment Variables** and add one more:

| `BACKEND_URL` | your Vercel URL |

8. **Deployments → ⋯ → Redeploy** so it picks that up.

> `REAL_API_KEY_1` / `REAL_API_KEY_2` are only needed if your upstream API
> requires a key. If it does, add them — and if the upstream expects the key
> under a different query parameter name, set `REAL_API_KEY_PARAM_1` to that
> name (`apikey`, `token`, whatever it wants).

---

## Step 4 — Create your plans

1. Open `https://your-project.vercel.app/admin.html`
2. Log in with your `ADMIN_SECRET`.
3. Either click **Seed default plans** for the standard four, or use
   **Plans → + New Plan** to build your own:

   - **Plan name** and **Price (USDT)**
   - **Request limit** — leave blank for unlimited
   - **Validity** — a number plus Days / Weeks / Months / Years, or **Lifetime**
   - **Routes to** — pick **Both APIs (merged)** to hit api1 and api2 together
   - **Colour**, **description**, **features** (one per line)

   **Edit** changes a plan later. **Delete** removes it from the pricing page —
   keys already sold keep working until they expire.

---

## Step 5 — Heleket webhook

Skip if you skipped Step 2.

In the Heleket dashboard, find **Webhook URL** or **Callback URL** and set it to:

```
https://your-project.vercel.app/api/webhook
```

Save.

**If you cannot find that setting, it does not matter.** The payment page asks
Heleket about the order directly while the customer waits, and an hourly
scheduled job sweeps up anything still pending. The webhook only makes keys
arrive a few seconds sooner. Nobody's payment gets lost without it.

---

## Step 6 — Test it

Still in the admin panel:

1. **Issue a Key Manually** → your email → pick a plan → **Create Key**.
2. Copy the key and open this in a browser tab:

```
https://your-project.vercel.app/admin/paid/key?key=NK-XXXX-XXXX-XXXX&num=7282828
```

You should get JSON back with both APIs' responses merged, and the OTPs should
actually send. If so, everything works.

3. Open `dashboard.html`, enter that email — the key, its usage and a live
   expiry countdown should all be there.

---

## What runs on its own

| Job | When |
|-----|------|
| Reject expired keys | Checked on every single request |
| Reject keys over their request limit | Checked on every single request |
| Mark expired keys inactive | Daily at midnight (Vercel Cron) |
| Catch payments the webhook missed | Every hour (Vercel Cron), plus live while the customer is on the payment page |
| Count requests | On every successful call |

Nothing here needs your attention.

---

## Troubleshooting

**Plans do not load on the home page**
Firebase credentials are wrong. Vercel → your project → **Logs**. If it says
`FIREBASE_SERVICE_ACCOUNT is not valid JSON`, the paste got truncated — copy the
file again and make sure it starts with `{` and ends with `}`.

**Admin panel says "Cannot reach …"**
`ADMIN_SECRET` is not set, or the redeploy after adding it never happened.

**Gateway returns "Real API not configured"**
`REAL_API_BASE_URL_1` is missing. The base URL is only the domain part —
`https://sms-api-hub.vercel.app`, with the rest (`/api/trigger`) going in
`REAL_API_PATH_1`.

**Gateway returns 504**
Your upstream API took longer than `UPSTREAM_TIMEOUT_MS` (30s by default). If
your API is genuinely slow, raise it — up to 55000, since the Vercel function
itself is capped at 60 seconds.

**A customer paid and got no key**
Open `dashboard.html` and look their email up — the hourly sweep has probably
already issued it. If not, check `HELEKET_API_KEY` is correct, then issue a key
by hand from the admin panel.

---

## Where to change things later

| What | Where |
|------|-------|
| Prices, durations, limits, new plans | Admin panel → Plans |
| Which API(s) a plan uses | Admin panel → Plans → Edit → Routes to |
| Your upstream API URLs | Vercel environment variables |
| Colours and fonts | `frontend/theme.css` |
| Landing page wording | `frontend/index.html` |

Every code change auto-deploys when you push to GitHub.
