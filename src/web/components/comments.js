const CommentsView = {
    currentResource: null,
    comments: [],
    quill: null,
    onCommentClick: null,
    pendingAnchor: null,

    // Modal mode (original) — for non-file resources
    show(resourceType, resourceId, projectId) {
        this.currentResource = { type: resourceType, id: resourceId, projectId };
        this.onCommentClick = null;
        this.pendingAnchor = null;
        this.loadCommentsModal();
    },

    // Sidebar mode — renders into a container (used by FileViewer)
    async renderInto(container, resourceType, resourceId, projectId, opts) {
        this.currentResource = { type: resourceType, id: resourceId, projectId };
        this.onCommentClick = (opts && opts.onCommentClick) || null;
        this.pendingAnchor = null;

        container.innerHTML = `
            <div class="sidebar-header">
                <span>💬 Коментарі</span>
                <span id="comments-count" style="font-size:12px;color:var(--hint)"></span>
            </div>
            <div class="sidebar-comments" id="comments-list">
                <div class="loading" style="padding:20px">Завантаження...</div>
            </div>
            <div class="sidebar-editor" id="sidebar-editor-area">
                <div id="anchor-badge-area"></div>
                <div id="comment-editor" style="min-height:50px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px"></div>
                <div style="display:flex;justify-content:flex-end;gap:8px">
                    <button class="btn btn-primary btn-sm" onclick="CommentsView.submitComment()">💬 Додати</button>
                </div>
            </div>`;

        this.initEditor();
        await this.refreshComments();
    },

    setAnchor(anchor) {
        this.pendingAnchor = anchor;
        const badge = document.getElementById('anchor-badge-area');
        if (!badge) return;
        if (anchor) {
            const truncated = anchor.quoted_text.length > 60 ? anchor.quoted_text.slice(0, 57) + '...' : anchor.quoted_text;
            badge.innerHTML = `
                <div class="anchor-badge">
                    <span>📌</span>
                    <span class="anchor-text">«${App.esc(truncated)}»</span>
                    <button class="anchor-clear" onclick="CommentsView.clearAnchor()">✕</button>
                </div>`;
        } else {
            badge.innerHTML = '';
        }
    },

    clearAnchor() {
        this.pendingAnchor = null;
        const badge = document.getElementById('anchor-badge-area');
        if (badge) badge.innerHTML = '';
    },

    // Show suggestion form (replaces normal editor temporarily)
    showSuggestionForm(anchor) {
        this.pendingAnchor = anchor;
        const editorArea = document.getElementById('sidebar-editor-area');
        if (!editorArea) return;
        editorArea.innerHTML = `
            <div class="suggestion-form">
                <div class="anchor-badge" style="margin-bottom:8px">
                    <span>📌</span>
                    <span class="anchor-text">«${App.esc(anchor.quoted_text.length > 60 ? anchor.quoted_text.slice(0, 57) + '...' : anchor.quoted_text)}»</span>
                </div>
                <label>Запропонований текст:</label>
                <textarea id="suggestion-text">${App.esc(anchor.quoted_text)}</textarea>
                <label style="margin-top:8px">Пояснення (необов'язково):</label>
                <div id="suggestion-explanation" style="min-height:40px;background:var(--bg);border-radius:6px;margin-bottom:8px"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="btn btn-secondary btn-sm" onclick="CommentsView.cancelSuggestion()">Скасувати</button>
                    <button class="btn btn-primary btn-sm" onclick="CommentsView.submitSuggestion()">✏️ Надіслати</button>
                </div>
            </div>`;

        if (window.Quill) {
            new Quill('#suggestion-explanation', {
                theme: 'snow',
                placeholder: 'Поясніть зміну...',
                modules: { toolbar: [['bold', 'italic'], ['link']] }
            });
        }
    },

    cancelSuggestion() {
        this.pendingAnchor = null;
        const editorArea = document.getElementById('sidebar-editor-area');
        if (!editorArea) return;
        editorArea.innerHTML = `
            <div id="anchor-badge-area"></div>
            <div id="comment-editor" style="min-height:50px;background:var(--bg-secondary);border-radius:6px;margin-bottom:8px"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px">
                <button class="btn btn-primary btn-sm" onclick="CommentsView.submitComment()">💬 Додати</button>
            </div>`;
        this.initEditor();
    },

    async submitSuggestion() {
        if (!this.currentResource || !this.pendingAnchor) return;

        const suggestedText = document.getElementById('suggestion-text')?.value?.trim();
        if (!suggestedText) {
            App.toast('Введіть запропонований текст', 'warning');
            return;
        }

        let explanation = '';
        const explEl = document.querySelector('#suggestion-explanation');
        if (explEl && window.Quill) {
            const q = Quill.find(explEl);
            if (q) explanation = q.root.innerHTML;
        }

        try {
            await API.createComment(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id,
                {
                    content: explanation || '<p>Пропозиція редагування</p>',
                    format: 'html',
                    comment_type: 'suggestion',
                    start_offset: this.pendingAnchor.start_offset,
                    end_offset: this.pendingAnchor.end_offset,
                    quoted_text: this.pendingAnchor.quoted_text,
                    suggested_text: suggestedText
                }
            );
            App.toast('Пропозицію додано', 'success');
            this.cancelSuggestion();
            await this.refreshComments();
            if (typeof FileViewer !== 'undefined' && FileViewer.rebuildHighlights) FileViewer.rebuildHighlights();
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async refreshComments() {
        if (!this.currentResource) return;
        try {
            const data = await API.getComments(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id
            );
            this.comments = data.comments || [];
            this.renderComments();
            const countEl = document.getElementById('comments-count');
            if (countEl) countEl.textContent = this.comments.length ? `(${this.comments.length})` : '';
        } catch (e) {
            const container = document.getElementById('comments-list');
            if (container) container.innerHTML = `<div class="empty" style="padding:20px"><p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p></div>`;
        }
    },

    async loadCommentsModal() {
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
                    <div class="loading">Завантаження...</div>
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
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        this.initEditor();
        await this.refreshComments();
    },

    initEditor() {
        if (!window.Quill) return;
        const el = document.getElementById('comment-editor');
        if (!el) return;
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
        this.quill.root.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.submitComment();
            }
        });
    },

    renderComments() {
        const container = document.getElementById('comments-list');
        if (!container) return;

        if (this.comments.length === 0) {
            container.innerHTML = `
                <div class="empty" style="padding:30px;text-align:center">
                    <div style="font-size:36px;margin-bottom:8px">💬</div>
                    <p style="font-size:13px;color:var(--hint)">Немає коментарів</p>
                    <p style="font-size:12px;color:var(--hint);margin-top:4px">Виділіть текст для коментування</p>
                </div>`;
            return;
        }

        const tree = this.buildCommentTree(this.comments);
        container.innerHTML = tree.map(c => this.renderComment(c)).join('');
    },

    buildCommentTree(comments) {
        const map = new Map();
        const roots = [];
        comments.forEach(c => { c.children = []; map.set(c.id, c); });
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
        const indent = depth * 16;
        const canReply = depth < 3;
        const isSuggestion = comment.comment_type === 'suggestion';
        const statusCls = isSuggestion ? ` comment-type-suggestion ${comment.suggestion_status === 'accepted' ? 'suggestion-accepted' : comment.suggestion_status === 'rejected' ? 'suggestion-rejected' : ''}` : ' comment-type-comment';

        const content = comment.content_format === 'html' ? comment.content : App.esc(comment.content);

        let quotedHtml = '';
        if (comment.quoted_text) {
            const qt = comment.quoted_text.length > 80 ? comment.quoted_text.slice(0, 77) + '...' : comment.quoted_text;
            quotedHtml = `<div class="comment-quoted" onclick="CommentsView.navigateToAnchor(${comment.start_offset || 0}, ${comment.end_offset || 0})">«${App.esc(qt)}»</div>`;
        }

        let suggestionHtml = '';
        if (isSuggestion && comment.quoted_text && comment.suggested_text) {
            suggestionHtml = `
                <div class="suggestion-diff">
                    <del class="suggestion-del">${App.esc(comment.quoted_text)}</del>
                    <span style="color:var(--hint);margin:0 4px">→</span>
                    <ins class="suggestion-ins">${App.esc(comment.suggested_text)}</ins>
                </div>`;
        }

        let actionsHtml = '';
        if (isSuggestion && comment.suggestion_status === 'pending') {
            actionsHtml = `
                <div class="suggestion-actions">
                    <button class="btn btn-sm btn-success" onclick="CommentsView.acceptSuggestion(${comment.id})">✓ Прийняти</button>
                    <button class="btn btn-sm btn-danger" onclick="CommentsView.rejectSuggestion(${comment.id})">✗ Відхилити</button>
                </div>`;
        }

        return `
            <div class="comment-item${statusCls}" data-id="${comment.id}" style="margin-left:${indent}px">
                <div class="comment-meta">
                    <span class="author">${App.esc(comment.user_name || 'Користувач')}</span>
                    <span class="time">${App.fmtDate(comment.created_at)}</span>
                    ${isSuggestion ? '<span style="color:#f97316;font-size:11px">✏️ пропозиція</span>' : ''}
                </div>
                ${quotedHtml}
                ${suggestionHtml}
                <div class="comment-body">${content}</div>
                ${actionsHtml}
                <div class="comment-actions-bar">
                    ${canReply ? `<button class="comment-action-btn" onclick="CommentsView.showReplyForm(${comment.id})">↩️ Відповісти</button>` : ''}
                    ${comment.can_delete ? `<button class="comment-action-btn" style="color:var(--error)" onclick="CommentsView.deleteComment(${comment.id})">🗑️</button>` : ''}
                </div>
                <div id="reply-form-${comment.id}" style="display:none;margin-top:8px"></div>
                ${comment.children.map(child => this.renderComment(child, depth + 1)).join('')}
            </div>`;
    },

    navigateToAnchor(startOffset, endOffset) {
        if (this.onCommentClick) {
            this.onCommentClick(startOffset, endOffset);
        }
    },

    async submitComment(parentId = null) {
        if (!this.quill || !this.currentResource) return;
        const html = this.quill.root.innerHTML;
        const text = this.quill.getText().trim();
        if (!text) { App.toast('Коментар не може бути порожнім', 'warning'); return; }

        const data = { content: html, format: 'html', parent_id: parentId };
        if (this.pendingAnchor) {
            data.start_offset = this.pendingAnchor.start_offset;
            data.end_offset = this.pendingAnchor.end_offset;
            data.quoted_text = this.pendingAnchor.quoted_text;
            data.comment_type = 'comment';
        }

        try {
            await API.createComment(
                this.currentResource.projectId,
                this.currentResource.type,
                this.currentResource.id,
                data
            );
            this.quill.setText('');
            this.clearAnchor();
            await this.refreshComments();
            if (typeof FileViewer !== 'undefined' && FileViewer.rebuildHighlights) FileViewer.rebuildHighlights();
            App.toast('Коментар додано', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    showReplyForm(parentId) {
        const form = document.getElementById(`reply-form-${parentId}`);
        if (!form) return;
        form.style.display = 'block';
        form.innerHTML = `
            <div id="reply-editor-${parentId}" style="min-height:50px;background:var(--bg);border-radius:6px;margin-bottom:6px"></div>
            <div style="display:flex;gap:6px;justify-content:flex-end">
                <button class="btn btn-sm btn-secondary" onclick="document.getElementById('reply-form-${parentId}').style.display='none'">Скасувати</button>
                <button class="btn btn-sm btn-primary" onclick="CommentsView.submitReply(${parentId})">Відповісти</button>
            </div>`;
        if (window.Quill) {
            new Quill(`#reply-editor-${parentId}`, {
                theme: 'snow',
                placeholder: 'Ваша відповідь...',
                modules: { toolbar: [['bold', 'italic'], ['link']] }
            });
        }
    },

    async submitReply(parentId) {
        const el = document.querySelector(`#reply-editor-${parentId}`);
        if (!el || !window.Quill) return;
        const quill = Quill.find(el);
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
            await this.refreshComments();
            App.toast('Відповідь додано', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async acceptSuggestion(commentId) {
        if (!this.currentResource) return;
        try {
            await API.acceptSuggestion(this.currentResource.projectId, commentId);
            await this.refreshComments();
            if (typeof FileViewer !== 'undefined' && FileViewer.rebuildHighlights) FileViewer.rebuildHighlights();
            App.toast('Пропозицію прийнято', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async rejectSuggestion(commentId) {
        if (!this.currentResource) return;
        try {
            await API.rejectSuggestion(this.currentResource.projectId, commentId);
            await this.refreshComments();
            if (typeof FileViewer !== 'undefined' && FileViewer.rebuildHighlights) FileViewer.rebuildHighlights();
            App.toast('Пропозицію відхилено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async deleteComment(commentId) {
        if (!this.currentResource) return;
        try {
            await API.deleteComment(this.currentResource.projectId, commentId);
            await this.refreshComments();
            if (typeof FileViewer !== 'undefined' && FileViewer.rebuildHighlights) FileViewer.rebuildHighlights();
            App.toast('Коментар видалено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    }
};
