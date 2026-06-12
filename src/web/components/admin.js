const AdminView = {
    async render(c) {
        if (!App.isAdmin) {
            c.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${Icons.wrap('admin', 48)}</div>
                    <p class="empty-state-title">Доступ тільки для адміністратора</p>
                    <p class="empty-state-text">Операційний стан системи приховано від користувачів.</p>
                </div>`;
            return;
        }

        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()" data-tooltip="До замовлень">${Icons.wrap('back', 16)}</button>
                <div>
                    <h2>Адмін-стан</h2>
                    <div class="section-subtitle">Баланс OTranslator, черга перекладів і критичні дії</div>
                </div>
                <div class="section-actions">
                    <button class="btn btn-secondary btn-sm" onclick="AdminView.load(true)">
                        ${Icons.wrap('clock', 14)} Оновити
                    </button>
                </div>
            </div>
            <div id="admin-status"><div class="loading">Завантаження...</div></div>`;

        await this.load();
    },

    async load(manual = false) {
        const root = document.getElementById('admin-status');
        if (!root) return;
        if (manual) root.innerHTML = '<div class="loading">Оновлення...</div>';

        try {
            const data = await API.getAdminStatus();
            root.innerHTML = this.renderStatus(data);
        } catch (e) {
            root.innerHTML = `
                <div class="empty-state admin-empty">
                    <div class="empty-state-icon">${Icons.wrap('warning', 42)}</div>
                    <p class="empty-state-title">Не вдалося завантажити адмін-стан</p>
                    <p class="empty-state-text">${App.esc(e.message)}</p>
                </div>`;
        }
    },

    renderStatus(data) {
        const o = data.otranslator || {};
        const q = data.queue || {};
        const policy = data.retry_policy || {};
        const waiting = data.waiting_jobs || [];
        const balanceLabel = o.balance_known ? Number(o.balance || 0).toFixed(2) + ' credits' : 'невідомо';
        const balanceTone = o.balance_known ? (Number(o.balance || 0) > 10 ? 'ok' : 'warn') : 'danger';
        const topUpUrl = o.top_up_url || 'https://otranslator.com/en/pricing';

        return `
            <div class="admin-metrics">
                ${this.metric('OTranslator', balanceLabel, o.balance_known ? 'Баланс доступний' : 'Помилка: ' + (o.balance_error || 'невідомо'), 'pricing', balanceTone)}
                ${this.metric('Waiting credits', q.waiting_credit_jobs || 0, 'Задачі чекають поповнення', 'warning', (q.waiting_credit_jobs || 0) > 0 ? 'warn' : 'ok')}
                ${this.metric('У роботі', (q.pending_jobs || 0) + (q.processing_jobs || 0) + (q.external_pending_jobs || 0), 'Pending, processing, provider wait', 'clock', 'info')}
                ${this.metric('Без оплати', q.payment_required_projects || 0, 'Проєкти не стартують без покриття', 'admin', (q.payment_required_projects || 0) > 0 ? 'warn' : 'ok')}
            </div>

            <div class="admin-actions-row">
                <a class="btn btn-primary" href="${App.esc(topUpUrl)}" target="_blank" rel="noopener">
                    ${Icons.wrap('pricing', 16)} Поповнити OTranslator
                </a>
                <button class="btn btn-secondary" onclick="App.navigate('audit')">
                    ${Icons.wrap('clock', 16)} Відкрити журнал
                </button>
            </div>

            <div class="admin-panel-grid">
                <div class="admin-panel-block">
                    <div class="admin-block-title">${Icons.wrap('info', 18)} Політика автодоведення</div>
                    <div class="admin-kv"><span>Повтор</span><strong>кожні ${Math.round((policy.balance_retry_interval_seconds || 300) / 60)} хв</strong></div>
                    <div class="admin-kv"><span>Максимум очікування</span><strong>${policy.max_balance_wait_days || 7} днів</strong></div>
                    <div class="admin-kv"><span>Найближчий retry</span><strong>${this.fmtWhen(q.next_balance_retry_at)}</strong></div>
                    <div class="admin-kv"><span>Найбільша спроба</span><strong>${q.max_balance_retry_count || 0}/${policy.max_balance_retries || 2016}</strong></div>
                </div>
                <div class="admin-panel-block">
                    <div class="admin-block-title">${Icons.wrap('check', 18)} Гарантії флоу</div>
                    <div class="admin-note-line">Платний переклад не запускається без покриття Stripe-оплати.</div>
                    <div class="admin-note-line">Якщо credits бракує після оплати, job лишається у durable waiting_credits.</div>
                    <div class="admin-note-line">Після поповнення система сама повторить запуск і доставить готовий файл.</div>
                    <div class="admin-note-line">Глосарії: плануємо versioned preview/diff і валідацію, без змін у цьому деплої.</div>
                </div>
            </div>

            <div class="admin-panel-block admin-waiting-block">
                <div class="admin-block-title">${Icons.wrap('warning', 18)} Задачі, що чекають credits</div>
                ${this.renderWaitingJobs(waiting)}
            </div>`;
    },

    metric(label, value, hint, icon, tone) {
        return `
            <div class="admin-metric admin-metric-${tone}">
                <div class="admin-metric-icon">${Icons.wrap(icon, 20)}</div>
                <div class="admin-metric-main">
                    <div class="admin-metric-value">${App.esc(String(value))}</div>
                    <div class="admin-metric-label">${App.esc(label)}</div>
                    <div class="admin-metric-hint">${App.esc(hint)}</div>
                </div>
            </div>`;
    },

    renderWaitingJobs(items) {
        if (!items.length) {
            return `
                <div class="empty-state admin-empty-inline">
                    <div class="empty-state-icon">${Icons.wrap('check', 36)}</div>
                    <p class="empty-state-title">Черга credits порожня</p>
                    <p class="empty-state-text">Немає перекладів, які заблоковані балансом OTranslator.</p>
                </div>`;
        }

        return `
            <div class="admin-job-list">
                ${items.map(job => `
                    <div class="admin-job-row">
                        <div class="admin-job-main">
                            <div class="admin-job-title">${App.esc(job.file_name || 'Файл')}</div>
                            <div class="admin-job-meta">
                                Project #${job.project_id} · Job #${job.job_id} · ${App.esc(job.target_lang || '')}
                            </div>
                            <div class="admin-job-project">${App.esc(job.project_name || '')}</div>
                        </div>
                        <div class="admin-job-side">
                            <span class="job-status waiting">${job.retry_count || 0} retry</span>
                            <span>${this.fmtWhen(job.next_retry_at)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>`;
    },

    fmtWhen(ts) {
        if (!ts) return 'немає';
        const now = Math.floor(Date.now() / 1000);
        const diff = Number(ts) - now;
        if (diff > 60) return App.fmtDate(ts) + ' · через ' + Math.ceil(diff / 60) + ' хв';
        if (diff > 0) return App.fmtDate(ts) + ' · менше хвилини';
        return App.fmtDate(ts) + ' · зараз';
    },
};
