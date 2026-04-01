const CommentsView = {
    currentResource: null,
    comments: [],
    quill: null,
    onCommentClick: null,
    pendingAnchor: null,

    // Modal mode — for non-file resources
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
            <div class="cv-sidebar">
                <div class="cv-header">
                    <div class="cv-header-title">
                        <span>&#128172; Коментарі</span>
                        <span class="cv-count" id="comments-count"></span>
                    </div>
                </div>
                <div class="cv-list" id="comments-list">
                    <div class="loading" style="padding:30px;text-align:center">Завантаження...</div>
                </div>
                <div class="cv-editor" id="sidebar-editor-area">
                    <div id="anchor-badge-area"></div>
                    <div class="cv-editor-wrap">
                        <div id="comment-editor"></div>
                    </div>
                    <div class="cv-editor-actions">
                        <span class="cv-editor-hint">Ctrl+Enter</span>
                        <button class="btn btn-primary btn-sm" onclick="CommentsView.submitComment()">Додати</button>
                    </div>
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
            const truncated = anchor.quoted_text.length > 50 ? anchor.quoted_text.slice(0, 47) + '...' : anchor.quoted_text;
            badge.innerHTML = `
                <div class="cv-anchor">
                    <span class="cv-anchor-pin">&#128204;</span>
                    <span class="cv-anchor-text">\u00AB${App.esc(truncated)}\u00BB</span>
                    <button class="cv-anchor-clear" onclick="CommentsView.clearAnchor()">&times;</button>
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

    showSuggestionForm(anchor) {
        this.pendingAnchor = anchor;
        const editorArea = document.getElementById('sidebar-editor-area');
        if (!editorArea) return;

        const truncated = anchor.quoted_text.length > 50 ? anchor.quoted_text.slice(0, 47) + '...' : anchor.quoted_text;
        editorArea.innerHTML = `
            <div class="cv-suggestion-form">
                <div class="cv-anchor" style="margin-bottom:10px">
                    <span class="cv-anchor-pin">&#128204;</span>
                    <span class="cv-anchor-text">\u00AB${App.esc(truncated)}\u00BB</span>
                </div>
                <div class="cv-field">
                    <label class="cv-label">Запропонований текст</label>
                    <textarea id="suggestion-text" class="cv-textarea" rows="3">${App.esc(anchor.quoted_text)}</textarea>
                </div>
                <div class="cv-field">
                    <label class="cv-label">Пояснення <span class="cv-optional">(необов'язково)</span></label>
                    <div id="suggestion-explanation"></div>
                </div>
                <div class="cv-suggestion-actions">
                    <button class="btn btn-secondary btn-sm" onclick="CommentsView.cancelSuggestion()">Скасувати</button>
                    <button class="btn btn-primary btn-sm" onclick="CommentsView.submitSuggestion()">&#9998; Надіслати</button>
                </div>
            </div>`;

        if (window.Quill) {
            new Quill('#suggestion-explanation', {
                theme: 'snow',
                placeholder: 'Поясніть зміну...',
                modules: { toolbar: [['bold', 'italic'], ['link']] }
            });
        }

        const ta = document.getElementById('suggestion-text');
        if (ta) ta.focus();
    },

    cancelSuggestion() {
        this.pendingAnchor = null;
        const editorArea = document.getElementById('sidebar-editor-area');
        if (!editorArea) return;
        editorArea.innerHTML = `
            <div id="anchor-badge-area"></div>
            <div class="cv-editor-wrap">
                <div id="comment-editor"></div>
            </div>
            <div class="cv-editor-actions">
                <span class="cv-editor-hint">Ctrl+Enter</span>
                <button class="btn btn-primary btn-sm" onclick="CommentsView.submitComment()">Додати</button>
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
            if (countEl) countEl.textContent = this.comments.length ? this.comments.length : '';
        } catch (e) {
            const container = document.getElementById('comments-list');
            if (container) container.innerHTML = '<div class="cv-empty"><p>' + App.esc(e.message) + '</p></div>';
        }
    },

    async loadCommentsModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'comments-modal';
        modal.innerHTML = `
            <div class="modal" style="max-width:600px;max-height:90vh;display:flex;flex-direction:column">
                <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:12px">
                    <h3 style="margin:0;font-size:16px">&#128172; Коментарі</h3>
                    <button class="btn btn-sm btn-secondary" onclick="document.getElementById('comments-modal').remove()">&times;</button>
                </div>
                <div id="comments-list" style="flex:1;overflow-y:auto;margin-bottom:12px;max-height:400px"></div>
                <div style="border-top:1px solid var(--border);padding-top:12px">
                    <div class="cv-editor-wrap">
                        <div id="comment-editor"></div>
                    </div>
                    <div class="cv-editor-actions" style="margin-top:8px">
                        <span class="cv-editor-hint">Ctrl+Enter</span>
                        <button class="btn btn-primary btn-sm" onclick="CommentsView.submitComment()">Відправити</button>
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
                <div class="cv-empty">
                    <div class="cv-empty-icon">&#128172;</div>
                    <p class="cv-empty-title">Немає коментарів</p>
                    <p class="cv-empty-hint">Виділіть текст зліва, щоб додати коментар або запропонувати зміну</p>
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
        const indent = depth * 12;
        const canReply = depth < 3;
        const isSuggestion = comment.comment_type === 'suggestion';

        let statusCls = 'cv-comment';
        if (isSuggestion) {
            statusCls = 'cv-suggestion';
            if (comment.suggestion_status === 'accepted') statusCls += ' cv-accepted';
            else if (comment.suggestion_status === 'rejected') statusCls += ' cv-rejected';
        }

        const content = comment.content_format === 'html' ? comment.content : App.esc(comment.content);

        // Quoted text badge (clickable to navigate)
        let quotedHtml = '';
        if (comment.quoted_text) {
            const qt = comment.quoted_text.length > 60 ? comment.quoted_text.slice(0, 57) + '...' : comment.quoted_text;
            quotedHtml = `<div class="cv-quoted" onclick="CommentsView.navigateToAnchor(${comment.start_offset || 0}, ${comment.end_offset || 0})">\u00AB${App.esc(qt)}\u00BB</div>`;
        }

        // Suggestion diff display
        let suggestionHtml = '';
        if (isSuggestion && comment.quoted_text && comment.suggested_text) {
            const statusLabel = comment.suggestion_status === 'accepted' ? '<span class="cv-status-badge cv-badge-accepted">&#10003; Прийнято</span>'
                : comment.suggestion_status === 'rejected' ? '<span class="cv-status-badge cv-badge-rejected">&#10005; Відхилено</span>'
                : '';
            suggestionHtml = `
                <div class="cv-diff">
                    ${statusLabel}
                    <div class="cv-diff-row">
                        <del class="cv-del">${App.esc(comment.quoted_text)}</del>
                    </div>
                    <div class="cv-diff-arrow">&darr;</div>
                    <div class="cv-diff-row">
                        <ins class="cv-ins">${App.esc(comment.suggested_text)}</ins>
                    </div>
                </div>`;
        }

        // Action buttons for pending suggestions
        let actionsHtml = '';
        if (isSuggestion && comment.suggestion_status === 'pending') {
            actionsHtml = `
                <div class="cv-actions">
                    <button class="cv-action-btn cv-btn-accept" onclick="CommentsView.acceptSuggestion(${comment.id})">&#10003; Прийняти</button>
                    <button class="cv-action-btn cv-btn-reject" onclick="CommentsView.rejectSuggestion(${comment.id})">&#10005; Відхилити</button>
                </div>`;
        }

        // Bottom actions (reply, delete)
        let bottomActions = '<div class="cv-bottom-actions">';
        if (canReply) bottomActions += `<button class="cv-link-btn" onclick="CommentsView.showReplyForm(${comment.id})">&#8617; Відповісти</button>`;
        if (comment.can_delete) bottomActions += `<button class="cv-link-btn cv-link-danger" onclick="CommentsView.deleteComment(${comment.id})">&#128465;</button>`;
        bottomActions += '</div>';

        return `
            <div class="comment-item ${statusCls}" data-id="${comment.id}" style="margin-left:${indent}px">
                <div class="cv-meta">
                    <span class="cv-author">${App.esc(comment.user_name || 'Користувач')}</span>
                    ${isSuggestion ? '<span class="cv-type-badge">&#9998; пропозиція</span>' : ''}
                    <span class="cv-time">${App.fmtDate(comment.created_at)}</span>
                </div>
                ${quotedHtml}
                ${suggestionHtml}
                <div class="cv-body">${content}</div>
                ${actionsHtml}
                ${bottomActions}
                <div id="reply-form-${comment.id}" class="cv-reply-form"></div>
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
        const form = document.getElementById('reply-form-' + parentId);
        if (!form) return;
        form.style.display = 'block';
        form.innerHTML = `
            <div class="cv-reply-editor">
                <div id="reply-editor-${parentId}"></div>
                <div class="cv-reply-actions">
                    <button class="btn btn-sm btn-secondary" onclick="document.getElementById('reply-form-${parentId}').style.display='none'">Скасувати</button>
                    <button class="btn btn-sm btn-primary" onclick="CommentsView.submitReply(${parentId})">Відповісти</button>
                </div>
            </div>`;
        if (window.Quill) {
            new Quill('#reply-editor-' + parentId, {
                theme: 'snow',
                placeholder: 'Ваша відповідь...',
                modules: { toolbar: [['bold', 'italic'], ['link']] }
            });
        }
    },

    async submitReply(parentId) {
        const el = document.querySelector('#reply-editor-' + parentId);
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
