const MessagesView = {
    eventSource: null,
    currentPid: null,
    seenUuids: new Set(),

    async render(c, project) {
        this.disconnect();
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">💬</div><p>Оберіть проєкт</p></div>';
            return;
        }
        this.currentPid = project.id;
        c.innerHTML = `
            <div class="chat-container">
                <div class="chat-header">
                    <h2 style="font-size:16px;margin:0">${App.esc(project.name)} — Чат</h2>
                </div>
                <div id="messages-list" class="chat-messages"><div class="loading">Завантаження...</div></div>
                <div class="chat-input-area">
                    <input id="msg-input" class="input" placeholder="Напишіть повідомлення..." style="flex:1"
                        onkeydown="if(event.key==='Enter')MessagesView.send(${project.id})">
                    <button class="btn btn-primary" style="width:auto;padding:8px 16px" onclick="MessagesView.send(${project.id})">➤</button>
                </div>
            </div>`;
        await this.loadMessages(project.id);
        this.connectSSE(project.id);
    },

    async loadMessages(pid) {
        const list = document.getElementById('messages-list');
        if (!list) return;
        try {
            const data = await API.getMessages(pid);
            const messages = data.messages || [];
            if (!messages.length) {
                list.innerHTML = '<div class="empty" style="padding:20px"><p>Немає повідомлень</p><p style="font-size:13px;color:var(--hint)">Напишіть перше повідомлення</p></div>';
                return;
            }
            list.innerHTML = messages.map(m => this.renderBubble(m)).join('');
            messages.forEach(m => { if (m.message_uuid) this.seenUuids.add(m.message_uuid); });
            list.scrollTop = list.scrollHeight;
        } catch (e) {
            list.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    renderBubble(m) {
        const isOut = m.direction === 'to_admin' || m.direction === 'client_to_admin';
        const name = m.sender_name || '';
        const readMark = m.is_read ? ' ✓✓' : ' ✓';
        return `
            <div class="chat-bubble ${isOut ? 'chat-bubble-out' : 'chat-bubble-in'}">
                ${!isOut && name ? `<div class="chat-sender">${App.esc(name)}</div>` : ''}
                <div class="chat-text">${App.esc(m.content || '[медіа]')}</div>
                <div class="chat-time">${App.fmtDate(m.created_at)}${isOut ? readMark : ''}</div>
            </div>`;
    },

    connectSSE(pid) {
        this.disconnect();
        const url = `/api/projects/${pid}/messages/stream`;
        // SSE with auth via query or polling
        this.pollInterval = setInterval(() => this.pollNewEvents(pid), 3000);
    },

    async pollNewEvents(pid) {
        if (this.currentPid !== pid) return;
        try {
            const data = await API.getMessages(pid);
            const messages = data.messages || [];
            const list = document.getElementById('messages-list');
            if (!list) return;

            let hasNew = false;
            messages.forEach(m => {
                if (m.message_uuid && !this.seenUuids.has(m.message_uuid)) {
                    this.seenUuids.add(m.message_uuid);
                    hasNew = true;
                }
            });
            if (hasNew) {
                list.innerHTML = messages.map(m => this.renderBubble(m)).join('');
                list.scrollTop = list.scrollHeight;
            }
        } catch (e) { /* silent */ }
    },

    disconnect() {
        if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
        if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
        this.seenUuids.clear();
        this.currentPid = null;
    },

    async send(pid) {
        const input = document.getElementById('msg-input');
        if (!input) return;
        const content = input.value.trim();
        if (!content) return;
        input.value = '';
        input.disabled = true;

        try {
            const result = await API.sendMessage(pid, content);
            if (result.uuid) this.seenUuids.add(result.uuid);

            // Append immediately
            const list = document.getElementById('messages-list');
            if (list) {
                // Remove empty state
                const empty = list.querySelector('.empty');
                if (empty) empty.remove();

                const div = document.createElement('div');
                div.innerHTML = this.renderBubble({
                    direction: 'to_admin',
                    content: content,
                    created_at: Math.floor(Date.now() / 1000),
                    message_uuid: result.uuid,
                });
                list.appendChild(div.firstElementChild);
                list.scrollTop = list.scrollHeight;
            }
        } catch (e) {
            App.alert(e.message);
            input.value = content;
        }
        input.disabled = false;
        input.focus();
    }
};
