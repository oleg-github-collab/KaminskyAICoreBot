#!/usr/bin/env bash
# =============================================================================
# KaminskyAICoreBot — Production Setup Script
# Run this ONCE after you have all API keys
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

ok()   { echo -e "${GREEN}[OK] $1${NC}"; }
info() { echo -e "${CYAN}[i]  $1${NC}"; }
warn() { echo -e "${YELLOW}[!]  $1${NC}"; }
fail() { echo -e "${RED}[X]  $1${NC}"; exit 1; }

echo ""
echo -e "${CYAN}=== KaminskyAICoreBot — Production Setup ===${NC}"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────────
command -v railway >/dev/null || fail "Railway CLI not found. Install: npm i -g @railway/cli"
command -v stripe  >/dev/null || fail "Stripe CLI not found. Install: brew install stripe/stripe-cli/stripe"
command -v curl    >/dev/null || fail "curl not found"

cd "$PROJECT_DIR"
railway status >/dev/null 2>&1 || fail "Railway project not linked. Run: railway link"

# ── 1. Collect API Keys ───────────────────────────────────────────────────────
echo -e "${YELLOW}-- Step 1: API Keys --${NC}"
echo ""

read -p "Bot Token (from @BotFather): " BOT_TOKEN
[[ -n "$BOT_TOKEN" ]] || fail "Bot token is required"

read -p "OpenAI API Key (sk-...): " OPENAI_KEY
[[ "$OPENAI_KEY" =~ ^sk- ]] || warn "OpenAI key should start with sk-"

read -p "DeepL API Key: " DEEPL_KEY

read -p "Stripe LIVE Secret Key (sk_live_...): " STRIPE_KEY
[[ "$STRIPE_KEY" =~ ^sk_live_ ]] || fail "Must be a LIVE key (sk_live_...), not test!"

ADMIN_ID="183844476"
info "Admin Telegram ID: ${ADMIN_ID}"

# Generate random webhook secret
WEBHOOK_SECRET_TG=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | xxd -p | head -c 32)
info "Generated webhook secret: ${WEBHOOK_SECRET_TG:0:10}..."

echo ""

# ── 2. Get Railway URL ──────────────────────────────────────────────────────
RAILWAY_URL=$(railway domain 2>/dev/null | head -1 | tr -d ' \n' || true)
if [[ -z "$RAILWAY_URL" || "$RAILWAY_URL" != http* ]]; then
  read -p "Railway public URL (https://...up.railway.app): " RAILWAY_URL
fi
[[ "$RAILWAY_URL" =~ ^https:// ]] || fail "Railway URL must start with https://"
info "Railway URL: ${RAILWAY_URL}"

# ── 3. Set Railway Variables ──────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}-- Step 2: Setting Railway Variables --${NC}"

railway variables set "BOT_TOKEN=${BOT_TOKEN}" 2>/dev/null || railway variables --set "BOT_TOKEN=${BOT_TOKEN}" --skip-deploys
railway variables set "BOT_USERNAME=KaminskyAICoreBot" 2>/dev/null || true
railway variables set "WEBHOOK_SECRET=${WEBHOOK_SECRET_TG}" 2>/dev/null || true
railway variables set "WEBHOOK_URL=${RAILWAY_URL}/webhook" 2>/dev/null || true
railway variables set "MINI_APP_URL=${RAILWAY_URL}/app" 2>/dev/null || true
railway variables set "ADMIN_CHAT_ID=${ADMIN_ID}" 2>/dev/null || true
railway variables set "OPENAI_API_KEY=${OPENAI_KEY}" 2>/dev/null || true
railway variables set "DEEPL_API_KEY=${DEEPL_KEY}" 2>/dev/null || true
railway variables set "STRIPE_SECRET_KEY=${STRIPE_KEY}" 2>/dev/null || true
railway variables set "PORT=8080" 2>/dev/null || true
railway variables set "DATA_DIR=/data" 2>/dev/null || true
railway variables set "DB_PATH=/data/db/bot.db" 2>/dev/null || true
railway variables set "ENVIRONMENT=production" 2>/dev/null || true

ok "Railway variables updated"

# ── 4. Create Stripe Live Webhook ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}-- Step 3: Creating Stripe Live Webhook --${NC}"

info "Creating Stripe webhook endpoint via API..."
WEBHOOK_ENDPOINT="${RAILWAY_URL}/stripe-webhook"

# Create webhook endpoint via Stripe CLI
WEBHOOK_RESP=$(stripe webhook_endpoints create \
  --url "${WEBHOOK_ENDPOINT}" \
  --enabled-events "checkout.session.completed" \
  --enabled-events "payment_intent.succeeded" \
  --enabled-events "payment_intent.payment_failed" \
  2>&1 || true)

WEBHOOK_SECRET=$(echo "$WEBHOOK_RESP" | grep -o 'whsec_[a-zA-Z0-9_]*' | head -1 || true)

if [[ -n "$WEBHOOK_SECRET" ]]; then
  railway variables set "STRIPE_WEBHOOK_SECRET=${WEBHOOK_SECRET}" 2>/dev/null || true
  ok "Stripe webhook secret set: ${WEBHOOK_SECRET:0:15}..."
else
  warn "Could not auto-get webhook secret."
  warn "Go to Stripe Dashboard -> Developers -> Webhooks"
  warn "Add endpoint: ${WEBHOOK_ENDPOINT}"
  warn "Events: checkout.session.completed"
  warn "Then copy the signing secret and run:"
  warn "  railway variables set STRIPE_WEBHOOK_SECRET=whsec_..."
fi

# ── 5. Register Telegram Webhook ──────────────────────────────────────────────
echo ""
echo -e "${YELLOW}-- Step 4: Registering Telegram Webhook --${NC}"

WEBHOOK_URL="${RAILWAY_URL}/webhook"

# Delete existing webhook first
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true" >/dev/null 2>&1

# Set new webhook with secret
WRES=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${WEBHOOK_SECRET_TG}\",
    \"max_connections\": 100,
    \"allowed_updates\": [\"message\", \"callback_query\"]
  }")

if echo "$WRES" | grep -q '"ok":true'; then
  ok "Telegram webhook set: ${WEBHOOK_URL}"
else
  warn "Telegram webhook response: $WRES"
fi

# ── 6. Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}=== Setup Complete! ===${NC}"
echo ""
echo -e "  Bot:      @KaminskyAICoreBot"
echo -e "  URL:      ${RAILWAY_URL}"
echo -e "  Webhook:  ${RAILWAY_URL}/webhook"
echo -e "  MiniApp:  ${RAILWAY_URL}/app"
echo -e "  Health:   ${RAILWAY_URL}/health"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Deploy: git push (or railway up)"
echo -e "  2. Test: Open Telegram -> @KaminskyAICoreBot -> /start"
echo -e "  3. Logs: railway logs --tail"
echo ""
