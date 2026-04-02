const TIERS = {
    optimum: {
        name: 'Оптимум',
        priceCents: 91,
        tagline: 'Швидкий та точний',
        description: 'Професійний переклад з використанням вашого затвердженого глосарію. Ідеально для текстових документів, де важливий зміст, а не оформлення.',
        features: [
            'Переклад з урахуванням глосарію',
            'Налаштування формальності (Sie/Ви, du/ти)',
            'Контекст документу для точності',
            'Швидкий результат \u2014 хвилини, не години',
            'Перевірка спеціалістом перед видачею',
        ],
        formats: 'TXT, DOCX, PDF (текстові)',
        badge: null,
    },
    ultra: {
        name: 'Ультра',
        priceCents: 135,
        tagline: 'Максимальна якість',
        description: 'Найвищий рівень перекладу з повним збереженням оригінального форматування. Для складних документів, презентацій та захищених файлів.',
        features: [
            'Переклад з урахуванням глосарію',
            'Повне збереження макету та форматування',
            '30+ форматів: PDF, DOCX, PPTX, XLSX, EPUB',
            'Переклад тексту на зображеннях (PDF, DOCX)',
            'Скановані та захищені паролем PDF',
            'Двомовний PDF (оригінал + переклад поруч)',
            'Переклад назв файлів',
            'Перевірка спеціалістом перед видачею',
        ],
        formats: 'PDF, DOCX, PPTX, XLSX, EPUB, HTML, TXT та 20+ інших',
        badge: 'Рекомендовано',
    }
};

const PricingView = {
    selectedTier: 'ultra',
    pricingData: null,

    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty-state"><div class="empty-state-icon">\ud83d\udcb0</div><p class="empty-state-title">Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }

        const stage = project.workflow_stage || 'files_uploaded';
        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()">\u2190</button>
                <h2>${App.esc(project.name)} \u2014 Замовлення</h2>
            </div>
            <div id="workflow-bar-container"></div>
            <div id="pricing-content"><div class="loading" style="padding:40px;text-align:center">Завантаження...</div></div>
            <div id="invoices-section" style="margin-top:24px"></div>`;

        if (typeof WorkflowBar !== 'undefined') {
            WorkflowBar.render(document.getElementById('workflow-bar-container'), stage);
        }

        this.loadPricing(project.id, stage);
        this.loadInvoices(project.id);
    },

    async loadPricing(pid, stage) {
        const container = document.getElementById('pricing-content');
        if (!container) return;

        try {
            const data = await API.getPricing(pid);
            this.pricingData = data;
            const p = data.pricing || {};
            const files = data.files || [];

            if (this.isGlossaryStage(stage)) {
                this.renderGlossaryOrder(container, pid, p, files);
            } else if (this.isTranslationStage(stage)) {
                this.renderTranslationOrder(container, pid, p, files);
            } else if (stage === 'completed') {
                this.renderCompleted(container);
            } else {
                // glossary_paid, glossary_review — waiting stages
                this.renderWaiting(container, stage);
            }
        } catch (e) {
            container.innerHTML = '<div class="empty-state"><p class="empty-state-text">' + App.esc(e.message) + '</p></div>';
        }
    },

    isGlossaryStage(stage) {
        return !stage || stage === 'files_uploaded';
    },

    isTranslationStage(stage) {
        return ['glossary_approved', 'translation_paid', 'translation_processing', 'translation_review'].includes(stage);
    },

    // ─── Glossary Ordering (Stage 1) ─────────────────────────────────────
    renderGlossaryOrder(container, pid, pricing, files) {
        const totalCents = pricing.total_price_cents || 0;

        let fileRows = '';
        if (files.length > 0) {
            fileRows = files.map(f => `
                <div class="order-file-row">
                    <div class="file-name">\ud83d\udcc4 ${App.esc(f.name)}</div>
                    <div class="file-stats">${f.pages ? f.pages + ' стор.' : f.chars ? f.chars.toLocaleString() + ' сим.' : ''}</div>
                    <div class="file-price">\u20ac${App.fmtEuro(f.price_cents || 0)}</div>
                </div>
            `).join('');
        } else {
            fileRows = `
                <div class="stats" style="margin-bottom:12px">
                    <div class="stat"><div class="stat-value">${pricing.total_files || 0}</div><div class="stat-label">Файлів</div></div>
                    <div class="stat"><div class="stat-value">${(pricing.total_chars || 0).toLocaleString()}</div><div class="stat-label">Символів</div></div>
                    <div class="stat"><div class="stat-value">${pricing.total_pages || 0}</div><div class="stat-label">Сторінок</div></div>
                </div>`;
        }

        container.innerHTML = `
            <div class="card" style="margin-bottom:16px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                    <div class="card-title">Створення глосарію</div>
                </div>
                <p style="color:var(--hint);font-size:13px;margin-bottom:16px;line-height:1.5">
                    Глосарій \u2014 основа якісного перекладу. Спеціаліст підготує термінологію з ваших текстів
                    для точного та послідовного перекладу всіх документів.
                </p>
                ${fileRows}
                <div class="order-total">
                    <span>Разом</span>
                    <span>\u20ac${App.fmtEuro(totalCents)}</span>
                </div>
                ${totalCents > 0 ? `
                    <button class="btn-order" onclick="PricingView.orderGlossary(${pid})">
                        Замовити глосарій \u2014 \u20ac${App.fmtEuro(totalCents)}
                    </button>
                ` : `<div style="text-align:center;padding:16px 12px">
                    <p style="color:var(--hint);font-size:13px;margin-bottom:12px">Завантажте вихідні файли для розрахунку вартості глосарію</p>
                    <button class="btn btn-secondary btn-sm" onclick="App.navigate('files')" style="gap:6px">
                        \ud83d\udcc2 Перейти до файлів
                    </button>
                </div>`}
            </div>`;
    },

    // ─── Translation Ordering (Stage 2) ─────────────────────────────────
    renderTranslationOrder(container, pid, pricing, files) {
        const trans = pricing.translation || {};

        container.innerHTML = `
            <div class="card" style="margin-bottom:16px">
                <div class="card-title" style="margin-bottom:4px">Замовити переклад</div>
                <p style="color:var(--hint);font-size:13px;margin-bottom:20px">Оберіть рівень перекладу для ваших документів</p>
                <div class="tier-selector" id="tier-selector">
                    ${this.renderTierCard('optimum')}
                    ${this.renderTierCard('ultra')}
                </div>
            </div>
            <div id="order-summary-container"></div>`;

        this.updateOrderSummary(pid, files, trans);
    },

    renderTierCard(tierId) {
        const tier = TIERS[tierId];
        const isSelected = this.selectedTier === tierId;
        return `
            <div class="tier-card${isSelected ? ' selected' : ''}" onclick="PricingView.selectTier('${tierId}')">
                ${tier.badge ? '<div class="tier-badge">\u2605 ' + tier.badge + '</div>' : ''}
                <div class="tier-name">${tier.name}</div>
                <div class="tier-tagline">${tier.tagline}</div>
                <div class="tier-price"><span class="currency">\u20ac</span>${(tier.priceCents / 100).toFixed(2)}<span class="tier-price-unit"> / стор.</span></div>
                <p class="tier-desc">${App.esc(tier.description)}</p>
                <ul class="tier-features">
                    ${tier.features.map(f => '<li>' + App.esc(f) + '</li>').join('')}
                </ul>
                <div class="tier-formats">Формати: ${App.esc(tier.formats)}</div>
                <div class="tier-radio">
                    <div class="tier-radio-dot"></div>
                    <span>${isSelected ? 'Обрано' : 'Обрати'}</span>
                </div>
            </div>`;
    },

    selectTier(tierId) {
        this.selectedTier = tierId;
        const selector = document.getElementById('tier-selector');
        if (selector) {
            selector.innerHTML = this.renderTierCard('optimum') + this.renderTierCard('ultra');
        }
        if (this.pricingData) {
            const p = this.pricingData.pricing || {};
            const files = this.pricingData.files || [];
            const trans = p.translation || {};
            const pid = App.currentProject?.id;
            if (pid) this.updateOrderSummary(pid, files, trans);
        }
    },

    updateOrderSummary(pid, files, trans) {
        const container = document.getElementById('order-summary-container');
        if (!container) return;

        const tier = TIERS[this.selectedTier];
        const tierData = trans[this.selectedTier] || {};
        const totalCents = tierData.total_cents || 0;
        const perPage = tierData.per_page_cents || tier.priceCents;

        let fileRows = '';
        if (files.length > 0) {
            fileRows = files.map(f => {
                const pages = f.pages || Math.ceil((f.chars || 0) / 1800) || 1;
                const price = pages * perPage;
                return `
                    <div class="order-file-row">
                        <div class="file-name">\ud83d\udcc4 ${App.esc(f.name)}</div>
                        <div class="file-stats">${f.pages ? f.pages + ' стор.' : f.chars ? f.chars.toLocaleString() + ' сим.' : ''}</div>
                        <div class="file-price">\u20ac${App.fmtEuro(price)}</div>
                    </div>`;
            }).join('');
        }

        container.innerHTML = `
            <div class="card order-summary">
                <div class="card-title" style="margin-bottom:12px">Ваше замовлення \u00b7 ${tier.name}</div>
                ${fileRows}
                <div class="order-total">
                    <span>Разом</span>
                    <span>\u20ac${App.fmtEuro(totalCents)}</span>
                </div>
                ${totalCents > 0 ? `
                    <button class="btn-order" onclick="PricingView.orderTranslation(${pid})">
                        Замовити переклад \u2014 \u20ac${App.fmtEuro(totalCents)}
                    </button>
                    <p style="color:var(--hint);text-align:center;padding:12px 0 0;font-size:12px;line-height:1.5">
                        Після оплати ваші документи будуть перекладені з використанням затвердженого глосарію.
                        Спеціаліст перевірить якість перед відправкою.
                    </p>
                ` : ''}
            </div>`;
    },

    renderWaiting(container, stage) {
        const messages = {
            'glossary_paid': 'Глосарій оплачено. Спеціаліст вже працює над вашою термінологією.',
            'glossary_review': 'Глосарій на перевірці. Перегляньте терміни у вкладці "Глосарій".',
        };
        container.innerHTML = `
            <div class="card">
                <div class="empty-state" style="padding:32px 16px">
                    <div class="empty-state-icon">\u23f3</div>
                    <p class="empty-state-title">${messages[stage] || 'Очікуйте...'}</p>
                    <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="App.navigate(2)">Переглянути глосарій</button>
                </div>
            </div>`;
    },

    renderCompleted(container) {
        container.innerHTML = `
            <div class="card">
                <div class="empty-state" style="padding:32px 16px">
                    <div class="empty-state-icon">\u2705</div>
                    <p class="empty-state-title">Переклад завершено</p>
                    <p class="empty-state-text">Всі документи перекладено та перевірено. Перегляньте результати у вкладці "Файли".</p>
                    <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="App.navigate(1)">Переглянути файли</button>
                </div>
            </div>`;
    },

    // ─── Order Actions ───────────────────────────────────────────────────
    async orderGlossary(pid) {
        try {
            const data = await API.createInvoice(pid, { type: 'glossary' });
            if (data.payment_url) {
                window.open(data.payment_url, '_blank');
                App.toast('Переходимо до оплати...', 'info');
            } else {
                App.toast('Замовлення створено', 'success');
            }
            setTimeout(() => this.loadInvoices(pid), 1500);
        } catch (e) { App.toast(e.message, 'error'); }
    },

    async orderTranslation(pid) {
        try {
            const data = await API.createInvoice(pid, { type: 'translation', tier: this.selectedTier });
            if (data.payment_url) {
                window.open(data.payment_url, '_blank');
                App.toast('Переходимо до оплати...', 'info');
            } else {
                App.toast('Замовлення створено', 'success');
            }
            setTimeout(() => this.loadInvoices(pid), 1500);
        } catch (e) { App.toast(e.message, 'error'); }
    },

    // ─── Invoice History ─────────────────────────────────────────────────
    async loadInvoices(pid) {
        const section = document.getElementById('invoices-section');
        if (!section) return;
        try {
            const data = await API.getInvoices(pid);
            const invoices = data.invoices || [];
            if (!invoices.length) { section.innerHTML = ''; return; }

            section.innerHTML = `
                <div class="card">
                    <div class="card-title" style="margin-bottom:12px">Історія замовлень</div>
                    ${invoices.map(inv => `
                        <div class="invoice-card ${inv.status === 'paid' ? 'paid' : 'pending'}">
                            <div class="invoice-icon">${this.statusIcon(inv.status)}</div>
                            <div class="invoice-details">
                                <div class="invoice-amount">\u20ac${App.fmtEuro(inv.amount_cents)}</div>
                                <div class="invoice-meta">
                                    ${this.invoiceTypeLabel(inv.invoice_type, inv.translation_tier)}
                                    \u00b7 ${this.statusLabel(inv.status)}
                                    ${inv.created_at ? ' \u00b7 ' + App.fmtDate(inv.created_at) : ''}
                                </div>
                            </div>
                            ${inv.status === 'pending' && inv.payment_url ? '<a href="' + App.esc(inv.payment_url) + '" target="_blank" class="invoice-action">Сплатити</a>' : ''}
                        </div>
                    `).join('')}
                </div>`;
        } catch (e) {
            section.innerHTML = '';
        }
    },

    statusIcon(s) {
        return { pending: '\u23f3', paid: '\u2705', manual_review: '\ud83d\udcdd' }[s] || '\u2753';
    },

    statusLabel(s) {
        return { pending: 'Очікує оплати', paid: 'Сплачено', manual_review: 'На перевірці' }[s] || s;
    },

    invoiceTypeLabel(type, tier) {
        if (type === 'translation' && tier) {
            return TIERS[tier] ? TIERS[tier].name : tier;
        }
        if (type === 'glossary') return 'Глосарій';
        return 'Замовлення';
    }
};
