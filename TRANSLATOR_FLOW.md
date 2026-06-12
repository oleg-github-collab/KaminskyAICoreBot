# Translator Flow

## User Flow

1. User opens the bot and presses `Відкрити застосунок`.
   Telegram buttons use `MINI_APP_URL`, currently `https://kaminskyi.chat/translatorbot/app`.

2. The app authenticates the user through Telegram Mini App data or browser OAuth.
   The bot is public when `ALLOWED_TELEGRAM_IDS=*` or empty. Project data is isolated by
   `project_members`: users only see projects they own or joined through an invite.

3. User creates an order in `Замовлення`.
   They enter an order name, source language, and initial target language.

4. User uploads source files on the payment/order screen.
   The backend extracts text and stores character/page counts before payment.

5. The app shows the exact estimate.
   Pricing is calculated per 1800 effective characters:
   - TXT/DOCX without glossary: EUR 0.68
   - TXT/DOCX with glossary: EUR 0.91
   - PDF/OCR/XLSX and similar formats: EUR 1.35

6. User may add more target languages and toggle glossary usage.
   The public UI only shows a checkbox. The configured glossary name is internal.

7. User presses pay.
   Stripe Checkout redirects back to `MINI_APP_URL?payment=success` or `MINI_APP_URL?payment=cancel`.

8. After Stripe webhook confirmation, translation jobs start.
   The app verifies that paid Stripe invoices cover the current quote before any worker starts.
   Translation jobs are created for every `source file x target language` pair, then processed
   durably with retry/recovery.

9. If the translation account has insufficient credits, the user only sees the order as queued.
   Admin receives a notification, refills credits, and the waiting job is retried.

10. User receives completion notification and can view/download ready files in the app and Telegram.

11. Owner can invite collaborators from `Команда`.
    The invite is a Telegram deep link (`/start invite_CODE`) that adds the user to
    `project_members` as `member`.

## Code Map

- Active app shell: `src/web/index.html`
- Active app router/state: `src/web/app.js`
- Sidebar and mobile nav: `src/web/components/sidebar.js`
- Order list/create screen: `src/web/components/projects.js`
- Order estimate, upload, glossary toggle, Stripe payment, job status: `src/web/components/pricing.js`
- File list, preview, download, delete: `src/web/components/files.js`
- Team/invite screen: `src/web/components/team.js`
- Active browser API client: `src/web/lib/api-client.js`
- Static web routes: `src/main.zig`
- Telegram bot keyboards and callback routing: `src/bot/commands.zig`
- Telegram bot text: `src/bot/messages_ua.zig`
- Browser Telegram OAuth redirect: `src/auth/telegram_oauth.zig`
- Mini App API and Stripe checkout: `src/api/miniapp.zig`
- Translation job orchestration: `src/webhook/handler.zig`
- Processor HTTP client: `src/processing/processor_client.zig`
- Translation processor service: `services/processor/otranslator_service.py`
- Character counting helpers: `src/processing/pricing.zig`, `services/processor/counter.py`
- Deployment compose for Hetzner: `deploy/translatorbot/docker-compose.yml`
- Nginx location for `kaminskyi.chat/translatorbot`: `deploy/translatorbot/nginx-location.conf`

## Archived Old Frontend Flow

Old frontend modules for glossary ordering, comments, file pair comparison, workflow bars, upload wizard, and versioning were moved to:

`src/web/legacy-flow/`

They are not loaded by the active HTML and are not served through active `/app/...` static routes. Backend endpoints are intentionally still present so the glossary functionality can be restored or reused later without data loss.

## Routing Rules

Production path prefix is `/translatorbot`.

- Public app: `https://kaminskyi.chat/translatorbot/app`
- API: `https://kaminskyi.chat/translatorbot/api/...`
- Telegram webhook: `https://kaminskyi.chat/translatorbot/webhook`
- Browser OAuth: `https://kaminskyi.chat/translatorbot/auth/telegram`
- Stripe return URL: `https://kaminskyi.chat/translatorbot/app?payment=success|cancel`
