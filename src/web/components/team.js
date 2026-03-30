const TeamView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">👥</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <button class="btn" style="padding:6px 12px;width:auto" onclick="App.backToProjects()">\u2190</button>
                <h2 style="font-size:16px;margin:0;flex:1">${App.esc(project.name)} \u2014 Команда</h2>
            </div>
            <div class="card" style="margin-bottom:12px">
                <div class="card-title" style="margin-bottom:8px">Запросити учасника</div>
                <div id="invite-area">
                    <button class="btn btn-primary" onclick="TeamView.generateLink(${project.id})">Отримати посилання</button>
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
                <div style="display:flex;gap:8px">
                    <input class="input" id="invite-link" readonly value="${App.esc(link)}" style="font-size:13px;flex:1">
                    <button class="btn btn-primary" style="width:auto;padding:8px 16px" onclick="TeamView.copyLink()">Копіювати</button>
                </div>
                <div style="font-size:12px;color:var(--hint);margin-top:6px">Надішліть це посилання учаснику. Він натисне «Start» у боті і приєднається до проєкту.</div>`;
        } catch (e) { App.alert(e.message); }
    },

    async loadTeam(pid) {
        const list = document.getElementById('team-list');
        if (!list) return;
        try {
            const data = await API.getTeam(pid);
            const members = data.members || [];
            if (!members.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Поки що тільки ви</p><p style="font-size:13px;color:var(--hint)">Запросіть учасників за посиланням вище</p></div>';
                return;
            }
            list.innerHTML = '<div class="card-title" style="margin-bottom:8px">Учасники (' + members.length + ')</div>' +
                members.map(m => `
                <div class="file-item">
                    <div class="file-icon">${m.role === 'owner' ? '\u{1f451}' : '\u{1f464}'}</div>
                    <div class="file-info" style="flex:1">
                        <div class="file-name">${App.esc(m.first_name || '')} ${App.esc(m.last_name || '')}</div>
                        <div class="file-meta">
                            ${m.username ? '@' + App.esc(m.username) + ' \u00b7 ' : ''}${this.roleName(m.role)}${m.joined_at ? ' \u00b7 ' + App.fmtDate(m.joined_at) : ''}
                        </div>
                    </div>
                    ${m.role !== 'owner' ? '<button class="btn" style="width:auto;padding:4px 10px;font-size:12px;color:#ff3b30" onclick="TeamView.removeMember(' + pid + ',' + m.id + ',\'' + App.esc(m.first_name || 'учасника') + '\')">\u2715</button>' : '<span class="card-badge" style="font-size:11px">Власник</span>'}
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">${App.esc(e.message)}</p>`;
        }
    },

    async removeMember(pid, mid, name) {
        App.confirm('Видалити ' + name + ' з проєкту?', async (ok) => {
            if (!ok) return;
            try {
                await API.removeMember(pid, mid);
                this.loadTeam(pid);
            } catch (e) { App.alert(e.message); }
        });
    },

    roleName(role) {
        return { owner: 'Власник', member: 'Учасник', admin: 'Адмін' }[role] || role;
    },

    copyLink() {
        const input = document.getElementById('invite-link');
        if (input) {
            navigator.clipboard.writeText(input.value).then(() => {
                App.alert('Посилання скопійовано!');
            });
        }
    }
};
