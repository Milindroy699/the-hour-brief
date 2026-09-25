#!/usr/bin/env bash
# Sarvam credit tracking and alerts. The estimate lives in R2 (_ledger/sarvam.json); alerts are GitHub issues that @mention the
# owner, so GitHub emails them. Needs: aws CLI credentials, R2_BUCKET, R2_ENDPOINT; for alerts: gh + GH_TOKEN (issues: write).
#   credit.sh set BALANCE      record the balance you see in the Sarvam dashboard (also closes an open low-credit alert if it is fine now)
#   credit.sh charge           subtract what the run just recorded (tools/audio/out/audio/*/manifest.json), then alert if the estimate is low
#   credit.sh alert ran-out [DATE]   Sarvam said there is no credit: open an alert now
#   credit.sh alert test       open and close a test alert, to check that the email arrives
#   credit.sh status           print the estimate
# Thresholds: SARVAM_LOW_RUPEES (default 100) and SARVAM_MIN_DAYS (default 5); either one going under counts as low.
set -euo pipefail
cd "$(dirname "$0")"
: "${R2_BUCKET:?R2_BUCKET is not set}" "${R2_ENDPOINT:?R2_ENDPOINT is not set}"
OWNER="${ALERT_MENTION:-@Milindroy699}"
LOW="${SARVAM_LOW_RUPEES:-100}"; DAYS="${SARVAM_MIN_DAYS:-5}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
LEDGER="$WORK/ledger.json"; KEY="_ledger/sarvam.json"

download() { aws s3 cp "s3://$R2_BUCKET/$KEY" "$LEDGER" --endpoint-url "$R2_ENDPOINT" --only-show-errors 2>/dev/null || true; }
upload()   { aws s3 cp "$LEDGER" "s3://$R2_BUCKET/$KEY" --endpoint-url "$R2_ENDPOINT" --content-type application/json --cache-control "no-store" --only-show-errors; }

ensure_label() { gh label create sarvam-credit --color d93f0b --description "Sarvam voice credit alerts" 2>/dev/null || true; }
open_count()   { gh issue list --label sarvam-credit --state open --json title -q "[.[] | select(.title | test(\"$1\"; \"i\"))] | length"; }
alert() {   # alert KIND TITLE BODY
  ensure_label
  case "$1" in
    low)     [ "$(open_count '.')" = "0" ] || { echo "an alert is already open; not opening another"; return 0; } ;;
    ran-out) [ "$(open_count 'run out')" = "0" ] || { echo "a 'ran out' alert is already open"; return 0; } ;;
  esac
  gh issue create --label sarvam-credit --title "$2" --body "$3"
}
low_body() { cat <<BODY
$OWNER the daily AI-voice recording (Neha) is estimated to have about **₹$1** of Sarvam credit left, roughly **$2 day(s)** at ₹$3 a day.

This is an estimate: the balance you last told us, minus each recording since. Sarvam gives no way to read the exact balance from code.

**What to do**
1. Top up your Sarvam credit in the Sarvam dashboard.
2. In this repository open **Actions → Sarvam credit → Run workflow** and enter the balance you now see. That resets the estimate and closes this alert.

If the credit runs out, nothing breaks: that day's edition just uses the phone's own voice, and you get a second alert.
BODY
}
ranout_body() { cat <<BODY
$OWNER Sarvam reported that there is **no credit left**, so the recording for **$1** failed. Readers are hearing their phone's own voice for that edition until you top up.

**What to do**
1. Top up your Sarvam credit in the Sarvam dashboard.
2. Open **Actions → Sarvam credit → Run workflow** and enter the new balance.
3. Open **Actions → Daily audio → Run workflow** (date: latest) to record the missed edition.
BODY
}

case "${1:-}" in
  set)
    : "${2:?usage: credit.sh set BALANCE}"
    download
    node credit.mjs set --file "$LEDGER" --balance "$2" --low "$LOW"
    upload
    if [ -n "${GH_TOKEN:-}" ] && node credit.mjs status --file "$LEDGER" --low "$LOW" --min-days "$DAYS" >/dev/null; then      # exit 0 = not low
      for n in $(gh issue list --label sarvam-credit --state open --json number -q '.[].number'); do
        gh issue close "$n" --comment "Balance updated to about ₹$2, which is above the alert level. Closing." || true
      done
    fi ;;
  charge)
    download
    if [ ! -s "$LEDGER" ]; then echo "No balance has been set yet, so nothing is tracked (run the 'Sarvam credit' workflow once)."; exit 0; fi
    read -r CHARS DATE < <(node -e '
      const fs=require("fs"),p=require("path"),d="out/audio";let chars=0,date="";
      for (const x of fs.existsSync(d)?fs.readdirSync(d):[]) { const f=p.join(d,x,"manifest.json"); if(!fs.existsSync(f)) continue; const m=JSON.parse(fs.readFileSync(f,"utf8")); for (const v of Object.values(m.modes||{})) chars+=v.chars||0; date=x; }
      console.log(chars+" "+date);')
    if [ "${CHARS:-0}" -gt 0 ]; then node credit.mjs charge --file "$LEDGER" --chars "$CHARS" --date "$DATE" --id "${GITHUB_RUN_ID:-manual-$(date +%s)}" --low "$LOW"; upload; else echo "nothing was recorded, nothing to charge"; fi
    rc=0; ST="$(node credit.mjs status --file "$LEDGER" --low "$LOW" --min-days "$DAYS")" || rc=$?
    echo "$ST"
    if [ "$rc" = "10" ]; then
      BAL="$(echo "$ST" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).balance')"
      LEFT="$(echo "$ST" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).daysLeft')"
      PER="$(echo "$ST" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).perDay')"
      alert low "Sarvam voice credit is running low (about ₹$BAL left, ~$LEFT days)" "$(low_body "$BAL" "$LEFT" "$PER")"
    fi ;;
  alert)
    case "${2:-}" in
      ran-out) alert ran-out "Sarvam voice credit has run out: the recording for ${3:-today} failed" "$(ranout_body "${3:-today}")" ;;
      test)
        ensure_label
        url="$(gh issue create --label sarvam-credit --title "TEST: Sarvam credit alert (safe to ignore)" --body "$OWNER this is a test of the credit alert. If you received an email about it, the real alerts will reach you too. Closing it now.")"
        gh issue close "$url" --comment "Test finished." >/dev/null; echo "test alert: $url" ;;
      *) echo "usage: credit.sh alert ran-out [DATE] | test"; exit 2 ;;
    esac ;;
  status) download; node credit.mjs status --file "$LEDGER" --low "$LOW" --min-days "$DAYS" || true ;;
  *) echo "usage: credit.sh set BALANCE | charge | alert ran-out|test | status"; exit 2 ;;
esac
