const GlossaryVersionsView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()">←</button>
                <h2>${App.esc(project.name)} — Версії глосарію</h2>
            </div>
            <div id="versions-list"><div class="loading">Завантаження...</div></div>
            <div id="diff-panel" class="diff-panel" style="display:none">
                <div class="diff-panel-header">
                    <h3>Порівняння версій</h3>
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
                list.innerHTML = `
                    <div class="empty" style="padding:32px">
                        <div class="empty-icon">📊</div>
                        <p>Ще немає версій глосарію</p>
                        <p style="font-size:13px;color:var(--hint);margin-top:8px">
                            Версії створюються автоматично при зміні глосарію
                        </p>
                    </div>`;
                return;
            }

            list.innerHTML = '<div class="timeline">' + versions.map((v, i) => {
                const isCurrent = i === 0;
                const itemClass = isCurrent ? 'timeline-item current' : 'timeline-item';
                return `
                    <div class="${itemClass}">
                        <div class="timeline-header">
                            <div class="timeline-title">Версія ${v.version_number}${isCurrent ? ' <span class="card-badge" style="font-size:11px">поточна</span>' : ''}</div>
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
            list.innerHTML = `<div class="empty"><p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p></div>`;
        }
    },

    async showDiff(pid, versionA, versionB, labelA, labelB) {
        const panel = document.getElementById('diff-panel');
        const content = document.getElementById('diff-content');
        if (!panel || !content) return;

        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        content.innerHTML = '<div class="loading">Обчислення різниці...</div>';

        try {
            const data = await API.getGlossaryDiff(pid, versionA, versionB);
            const changes = data.changes || [];

            if (!changes.length) {
                content.innerHTML = '<div class="empty" style="padding:16px"><div class="empty-icon">✓</div><p>Немає змін між версіями</p></div>';
                return;
            }

            const stats = { added: 0, removed: 0, modified: 0 };
            changes.forEach(c => stats[c.type]++);

            content.innerHTML = `
                <div class="diff-stats-bar">
                    <div class="diff-stats-label">Порівняння: ${App.esc(labelA)} → ${App.esc(labelB)}</div>
                    <div class="diff-stats-badges">
                        <span class="diff-badge diff-badge-added">+${stats.added} додано</span>
                        <span class="diff-badge diff-badge-removed">-${stats.removed} видалено</span>
                        <span class="diff-badge diff-badge-modified">~${stats.modified} змінено</span>
                    </div>
                </div>
                <div class="diff-table">
                    <div class="diff-header">
                        <div>Оригінал</div>
                        <div>Було (${App.esc(labelA)})</div>
                        <div>Стало (${App.esc(labelB)})</div>
                    </div>
                    ${changes.map(c => this.renderDiffRow(c)).join('')}
                </div>`;
        } catch (e) {
            content.innerHTML = `<div class="empty"><p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p></div>`;
        }
    },

    closeDiff() {
        const panel = document.getElementById('diff-panel');
        if (panel) panel.style.display = 'none';
    },

    renderDiffRow(change) {
        if (change.type === 'added') {
            return `<div class="diff-row diff-added">
                <div class="diff-cell"><span class="diff-cell-label">Оригінал:</span>${App.esc(change.source)}</div>
                <div class="diff-cell"><span class="diff-cell-label">Було:</span><span style="color:var(--hint)">—</span></div>
                <div class="diff-cell diff-new"><span class="diff-cell-label">Стало:</span>${App.esc(change.target)}</div>
            </div>`;
        }
        if (change.type === 'removed') {
            return `<div class="diff-row diff-removed">
                <div class="diff-cell"><span class="diff-cell-label">Оригінал:</span>${App.esc(change.source)}</div>
                <div class="diff-cell diff-old"><span class="diff-cell-label">Було:</span>${App.esc(change.target)}</div>
                <div class="diff-cell"><span class="diff-cell-label">Стало:</span><span style="color:var(--hint)">—</span></div>
            </div>`;
        }
        // modified - word-level diff
        const oldWords = (change.old_target || '').split(/\s+/);
        const newWords = (change.new_target || '').split(/\s+/);
        const oldHighlighted = this.highlightDiff(oldWords, newWords, 'del');
        const newHighlighted = this.highlightDiff(newWords, oldWords, 'add');

        return `<div class="diff-row diff-modified">
            <div class="diff-cell"><span class="diff-cell-label">Оригінал:</span>${App.esc(change.source)}</div>
            <div class="diff-cell"><span class="diff-cell-label">Було:</span>${oldHighlighted}</div>
            <div class="diff-cell"><span class="diff-cell-label">Стало:</span>${newHighlighted}</div>
        </div>`;
    },

    highlightDiff(words, compareWords, type) {
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
