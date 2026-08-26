# Upsite

Uptime monitoring with **no server and no database**. GitHub Actions runs the
checks, this repository stores the results, GitHub Issues holds the incident
reports, and GitHub Pages serves the status site.

It is [Upptime](https://upptime.js.org)'s architecture — the config file is the
product, git is the database — with a Next.js status site in place of Sapper.

<!-- upsite:status:start -->

| Monitor | Status | Response | 24h | 7d | 30d | 90d | Graph |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 🟩 [Kichaka](https://kichaka.top) | up | 2347 ms | 100.00% | 100.00% | 100.00% | 100.00% | [graph](./graphs/kichaka.svg) |
| 🟩 [KFS](https://hr.kenyaforestservice.org) | up | 1121 ms | 100.00% | 100.00% | 100.00% | 100.00% | [graph](./graphs/kfs.svg) |
| 🟩 [KIMAP](https://kimap.org) | up | 2413 ms | 100.00% | 100.00% | 100.00% | 100.00% | [graph](./graphs/kimap.svg) |
| 🟨 [Protouch](https://protouch.co.ke) | degraded | 3807 ms | 100.00% | 100.00% | 100.00% | 100.00% | [graph](./graphs/protouch.svg) |
| 🟥 [KFC](https://kfc.ac.ke) | down | 8 ms | 0.00% | 0.00% | 0.00% | 0.00% | [graph](./graphs/kfc.svg) |

_Updated 2026-08-26 08:29 UTC by [the uptime workflow](../../actions/workflows/uptime.yml)._
<!-- upsite:status:end -->

---

## How it works

```
upsite.config.yaml
        │
        ▼
┌───────────────────────── GitHub Actions ─────────────────────────┐
│                                                                  │
│  uptime.yml         */5 * * * *   check every endpoint           │
│    ├─ checker.ts        HTTP / TCP probe                         │
│    ├─ history.ts        fold into history/<id>.yml               │
│    ├─ github.ts         open · comment · lock · close the issue  │
│    ├─ slack.ts          notify on every transition               │
│    └─ publish.ts        rewrite api/** and the table above       │
│                                                                  │
│  response-time.yml  0 */6 * * *   drain the window into a sample │
│  graphs.yml         20 0 * * *    redraw graphs/<id>.svg         │
│  summary.yml        on config push  rebuild everything derived   │
│  site.yml           on code push    build + deploy to Pages      │
│                                                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │  git commit
                               ▼
                     history/ · api/ · graphs/
                               │  GitHub API (in the browser)
                               ▼
                    GitHub Pages — the status site
```

Every workflow that writes data shares one `concurrency` group, so two runs can
never race to push the same files, and the commit step rebases and retries if
one gets there first.

### Where the data lives

| Path | Contents | Written by |
|---|---|---|
| `history/<id>.yml` | current status, today's rollup, the open incident | every check |
| `history/<id>.daily.json` | calendar-day rollups, 90 days | when the UTC day rolls over |
| `history/<id>.response-time.json` | 6-hourly response-time samples | `response-time.yml` |
| `history/incidents.json` | the incident log, with issue numbers | on every transition |
| `api/summary.json` | the whole fleet, for the dashboard | derived |
| `api/<id>.json` | one monitor's full series, for its page | derived |
| `api/<id>/{shields,uptime,response-time}.json` | shields.io endpoint badges | derived |
| `graphs/<id>.svg` | response-time graph | `graphs.yml` |

Everything under `api/` and `graphs/` is a pure function of `history/`. Delete
it and `npm run summary` puts it back.

`history/<id>.yml` accumulates a **window** between response-time recordings, so
each committed sample is the mean of roughly 72 checks rather than whichever
single probe landed on the hour. That is what keeps the daily graphs readable.

### Incidents are GitHub issues

The first check that crosses `failureThreshold` opens an issue, assigns it to
everyone in `incidents.assignees`, and locks it so people outside the
organisation cannot comment. While the outage continues, follow-up reports are
posted as comments — throttled to `commentThrottleMinutes`, but always
immediately when the failure reason changes. On recovery the issue gets a
closing report with the total downtime and closes itself.

Each step also goes to Slack, if `SLACK_WEBHOOK_URL` is set.

---

## Setting it up

**1. Point the config at your repository.**

```yaml
repository:
  owner: your-username
  name: your-repo
  branch: main
```

**2. Enable GitHub Pages.** Settings → Pages → Source → **GitHub Actions**.

**3. Allow the workflows to write.** Settings → Actions → General → Workflow
permissions → **Read and write permissions**. Without this the checks run but
nothing is committed and no issue is ever opened.

**4. Add the Slack webhook** (optional). Settings → Secrets and variables →
Actions → new secret named `SLACK_WEBHOOK_URL`. A Discord webhook URL works
here too — the payload carries a `text` fallback that both accept.

**5. Run the Summary workflow once** from the Actions tab. It seeds a history
file for every monitor, creates the incident labels, and builds the first
`api/`. After that the schedule takes over.

> GitHub disables scheduled workflows in a repository with no activity for 60
> days, and delays or drops scheduled runs under load. Treat five minutes as a
> target, not a guarantee — the status site says as much, and flags data that
> has fallen behind.

---

## Adding a monitor

Add it to `upsite.config.yaml` and push. `summary.yml` picks it up immediately;
the next 5-minute tick checks it.

```yaml
monitors:
  - id: api            # url-safe, and permanent: it names the data files
    name: Public API
    url: https://api.example.com/health
    tags: [production]
    expectStatus: [200]
    expectText: '"ok":true'
    degradedMs: 800

  - id: postgres
    type: tcp
    host: db.example.com
    port: 5432
```

Per-monitor overrides for `timeoutMs`, `degradedMs`, `failureThreshold`,
`retries` and `paused` all fall back to the `defaults:` block.

### `secure: true`

A monitor marked `secure` is checked and alerted on like any other, but never
reaches the status site: no page, no entry in `api/`, no graph, no row in the
table above.

**It is not a secret.** Its `history/<id>.yml` is still committed, and
`upsite.config.yaml` names the target either way — in a public repository both
are readable by anyone. If the URL itself must not be known, make the
repository private; `secure` only controls what gets published.

---

## The status site

A Next.js static export. It is baked with whatever data was committed at build
time, so the first paint is real, then the browser refreshes from the GitHub
API — the Contents API first, falling back to `raw.githubusercontent.com` when
the anonymous rate limit (60 requests an hour) is hit.

It is a PWA: installable, and readable offline from the last status you saw.

```bash
npm install
npm run dev            # http://localhost:3000
npm run build          # static export into out/
```

## Running the workflows by hand

```bash
npm run setup          # validate config, seed history, create labels
npm run uptime         # one full round of checks
npm run response-time  # drain the windows into samples
npm run graphs         # redraw the SVGs
npm run summary        # rebuild api/ and the table above
```

`GITHUB_TOKEN` enables the issue lifecycle; without it the scripts do
everything except talk to GitHub, which is what makes them safe to run locally.
`SLACK_WEBHOOK_URL` enables notifications.

## Badges

Every public monitor commits shields.io endpoint files, so a badge anywhere
needs no service beyond shields itself:

```markdown
![Uptime](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FManyara20%2FUpsite%2Fmain%2Fapi%2Fkfs%2Fuptime.json)
```
