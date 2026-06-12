const ORDER_LANGUAGES = window.LanguageMeta
    ? window.LanguageMeta.defaults()
    : ['German', 'Ukrainian', 'English', 'Polish', 'French', 'Spanish', 'Italian', 'Dutch'];

const PricingView = {
    pricingData: null,
    uploading: false,
    activeStep: null,
    projectId: null,
    pollTimer: null,
    orderLanguages: ORDER_LANGUAGES,
    optionsLoaded: false,
    silentPollFailures: 0,

    async render(c, project) {
        this.stopStatusPolling();
        if (!project) {
            c.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${Icons.wrap('pricing', 48)}</div>
                    <p class="empty-state-title">Створіть або оберіть замовлення</p>
                    <button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До замовлень</button>
                </div>`;
            return;
        }
        if (this.projectId !== project.id) {
            this.projectId = project.id;
            this.activeStep = null;
        }
        await this.loadOptions();

        c.innerHTML = `
            <div class="section-header order-header">
                <div>
                    <h2>${App.esc(project.name)}</h2>
                    <div class="order-subtitle">Професійний переклад документів</div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="PricingView.openSupportModal()">
                    ${Icons.wrap('comment', 16)} Проблема
                </button>
            </div>
            <div id="pricing-content"><div class="loading" style="padding:40px;text-align:center">Завантаження...</div></div>`;

        await this.loadPricing(project.id);
    },

    async loadPricing(pid, silent = false) {
        const container = document.getElementById('pricing-content');
        if (!container) return;

        try {
            const data = await API.getPricing(pid);
            this.pricingData = data;
            this.silentPollFailures = 0;
            this.renderOrder(container, pid, data);
        } catch (e) {
            console.error('Failed to load pricing:', e);
            if (!silent) {
                container.innerHTML = `<div class="empty-state"><p class="empty-state-text">${App.esc(e.message)}</p></div>`;
            } else {
                // Silent background poll failed — warn the user after repeated failures.
                this.silentPollFailures++;
                if (this.silentPollFailures >= 3) {
                    this.silentPollFailures = 0;
                    App.toast('Не вдається оновити статус, перезавантажте', 'warning');
                }
            }
        }
    },

    renderOrder(container, pid, data) {
        const project = App.currentProject || {};
        const pricing = data.pricing || {};
        const files = data.files || [];
        const stage = data.workflow_stage || project.workflow_stage || 'files_uploaded';
        const targets = this.targetLanguages(pricing.target_lang || project.target_lang || 'Ukrainian');
        const source = pricing.source_lang || project.source_lang || 'German';
        const total = pricing.total_price_cents || 0;
        const due = pricing.due_translation_cents ?? total;
        const isProcessing = ['translation_paid', 'translation_processing', 'translation_review'].includes(stage);
        const isCompleted = ['completed', 'completed_with_errors'].includes(stage);
        const locked = isProcessing || isCompleted;
        if (isProcessing) this.startStatusPolling(pid);
        else this.stopStatusPolling();
        if (locked) {
            this.activeStep = 4;
        } else {
            if (!this.activeStep) this.activeStep = files.length ? 3 : 1;
        }
        const step = this.activeStep || 1;

        container.innerHTML = `
            ${this.renderProgress(step, files.length, pricing, isProcessing, isCompleted)}
            ${step === 1 ? this.renderLanguagePanel(source, targets, locked) : ''}
            ${step === 2 ? this.renderUploadPanel(pid, files, locked) : ''}
            ${step === 3 ? this.renderSummary(pid, pricing, files, targets, locked, isCompleted) : ''}
            ${isProcessing ? this.renderProcessingState(data, files, targets) : ''}
            ${isCompleted ? this.renderCompletedState(data) : ''}
            <input id="pricing-file-input" type="file" multiple
                accept=".txt,.doc,.docx,.rtf,.pdf,.xls,.xlsx,.ppt,.pptx,.wps,.et,.dps,.odt,.ods,.odp,.epub,.chm,.ai,.indd,.idml,.html,.htm,.xml,.json,.resjson,.csv,.tsv,.md,.srt,.ass,.ssa,.vtt,.po,.xlf,.xliff,.go,.yml,.yaml,.php,.plist,.stringsdict,.tex,.arxiv,.jpg,.jpeg,.png,.webp,.svg"
                style="display:none" onchange="PricingView.handleFilesSelected(this.files)">`;
    },

    renderProgress(current, fileCount, pricing, isProcessing, isCompleted) {
        current = isCompleted ? 4 : isProcessing ? 4 : current;
        const total = pricing.total_price_cents || 0;
        const paid = pricing.paid_translation_cents || 0;
        const due = pricing.due_translation_cents ?? total;
        const steps = [
            ['1', 'Мови'],
            ['2', 'Файли'],
            ['3', 'Оплата'],
            ['4', 'Готово'],
        ];
        const amountLabel = total
            ? (due > 0
                ? `До сплати €${App.fmtEuro(due)}`
                : `Оплачено €${App.fmtEuro(Math.min(paid, total))}`)
            : '';
        return `
            <div class="order-progress">
                ${steps.map((s, idx) => `
                    <div class="order-step${idx + 1 < current ? ' active done' : ''}${idx + 1 === current ? ' active current' : ''}">
                        <span>${s[0]}</span>
                        <strong>${s[1]}</strong>
                    </div>
                `).join('')}
                ${amountLabel ? `<div class="order-progress-total">${amountLabel}</div>` : ''}
            </div>`;
    },

    renderLanguagePanel(source, targets, disabled) {
        const availableTargets = this.availableTargetLanguages(source, targets);
        return `
            <div class="order-panel">
                <div class="order-panel-head">
                    <div>
                        <div class="order-panel-title">${Icons.wrap('globe', 18)} Мови</div>
                        <div class="order-panel-note">Оберіть мову оригіналу та одну або кілька мов перекладу.</div>
                    </div>
                </div>
                <div class="language-grid">
                    <label class="field-label">
                        Мова оригіналу
                        <select class="input" id="order-source-lang" ${disabled ? 'disabled' : ''} onchange="PricingView.saveLanguages()">
                            ${this.renderLanguageOptions(source)}
                        </select>
                    </label>
                </div>
                <div class="language-selected-block">
                    <div class="language-selected-head">
                        <div>
                            <span class="language-route-label">Вибрані мови перекладу</span>
                            <div class="language-selected-note">${targets.length} ${this.languageCountWord(targets.length)} у цьому замовленні</div>
                        </div>
                        <button class="btn btn-secondary" ${disabled || !availableTargets.length ? 'disabled' : ''} onclick="PricingView.openAddLanguageModal()">
                            ${Icons.wrap('plus', 16)}
                            <span class="target-add-text">Додати мову</span>
                        </button>
                    </div>
                    <div class="target-chip-row selected-languages-row">
                        ${targets.map(lang => this.renderTargetChip(lang, targets, disabled)).join('')}
                    </div>
                </div>
                <div class="language-route-card compact">
                    <span class="language-route-label">Маршрут</span>
                    <div class="language-route-inline">
                        <span class="language-route-pill">${this.renderLanguageFace(source)}</span>
                        <span class="language-route-arrow-inline">→</span>
                        <span class="language-route-target-stack">
                            ${targets.map(lang => `<span class="language-route-pill">${this.renderLanguageFace(lang)}</span>`).join('')}
                        </span>
                    </div>
                </div>
                <div class="order-actions">
                    <button class="btn btn-primary" ${disabled ? 'disabled' : ''} onclick="PricingView.goStep(2)">
                        ${Icons.wrap('forward', 16)} Продовжити
                    </button>
                </div>
            </div>`;
    },

    renderUploadPanel(pid, files, disabled) {
        const hasFiles = files.length > 0;
        return `
            <div class="order-panel">
                <div class="order-panel-head">
                    <div>
                        <div class="order-panel-title">${Icons.wrap('upload', 18)} Файли</div>
                        <div class="order-panel-note">${hasFiles ? 'Можна додати ще документи до оплати.' : 'Завантажте документи, після цього зʼявиться точна ціна.'}</div>
                    </div>
                    <button class="btn btn-primary" ${disabled || this.uploading ? 'disabled' : ''} onclick="PricingView.pickFiles()">
                        ${Icons.wrap('upload', 16)} ${hasFiles ? 'Додати' : 'Завантажити'}
                    </button>
                </div>
                <div id="order-upload-progress" class="upload-inline-progress" style="display:none"></div>
                ${hasFiles ? `
                    <div class="order-file-list">
                        ${files.map(f => `
                            <div class="order-file-row">
                                <div>
                                    <div class="file-name">${App.esc(f.name)}</div>
                                    <div class="file-stats">
                                        ${this.renderPreflightBadge(f)}
                                        ${(f.billable_chars || f.chars || 0).toLocaleString()} розрахункових символів · ${f.units || 0} × 1800
                                    </div>
                                    <div class="file-preflight-note">${App.esc(f.preflight_note || '')}</div>
                                </div>
                                <div class="file-price">€${App.fmtEuro(f.price_cents || 0)}</div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="order-actions split">
                        <button class="btn btn-secondary" ${disabled ? 'disabled' : ''} onclick="PricingView.goStep(1)">
                            ${Icons.wrap('back', 16)} Мови
                        </button>
                        <button class="btn btn-primary" ${disabled ? 'disabled' : ''} onclick="PricingView.goStep(3)">
                            ${Icons.wrap('forward', 16)} До розрахунку
                        </button>
                    </div>
                ` : `
                    <button class="order-upload-empty" ${disabled || this.uploading ? 'disabled' : ''} onclick="PricingView.pickFiles()">
                        ${Icons.wrap('upload', 22)}
                        <span>Завантажити документи</span>
                    </button>
                    <div class="order-actions split">
                        <button class="btn btn-secondary" ${disabled ? 'disabled' : ''} onclick="PricingView.goStep(1)">
                            ${Icons.wrap('back', 16)} Мови
                        </button>
                    </div>
                `}
            </div>`;
    },

    renderSummary(pid, pricing, files, targets, isProcessing, isCompleted) {
        const total = pricing.total_price_cents || 0;
        const paid = pricing.paid_translation_cents || 0;
        const due = pricing.due_translation_cents ?? total;
        const targetCount = pricing.target_language_count || targets.length || 1;
        const glossary = pricing.uses_glossary;
        const hasBlockingFiles = files.some(f => f.supported === false);
        const jobCount = files.length * targetCount;
        return `
            <div class="order-panel order-summary-panel">
                <div class="order-panel-head">
                    <div>
                        <div class="order-panel-title">${Icons.wrap('pricing', 18)} Розрахунок</div>
                        <div class="order-panel-note">${files.length} файл(ів) · ${targetCount} мов(и) перекладу · ${jobCount} задач(і) · ${glossary ? 'глосарій увімкнено' : 'без глосарію'}</div>
                    </div>
                </div>
                <label class="glossary-toggle">
                    <input type="checkbox"
                        ${glossary ? 'checked' : ''}
                        ${isProcessing || isCompleted || !pricing.glossary_available ? 'disabled' : ''}
                        onchange="PricingView.toggleGlossary(this.checked)">
                    <span>
                        <strong>Використовувати глосарій</strong>
                        <small>${pricing.glossary_available ? 'Терміни будуть узгоджені з вашим словником.' : 'Глосарій ще не налаштовано адміністратором.'}</small>
                    </span>
                </label>
                <div class="rate-grid">
                    ${files.map(f => `
                        <div class="rate-row">
                            <span>${App.esc(f.name)}</span>
                            <span>${(f.billable_chars || f.chars || 0).toLocaleString()} сим.</span>
                            <span>€${App.fmtEuro(f.rate_cents || 0)} / 1800</span>
                            <strong>€${App.fmtEuro(f.total_cents || f.price_cents || 0)}</strong>
                        </div>
                    `).join('')}
                </div>
                ${hasBlockingFiles ? `<div class="order-warning">Один або кілька файлів потребують перевірки адміністратором перед оплатою.</div>` : ''}
                <div class="order-total">
                    <span>Вартість перекладу</span>
                    <span>€${App.fmtEuro(total)}</span>
                </div>
                ${paid > 0 ? `
                    <div class="order-total secondary">
                        <span>Вже оплачено</span>
                        <span>€${App.fmtEuro(Math.min(paid, total))}</span>
                    </div>` : ''}
                <div class="order-total due">
                    <span>До сплати зараз</span>
                    <span>€${App.fmtEuro(Math.max(0, due))}</span>
                </div>
                ${!isProcessing && !isCompleted ? `
                    <div class="order-actions split">
                        <button class="btn btn-secondary" onclick="PricingView.goStep(2)">
                            ${Icons.wrap('back', 16)} Файли
                        </button>
                        <button class="btn-order" ${due <= 0 || hasBlockingFiles ? 'disabled' : ''} onclick="PricingView.pay(${pid})">
                            ${Icons.wrap('pricing', 18)} Сплатити €${App.fmtEuro(Math.max(0, due))}
                        </button>
                    </div>
                ` : ''}
            </div>`;
    },

    renderProcessingState(data, files, targets) {
        const jobs = data.jobs || [];
        const s = data.translation_status || {};
        const expected = s.expected_jobs || Math.max(1, files.length * Math.max(1, targets.length));
        const completed = s.completed_jobs || 0;
        const active = s.active_jobs || 0;
        const review = s.review_jobs || 0;
        const progress = Number.isFinite(s.progress_percent)
            ? Math.max(0, Math.min(100, Math.round(s.progress_percent)))
            : Math.max(0, Math.min(100, Math.round((completed / Math.max(1, expected)) * 100)));
        const processText = this.processingText(completed, expected, active, review, s);
        return `
            <div class="order-panel status-panel">
                <div class="status-icon">${Icons.wrap('clock', 34)}</div>
                <div>
                    <div class="status-title">${processText.title}</div>
                    <div class="status-text">${processText.body}</div>
                </div>
            </div>
            <div class="order-panel">
                <div class="order-panel-head">
                    <div>
                        <div class="order-panel-title">${Icons.wrap('clock', 18)} Статус файлів</div>
                        <div class="order-panel-note">${completed}/${expected} готово · ${processText.short}</div>
                    </div>
                    <div class="job-percent">${progress}%</div>
                </div>
                <div class="job-progress"><span style="width:${progress}%"></span></div>
                <div class="job-progress-breakdown">
                    ${this.renderProgressChip('У черзі', s.pending_jobs || 0)}
                    ${this.renderProgressChip('В роботі', s.processing_jobs || 0)}
                    ${this.renderProgressChip('Очікує', (s.waiting_credit_jobs || 0) + (s.external_pending_jobs || 0))}
                    ${this.renderProgressChip('Готово', completed)}
                    ${review ? this.renderProgressChip('Перевірка', review, 'warning') : ''}
                </div>
                <div class="job-list">
                    ${jobs.length ? jobs.map(job => this.renderJobRow(job)).join('') : this.renderPendingJobRows(files, targets)}
                </div>
            </div>`;
    },

    renderProgressChip(label, value, tone = '') {
        return `<span class="progress-chip ${tone}"><strong>${value}</strong>${App.esc(label)}</span>`;
    },

    processingText(completed, expected, active, review, status = {}) {
        if (review > 0) {
            return {
                title: 'Потрібна перевірка',
                short: 'є файл на перевірці',
                body: 'Частина роботи потребує уваги спеціаліста. Ви отримаєте повідомлення, щойно файл буде готовий.'
            };
        }
        if ((status.waiting_credit_jobs || 0) > 0) {
            return {
                title: 'Очікуємо поповнення балансу',
                short: 'пауза через баланс сервісу',
                body: 'Замовлення збережено в черзі. Адміністратор отримав сповіщення, система повторить спробу автоматично.'
            };
        }
        if ((status.external_pending_jobs || 0) > 0) {
            return {
                title: 'Очікуємо завершення у провайдера',
                short: 'перевіряємо зовнішній статус',
                body: 'Частина файлів уже передана сервісу перекладу. Система автоматично підхопить результат, щойно він буде доступний.'
            };
        }
        if (completed >= expected && expected > 0) {
            return {
                title: 'Переклад завершено',
                short: 'усі файли готові',
                body: 'Готові файли можна переглянути і скачати в застосунку.'
            };
        }
        if (completed > 0) {
            return {
                title: 'Переклад триває',
                short: 'частина файлів готова',
                body: 'Готові файли вже зберігаються, решта ще перекладається. Telegram повідомить, коли буде завершено все замовлення.'
            };
        }
        if (active > 0) {
            return {
                title: 'Файли перекладаються',
                short: 'робота в процесі',
                body: 'Система обробляє завантажені документи. Сторінку можна закрити: готові файли прийдуть у Telegram і залишаться в застосунку.'
            };
        }
        return {
            title: 'Переклад у черзі',
            short: 'очікує старту',
            body: 'Замовлення прийнято після оплати. Підготовка файлів до перекладу почнеться автоматично.'
        };
    },

    renderCompletedState(data) {
        const jobs = (data.jobs || []).filter(j => j.status === 'completed');
        const failed = data.translation_status?.failed_jobs || 0;
        return `
            <div class="order-panel status-panel">
                <div class="status-icon ${failed ? 'warning' : 'success'}">${Icons.wrap(failed ? 'warning' : 'success', 34)}</div>
                <div>
                    <div class="status-title">${failed ? 'Завершено з перевіркою' : 'Файли готові'}</div>
                    <div class="status-text">${failed ? 'Готові переклади доступні, частина файлів потребує уваги адміністратора.' : 'Переклади доступні для перегляду і скачування.'}</div>
                    <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="App.navigate('files')">
                        ${Icons.wrap('files', 16)} Відкрити файли
                    </button>
                </div>
            </div>
            ${jobs.length ? `
                <div class="order-panel">
                    <div class="order-panel-title">${Icons.wrap('files', 18)} Готові переклади</div>
                    <div class="job-list ready">
                        ${jobs.map(job => this.renderJobRow(job, true)).join('')}
                    </div>
                </div>` : ''}`;
    },

    renderPreflightBadge(file) {
        const status = file.preflight_status || 'ready';
        const label = status === 'ocr' ? 'OCR/скан' : status === 'review' ? 'Перевірка' : 'Готово';
        return `<span class="preflight-badge ${status}">${label}</span>`;
    },

    renderJobRow(job, completedView = false) {
        const safeResult = this.inlineArg(job.result_name || job.source_name || 'Переклад');
        return `
            <div class="job-row ${job.status}">
                <div>
                    <div class="job-title">${App.esc(job.source_name || 'Файл')}</div>
                    <div class="job-meta">${App.esc(job.target_lang || '')}</div>
                </div>
                <div class="job-actions">
                    <span class="job-status ${job.status}">${App.esc(job.label || 'У роботі')}</span>
                    ${completedView && job.can_compare ? `
                        <button class="btn btn-secondary btn-sm" onclick="FilesView.previewFile(${App.currentProject.id}, ${job.result_file_id}, '${safeResult}')">
                            ${Icons.wrap('eye', 14)} Переглянути
                        </button>
                        <button class="btn btn-primary btn-sm" onclick="FilesView.downloadFile(${App.currentProject.id}, ${job.result_file_id}, '${safeResult}')">
                            ${Icons.wrap('download', 14)} Скачати
                        </button>
                    ` : ''}
                </div>
            </div>`;
    },

    renderPendingJobRows(files, targets) {
        const rows = [];
        files.forEach(file => targets.forEach(target => {
            rows.push(`
                <div class="job-row processing">
                    <div>
                        <div class="job-title">${App.esc(file.name || 'Файл')}</div>
                        <div class="job-meta">${App.esc(target)}</div>
                    </div>
                    <span class="job-status processing">У черзі</span>
                </div>`);
        }));
        return rows.join('');
    },

    renderTargetChip(lang, targets, disabled) {
        const removable = !disabled && targets.length > 1;
        return `
            <button class="target-chip${removable ? '' : ' locked'}" ${removable ? '' : 'disabled'} onclick="PricingView.removeTargetLanguage('${this.inlineArg(lang)}')" aria-label="Мова перекладу: ${App.esc(lang)}">
                <span class="target-chip-main">
                    ${this.renderLanguageFace(lang)}
                </span>
                <span class="target-chip-status">${removable ? Icons.wrap('close', 14) : 'Додано'}</span>
            </button>`;
    },

    renderLanguageOptions(selected, valuesOverride = null) {
        const seen = new Set();
        const sourceValues = valuesOverride || [...this.orderLanguages, selected];
        const values = sourceValues.filter(Boolean).filter(v => {
            if (seen.has(v)) return false;
            seen.add(v);
            return true;
        });
        return values.map(lang => `<option value="${App.esc(lang)}"${lang === selected ? ' selected' : ''}>${App.esc(this.languageOptionLabel(lang))}</option>`).join('');
    },

    languageFlag(lang) {
        return window.LanguageMeta ? window.LanguageMeta.flag(lang) : '🌐';
    },

    languageOptionLabel(lang) {
        return window.LanguageMeta ? window.LanguageMeta.optionLabel(lang) : String(lang || '');
    },

    languageInfo(lang) {
        return window.LanguageMeta
            ? window.LanguageMeta.info(lang)
            : { name: String(lang || 'Language'), nativeName: '', flag: '🌐' };
    },

    renderLanguageFace(lang) {
        const info = this.languageInfo(lang);
        const native = info.nativeName && info.nativeName !== info.name
            ? `<span class="language-native">${App.esc(info.nativeName)}</span>`
            : '';
        return `
            <span class="language-flag" aria-hidden="true">${App.esc(info.flag)}</span>
            <span class="language-name">${App.esc(info.name)}</span>
            ${native}`;
    },

    inlineArg(value) {
        return App.esc(String(value || ''))
            .replace(/\\/g, '\\\\')
            .replace(/\r?\n/g, ' ')
            .replace(/'/g, "\\'");
    },

    firstAvailableTarget(source, targets) {
        return this.availableTargetLanguages(source, targets)[0] || 'English';
    },

    availableTargetLanguages(source, targets) {
        const selected = new Set(targets);
        return this.orderLanguages.filter(lang => lang !== source && !selected.has(lang));
    },

    renderLanguageOptionButton(lang) {
        const info = this.languageInfo(lang);
        const searchable = [lang, info.name, info.nativeName, info.flag].join(' ').toLowerCase();
        return `
            <button type="button" class="language-option-button" data-search="${App.esc(searchable)}" onclick="PricingView.addTargetLanguage('${this.inlineArg(lang)}', this)">
                <span class="language-option-face">
                    ${this.renderLanguageFace(lang)}
                </span>
                <span class="language-option-plus">${Icons.wrap('plus', 15)}</span>
            </button>`;
    },

    targetLanguages(raw) {
        const list = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
        return list.length ? list : ['Ukrainian'];
    },

    currentTargets() {
        const raw = App.currentProject?.target_lang || this.pricingData?.pricing?.target_lang || 'Ukrainian';
        return this.targetLanguages(raw);
    },

    languageCountWord(count) {
        const n = Math.abs(Number(count) || 0);
        const last = n % 10;
        const lastTwo = n % 100;
        if (last === 1 && lastTwo !== 11) return 'мова';
        if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 'мови';
        return 'мов';
    },

    async loadOptions() {
        if (this.optionsLoaded) return;
        this.optionsLoaded = true;
        try {
            const data = await API.getTranslationOptions();
            const languages = Array.isArray(data.languages) ? data.languages.filter(Boolean) : [];
            if (languages.length) this.orderLanguages = languages;
        } catch (e) {
            this.orderLanguages = ORDER_LANGUAGES;
        }
    },

    openAddLanguageModal() {
        if (!App.currentProject) return;
        const source = document.getElementById('order-source-lang')?.value || App.currentProject.source_lang || 'German';
        const targets = this.currentTargets();
        const available = this.availableTargetLanguages(source, targets);
        if (!available.length) {
            App.toast('Усі доступні мови вже додані', 'info');
            return;
        }

        document.getElementById('pricing-language-modal')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'pricing-language-modal';
        overlay.innerHTML = `
            <div class="modal language-add-modal" role="dialog" aria-modal="true" aria-labelledby="language-add-title">
                <h3 id="language-add-title">${Icons.wrap('globe', 20)} Додати мову перекладу</h3>
                <div class="language-modal-current">
                    <span class="language-route-label">Оригінал</span>
                    <span class="language-route-pill">${this.renderLanguageFace(source)}</span>
                </div>
                <input id="language-modal-search" class="input language-modal-search" autocomplete="off" placeholder="Знайти мову" oninput="PricingView.filterAddLanguageModal(this.value)">
                <div id="language-modal-list" class="language-option-list">
                    ${available.map(lang => this.renderLanguageOptionButton(lang)).join('')}
                </div>
                <div id="language-modal-empty" class="language-modal-empty" hidden>Такої мови в списку немає</div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="PricingView.closeAddLanguageModal()">Закрити</button>
                </div>
            </div>`;

        const escHandler = (e) => {
            if (e.key === 'Escape') this.closeAddLanguageModal();
        };
        overlay._escHandler = escHandler;
        document.addEventListener('keydown', escHandler);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closeAddLanguageModal();
        });
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
        setTimeout(() => document.getElementById('language-modal-search')?.focus(), 60);
    },

    closeAddLanguageModal() {
        const overlay = document.getElementById('pricing-language-modal');
        if (!overlay) return;
        if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
        overlay.remove();
    },

    filterAddLanguageModal(value) {
        const q = String(value || '').trim().toLowerCase();
        const buttons = Array.from(document.querySelectorAll('#language-modal-list .language-option-button'));
        let visible = 0;
        for (const btn of buttons) {
            const haystack = btn.dataset.search || '';
            const match = !q || haystack.includes(q);
            btn.hidden = !match;
            if (match) visible++;
        }
        const empty = document.getElementById('language-modal-empty');
        if (empty) empty.hidden = visible > 0;
    },

    goStep(step) {
        this.activeStep = step;
        if (this.pricingData && App.currentProject) {
            const container = document.getElementById('pricing-content');
            if (container) this.renderOrder(container, App.currentProject.id, this.pricingData);
        }
    },

    async saveLanguages() {
        if (!App.currentProject) return;
        const source = document.getElementById('order-source-lang')?.value || App.currentProject.source_lang || 'German';
        let targets = this.currentTargets().filter(t => t !== source);
        if (!targets.length) targets = [this.firstAvailableTarget(source, [])];
        await this.persistLanguages(source, targets);
    },

    async addTargetLanguage(lang = null, btn = null) {
        if (!App.currentProject) return;
        const source = document.getElementById('order-source-lang')?.value || App.currentProject.source_lang || 'German';
        const next = lang;
        if (!next || next === source) {
            App.toast('Оберіть іншу мову перекладу', 'warning');
            return;
        }
        const targets = this.currentTargets();
        if (!targets.includes(next)) targets.push(next);
        if (btn) btn.disabled = true;
        const saved = await this.persistLanguages(source, targets);
        if (saved) {
            this.closeAddLanguageModal();
            App.toast('Мову додано', 'success');
        } else if (btn) {
            btn.disabled = false;
        }
    },

    async removeTargetLanguage(lang) {
        if (!App.currentProject) return;
        const targets = this.currentTargets().filter(t => t !== lang);
        if (!targets.length) return;
        const source = document.getElementById('order-source-lang')?.value || App.currentProject.source_lang || 'German';
        await this.persistLanguages(source, targets);
    },

    async persistLanguages(source, targets) {
        try {
            const targetLang = targets.join(', ');
            await API.updateProject(App.currentProject.id, { source_lang: source, target_lang: targetLang });
            App.currentProject.source_lang = source;
            App.currentProject.target_lang = targetLang;
            await this.loadPricing(App.currentProject.id);
            return true;
        } catch (e) {
            App.toast(e.message, 'error');
            return false;
        }
    },

    async toggleGlossary(enabled) {
        if (!App.currentProject) return;
        try {
            await API.updateProject(App.currentProject.id, { use_glossary: !!enabled });
            App.currentProject.use_glossary = !!enabled;
            await this.loadPricing(App.currentProject.id);
        } catch (e) {
            App.toast(e.message, 'error');
            await this.loadPricing(App.currentProject.id);
        }
    },

    pickFiles() {
        const input = document.getElementById('pricing-file-input');
        if (input) input.click();
    },

    async handleFilesSelected(files) {
        if (!files || !files.length || !App.currentProject) return;
        this.uploading = true;
        this.lastUploadState = null;
        const progress = document.getElementById('order-upload-progress');
        if (progress) {
            progress.style.display = '';
            progress.innerHTML = this.uploadProgressHtml({
                total: files.length,
                completed: 0,
                failed: 0,
                phaseLabel: 'Готуємо файли до завантаження',
                aggregatePercent: 0,
                files: Array.from(files).map((file, index) => ({
                    index,
                    name: file.name || ('file-' + (index + 1)),
                    size: file.size || 0,
                    status: 'queued',
                    phase: 'У черзі',
                    uploadPercent: 0,
                    error: ''
                }))
            });
        }
        try {
            const results = await API.uploadFiles(App.currentProject.id, Array.from(files), 'source', (state) => {
                this.lastUploadState = state;
                if (progress) progress.innerHTML = this.uploadProgressHtml(state);
            });
            const failed = results.filter(r => r && r.error);
            if (failed.length) {
                throw new Error((failed[0].file ? failed[0].file + ': ' : '') + (failed[0].error || 'Не вдалося завантажити файл'));
            }
            App.toast('Файли завантажено', 'success');
            this.activeStep = 3;
            if (progress) {
                const state = this.lastUploadState || {};
                progress.innerHTML = this.uploadProgressHtml({
                    ...state,
                    total: files.length,
                    completed: files.length,
                    failed: 0,
                    phaseLabel: 'Розрахунок готовий',
                    aggregatePercent: 100
                });
            }
            await this.loadPricing(App.currentProject.id);
        } catch (e) {
            App.toast(e.message, 'error');
        } finally {
            this.uploading = false;
            const input = document.getElementById('pricing-file-input');
            if (input) input.value = '';
        }
    },

    uploadProgressHtml(stateOrDone, total, label) {
        if (typeof stateOrDone === 'number') {
            const done = stateOrDone;
            const safeTotal = Math.max(1, total || 1);
            const pct = Math.max(0, Math.min(100, Math.round((done / safeTotal) * 100)));
            const fileWord = safeTotal === 1 ? 'файл' : 'файлів';
            return `
                <div class="upload-progress-top">
                    <strong>${App.esc(label || 'Завантаження')}</strong>
                    <span>${done}/${safeTotal} ${fileWord}</span>
                </div>
                <div class="job-progress upload-progress-bar"><span style="width:${pct}%"></span></div>`;
        }

        const state = stateOrDone || {};
        const files = state.files || [];
        const safeTotal = Math.max(1, state.total || files.length || 1);
        const done = state.completed || 0;
        const failed = state.failed || 0;
        const pct = Math.max(0, Math.min(100, Math.round(state.aggregatePercent || 0)));
        const analyzing = files.filter(file => file.status === 'analyzing');
        const fileWord = safeTotal === 1 ? 'файл' : 'файлів';
        const active = state.activeFileName ? ` · ${state.activeFileName}` : '';
        return `
            <div class="upload-progress-top">
                <strong class="upload-status-title">
                    ${analyzing.length ? '<span class="upload-status-spinner" aria-hidden="true"></span>' : ''}
                    <span>${App.esc((state.phaseLabel || 'Обробка') + active)}</span>
                </strong>
                <span>${done}/${safeTotal} ${fileWord}${failed ? ' · ' + failed + ' пом.' : ''}</span>
            </div>
            <div class="job-progress upload-progress-bar${analyzing.length ? ' is-counting' : ''}"><span style="width:${pct}%"></span></div>
            ${analyzing.length ? this.renderCountingLive(analyzing, safeTotal) : ''}
            <div class="upload-file-progress-list">
                ${files.map(file => this.uploadFileRow(file)).join('')}
            </div>`;
    },

    renderCountingLive(files, total) {
        const elapsed = Math.max(...files.map(file => file.elapsedMs || 0), 0);
        const fileLabel = files.length === 1
            ? App.esc(files[0].name || 'файл')
            : `${files.length}/${total} файлів`;
        return `
            <div class="upload-live-banner" role="status" aria-live="polite">
                <span class="upload-live-spinner" aria-hidden="true"></span>
                <div class="upload-live-copy">
                    <div class="upload-live-title">Рахуємо символи, сторінки і вартість</div>
                    <div class="upload-live-text">${fileLabel} вже на сервері. Результат зʼявиться автоматично.</div>
                </div>
                <span class="upload-live-time">${this.formatDuration(elapsed)}</span>
            </div>`;
    },

    uploadFileRow(file) {
        const pct = Math.max(0, Math.min(100, Math.round(file.uploadPercent || 0)));
        const status = file.status || 'queued';
        const phase = file.error || file.phase || this.uploadPhaseLabel(status);
        const width = status === 'done' || status === 'error' || status === 'analyzing' ? 100 : pct;
        return `
            <div class="upload-file-progress-row ${status}">
                <div class="upload-file-progress-main">
                    <div class="upload-file-progress-name">${App.esc(file.name || 'Файл')}</div>
                    <div class="upload-file-progress-phase">${App.esc(phase)}${file.size ? ' · ' + App.fmtSize(file.size) : ''}</div>
                    <div class="upload-file-progress-mini"><span style="width:${width}%"></span></div>
                </div>
                <span class="upload-file-progress-badge">
                    ${status === 'analyzing' ? '<span class="upload-badge-spinner" aria-hidden="true"></span>' : ''}
                    ${this.uploadPhaseLabel(status, pct)}
                </span>
            </div>`;
    },

    uploadPhaseLabel(status, pct = 0) {
        const map = {
            queued: 'Черга',
            uploading: pct + '%',
            analyzing: 'Підрахунок',
            done: 'Готово',
            error: 'Помилка'
        };
        return map[status] || 'Обробка';
    },

    formatDuration(ms) {
        const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
    },

    async pay(pid) {
        try {
            const targetLang = this.currentTargets().join(', ');
            const data = await API.createInvoice(pid, { type: 'translation', target_lang: targetLang });
            if (data.payment_url) {
                window.open(data.payment_url, '_blank');
                App.toast('Відкрито сторінку оплати', 'info');
            } else {
                App.toast('Рахунок створено', 'success');
            }
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    startStatusPolling(pid) {
        if (this.pollTimer) return;
        this.pollTimer = setInterval(() => {
            if (App.currentView !== 'pricing' || !App.currentProject || App.currentProject.id !== pid) {
                this.stopStatusPolling();
                return;
            }
            this.loadPricing(pid, true);
        }, 10000);
    },

    stopStatusPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    },

    openSupportModal() {
        if (!App.currentProject) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>${Icons.wrap('comment', 20)} Повідомити про проблему</h3>
                <textarea id="support-message" class="form-textarea" rows="5" maxlength="1500" placeholder="Напишіть, що сталося"></textarea>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                    <button class="btn btn-primary" onclick="PricingView.sendSupportMessage(this)">${Icons.wrap('send', 16)} Надіслати</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
        setTimeout(() => document.getElementById('support-message')?.focus(), 50);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    async sendSupportMessage(btn) {
        const textarea = document.getElementById('support-message');
        const text = (textarea?.value || '').trim();
        if (!text) {
            App.toast('Опишіть проблему', 'warning');
            return;
        }
        btn.disabled = true;
        try {
            await API.sendMessage(App.currentProject.id, 'Проблема із замовленням: ' + text);
            btn.closest('.modal-overlay')?.remove();
            App.toast('Повідомлення надіслано адміністратору', 'success');
        } catch (e) {
            btn.disabled = false;
            App.toast(e.message, 'error');
        }
    }
};
