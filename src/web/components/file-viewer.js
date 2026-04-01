const FileViewer = {
    currentFileId: null,
    currentFileName: '',
    currentContent: '',
    currentProjectId: null,
    overlay: null,
    lockedSegIdx: null,
    _pendingSelection: null,
    _selectionCleanup: null,

    // ═══════════════════════════════════════════════════════
    //  Smart text formatting — paragraphs, headings, lists
    // ═══════════════════════════════════════════════════════
    formatText(raw) {
        if (!raw || !raw.trim()) return '';

        // Split into paragraphs by double newlines (or 3+ newlines)
        const blocks = raw.split(/\n{2,}/).filter(b => b.trim());
        if (blocks.length === 0) return '<p class="fv-para">' + App.esc(raw) + '</p>';

        let html = '';
        for (const block of blocks) {
            const trimmed = block.trim();
            if (!trimmed) continue;

            // Detect headings: ALL CAPS short lines, or lines like "Chapter N", "Section N", numbered headings
            const lines = trimmed.split('\n');
            const firstLine = lines[0].trim();

            // Heading: short ALL CAPS line (3-80 chars, >60% uppercase letters)
            const letters = firstLine.replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ]/g, '');
            const upper = firstLine.replace(/[^A-ZА-ЯІЇЄҐ]/g, '');
            const isAllCaps = letters.length > 2 && firstLine.length <= 80 && letters.length > 0 && (upper.length / letters.length) > 0.6;

            // Heading: numbered like "1.", "1.1", "I.", "Chapter", "Розділ", "Глава", etc.
            const isNumbered = /^(\d+[\.\)]\s|[IVXLC]+[\.\)]\s|Chapter\s|Розділ\s|Глава\s|Частина\s|CHAPTER\s|SECTION\s|Abschnitt\s|Kapitel\s|Teil\s)/i.test(firstLine);

            // Heading: very short standalone line (likely a title)
            const isShortTitle = lines.length === 1 && firstLine.length <= 60 && firstLine.length >= 2 && !/[.,:;!?]$/.test(firstLine);

            // List detection: lines starting with - * or numbered
            const isList = lines.every(l => /^\s*[-*•]\s/.test(l) || /^\s*\d+[\.\)]\s/.test(l));

            if (isList) {
                const items = lines.map(l => {
                    const text = l.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[\.\)]\s*/, '').trim();
                    return '<li>' + App.esc(text) + '</li>';
                });
                const isOrdered = lines.every(l => /^\s*\d+[\.\)]\s/.test(l));
                html += (isOrdered ? '<ol class="fv-list">' : '<ul class="fv-list">') + items.join('') + (isOrdered ? '</ol>' : '</ul>');
            } else if (isAllCaps || (isNumbered && firstLine.length <= 100)) {
                // Heading + optional body
                html += '<h3 class="fv-heading">' + App.esc(firstLine) + '</h3>';
                if (lines.length > 1) {
                    const rest = lines.slice(1).join('\n').trim();
                    if (rest) html += '<p class="fv-para">' + App.esc(rest).replace(/\n/g, '<br>') + '</p>';
                }
            } else if (isShortTitle && lines.length === 1) {
                html += '<h4 class="fv-subheading">' + App.esc(firstLine) + '</h4>';
            } else {
                // Regular paragraph: preserve single newlines as <br>
                html += '<p class="fv-para">' + App.esc(trimmed).replace(/\n/g, '<br>') + '</p>';
            }
        }
        return html;
    },

    // Same but for raw content string → keeps offsets intact for highlighting
    formatTextPreservingOffsets(raw) {
        if (!raw || !raw.trim()) return App.esc(raw || '');
        // For highlighted content we can't restructure into <p>/<h3> because it breaks offset calculations
        // Instead, add visual paragraph spacing via CSS on newline sequences
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

        const tryLoad = async () => {
            const data = await API.getFileContent(projectId, fileId);
            this.currentContent = data.content || '';
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
                        <p class="fv-empty-title">Не вдалося завантажити текст</p>
                        <p class="fv-empty-detail">${App.esc(e2.message)}</p>
                        <button class="btn btn-primary btn-sm" style="margin-top:12px"
                            onclick="FileViewer.loadContent(${projectId}, ${fileId})">
                            &#8635; Спробувати знову
                        </button>
                    </div>`;
            }
        }
    },

    renderSingleContent(container, content) {
        if (!content || content.length === 0) {
            container.innerHTML = '<div class="fv-empty-state"><div class="fv-empty-icon">&#128196;</div><p class="fv-empty-title">Файл порожній або текст не витягнуто</p></div>';
            return;
        }
        const formatted = this.formatText(content);
        container.innerHTML = `<div class="file-text-content" id="fv-text">${formatted}</div>`;
        this.attachSelectionHandler(container);
    },

    // Rebuild text with highlight marks from comments
    rebuildHighlights() {
        const textEl = document.getElementById('fv-text');
        if (!textEl || !this.currentContent) return;

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
    attachSelectionHandler(container) {
        if (!container) return;
        if (this._selectionCleanup) this._selectionCleanup();

        const textEl = container.querySelector('.file-text-content') || container;

        const onMouseUp = () => {
            document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());

            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            if (!selectedText || selectedText.length === 0) return;

            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const offsets = this.calculateOffsets(range, textEl);

            const toolbar = document.createElement('div');
            toolbar.className = 'selection-toolbar';
            toolbar.style.top = `${rect.bottom + window.scrollY + 6}px`;
            toolbar.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
            toolbar.innerHTML = `
                <button onclick="FileViewer.startComment()" title="Додати коментар">&#128172; Коментар</button>
                <button onclick="FileViewer.startSuggestion()" title="Запропонувати зміну">&#9998; Пропозиція</button>
                <button onclick="FileViewer.copyQuote()" title="Скопіювати цитату">&#128203; Копіювати</button>`;
            document.body.appendChild(toolbar);

            this._pendingSelection = {
                text: selectedText,
                start_offset: offsets.start,
                end_offset: offsets.end
            };

            setTimeout(() => toolbar.remove(), 8000);
        };

        const onMouseDown = (e) => {
            if (!e.target.closest('.selection-toolbar')) {
                document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());
            }
        };

        textEl.addEventListener('mouseup', onMouseUp);
        document.addEventListener('mousedown', onMouseDown);

        this._selectionCleanup = () => {
            textEl.removeEventListener('mouseup', onMouseUp);
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

            if (!data.source_file.content && !data.target_file.content) {
                srcEl.innerHTML = '<div class="fv-empty-state"><p>Текст не витягнуто</p></div>';
                tgtEl.innerHTML = '<div class="fv-empty-state"><p>Текст не витягнуто</p></div>';
                return;
            }

            const alignment = this.alignParagraphs(
                data.source_file.content || '',
                data.target_file.content || ''
            );

            this.renderAlignedPanels(srcEl, tgtEl, alignment,
                data.source_file.content || '',
                data.target_file.content || ''
            );

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
