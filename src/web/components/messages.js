const MessagesView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">💬</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Повідомлення</h2>
            <div id="messages-list"><div class="loading">Завантаження...</div></div>`;
        this.loadMessages(project.id);
    },

    async loadMessages(pid) {
        const list = document.getElementById('messages-list');
        if (!list) return;
        try {
            const data = await API.getMessages(pid);
            const messages = data.messages || [];
            if (!messages.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Немає повідомлень</p></div>';
                return;
            }
            list.innerHTML = messages.map(m => `
                <div class="card" style="border-left:3px solid ${m.direction === 'client_to_admin' ? 'var(--btn)' : '#34c759'}">
                    <div class="card-sub">${m.direction === 'client_to_admin' ? '→ Відправлено' : '← Відповідь'} · ${this.time(m.created_at)}</div>
                    <div style="margin-top:4px;font-size:14px">${App.esc(m.content || '[медіа]')}</div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">${App.esc(e.message)}</p>`;
        }
    },

    time(ts) {
        if (!ts) return '';
        const d = new Date(ts * 1000);
        return d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    }
};
