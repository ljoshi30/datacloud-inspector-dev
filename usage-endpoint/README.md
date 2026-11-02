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
3. `wrangler secret put FIREBASE_SA`   → paste the ENTIRE service-account JSON when prompted
4. `wrangler secret put REPORT_TOKEN`  → any strong password
5. `wrangler deploy`
6. View: `https://<your-worker-url>/report?token=YOUR_REPORT_TOKEN`

## Notes
- No D1 anymore (the old D1 path was CSP-dead for writes and is retired).
- Reads are paged (pageSize 300). The Worker tries both `/databases/(default)/` and `/databases/default/`
  REST paths since this project's db id is literally `default`.
- Delete data anytime in the Firebase console → Firestore → Data.
