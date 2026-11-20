#!/usr/bin/env bash
# One-time setup. Saves the database + admin settings on your Netlify site, then redeploys it.
# Nothing secret is stored in this file or in the code: you type the values when asked.
# Run:  bash scripts/connect-netlify.sh
set -euo pipefail

SITE_ID="1fa78162-420c-4071-8166-de7e6e5dd4f1"
SITE_URL="https://nelmoramy.netlify.app"

command -v netlify >/dev/null || { echo "The Netlify tool is not installed. Run: npm i -g netlify-cli"; exit 1; }

echo
echo "Connect the online database to your Nelmora shop"
echo "------------------------------------------------"
echo "You need your Turso database URL and token (turso.tech -> your database)."
echo

read -r -p "1) Turso database URL (starts with libsql://): " DB_URL
case "$DB_URL" in libsql://*) ;; *) echo "That should start with libsql://  (copy it from the Turso page)."; exit 1;; esac

read -r -s -p "2) Turso auth token (hidden while you paste): " DB_TOKEN; echo
[ "${#DB_TOKEN}" -gt 40 ] || { echo "That token looks too short. Generate a new one in Turso and copy all of it."; exit 1; }

read -r -s -p "3) Choose a password for your shop admin (10+ characters): " ADMIN_PW; echo
[ "${#ADMIN_PW}" -ge 10 ] || { echo "Please use at least 10 characters."; exit 1; }
read -r -s -p "   Type it again: " ADMIN_PW2; echo
[ "$ADMIN_PW" = "$ADMIN_PW2" ] || { echo "The two passwords do not match. Run the script again."; exit 1; }

SESSION_SECRET="$(openssl rand -hex 32)"

echo
echo "Saving settings on Netlify..."
set_var() { netlify env:set "$1" "$2" --site "$SITE_ID" --force >/dev/null && echo "  saved $1"; }
set_var TURSO_DATABASE_URL "$DB_URL"
set_var TURSO_AUTH_TOKEN   "$DB_TOKEN"
set_var ADMIN_PASSWORD     "$ADMIN_PW"
set_var SESSION_SECRET     "$SESSION_SECRET"
set_var PUBLIC_URL         "$SITE_URL"

echo
echo "Starting a fresh deploy..."
netlify api createSiteBuild --data "{\"site_id\":\"$SITE_ID\",\"clear_cache\":true}" >/dev/null
echo "Waiting for the shop to come online (this takes about 2-4 minutes)..."

for i in $(seq 1 60); do
  code="$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$SITE_URL/api/config" || true)"
  if [ "$code" = "200" ]; then
    echo
    echo "The shop is online:   $SITE_URL"
    echo "Admin:                $SITE_URL/admin   (use the password you just chose)"
    echo "Next: open Admin -> Settings and enter your bank details."
    exit 0
  fi
  printf '.'
  sleep 10
done
echo
echo "Still not ready after 10 minutes. Open Netlify -> Deploys to see the build log, and tell me what it says."
exit 1
