const FilesView = {
    category: 'all',
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">📁</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Файли</h2>
            <div class="tabs" id="file-tabs">
                <button class="tab active" data-cat="all">Всі</button>
                <button class="tab" data-cat="source">Вихідні</button>
                <button class="tab" data-cat="reference">Референс</button>
                <button class="tab" data-cat="glossary">Глосарії</button>
                <button class="tab" data-cat="translated">Переклади</button>
            </div>
            <div class="drop-zone" id="drop-zone">
                <p>📎 Перетягніть файли сюди або натисніть</p>
                <p style="font-size:12px;margin-top:4px">Підтримується завантаження десятків файлів одночасно</p>
                <input type="file" id="file-input" multiple>
            </div>
            <div class="progress-bar" id="upload-progress" style="display:none">
                <div class="progress-bar-fill" id="upload-fill" style="width:0%"></div>
            </div>
            <div id="upload-status" style="font-size:12px;color:var(--hint);margin:4px 0"></div>
            <div id="files-list"><div class="loading">Завантаження...</div></div>`;

        // Tabs
        c.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                c.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.category = tab.dataset.cat;
                this.loadFiles(project.id);
            });
        });

        // Drop zone
        const dz = c.querySelector('#drop-zone');
        const fi = c.querySelector('#file-input');
        dz.addEventListener('click', () => fi.click());
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', e => {
            e.preventDefault(); dz.classList.remove('dragover');
            this.uploadFiles(project.id, e.dataTransfer.files);
        });
        fi.addEventListener('change', () => {
            if (fi.files.length) this.uploadFiles(project.id, fi.files);
        });

        this.loadFiles(project.id);
    },

    async loadFiles(pid) {
        const list = document.getElementById('files-list');
        if (!list) return;
        try {
            const cat = this.category === 'all' ? null : this.category;
            const data = await API.getFiles(pid, cat);
            const files = data.files || [];
            if (!files.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Немає файлів</p></div>';
                return;
            }
            list.innerHTML = files.map(f => `
                <div class="file-item">
                    <div class="file-icon">${this.icon(f.category)}</div>
                    <div class="file-info">
                        <div class="file-name">${App.esc(f.original_name)}</div>
                        <div class="file-meta">${App.esc(f.category)} · ${this.size(f.file_size)}</div>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    async uploadFiles(pid, fileList) {
        const pb = document.getElementById('upload-progress');
        const fill = document.getElementById('upload-fill');
        const status = document.getElementById('upload-status');
        pb.style.display = 'block';
        status.textContent = `Завантаження 0/${fileList.length}...`;

        const cat = this.category !== 'all' ? this.category : 'source';
        await API.uploadFiles(pid, Array.from(fileList), cat, (done, total) => {
            const pct = Math.round(done / total * 100);
            fill.style.width = pct + '%';
            status.textContent = `Завантажено ${done}/${total}`;
        });

        pb.style.display = 'none';
        status.textContent = 'Завантаження завершено!';
        this.loadFiles(pid);
    },

    icon(cat) {
        const icons = { source: '📄', reference: '📑', glossary: '📋', translated: '✅', document: '📎', media: '🖼️' };
        return icons[cat] || '📄';
    },
    size(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }
};
