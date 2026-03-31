const CommentsView = {
    currentResource: null,
    comments: [],
    quill: null,

    show(resourceType, resourceId, projectId) {
        this.currentResource = { type: resourceType, id: resourceId, projectId };
        this.loadComments();
    },

    async loadComments() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'comments-modal';
        modal.innerHTML = `
            <div class="modal" style="max-width:700px;max-height:90vh;display:flex;flex-direction:column">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="margin:0">💬 Коментарі</h3>
                    <button class="btn btn-sm btn-secondary" onclick="document.getElementById('comments-modal').remove()">✕</button>
                </div>

                <div id="comments-list" style="flex:1;overflow-y:auto;margin-bottom:16px;max-height:400px">
                    <div class="loading">Завантаження коментарів...</div>
                </div>

                <div style="border-top:1px solid var(--border);padding-top:16px">
                    <div id="comment-editor" style="min-height:80px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px"></div>
                    <div style="display:flex;justify-content:flex-end;gap:8px">
                        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('comments-modal').remove()">Скасувати</button>
                        <button class="btn btn-primary btn-sm" onclick="CommentsView.submitComment()">💬 Відправити</button>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(modal);

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // Initialize Quill editor
        this.initEditor();

        // Load comments
        try {
            const data = await API.getComments(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id
            );
            this.comments = data.comments || [];
            this.renderComments();
        } catch (e) {
            document.getElementById('comments-list').innerHTML = `
                <div class="empty" style="padding:20px;color:var(--error)">
                    <p>❌ Помилка завантаження: ${App.esc(e.message)}</p>
                </div>`;
        }
    },

    initEditor() {
        if (!window.Quill) return;

        this.quill = new Quill('#comment-editor', {
            theme: 'snow',
            placeholder: 'Напишіть коментар...',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['link', 'code-block']
                ]
            }
        });

        // Submit on Ctrl+Enter
        this.quill.root.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.submitComment();
            }
        });
    },

    renderComments() {
        const container = document.getElementById('comments-list');

        if (this.comments.length === 0) {
            container.innerHTML = `
                <div class="empty" style="padding:40px;text-align:center">
                    <div style="font-size:48px;margin-bottom:12px">💬</div>
                    <p>Немає коментарів</p>
                    <p style="font-size:13px;color:var(--hint);margin-top:8px">Будьте першим, хто прокоментує!</p>
                </div>`;
            return;
        }

        // Build comment tree
        const commentTree = this.buildCommentTree(this.comments);
        container.innerHTML = commentTree.map(c => this.renderComment(c)).join('');
    },

    buildCommentTree(comments) {
        const map = new Map();
        const roots = [];

        // Create map
        comments.forEach(c => {
            c.children = [];
            map.set(c.id, c);
        });

        // Build tree
        comments.forEach(c => {
            if (c.parent_id) {
                const parent = map.get(c.parent_id);
                if (parent) parent.children.push(c);
            } else {
                roots.push(c);
            }
        });

        return roots;
    },

    renderComment(comment, depth = 0) {
        const indent = depth * 20;
        const canReply = depth < 3; // Max 3 levels

        const content = comment.content_format === 'html'
            ? comment.content
            : App.esc(comment.content);

        const html = `
            <div class="comment-item" data-id="${comment.id}" style="margin-left:${indent}px;margin-bottom:12px">
                <div class="comment-header" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
                    <span style="font-weight:600;font-size:14px">${App.esc(comment.user_name || 'Користувач')}</span>
                    <span style="font-size:11px;color:var(--hint)">${App.fmtDate(comment.created_at)}</span>
                    ${comment.updated_at ? '<span style="font-size:11px;color:var(--hint)">(ред.)</span>' : ''}
                </div>
                <div class="comment-content" style="font-size:14px;line-height:1.5;margin-bottom:8px;padding:8px 12px;background:var(--bg-secondary);border-radius:6px">
                    ${content}
                </div>
                <div class="comment-actions" style="display:flex;gap:12px;font-size:12px">
                    ${canReply ? `<button class="comment-action-btn" onclick="CommentsView.showReplyForm(${comment.id})">↩️ Відповісти</button>` : ''}
                    ${comment.can_edit ? `<button class="comment-action-btn" onclick="CommentsView.editComment(${comment.id})">✏️ Редагувати</button>` : ''}
                    ${comment.can_delete ? `<button class="comment-action-btn" style="color:var(--error)" onclick="CommentsView.deleteComment(${comment.id})">🗑️ Видалити</button>` : ''}
                </div>
                <div id="reply-form-${comment.id}" style="display:none;margin-top:12px"></div>
                ${comment.children.map(child => this.renderComment(child, depth + 1)).join('')}
            </div>`;

        return html;
    },

    async submitComment(parentId = null) {
        if (!this.quill) return;

        const html = this.quill.root.innerHTML;
        const text = this.quill.getText().trim();

        if (!text) {
            App.toast('Коментар не може бути порожнім', 'warning');
            return;
        }

        try {
            await API.createComment(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id,
                { content: html, format: 'html', parent_id: parentId }
            );

            this.quill.setText('');

            // Reload comments
            const data = await API.getComments(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id
            );
            this.comments = data.comments || [];
            this.renderComments();

            App.toast('Коментар додано', 'success');

            // Haptic feedback
            if (App.tg && App.tg.HapticFeedback) {
                App.tg.HapticFeedback.notificationOccurred('success');
            }
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    showReplyForm(parentId) {
        const form = document.getElementById(`reply-form-${parentId}`);
        if (!form) return;

        form.style.display = 'block';
        form.innerHTML = `
            <div id="reply-editor-${parentId}" style="min-height:60px;background:var(--bg);border-radius:6px;margin-bottom:8px"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button class="btn btn-sm btn-secondary" onclick="document.getElementById('reply-form-${parentId}').style.display='none'">Скасувати</button>
                <button class="btn btn-sm btn-primary" onclick="CommentsView.submitReply(${parentId})">Відповісти</button>
            </div>`;

        // Initialize Quill for reply
        new Quill(`#reply-editor-${parentId}`, {
            theme: 'snow',
            placeholder: 'Ваша відповідь...',
            modules: { toolbar: [['bold', 'italic'], ['link']] }
        });
    },

    async submitReply(parentId) {
        const quill = Quill.find(document.querySelector(`#reply-editor-${parentId}`));
        if (!quill) return;

        const html = quill.root.innerHTML;
        const text = quill.getText().trim();

        if (!text) return;

        try {
            await API.createComment(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id,
                { content: html, format: 'html', parent_id: parentId }
            );

            // Reload
            const data = await API.getComments(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id
            );
            this.comments = data.comments || [];
            this.renderComments();

            App.toast('Відповідь додано', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async deleteComment(commentId) {
        App.modalConfirm(
            'Видалення коментаря',
            'Ви впевнені? Цю дію не можна скасувати.',
            async () => {
                try {
                    await API.deleteComment(this.currentResource.projectId, commentId);

                    this.comments = this.comments.filter(c => c.id !== commentId);
                    this.renderComments();

                    App.toast('Коментар видалено', 'success');
                } catch (e) {
                    App.toast(e.message, 'error');
                }
            },
            'Видалити',
            'Скасувати'
        );
    }
};
