#!/bin/bash
# Deploy Orderly to Cloudflare Pages.
# Usage: ./deploy.sh
set -e
cd "$(dirname "$0")"
echo "Deploying to Cloudflare Pages..."
npx wrangler pages deploy . --project-name orderly --branch main --commit-dirty=true
echo ""
echo "Live at: https://orderly.pages.dev"
