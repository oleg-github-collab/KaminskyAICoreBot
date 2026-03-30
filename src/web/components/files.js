const FilesView = {
    category: 'all',
    uploadCategory: 'source',
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">📁</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <button class="btn" style="padding:6px 12px;width:auto" onclick="App.backToProjects()">\u2190</button>
                <h2 style="font-size:16px;margin:0;flex:1">${App.esc(project.name)} \u2014 Файли</h2>
            </div>
            <div class="tabs" id="file-tabs">
                <button class="tab active" data-cat="all">Всі</button>
                <button class="tab" data-cat="source">Вихідні</button>
                <button class="tab" data-cat="reference">Референс</button>
            </div>
            <div class="card" style="margin:12px 0">
                <div class="card-title" style="margin-bottom:8px">Завантажити файли</div>
                <div style="display:flex;gap:8px;margin-bottom:8px">
                    <select id="upload-cat" class="input" style="width:auto;padding:6px 10px">
                        <option value="source">Вихідні</option>
                        <option value="reference">Референс</option>
                    </select>
                    <button class="btn btn-primary" style="flex:1" onclick="document.getElementById('file-input').click()">Обрати файли</button>
                </div>
                <div class="drop-zone" id="drop-zone">
                    <p>Перетягніть файли сюди</p>
                    <input type="file" id="file-input" multiple style="display:none">
                </div>
                <div class="progress-bar" id="upload-progress" style="display:none;margin-top:8px">
                    <div class="progress-bar-fill" id="upload-fill" style="width:0%"></div>
                </div>
                <div id="upload-status" style="font-size:12px;color:var(--hint);margin-top:4px"></div>
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

            // Stats
            if (statsEl && files.length) {
                const totalChars = files.reduce((s, f) => s + (f.char_count || 0), 0);
                const totalPages = files.reduce((s, f) => s + (f.page_count || 0), 0);
                const totalPrice = files.reduce((s, f) => s + (f.estimated_price_cents || 0), 0);
                statsEl.innerHTML = `
                    <div class="stats" style="margin-bottom:8px">
                        <div class="stat"><div class="stat-value">${files.length}</div><div class="stat-label">Файлів</div></div>
                        <div class="stat"><div class="stat-value">${totalChars}</div><div class="stat-label">Символів</div></div>
                        <div class="stat"><div class="stat-value">${totalPages}</div><div class="stat-label">Сторінок</div></div>
                        <div class="stat"><div class="stat-value">\u20ac${App.fmtEuro(totalPrice)}</div><div class="stat-label">Вартість</div></div>
                    </div>`;
            } else if (statsEl) {
                statsEl.innerHTML = '';
            }

            if (!files.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Немає файлів</p><p style="font-size:13px;color:var(--hint)">Завантажте файли вище або надішліть їх через бот</p></div>';
                return;
            }
            list.innerHTML = files.map(f => `
                <div class="file-item">
                    <div class="file-icon">${this.icon(f.category)}</div>
                    <div class="file-info" style="flex:1">
                        <div class="file-name">${App.esc(f.original_name)}</div>
                        <div class="file-meta">
                            ${App.esc(f.category)} \u00b7 ${App.fmtSize(f.file_size)}
                            ${f.char_count ? ' \u00b7 ' + f.char_count + ' сим.' : ''}
                            ${f.page_count ? ' \u00b7 ' + f.page_count + ' стор.' : ''}
                            ${f.estimated_price_cents ? ' \u00b7 \u20ac' + App.fmtEuro(f.estimated_price_cents) : ''}
                        </div>
                    </div>
                    <button class="btn" style="width:auto;padding:4px 10px;font-size:12px;color:#ff3b30" onclick="FilesView.deleteFile(${pid},${f.id},'${App.esc(f.original_name)}')">\u2715</button>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
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
        status.textContent = 'Завантаження завершено!';
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        this.loadFiles(pid);
    },

    async deleteFile(pid, fid, name) {
        App.confirm('Видалити файл "' + name + '"?', async (ok) => {
            if (!ok) return;
            try {
                await API.deleteFile(pid, fid);
                this.loadFiles(pid);
            } catch (e) { App.alert(e.message); }
        });
    },

    icon(cat) {
        return { source: '\ud83d\udcc4', reference: '\ud83d\udcd1', glossary: '\ud83d\udccb', translated: '\u2705' }[cat] || '\ud83d\udcc4';
    }
};
