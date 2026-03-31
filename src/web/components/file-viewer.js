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
                        💡 Виділіть текст мишкою, щоб процитувати його в повідомленні
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
                    <p style="color:var(--red)">Помилка: ${App.esc(e.message)}</p>
                    <p style="font-size:13px;color:var(--hint);margin-top:8px">
                        Можливо, текст ще не витягнуто з файлу. Спробуйте завантажити файл знову.
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
            <button class="btn btn-sm btn-primary" onclick="FileViewer.insertQuote('${selectedText.replace(/'/g, "\\'")}')">
                📌 Вставити цитату
            </button>`;
        document.body.appendChild(tooltip);

        // Auto-remove after 5 seconds
        setTimeout(() => tooltip.remove(), 5000);
    },

    insertQuote(selectedText) {
        // Remove tooltip
        document.querySelectorAll('.quote-tooltip').forEach(t => t.remove());

        // Close viewer
        document.querySelectorAll('.modal-overlay').forEach(m => m.remove());

        // Insert into Quill editor if available
        if (MessagesView && MessagesView.quill) {
            const quill = MessagesView.quill;
            const cursorPos = quill.getSelection()?.index || quill.getLength();

            // Insert blockquote with file reference
            const quoteHtml = `
                <blockquote style="border-left:4px solid var(--btn);padding-left:12px;margin:8px 0;font-style:italic;color:var(--text)">
                    ${selectedText}
                    <footer style="margin-top:4px;font-size:12px;color:var(--hint);font-style:normal">
                        — ${this.currentFileName}
                    </footer>
                </blockquote>
            `;

            // Insert at cursor position
            quill.clipboard.dangerouslyPasteHTML(cursorPos, quoteHtml);
            quill.setSelection(cursorPos + selectedText.length + 50);

            App.toast('Цитату додано до повідомлення', 'success');
        } else {
            App.toast('Відкрийте вкладку "Повідомлення" щоб вставити цитату', 'warning');
        }
    }
};
