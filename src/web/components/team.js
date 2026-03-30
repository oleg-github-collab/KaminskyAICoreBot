const TeamView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">👥</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Команда</h2>
            <div id="invite-section" style="margin-bottom:16px">
                <div class="label">Посилання для запрошення:</div>
                <div style="display:flex;gap:8px">
                    <input class="input" id="invite-link" readonly value="${App.esc(project.invite_link || '')}" style="font-size:13px">
                    <button class="btn btn-primary" style="width:auto;padding:8px 16px" onclick="TeamView.copyLink()">📋</button>
                </div>
            </div>
            <div id="team-list"><div class="loading">Завантаження...</div></div>`;
        this.loadTeam(project.id);
    },

    async loadTeam(pid) {
        const list = document.getElementById('team-list');
        if (!list) return;
        try {
            const data = await API.getTeam(pid);
            const members = data.members || [];
            if (!members.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Поки що тільки ви</p></div>';
                return;
            }
            list.innerHTML = members.map(m => `
                <div class="card">
                    <div class="card-title">${App.esc(m.first_name || '')} ${App.esc(m.last_name || '')}</div>
                    <div class="card-sub">@${App.esc(m.username || '---')} · ${App.esc(m.role)}</div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">${App.esc(e.message)}</p>`;
        }
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
