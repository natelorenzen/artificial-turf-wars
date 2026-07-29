# Deploying

Live: **https://artificial-turf-wars.vercel.app** → will become **artificialturfwar.com**

Vercel project: `natelorenzens-projects/artificial-turf-wars`, deploying from `main` on
every push via the GitHub integration.

---

## Environment variables

Set in Vercel → Settings → Environment Variables, for Production, Preview and
Development. Values live in `.env.local` locally; that file is gitignored and is the
only copy of the secrets.

| Variable | Secret? | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | Public origin |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Publishable by design — RLS is what protects the data |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical origin for metadata and OG tags |
| `NEXT_PUBLIC_GA_ID` | no | Measurement ids are public; they ship in every page |
| `SEASON_YEAR` | no | |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | Bypasses RLS. Never prefix `NEXT_PUBLIC_` |
| `OPENROUTER_API_KEY` | **yes** | Billable. Never prefix `NEXT_PUBLIC_` |
| `CRON_SECRET` | **yes** | Every `/api/cron/*` route checks it |
| `DRAFT_SEED` | **yes** | Leave UNSET in production until the auction |
| `ALLOW_IRREVERSIBLE` | no | Leave UNSET. The auction and draft refuse to run without `1` |

**Adding an environment variable does not trigger a rebuild.** Pages prerender their
data at build time, so after saving variables you must redeploy — either hit Redeploy
on the latest deployment, or push a commit. Forgetting this is the most likely reason
the site looks like it has no data when the variables are clearly set.

The site is built to survive missing configuration: every database read is gated, so an
unconfigured deploy renders "no data yet" states rather than failing the build. Verified
by building with both Supabase variables unset.

---

## Custom domain: artificialturfwar.com on GoDaddy

### 1. Add the domain in Vercel first

Settings → Domains → Add. Enter `artificialturfwar.com`. Vercel will offer to add
`www` too — accept, and let it redirect to the apex.

**Then read the records off that page.** Do not use values from a blog post or from
memory:

- The **apex A record** IP is shown in the dashboard.
- The **`www` CNAME target is unique to your project** — it looks like
  `d1d4fc829fe7bc7c.vercel-dns-017.com`, not the generic `cname.vercel-dns.com` that
  older guides quote. A generic value will not verify.

### 2. Set the records in GoDaddy

GoDaddy → Domain Portfolio → `artificialturfwar.com` → DNS → DNS Records.

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | *(the IP Vercel shows)* | 600 seconds |
| CNAME | `www` | *(the unique target Vercel shows)* | 600 seconds |

Three GoDaddy-specific traps:

1. **Edit the existing records, do not add duplicates.** A new GoDaddy domain ships
   with a parked `A` record on `@` pointing at their own landing page, and usually a
   `www` CNAME pointing to `@`. Two conflicting A records on the apex will resolve
   unpredictably. Edit in place.
2. **Turn off Domain Forwarding.** GoDaddy's forwarding feature silently overrides DNS.
   If the domain was ever set to forward anywhere, disable it under Domain Settings →
   Forwarding, or the A record will appear to do nothing.
3. **GoDaddy has no ALIAS/ANAME record type**, so the apex must use an A record. That is
   why Vercel gives an IP rather than a hostname for the root.

Lower the TTL to 600 before you change anything if you can — GoDaddy defaults to an
hour, and a wrong value cached for an hour is a slow debugging loop.

### 3. Verify

Propagation is usually minutes on GoDaddy but can take longer. Check from a machine
that has not cached the old answer:

```bash
dig +short artificialturfwar.com A
dig +short www.artificialturfwar.com CNAME
curl -sI https://artificialturfwar.com | head -3
```

Vercel issues the TLS certificate automatically once the records resolve. Until it
does, HTTPS will fail while HTTP may already work — that is expected, not a
misconfiguration.

### 4. After it resolves

Confirm `NEXT_PUBLIC_SITE_URL` is `https://artificialturfwar.com` and redeploy, so
canonical URLs and OG tags point at the real domain rather than the `.vercel.app` one.

---

## Brand and image assets

The site brand is **singular** — "Artificial Turf War" — matching the domain. The
GitHub repo slug is still plural (`artificial-turf-wars`); renaming it would change the
repository URL, so it has been left alone deliberately.

Next.js wires these by filename. Drop the key art in and no code changes are needed:

| Path | Image |
|---|---|
| `src/app/icon.png` | Square ATW logo → favicon |
| `src/app/apple-icon.png` | Square ATW logo → iOS home screen |
| `src/app/opengraph-image.png` | Wide banner → link previews |
| `src/app/twitter-image.png` | Wide banner → X card |

Delete `src/app/favicon.ico` afterwards so the create-next-app default stops winning.

---

## Cron

`vercel.json` declares seven jobs — one daily ingest and six weekly. Hobby covers this:
100 cron jobs per project, and every entry here runs at most once per day. The only
Hobby cost is scheduling precision (±59 minutes), which the ≥4 hour slack before
kickoff absorbs, and the kickoff guard refuses to run a job that would land too late
regardless.

Cron delivery is best effort — Vercel may miss a run or deliver one twice and never
retries. The ingest is idempotent. The model-calling jobs are not yet, and need an
idempotency key before they ship.
