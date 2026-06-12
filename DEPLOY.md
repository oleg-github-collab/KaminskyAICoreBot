# Hetzner Deployment Guide

Active production is Hetzner behind `kaminskyi.chat`, not Railway.

Production URL:

```bash
https://kaminskyi.chat/translatorbot/app
```

Active compose directory:

```bash
deploy/translatorbot
```

The compose file builds the current app from `deploy/translatorbot/repo` and exposes the app only on localhost:

```bash
127.0.0.1:3300 -> app:8080
```

Nginx must proxy `/translatorbot/` to `127.0.0.1:3300`; see:

```bash
deploy/translatorbot/nginx-location.conf
```

## Required Environment

Set these on the server in `deploy/translatorbot/.env`:

```bash
BOT_TOKEN=...
ADMIN_CHAT_ID=183844476
MINI_APP_URL=https://kaminskyi.chat/translatorbot/app
WEBHOOK_URL=https://kaminskyi.chat/translatorbot/webhook

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

OTRANSLATOR_API_KEY=...
OTRANSLATOR_MODEL=gemini-3.1-thinking
OTRANSLATOR_VALIDATE_MODEL=1
OTRANSLATOR_GLOSSARY_NAME=C-Sailor_Pro_Glossary_EN-UK-1

ALLOWED_TELEGRAM_IDS=*
PROCESSOR_URL=http://processor:5000
DATA_DIR=/data
DB_PATH=/data/db/bot.db
ENVIRONMENT=production
```

Production startup is fail-closed when Stripe secrets are missing.

## Deploy

From the repository root, after the server path is confirmed:

```bash
rsync -az --exclude='.git' --exclude='.env' --exclude='.zig-cache' --exclude='zig-out' ./ root@kaminskyi.chat:/opt/translatorbot/repo/
ssh root@kaminskyi.chat 'cd /opt/translatorbot && docker compose build app processor && docker compose up -d'
```

Verify:

```bash
ssh root@kaminskyi.chat 'cd /opt/translatorbot && docker compose ps'
curl -fsS https://kaminskyi.chat/translatorbot/health
```

## Do Not Use For Current Production

Railway is not the active production target for this bot. Do not run `railway up` for the current `kaminskyi.chat/translatorbot` deployment unless the production target is intentionally changed.
