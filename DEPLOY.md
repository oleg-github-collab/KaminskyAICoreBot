# Railway Deployment Guide

## Prerequisites
```bash
# Install Railway CLI
brew install railway
# OR
npm i -g @railway/cli

# Login
railway login
```

## Step 1: Link Project
```bash
cd /Users/olehkaminskyi/Desktop/KaminskyAICoreBot
railway link
```

## Step 2: Add Redis Service
```bash
# In Railway dashboard or:
railway service add redis
# Use redis:7-alpine image
```

## Step 3: Set Environment Variables
```bash
# Set all secrets
railway variables set BOT_TOKEN="your_telegram_bot_token"
railway variables set ADMIN_CHAT_ID="183844476"
railway variables set WEBHOOK_URL="https://your-app.railway.app/webhook"
railway variables set MINI_APP_URL="https://your-app.railway.app/app"
railway variables set DEEPL_API_KEY="your_deepl_key"
railway variables set OPENAI_API_KEY="your_openai_key"
railway variables set STRIPE_SECRET_KEY="your_stripe_key"
railway variables set STRIPE_PUBLISHABLE_KEY="your_stripe_pub_key"
railway variables set REDIS_URL="redis://redis.railway.internal:6379"
railway variables set PORT="8080"
```

## Step 4: Deploy
```bash
# Push and deploy
git push origin main
railway up

# OR if railway.json exists:
railway deploy
```

## Step 5: Verify Logs
```bash
# Watch logs in real-time
railway logs --follow

# Check health endpoint
curl https://your-app.railway.app/health
```

## Step 6: Test Features
```bash
# Test Redis connection
railway run redis-cli -h redis.railway.internal ping

# Test Telegram webhook
curl -X POST https://your-app.railway.app/webhook \
  -H "Content-Type: application/json" \
  -d '{"update_id": 1}'

# Test web login
open https://your-app.railway.app/login
```

## Troubleshooting
```bash
# View service status
railway status

# SSH into container
railway shell

# Check environment variables
railway variables

# Restart service
railway restart
```

## Expected Log Output
```
{"timestamp":1234567890,"level":"INFO","action":"server_start","port":8080}
{"timestamp":1234567890,"level":"INFO","action":"redis_connected","url":"redis://redis.railway.internal:6379"}
{"timestamp":1234567890,"level":"INFO","action":"db_migrated","version":10}
{"timestamp":1234567890,"level":"INFO","action":"webhook_configured"}
```
