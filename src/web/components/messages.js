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
                    <div id="connection-status" style="font-size:11px;color:var(--hint);margin-top:2px"></div>
                </div>
                <div id="messages-list" class="chat-messages"><div class="loading">Завантаження...</div></div>
                <div id="typing-indicator" style="display:none">
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
                <div class="chat-input-area">
                    <input id="msg-input" class="input" placeholder="Напишіть повідомлення..." style="flex:1"
                        onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();MessagesView.send(${project.id})}">
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
            <div class="chat-bubble ${isOut ? 'chat-bubble-out' : 'chat-bubble-in'}" data-uuid="${App.esc(m.message_uuid || '')}">
                ${!isOut && name ? `<div class="chat-sender">${App.esc(name)}</div>` : ''}
                <div class="chat-text">${App.esc(m.content || '[медіа]')}</div>
                <div class="chat-time">${App.fmtDate(m.created_at)}${isOut ? readMark : ''}</div>
            </div>`;
    },

    connectSSE(pid) {
        this.disconnect();
        const status = document.getElementById('connection-status');
        if (status) status.textContent = '🟡 Підключення...';

        try {
            this.eventSource = API.connectMessageStream(pid,
                (data) => this.handleSSEMessage(data),
                () => this.handleSSEError()
            );
            setTimeout(() => {
                if (status && this.eventSource && this.eventSource.readyState === EventSource.OPEN) {
                    status.textContent = '🟢 Підключено';
                    setTimeout(() => { if (status) status.textContent = ''; }, 2000);
                }
            }, 500);
        } catch (e) {
            console.error('SSE connection failed:', e);
            if (status) status.textContent = '🔴 Помилка підключення';
        }
    },

    handleSSEMessage(data) {
        if (data.type === 'message' && data.message) {
            const m = data.message;
            if (m.message_uuid && this.seenUuids.has(m.message_uuid)) return;
            if (m.message_uuid) this.seenUuids.add(m.message_uuid);

            const list = document.getElementById('messages-list');
            if (!list) return;

            const empty = list.querySelector('.empty');
            if (empty) empty.remove();

            const div = document.createElement('div');
            div.innerHTML = this.renderBubble(m);
            list.appendChild(div.firstElementChild);
            list.scrollTop = list.scrollHeight;

            // Hide typing indicator if message arrived
            this.hideTyping();

            // Play subtle notification if from admin
            if (m.direction === 'from_admin' && typeof App.tg !== 'undefined' && App.tg.HapticFeedback) {
                App.tg.HapticFeedback.notificationOccurred('success');
            }
        } else if (data.type === 'typing') {
            this.showTyping();
        } else if (data.type === 'read_receipt') {
            // Update read markers
            const list = document.getElementById('messages-list');
            if (!list || !data.message_uuid) return;
            const bubble = list.querySelector(`[data-uuid="${data.message_uuid}"]`);
            if (bubble) {
                const timeEl = bubble.querySelector('.chat-time');
                if (timeEl && !timeEl.textContent.includes('✓✓')) {
                    timeEl.textContent = timeEl.textContent.replace(' ✓', ' ✓✓');
                }
            }
        }
    },

    handleSSEError() {
        const status = document.getElementById('connection-status');
        if (status) status.textContent = '🔴 Підключення втрачено';
        // Attempt reconnect after 3s
        setTimeout(() => {
            if (this.currentPid) this.connectSSE(this.currentPid);
        }, 3000);
    },

    showTyping() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.style.display = 'block';
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => this.hideTyping(), 3000);
        }
    },

    hideTyping() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.style.display = 'none';
        clearTimeout(this.typingTimeout);
    },

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        this.hideTyping();
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

            const list = document.getElementById('messages-list');
            if (list) {
                const empty = list.querySelector('.empty');
                if (empty) empty.remove();

                const div = document.createElement('div');
                div.innerHTML = this.renderBubble({
                    direction: 'to_admin',
                    content: content,
                    created_at: Math.floor(Date.now() / 1000),
                    message_uuid: result.uuid,
                    is_read: false
                });
                list.appendChild(div.firstElementChild);
                list.scrollTop = list.scrollHeight;
            }
        } catch (e) {
            App.toast(e.message, 'error');
            input.value = content;
        }
        input.disabled = false;
        input.focus();
    }
};
