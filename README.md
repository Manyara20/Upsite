# Upsite

A futuristic uptime monitoring platform, built on Upptime's core idea — **the
config file is the product** — but running as a live application instead of a
static site.

**No database.** Configuration is one YAML file; state is plain files under
`.data/`. Nothing else to provision.

---

## How it works

```
upsite.config.yaml ──► config.ts ──► engine.ts (one timer per monitor)
                                        │
                                        ├─► checker.ts   HTTP / TCP probe
                                        ├─► store.ts     memory + .data/*.jsonl
                                        ├─► events.ts ──► /api/stream (SSE) ──► dashboard
                                        └─► notify.ts    webhooks / Slack
```

The scheduler boots from `instrumentation.ts`, which Next runs once per server
process. Each monitor gets its own self-rescheduling timer, so a slow check
never delays an unrelated fast one, and an in-flight check is never allowed to
overlap itself.

Reads are served entirely from memory — the dashboard's first paint is
server-rendered from the store, and the browser then receives every subsequent
check over a single SSE connection. **It never polls.**

### Where the data lives

| Path | Contents |
|---|---|
| `.data/monitors/<id>.jsonl` | append-only recent checks (compacted on a threshold) |
| `.data/monitors/<id>.daily.json` | calendar-day rollups, 90 days |
| `.data/state.json` | current status per monitor |
| `.data/incidents.json` | incident log |

Raw checks are capped by `retention.recentChecks`; anything older survives only
as a daily rollup. That keeps disk use flat regardless of uptime, and it is why
90-day history costs kilobytes rather than a database.

State/rollup writes are debounced and batched; every file is written to a temp
path and renamed, so a crash can never leave a half-written file.

---

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

---

## Configuration

Everything lives in `upsite.config.yaml`. Any string may reference an
environment variable as `${VAR}`, so tokens never have to be committed.

```yaml
site:
  name: Upsite
  tagline: Real-time uptime intelligence

defaults:
  intervalSeconds: 60
  timeoutMs: 10000
  degradedMs: 1500      # slower than this → "degraded" instead of "up"
  failureThreshold: 2   # consecutive failures before declaring an outage
  retries: 1            # immediate retries before a check counts as failed

monitors:
  - id: my-api
    name: My API
    url: https://api.example.com/health
    expectStatus: [200]
    expectText: '"ok":true'
    intervalSeconds: 30
    tags: [prod, api]

  - id: my-db-port
    name: Postgres
    type: tcp
    host: db.internal
    port: 5432
```

### Monitor options

| Key | Applies to | Meaning |
|---|---|---|
| `id` | all | URL-safe slug; also the on-disk filename |
| `secure` | all | hide behind the password gate (still checked) |
| `type` | all | `http` (default) or `tcp` |
| `url`, `method`, `headers`, `body` | http | request to send |
| `expectStatus` | http | acceptable codes (default: any 2xx/3xx) |
| `expectText` / `rejectText` | http | body must / must not contain |
| `followRedirects` | http | default `true` |
| `host`, `port` | tcp | connection target |
| `intervalSeconds`, `timeoutMs`, `degradedMs` | all | override the defaults |
| `failureThreshold`, `retries` | all | how hard to try before calling it down |
| `paused` | all | defined but not checked |
| `tags`, `description` | all | dashboard metadata |

### Degraded vs. down

A check that succeeds but exceeds `degradedMs` is **degraded** — the endpoint
works, but slowly. A check that fails is retried `retries` times immediately;
only after `failureThreshold` *consecutive* failed checks does the monitor go
**down** and open an incident. Single blips stay out of the incident log.

---

## API

| Route | Method | Purpose |
|---|---|---|
| `/api/status` | GET | full snapshot of every monitor |
| `/api/monitors` | POST | add a monitor (writes the config, hot-reloads) |
| `/api/monitors/<id>` | GET | one monitor, with its full retained history |
| `/api/stream` | GET | SSE feed of every check as it happens |
| `/api/check` | POST | force a check now (`?id=<id>` for one) |
| `/api/reload` | POST | re-read the config and rebuild the schedule |
| `/api/badge/<id>` | GET | SVG badge (`?type=status\|uptime\|response`) |
| `/api/secure` | GET/POST/DELETE | gate status / unlock / lock |

Adding a monitor does **not** require a restart:

```bash
$EDITOR upsite.config.yaml
curl -X POST http://localhost:3000/api/reload
```

### Badges

```markdown
![status](http://localhost:3000/api/badge/my-api)
![uptime](http://localhost:3000/api/badge/my-api?type=uptime)
![response](http://localhost:3000/api/badge/my-api?type=response)
```

Rendered locally — no third-party badge service ever sees your endpoints.

---

## Adding monitors from the dashboard

**Add monitor** on the dashboard writes the entry straight into
`upsite.config.yaml` and hot-reloads the scheduler — the config file stays the
single source of truth, and the UI is just a friendlier way to edit it. Your
comments and formatting are preserved; the diff is purely additive.

---

## The secure tab

Monitors marked `secure: true` are hidden behind a password. They are **still
checked on schedule** — only viewing them is gated.

```yaml
- id: simba
  name: Simba
  url: secure
  secure: true
```

```bash
# .env.local
UPSITE_SECURE_PASSWORD=your-password
UPSITE_SECRET=$(openssl rand -hex 32)
```

Until unlocked, a secure monitor is **omitted, not masked** — it is absent from
`/api/status`, the SSE stream, the incident log, the status counts, its detail
page (404), and its badge. There is nothing in the page source to uncover.

How the gate works, given there is no database: unlocking mints a short-lived
HMAC-signed token held in an httpOnly cookie, and verifying it is a pure
function of the token plus `UPSITE_SECRET`. No session store, nothing persisted.
Passwords are compared in constant time, and unlock attempts are rate-limited.

Set `UPSITE_SECRET`, or a random one is generated per process and every restart
logs everyone out. Set `UPSITE_COOKIE_SECURE=1` when serving over HTTPS.

> The gate is a viewing password for a private dashboard, not a multi-user auth
> system: one shared password, no accounts, no roles. Put it behind a VPN or a
> reverse proxy if you need more than that.

---

## Notifications

```yaml
notifications:
  webhooks:
    - https://example.com/hooks/upsite   # full JSON payload
  slackWebhook: ${SLACK_WEBHOOK_URL}     # also works with Discord
```

Sent on every status transition, fire-and-forget: a slow or broken webhook can
never delay or fail the check that triggered it.

---

## Environment variables

| Variable | Effect |
|---|---|
| `UPSITE_CONFIG` | path to the config file (default `./upsite.config.yaml`) |
| `UPSITE_DATA_DIR` | path to the datastore (default `./.data`) |
| `UPSITE_ADMIN_TOKEN` | require `Authorization: Bearer …` on `/api/reload` |
| `UPSITE_DISABLE_ENGINE` | set to `1` to load the app without scheduling checks |
| `UPSITE_SECURE_PASSWORD` | password for the secure tab (required to view secure monitors) |
| `UPSITE_SECRET` | signs the unlock cookie; generate with `openssl rand -hex 32` |
| `UPSITE_COOKIE_SECURE` | set to `1` when serving over HTTPS |

---

## Deploying

Upsite needs a **single long-lived Node process with a writable disk** — the
scheduler and the datastore both live in it. A VPS, a container, or any
always-on Node host works.

It is *not* suited to scale-to-zero or multi-instance serverless: a process that
sleeps stops checking, and N instances would each check independently and write
over each other's state. If you need serverless, run one instance and drive it
from an external cron hitting `POST /api/check`, with `UPSITE_DATA_DIR` on a
persistent volume.

Mount `.data/` as a volume to keep history across deploys. It is gitignored by
design — it is the database.

---

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
framer-motion · Recharts · Zod · YAML
