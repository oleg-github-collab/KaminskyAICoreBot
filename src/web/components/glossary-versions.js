const GlossaryVersionsView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Версії глосарію</h2>
            <div id="versions-list"><div class="loading">Завантаження...</div></div>
            <div id="diff-panel" style="display:none;margin-top:16px">
                <h3 style="font-size:14px;margin-bottom:8px">Порівняння версій</h3>
                <div id="diff-content"></div>
            </div>`;
        this.loadVersions(project.id);
    },

    async loadVersions(pid) {
        const list = document.getElementById('versions-list');
        if (!list) return;
        try {
            const data = await API.getGlossaryVersions(pid);
            const versions = data.versions || [];

            if (!versions.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Ще немає версій глосарію</p></div>';
                return;
            }

            list.innerHTML = versions.map((v, i) => `
                <div class="card" style="margin-bottom:8px">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <div class="card-title">v${v.version_number}</div>
                        <div class="card-sub">${App.fmtDate(v.created_at)}</div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:4px;font-size:12px">
                        ${v.terms_added > 0 ? `<span class="diff-badge diff-badge-added">+${v.terms_added}</span>` : ''}
                        ${v.terms_removed > 0 ? `<span class="diff-badge diff-badge-removed">-${v.terms_removed}</span>` : ''}
                        ${v.terms_modified > 0 ? `<span class="diff-badge diff-badge-modified">~${v.terms_modified}</span>` : ''}
                    </div>
                    ${v.change_summary ? `<div class="card-sub" style="margin-top:4px">${App.esc(v.change_summary)}</div>` : ''}
                    <div style="display:flex;gap:8px;margin-top:8px">
                        <button class="btn btn-secondary" style="flex:1;padding:6px;font-size:12px"
                            onclick="GlossaryVersionsView.exportVersion(${pid},${v.id})">Експорт TSV</button>
                        ${i < versions.length - 1 ? `
                        <button class="btn btn-primary" style="flex:1;padding:6px;font-size:12px"
                            onclick="GlossaryVersionsView.showDiff(${pid},${versions[i+1].id},${v.id})">Порівняти з v${versions[i+1].version_number}</button>
                        ` : ''}
                    </div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    async showDiff(pid, versionA, versionB) {
        const panel = document.getElementById('diff-panel');
        const content = document.getElementById('diff-content');
        if (!panel || !content) return;
        panel.style.display = 'block';
        content.innerHTML = '<div class="loading">Обчислення різниці...</div>';

        try {
            const data = await API.getGlossaryDiff(pid, versionA, versionB);
            const changes = data.changes || [];

            if (!changes.length) {
                content.innerHTML = '<div class="empty" style="padding:16px"><p>Немає змін</p></div>';
                return;
            }

            const stats = { added: 0, removed: 0, modified: 0 };
            changes.forEach(c => stats[c.type]++);

            content.innerHTML = `
                <div class="diff-stats" style="display:flex;gap:12px;margin-bottom:12px;font-size:13px">
                    <span class="diff-badge diff-badge-added">+${stats.added} додано</span>
                    <span class="diff-badge diff-badge-removed">-${stats.removed} видалено</span>
                    <span class="diff-badge diff-badge-modified">~${stats.modified} змінено</span>
                </div>
                <div class="diff-table">
                    <div class="diff-header">
                        <div>Оригінал</div>
                        <div>Було</div>
                        <div>Стало</div>
                    </div>
                    ${changes.map(c => this.renderDiffRow(c)).join('')}
                </div>`;
        } catch (e) {
            content.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    renderDiffRow(change) {
        if (change.type === 'added') {
            return `<div class="diff-row diff-added">
                <div>${App.esc(change.source)}</div>
                <div></div>
                <div class="diff-new">${App.esc(change.target)}</div>
            </div>`;
        }
        if (change.type === 'removed') {
            return `<div class="diff-row diff-removed">
                <div>${App.esc(change.source)}</div>
                <div class="diff-old">${App.esc(change.target)}</div>
                <div></div>
            </div>`;
        }
        // modified
        return `<div class="diff-row diff-modified">
            <div>${App.esc(change.source)}</div>
            <div class="diff-old">${App.esc(change.old_target)}</div>
            <div class="diff-new">${App.esc(change.new_target)}</div>
        </div>`;
    },

    async exportVersion(pid, vid) {
        try {
            const data = await API.getGlossaryVersion(pid, vid);
            const blob = new Blob([data.snapshot_tsv || ''], { type: 'text/tab-separated-values' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `glossary_v${data.version_number || ''}.tsv`; a.click();
            URL.revokeObjectURL(url);
        } catch (e) { App.alert(e.message); }
    }
};
