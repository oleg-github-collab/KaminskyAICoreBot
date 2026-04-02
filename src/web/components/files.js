const FilesView = {
    category: 'all',
    uploadCategory: 'source',
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">\ud83d\udcc1</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()">\u2190</button>
                <h2>${App.esc(project.name)} \u2014 Файли</h2>
            </div>
            <div class="tabs" id="file-tabs">
                <button class="tab active" data-cat="all">Всі</button>
                <button class="tab" data-cat="source">Вихідні</button>
                <button class="tab" data-cat="reference">Референс</button>
                <button class="tab" data-cat="translated">Переклади</button>
            </div>
            <div class="upload-card">
                <div class="card-title">\ud83d\udce4 Завантажити файли</div>
                <div class="upload-controls">
                    <select id="upload-cat" class="input" style="width:auto;padding:8px 12px;font-size:13px">
                        <option value="source">Вихідні</option>
                        <option value="reference">Референс</option>
                    </select>
                    <button class="btn btn-primary btn-sm" style="flex:1" onclick="document.getElementById('file-input').click()">Обрати файли</button>
                </div>
                <div class="drop-zone" id="drop-zone">
                    <span class="drop-icon">\ud83d\udcc2</span>
                    <p>Перетягніть файли сюди</p>
                    <span class="drop-hint">або натисніть для вибору</span>
                    <input type="file" id="file-input" multiple style="display:none">
                </div>
                <div class="progress-bar" id="upload-progress" style="display:none">
                    <div class="progress-bar-fill" id="upload-fill" style="width:0%"></div>
                </div>
                <div class="upload-status" id="upload-status"></div>
            </div>
            <div id="files-stats"></div>
            <div id="files-list"><div class="loading">Завантаження...</div></div>`;

        c.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                c.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.category = tab.dataset.cat;
                this.loadFiles(project.id);
            });
        });

        const dz = c.querySelector('#drop-zone');
        const fi = c.querySelector('#file-input');
        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', e => {
            e.preventDefault(); dz.classList.remove('dragover');
            this.doUpload(project.id, e.dataTransfer.files);
        });
        fi.addEventListener('change', () => {
            if (fi.files.length) this.doUpload(project.id, fi.files);
        });

        this.loadFiles(project.id);
    },

    async loadFiles(pid) {
        const list = document.getElementById('files-list');
        const statsEl = document.getElementById('files-stats');
        if (!list) return;
        try {
            const cat = this.category === 'all' ? null : this.category;
            const data = await API.getFiles(pid, cat);
            const files = data.files || [];

            if (statsEl && files.length) {
                const totalChars = files.reduce((s, f) => s + (f.char_count || 0), 0);
                const totalPages = files.reduce((s, f) => s + (f.page_count || 0), 0);
                const totalPrice = files.reduce((s, f) => s + (f.estimated_price_cents || 0), 0);
                statsEl.innerHTML = `
                    <div class="stats" style="margin-bottom:12px">
                        <div class="stat"><div class="stat-value">${files.length}</div><div class="stat-label">Файлів</div></div>
                        <div class="stat"><div class="stat-value">${totalChars.toLocaleString()}</div><div class="stat-label">Символів</div></div>
                        <div class="stat"><div class="stat-value">${totalPages}</div><div class="stat-label">Сторінок</div></div>
                        <div class="stat"><div class="stat-value">\u20ac${App.fmtEuro(totalPrice)}</div><div class="stat-label">Вартість</div></div>
                    </div>`;
            } else if (statsEl) {
                statsEl.innerHTML = '';
            }

            if (!files.length) {
                const isFiltered = this.category !== 'all';
                list.innerHTML = `<div class="empty-state" style="padding:32px">
                    <div class="empty-state-icon">\ud83d\udcc2</div>
                    <p class="empty-state-title">${isFiltered ? 'Немає файлів у цій категорії' : 'Немає файлів'}</p>
                    <p class="empty-state-text">${isFiltered ? 'Спробуйте іншу категорію або завантажте нові файли' : 'Завантажте вихідні тексти, щоб розпочати роботу. Або надішліть файли через бот.'}</p>
                </div>`;
                return;
            }
            list.innerHTML = files.map(f => {
                const safeName = App.esc(f.original_name).replace(/'/g, "\\'");
                const catLabel = this.categoryLabel(f.category);
                return `
                <div class="file-item">
                    <div class="file-icon">${this.icon(f.category)}</div>
                    <div class="file-info">
                        <div class="file-name">${App.esc(f.original_name)}</div>
                        <div class="file-meta">
                            ${catLabel} \u00b7 ${App.fmtSize(f.file_size)}
                            ${f.char_count ? ' \u00b7 ' + f.char_count.toLocaleString() + ' сим.' : ''}
                            ${f.page_count ? ' \u00b7 ' + f.page_count + ' стор.' : ''}
                            ${f.estimated_price_cents ? ' \u00b7 \u20ac' + App.fmtEuro(f.estimated_price_cents) : ''}
                        </div>
                        ${f.review_status && f.review_status !== 'pending' ? `<div style="margin-top:4px"><span class="review-badge ${this.reviewClass(f.review_status)}">${this.reviewLabel(f.review_status)}</span></div>` : ''}
                    </div>
                    <div class="file-actions">
                        <button class="btn btn-icon btn-secondary"
                                onclick="FileViewer.show(${pid}, ${f.id}, '${safeName}')"
                                data-tooltip="Переглянути">
                            \ud83d\udc41\ufe0f
                        </button>
                        ${f.category === 'translated' ? `
                        <button class="btn btn-icon btn-secondary"
                                onclick="FileViewer.showPair(${pid}, ${f.id}, '${safeName}')"
                                data-tooltip="Порівняти з оригіналом">
                            \u2194
                        </button>` : ''}
                        <button class="btn btn-icon btn-secondary"
                                onclick="FilesView.downloadFile(${pid},${f.id},'${safeName}')"
                                data-tooltip="Скачати">
                            \u2b07
                        </button>
                        <button class="btn btn-icon"
                                style="color:var(--red);background:var(--red-bg)"
                                onclick="FilesView.deleteFile(${pid},${f.id},'${safeName}')"
                                data-tooltip="Видалити">
                            \u2715
                        </button>
                    </div>
                </div>`;
            }).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint);padding:12px">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    async doUpload(pid, fileList) {
        const pb = document.getElementById('upload-progress');
        const fill = document.getElementById('upload-fill');
        const status = document.getElementById('upload-status');
        const catSelect = document.getElementById('upload-cat');
        const cat = catSelect ? catSelect.value : 'source';
        pb.style.display = 'block';
        status.textContent = 'Завантаження 0/' + fileList.length + '...';
        await API.uploadFiles(pid, Array.from(fileList), cat, (done, total) => {
            fill.style.width = Math.round(done / total * 100) + '%';
            status.textContent = 'Завантажено ' + done + '/' + total;
        });
        pb.style.display = 'none';
        status.textContent = '\u2705 Завантаження завершено!';
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        this.loadFiles(pid);
    },

    async deleteFile(pid, fid, name) {
        App.confirm('Видалити файл \u00ab' + name + '\u00bb?', async (ok) => {
            if (!ok) return;
            try {
                await API.deleteFile(pid, fid);
                this.loadFiles(pid);
            } catch (e) { App.alert(e.message); }
        });
    },

    async downloadFile(pid, fid, name) {
        try {
            const blob = await API.downloadFileBlob(pid, fid);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name; a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            App.toast('Помилка завантаження: ' + e.message, 'error');
        }
    },

    reviewClass(status) {
        const map = {
            'admin_review': 'review',
            'admin_approved': 'approved',
            'admin_edited': 'edited',
            'client_review': 'review',
            'client_approved': 'approved',
            'revision_requested': 'revision',
        };
        return map[status] || 'pending';
    },

    reviewLabel(status) {
        const map = {
            'pending': '\u23f3 Очікує',
            'admin_review': '\ud83d\udd0d На перевірці',
            'admin_approved': '\u2705 Схвалено',
            'admin_edited': '\u270f Відредаговано',
            'client_review': '\ud83d\udce9 Очікує перевірки',
            'client_approved': '\u2705 Затверджено',
            'revision_requested': '\ud83d\udd04 Потребує правок',
        };
        return map[status] || status;
    },

    icon(cat) {
        return { source: '\ud83d\udcc4', reference: '\ud83d\udcd1', glossary: '\ud83d\udccb', translated: '\u2705' }[cat] || '\ud83d\udcc4';
    },

    categoryLabel(cat) {
        return { source: 'Вихідний', reference: 'Референс', glossary: 'Глосарій', translated: 'Переклад' }[cat] || cat;
    }
};
