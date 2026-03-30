#!/usr/bin/env bash
# =============================================================================
# KaminskyAICoreBot — Production Setup Script
# Run this ONCE after you have all API keys
# =============================================================================
set -euo pipefail

RAILWAY_URL="https://bot-production-d5ec.up.railway.app"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${CYAN}ℹ️  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   KaminskyAICoreBot — Production Setup         ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════╝${NC}"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v railway >/dev/null || fail "Railway CLI not found. Install: npm i -g @railway/cli"
command -v stripe  >/dev/null || fail "Stripe CLI not found. Install: brew install stripe/stripe-cli/stripe"
command -v curl    >/dev/null || fail "curl not found"

cd "$PROJECT_DIR"
railway status >/dev/null 2>&1 || fail "Railway project not linked. Run: railway link"

# ── 1. Collect API Keys ───────────────────────────────────────────────────────
echo -e "${YELLOW}── Step 1: API Keys ──────────────────────────────────────${NC}"
echo ""

read -p "🔑 OpenAI API Key (sk-...): " OPENAI_KEY
[[ "$OPENAI_KEY" =~ ^sk- ]] || warn "OpenAI key should start with sk-"

read -p "🔑 DeepL API Key: " DEEPL_KEY
[[ -n "$DEEPL_KEY" ]] || warn "DeepL key is empty"

read -p "🔑 Stripe LIVE Secret Key (sk_live_...): " STRIPE_KEY
[[ "$STRIPE_KEY" =~ ^sk_live_ ]] || fail "Must be a LIVE key (sk_live_...), not test!"

read -p "📱 Your Telegram User ID (admin): " ADMIN_ID
[[ "$ADMIN_ID" =~ ^[0-9]+$ ]] || fail "Admin ID must be a number"

echo ""

# ── 2. Set Railway Variables ──────────────────────────────────────────────────
echo -e "${YELLOW}── Step 2: Setting Railway Variables ─────────────────────${NC}"

railway variables \
  --set "OPENAI_API_KEY=${OPENAI_KEY}" \
  --set "DEEPL_API_KEY=${DEEPL_KEY}" \
  --set "STRIPE_SECRET_KEY=${STRIPE_KEY}" \
  --set "ADMIN_CHAT_ID=${ADMIN_ID}" \
  --skip-deploys

ok "Railway variables updated"

# ── 3. Create Stripe Live Webhook ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── Step 3: Creating Stripe Live Webhook ──────────────────${NC}"

info "Logging into Stripe CLI..."
stripe login

WEBHOOK_SECRET=$(stripe listen \
  --forward-to "${RAILWAY_URL}/stripe-webhook" \
  --print-secret \
  2>/dev/null | grep "whsec_" | head -1 | tr -d ' \n' || true)

if [[ -z "$WEBHOOK_SECRET" ]]; then
  info "Using Stripe API to create permanent webhook endpoint..."
  WEBHOOK_RESP=$(stripe webhooks endpoints create \
    --url "${RAILWAY_URL}/stripe-webhook" \
    --enabled-events="checkout.session.completed,payment_intent.succeeded,payment_intent.payment_failed,invoice.paid,invoice.payment_failed" \
    --description="KaminskyAICoreBot production webhook" \
    2>&1)
  
  WEBHOOK_SECRET=$(echo "$WEBHOOK_RESP" | grep "secret" | grep "whsec_" | awk '{print $NF}' | tr -d "'" || true)
fi

if [[ -n "$WEBHOOK_SECRET" ]]; then
  railway variables \
    --set "STRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}" \
    --skip-deploys
  ok "Stripe webhook secret set: ${WEBHOOK_SECRET:0:15}..."
else
  warn "Could not auto-get webhook secret. Set STRIPE_WEBHOOK_SECRET manually from Stripe Dashboard"
  warn "Dashboard → Developers → Webhooks → Add endpoint → ${RAILWAY_URL}/stripe-webhook"
fi

# ── 4. Register Telegram Webhook ──────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── Step 4: Registering Telegram Webhook ──────────────────${NC}"

BOT_TOKEN="8722681588:AAH3e-lIi65FGkub6cmI2lyLteTWsZmGSD8"
WEBHOOK_URL="${RAILWAY_URL}/webhook"
WEBHOOK_SECRET_TG="KaminskyProd2024WebhookSecret32x"

# Delete existing webhook first
DRES=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true")
ok "Old webhook cleared: $(echo $DRES | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("description","ok"))' 2>/dev/null || echo 'ok')"

# Set new webhook with secret
WRES=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${WEBHOOK_SECRET_TG}\",
    \"max_connections\": 100,
    \"allowed_updates\": [\"message\", \"callback_query\", \"inline_query\"]
  }")

if echo "$WRES" | python3 -c 'import sys,json; d=json.load(sys.stdin); exit(0 if d.get("ok") else 1)' 2>/dev/null; then
  ok "Telegram webhook set: ${WEBHOOK_URL}"
else
  fail "Telegram webhook failed: $WRES"
fi

# ── 5. Deploy ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── Step 5: Deploying to Railway ──────────────────────────${NC}"

railway redeploy --yes 2>/dev/null || railway up --detach 2>/dev/null || warn "Could not auto-trigger redeploy. Push to GitHub to deploy."

# ── 6. Verify ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}── Step 6: Verification ──────────────────────────────────${NC}"
sleep 5

info "Checking health endpoint..."
HEALTH=$(curl -sf "${RAILWAY_URL}/health" 2>/dev/null || echo '{}')
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  ok "Health check PASSED: ${RAILWAY_URL}/health"
else
  warn "Health endpoint not yet available (deploy may still be in progress)"
fi

info "Verifying Telegram webhook..."
WI=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo")
WI_URL=$(echo "$WI" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("result",{}).get("url",""))' 2>/dev/null || echo "")
if [[ "$WI_URL" == "$WEBHOOK_URL" ]]; then
  ok "Telegram webhook verified: $WI_URL"
else
  warn "Webhook URL mismatch. Got: $WI_URL"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🚀 Setup Complete!                           ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Bot:         @aicore_kaminskyibot             ║${NC}"
printf "${GREEN}║  URL:         %-32s ║${NC}\n" "${RAILWAY_URL:8:32}"
echo -e "${GREEN}║  Webhook:     ${RAILWAY_URL}/webhook   ║${NC}"
echo -e "${GREEN}║  Mini App:    ${RAILWAY_URL}/app       ║${NC}"
echo -e "${GREEN}║  Health:      ${RAILWAY_URL}/health    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Open Telegram → @aicore_kaminskyibot → /start"
echo -e "  2. Check Railway logs: railway logs --tail"
echo -e "  3. Stripe Dashboard → Webhooks → verify endpoint is active"
echo ""
