const TeamView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">${Icons.wrap('team', 48)}</div>
                    <p class="empty-state-title">Оберіть замовлення</p>
                    <p class="empty-state-text">Команда доступна всередині конкретного проєкту.</p>
                    <button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До замовлень</button>
                </div>`;
            return;
        }
        const canManage = project.role === 'owner' || App.isAdmin;
        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()" data-tooltip="До замовлень">${Icons.wrap('back', 16)}</button>
                <div>
                    <h2>${App.esc(project.name)} — Команда</h2>
                    <div class="section-subtitle">Спільна робота без доступу до чужих проєктів</div>
                </div>
            </div>
            <div class="invite-card">
                <div class="invite-card-head">
                    <div class="invite-card-icon">${Icons.wrap('link', 20)}</div>
                    <div>
                        <div class="card-title">Запросити учасника</div>
                        <div class="card-sub">Посилання додає людину саме до цього проєкту.</div>
                    </div>
                </div>
                <div id="invite-area">
                    ${canManage
                        ? `<button class="btn btn-primary invite-create-btn" onclick="TeamView.generateLink(${project.id})">${Icons.wrap('link', 16)} Отримати посилання</button>`
                        : '<div class="invite-hint">Посилання може створити власник замовлення.</div>'}
                </div>
            </div>
            <div id="team-list"><div class="loading">Завантаження...</div></div>`;
        this.loadTeam(project.id);
    },

    async generateLink(pid) {
        const area = document.getElementById('invite-area');
        if (!area) return;
        try {
            const data = await API.createInvite(pid);
            const link = data.invite_link || '';
            area.innerHTML = `
                <div class="invite-link-row">
                    <input class="input" id="invite-link" readonly value="${App.esc(link)}">
                    <button class="btn btn-primary btn-sm invite-copy-btn" onclick="TeamView.copyLink()">
                        ${Icons.wrap('copy', 14)} Копіювати
                    </button>
                </div>
                <div class="invite-hint">Надішліть посилання учаснику. Після Start у боті він приєднається до проєкту.</div>`;
        } catch (e) { App.toast(e.message, 'error'); }
    },

    async loadTeam(pid) {
        const list = document.getElementById('team-list');
        if (!list) return;
        try {
            const data = await API.getTeam(pid);
            const members = data.members || [];
            if (!members.length) {
                list.innerHTML = `
                    <div class="empty-state team-empty">
                        <div class="empty-state-icon">${Icons.wrap('team', 42)}</div>
                        <p class="empty-state-title">Поки що тільки ви</p>
                        <p class="empty-state-text">Запросіть учасників за посиланням вище.</p>
                    </div>`;
                return;
            }
            list.innerHTML = `
                <div class="team-list-head">
                    <span>${members.length} учасник${members.length === 1 ? '' : 'ів'}</span>
                    <span>${(App.currentProject?.role === 'owner' || App.isAdmin) ? 'Керування доступом' : 'Перегляд складу'}</span>
                </div>
                <div class="member-list">
                    ${members.map(m => this.renderMember(pid, m)).join('')}
                </div>`;
        } catch (e) {
            list.innerHTML = `
                <div class="empty-state team-empty">
                    <div class="empty-state-icon">${Icons.wrap('warning', 42)}</div>
                    <p class="empty-state-title">Не вдалося завантажити команду</p>
                    <p class="empty-state-text">${App.esc(e.message)}</p>
                </div>`;
        }
    },

    renderMember(pid, m) {
        const canRemove = (App.currentProject?.role === 'owner' || App.isAdmin) && m.role !== 'owner';
        const fullName = `${m.first_name || ''} ${m.last_name || ''}`.trim() || (m.username ? '@' + m.username : 'Користувач');
        const safeName = this.inlineArg(fullName);
        const initials = this.initials(m, fullName);
        return `
                <div class="member-item">
                    <div class="member-avatar ${m.role === 'owner' ? 'owner' : ''}">${m.role === 'owner' ? Icons.wrap('admin', 18) : App.esc(initials)}</div>
                    <div class="member-info">
                        <div class="member-name">${App.esc(fullName)}</div>
                        <div class="member-meta">
                            ${m.username ? '@' + App.esc(m.username) + ' · ' : ''}${this.roleName(m.role)}${m.joined_at ? ' · ' + App.fmtDate(m.joined_at) : ''}
                        </div>
                    </div>
                    ${canRemove
                        ? `<button class="btn btn-icon btn-sm member-remove-btn" onclick="TeamView.removeMember(${pid},${m.id},'${safeName}')" data-tooltip="Видалити">${Icons.wrap('trash', 15)}</button>`
                        : `<span class="role-badge ${m.role === 'owner' ? 'owner' : ''}">${m.role === 'owner' ? 'Власник' : 'Учасник'}</span>`}
                </div>`;
    },

    async removeMember(pid, mid, name) {
        App.confirm('Видалити ' + name + ' з проєкту?', async (ok) => {
            if (!ok) return;
            try {
                await API.removeMember(pid, mid);
                this.loadTeam(pid);
                App.toast('Учасника видалено', 'success');
            } catch (e) { App.toast(e.message, 'error'); }
        });
    },

    roleName(role) {
        return { owner: 'Власник', member: 'Учасник', admin: 'Адмін' }[role] || role;
    },

    initials(member, fallback) {
        const first = (member.first_name || '').trim();
        const last = (member.last_name || '').trim();
        const value = (first[0] || '') + (last[0] || '');
        if (value) return value.toUpperCase();
        return String(fallback || 'U').slice(0, 2).toUpperCase();
    },

    inlineArg(value) {
        return App.esc(String(value || 'учасника'))
            .replace(/\\/g, '\\\\')
            .replace(/\r?\n/g, ' ')
            .replace(/'/g, "\\'");
    },

    copyLink() {
        const input = document.getElementById('invite-link');
        if (input) {
            const copy = navigator.clipboard
                ? navigator.clipboard.writeText(input.value)
                : Promise.reject(new Error('Clipboard unavailable'));
            copy.then(() => {
                App.toast('Посилання скопійовано', 'success');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                App.toast('Посилання скопійовано', 'success');
            });
        }
    }
};
