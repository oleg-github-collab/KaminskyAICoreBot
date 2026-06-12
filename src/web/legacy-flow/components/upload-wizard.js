/* ---------------------------------------------------------------
 *  upload-wizard.js — 5-step document upload wizard
 *  Global object: UploadWizard
 *
 *  Steps:
 *    1. Category   — Choose source / reference
 *    2. Upload     — Drag-drop or file picker, progress bars
 *    3. Review     — File list, metadata, delete, change category
 *    4. Instructions — Quick instruction template or skip
 *    5. Order      — Pricing summary + tier selection + pay
 * --------------------------------------------------------------- */
const UploadWizard = {
    _visible: false,
    _step: 1,
    _category: 'source',
    _files: [],       // { file: File, status: 'pending'|'uploading'|'done'|'error', result: null }
    _uploaded: [],     // results from server
    _projectId: null,

    /** Open the wizard (called from FAB button) */
    open() {
        if (!App.currentProject) {
            App.toast('\u0421\u043f\u043e\u0447\u0430\u0442\u043a\u0443 \u043e\u0431\u0435\u0440\u0456\u0442\u044c \u043f\u0440\u043e\u0454\u043a\u0442', 'warning');
            return;
        }
        this._projectId = App.currentProject.id;
        this._step = 1;
        this._category = 'source';
        this._files = [];
        this._uploaded = [];
        this._visible = true;
        this._render();
    },

    /** Close and clean up */
    close() {
        this._visible = false;
        const overlay = document.getElementById('wizard-overlay');
        const container = document.getElementById('wizard-container');
        if (overlay) overlay.remove();
        if (container) container.remove();
        // Refresh files view if we uploaded anything
        if (this._uploaded.length > 0 && App.currentView === 'files') {
            FilesView.loadFiles(this._projectId);
        }
    },

    /** Navigate steps */
    next() {
        if (this._step < 5) {
            this._step++;
            this._renderStep();
        }
    },
    prev() {
        if (this._step > 1) {
            this._step--;
            this._renderStep();
        }
    },
    goTo(step) {
        if (step >= 1 && step <= 5) {
            this._step = step;
            this._renderStep();
        }
    },

    /** Render the full wizard shell */
    _render() {
        // Remove existing
        const existing = document.getElementById('wizard-container');
        if (existing) existing.remove();
        const existingOverlay = document.getElementById('wizard-overlay');
        if (existingOverlay) existingOverlay.remove();

        // Overlay
        const overlay = document.createElement('div');
        overlay.id = 'wizard-overlay';
        overlay.className = 'wizard-overlay';
        document.body.appendChild(overlay);

        // Container
        const container = document.createElement('div');
        container.id = 'wizard-container';
        container.className = 'wizard-container';
        container.innerHTML = `
            <div class="wizard-header">
                <span class="wizard-title">${Icons.wrap('upload', 20)} \u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f \u0444\u0430\u0439\u043b\u0456\u0432</span>
                <button class="wizard-close" onclick="UploadWizard.close()">${Icons.close}</button>
            </div>
            <div class="wizard-progress" id="wizard-progress"></div>
            <div class="wizard-body" id="wizard-body"></div>
            <div class="wizard-footer" id="wizard-footer"></div>`;
        document.body.appendChild(container);

        this._renderStep();
    },

    /** Update progress dots + step content + footer */
    _renderStep() {
        this._renderProgress();
        this._renderBody();
        this._renderFooter();
    },

    _renderProgress() {
        const el = document.getElementById('wizard-progress');
        if (!el) return;
        const labels = ['\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0456\u044f', '\u0424\u0430\u0439\u043b\u0438', '\u041f\u0435\u0440\u0435\u0432\u0456\u0440\u043a\u0430', '\u0406\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0456\u0457', '\u0417\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f'];
        let html = '';
        for (let i = 1; i <= 5; i++) {
            const cls = i < this._step ? 'completed' : (i === this._step ? 'active' : '');
            html += '<div class="wizard-dot ' + cls + '" title="' + labels[i-1] + '"></div>';
            if (i < 5) {
                html += '<div class="wizard-dot-line ' + (i < this._step ? 'completed' : '') + '"></div>';
            }
        }
        el.innerHTML = html;
    },

    _renderBody() {
        const body = document.getElementById('wizard-body');
        if (!body) return;
        switch (this._step) {
            case 1: this._renderStep1(body); break;
            case 2: this._renderStep2(body); break;
            case 3: this._renderStep3(body); break;
            case 4: this._renderStep4(body); break;
            case 5: this._renderStep5(body); break;
        }
    },

    _renderFooter() {
        const footer = document.getElementById('wizard-footer');
        if (!footer) return;
        const prevBtn = this._step > 1
            ? '<button class="btn btn-secondary" onclick="UploadWizard.prev()">' + Icons.wrap('back', 16) + ' \u041d\u0430\u0437\u0430\u0434</button>'
            : '<div></div>';

        let nextBtn = '';
        if (this._step === 1) {
            nextBtn = '<button class="btn btn-primary" onclick="UploadWizard.next()">\u0414\u0430\u043b\u0456 ' + Icons.wrap('forward', 16) + '</button>';
        } else if (this._step === 2) {
            const hasFiles = this._files.length > 0 && this._files.some(f => f.status === 'done');
            nextBtn = '<button class="btn btn-primary" ' + (hasFiles ? '' : 'disabled') + ' onclick="UploadWizard.next()">\u041f\u0435\u0440\u0435\u0432\u0456\u0440\u0438\u0442\u0438 ' + Icons.wrap('forward', 16) + '</button>';
        } else if (this._step === 3) {
            nextBtn = '<button class="btn btn-primary" onclick="UploadWizard.next()">\u0406\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0456\u0457 ' + Icons.wrap('forward', 16) + '</button>';
        } else if (this._step === 4) {
            nextBtn = '<button class="btn btn-primary" onclick="UploadWizard.next()">\u0417\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f ' + Icons.wrap('forward', 16) + '</button>';
        } else if (this._step === 5) {
            nextBtn = '<button class="btn btn-primary" onclick="UploadWizard._finishAndClose()">' + Icons.wrap('check', 16) + ' \u0413\u043e\u0442\u043e\u0432\u043e</button>';
        }
        footer.innerHTML = prevBtn + nextBtn;
    },

    // ─── Step 1: Category ───
    _renderStep1(body) {
        body.innerHTML = `
            <div class="wizard-step">
                <h2>\u041a\u0430\u0442\u0435\u0433\u043e\u0440\u0456\u044f \u0444\u0430\u0439\u043b\u0456\u0432</h2>
                <p class="wizard-step-desc">\u041e\u0431\u0435\u0440\u0456\u0442\u044c \u0442\u0438\u043f \u0444\u0430\u0439\u043b\u0456\u0432, \u044f\u043a\u0456 \u0432\u0438 \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0443\u0454\u0442\u0435</p>
                <div class="wizard-choice">
                    <div class="wizard-choice-card ${this._category === 'source' ? 'selected' : ''}" data-cat="source">
                        <span class="wizard-choice-icon">${Icons.wrap('files', 36)}</span>
                        <div class="wizard-choice-title">\u0412\u0438\u0445\u0456\u0434\u043d\u0456 \u0442\u0435\u043a\u0441\u0442\u0438</div>
                        <div class="wizard-choice-desc">\u0414\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0438, \u044f\u043a\u0456 \u043f\u043e\u0442\u0440\u0456\u0431\u043d\u043e \u043f\u0435\u0440\u0435\u043a\u043b\u0430\u0441\u0442\u0438. TXT, DOCX, PDF \u0442\u0430 \u0456\u043d\u0448\u0456 \u0444\u043e\u0440\u043c\u0430\u0442\u0438.</div>
                    </div>
                    <div class="wizard-choice-card ${this._category === 'reference' ? 'selected' : ''}" data-cat="reference">
                        <span class="wizard-choice-icon">${Icons.wrap('glossary', 36)}</span>
                        <div class="wizard-choice-title">\u0420\u0435\u0444\u0435\u0440\u0435\u043d\u0441</div>
                        <div class="wizard-choice-desc">\u0414\u043e\u0434\u0430\u0442\u043a\u043e\u0432\u0456 \u043c\u0430\u0442\u0435\u0440\u0456\u0430\u043b\u0438 \u0434\u043b\u044f \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u0443: \u0433\u043b\u043e\u0441\u0430\u0440\u0456\u0457, \u0437\u0440\u0430\u0437\u043a\u0438 \u043f\u0435\u0440\u0435\u043a\u043b\u0430\u0434\u0443, \u0441\u0442\u0438\u043b\u0456\u0441\u0442\u0438\u0447\u043d\u0456 \u043d\u0430\u0441\u0442\u0430\u043d\u043e\u0432\u0438.</div>
                    </div>
                </div>
            </div>`;

        body.querySelectorAll('.wizard-choice-card').forEach(card => {
            card.addEventListener('click', () => {
                this._category = card.dataset.cat;
                body.querySelectorAll('.wizard-choice-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
            });
        });
    },

    // ─── Step 2: Upload ───
    _renderStep2(body) {
        body.innerHTML = `
            <div class="wizard-step">
                <h2>\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f</h2>
                <p class="wizard-step-desc">\u041f\u0435\u0440\u0435\u0442\u044f\u0433\u043d\u0456\u0442\u044c \u0444\u0430\u0439\u043b\u0438 \u0430\u0431\u043e \u043d\u0430\u0442\u0438\u0441\u043d\u0456\u0442\u044c \u0434\u043b\u044f \u0432\u0438\u0431\u043e\u0440\u0443</p>
                <div class="drop-zone" id="wiz-drop-zone">
                    <span style="display:block;margin-bottom:8px">${Icons.wrap('upload', 40)}</span>
                    <p style="font-size:15px;font-weight:600;color:var(--text-primary)">\u041f\u0435\u0440\u0435\u0442\u044f\u0433\u043d\u0456\u0442\u044c \u0444\u0430\u0439\u043b\u0438 \u0441\u044e\u0434\u0438</p>
                    <span class="drop-hint">\u0430\u0431\u043e \u043d\u0430\u0442\u0438\u0441\u043d\u0456\u0442\u044c \u0434\u043b\u044f \u0432\u0438\u0431\u043e\u0440\u0443</span>
                    <input type="file" id="wiz-file-input" multiple style="display:none">
                </div>
                <div id="wiz-file-list" style="margin-top:16px"></div>
            </div>`;

        const dz = body.querySelector('#wiz-drop-zone');
        const fi = body.querySelector('#wiz-file-input');

        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', e => {
            e.preventDefault(); dz.classList.remove('dragover');
            this._addFiles(e.dataTransfer.files);
        });
        fi.addEventListener('change', () => {
            if (fi.files.length) this._addFiles(fi.files);
        });

        this._renderFileList();
    },

    _addFiles(fileList) {
        for (let i = 0; i < fileList.length; i++) {
            this._files.push({ file: fileList[i], status: 'pending', result: null, progress: 0 });
        }
        this._startUpload();
    },

    /** Upload a single file once, failing after 30s. Resolves with parsed server data. */
    _uploadOnce(entry) {
        const fd = new FormData();
        fd.append('file', entry.file);
        fd.append('category', this._category);

        const uploadPromise = fetch(API.base + '/projects/' + this._projectId + '/files', {
            method: 'POST',
            headers: { 'Authorization': API.initData() },
            body: fd
        }).then(async (r) => {
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || '\u041f\u043e\u043c\u0438\u043b\u043a\u0430');
            return data;
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('\u0427\u0430\u0441 \u043e\u0447\u0456\u043a\u0443\u0432\u0430\u043d\u043d\u044f \u0432\u0438\u0447\u0435\u0440\u043f\u0430\u043d\u043e')), 30000);
        });

        return Promise.race([uploadPromise, timeoutPromise]);
    },

    async _startUpload() {
        const pending = this._files.filter(f => f.status === 'pending');
        if (!pending.length) return;

        const backoffs = [1000, 2000, 4000]; // auto-retry delays before manual retry

        for (const entry of pending) {
            entry.status = 'uploading';
            this._renderFileList();

            let lastErr = null;
            // Initial attempt + up to 3 auto-retries with 1s/2s/4s backoff.
            for (let attempt = 0; attempt <= backoffs.length; attempt++) {
                try {
                    const data = await this._uploadOnce(entry);
                    entry.status = 'done';
                    entry.result = data;
                    entry.errorMsg = null;
                    this._uploaded.push(data);
                    lastErr = null;
                    break;
                } catch (e) {
                    lastErr = e;
                    if (attempt < backoffs.length) {
                        await new Promise(r => setTimeout(r, backoffs[attempt]));
                        this._renderFileList();
                    }
                }
            }

            if (lastErr) {
                entry.status = 'error';
                entry.errorMsg = lastErr.message;
            }
            this._renderFileList();
        }
        // Re-render footer to enable "next" button
        this._renderFooter();
    },

    _renderFileList() {
        const list = document.getElementById('wiz-file-list');
        if (!list) return;
        if (!this._files.length) { list.innerHTML = ''; return; }

        list.innerHTML = this._files.map((f, i) => {
            const statusIcon = f.status === 'done' ? Icons.wrap('success', 18)
                : f.status === 'uploading' ? '<span class="spinner"></span>'
                : f.status === 'error' ? Icons.wrap('error', 18)
                : Icons.wrap('clock', 18);

            const meta = f.status === 'done' && f.result
                ? ((f.result?.char_count || 0) ? (f.result?.char_count || 0).toLocaleString() + ' \u0441\u0438\u043c.' : '') +
                  ((f.result?.page_count || 0) ? ((f.result?.char_count || 0) ? ' \u00b7 ' : '') + (f.result?.page_count || 0) + ' \u0441\u0442\u043e\u0440.' : '') +
                  (f.result.estimated_price_cents ? ' \u00b7 \u20ac' + App.fmtEuro(f.result.estimated_price_cents) : '')
                : f.status === 'error' ? '<span style="color:var(--red)">' + App.esc(f.errorMsg) + '</span>'
                : App.fmtSize(f.file.size);

            return `<div class="file-item" style="animation:fadeSlideIn 0.2s ease ${i * 40}ms both">
                <div class="file-icon">${statusIcon}</div>
                <div class="file-info">
                    <div class="file-name">${App.esc(f.file.name)}</div>
                    <div class="file-meta">${meta}</div>
                </div>
                ${f.status === 'error' ? '<button class="btn btn-icon btn-secondary" onclick="UploadWizard._retryFile(' + i + ')" data-tooltip="\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0438">' + Icons.wrap('forward', 16) + '</button>' : ''}
                <button class="btn btn-icon" style="color:var(--red);background:var(--red-bg)" onclick="UploadWizard._removeFile(${i})" data-tooltip="\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438">${Icons.wrap('close', 16)}</button>
            </div>`;
        }).join('');
    },

    _removeFile(idx) {
        const f = this._files[idx];
        if (f && f.result && f.result.id) {
            // Remove from uploaded list too
            this._uploaded = this._uploaded.filter(u => u.id !== f.result.id);
        }
        this._files.splice(idx, 1);
        this._renderFileList();
        this._renderFooter();
    },

    _retryFile(idx) {
        const f = this._files[idx];
        if (f) {
            f.status = 'pending';
            f.errorMsg = null;
            this._startUpload();
        }
    },

    // ─── Step 3: Review ───
    _renderStep3(body) {
        const uploaded = this._files.filter(f => f.status === 'done' && f.result);
        const totalChars = uploaded.reduce((s, f) => s + (f.result.char_count || 0), 0);
        const totalPages = uploaded.reduce((s, f) => s + (f.result.page_count || 0), 0);
        const totalPrice = uploaded.reduce((s, f) => s + (f.result.estimated_price_cents || 0), 0);

        body.innerHTML = `
            <div class="wizard-step">
                <h2>\u041f\u0435\u0440\u0435\u0432\u0456\u0440\u043a\u0430</h2>
                <p class="wizard-step-desc">\u041f\u0435\u0440\u0435\u0432\u0456\u0440\u0442\u0435 \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u0456 \u0444\u0430\u0439\u043b\u0438</p>
                <div class="stats" style="margin-bottom:20px">
                    <div class="stat"><div class="stat-value">${uploaded.length}</div><div class="stat-label">\u0424\u0430\u0439\u043b\u0456\u0432</div></div>
                    <div class="stat"><div class="stat-value">${totalChars.toLocaleString()}</div><div class="stat-label">\u0421\u0438\u043c\u0432\u043e\u043b\u0456\u0432</div></div>
                    ${totalPages ? '<div class="stat"><div class="stat-value">' + totalPages + '</div><div class="stat-label">\u0421\u0442\u043e\u0440\u0456\u043d\u043e\u043a</div></div>' : ''}
                    <div class="stat"><div class="stat-value">\u20ac${App.fmtEuro(totalPrice)}</div><div class="stat-label">\u0412\u0430\u0440\u0442\u0456\u0441\u0442\u044c</div></div>
                </div>
                <div id="wiz-review-list">
                    ${uploaded.map(f => `
                        <div class="file-item">
                            <div class="file-icon">${Icons.wrap('check', 18)}</div>
                            <div class="file-info">
                                <div class="file-name">${App.esc(f.result.original_name || f.file.name)}</div>
                                <div class="file-meta">
                                    ${FilesView.categoryLabel(f.result.category || this._category)}
                                    \u00b7 ${App.fmtSize(f.result.file_size || f.file.size)}
                                    ${f.result.char_count ? ' \u00b7 ' + f.result.char_count.toLocaleString() + ' \u0441\u0438\u043c.' : ''}
                                    ${f.result.page_count ? ' \u00b7 ' + f.result.page_count + ' \u0441\u0442\u043e\u0440.' : ''}
                                    ${f.result.estimated_price_cents ? ' \u00b7 \u20ac' + App.fmtEuro(f.result.estimated_price_cents) : ''}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    },

    // ─── Step 4: Instructions ───
    _renderStep4(body) {
        body.innerHTML = `
            <div class="wizard-step">
                <h2>\u0406\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0456\u0457</h2>
                <p class="wizard-step-desc">\u0414\u043e\u0434\u0430\u0439\u0442\u0435 \u0456\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0456\u0457 \u0434\u043b\u044f \u0441\u043f\u0435\u0446\u0456\u0430\u043b\u0456\u0441\u0442\u0430, \u0430\u0431\u043e \u043f\u0440\u043e\u043f\u0443\u0441\u0442\u0456\u0442\u044c \u0446\u0435\u0439 \u043a\u0440\u043e\u043a</p>
                <div class="wizard-templates" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
                    <button class="btn btn-secondary btn-sm" onclick="UploadWizard._insertTemplate('\u0424\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u0438\u0439 \u0441\u0442\u0438\u043b\u044c (Sie/\u0412\u0438)')">
                        \u0424\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u0438\u0439 \u0441\u0442\u0438\u043b\u044c
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="UploadWizard._insertTemplate('\u041d\u0435\u0444\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u0438\u0439 \u0441\u0442\u0438\u043b\u044c (du/\u0442\u0438)')">
                        \u041d\u0435\u0444\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u0438\u0439
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="UploadWizard._insertTemplate('\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u043e\u0440\u0438\u0433\u0456\u043d\u0430\u043b\u044c\u043d\u0435 \u0444\u043e\u0440\u043c\u0430\u0442\u0443\u0432\u0430\u043d\u043d\u044f')">
                        \u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0444\u043e\u0440\u043c\u0430\u0442
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="UploadWizard._insertTemplate('\u0422\u0435\u0445\u043d\u0456\u0447\u043d\u0430 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446\u0456\u044f \u2014 \u0437\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0442\u0435\u0440\u043c\u0456\u043d\u0438')">
                        \u0422\u0435\u0445\u043d\u0456\u0447\u043d\u0430 \u0434\u043e\u043a.
                    </button>
                </div>
                <textarea id="wiz-instructions" class="input" rows="5" placeholder="\u041e\u043f\u0438\u0448\u0456\u0442\u044c \u043e\u0441\u043e\u0431\u043b\u0438\u0432\u0456 \u0432\u0438\u043c\u043e\u0433\u0438 \u0434\u043e \u043f\u0435\u0440\u0435\u043a\u043b\u0430\u0434\u0443..." style="width:100%;resize:vertical;min-height:120px"></textarea>
                <p style="font-size:12px;color:var(--text-muted);margin-top:8px">\u0426\u0435 \u043d\u0435\u043e\u0431\u043e\u0432\u02bc\u044f\u0437\u043a\u043e\u0432\u043e. \u0412\u0438 \u0437\u0430\u0432\u0436\u0434\u0438 \u043c\u043e\u0436\u0435\u0442\u0435 \u0437\u043c\u0456\u043d\u0438\u0442\u0438 \u0456\u043d\u0441\u0442\u0440\u0443\u043a\u0446\u0456\u0457 \u0443 \u043d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f\u0445 \u043f\u0440\u043e\u0454\u043a\u0442\u0443.</p>
            </div>`;
    },

    _insertTemplate(text) {
        const ta = document.getElementById('wiz-instructions');
        if (ta) {
            ta.value = ta.value ? ta.value + '\n' + text : text;
            ta.focus();
        }
    },

    // ─── Step 5: Order ───
    _renderStep5(body) {
        const uploaded = this._files.filter(f => f.status === 'done' && f.result);
        const totalChars = uploaded.reduce((s, f) => s + (f.result.char_count || 0), 0);
        const totalPages = uploaded.reduce((s, f) => s + (f.result.page_count || 0), 0);
        const totalPrice = uploaded.reduce((s, f) => s + (f.result.estimated_price_cents || 0), 0);

        body.innerHTML = `
            <div class="wizard-step">
                <h2>\u0417\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f</h2>
                <p class="wizard-step-desc">\u041f\u0456\u0434\u0441\u0443\u043c\u043e\u043a \u0432\u0430\u0448\u043e\u0433\u043e \u0437\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f</p>

                <div class="card" style="margin-bottom:20px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                        <span style="color:var(--text-secondary)">\u0424\u0430\u0439\u043b\u0456\u0432</span>
                        <span style="font-weight:600">${uploaded.length}</span>
                    </div>
                    ${totalChars ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="color:var(--text-secondary)">\u0421\u0438\u043c\u0432\u043e\u043b\u0456\u0432</span><span style="font-weight:600">' + totalChars.toLocaleString() + '</span></div>' : ''}
                    ${totalPages ? '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="color:var(--text-secondary)">\u0421\u0442\u043e\u0440\u0456\u043d\u043e\u043a</span><span style="font-weight:600">' + totalPages + '</span></div>' : ''}
                    <div style="border-top:1px solid var(--border-dark);padding-top:12px;display:flex;justify-content:space-between;align-items:center">
                        <span style="font-weight:700;font-size:16px">\u041e\u0440\u0456\u0454\u043d\u0442\u043e\u0432\u043d\u0430 \u0432\u0430\u0440\u0442\u0456\u0441\u0442\u044c</span>
                        <span style="font-weight:700;font-size:20px;color:var(--green)">\u20ac${App.fmtEuro(totalPrice)}</span>
                    </div>
                </div>

                <p style="font-size:13px;color:var(--text-secondary);line-height:1.5">\u0424\u0430\u0439\u043b\u0438 \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043e. \u041f\u0435\u0440\u0435\u0439\u0434\u0456\u0442\u044c \u0434\u043e \u0440\u043e\u0437\u0434\u0456\u043b\u0443 \u00ab\u0412\u0430\u0440\u0442\u0456\u0441\u0442\u044c\u00bb, \u0449\u043e\u0431 \u043e\u0431\u0440\u0430\u0442\u0438 \u0442\u0430\u0440\u0438\u0444 \u0442\u0430 \u043e\u0444\u043e\u0440\u043c\u0438\u0442\u0438 \u043e\u043f\u043b\u0430\u0442\u0443.</p>
                <button class="btn btn-primary" style="margin-top:16px;width:100%" onclick="UploadWizard.close(); App.navigate('pricing');">
                    ${Icons.wrap('pricing', 18)} \u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u0434\u043e \u0432\u0430\u0440\u0442\u043e\u0441\u0442\u0456
                </button>
            </div>`;
    },

    /** Save instructions if any, then close */
    async _finishAndClose() {
        const ta = document.getElementById('wiz-instructions');
        if (ta && ta.value.trim() && this._projectId) {
            try {
                await API.updateProjectInstructions(this._projectId, ta.value.trim());
            } catch (e) { /* non-critical */ }
        }
        this.close();
    }
};
