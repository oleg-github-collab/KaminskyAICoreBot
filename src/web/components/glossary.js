const GlossaryView = {
    filter: 'all',
    searchQuery: '',
    editingTermId: null,
    allTerms: [],
    selectedTermIds: new Set(),
    sortableInstance: null,

    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Глосарій</h2>
            <div class="search-bar">
                <input type="text" id="glossary-search" placeholder="Пошук за терміном або доменом..."
                    oninput="GlossaryView.handleSearch(this.value)">
            </div>
            <div class="tabs" id="glossary-tabs">
                <button class="tab active" data-f="all">Всі</button>
                <button class="tab" data-f="approved">Затверджені</button>
                <button class="tab" data-f="pending">На перевірці</button>
            </div>
            <div id="glossary-stats"></div>
            <div id="glossary-actions" style="display:flex;gap:8px;margin-bottom:12px">
                <div class="dropdown" style="position:relative">
                    <button class="btn btn-secondary btn-sm" onclick="GlossaryView.toggleExportMenu(event)">📥 Експорт ▼</button>
                    <div id="export-menu" class="dropdown-menu" style="display:none;position:absolute;top:100%;left:0;background:var(--bg-secondary);box-shadow:var(--shadow-normal);border-radius:6px;margin-top:4px;min-width:150px;z-index:100">
                        <button onclick="GlossaryView.exportTSV(${project.id})">TSV</button>
                        <button onclick="GlossaryView.exportCSV(${project.id})">CSV</button>
                        <button onclick="GlossaryView.exportJSON(${project.id})">JSON</button>
                        <button onclick="GlossaryView.exportXLSX(${project.id})">Excel (XLSX)</button>
                    </div>
                </div>
                <button class="btn btn-secondary btn-sm" onclick="GlossaryView.syncGlossary(${project.id})">🔄 Синхронізувати</button>
                <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="GlossaryView.bulkApprove(${project.id})">✓ Затвердити всі</button>
            </div>
            <div id="batch-actions" style="display:none;background:var(--bg-secondary);padding:12px;border-radius:6px;margin-bottom:12px"></div>
            <div class="term-row header">
                <div style="width:40px"><input type="checkbox" id="select-all" onchange="GlossaryView.toggleSelectAll(this.checked)"></div>
                <div>Оригінал</div>
                <div>Переклад</div>
                <div style="text-align:right">Статус</div>
            </div>
            <div id="terms-list"><div class="loading">Завантаження...</div></div>`;

        c.querySelectorAll('#glossary-tabs .tab').forEach(tab => {
            tab.addEventListener('click', () => {
                c.querySelectorAll('#glossary-tabs .tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.filter = tab.dataset.f;
                this.renderTerms();
            });
        });

        this.loadTerms(project.id);
    },

    async loadTerms(pid) {
        try {
            const data = await API.getGlossary(pid);
            this.allTerms = data.terms || [];
            this.updateStats();
            this.renderTerms();
        } catch (e) {
            const list = document.getElementById('terms-list');
            if (list) list.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    updateStats() {
        const stats = document.getElementById('glossary-stats');
        if (!stats) return;
        const approved = this.allTerms.filter(t => t.is_approved).length;
        const pending = this.allTerms.length - approved;
        const avgConfidence = this.allTerms.length > 0
            ? Math.round(this.allTerms.reduce((s, t) => s + (t.confidence || 0), 0) / this.allTerms.length * 100)
            : 0;
        stats.innerHTML = `
            <div class="stats">
                <div class="stat"><div class="stat-value">${this.allTerms.length}</div><div class="stat-label">Всього</div></div>
                <div class="stat"><div class="stat-value">${approved}</div><div class="stat-label">Затверджено</div></div>
                <div class="stat"><div class="stat-value">${pending}</div><div class="stat-label">На перевірці</div></div>
                <div class="stat"><div class="stat-value">${avgConfidence}%</div><div class="stat-label">Впевненість</div></div>
            </div>`;
    },

    handleSearch(query) {
        this.searchQuery = query.toLowerCase();
        this.renderTerms();
    },

    renderTerms() {
        const list = document.getElementById('terms-list');
        if (!list) return;

        let terms = [...this.allTerms];

        // Filter by status
        if (this.filter === 'approved') terms = terms.filter(t => t.is_approved);
        else if (this.filter === 'pending') terms = terms.filter(t => !t.is_approved);

        // Search filter
        if (this.searchQuery) {
            terms = terms.filter(t =>
                (t.source_term && t.source_term.toLowerCase().includes(this.searchQuery)) ||
                (t.target_term && t.target_term.toLowerCase().includes(this.searchQuery)) ||
                (t.domain && t.domain.toLowerCase().includes(this.searchQuery))
            );
        }

        if (!terms.length) {
            list.innerHTML = '<div class="empty" style="padding:20px"><p>Немає термінів</p></div>';
            return;
        }

        list.innerHTML = terms.map(t => this.renderTermRow(t)).join('');

        // Initialize drag-drop reordering if Sortable.js is loaded
        if (window.Sortable && !this.sortableInstance) {
            this.sortableInstance = Sortable.create(list, {
                animation: 150,
                handle: '.drag-handle',
                onEnd: async (evt) => {
                    const termIds = Array.from(list.querySelectorAll('.term-row')).map(r => parseInt(r.dataset.id));
                    try {
                        // TODO: Implement API endpoint for term reordering
                        // await API.updateTermOrder(App.currentProject.id, termIds);
                        App.toast('Порядок змінено', 'success');
                    } catch (e) {
                        console.error('Reorder failed:', e);
                    }
                }
            });
        }
    },

    renderTermRow(t) {
        const statusClass = t.is_approved ? 'status-approved' : 'status-pending';
        const statusLabel = t.is_approved ? '✓ Затверджено' : '⏳ На перевірці';
        const confidence = (t.confidence || 0) * 100;
        const confClass = confidence >= 80 ? 'confidence-high' : confidence >= 50 ? 'confidence-mid' : 'confidence-low';
        const isEditing = this.editingTermId === t.id;
        const isSelected = this.selectedTermIds.has(t.id);

        return `
            <div class="term-row ${isSelected ? 'selected' : ''}" data-id="${t.id}">
                <div style="width:40px;display:flex;align-items:center;gap:4px">
                    <input type="checkbox" class="term-checkbox" data-id="${t.id}"
                        ${isSelected ? 'checked' : ''}
                        onchange="GlossaryView.toggleSelect(${t.id}, this.checked)">
                    <span class="drag-handle" style="cursor:move;font-size:16px">⠿</span>
                </div>
                <div class="term-source">
                    ${App.esc(t.source_term)}
                    ${t.domain ? `<div style="margin-top:4px"><span class="domain-tag">${App.esc(t.domain)}</span></div>` : ''}
                </div>
                <div class="term-target" ondblclick="GlossaryView.startEdit(${t.id}, '${App.esc(t.target_term).replace(/'/g, "\\'")}')">
                    ${isEditing
                        ? `<input type="text" class="term-edit-input" id="edit-input-${t.id}" value="${App.esc(t.target_term)}"
                            onkeydown="if(event.key==='Enter')GlossaryView.saveEdit(${t.id});if(event.key==='Escape')GlossaryView.cancelEdit()"
                            onblur="GlossaryView.cancelEdit()">`
                        : `<div>${App.esc(t.target_term)}</div>
                           <div class="confidence-bar" style="margin-top:4px">
                               <div class="confidence-fill ${confClass}">
                                   <span style="width:${confidence}%"></span>
                               </div>
                               <span>${confidence.toFixed(0)}%</span>
                           </div>`
                    }
                </div>
                <div class="term-action">
                    ${t.is_approved
                        ? `<span class="status-badge ${statusClass}">${statusLabel}</span>`
                        : `<button class="approve-btn" onclick="GlossaryView.approve(${t.id})" title="Затвердити">✓</button>
                           <button class="reject-btn" onclick="GlossaryView.reject(${t.id})" title="Відхилити">✗</button>
                           <button class="edit-btn" onclick="GlossaryView.startEdit(${t.id}, '${App.esc(t.target_term).replace(/'/g, "\\'")}')">✎</button>`
                    }
                </div>
            </div>`;
    },

    startEdit(termId, currentValue) {
        this.editingTermId = termId;
        this.renderTerms();
        // Focus input after render
        setTimeout(() => {
            const input = document.getElementById('edit-input-' + termId);
            if (input) {
                input.focus();
                input.select();
            }
        }, 10);
    },

    cancelEdit() {
        // Delay to allow blur events from buttons to fire first
        setTimeout(() => {
            if (this.editingTermId) {
                this.editingTermId = null;
                this.renderTerms();
            }
        }, 100);
    },

    async saveEdit(termId) {
        const input = document.getElementById('edit-input-' + termId);
        if (!input) return;
        const newValue = input.value.trim();
        if (!newValue) {
            App.toast('Переклад не може бути порожнім', 'warning');
            return;
        }
        const term = this.allTerms.find(t => t.id === termId);
        if (!term || term.target_term === newValue) {
            this.cancelEdit();
            return;
        }

        try {
            const pid = App.currentProject.id;
            await API.updateTerm(pid, termId, { target_term: newValue });
            term.target_term = newValue;
            this.editingTermId = null;
            this.renderTerms();
            App.toast('Переклад оновлено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async approve(termId) {
        try {
            const pid = App.currentProject.id;
            await API.approveTerms(pid, [termId]);
            const term = this.allTerms.find(t => t.id === termId);
            if (term) term.is_approved = true;
            this.updateStats();
            this.renderTerms();
            App.toast('Термін затверджено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async reject(termId) {
        try {
            const pid = App.currentProject.id;
            await API.rejectTerms(pid, [termId]);
            this.allTerms = this.allTerms.filter(t => t.id !== termId);
            this.updateStats();
            this.renderTerms();
            App.toast('Термін відхилено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async bulkApprove(pid) {
        const pending = this.allTerms.filter(t => !t.is_approved);
        if (!pending.length) {
            App.toast('Немає термінів для затвердження', 'info');
            return;
        }
        App.modalConfirm(
            'Масове затвердження',
            `Затвердити ${pending.length} термінів?`,
            async () => {
                try {
                    await API.approveTerms(pid, pending.map(t => t.id));
                    pending.forEach(t => { t.is_approved = true; });
                    this.updateStats();
                    this.renderTerms();
                    App.toast(`Затверджено ${pending.length} термінів`, 'success');
                } catch (e) {
                    App.toast(e.message, 'error');
                }
            },
            'Затвердити',
            'Скасувати'
        );
    },

    async exportTSV(pid) {
        try {
            const data = await API.exportGlossary(pid, 'tsv');
            const blob = new Blob([data.content || ''], { type: 'text/tab-separated-values' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'glossary.tsv'; a.click();
            URL.revokeObjectURL(url);
            App.toast('Експорт завершено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async syncGlossary(pid) {
        try {
            await API.syncGlossary(pid);
            await this.loadTerms(pid);
            App.toast('Глосарій синхронізовано', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    // Batch selection methods
    toggleSelect(termId, checked) {
        if (checked) {
            this.selectedTermIds.add(termId);
        } else {
            this.selectedTermIds.delete(termId);
        }
        this.updateBatchActions();
        this.renderTerms();
    },

    toggleSelectAll(checked) {
        const list = document.getElementById('terms-list');
        if (!list) return;

        list.querySelectorAll('.term-checkbox').forEach(cb => {
            const termId = parseInt(cb.dataset.id);
            if (checked) {
                this.selectedTermIds.add(termId);
            } else {
                this.selectedTermIds.delete(termId);
            }
        });
        this.updateBatchActions();
        this.renderTerms();
    },

    selectAll() {
        this.allTerms.forEach(t => this.selectedTermIds.add(t.id));
        const selectAllCb = document.getElementById('select-all');
        if (selectAllCb) selectAllCb.checked = true;
        this.updateBatchActions();
        this.renderTerms();
    },

    deselectAll() {
        this.selectedTermIds.clear();
        const selectAllCb = document.getElementById('select-all');
        if (selectAllCb) selectAllCb.checked = false;
        this.updateBatchActions();
        this.renderTerms();
    },

    updateBatchActions() {
        const actions = document.getElementById('batch-actions');
        if (!actions) return;

        const count = this.selectedTermIds.size;

        if (count === 0) {
            actions.style.display = 'none';
            return;
        }

        actions.style.display = 'block';
        actions.innerHTML = `
            <div style="display:flex;gap:8px;align-items:center">
                <span style="font-weight:500">${count} обрано</span>
                <button class="btn btn-success btn-sm" onclick="GlossaryView.batchApproveSelected()">✓ Затвердити обрані</button>
                <button class="btn btn-danger btn-sm" onclick="GlossaryView.batchRejectSelected()">✗ Відхилити обрані</button>
                <button class="btn btn-secondary btn-sm" onclick="GlossaryView.deselectAll()">Скасувати вибір</button>
            </div>`;
    },

    async batchApproveSelected() {
        if (this.selectedTermIds.size === 0) return;

        const selectedTerms = this.allTerms.filter(t => this.selectedTermIds.has(t.id));
        const pendingTerms = selectedTerms.filter(t => !t.is_approved);

        if (pendingTerms.length === 0) {
            App.toast('Обрані терміни вже затверджені', 'info');
            return;
        }

        try {
            const pid = App.currentProject.id;
            await API.approveTerms(pid, pendingTerms.map(t => t.id));
            pendingTerms.forEach(t => { t.is_approved = true; });
            this.selectedTermIds.clear();
            this.updateStats();
            this.updateBatchActions();
            this.renderTerms();
            App.toast(`Затверджено ${pendingTerms.length} термінів`, 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async batchRejectSelected() {
        if (this.selectedTermIds.size === 0) return;

        App.modalConfirm(
            'Масове відхилення',
            `Видалити ${this.selectedTermIds.size} термінів? Цю дію не можна скасувати.`,
            async () => {
                try {
                    const pid = App.currentProject.id;
                    const termIds = Array.from(this.selectedTermIds);
                    await API.rejectTerms(pid, termIds);
                    this.allTerms = this.allTerms.filter(t => !this.selectedTermIds.has(t.id));
                    this.selectedTermIds.clear();
                    this.updateStats();
                    this.updateBatchActions();
                    this.renderTerms();
                    App.toast(`Відхилено ${termIds.length} термінів`, 'success');
                } catch (e) {
                    App.toast(e.message, 'error');
                }
            },
            'Видалити',
            'Скасувати'
        );
    },

    // Export menu
    toggleExportMenu(event) {
        event.stopPropagation();
        const menu = document.getElementById('export-menu');
        if (!menu) return;

        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';

        // Close menu when clicking outside
        if (menu.style.display === 'block') {
            const closeMenu = (e) => {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 0);
        }
    },

    async exportCSV(pid) {
        try {
            const data = await API.exportGlossary(pid, 'csv');
            const blob = new Blob([data.content || ''], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'glossary.csv'; a.click();
            URL.revokeObjectURL(url);
            App.toast('Експорт CSV завершено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async exportJSON(pid) {
        try {
            const data = await API.exportGlossary(pid, 'json');
            const blob = new Blob([JSON.stringify(data.terms || [], null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'glossary.json'; a.click();
            URL.revokeObjectURL(url);
            App.toast('Експорт JSON завершено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async exportXLSX(pid) {
        try {
            App.toast('Експорт XLSX... (може зайняти час)', 'info');
            const data = await API.exportGlossary(pid, 'xlsx');

            // Assuming backend returns base64-encoded XLSX
            if (data.content_base64) {
                const binary = atob(data.content_base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'glossary.xlsx'; a.click();
                URL.revokeObjectURL(url);
                App.toast('Експорт XLSX завершено', 'success');
            } else {
                throw new Error('XLSX export not yet implemented on server');
            }
        } catch (e) {
            App.toast(e.message, 'error');
        }
    }
};
