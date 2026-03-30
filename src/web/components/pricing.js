const PricingView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">💰</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <button class="btn" style="padding:6px 12px;width:auto" onclick="App.backToProjects()">\u2190</button>
                <h2 style="font-size:16px;margin:0;flex:1">${App.esc(project.name)} \u2014 Вартість</h2>
            </div>
            <div class="card" style="margin-bottom:12px">
                <div class="card-title">Тарифи KI Beratung</div>
                <div class="card-sub" style="margin-top:6px">
                    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
                        <span>Текстові файли</span><b>\u20ac0.58 / 1800 символів</b>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:4px 0">
                        <span>PDF файли</span><b>\u20ac0.89 / сторінка</b>
                    </div>
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
                <div class="card" style="margin-bottom:12px">
                    <div class="card-title" style="margin-bottom:8px">Статистика проєкту</div>
                    <div class="stats">
                        <div class="stat"><div class="stat-value">${p.total_files || 0}</div><div class="stat-label">Файлів</div></div>
                        <div class="stat"><div class="stat-value">${p.total_chars || 0}</div><div class="stat-label">Символів</div></div>
                        <div class="stat"><div class="stat-value">${p.total_pages || 0}</div><div class="stat-label">Сторінок</div></div>
                    </div>
                    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
                        <span style="font-size:14px;font-weight:600">Загальна вартість:</span>
                        <span style="font-size:20px;font-weight:700;color:var(--btn)">\u20ac${App.fmtEuro(totalCents)}</span>
                    </div>
                </div>`;

            if (pay && totalCents > 0) {
                pay.innerHTML = `<button class="btn btn-primary" onclick="PricingView.createInvoice(${pid})">Оплатити \u20ac${App.fmtEuro(totalCents)}</button>`;
            } else if (pay) {
                pay.innerHTML = '';
            }
        } catch (e) {
            stats.innerHTML = `<p style="color:var(--hint)">${App.esc(e.message)}</p>`;
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
                <div class="card-title" style="margin-bottom:8px">Історія рахунків</div>
                ${invoices.map(inv => `
                    <div class="file-item">
                        <div class="file-icon">${this.statusIcon(inv.status)}</div>
                        <div class="file-info" style="flex:1">
                            <div class="file-name">\u20ac${App.fmtEuro(inv.amount_cents)} \u2014 ${App.esc(inv.description || 'KI Beratung')}</div>
                            <div class="file-meta">
                                ${this.statusLabel(inv.status)}${inv.created_at ? ' \u00b7 ' + App.fmtDate(inv.created_at) : ''}${inv.paid_at ? ' \u00b7 Сплачено ' + App.fmtDate(inv.paid_at) : ''}
                            </div>
                        </div>
                        ${inv.status === 'pending' && inv.payment_url ? '<a href="' + App.esc(inv.payment_url) + '" target="_blank" class="btn btn-primary" style="width:auto;padding:4px 12px;font-size:12px;text-decoration:none">Оплатити</a>' : ''}
                    </div>
                `).join('')}`;
        } catch (e) {
            section.innerHTML = `<p style="color:var(--hint)">${App.esc(e.message)}</p>`;
        }
    },

    async createInvoice(pid) {
        try {
            const data = await API.createInvoice(pid);
            if (data.payment_url) {
                window.open(data.payment_url, '_blank');
            } else {
                App.alert('Рахунок створено. Очікуйте підтвердження.');
            }
            this.loadInvoices(pid);
        } catch (e) { App.alert(e.message); }
    },

    statusIcon(s) {
        return { pending: '\u23f3', paid: '\u2705', manual_review: '\ud83d\udcdd' }[s] || '\u2753';
    },

    statusLabel(s) {
        return { pending: 'Очікує оплати', paid: 'Сплачено', manual_review: 'На перевірці' }[s] || s;
    }
};
