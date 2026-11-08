#!/usr/bin/env bash
# Push secrets from .env.local to Vercel (production). APP_URL is set separately to the prod URL.
# The GitHub App key is read from GITHUB_PRIVATE_KEY_PATH and stored as GITHUB_PRIVATE_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."

env_file=".env.local"
skip="APP_URL GITHUB_PRIVATE_KEY_PATH"

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  [[ " $skip " == *" $key "* ]] && continue
  value="${value%\"}"; value="${value#\"}"
  vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$key" production >/dev/null
  echo "set $key"
done < "$env_file"

key_path=$(grep '^GITHUB_PRIVATE_KEY_PATH=' "$env_file" | cut -d= -f2- || true)
if [[ -n "$key_path" && -f "$key_path" ]]; then
  vercel env rm GITHUB_PRIVATE_KEY production --yes >/dev/null 2>&1 || true
  vercel env add GITHUB_PRIVATE_KEY production < "$key_path" >/dev/null
  echo "set GITHUB_PRIVATE_KEY (from $key_path)"
fi
