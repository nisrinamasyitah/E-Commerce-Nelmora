#!/usr/bin/env bash
# One-time setup for online payment (Visa/Mastercard cards + FPX) with Stripe.
#  - checks your Stripe key
#  - creates the Stripe webhook for your shop (so orders are marked paid automatically)
#  - saves the keys on Netlify and redeploys
# Nothing secret is stored in this file or in the code: you paste the key when asked.
# Run:  bash scripts/connect-stripe.sh
set -euo pipefail

SITE_ID="1fa78162-420c-4071-8166-de7e6e5dd4f1"
SITE_URL="https://nelmoramy.netlify.app"
HOOK_URL="$SITE_URL/api/stripe/webhook"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

command -v netlify >/dev/null || { echo "The Netlify tool is not installed. Run: npm i -g netlify-cli"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is needed for this script."; exit 1; }

# stripe METHOD PATH [extra curl args...]  -> body in $TMP, prints the HTTP status
stripe() {
  local method="$1" path="$2"; shift 2
  curl -s -o "$TMP" -w '%{http_code}' -X "$method" -u "$KEY:" "https://api.stripe.com/v1$path" "$@"
}
json() { python3 -c "import sys,json; d=json.load(open('$TMP')); print($1)" 2>/dev/null || true; }

echo
echo "Connect online payment (Visa + FPX) to your Nelmora shop"
echo "---------------------------------------------------------"
echo "You need your Stripe SECRET key (dashboard.stripe.com -> Developers -> API keys)."
echo "Start with the TEST key (sk_test_...). You can run this again later with the live key."
echo

read -r -s -p "Stripe secret key (hidden while you paste): " KEY; echo
case "$KEY" in
  sk_test_*|rk_test_*) MODE="TEST" ;;
  sk_live_*|rk_live_*) MODE="LIVE" ;;
  *) echo "That does not look like a Stripe secret key. It starts with sk_test_ or sk_live_ (not pk_...)."; exit 1 ;;
esac
[ "${#KEY}" -gt 30 ] || { echo "That key looks too short. Copy the whole key."; exit 1; }

if [ "$MODE" = "LIVE" ]; then
  echo
  echo "This is a LIVE key: your shop will take REAL payments."
  read -r -p "Type YES to continue: " OK; [ "$OK" = "YES" ] || { echo "Cancelled."; exit 1; }
fi

echo
echo "Checking the key with Stripe ($MODE mode)..."
code="$(stripe GET /balance)"
[ "$code" = "200" ] || { echo "Stripe refused the key (HTTP $code): $(json "d.get('error',{}).get('message','')")"; exit 1; }
code="$(stripe GET /account || true)"
if [ "$code" = "200" ]; then
  echo "  account country: $(json "d.get('country','?')")   card payments enabled: $(json "d.get('charges_enabled','?')")"
  [ "$MODE" = "LIVE" ] && [ "$(json "d.get('charges_enabled')")" != "True" ] && echo "  NOTE: Stripe has not finished activating this account yet. Finish the activation steps in the Stripe dashboard."
fi

echo
echo "Setting up the webhook ($HOOK_URL)..."
code="$(stripe GET "/webhook_endpoints?limit=100")"
[ "$code" = "200" ] || { echo "Could not list webhooks (HTTP $code)."; exit 1; }
OLD="$(json "next((w['id'] for w in d['data'] if w['url']=='$HOOK_URL'), '')")"
if [ -n "$OLD" ]; then
  echo "A webhook for this shop already exists. Stripe only shows its secret when it is created, so it has to be replaced."
  read -r -p "Replace it? (y/N): " R; [ "$R" = "y" ] || [ "$R" = "Y" ] || { echo "Cancelled. Nothing was changed."; exit 1; }
  stripe DELETE "/webhook_endpoints/$OLD" >/dev/null
fi
code="$(stripe POST /webhook_endpoints -d "url=$HOOK_URL" \
  -d "enabled_events[]=checkout.session.completed" -d "enabled_events[]=checkout.session.async_payment_succeeded" \
  -d "enabled_events[]=checkout.session.async_payment_failed" -d "enabled_events[]=checkout.session.expired")"
[ "$code" = "200" ] || { echo "Could not create the webhook (HTTP $code): $(json "d.get('error',{}).get('message','')")"; exit 1; }
HOOK_SECRET="$(json "d.get('secret','')")"
case "$HOOK_SECRET" in whsec_*) echo "  webhook created" ;; *) echo "Stripe did not return a webhook secret."; exit 1 ;; esac

echo
echo "Saving on Netlify..."
set_var() { netlify env:set "$1" "$2" --site "$SITE_ID" --force >/dev/null && echo "  saved $1"; }
set_var STRIPE_SECRET_KEY "$KEY"
set_var STRIPE_WEBHOOK_SECRET "$HOOK_SECRET"

echo
echo "Starting a fresh deploy..."
netlify api createSiteBuild --data "{\"site_id\":\"$SITE_ID\",\"clear_cache\":false}" >/dev/null
echo "Waiting for online payment to switch on (about 2-4 minutes)..."
for i in $(seq 1 60); do
  on="$(curl -s -m 20 "$SITE_URL/api/config" | python3 -c "import sys,json; print(json.load(sys.stdin).get('stripeEnabled'))" 2>/dev/null || true)"
  if [ "$on" = "True" ]; then
    echo; echo "Online payment is ON ($MODE mode):  $SITE_URL"
    if [ "$MODE" = "TEST" ]; then
      echo "Try it: add something to the bag, check out, choose 'Pay online'."
      echo "  Card:  4242 4242 4242 4242, any future date, any CVC"
      echo "  FPX:   pick any test bank on the Stripe page and choose 'Authorize'"
      echo "When you are happy, run this script again with your LIVE key."
    fi
    exit 0
  fi
  printf '.'; sleep 10
done
echo; echo "Not ready after 10 minutes. Open Netlify -> Deploys to see the build log and tell me what it says."; exit 1
