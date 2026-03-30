const MessagesView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">💬</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <button class="btn" style="padding:6px 12px;width:auto" onclick="App.backToProjects()">\u2190</button>
                <h2 style="font-size:16px;margin:0;flex:1">${App.esc(project.name)} \u2014 Повідомлення</h2>
            </div>
            <div id="messages-list"><div class="loading">Завантаження...</div></div>
            <div style="margin-top:12px;padding:12px;background:var(--card);border-radius:12px;font-size:13px;color:var(--hint);text-align:center">
                Надсилайте повідомлення через Telegram-бот. Тут відображається історія листування по проєкту.
            </div>`;
        this.loadMessages(project.id);
    },

    async loadMessages(pid) {
        const list = document.getElementById('messages-list');
        if (!list) return;
        try {
            const data = await API.getMessages(pid);
            const messages = data.messages || [];
            if (!messages.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Немає повідомлень</p><p style="font-size:13px;color:var(--hint)">Напишіть повідомлення у боті \u2014 воно з\u2019явиться тут</p></div>';
                return;
            }
            list.innerHTML = messages.map(m => {
                const isOut = m.direction === 'client_to_admin';
                return `
                <div style="display:flex;${isOut ? 'justify-content:flex-end' : 'justify-content:flex-start'};margin-bottom:6px">
                    <div style="max-width:85%;padding:8px 12px;border-radius:12px;font-size:14px;background:${isOut ? 'var(--btn)' : 'var(--card)'};color:${isOut ? '#fff' : 'var(--text)'}">
                        <div>${App.esc(m.content || '[медіа]')}</div>
                        <div style="font-size:11px;margin-top:4px;opacity:0.7;text-align:right">${App.fmtDate(m.created_at)}</div>
                    </div>
                </div>`;
            }).join('');
            list.scrollTop = list.scrollHeight;
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">${App.esc(e.message)}</p>`;
        }
    }
};
