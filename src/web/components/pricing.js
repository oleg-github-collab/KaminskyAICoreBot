const PricingView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">💰</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Вартість</h2>
            <div class="card" style="margin-bottom:16px">
                <div class="card-title">Тарифи</div>
                <div class="card-sub" style="margin-top:4px">
                    Текстові файли: <b>€0.58</b> за 1800 символів<br>
                    PDF файли: <b>€0.69</b> за сторінку
                </div>
            </div>
            <div id="pricing-stats"><div class="loading">Розрахунок...</div></div>
            <div id="pay-section" style="margin-top:16px"></div>`;
        this.loadPricing(project.id);
    },

    async loadPricing(pid) {
        const stats = document.getElementById('pricing-stats');
        const pay = document.getElementById('pay-section');
        if (!stats) return;
        try {
            const data = await API.getPricing(pid);
            const p = data.pricing || {};
            stats.innerHTML = `
                <div class="stats">
                    <div class="stat"><div class="stat-value">${p.total_files || 0}</div><div class="stat-label">Файлів</div></div>
                    <div class="stat"><div class="stat-value">€${this.fmt(p.total_price_cents)}</div><div class="stat-label">Всього</div></div>
                </div>
                <div class="stats">
                    <div class="stat"><div class="stat-value">${p.total_chars || 0}</div><div class="stat-label">Символів</div></div>
                    <div class="stat"><div class="stat-value">${p.total_pages || 0}</div><div class="stat-label">Сторінок</div></div>
                </div>`;
            if (p.total_price_cents > 0 && pay) {
                pay.innerHTML = `<button class="btn btn-primary" onclick="PricingView.createInvoice(${pid})">Оплатити €${this.fmt(p.total_price_cents)}</button>`;
            }
        } catch (e) {
            stats.innerHTML = `<p style="color:var(--hint)">${App.esc(e.message)}</p>`;
        }
    },

    async createInvoice(pid) {
        try {
            const data = await API.createInvoice(pid);
            if (data.payment_url) {
                window.open(data.payment_url, '_blank');
            } else {
                App.alert('Рахунок створено. Перевірте бот для посилання на оплату.');
            }
        } catch (e) { App.alert(e.message); }
    },

    fmt(cents) {
        if (!cents) return '0.00';
        return (cents / 100).toFixed(2);
    }
};
