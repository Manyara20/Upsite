#!/usr/bin/env bash
#
# Turns on the protected tab, end to end:
#
#   1. generates an access key (or takes one you supply)
#   2. stores it as the UPSITE_SECURE_KEY repository secret
#   3. triggers the Uptime workflow so it seals api/secure.json
#   4. waits for the run, then verifies the sealed file opens with the key
#
# Needs a GitHub token with `repo` and `workflow` scope. Create one at
# https://github.com/settings/tokens and either export GITHUB_TOKEN or paste it
# when prompted — it is read without echo and never written to disk.
#
#   ./scripts/setup-secure.sh                 # generate a key
#   ./scripts/setup-secure.sh --key '…'       # use one you already have
#   ./scripts/setup-secure.sh --no-run        # set the secret, don't dispatch
#
set -euo pipefail

WORKFLOW="uptime.yml"
SECRET_NAME="UPSITE_SECURE_KEY"
API="https://api.github.com"

die() { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

cd "$(dirname "$0")/.."

# --- arguments -------------------------------------------------------------

KEY=""
RUN=true
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="${2:-}"; [ -n "$KEY" ] || die "--key needs a value"; shift 2 ;;
    --no-run) RUN=false; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# --- prerequisites ---------------------------------------------------------

for cmd in curl python3 openssl; do
  command -v "$cmd" >/dev/null || die "$cmd is required but not installed"
done
python3 -c 'import nacl.public' 2>/dev/null ||
  die "the pynacl package is required: pip install pynacl"

# --- where to write --------------------------------------------------------

step "Reading upsite.config.yaml"
eval "$(python3 - <<'PY'
import yaml, shlex
c = yaml.safe_load(open("upsite.config.yaml"))
r = c["repository"]
print(f"OWNER={shlex.quote(r['owner'])}")
print(f"REPO={shlex.quote(r['name'])}")
print(f"BRANCH={shlex.quote(r.get('branch', 'main'))}")
print(f"PROTECTED={sum(1 for m in c['monitors'] if m.get('secure'))}")
PY
)"
ok "$OWNER/$REPO on $BRANCH — $PROTECTED protected monitor(s)"
[ "$PROTECTED" -gt 0 ] ||
  die "no monitor is marked 'secure: true', so there is nothing to seal"

# --- token -----------------------------------------------------------------

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  printf '\nGitHub token (repo + workflow scope, input hidden): '
  read -rs TOKEN
  printf '\n'
fi
[ -n "$TOKEN" ] || die "no token given"

# `-w %{http_code}` with the body to stdout lets one call yield both.
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" -w '\n%{http_code}'
    -H "Accept: application/vnd.github+json"
    -H "Authorization: Bearer $TOKEN"
    -H "X-GitHub-Api-Version: 2022-11-28")
  # An `if` rather than `[ … ] && …`: under `set -e` the latter makes the whole
  # function return non-zero whenever there is no body.
  if [ -n "$body" ]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl "${args[@]}" "$API$path"
}

split_status() { RESP_BODY="$(printf '%s' "$1" | sed '$d')"; RESP_CODE="$(printf '%s' "$1" | tail -n1)"; }

step "Checking the token"
split_status "$(api GET "/repos/$OWNER/$REPO")"
case "$RESP_CODE" in
  200) ok "authenticated, $OWNER/$REPO reachable" ;;
  401) die "the token was rejected (401). Is it expired?" ;;
  404) die "cannot see $OWNER/$REPO (404). The token needs 'repo' scope." ;;
  *)   die "GitHub returned $RESP_CODE checking the repository" ;;
esac

# --- the key ---------------------------------------------------------------

GENERATED=false
if [ -z "$KEY" ]; then
  # 32 random bytes. The sealed file is public, so the passphrase is the only
  # thing standing between a cloner and the data — length is the whole defence.
  KEY="$(openssl rand -base64 32 | tr -d '\n')"
  GENERATED=true
fi

# --- store it --------------------------------------------------------------

step "Storing the $SECRET_NAME secret"
split_status "$(api GET "/repos/$OWNER/$REPO/actions/secrets/public-key")"
[ "$RESP_CODE" = "200" ] ||
  die "could not fetch the repository public key ($RESP_CODE). The token needs 'repo' scope."

PUBKEY="$(printf '%s' "$RESP_BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["key"])')"
KEY_ID="$(printf '%s' "$RESP_BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["key_id"])')"

# Secrets go over the wire as a libsodium sealed box. The key travels by
# environment rather than argv, which would be visible to any other process.
ENCRYPTED="$(SECRET_VALUE="$KEY" PUBLIC_KEY="$PUBKEY" python3 - <<'PY'
import base64, os
from nacl.public import PublicKey, SealedBox
box = SealedBox(PublicKey(base64.b64decode(os.environ["PUBLIC_KEY"])))
print(base64.b64encode(box.encrypt(os.environ["SECRET_VALUE"].encode())).decode())
PY
)"

PAYLOAD="$(ENCRYPTED="$ENCRYPTED" KEY_ID="$KEY_ID" python3 -c '
import json, os
print(json.dumps({"encrypted_value": os.environ["ENCRYPTED"], "key_id": os.environ["KEY_ID"]}))')"

split_status "$(api PUT "/repos/$OWNER/$REPO/actions/secrets/$SECRET_NAME" "$PAYLOAD")"
case "$RESP_CODE" in
  201) ok "$SECRET_NAME created" ;;
  204) ok "$SECRET_NAME updated" ;;
  *)   die "could not store the secret ($RESP_CODE): $RESP_BODY" ;;
esac

if [ "$GENERATED" = true ]; then
  printf '\n\033[1;33m  Your access key — save it now, it is not recoverable:\033[0m\n\n'
  printf '    %s\n\n' "$KEY"
  info "GitHub stores secrets write-only, and nothing here writes it to disk."
fi

if [ "$RUN" = false ]; then
  info "Skipping the workflow run (--no-run). The next scheduled tick will seal."
  exit 0
fi

# --- run the workflow ------------------------------------------------------

step "Running the Uptime workflow"
DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
split_status "$(api POST "/repos/$OWNER/$REPO/actions/workflows/$WORKFLOW/dispatches" \
  "{\"ref\":\"$BRANCH\"}")"
[ "$RESP_CODE" = "204" ] ||
  die "could not start the workflow ($RESP_CODE): ${RESP_BODY:-no body}. The token needs 'workflow' scope."
ok "dispatched"

# The run does not exist the instant the dispatch returns, so look for one
# created at or after the dispatch rather than just taking the newest.
RUN_ID=""
for _ in $(seq 1 20); do
  sleep 3
  split_status "$(api GET "/repos/$OWNER/$REPO/actions/workflows/$WORKFLOW/runs?event=workflow_dispatch&per_page=5")"
  RUN_ID="$(SINCE="$DISPATCHED_AT" python3 -c '
import sys, json, os
runs = json.load(sys.stdin).get("workflow_runs", [])
fresh = [r for r in runs if r["created_at"] >= os.environ["SINCE"]]
print(fresh[0]["id"] if fresh else "")' <<<"$RESP_BODY")"
  [ -n "$RUN_ID" ] && break
done
[ -n "$RUN_ID" ] || die "the run did not appear within a minute; check the Actions tab"
info "run #$RUN_ID — https://github.com/$OWNER/$REPO/actions/runs/$RUN_ID"

printf '    waiting'
CONCLUSION=""
for _ in $(seq 1 80); do
  split_status "$(api GET "/repos/$OWNER/$REPO/actions/runs/$RUN_ID")"
  STATUS="$(printf '%s' "$RESP_BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')"
  if [ "$STATUS" = "completed" ]; then
    CONCLUSION="$(printf '%s' "$RESP_BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["conclusion"])')"
    break
  fi
  printf '.'
  sleep 5
done
printf '\n'

[ "$CONCLUSION" = "success" ] ||
  die "the run finished as '${CONCLUSION:-timed out}'. Logs: https://github.com/$OWNER/$REPO/actions/runs/$RUN_ID"
ok "workflow succeeded"

# --- verify ----------------------------------------------------------------

step "Verifying the sealed file"
SEALED="$(curl -sS "https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH/api/secure.json?t=$(date +%s)")"

if ! printf '%s' "$SEALED" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d.get("v")==1' 2>/dev/null; then
  die "api/secure.json is not there yet. GitHub's CDN lags a moment — retry, or check the run's log."
fi
ok "api/secure.json published"

if command -v npx >/dev/null && [ -f node_modules/.bin/tsx ]; then
  printf '%s' "$SEALED" > .secure-check.json
  trap 'rm -f .secure-check.json' EXIT
  UPSITE_SECURE_KEY="$KEY" npx tsx -e '
    import { readFileSync } from "node:fs";
    import { unseal } from "./src/lib/crypto";
    const sealed = JSON.parse(readFileSync(".secure-check.json", "utf8"));
    unseal(sealed, process.env.UPSITE_SECURE_KEY!).then((plain) => {
      const snap = JSON.parse(plain);
      for (const m of snap.monitors) {
        console.log(`    ${m.name} — ${m.target} — ${m.state.status}`);
      }
    });
  ' || die "the sealed file did not open with this key"
  ok "decrypted with your key"
else
  info "install dependencies (npm ci) to also verify the file decrypts locally"
fi

printf '\n\033[32mDone.\033[0m Open the status site, choose Protected, and enter the key.\n'
printf '  https://%s.github.io/%s\n\n' "$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')" "$REPO"
