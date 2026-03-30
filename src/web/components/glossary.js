const GlossaryView = {
    filter: 'all',
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Глосарій</h2>
            <div class="tabs" id="glossary-tabs">
                <button class="tab active" data-f="all">Всі</button>
                <button class="tab" data-f="approved">Затверджені</button>
                <button class="tab" data-f="pending">На перевірці</button>
            </div>
            <div id="glossary-actions" style="display:flex;gap:8px;margin-bottom:12px">
                <button class="btn btn-primary" style="flex:1;padding:8px" onclick="GlossaryView.exportTSV(${project.id})">Експорт TSV</button>
                <button class="btn btn-secondary" style="flex:1;padding:8px" onclick="GlossaryView.syncGlossary(${project.id})">Синхронізувати</button>
            </div>
            <div id="glossary-stats"></div>
            <div class="term-row header">
                <div>Оригінал</div><div>Переклад</div><div>Дія</div>
            </div>
            <div id="terms-list"><div class="loading">Завантаження...</div></div>
            <div id="bulk-actions" style="display:none;margin-top:12px">
                <button class="btn btn-primary" onclick="GlossaryView.bulkApprove(${project.id})">Затвердити обрані</button>
            </div>`;

        c.querySelectorAll('#glossary-tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                c.querySelectorAll('#glossary-tabs .tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.filter = tab.dataset.f;
                this.loadTerms(project.id);
            });
        });

        this.loadTerms(project.id);
    },

    async loadTerms(pid) {
        const list = document.getElementById('terms-list');
        if (!list) return;
        try {
            const data = await API.getGlossary(pid);
            let terms = data.terms || [];

            // Stats
            const stats = document.getElementById('glossary-stats');
            if (stats) {
                const approved = terms.filter(t => t.is_approved).length;
                stats.innerHTML = `
                    <div class="stats">
                        <div class="stat"><div class="stat-value">${terms.length}</div><div class="stat-label">Всього</div></div>
                        <div class="stat"><div class="stat-value">${approved}</div><div class="stat-label">Затверджено</div></div>
                    </div>`;
            }

            // Filter
            if (this.filter === 'approved') terms = terms.filter(t => t.is_approved);
            else if (this.filter === 'pending') terms = terms.filter(t => !t.is_approved);

            if (!terms.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Немає термінів</p></div>';
                return;
            }

            list.innerHTML = terms.map(t => `
                <div class="term-row" data-id="${t.id}">
                    <div class="term-source">${App.esc(t.source_term)}</div>
                    <div>${App.esc(t.target_term)}</div>
                    <div class="term-action">
                        ${t.is_approved
                            ? '<span class="card-badge">OK</span>'
                            : `<button class="approve-btn" onclick="GlossaryView.approve(${pid},[${t.id}])">✓</button>
                               <button class="reject-btn" onclick="GlossaryView.reject(${pid},[${t.id}])">✗</button>`
                        }
                    </div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    async approve(pid, ids) {
        try {
            await API.approveTerms(pid, ids);
            this.loadTerms(pid);
        } catch (e) { App.alert(e.message); }
    },

    async reject(pid, ids) {
        try {
            await API.rejectTerms(pid, ids);
            this.loadTerms(pid);
        } catch (e) { App.alert(e.message); }
    },

    async bulkApprove(pid) {
        const ids = [];
        document.querySelectorAll('.term-row[data-id]').forEach(row => {
            if (!row.querySelector('.card-badge')) ids.push(parseInt(row.dataset.id));
        });
        if (ids.length) await this.approve(pid, ids);
    },

    async exportTSV(pid) {
        try {
            const data = await API.exportGlossary(pid, 'tsv');
            const blob = new Blob([data.content || ''], { type: 'text/tab-separated-values' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'glossary.tsv'; a.click();
            URL.revokeObjectURL(url);
        } catch (e) { App.alert(e.message); }
    },

    async syncGlossary(pid) {
        try {
            await API.syncGlossary(pid);
            App.alert('Глосарій синхронізовано!');
        } catch (e) { App.alert(e.message); }
    }
};
