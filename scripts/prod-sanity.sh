#!/usr/bin/env bash
set -u

FAIL=0
PASS_COUNT=0

pass() {
  echo "PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL=1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

echo "== FlatHockey prod sanity =="

if have_cmd ss; then
  LISTENERS="$(ss -lntp 2>/dev/null || true)"

  if echo "$LISTENERS" | grep -q ':7777'; then
    pass "listener exists on :7777"
  else
    fail "missing listener on :7777"
  fi

  if echo "$LISTENERS" | grep -q ':7778'; then
    fail "unexpected listener on :7778"
  else
    pass "no listener on :7778"
  fi

  if echo "$LISTENERS" | grep -q ':8080'; then
    fail "unexpected listener on :8080"
  else
    pass "no listener on :8080"
  fi
else
  fail "ss command not available"
fi

if have_cmd curl; then
  if curl -fsS http://127.0.0.1:7777/health >/dev/null 2>&1; then
    pass "health check on :7777 succeeded"
  else
    fail "health check on :7777 failed"
  fi

  if curl -fsS http://127.0.0.1:7778/health >/dev/null 2>&1; then
    fail "health check on :7778 unexpectedly succeeded"
  else
    pass "health check on :7778 failed as expected"
  fi
else
  fail "curl command not available"
fi

echo "== Service status (best effort) =="
if have_cmd systemctl; then
  echo "flathockey.service enabled: $(systemctl is-enabled flathockey.service 2>/dev/null || echo unknown)"
  echo "flathockey.service active:  $(systemctl is-active flathockey.service 2>/dev/null || echo unknown)"
  echo "flathockey-ws2.service enabled: $(systemctl is-enabled flathockey-ws2.service 2>/dev/null || echo unknown)"
  echo "pm2-ubuntu enabled: $(systemctl is-enabled pm2-ubuntu 2>/dev/null || echo unknown)"
else
  echo "systemctl not available"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: PASS ($PASS_COUNT checks)"
  exit 0
fi

echo "RESULT: FAIL"
exit 1

