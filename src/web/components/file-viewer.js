const FileViewer = {
    currentFileId: null,
    currentFileName: '',
    currentContent: '',

    async show(projectId, fileId, fileName) {
        this.currentFileId = fileId;
        this.currentFileName = fileName;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal file-viewer-modal">
                <div class="file-viewer-header">
                    <h3>📄 ${App.esc(fileName)}</h3>
                    <button class="btn btn-secondary btn-sm" onclick="this.closest('.modal-overlay').remove()">Закрити</button>
                </div>
                <div id="file-content" class="file-viewer-content">
                    <div class="loading">Завантаження...</div>
                </div>
                <div class="file-viewer-footer">
                    <p style="font-size:13px;color:var(--hint);margin:0">
                        💡 Виділіть текст, щоб скопіювати цитату
                    </p>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        // Close on background click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Load content
        try {
            const data = await API.getFileContent(projectId, fileId);
            this.currentContent = data.content || '';
            this.renderContent(data.content || '');
        } catch (e) {
            document.getElementById('file-content').innerHTML = `
                <div class="empty">
                    <div class="empty-icon">📄</div>
                    <p>Текст недоступний</p>
                    <p style="font-size:13px;color:var(--hint);margin-top:8px">
                        Файл ще обробляється або текст недоступний для цього формату.
                        Спробуйте завантажити файл знову.
                    </p>
                </div>`;
        }
    },

    renderContent(content) {
        const container = document.getElementById('file-content');
        if (!container) return;

        if (!content || content.length === 0) {
            container.innerHTML = '<div class="empty"><p>Файл порожній або текст не витягнуто</p></div>';
            return;
        }

        // Escape HTML and preserve line breaks
        const escaped = App.esc(content);
        const withBreaks = escaped.replace(/\n/g, '<br>');

        container.innerHTML = `
            <div class="file-text-content" id="selectable-text">${withBreaks}</div>`;

        // Enable text selection with quote button
        const textEl = document.getElementById('selectable-text');
        if (!textEl) return;

        textEl.addEventListener('mouseup', () => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();

            // Remove old tooltip
            document.querySelectorAll('.quote-tooltip').forEach(t => t.remove());

            if (selectedText.length > 0 && selectedText.length <= 500) {
                this.showQuoteTooltip(selection, selectedText);
            }
        });
    },

    showQuoteTooltip(selection, selectedText) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const tooltip = document.createElement('div');
        tooltip.className = 'quote-tooltip';
        tooltip.style.position = 'fixed';
        tooltip.style.top = `${rect.bottom + 5}px`;
        tooltip.style.left = `${rect.left}px`;
        tooltip.innerHTML = `
            <button class="btn btn-sm btn-primary" onclick="FileViewer.copyQuote()">
                📋 Копіювати цитату
            </button>`;
        document.body.appendChild(tooltip);

        // Auto-remove after 5 seconds
        setTimeout(() => tooltip.remove(), 5000);
    },

    copyQuote() {
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        // Remove tooltip
        document.querySelectorAll('.quote-tooltip').forEach(t => t.remove());

        if (!selectedText) {
            App.toast('Спочатку виділіть текст', 'warning');
            return;
        }

        const quoteText = `«${selectedText}»\n— ${this.currentFileName}`;

        navigator.clipboard.writeText(quoteText).then(() => {
            App.toast('Цитату скопійовано', 'success');
        }).catch(() => {
            // Fallback for older browsers
            const ta = document.createElement('textarea');
            ta.value = quoteText;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            App.toast('Цитату скопійовано', 'success');
        });
    }
};
