/**
 * Client Inbox System
 * Dedicated inbox for clients to receive translations, glossaries, and deliverables
 */

const InboxView = {
    async render(container, project) {
        if (!project) {
            container.innerHTML = '<div class="empty-state">Оберіть проєкт</div>';
            return;
        }

        const canView = RoleManager.can(PERMISSIONS.PROJECT_VIEW);
        if (!canView) {
            container.innerHTML = '<div class="error-state">У вас немає доступу до вхідних повідомлень</div>';
            return;
        }

        container.innerHTML = `
            <div class="inbox-container">
                <div class="inbox-header">
                    <h2>📥 Вхідні повідомлення</h2>
                    <div class="inbox-actions">
                        <button class="btn btn-sm" onclick="InboxView.refresh()">
                            🔄 Оновити
                        </button>
                        <button class="btn btn-sm btn-primary" onclick="InboxView.markAllRead()" data-require-permission="${PERMISSIONS.COMMENT_ADD}">
                            ✓ Позначити всі прочитаними
                        </button>
                    </div>
                </div>

                <div class="inbox-filters">
                    <div class="filter-tabs">
                        <button class="filter-tab active" data-filter="all" onclick="InboxView.setFilter('all')">
                            Усі <span class="badge" id="count-all">0</span>
                        </button>
                        <button class="filter-tab" data-filter="translations" onclick="InboxView.setFilter('translations')">
                            Переклади <span class="badge" id="count-translations">0</span>
                        </button>
                        <button class="filter-tab" data-filter="glossaries" onclick="InboxView.setFilter('glossaries')">
                            Глосарії <span class="badge" id="count-glossaries">0</span>
                        </button>
                        <button class="filter-tab" data-filter="deliverables" onclick="InboxView.setFilter('deliverables')">
                            Файли <span class="badge" id="count-deliverables">0</span>
                        </button>
                        <button class="filter-tab" data-filter="comments" onclick="InboxView.setFilter('comments')">
                            Коментарі <span class="badge" id="count-comments">0</span>
                        </button>
                    </div>

                    <div class="filter-actions">
                        <input type="text" id="inbox-search" class="search-input" placeholder="🔍 Пошук у вхідних...">
                        <select id="inbox-sort" class="sort-select" onchange="InboxView.refresh()">
                            <option value="newest">Найновіші</option>
                            <option value="oldest">Найстаріші</option>
                            <option value="unread">Непрочитані</option>
                            <option value="important">Важливі</option>
                        </select>
                    </div>
                </div>

                <div class="inbox-content">
                    <div id="inbox-list">
                        ${App.skeleton(5)}
                    </div>
                </div>
            </div>
        `;

        // Apply RBAC
        RoleManager.updateUI();

        // Load inbox items
        await this.loadItems(project.id);

        // Setup search
        document.getElementById('inbox-search').addEventListener('input', (e) => {
            this.filterItems(e.target.value);
        });
    },

    currentFilter: 'all',

    async loadItems(projectId) {
        try {
            const items = await API.getInboxItems(projectId);
            this.items = items || [];
            this.updateCounts();
            this.displayItems();
        } catch (err) {
            console.error('Failed to load inbox:', err);
            document.getElementById('inbox-list').innerHTML = `
                <div class="error-state">Не вдалося завантажити вхідні повідомлення</div>
            `;
        }
    },

    updateCounts() {
        const counts = {
            all: this.items.length,
            translations: this.items.filter(i => i.type === 'translation').length,
            glossaries: this.items.filter(i => i.type === 'glossary').length,
            deliverables: this.items.filter(i => i.type === 'file').length,
            comments: this.items.filter(i => i.type === 'comment').length
        };

        Object.entries(counts).forEach(([key, count]) => {
            const badge = document.getElementById(`count-${key}`);
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? '' : 'none';
            }
        });
    },

    displayItems() {
        const filtered = this.items.filter(item => {
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'translations') return item.type === 'translation';
            if (this.currentFilter === 'glossaries') return item.type === 'glossary';
            if (this.currentFilter === 'deliverables') return item.type === 'file';
            if (this.currentFilter === 'comments') return item.type === 'comment';
            return true;
        });

        const list = document.getElementById('inbox-list');

        if (filtered.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">Немає повідомлень</div>
                </div>
            `;
            return;
        }

        list.innerHTML = filtered.map(item => this.renderItem(item)).join('');
    },

    renderItem(item) {
        const icons = {
            translation: '🌐',
            glossary: '📋',
            file: '📄',
            comment: '💬',
            approval: '✅'
        };

        const icon = icons[item.type] || '📧';
        const unreadClass = item.is_read ? '' : 'inbox-item-unread';
        const importantClass = item.is_important ? 'inbox-item-important' : '';

        return `
            <div class="inbox-item ${unreadClass} ${importantClass}" data-id="${item.id}" onclick="InboxView.openItem(${item.id})">
                <div class="inbox-item-icon">${icon}</div>
                <div class="inbox-item-content">
                    <div class="inbox-item-header">
                        <div class="inbox-item-title">${App.esc(item.title)}</div>
                        <div class="inbox-item-meta">
                            <span class="inbox-item-date">${App.fmtDate(item.created_at)}</span>
                            ${item.is_important ? '<span class="important-badge">⭐ Важливо</span>' : ''}
                        </div>
                    </div>
                    <div class="inbox-item-preview">${App.esc(item.preview || item.description)}</div>
                    <div class="inbox-item-footer">
                        <span class="inbox-item-sender">від: ${App.esc(item.sender_name)}</span>
                        ${item.has_attachment ? '<span class="attachment-badge">📎 Вкладення</span>' : ''}
                    </div>
                </div>
                <div class="inbox-item-actions">
                    <button class="btn btn-icon btn-sm" onclick="event.stopPropagation(); InboxView.toggleRead(${item.id})" title="${item.is_read ? 'Позначити непрочитаним' : 'Позначити прочитаним'}">
                        ${item.is_read ? '📭' : '📬'}
                    </button>
                    <button class="btn btn-icon btn-sm" onclick="event.stopPropagation(); InboxView.toggleImportant(${item.id})" title="Важливо">
                        ${item.is_important ? '⭐' : '☆'}
                    </button>
                    <button class="btn btn-icon btn-sm" onclick="event.stopPropagation(); InboxView.deleteItem(${item.id})" title="Видалити">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    },

    setFilter(filter) {
        this.currentFilter = filter;

        // Update active tab
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.filter === filter);
        });

        this.displayItems();
    },

    filterItems(search) {
        if (!search) {
            this.displayItems();
            return;
        }

        const lower = search.toLowerCase();
        const filtered = this.items.filter(item => {
            return item.title.toLowerCase().includes(lower) ||
                   item.description.toLowerCase().includes(lower) ||
                   item.sender_name.toLowerCase().includes(lower);
        });

        const list = document.getElementById('inbox-list');
        list.innerHTML = filtered.map(item => this.renderItem(item)).join('');
    },

    async openItem(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;

        // Mark as read
        if (!item.is_read) {
            await this.toggleRead(itemId);
        }

        // Show item details in modal
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal modal-inbox-item">
                <div class="inbox-detail-header">
                    <div class="inbox-detail-icon">${this.getItemIcon(item.type)}</div>
                    <div class="inbox-detail-title">
                        <h3>${App.esc(item.title)}</h3>
                        <div class="inbox-detail-meta">
                            від ${App.esc(item.sender_name)} • ${App.fmtDate(item.created_at)}
                        </div>
                    </div>
                    <button class="btn btn-icon" onclick="this.closest('.modal-overlay').remove()">✕</button>
                </div>

                <div class="inbox-detail-content">
                    ${item.content ? `<div class="inbox-detail-body">${App.esc(item.content)}</div>` : ''}

                    ${item.attachment_url ? `
                        <div class="inbox-detail-attachment">
                            <h4>📎 Вкладення</h4>
                            <a href="${item.attachment_url}" class="attachment-link" download>
                                <span class="attachment-icon">📄</span>
                                <span class="attachment-name">${App.esc(item.attachment_name)}</span>
                                <span class="attachment-size">${App.fmtSize(item.attachment_size)}</span>
                            </a>
                        </div>
                    ` : ''}

                    ${item.type === 'glossary' ? `
                        <div class="inbox-detail-actions">
                            <button class="btn btn-primary" onclick="InboxView.openGlossary(${item.resource_id})">
                                📋 Переглянути глосарій
                            </button>
                            <button class="btn" onclick="InboxView.downloadGlossary(${item.resource_id})">
                                📥 Завантажити
                            </button>
                        </div>
                    ` : ''}

                    ${item.type === 'file' ? `
                        <div class="inbox-detail-actions">
                            <button class="btn btn-primary" onclick="InboxView.downloadFile(${item.resource_id})">
                                📥 Завантажити файл
                            </button>
                            <button class="btn" onclick="InboxView.previewFile(${item.resource_id})">
                                👁️ Попередній перегляд
                            </button>
                        </div>
                    ` : ''}
                </div>

                <div class="inbox-detail-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                        Закрити
                    </button>
                    <button class="btn btn-primary" onclick="InboxView.reply(${item.id})">
                        💬 Відповісти
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    getItemIcon(type) {
        const icons = {
            translation: '🌐',
            glossary: '📋',
            file: '📄',
            comment: '💬',
            approval: '✅'
        };
        return icons[type] || '📧';
    },

    async toggleRead(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;

        try {
            await API.updateInboxItem(itemId, { is_read: !item.is_read });
            item.is_read = !item.is_read;
            this.displayItems();
            this.updateCounts();
        } catch (err) {
            console.error('Failed to update item:', err);
            App.toast('Не вдалося оновити статус', 'error');
        }
    },

    async toggleImportant(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return;

        try {
            await API.updateInboxItem(itemId, { is_important: !item.is_important });
            item.is_important = !item.is_important;
            this.displayItems();
        } catch (err) {
            console.error('Failed to update item:', err);
            App.toast('Не вдалося оновити статус', 'error');
        }
    },

    async deleteItem(itemId) {
        const confirmed = await new Promise(resolve => {
            App.modalConfirm(
                'Видалити повідомлення?',
                'Ця дія не може бути скасована.',
                () => resolve(true),
                'Видалити',
                'Скасувати'
            );
        });

        if (!confirmed) return;

        try {
            await API.deleteInboxItem(itemId);
            this.items = this.items.filter(i => i.id !== itemId);
            this.displayItems();
            this.updateCounts();
            App.toast('✓ Повідомлення видалено', 'success');
        } catch (err) {
            console.error('Failed to delete item:', err);
            App.toast('Не вдалося видалити повідомлення', 'error');
        }
    },

    async markAllRead() {
        try {
            await API.markAllInboxRead(App.currentProject.id);
            this.items.forEach(item => item.is_read = true);
            this.displayItems();
            this.updateCounts();
            App.toast('✓ Усі повідомлення позначено прочитаними', 'success');
        } catch (err) {
            console.error('Failed to mark all read:', err);
            App.toast('Не вдалося оновити статус', 'error');
        }
    },

    refresh() {
        if (App.currentProject) {
            this.loadItems(App.currentProject.id);
        }
    },

    reply(itemId) {
        // TODO: Implement reply functionality
        App.toast('Функція відповіді в розробці', 'info');
    },

    openGlossary(glossaryId) {
        App.navigate('glossary');
    },

    downloadGlossary(glossaryId) {
        GlossaryView.exportTSV(App.currentProject.id);
    },

    downloadFile(fileId) {
        window.open(`/api/files/${fileId}/download`, '_blank');
    },

    previewFile(fileId) {
        // Use file preview from file-stats
        FileStatsInstance.showModal({ id: fileId });
    }
};

// Add CSS
const style = document.createElement('style');
style.textContent = `
    .inbox-container {
        max-width: 1200px;
        margin: 0 auto;
    }

    .inbox-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
    }

    .inbox-actions {
        display: flex;
        gap: 8px;
    }

    .inbox-filters {
        background: var(--bg-secondary);
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
    }

    .filter-tabs {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        flex-wrap: wrap;
    }

    .filter-tab {
        padding: 8px 16px;
        border: 1px solid var(--border);
        background: var(--bg);
        border-radius: 6px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .filter-tab:hover {
        background: var(--bg-hover);
    }

    .filter-tab.active {
        background: var(--primary);
        color: white;
        border-color: var(--primary);
    }

    .filter-tab .badge {
        display: inline-block;
        margin-left: 6px;
        padding: 2px 6px;
        background: var(--bg-secondary);
        border-radius: 10px;
        font-size: 11px;
        font-weight: 600;
    }

    .filter-tab.active .badge {
        background: rgba(255,255,255,0.3);
        color: white;
    }

    .filter-actions {
        display: flex;
        gap: 12px;
    }

    .search-input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 6px;
        font-size: 14px;
    }

    .sort-select {
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 6px;
        font-size: 14px;
        background: var(--bg);
    }

    .inbox-item {
        display: flex;
        gap: 16px;
        padding: 16px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        margin-bottom: 12px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .inbox-item:hover {
        background: var(--bg-hover);
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        transform: translateY(-1px);
    }

    .inbox-item-unread {
        border-left: 4px solid var(--primary);
        background: var(--primary-light);
    }

    .inbox-item-important {
        border-left-color: #ffd700;
    }

    .inbox-item-icon {
        font-size: 32px;
        flex-shrink: 0;
    }

    .inbox-item-content {
        flex: 1;
        min-width: 0;
    }

    .inbox-item-header {
        display: flex;
        justify-content: space-between;
        align-items: start;
        margin-bottom: 8px;
    }

    .inbox-item-title {
        font-weight: 600;
        font-size: 16px;
    }

    .inbox-item-meta {
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 12px;
        color: var(--text-secondary);
        white-space: nowrap;
    }

    .important-badge {
        background: #ffd700;
        color: #000;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
    }

    .inbox-item-preview {
        color: var(--text-secondary);
        font-size: 14px;
        margin-bottom: 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .inbox-item-footer {
        display: flex;
        gap: 12px;
        font-size: 12px;
        color: var(--text-secondary);
    }

    .attachment-badge {
        background: var(--bg-secondary);
        padding: 2px 6px;
        border-radius: 4px;
    }

    .inbox-item-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }

    .modal-inbox-item {
        max-width: 700px;
        max-height: 90vh;
        overflow-y: auto;
    }

    .inbox-detail-header {
        display: flex;
        gap: 16px;
        align-items: start;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 20px;
    }

    .inbox-detail-icon {
        font-size: 48px;
    }

    .inbox-detail-title {
        flex: 1;
    }

    .inbox-detail-title h3 {
        margin: 0 0 8px 0;
    }

    .inbox-detail-meta {
        font-size: 14px;
        color: var(--text-secondary);
    }

    .inbox-detail-content {
        margin-bottom: 20px;
    }

    .inbox-detail-body {
        white-space: pre-wrap;
        line-height: 1.6;
        margin-bottom: 20px;
    }

    .inbox-detail-attachment {
        background: var(--bg-secondary);
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
    }

    .inbox-detail-attachment h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
    }

    .attachment-link {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        text-decoration: none;
        color: var(--text);
        transition: all 0.2s;
    }

    .attachment-link:hover {
        background: var(--bg-hover);
        transform: translateY(-1px);
    }

    .attachment-icon {
        font-size: 24px;
    }

    .attachment-name {
        flex: 1;
        font-weight: 500;
    }

    .attachment-size {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .inbox-detail-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 20px;
    }

    .inbox-detail-footer {
        display: flex;
        justify-content: space-between;
        padding-top: 16px;
        border-top: 1px solid var(--border);
    }
`;
document.head.appendChild(style);
