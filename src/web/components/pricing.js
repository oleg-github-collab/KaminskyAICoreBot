const PricingView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">\ud83d\udcb0</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()">\u2190</button>
                <h2>${App.esc(project.name)} \u2014 Вартість</h2>
            </div>
            <div class="pricing-table">
                <div class="pricing-row">
                    <span class="pricing-label">\ud83d\udcc4 Текстові файли</span>
                    <span class="pricing-value">\u20ac0.58 / 1800 символів</span>
                </div>
                <div class="pricing-row">
                    <span class="pricing-label">\ud83d\udcd1 PDF та документи</span>
                    <span class="pricing-value">\u20ac0.89 / 1800 символів</span>
                </div>
            </div>
            <div id="pricing-stats"><div class="loading">Розрахунок...</div></div>
            <div id="pay-section"></div>
            <div id="invoices-section" style="margin-top:16px"></div>`;
        this.loadPricing(project.id);
        this.loadInvoices(project.id);
    },

    async loadPricing(pid) {
        const stats = document.getElementById('pricing-stats');
        const pay = document.getElementById('pay-section');
        if (!stats) return;
        try {
            const data = await API.getPricing(pid);
            const p = data.pricing || {};
            const totalCents = p.total_price_cents || 0;

            stats.innerHTML = `
                <div class="card" style="margin-bottom:16px">
                    <div class="card-title" style="margin-bottom:10px">Статистика проєкту</div>
                    <div class="stats">
                        <div class="stat"><div class="stat-value">${p.total_files || 0}</div><div class="stat-label">Файлів</div></div>
                        <div class="stat"><div class="stat-value">${(p.total_chars || 0).toLocaleString()}</div><div class="stat-label">Символів</div></div>
                        <div class="stat"><div class="stat-value">${p.total_pages || 0}</div><div class="stat-label">Сторінок</div></div>
                    </div>
                    <div class="pricing-total" style="margin-top:12px;border-radius:10px">
                        <div class="pricing-row" style="border:none;padding:0">
                            <span class="pricing-label" style="font-weight:600">Загальна вартість:</span>
                            <span class="pricing-value">\u20ac${App.fmtEuro(totalCents)}</span>
                        </div>
                    </div>
                </div>`;

            if (pay && totalCents > 0) {
                pay.innerHTML = `<button class="btn btn-primary" style="margin-top:16px" onclick="PricingView.createInvoice(${pid})">💳 Оплатити \u20ac${App.fmtEuro(totalCents)}</button>`;
            } else if (pay) {
                pay.innerHTML = '';
            }
        } catch (e) {
            stats.innerHTML = `<p style="color:var(--hint);padding:12px">${App.esc(e.message)}</p>`;
        }
    },

    async loadInvoices(pid) {
        const section = document.getElementById('invoices-section');
        if (!section) return;
        try {
            const data = await API.getInvoices(pid);
            const invoices = data.invoices || [];
            if (!invoices.length) {
                section.innerHTML = '';
                return;
            }
            section.innerHTML = `
                <div style="font-size:13px;font-weight:600;color:var(--hint);margin-bottom:10px">Історія рахунків</div>
                ${invoices.map(inv => `
                    <div class="invoice-item">
                        <div class="invoice-icon ${inv.status === 'paid' ? 'paid' : inv.status === 'manual_review' ? 'review' : 'pending'}">${this.statusIcon(inv.status)}</div>
                        <div class="invoice-info">
                            <div class="invoice-amount">\u20ac${App.fmtEuro(inv.amount_cents)}</div>
                            <div class="invoice-meta">
                                ${this.statusLabel(inv.status)}${inv.created_at ? ' \u00b7 ' + App.fmtDate(inv.created_at) : ''}${inv.paid_at ? ' \u00b7 Сплачено ' + App.fmtDate(inv.paid_at) : ''}
                            </div>
                        </div>
                        ${inv.status === 'pending' && inv.payment_url ? '<a href="' + App.esc(inv.payment_url) + '" target="_blank" class="btn btn-primary btn-sm" style="text-decoration:none;white-space:nowrap">Оплатити</a>' : ''}
                    </div>
                `).join('')}`;
        } catch (e) {
            section.innerHTML = `<p style="color:var(--hint);padding:12px">${App.esc(e.message)}</p>`;
        }
    },

    async createInvoice(pid) {
        try {
            const data = await API.createInvoice(pid);
            if (data.payment_url) {
                window.open(data.payment_url, '_blank');
            } else {
                App.toast('Рахунок створено. Очікуйте підтвердження.', 'info');
            }
            this.loadInvoices(pid);
        } catch (e) { App.toast(e.message, 'error'); }
    },

    statusIcon(s) {
        return { pending: '\u23f3', paid: '\u2705', manual_review: '\ud83d\udcdd' }[s] || '\u2753';
    },

    statusLabel(s) {
        return { pending: 'Очікує оплати', paid: 'Сплачено', manual_review: 'На перевірці' }[s] || s;
    }
};
