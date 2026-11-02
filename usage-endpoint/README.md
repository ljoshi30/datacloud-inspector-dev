# Data 360 Inspector — Usage Report (Cloudflare Worker → reads Firestore)

## How it fits together
- **The tool writes pings DIRECTLY to Firestore** (`firestore.googleapis.com` — the only cross-origin
  host Salesforce page CSP allows; our own Worker domain is blocked, which is why writes don't come here).
  Each ping: `{ iid, v, page, day, build, org, ts }` — anonymous (random browser id + org my-domain host;
  no username / record / field data). Stored in the Firestore `usage` collection.
- **This Worker is READ-ONLY.** It authenticates to Firestore with a Firebase **service-account** key,
  queries `usage`, computes adoption metrics, and serves a **password-gated** `/report`. Firestore stays
  read-locked to the public (security rule: public *create* only, **no public read**) — only this Worker
  can read.

## Report shows (PUBLIC vs DEV, from the `build` tag)
Active users (all-time / weekly / monthly), **returning** (seen >1 day), **orgs**, per-feature, per-org,
per-version, **per-user roster** (first-seen, last-seen, days-active, feature breadth, recency bucket),
and daily-active trend. CSV export too.

## Firestore security rule (set in Firebase console → Firestore → Rules → Publish)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /usage/{doc} {
      allow create: if request.resource.data.keys().hasOnly(['iid','v','page','day','build','org','ts'])
                    && request.resource.data.iid is string
                    && request.resource.data.iid.size() < 50;
      allow read, update, delete: if false;   // public cannot read; the Worker reads via service account
    }
  }
}
```
NOTE: `org` is now in the allow-list. Until you publish this, pings that include `org` are REJECTED.

## Deploy the report Worker (one time)
1. Firebase console → **Project settings → Service accounts → Generate new private key** → download JSON.
2. `cd usage-endpoint`
3. `wrangler secret put FIREBASE_SA`    → paste the ENTIRE service-account JSON when prompted
4. `wrangler secret put REPORT_TOKEN`   → ADMIN password (sees Public + Dev/internal)
5. `wrangler secret put MANAGER_TOKEN`  → MANAGER password (sees ONLY the Public bookmarklet section) — share this one
6. `wrangler secret put DEV_TOKEN`      → DEV password (sees ONLY the Dev/internal section) — optional, for dev teammates
7. `wrangler deploy`
8. View: open `https://<your-worker-url>/` → you get a **sign-in page** (no token in the URL).

## Sign-in & sharing (token is NOT in the URL anymore)
- Open the worker root or `/report`. If not signed in you get a **login form**; enter a password.
- On success the Worker sets an **HttpOnly, Secure, SameSite=Lax session cookie** (12h) and redirects to a
  clean `/report` URL — the password never appears in the address bar or browser history. JS can't read the cookie.
- `/logout` clears the session.
- **Three roles (by password) AND three dedicated URLs:**
  - **Admin** (`REPORT_TOKEN`) → sees 🌐 Public **and** 🧪 Dev/internal; CSV for either build.
  - **Manager** (`MANAGER_TOKEN`) → sees **only** 🌐 Public (the bookmarklet shared with users); CSV = public only.
    No dev iid/org/version ever reaches this view (filtered server-side, verified).
  - **Dev** (`DEV_TOKEN`, optional) → sees **only** 🧪 Dev/internal; CSV = dev only. No public data reaches this view.

- **Dedicated dashboard URLs** (each still asks for a password):
  | URL | Shows | Give the password of |
  |---|---|---|
  | `/report` | whatever the signed-in password allows | (generic) |
  | `/admin` | Public + Dev | admin |
  | `/manager` | Public only | manager — **share this one** |
  | `/dev` | Dev only | dev |

  The **URL caps the view and the password caps it again — whichever is more restrictive wins.** So `/manager`
  can NEVER show dev data even if someone signs in there with the admin password (it's scoped down to public);
  a dev password at `/manager` is blocked outright. CSV equivalents: `/admin.csv`, `/manager.csv`, `/dev.csv`.
- To share with your manager: send them `https://<your-worker-url>/` **and** the MANAGER_TOKEN password separately
  (not in the same message/URL). They sign in once; the cookie keeps them in for 12h.
- A one-time `...?token=PASSWORD` link still works for convenience — the Worker immediately moves it into the
  cookie and strips it from the URL via a redirect, so it isn't left sitting in the address bar.
- The signed-in page is served `Cache-Control: no-store` and reads Firestore **live on every load** (a pulsing
  "LIVE · generated … UTC" badge shows the fetch time) — refresh for the latest numbers.

## Notes
- No D1 anymore (the old D1 path was CSP-dead for writes and is retired).
- Reads are paged (pageSize 300). The Worker tries both `/databases/(default)/` and `/databases/default/`
  REST paths since this project's db id is literally `default`.
- Delete data anytime in the Firebase console → Firestore → Data.
