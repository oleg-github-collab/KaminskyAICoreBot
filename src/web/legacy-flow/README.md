# OLD FLOW - archived frontend modules

This folder contains frontend code from the previous project/glossary-management flow.

These files are not loaded by `src/web/index.html` and are not exposed through active `/app/...` static routes. They are kept only as implementation history/reference because the backend glossary functionality must not be deleted yet.

Active user flow is now:

1. Open the Telegram Mini App.
2. Create an order.
3. Choose source and target languages.
4. Upload documents.
5. Toggle glossary usage if needed.
6. Pay with Stripe.
7. Wait for translation and receive ready files in the app and Telegram.

Do not re-add modules from this folder to `src/web/index.html` unless the product flow is intentionally changed again.
