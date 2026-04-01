const TeamView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">\ud83d\udc65</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()">\u2190</button>
                <h2>${App.esc(project.name)} \u2014 Команда</h2>
            </div>
            <div class="invite-card">
                <div class="card-title" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                    <span>\ud83d\udd17</span> Запросити учасника
                </div>
                <div id="invite-area">
                    <button class="btn btn-primary" onclick="TeamView.generateLink(${project.id})">\ud83d\udd17 Отримати посилання</button>
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
                    <button class="btn btn-primary btn-sm" style="white-space:nowrap" onclick="TeamView.copyLink()">Копіювати</button>
                </div>
                <div class="invite-hint">Надішліть це посилання учаснику. Він натисне \u00abStart\u00bb у боті і приєднається до проєкту.</div>`;
        } catch (e) { App.toast(e.message, 'error'); }
    },

    async loadTeam(pid) {
        const list = document.getElementById('team-list');
        if (!list) return;
        try {
            const data = await API.getTeam(pid);
            const members = data.members || [];
            if (!members.length) {
                list.innerHTML = '<div class="empty" style="padding:24px"><div class="empty-icon">\ud83d\udc64</div><p>Поки що тільки ви</p><p style="font-size:13px;color:var(--hint);margin-top:4px">Запросіть учасників за посиланням вище</p></div>';
                return;
            }
            list.innerHTML = `<div style="font-size:13px;font-weight:600;color:var(--hint);margin-bottom:8px">${members.length} учасник${members.length === 1 ? '' : 'ів'}</div>` +
                members.map(m => `
                <div class="member-item">
                    <div class="member-avatar">${m.role === 'owner' ? '\ud83d\udc51' : '\ud83d\udc64'}</div>
                    <div class="member-info">
                        <div class="member-name">${App.esc(m.first_name || '')} ${App.esc(m.last_name || '')}</div>
                        <div class="member-meta">
                            ${m.username ? '@' + App.esc(m.username) + ' \u00b7 ' : ''}${this.roleName(m.role)}${m.joined_at ? ' \u00b7 ' + App.fmtDate(m.joined_at) : ''}
                        </div>
                    </div>
                    ${m.role !== 'owner'
                        ? `<button class="btn btn-icon btn-sm" style="color:var(--red);background:var(--red-bg)" onclick="TeamView.removeMember(${pid},${m.id},'${App.esc(m.first_name || 'учасника').replace(/'/g, "\\'")}')" data-tooltip="Видалити">\u2715</button>`
                        : '<span class="card-badge">Власник</span>'}
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint);padding:12px">Помилка: ${App.esc(e.message)}</p>`;
        }
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

    copyLink() {
        const input = document.getElementById('invite-link');
        if (input) {
            navigator.clipboard.writeText(input.value).then(() => {
                App.toast('Посилання скопійовано', 'success');
            });
        }
    }
};
