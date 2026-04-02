# Chronologle

Daily chronological ordering puzzle. Five events appear each day — arrange them from earliest to latest. Draw more events to raise the stakes.

**Live:** https://chronologle.pages.dev

## Local development

Serve the static files with any web server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open http://localhost:8080 (or the port shown).

## Deployment (Cloudflare Pages)

### First-time setup

```bash
# Authenticate with Cloudflare (opens browser)
npx wrangler login

# Create the Pages project (only once)
npx wrangler pages project create chronologle --production-branch main
```

### Deploy

```bash
./deploy.sh
# or manually:
npx wrangler pages deploy . --project-name chronologle --branch main --commit-dirty=true
```

The site will be live at https://chronologle.pages.dev.

## Adding events

Events live in `events.json` — a flat JSON array of objects:

```json
{"event": "Apollo 11 lands on the Moon", "date": "1969-07-20", "category": "space"}
```

### Management script

```bash
# Show stats (category/decade breakdown)
python3 generate_events.py stats

# Validate dates and check for duplicates
python3 generate_events.py validate

# Remove duplicates
python3 generate_events.py dedup

# Merge events from another JSON file
python3 generate_events.py merge new_events.json

# Export a single category
python3 generate_events.py export --category sports

# Generate events with Claude API (requires: pip install anthropic)
python3 generate_events.py generate --category "90s movies" --count 100
```

### Bulk generation

```bash
# Generate events across 75+ categories (requires ANTHROPIC_API_KEY)
./bulk_generate.sh
```

## Project structure

```
index.html          Main page
style.css           Styles
app.js              Game logic
events.json         Event data (~10k events)
rabbit.svg          Logo icon
generate_events.py  Event management CLI
bulk_generate.sh    Bulk event generation script
deploy.sh           Cloudflare Pages deploy script
```
