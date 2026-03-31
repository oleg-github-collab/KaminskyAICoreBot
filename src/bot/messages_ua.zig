/// All bot UI texts in Ukrainian. Never mentions AI providers.

/// Admin welcome — full bot menu
pub const welcome =
    \\<b>KI Beratung — Admin Panel</b>
    \\
    \\Повний контроль над проєктами, файлами, глосаріями та робочим процесом.
    \\
    \\Оберіть дію нижче:
;

/// User welcome — redirects to web app
pub const welcome_user =
    \\<b>Вітаємо у KI Beratung!</b>
    \\
    \\Ми допоможемо вам з професійною обробкою перекладацьких документів та створенням глосаріїв.
    \\
    \\Відкрийте наш застосунок для управління проєктами, завантаження файлів, оплати та перегляду глосаріїв.
    \\
    \\Середня швидкість обробки — <b>95 сторінок на добу</b>
    \\Більше продуктів та послуг: <b>kaminskyi.chat</b>
;

pub const use_app = "Для управління проєктами, файлами та оплатою скористайтесь застосунком.";

pub const use_app_for_files = "Для завантаження файлів скористайтесь нашим застосунком — це набагато зручніше.";

pub const help =
    \\<b>Як користуватися сервісом:</b>
    \\
    \\1. Відкрийте <b>Застосунок</b> (кнопка нижче)
    \\2. Створіть проєкт та завантажте файли
    \\3. Оплатіть послугу
    \\4. Отримайте готовий глосарій та переклад
    \\
    \\<b>Вартість:</b>
    \\• Текстові файли: €0.58 за кожні 1800 символів
    \\• PDF файли: €0.89 за сторінку
    \\
    \\Натисніть «Написати спеціалісту» для зв'язку з нами.
    \\
    \\Більше продуктів та послуг: <b>kaminskyi.chat</b>
;

pub const choose_action = "Оберіть дію:";

pub const project_created =
    \\Проєкт <b>{s}</b> створено успішно!
    \\
    \\Тепер ви можете завантажити файли для обробки.
;

pub const project_name_prompt = "Будь ласка, введіть назву нового проєкту:";

pub const no_projects =
    \\У вас ще немає проєктів.
    \\Натисніть "Новий проєкт", щоб створити перший.
;

pub const select_project = "Оберіть проєкт:";

pub const project_menu =
    \\<b>Проєкт: {s}</b>
    \\
    \\Оберіть дію для цього проєкту:
;

pub const upload_source_prompt =
    \\Будь ласка, надішліть <b>вихідні файли</b> для обробки.
    \\
    \\Підтримуються: текстові файли (.txt, .doc, .docx) та PDF.
    \\Ви можете надіслати декілька файлів поспіль.
    \\
    \\Коли завершите — натисніть кнопку "Завершити завантаження".
;

pub const upload_reference_prompt =
    \\Будь ласка, надішліть <b>референсні файли</b> (вже перекладені версії).
    \\
    \\Ці файли будуть використані для аналізу та створення глосарію професійних термінів.
    \\
    \\Коли завершите — натисніть кнопку "Завершити завантаження".
;

pub const file_received =
    \\Файл отримано: <b>{s}</b>
    \\Розмір: {s}
    \\{s}
    \\
    \\Продовжуйте надсилати файли або натисніть "Завершити завантаження".
;

pub const upload_complete =
    \\Завантаження завершено!
    \\
    \\Отримано файлів: <b>{d}</b>
    \\{s}
    \\
    \\Орієнтовна вартість: <b>€{s}</b>
;

pub const chat_mode_started =
    \\Ви в режимі переписки. Пишіть ваше повідомлення — ми передамо його нашому спеціалісту.
    \\
    \\Щоб повернутися до меню, натисніть кнопку нижче.
;

pub const message_forwarded = "Ваше повідомлення передано спеціалісту. Очікуйте відповідь.";

pub const glossary_started =
    \\Глосарій для проєкту <b>{s}</b> в роботі.
    \\
    \\Ваші файли передані спеціалісту для підготовки глосарію. Це може зайняти деякий час.
    \\
    \\Ми повідомимо вас, коли глосарій буде готовий.
;

pub const glossary_ready =
    \\Глосарій для проєкту <b>{s}</b> готовий!
    \\
    \\Знайдено <b>{d}</b> професійних термінів.
    \\
    \\Ви зможете переглянути та завантажити глосарій у панелі управління.
;

pub const glossary_approved =
    \\Глосарій для проєкту <b>{s}</b> перевірено та затверджено!
    \\
    \\Кількість термінів: <b>{d}</b>
    \\
    \\Ви можете переглянути та завантажити глосарій у панелі управління.
;

pub const invoice_created =
    \\<b>Рахунок на оплату</b>
    \\
    \\Проєкт: {s}
    \\Сума: <b>€{s}</b>
    \\
    \\Натисніть кнопку нижче для оплати.
    \\Після оплати обробка розпочнеться автоматично.
;

pub const payment_received =
    \\Оплату отримано! Дякуємо!
    \\
    \\Обробка вашого проєкту <b>{s}</b> розпочинається.
    \\Ми повідомимо вас про результат.
;

pub const invite_link =
    \\Посилання для запрошення до проєкту <b>{s}</b>:
    \\
    \\{s}
    \\
    \\Надішліть це посилання вашим колегам.
;

pub const joined_project = "Ви успішно приєднались до проєкту <b>{s}</b>!";

pub const unknown_command = "Оберіть дію за допомогою кнопок нижче.";

pub const error_generic = "Виникла помилка. Спробуйте ще раз або зверніться до нашого спеціаліста.";

pub const error_no_project = "Спершу оберіть або створіть проєкт.";

pub const error_not_member = "У вас немає доступу до цього проєкту.";

pub const back_to_menu = "Повернення до головного меню.";

// Admin notifications
pub const admin_new_user = "Новий користувач: <b>{s} {s}</b> (@{s})";
pub const admin_new_file = "Новий файл від <b>{s}</b> в проєкті <b>{s}</b>:\n{s} ({s})";
pub const admin_new_message = "Повідомлення від <b>{s} {s}</b> (@{s}):";
pub const admin_payment = "Оплата отримана: <b>€{s}</b> від {s} за проєкт {s}";
pub const admin_glossary_ready = "Готовий глосарій!\nПроєкт: <b>{s}</b>\nТермінів: <b>{d}</b>\nПерегляньте та вирішіть як діяти далі.";

// Chatbot system context (NEVER show to users)
pub const chatbot_system_prompt =
    \\You are a helpful assistant for Kaminsky AI Core translation service.
    \\You help clients understand how to use the service.
    \\
    \\RULES:
    \\1. Answer ONLY questions about the service, projects, file uploads, glossaries, pricing, and payments
    \\2. NEVER mention any technology providers, APIs, AI models, or third-party services
    \\3. NEVER mention OpenAI, GPT, DeepL, Stripe, or any other provider names
    \\4. Refer to the system as "our analysis system" or "our service"
    \\5. Answer in Ukrainian unless the client writes in another language
    \\6. Be polite, professional, and helpful
    \\7. If asked about technical implementation, say "це наша власна розробка"
    \\
    \\SERVICE INFO:
    \\- Clients upload source files (text, PDF) and reference translations
    \\- Our specialists prepare professional glossaries of terms based on uploaded files
    \\- Pricing: €0.58 per 1800 characters (text), €0.89 per page (PDF)
    \\- Payment is required before processing begins
    \\- Clients can create projects, invite team members, and manage files
    \\- Glossaries are reviewed by specialists before being shared
;
