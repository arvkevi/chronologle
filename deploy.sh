#!/bin/bash
# Deploy Chronologle to Cloudflare Pages.
# Usage: ./deploy.sh
set -e
cd "$(dirname "$0")"
echo "Deploying to Cloudflare Pages..."
npx wrangler pages deploy . --project-name chronologle --branch main --commit-dirty=true
echo ""
echo "Live at: https://chronologle.pages.dev"
