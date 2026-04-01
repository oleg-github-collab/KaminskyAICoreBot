const FileViewer = {
    currentFileId: null,
    currentFileName: '',
    currentContent: '',
    currentProjectId: null,
    currentContentType: 'text',
    overlay: null,
    lockedSegIdx: null,
    _pendingSelection: null,
    _selectionCleanup: null,

    // ═══════════════════════════════════════════════════════
    //  Native document rendering (pdf.js, docx-preview)
    // ═══════════════════════════════════════════════════════
    _getExt(fileName) {
        if (!fileName) return '';
        const dot = fileName.lastIndexOf('.');
        return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
    },

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('Failed to load: ' + src));
            document.head.appendChild(s);
        });
    },

    async _ensurePdfJs() {
        if (window.pdfjsLib) return;
        await this._loadScript('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        }
    },

    async _ensureDocxPreview() {
        if (window.docx) return;
        await this._loadScript('https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js');
    },

    async _renderNative(container, projectId, fileId, ext) {
        container.innerHTML = '<div class="loading" style="padding:40px;text-align:center">Завантаження документу...</div>';
        const blob = await API.downloadFileBlob(projectId, fileId);

        if (ext === 'pdf') {
            await this._renderPdfNative(container, blob);
        } else if (ext === 'docx') {
            await this._renderDocxNative(container, blob);
        }
        this.currentContentType = 'native';
    },

    async _renderPdfNative(container, blob) {
        await this._ensurePdfJs();
        const arrayBuffer = await blob.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;

        container.innerHTML = '';
        const pagesDiv = document.createElement('div');
        pagesDiv.className = 'pdf-native-pages file-text-content';
        pagesDiv.id = 'fv-text';
        container.appendChild(pagesDiv);

        const containerWidth = container.clientWidth - 32;

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const unscaledVp = page.getViewport({ scale: 1 });
            const scale = Math.min(containerWidth / unscaledVp.width, 2.0);
            const viewport = page.getViewport({ scale });

            // Wrapper: canvas + selectable text layer on top
            const pageWrap = document.createElement('div');
            pageWrap.className = 'pdf-page-wrapper';
            pageWrap.style.width = viewport.width + 'px';
            pageWrap.style.height = viewport.height + 'px';

            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            pageWrap.appendChild(canvas);
            pagesDiv.appendChild(pageWrap);

            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

            // Text layer — transparent selectable text over canvas
            try {
                const textContent = await page.getTextContent();
                const textLayerDiv = document.createElement('div');
                textLayerDiv.className = 'pdf-text-layer';
                pageWrap.appendChild(textLayerDiv);
                const task = pdfjsLib.renderTextLayer({
                    textContent: textContent,
                    container: textLayerDiv,
                    viewport: viewport,
                    textDivs: []
                });
                if (task && task.promise) await task.promise;
            } catch (e) { console.warn('Text layer failed for page ' + i, e); }

            const label = document.createElement('div');
            label.className = 'pdf-page-label';
            label.textContent = i + ' / ' + pdf.numPages;
            pagesDiv.appendChild(label);
        }

        this.attachSelectionHandler(container);
    },

    async _renderDocxNative(container, blob) {
        await this._ensureDocxPreview();
        const arrayBuffer = await blob.arrayBuffer();

        container.innerHTML = '';
        const wrapper = document.createElement('div');
        wrapper.className = 'docx-native-wrapper file-text-content';
        wrapper.id = 'fv-text';
        container.appendChild(wrapper);

        await docx.renderAsync(arrayBuffer, wrapper, null, {
            className: 'docx-native',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: true,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: true,
        });

        this.attachSelectionHandler(container);
    },

    // ═══════════════════════════════════════════════════════
    //  Smart text formatting — paragraphs, headings, lists
    //  Supports: markdown markers from processor + plain heuristics
    // ═══════════════════════════════════════════════════════

    // Coerce any value to a string safely
    _toStr(raw) {
        if (!raw) return '';
        if (typeof raw === 'string') return raw;
        if (Array.isArray(raw)) {
            try {
                if (raw.length > 0 && typeof raw[0] === 'number') {
                    const chunks = [];
                    for (let i = 0; i < raw.length; i += 4096)
                        chunks.push(String.fromCharCode.apply(null, raw.slice(i, i + 4096)));
                    return chunks.join('');
                }
            } catch(e) { /* fall through */ }
            return '';
        }
        return String(raw);
    },

    // Detect raw PDF/binary garbage stored as text
    _isGarbage(text) {
        if (!text || text.length < 50) return false;
        if (text.startsWith('%PDF-')) return true;
        const s = text.slice(0, 4000);
        if (s.includes('endobj') && s.includes('endstream')) return true;
        if (s.includes('endobj') && s.includes('/Type')) return true;
        let bad = 0;
        const len = Math.min(text.length, 1000);
        for (let i = 0; i < len; i++) {
            const c = text.charCodeAt(i);
            if (c < 32 && c !== 10 && c !== 13 && c !== 9) bad++;
        }
        return bad > len * 0.12;
    },

    formatText(raw) {
        raw = this._toStr(raw);
        if (!raw.trim()) return '';

        // Detect markdown-style markers from processor (## Heading, **bold**)
        const hasMarkdown = /^#{1,4}\s/m.test(raw) || /\*\*[^*]+\*\*/.test(raw);

        const blocks = raw.split(/\n{2,}/).filter(b => b.trim());
        if (blocks.length === 0) return '<p class="fv-para">' + App.esc(raw) + '</p>';

        let html = '';
        for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;
            html += hasMarkdown ? this._renderMdBlock(trimmed) : this._renderPlainBlock(trimmed);
        }
        return html;
    },

    // ── Markdown-aware block rendering ──
    _renderMdBlock(block) {
        const lines = block.split('\n');
        let html = '';
        let listItems = [];
        let listType = null;

        const flushList = () => {
            if (listItems.length > 0) {
                const tag = listType === 'ol' ? 'ol' : 'ul';
                html += '<' + tag + ' class="fv-list">' + listItems.join('') + '</' + tag + '>';
                listItems = [];
                listType = null;
            }
        };

        for (const line of lines) {
            const t = line.trim();
            if (!t) { flushList(); continue; }

            // Headings: # H1 → <h2>, ## H2 → <h3>, ### H3 → <h4>, #### → <h5>
            const hm = t.match(/^(#{1,4})\s+(.+)$/);
            if (hm) {
                flushList();
                const lvl = hm[1].length + 1;
                const cls = lvl <= 3 ? 'fv-heading' : 'fv-subheading';
                html += '<h' + lvl + ' class="' + cls + '">' + this._escInline(hm[2]) + '</h' + lvl + '>';
                continue;
            }

            // Blockquote: > text
            if (t.startsWith('> ')) {
                flushList();
                html += '<blockquote class="fv-quote">' + this._escInline(t.slice(2)) + '</blockquote>';
                continue;
            }

            // Unordered list: - item, * item, • item
            const ulm = t.match(/^[-*\u2022]\s+(.+)$/);
            if (ulm) {
                if (listType !== 'ul') flushList();
                listType = 'ul';
                listItems.push('<li>' + this._escInline(ulm[1]) + '</li>');
                continue;
            }

            // Ordered list: 1. item, 2) item
            const olm = t.match(/^\d+[\.\)]\s+(.+)$/);
            if (olm) {
                if (listType !== 'ol') flushList();
                listType = 'ol';
                listItems.push('<li>' + this._escInline(olm[1]) + '</li>');
                continue;
            }

            flushList();
            html += '<p class="fv-para">' + this._escInline(t) + '</p>';
        }
        flushList();
        return html;
    },

    // Escape HTML + render inline markdown: ***bold-italic***, **bold**, *italic*
    _escInline(text) {
        let s = App.esc(text);
        s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
        return s;
    },

    // ── Plain-text heuristic block rendering (no markdown markers) ──
    _renderPlainBlock(block) {
        const trimmed = block.trim();
        const lines = trimmed.split('\n');
        const firstLine = lines[0].trim();

        // ALL CAPS heading (3-80 chars, >60% uppercase)
        const letters = firstLine.replace(/[^a-zA-Z\u0400-\u04FF\u0490-\u04FF]/g, '');
        const upper = firstLine.replace(/[^A-Z\u0410-\u042F\u0406\u0407\u0404\u0490]/g, '');
        const isAllCaps = letters.length > 2 && firstLine.length <= 80 && letters.length > 0 && (upper.length / letters.length) > 0.6;

        // Numbered heading: "1.", "I.", "Chapter", "Розділ", etc.
        const isNumbered = /^(\d+[\.\)]\s|[IVXLC]+[\.\)]\s|Chapter\s|Розділ\s|Глава\s|Частина\s|CHAPTER\s|SECTION\s|Abschnitt\s|Kapitel\s|Teil\s)/i.test(firstLine);

        // Short standalone title
        const isShortTitle = lines.length === 1 && firstLine.length <= 60 && firstLine.length >= 2 && !/[.,:;!?]$/.test(firstLine);

        // List block (all lines start with list markers)
        const isList = lines.length > 0 && lines.every(l => /^\s*[-*\u2022]\s/.test(l) || /^\s*\d+[\.\)]\s/.test(l));

        if (isList) {
            const items = lines.map(l => {
                const text = l.replace(/^\s*[-*\u2022]\s*/, '').replace(/^\s*\d+[\.\)]\s*/, '').trim();
                return '<li>' + App.esc(text) + '</li>';
            });
            const isOrdered = lines.every(l => /^\s*\d+[\.\)]\s/.test(l));
            return (isOrdered ? '<ol class="fv-list">' : '<ul class="fv-list">') + items.join('') + (isOrdered ? '</ol>' : '</ul>');
        }
        if (isAllCaps || (isNumbered && firstLine.length <= 100)) {
            let html = '<h3 class="fv-heading">' + App.esc(firstLine) + '</h3>';
            if (lines.length > 1) {
                const rest = lines.slice(1).join('\n').trim();
                if (rest) html += '<p class="fv-para">' + App.esc(rest).replace(/\n/g, '<br>') + '</p>';
            }
            return html;
        }
        if (isShortTitle && lines.length === 1) {
            return '<h4 class="fv-subheading">' + App.esc(firstLine) + '</h4>';
        }
        return '<p class="fv-para">' + App.esc(trimmed).replace(/\n/g, '<br>') + '</p>';
    },

    // Offset-preserving format (for highlighted text — can't restructure into headings)
    formatTextPreservingOffsets(raw) {
        raw = this._toStr(raw);
        if (!raw.trim()) return App.esc(raw);
        return App.esc(raw)
            .replace(/\n{3,}/g, '</p><div class="fv-gap-lg"></div><p class="fv-para-flat">')
            .replace(/\n\n/g, '</p><p class="fv-para-flat">')
            .replace(/\n/g, '<br>');
    },

    // ═══════════════════════════════════════════════════════
    //  MODE 1: Single file + Comments sidebar + Color coding
    // ═══════════════════════════════════════════════════════
    async show(projectId, fileId, fileName) {
        this.currentFileId = fileId;
        this.currentFileName = fileName;
        this.currentProjectId = projectId;
        this.currentContent = '';
        this._selectionCleanup = null;

        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay';
        this.overlay.innerHTML = `
            <div class="modal file-viewer-modal with-comments">
                <div class="fv-header">
                    <div class="fv-header-left">
                        <span class="fv-header-icon">&#128196;</span>
                        <span class="fv-header-name">${App.esc(fileName)}</span>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="FileViewer.close()">&#10005;</button>
                </div>
                <div class="file-viewer-body">
                    <div class="file-viewer-main" id="fv-main">
                        <div class="loading" style="padding:40px;text-align:center">Завантаження...</div>
                    </div>
                    <div class="file-viewer-sidebar" id="fv-sidebar"></div>
                </div>
                <div class="fv-footer-hint">
                    &#128161; Виділіть текст для коментування, пропозицій або копіювання
                </div>
            </div>`;

        document.body.appendChild(this.overlay);
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });

        const escHandler = (e) => {
            if (e.key === 'Escape') { this.close(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        const contentPromise = this.loadContent(projectId, fileId);
        const commentsPromise = CommentsView.renderInto(
            document.getElementById('fv-sidebar'),
            'file', fileId, projectId,
            { onCommentClick: (s, e) => this.scrollToOffset(s, e) }
        );

        await Promise.all([contentPromise, commentsPromise]);
        this.rebuildHighlights();
    },

    async loadContent(projectId, fileId) {
        const main = document.getElementById('fv-main');
        if (!main) return;

        const ext = this._getExt(this.currentFileName);

        // Native rendering for PDF and DOCX — pixel-perfect display
        if (ext === 'pdf' || ext === 'docx') {
            try {
                await this._renderNative(main, projectId, fileId, ext);
                return;
            } catch (e) {
                console.warn('Native rendering failed, falling back to text extraction:', e);
            }
        }

        // Text extraction for other formats + fallback
        const tryLoad = async () => {
            const data = await API.getFileContent(projectId, fileId);
            this.currentContent = this._toStr(data.content);
            this.currentContentType = data.content_type || 'text';
            this.renderSingleContent(main, this.currentContent);
        };

        try {
            await tryLoad();
        } catch (e) {
            try {
                await new Promise(r => setTimeout(r, 1500));
                await tryLoad();
            } catch (e2) {
                main.innerHTML = `
                    <div class="fv-empty-state">
                        <div class="fv-empty-icon">&#128196;</div>
                        <p class="fv-empty-title">Не вдалося завантажити файл</p>
                        <p class="fv-empty-detail">${App.esc(e2.message)}</p>
                        <button class="btn btn-primary btn-sm" style="margin-top:12px"
                            onclick="FileViewer.loadContent(${projectId}, ${fileId})">
                            &#8635; Спробувати знову
                        </button>
                    </div>`;
            }
        }
    },

    // Sanitize HTML from processor — strip scripts, event handlers, dangerous attrs
    _sanitizeHtml(html) {
        let s = html;
        s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        s = s.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        s = s.replace(/\bon\w+\s*=\s*"[^"]*"/gi, '');
        s = s.replace(/\bon\w+\s*=\s*'[^']*'/gi, '');
        s = s.replace(/\bon\w+\s*=\s*[^\s>]+/gi, '');
        s = s.replace(/javascript\s*:/gi, '');
        return s;
    },

    renderSingleContent(container, content) {
        content = this._toStr(content);
        if (!content.trim() || (this.currentContentType !== 'html' && this._isGarbage(content))) {
            const msg = this._isGarbage(content) ? 'Текст витягується повторно... Спробуйте через хвилину.' : 'Файл порожній або текст не витягнуто';
            container.innerHTML = '<div class="fv-empty-state"><div class="fv-empty-icon">&#128196;</div>' +
                '<p class="fv-empty-title">' + App.esc(msg) + '</p>' +
                '<button class="btn btn-primary btn-sm" style="margin-top:12px" ' +
                'onclick="FileViewer.loadContent(' + this.currentProjectId + ',' + this.currentFileId + ')">&#8635; Оновити</button></div>';
            return;
        }

        if (this.currentContentType === 'html') {
            // Rich HTML from processor (mammoth/pymupdf) — render directly
            const sanitized = this._sanitizeHtml(content);
            container.innerHTML = '<div class="file-text-content doc-html" id="fv-text">' + sanitized + '</div>';
        } else {
            // Plain text / markdown — use existing formatting engine
            const formatted = this.formatText(content);
            container.innerHTML = '<div class="file-text-content" id="fv-text">' + formatted + '</div>';
        }
        this.attachSelectionHandler(container);
    },

    // Rebuild text with highlight marks from comments
    rebuildHighlights() {
        const textEl = document.getElementById('fv-text');
        if (!textEl || !this.currentContent) return;

        // For HTML/native content, skip offset-based highlighting (not compatible)
        if (this.currentContentType === 'html' || this.currentContentType === 'native') return;

        const comments = CommentsView.comments || [];
        const anchored = comments.filter(c => c.start_offset != null && c.end_offset != null && c.start_offset !== c.end_offset);

        if (anchored.length === 0) {
            textEl.innerHTML = this.formatText(this.currentContent);
            this.attachSelectionHandler(textEl.parentElement);
            return;
        }

        // Sort by start_offset
        anchored.sort((a, b) => a.start_offset - b.start_offset || (b.end_offset - b.start_offset) - (a.end_offset - a.start_offset));

        // Build highlighted content with proper formatting
        const text = this.currentContent;
        const spans = [];
        let lastEnd = 0;

        for (const c of anchored) {
            const s = Math.max(c.start_offset, lastEnd);
            const e = Math.min(c.end_offset, text.length);
            if (s >= e) continue;

            if (s > lastEnd) {
                spans.push({ text: text.slice(lastEnd, s), cls: null });
            }

            let cls = 'hl-comment';
            if (c.comment_type === 'suggestion') {
                cls = c.suggestion_status === 'accepted' ? 'hl-suggestion-accepted'
                    : c.suggestion_status === 'rejected' ? 'hl-suggestion-rejected'
                    : 'hl-suggestion-pending';
            }

            spans.push({ text: text.slice(s, e), cls, ids: [c.id] });
            lastEnd = e;
        }
        if (lastEnd < text.length) {
            spans.push({ text: text.slice(lastEnd), cls: null });
        }

        let html = '<p class="fv-para-flat">';
        for (const sp of spans) {
            const escaped = this.formatTextPreservingOffsets(sp.text);
            if (sp.cls) {
                html += `<mark class="${sp.cls}" data-comment-ids="${(sp.ids || []).join(',')}" onclick="FileViewer.onHighlightClick(event)">${escaped}</mark>`;
            } else {
                html += escaped;
            }
        }
        html += '</p>';
        textEl.innerHTML = html;
        this.attachSelectionHandler(textEl.parentElement);
    },

    onHighlightClick(e) {
        const mark = e.target.closest('mark');
        if (!mark) return;
        const ids = (mark.dataset.commentIds || '').split(',').map(Number);
        if (!ids.length) return;
        const commentEl = document.querySelector(`.comment-item[data-id="${ids[0]}"]`);
        if (commentEl) {
            commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            commentEl.classList.add('comment-flash');
            setTimeout(() => commentEl.classList.remove('comment-flash'), 2000);
        }
    },

    scrollToOffset(startOffset, endOffset) {
        const textEl = document.getElementById('fv-text');
        if (!textEl) return;

        const marks = textEl.querySelectorAll('mark');
        for (const mark of marks) {
            const ids = (mark.dataset.commentIds || '').split(',').map(Number);
            const comment = (CommentsView.comments || []).find(c => ids.includes(c.id));
            if (comment && comment.start_offset === startOffset) {
                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                mark.classList.add('hl-active');
                setTimeout(() => mark.classList.remove('hl-active'), 2000);
                return;
            }
        }
    },

    // Selection handler — shows 3-button toolbar on text selection
    // Tracks cursor position for reliable placement with large selections
    attachSelectionHandler(container) {
        if (!container) return;
        if (this._selectionCleanup) this._selectionCleanup();

        const textEl = container.querySelector('.file-text-content') || container;
        let lastPtr = { x: 0, y: 0 };

        const showToolbar = () => {
            document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());

            const selection = window.getSelection();
            const selectedText = (selection || '').toString().trim();
            if (!selectedText || selectedText.length === 0) return;

            let range;
            try { range = selection.getRangeAt(0); } catch(e) { return; }
            const offsets = this.calculateOffsets(range, textEl);

            // Position: use range rect if reasonable, else use last cursor position
            const rect = range.getBoundingClientRect();
            let top, left;

            if (rect && rect.height > 0 && rect.height < window.innerHeight * 0.7 && rect.bottom > 0) {
                top = rect.bottom + window.scrollY + 6;
                left = rect.left + window.scrollX;
            } else {
                // Large selection or off-screen rect — use last known cursor position
                top = lastPtr.y + window.scrollY + 12;
                left = lastPtr.x + window.scrollX - 80;
            }

            // Clamp within viewport
            left = Math.max(8, Math.min(left, window.innerWidth + window.scrollX - 300));
            top = Math.min(top, window.scrollY + window.innerHeight - 60);

            const toolbar = document.createElement('div');
            toolbar.className = 'selection-toolbar';
            toolbar.style.position = 'absolute';
            toolbar.style.top = top + 'px';
            toolbar.style.left = left + 'px';
            toolbar.innerHTML =
                '<button onclick="FileViewer.startComment()" title="Додати коментар">&#128172; Коментар</button>' +
                '<button onclick="FileViewer.startSuggestion()" title="Запропонувати зміну">&#9998; Пропозиція</button>' +
                '<button onclick="FileViewer.copyQuote()" title="Скопіювати цитату">&#128203; Копіювати</button>';
            document.body.appendChild(toolbar);

            this._pendingSelection = {
                text: selectedText,
                start_offset: offsets.start,
                end_offset: offsets.end
            };

            setTimeout(() => { if (toolbar.parentNode) toolbar.remove(); }, 15000);
        };

        const onPointerMove = (e) => {
            lastPtr = { x: e.clientX || 0, y: e.clientY || 0 };
        };
        const onTouchMove = (e) => {
            const t = e.touches[0];
            if (t) lastPtr = { x: t.clientX, y: t.clientY };
        };
        const onMouseUp = () => { setTimeout(showToolbar, 30); };
        const onTouchEnd = () => { setTimeout(showToolbar, 250); };
        const onMouseDown = (e) => {
            if (!e.target.closest('.selection-toolbar')) {
                document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());
            }
        };

        textEl.addEventListener('mousemove', onPointerMove);
        textEl.addEventListener('touchmove', onTouchMove, { passive: true });
        textEl.addEventListener('mouseup', onMouseUp);
        textEl.addEventListener('touchend', onTouchEnd);
        document.addEventListener('mousedown', onMouseDown);

        this._selectionCleanup = () => {
            textEl.removeEventListener('mousemove', onPointerMove);
            textEl.removeEventListener('touchmove', onTouchMove);
            textEl.removeEventListener('mouseup', onMouseUp);
            textEl.removeEventListener('touchend', onTouchEnd);
            document.removeEventListener('mousedown', onMouseDown);
        };
    },

    calculateOffsets(range, container) {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        let charCount = 0, startOffset = 0, endOffset = 0;
        let foundStart = false;

        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node === range.startContainer) {
                startOffset = charCount + range.startOffset;
                foundStart = true;
            }
            if (node === range.endContainer) {
                endOffset = charCount + range.endOffset;
                break;
            }
            charCount += node.textContent.length;
        }

        if (!foundStart) startOffset = 0;
        return { start: startOffset, end: endOffset };
    },

    startComment() {
        document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());
        if (!this._pendingSelection) return;

        CommentsView.setAnchor({
            start_offset: this._pendingSelection.start_offset,
            end_offset: this._pendingSelection.end_offset,
            quoted_text: this._pendingSelection.text
        });

        const editorEl = document.querySelector('.sidebar-editor .ql-editor') || document.getElementById('comment-editor');
        if (editorEl) {
            editorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (CommentsView.quill) CommentsView.quill.focus();
        }
    },

    startSuggestion() {
        document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());
        if (!this._pendingSelection) return;

        CommentsView.showSuggestionForm({
            start_offset: this._pendingSelection.start_offset,
            end_offset: this._pendingSelection.end_offset,
            quoted_text: this._pendingSelection.text
        });
    },

    copyQuote() {
        document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());
        const sel = this._pendingSelection;
        if (!sel || !sel.text) { App.toast('Спочатку виділіть текст', 'warning'); return; }

        const quoteText = '\u00AB' + sel.text + '\u00BB\n\u2014 ' + this.currentFileName;
        navigator.clipboard.writeText(quoteText).then(() => {
            App.toast('Цитату скопійовано', 'success');
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = quoteText;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            App.toast('Цитату скопійовано', 'success');
        });
    },

    close() {
        if (this._selectionCleanup) { this._selectionCleanup(); this._selectionCleanup = null; }
        if (this.overlay) { this.overlay.remove(); this.overlay = null; }
        document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());
        this._pendingSelection = null;
    },

    // ═══════════════════════════════════════════════════════
    //  MODE 2: Side-by-Side Bilingual View
    // ═══════════════════════════════════════════════════════
    async showPair(projectId, fileId, fileName) {
        this.currentProjectId = projectId;
        this.currentFileId = fileId;
        this.currentFileName = fileName || '';
        this.lockedSegIdx = null;

        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay';
        this.overlay.innerHTML = `
            <div class="modal file-viewer-modal sidebyside">
                <div class="fv-header">
                    <div class="fv-header-left">
                        <span class="fv-header-icon">&#8596;</span>
                        <span class="fv-header-name">Порівняння: оригінал / переклад</span>
                    </div>
                    <button class="btn btn-secondary btn-sm" onclick="FileViewer.close()">&#10005;</button>
                </div>
                <div class="file-viewer-panels" id="fv-panels">
                    <div class="file-panel">
                        <div class="panel-label" id="fv-source-label">ОРИГІНАЛ</div>
                        <div class="panel-content" id="fv-source"><div class="loading" style="padding:30px;text-align:center">Завантаження...</div></div>
                    </div>
                    <div class="file-panel-divider"></div>
                    <div class="file-panel">
                        <div class="panel-label" id="fv-target-label">ПЕРЕКЛАД</div>
                        <div class="panel-content" id="fv-target"><div class="loading" style="padding:30px;text-align:center">Завантаження...</div></div>
                    </div>
                </div>
                <div class="fv-footer-hint">
                    &#128161; Наведіть на абзац для підсвічування відповідника. Натисніть для фіксації.
                </div>
            </div>`;

        document.body.appendChild(this.overlay);
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });

        const escHandler = (e) => {
            if (e.key === 'Escape') { this.close(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        const srcEl = document.getElementById('fv-source');
        const tgtEl = document.getElementById('fv-target');

        try {
            const data = await API.getFilePair(projectId, fileId);

            document.getElementById('fv-source-label').textContent = 'ОРИГІНАЛ \u2014 ' + (data.source_file.name || '');
            document.getElementById('fv-target-label').textContent = 'ПЕРЕКЛАД \u2014 ' + (data.target_file.name || '');

            const srcContent = this._toStr(data.source_file.content);
            const tgtContent = this._toStr(data.target_file.content);

            if (!srcContent.trim() && !tgtContent.trim()) {
                srcEl.innerHTML = '<div class="fv-empty-state"><p>Текст не витягнуто</p></div>';
                tgtEl.innerHTML = '<div class="fv-empty-state"><p>Текст не витягнуто</p></div>';
                return;
            }

            const alignment = this.alignParagraphs(srcContent, tgtContent);
            this.renderAlignedPanels(srcEl, tgtEl, alignment, srcContent, tgtContent);

            this.setupSyncScroll(srcEl, tgtEl);
        } catch (e) {
            srcEl.innerHTML = '<div class="fv-empty-state"><p>' + App.esc(e.message) + '</p></div>';
            tgtEl.innerHTML = '';
        }
    },

    // ── Gale-Church DP paragraph alignment ──
    alignParagraphs(sourceText, targetText) {
        const splitParas = (text) => {
            const byDouble = text.split(/\n\s*\n/).filter(s => s.trim());
            return byDouble.length > 1 ? byDouble : text.split('\n').filter(s => s.trim());
        };
        const src = splitParas(sourceText);
        const tgt = splitParas(targetText);

        if (src.length === 0 && tgt.length === 0) return [];
        if (src.length === 0) return tgt.map((_, i) => ({ segIdx: i, srcIdx: [], tgtIdx: [i] }));
        if (tgt.length === 0) return src.map((_, i) => ({ segIdx: i, srcIdx: [i], tgtIdx: [] }));

        if (src.length === tgt.length) {
            return src.map((_, i) => ({ segIdx: i, srcIdx: [i], tgtIdx: [i] }));
        }

        const n = src.length, m = tgt.length;
        const sL = src.map(s => s.length);
        const tL = tgt.map(s => s.length);
        const totalS = sL.reduce((a, b) => a + b, 0);
        const totalT = tL.reduce((a, b) => a + b, 0);
        const ratio = totalT > 0 ? totalS / totalT : 1;

        const costFn = (sLen, tLen) => {
            if (tLen === 0 && sLen === 0) return 0;
            if (tLen === 0) return 3;
            return Math.abs(sLen / tLen - ratio);
        };

        const INF = 1e9;
        const dp = [];
        const bt = [];
        for (let i = 0; i <= n; i++) {
            dp[i] = new Float64Array(m + 1).fill(INF);
            bt[i] = new Array(m + 1).fill(null);
        }
        dp[0][0] = 0;

        for (let i = 0; i <= n; i++) {
            for (let j = 0; j <= m; j++) {
                if (dp[i][j] === INF) continue;
                const cur = dp[i][j];
                if (i < n && j < m) {
                    const c = cur + costFn(sL[i], tL[j]);
                    if (c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c; bt[i + 1][j + 1] = [1, 1]; }
                }
                if (i + 1 < n && j < m) {
                    const c = cur + costFn(sL[i] + sL[i + 1], tL[j]);
                    if (c < dp[i + 2][j + 1]) { dp[i + 2][j + 1] = c; bt[i + 2][j + 1] = [2, 1]; }
                }
                if (i < n && j + 1 < m) {
                    const c = cur + costFn(sL[i], tL[j] + tL[j + 1]);
                    if (c < dp[i + 1][j + 2]) { dp[i + 1][j + 2] = c; bt[i + 1][j + 2] = [1, 2]; }
                }
                if (i < n) {
                    const c = cur + 3;
                    if (c < dp[i + 1][j]) { dp[i + 1][j] = c; bt[i + 1][j] = [1, 0]; }
                }
                if (j < m) {
                    const c = cur + 3;
                    if (c < dp[i][j + 1]) { dp[i][j + 1] = c; bt[i][j + 1] = [0, 1]; }
                }
            }
        }

        const segments = [];
        let i = n, j = m;
        while (i > 0 || j > 0) {
            const move = bt[i][j];
            if (!move) break;
            const [si, tj] = move;
            const srcIdx = [];
            const tgtIdx = [];
            for (let k = si; k > 0; k--) srcIdx.unshift(i - k);
            for (let k = tj; k > 0; k--) tgtIdx.unshift(j - k);
            segments.unshift({ srcIdx, tgtIdx });
            i -= si;
            j -= tj;
        }

        return segments.map((seg, idx) => ({ segIdx: idx, srcIdx: seg.srcIdx, tgtIdx: seg.tgtIdx }));
    },

    renderAlignedPanels(srcEl, tgtEl, alignment, sourceText, targetText) {
        const splitParas = (text) => {
            const byDouble = text.split(/\n\s*\n/).filter(s => s.trim());
            return byDouble.length > 1 ? byDouble : text.split('\n').filter(s => s.trim());
        };
        const srcParas = splitParas(sourceText);
        const tgtParas = splitParas(targetText);

        let srcHtml = '';
        let tgtHtml = '';

        for (const seg of alignment) {
            const idx = seg.segIdx;
            const srcText = seg.srcIdx.map(i => srcParas[i] || '').join('\n\n');
            const tgtText = seg.tgtIdx.map(i => tgtParas[i] || '').join('\n\n');

            const emptySpan = '<span class="seg-empty">\u2014</span>';
            srcHtml += `<div class="text-segment" data-seg-idx="${idx}" data-side="source">${srcText ? App.esc(srcText).replace(/\n/g, '<br>') : emptySpan}</div>`;
            tgtHtml += `<div class="text-segment" data-seg-idx="${idx}" data-side="target">${tgtText ? App.esc(tgtText).replace(/\n/g, '<br>') : emptySpan}</div>`;
        }

        srcEl.innerHTML = srcHtml;
        tgtEl.innerHTML = tgtHtml;

        const allSegs = document.querySelectorAll('.text-segment');
        allSegs.forEach(seg => {
            seg.addEventListener('mouseenter', () => {
                if (this.lockedSegIdx !== null) return;
                const idx = seg.dataset.segIdx;
                document.querySelectorAll('.text-segment[data-seg-idx="' + idx + '"]').forEach(s => s.classList.add('seg-highlight'));
            });
            seg.addEventListener('mouseleave', () => {
                if (this.lockedSegIdx !== null) return;
                document.querySelectorAll('.seg-highlight').forEach(s => s.classList.remove('seg-highlight'));
            });
            seg.addEventListener('click', () => {
                const idx = seg.dataset.segIdx;
                if (this.lockedSegIdx === idx) {
                    this.lockedSegIdx = null;
                    document.querySelectorAll('.seg-locked').forEach(s => s.classList.remove('seg-locked'));
                    return;
                }
                document.querySelectorAll('.seg-locked, .seg-highlight').forEach(s => {
                    s.classList.remove('seg-locked', 'seg-highlight');
                });
                this.lockedSegIdx = idx;
                document.querySelectorAll('.text-segment[data-seg-idx="' + idx + '"]').forEach(s => s.classList.add('seg-locked'));

                const otherSide = seg.dataset.side === 'source' ? 'target' : 'source';
                const counterpart = document.querySelector('.text-segment[data-seg-idx="' + idx + '"][data-side="' + otherSide + '"]');
                if (counterpart) counterpart.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
    },

    setupSyncScroll(srcEl, tgtEl) {
        let syncing = false;
        srcEl.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            const maxS = srcEl.scrollHeight - srcEl.clientHeight;
            if (maxS > 0) {
                const ratio = srcEl.scrollTop / maxS;
                tgtEl.scrollTop = ratio * (tgtEl.scrollHeight - tgtEl.clientHeight);
            }
            requestAnimationFrame(() => { syncing = false; });
        });
        tgtEl.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            const maxT = tgtEl.scrollHeight - tgtEl.clientHeight;
            if (maxT > 0) {
                const ratio = tgtEl.scrollTop / maxT;
                srcEl.scrollTop = ratio * (srcEl.scrollHeight - srcEl.clientHeight);
            }
            requestAnimationFrame(() => { syncing = false; });
        });
    }
};
