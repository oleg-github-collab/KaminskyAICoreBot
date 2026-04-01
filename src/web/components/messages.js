const MessagesView = {
    ws: null,
    currentPid: null,
    seenUuids: new Set(),
    quill: null,
    reconnectTimer: null,
    reconnectAttempts: 0,

    async render(c, project) {
        this.disconnect();
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">\ud83d\udcac</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        this.currentPid = project.id;
        c.innerHTML = `
            <div class="chat-container">
                <div class="chat-header" style="display:flex;align-items:center;gap:10px">
                    <button style="width:32px;height:32px;border-radius:8px;border:1px solid var(--border);background:var(--bg);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center" onclick="App.backToProjects()">\u2190</button>
                    <div style="flex:1">
                        <h2 style="font-size:15px;margin:0;font-weight:600">${App.esc(project.name)}</h2>
                        <div id="connection-status" style="font-size:11px;color:var(--hint)">\ud83d\udfe1 Підключення...</div>
                    </div>
                </div>
                <div id="messages-list" class="chat-messages"><div class="loading">Завантаження...</div></div>
                <div id="typing-indicator" style="display:none">
                    <div class="typing-indicator">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
                <div class="chat-input-area" style="flex-direction:column;align-items:stretch">
                    <div id="quill-editor" style="min-height:60px;background:var(--bg2);border-radius:8px;margin-bottom:8px"></div>
                    <button class="btn btn-primary btn-send" id="send-btn" onclick="MessagesView.send(${project.id})">
                        <span class="btn-text">Надіслати</span>
                        <span class="btn-spinner" style="display:none">
                            <span class="spinner"></span>
                        </span>
                    </button>
                </div>
            </div>`;
        await this.loadMessages(project.id);
        this.connectWebSocket(project.id);
        this.initQuill();
    },

    initQuill() {
        const editor = document.getElementById('quill-editor');
        if (!editor || !window.Quill) return;

        this.quill = new Quill('#quill-editor', {
            theme: 'snow',
            placeholder: 'Напишіть повідомлення...',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    ['link']
                ]
            }
        });

        this.quill.root.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (this.currentPid) this.send(this.currentPid);
            }
        });
    },

    async loadMessages(pid) {
        const list = document.getElementById('messages-list');
        if (!list) return;
        try {
            const data = await API.getMessages(pid);
            const messages = data.messages || [];
            if (!messages.length) {
                list.innerHTML = '<div class="empty" style="padding:24px"><div class="empty-icon">\u2709\ufe0f</div><p>Немає повідомлень</p><p style="font-size:13px;color:var(--hint);margin-top:4px">Напишіть спеціалісту перше повідомлення</p></div>';
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

        let contentHtml = '';
        if (m.content_format === 'html') {
            contentHtml = m.content || '[медіа]';
        } else {
            contentHtml = App.esc(m.content || '[медіа]');
        }

        return `
            <div class="chat-bubble ${isOut ? 'chat-bubble-out' : 'chat-bubble-in'}" data-uuid="${App.esc(m.message_uuid || '')}">
                ${!isOut && name ? `<div class="chat-sender">${App.esc(name)}</div>` : ''}
                <div class="chat-text">${contentHtml}</div>
                <div class="chat-time">${App.fmtDate(m.created_at)}${isOut ? readMark : ''}</div>
            </div>`;
    },

    setStatus(text) {
        const el = document.getElementById('connection-status');
        if (el) el.textContent = text;
    },

    connectWebSocket(pid) {
        this.disconnectWs();
        this.reconnectAttempts = 0;
        this.setStatus('🟡 Підключення...');
        this._connect(pid);
    },

    _connect(pid) {
        try {
            this.ws = API.connectMessageStream(pid, {
                onOpen: () => {
                    this.reconnectAttempts = 0;
                    this.setStatus('🟢 Підключено');
                    setTimeout(() => this.setStatus(''), 3000);
                },
                onMessage: (data) => this.handleMessage(data),
                onClose: (event) => {
                    this.ws = null;
                    // Don't reconnect if we intentionally disconnected
                    if (!this.currentPid || this.currentPid !== pid) return;
                    this.reconnectAttempts++;
                    const delay = Math.min(3000 * this.reconnectAttempts, 30000);
                    this.setStatus('🔴 Відключено. Перепідключення...');
                    this.reconnectTimer = setTimeout(() => this._connect(pid), delay);
                }
            });
        } catch (e) {
            console.error('WS connection failed:', e);
            this.setStatus('🔴 Помилка підключення');
            // Retry after delay
            this.reconnectTimer = setTimeout(() => this._connect(pid), 5000);
        }
    },

    handleMessage(data) {
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

            this.hideTyping();

            if (m.direction === 'from_admin' && App.tg && App.tg.HapticFeedback) {
                App.tg.HapticFeedback.notificationOccurred('success');
            }
        } else if (data.type === 'typing') {
            this.showTyping();
        } else if (data.type === 'read_receipt') {
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

    disconnectWs() {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        if (this.ws) {
            this.ws.onclose = null; // prevent reconnect on intentional close
            this.ws.close();
            this.ws = null;
        }
    },

    disconnect() {
        this.disconnectWs();
        this.hideTyping();
        this.seenUuids.clear();
        this.currentPid = null;
    },

    async send(pid) {
        if (!this.quill) return;

        const btn = document.getElementById('send-btn');
        const btnText = btn ? btn.querySelector('.btn-text') : null;
        const btnSpinner = btn ? btn.querySelector('.btn-spinner') : null;

        const html = this.quill.root.innerHTML;
        const text = this.quill.getText().trim();

        if (!text) {
            App.toast('Повідомлення не може бути порожнім', 'warning');
            return;
        }

        // Show loading state
        if (btn) btn.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (btnSpinner) btnSpinner.style.display = 'inline-block';

        const oldHtml = html;
        this.quill.setText('');
        this.quill.enable(false);

        try {
            const result = await API.sendMessage(pid, html);
            if (result.uuid) this.seenUuids.add(result.uuid);

            const list = document.getElementById('messages-list');
            if (list) {
                const empty = list.querySelector('.empty');
                if (empty) empty.remove();

                const div = document.createElement('div');
                div.innerHTML = this.renderBubble({
                    direction: 'to_admin',
                    content: html,
                    content_format: 'html',
                    created_at: Math.floor(Date.now() / 1000),
                    message_uuid: result.uuid,
                    is_read: false
                });
                list.appendChild(div.firstElementChild);
                list.scrollTop = list.scrollHeight;
            }

            if (App.tg && App.tg.HapticFeedback) {
                App.tg.HapticFeedback.notificationOccurred('success');
            }
        } catch (e) {
            App.toast(e.message, 'error');
            this.quill.root.innerHTML = oldHtml;
        } finally {
            if (btn) btn.disabled = false;
            if (btnText) btnText.style.display = 'inline';
            if (btnSpinner) btnSpinner.style.display = 'none';

            this.quill.enable(true);
            this.quill.focus();
        }
    }
};
