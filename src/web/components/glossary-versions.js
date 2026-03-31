const GlossaryVersionsView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Версії глосарію</h2>
            <div id="versions-list"><div class="loading">Завантаження...</div></div>
            <div id="diff-panel" style="display:none;margin-top:20px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                    <h3 style="font-size:16px;font-weight:700;margin:0">Порівняння версій</h3>
                    <button class="btn btn-secondary btn-sm" onclick="GlossaryVersionsView.closeDiff()">✕ Закрити</button>
                </div>
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

            // Timeline UI
            list.innerHTML = '<div class="timeline">' + versions.map((v, i) => {
                const isCurrent = i === 0;
                const itemClass = isCurrent ? 'timeline-item current' : 'timeline-item';
                return `
                    <div class="${itemClass}">
                        <div class="timeline-header">
                            <div class="timeline-title">Версія ${v.version_number}${isCurrent ? ' (поточна)' : ''}</div>
                            <div class="timeline-date">${App.fmtDate(v.created_at)}</div>
                        </div>
                        ${v.change_summary ? `<div class="timeline-summary">${App.esc(v.change_summary)}</div>` : ''}
                        <div class="timeline-badges">
                            ${v.terms_added > 0 ? `<span class="diff-badge diff-badge-added">+${v.terms_added} додано</span>` : ''}
                            ${v.terms_removed > 0 ? `<span class="diff-badge diff-badge-removed">-${v.terms_removed} видалено</span>` : ''}
                            ${v.terms_modified > 0 ? `<span class="diff-badge diff-badge-modified">~${v.terms_modified} змінено</span>` : ''}
                        </div>
                        <div class="timeline-actions">
                            <button class="btn btn-secondary btn-sm" onclick="GlossaryVersionsView.exportVersion(${pid},${v.id})">
                                📥 Експорт
                            </button>
                            ${i < versions.length - 1 ? `
                                <button class="btn btn-primary btn-sm" onclick="GlossaryVersionsView.showDiff(${pid},${versions[i+1].id},${v.id},'v${versions[i+1].version_number}','v${v.version_number}')">
                                    🔍 Порівняти з v${versions[i+1].version_number}
                                </button>
                            ` : ''}
                        </div>
                    </div>`;
            }).join('') + '</div>';
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    async showDiff(pid, versionA, versionB, labelA, labelB) {
        const panel = document.getElementById('diff-panel');
        const content = document.getElementById('diff-content');
        if (!panel || !content) return;

        // Scroll to diff panel
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        panel.style.display = 'block';
        content.innerHTML = '<div class="loading">Обчислення різниці...</div>';

        try {
            const data = await API.getGlossaryDiff(pid, versionA, versionB);
            const changes = data.changes || [];

            if (!changes.length) {
                content.innerHTML = '<div class="empty" style="padding:16px"><p>Немає змін між версіями</p></div>';
                return;
            }

            const stats = { added: 0, removed: 0, modified: 0 };
            changes.forEach(c => stats[c.type]++);

            content.innerHTML = `
                <div style="background:var(--bg2);border-radius:var(--radius);padding:12px;margin-bottom:12px">
                    <div style="font-size:13px;color:var(--hint);margin-bottom:8px">Порівняння: ${labelA} → ${labelB}</div>
                    <div style="display:flex;gap:12px;flex-wrap:wrap">
                        <span class="diff-badge diff-badge-added">+${stats.added} додано</span>
                        <span class="diff-badge diff-badge-removed">-${stats.removed} видалено</span>
                        <span class="diff-badge diff-badge-modified">~${stats.modified} змінено</span>
                        <span style="font-size:13px;color:var(--hint);margin-left:auto">Всього змін: ${changes.length}</span>
                    </div>
                </div>
                <div class="diff-table">
                    <div class="diff-header">
                        <div>Оригінал</div>
                        <div>Було (${labelA})</div>
                        <div>Стало (${labelB})</div>
                    </div>
                    ${changes.map(c => this.renderDiffRow(c)).join('')}
                </div>`;
        } catch (e) {
            content.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    closeDiff() {
        const panel = document.getElementById('diff-panel');
        if (panel) panel.style.display = 'none';
    },

    renderDiffRow(change) {
        if (change.type === 'added') {
            return `<div class="diff-row diff-added">
                <div>${App.esc(change.source)}</div>
                <div style="color:var(--hint);font-size:12px">—</div>
                <div class="diff-new">${App.esc(change.target)}</div>
            </div>`;
        }
        if (change.type === 'removed') {
            return `<div class="diff-row diff-removed">
                <div>${App.esc(change.source)}</div>
                <div class="diff-old">${App.esc(change.target)}</div>
                <div style="color:var(--hint);font-size:12px">—</div>
            </div>`;
        }
        // modified - word-level diff
        const oldWords = (change.old_target || '').split(/\s+/);
        const newWords = (change.new_target || '').split(/\s+/);
        const oldHighlighted = this.highlightDiff(oldWords, newWords, 'del');
        const newHighlighted = this.highlightDiff(newWords, oldWords, 'add');

        return `<div class="diff-row diff-modified">
            <div>${App.esc(change.source)}</div>
            <div>${oldHighlighted}</div>
            <div>${newHighlighted}</div>
        </div>`;
    },

    highlightDiff(words, compareWords, type) {
        // Simple word-level diff highlighting
        const compareSet = new Set(compareWords);
        return words.map(w => {
            if (!compareSet.has(w)) {
                const cls = type === 'del' ? 'diff-word-del' : 'diff-word-add';
                return `<span class="${cls}">${App.esc(w)}</span>`;
            }
            return App.esc(w);
        }).join(' ');
    },

    async exportVersion(pid, vid) {
        try {
            const data = await API.getGlossaryVersion(pid, vid);
            const blob = new Blob([data.snapshot_tsv || ''], { type: 'text/tab-separated-values' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `glossary_v${data.version_number || ''}.tsv`; a.click();
            URL.revokeObjectURL(url);
            App.toast('Експорт версії завершено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    }
};
