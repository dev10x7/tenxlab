#!/usr/bin/env bash
#
# dev-smoke.sh — end-to-end smoke test against a running stack (scripts/dev-up.sh).
#
# Drives the two Phase E/P2 exit criteria over real HTTP against the live API:
#   1. Projects: student forks a component → workspace provisions on KubeLab →
#      stop → submit → instructor scores → student sees the score.
#   2. Labs: student launches the tier-3 lesson → KubeLab installs a vcluster →
#      session reaches ACTIVE with a browser-reachable IDE URL.
#
# Step 2 provisions a real vcluster and takes minutes; skip it with --no-lab.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API="${API:-http://localhost:4000}"
LAB_LESSON_ID="${LAB_LESSON_ID:-k8s-l2}"
LAB_TIMEOUT="${LAB_TIMEOUT:-600}"   # seconds to wait for the vcluster to go ACTIVE
FORK_TIMEOUT="${FORK_TIMEOUT:-600}"

RUN_LAB=1
[ "${1:-}" = "--no-lab" ] && RUN_LAB=0

JAR="$(mktemp -d)"
trap 'rm -rf "$JAR"' EXIT

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$*"; FAILED=1; }
FAILED=0

jq_get() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

login() { # email, jar
  local code
  code="$(curl -s -c "$2" -o /dev/null -w '%{http_code}' -X POST "$API/api/auth/login" \
    -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"demo1234\"}")"
  [ "$code" = "200" ] || [ "$code" = "201" ]
}

# --- Projects: fork → stop → submit → evaluate -------------------------------
say "Projects: fork → build → stop → submit → evaluate"
login "student@tenxlab.local" "$JAR/student"   && ok "student signed in"   || fail "student login"
login "instructor@tenxlab.local" "$JAR/instructor" && ok "instructor signed in" || fail "instructor login"

PROJECTS="$(curl -s -b "$JAR/student" "$API/api/projects")"
# Prefer the seeded demo project so the run is deterministic; otherwise fall back
# to the first listed project that has a component.
PID="$(echo "$PROJECTS" | jq_get "next((p['project']['id'] for p in d if p['project']['id']=='project-demo-spring-api'), '')")"
CID="$(echo "$PROJECTS" | jq_get "next((p['components'][0]['id'] for p in d if p['project']['id']=='project-demo-spring-api' and p['components']), '')")"
[ -z "$PID" ] && PID="$(echo "$PROJECTS" | jq_get "next((p['project']['id'] for p in d if p['components']), '')")"
[ -z "$CID" ] && CID="$(echo "$PROJECTS" | jq_get "next((p['components'][0]['id'] for p in d if p['components']), '')")"
[ -n "$PID" ] && [ -n "$CID" ] && ok "project $PID component $CID" || fail "could not read project/component"

FORK="$(curl -s -b "$JAR/student" -X POST "$API/api/projects/$PID/components/$CID/fork")"
FORK_ID="$(echo "$FORK" | jq_get "d['forkId']")"
WS_ID="$(echo "$FORK" | jq_get "d['workspaceId']")"
TIER="$(echo "$FORK" | jq_get "d['tier']")"
[ -n "$WS_ID" ] && ok "forked → workspace $WS_ID ($TIER)" || fail "fork failed: $FORK"

say "Waiting for the KubeLab workspace to provision (tier: $TIER)"
WS_STATUS=""
for i in $(seq 1 "$FORK_TIMEOUT"); do
  ST="$(curl -s -b "$JAR/student" "$API/api/projects/forks/$FORK_ID")"
  WS_STATUS="$(echo "$ST" | jq_get "d['status']")"
  IDE_URL="$(echo "$ST" | jq_get "d.get('ideUrl') or ''")"
  [ $((i % 15)) -eq 0 ] && printf '    [%ss] status=%s\n' "$i" "$WS_STATUS"
  [ "$WS_STATUS" = "running" ] && break
  [ "$WS_STATUS" = "failed" ] && break
  sleep 1
done
if [ "$WS_STATUS" = "running" ]; then
  ok "workspace running"
  [ -n "$IDE_URL" ] && ok "IDE URL: $IDE_URL"
  # The provider reports running once the ingress object exists; the code-server
  # image may still be pulling and the ingress controller may not have picked up
  # the rule yet (503 or 404 respectively). Wait until the IDE actually serves.
  if [ -n "$IDE_URL" ]; then
    for i in $(seq 1 60); do
      CODE="$(curl -s -o /dev/null -w '%{http_code}' "$IDE_URL")"
      case "$CODE" in
        000|404|503) sleep 5 ;;
        *) break ;;
      esac
    done
    case "$CODE" in
      000|404|503) fail "IDE did not start serving (last: $CODE)" ;;
      *)           ok "IDE serves (HTTP $CODE)" ;;
    esac
  fi
else
  fail "workspace did not reach running (last: $WS_STATUS)"
fi

STOPPED="$(curl -s -b "$JAR/student" -X POST "$API/api/projects/workspaces/$WS_ID/stop")"
[ "$(echo "$STOPPED" | jq_get "d['status']")" = "stopped" ] && ok "workspace stopped" || fail "stop failed: $STOPPED"

SUBMIT="$(curl -s -b "$JAR/student" -o /tmp/submit.json -w '%{http_code}' -X POST \
  "$API/api/projects/$PID/components/$CID/submissions" -H 'content-type: application/json' \
  -d "{\"workspaceId\":\"$WS_ID\",\"title\":\"Smoke submission\",\"description\":\"e2e\",\"githubUrl\":\"https://github.com/smoke/repo\"}")"
SUB_ID="$(jq_get "d['id']" < /tmp/submit.json)"
[ -n "$SUB_ID" ] && ok "submitted ($SUB_ID)" || fail "submit failed (HTTP $SUBMIT): $(cat /tmp/submit.json)"

SCORED="$(curl -s -b "$JAR/instructor" -X PATCH "$API/api/projects/submissions/$SUB_ID" \
  -H 'content-type: application/json' -d '{"score":91,"feedback":"smoke ok"}')"
[ "$(echo "$SCORED" | jq_get "d['score']")" = "91" ] && ok "instructor scored 91" || fail "evaluate failed: $SCORED"

SEEN="$(curl -s -b "$JAR/student" "$API/api/projects/submissions")"
SEEN_SCORE="$(echo "$SEEN" | jq_get "[s['submission']['score'] for s in d if s['submission']['id']=='$SUB_ID'][0]")"
[ "$SEEN_SCORE" = "91" ] && ok "student sees score 91" || fail "student score mismatch: $SEEN_SCORE"

# --- Labs: tier-3 launch on the real cluster ---------------------------------
if [ "$RUN_LAB" = "1" ]; then
  say "Labs: launch tier-3 lesson → vcluster ACTIVE (this takes minutes)"
  LAUNCH="$(curl -s -b "$JAR/student" -X POST "$API/api/labs/launch" \
    -H 'content-type: application/json' -d "{\"lessonId\":\"$LAB_LESSON_ID\"}")"
  SESSION_ID="$(echo "$LAUNCH" | jq_get "d.get('session',{}).get('id') or d.get('sessionId') or ''")"
  [ -n "$SESSION_ID" ] && ok "launch accepted (session $SESSION_ID)" || fail "launch failed: $LAUNCH"

  LAB_STATUS=""
  for i in $(seq 1 "$LAB_TIMEOUT"); do
    S="$(curl -s -b "$JAR/student" "$API/api/labs/sessions/$SESSION_ID")"
    LAB_STATUS="$(echo "$S" | jq_get "d['status']")"
    LAB_IDE="$(echo "$S" | jq_get "d.get('ideUrl') or ''")"
    [ $((i % 20)) -eq 0 ] && printf '    [%ss] status=%s\n' "$i" "$LAB_STATUS"
    # Lab session status is uppercase (WARM/ACTIVE/FAILED).
    case "$(echo "$LAB_STATUS" | tr '[:lower:]' '[:upper:]')" in
      ACTIVE|RUNNING) break ;;
      FAILED|TERMINATED) break ;;
    esac
    sleep 1
  done
  case "$(echo "$LAB_STATUS" | tr '[:lower:]' '[:upper:]')" in
    ACTIVE|RUNNING)
      ok "lab ACTIVE"
      [ -n "$LAB_IDE" ] && ok "IDE URL: $LAB_IDE"
      ;;
    *) fail "lab did not reach active (last: $LAB_STATUS)" ;;
  esac
else
  say "Labs: skipped (--no-lab)"
fi

say "Result"
[ "$FAILED" = "0" ] && { printf '  \033[32mALL CHECKS PASSED\033[0m\n'; exit 0; } \
                    || { printf '  \033[31mSMOKE TEST FAILED\033[0m\n'; exit 1; }
