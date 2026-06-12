const AuditView = {
    scope: 'project',

    async render(c, project) {
        const canGlobal = !!App.isAdmin;
        if (!project && !canGlobal) {
            c.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${Icons.wrap('clock', 48)}</div>
                    <p class="empty-state-title">Оберіть замовлення</p>
                    <p class="empty-state-text">Журнал доступний для кожного проєкту, до якого у вас є доступ.</p>
                    <button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До замовлень</button>
                </div>`;
            return;
        }

        if (!canGlobal || project) this.scope = 'project';
        if (canGlobal && !project) this.scope = 'global';

        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()" data-tooltip="До замовлень">${Icons.wrap('back', 16)}</button>
                <div>
                    <h2>${project ? App.esc(project.name) + ' — Журнал' : 'Глобальний журнал'}</h2>
                    <div class="section-subtitle">${canGlobal ? 'Дії користувачів, доступи, оплати та системні події' : 'Дії в межах цього замовлення'}</div>
                </div>
                <div class="section-actions">
                    <button class="btn btn-secondary btn-sm" onclick="AuditView.load(${project ? project.id : 'null'}, true)">
                        ${Icons.wrap('clock', 14)} Оновити
                    </button>
                </div>
            </div>
            ${canGlobal ? this.renderScopeTabs(!!project) : ''}
            <div id="audit-list"><div class="loading">Завантаження...</div></div>`;

        await this.load(project ? project.id : null);
    },

    renderScopeTabs(hasProject) {
        return `
            <div class="tabs audit-tabs">
                ${hasProject ? `<button class="tab ${this.scope === 'project' ? 'active' : ''}" onclick="AuditView.setScope('project')">Проєкт</button>` : ''}
                <button class="tab ${this.scope === 'global' ? 'active' : ''}" onclick="AuditView.setScope('global')">Усі події</button>
            </div>`;
    },

    async setScope(scope) {
        this.scope = scope;
        await this.render(document.getElementById('content'), App.currentProject);
    },

    async load(projectId, manual = false) {
        const list = document.getElementById('audit-list');
        if (!list) return;
        if (manual) list.innerHTML = '<div class="loading">Оновлення...</div>';

        try {
            const data = this.scope === 'global'
                ? await API.getAdminAudit()
                : await API.getProjectAudit(projectId);
            const rows = data.audit || [];
            if (!rows.length) {
                list.innerHTML = `
                    <div class="empty-state audit-empty">
                        <div class="empty-state-icon">${Icons.wrap('clock', 42)}</div>
                        <p class="empty-state-title">Подій ще немає</p>
                        <p class="empty-state-text">Нові дії зʼявляться тут одразу після виконання.</p>
                    </div>`;
                return;
            }
            list.innerHTML = `
                <div class="audit-list">
                    ${rows.map(row => this.renderRow(row)).join('')}
                </div>`;
        } catch (e) {
            list.innerHTML = `
                <div class="empty-state audit-empty">
                    <div class="empty-state-icon">${Icons.wrap('warning', 42)}</div>
                    <p class="empty-state-title">Не вдалося завантажити журнал</p>
                    <p class="empty-state-text">${App.esc(e.message)}</p>
                </div>`;
        }
    },

    renderRow(row) {
        const actor = row.username
            ? '@' + row.username
            : (row.user_name || ('ID ' + row.user_id));
        const details = row.details || '';
        return `
            <div class="audit-row">
                <div class="audit-icon">${Icons.wrap(this.actionIcon(row.action), 18)}</div>
                <div class="audit-main">
                    <div class="audit-title">
                        <strong>${App.esc(this.actionLabel(row.action))}</strong>
                        <span>${App.esc(actor)}</span>
                    </div>
                    <div class="audit-meta">
                        ${App.fmtDate(row.created_at)}
                        ${row.project_id ? ' · проєкт #' + row.project_id : ''}
                        ${row.resource_type ? ' · ' + App.esc(row.resource_type) : ''}
                        ${row.resource_id ? ' #' + row.resource_id : ''}
                    </div>
                    ${details ? `<div class="audit-details">${App.esc(details)}</div>` : ''}
                </div>
            </div>`;
    },

    actionIcon(action) {
        if (!action) return 'clock';
        if (action.includes('invoice') || action.includes('payment')) return 'pricing';
        if (action.includes('upload') || action.includes('file')) return 'files';
        if (action.includes('invite') || action.includes('member')) return 'team';
        if (action.includes('message')) return 'comment';
        if (action.includes('rate')) return 'warning';
        if (action.includes('glossary')) return 'glossary';
        if (action.includes('session') || action.includes('auth')) return 'admin';
        return 'clock';
    },

    actionLabel(action) {
        const map = {
            create_project: 'Створено замовлення',
            update_project: 'Оновлено замовлення',
            delete_project: 'Видалено замовлення',
            upload_file: 'Завантажено файл',
            delete_file: 'Видалено файл',
            download_file: 'Скачано файл',
            create_invoice: 'Створено рахунок',
            reuse_invoice: 'Повторно відкрито рахунок',
            create_invite: 'Створено запрошення',
            join_invite: 'Учасник приєднався',
            remove_member: 'Видалено учасника',
            send_message: 'Повідомлення адміну',
            advance_workflow: 'Змінено етап',
            create_session: 'Створено веб-сесію',
            rate_limited: 'Обмежено частоту дій',
        };
        return map[action] || String(action || 'Подія').replace(/_/g, ' ');
    },
};
