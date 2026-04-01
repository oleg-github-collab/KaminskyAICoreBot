const FileViewer = {
    currentFileId: null,
    currentFileName: '',
    currentContent: '',
    currentProjectId: null,
    overlay: null,
    lockedSegIdx: null,
    _pendingSelection: null,

    // ═══════════════════════════════════════════════════════
    //  MODE 1: Single file + Comments sidebar + Color coding
    // ═══════════════════════════════════════════════════════
    async show(projectId, fileId, fileName) {
        this.currentFileId = fileId;
        this.currentFileName = fileName;
        this.currentProjectId = projectId;
        this.currentContent = '';

        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay';
        this.overlay.innerHTML = `
            <div class="modal file-viewer-modal with-comments">
                <div class="file-viewer-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
                    <h3 style="margin:0;font-size:15px">📄 ${App.esc(fileName)}</h3>
                    <button class="btn btn-secondary btn-sm" onclick="FileViewer.close()">Закрити</button>
                </div>
                <div class="file-viewer-body">
                    <div class="file-viewer-main" id="fv-main">
                        <div class="loading">Завантаження...</div>
                    </div>
                    <div class="file-viewer-sidebar" id="fv-sidebar"></div>
                </div>
                <div style="padding:8px 16px;border-top:1px solid var(--border);font-size:12px;color:var(--hint)">
                    💡 Виділіть текст для коментування, пропозицій або копіювання
                </div>
            </div>`;

        document.body.appendChild(this.overlay);
        this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });

        const escHandler = (e) => {
            if (e.key === 'Escape') { this.close(); document.removeEventListener('keydown', escHandler); }
        };
        document.addEventListener('keydown', escHandler);

        // Load content and comments in parallel
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

        try {
            const data = await API.getFileContent(projectId, fileId);
            this.currentContent = data.content || '';
            this.renderSingleContent(main, this.currentContent);
        } catch (e) {
            main.innerHTML = `
                <div class="empty" style="padding:40px;text-align:center">
                    <div style="font-size:48px;margin-bottom:12px">📄</div>
                    <p>Текст недоступний</p>
                    <p style="font-size:13px;color:var(--hint);margin-top:8px">
                        Файл ще обробляється або текст недоступний для цього формату.
                    </p>
                </div>`;
        }
    },

    renderSingleContent(container, content) {
        if (!content || content.length === 0) {
            container.innerHTML = '<div class="empty" style="padding:40px"><p>Файл порожній або текст не витягнуто</p></div>';
            return;
        }
        container.innerHTML = `<div class="file-text-content" id="fv-text">${App.esc(content).replace(/\n/g, '<br>')}</div>`;
        this.attachSelectionHandler(container);
    },

    // Rebuild text with highlight marks from comments
    rebuildHighlights() {
        const textEl = document.getElementById('fv-text');
        if (!textEl || !this.currentContent) return;

        const comments = CommentsView.comments || [];
        const anchored = comments.filter(c => c.start_offset != null && c.end_offset != null && c.start_offset !== c.end_offset);

        if (anchored.length === 0) {
            textEl.innerHTML = App.esc(this.currentContent).replace(/\n/g, '<br>');
            this.attachSelectionHandler(textEl.parentElement);
            return;
        }

        // Sort by start_offset
        anchored.sort((a, b) => a.start_offset - b.start_offset || (b.end_offset - b.start_offset) - (a.end_offset - a.start_offset));

        // Build non-overlapping spans
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

        let html = '';
        for (const sp of spans) {
            const escaped = App.esc(sp.text).replace(/\n/g, '<br>');
            if (sp.cls) {
                html += `<mark class="${sp.cls}" data-comment-ids="${(sp.ids || []).join(',')}" onclick="FileViewer.onHighlightClick(event)">${escaped}</mark>`;
            } else {
                html += escaped;
            }
        }
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
            commentEl.style.outline = '2px solid var(--btn)';
            setTimeout(() => commentEl.style.outline = '', 2000);
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

    // Selection handler — shows 3-button toolbar
    attachSelectionHandler(container) {
        if (!container) return;
        const textEl = container.querySelector('.file-text-content') || container;

        textEl.addEventListener('mouseup', () => {
            document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());

            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            if (!selectedText || selectedText.length === 0) return;

            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const offsets = this.calculateOffsets(range, textEl);

            const toolbar = document.createElement('div');
            toolbar.className = 'selection-toolbar';
            toolbar.style.top = `${rect.bottom + 5}px`;
            toolbar.style.left = `${Math.max(8, rect.left)}px`;
            toolbar.innerHTML = `
                <button onclick="FileViewer.startComment()">💬 Коментар</button>
                <button onclick="FileViewer.startSuggestion()">✏️ Пропозиція</button>
                <button onclick="FileViewer.copyQuote()">📋 Копіювати</button>`;
            document.body.appendChild(toolbar);

            this._pendingSelection = {
                text: selectedText,
                start_offset: offsets.start,
                end_offset: offsets.end
            };

            setTimeout(() => toolbar.remove(), 8000);
        });

        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.selection-toolbar')) {
                document.querySelectorAll('.selection-toolbar').forEach(t => t.remove());
            }
        });
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

        if (CommentsView.quill) CommentsView.quill.focus();
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
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();
        if (!selectedText) { App.toast('Спочатку виділіть текст', 'warning'); return; }

        const quoteText = `«${selectedText}»\n— ${this.currentFileName}`;
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
                <div class="file-viewer-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
                    <h3 style="margin:0;font-size:15px">↔ Порівняння: оригінал / переклад</h3>
                    <button class="btn btn-secondary btn-sm" onclick="FileViewer.close()">Закрити</button>
                </div>
                <div class="file-viewer-panels" id="fv-panels">
                    <div class="file-panel">
                        <div class="panel-label" id="fv-source-label">ОРИГІНАЛ</div>
                        <div class="panel-content" id="fv-source"><div class="loading">Завантаження...</div></div>
                    </div>
                    <div class="file-panel-divider"></div>
                    <div class="file-panel">
                        <div class="panel-label" id="fv-target-label">ПЕРЕКЛАД</div>
                        <div class="panel-content" id="fv-target"><div class="loading">Завантаження...</div></div>
                    </div>
                </div>
                <div style="padding:8px 16px;border-top:1px solid var(--border);font-size:12px;color:var(--hint)">
                    💡 Наведіть на абзац для підсвічування відповідника. Натисніть для фіксації.
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

            document.getElementById('fv-source-label').textContent = `ОРИГІНАЛ — ${data.source_file.name}`;
            document.getElementById('fv-target-label').textContent = `ПЕРЕКЛАД — ${data.target_file.name}`;

            if (!data.source_file.content && !data.target_file.content) {
                srcEl.innerHTML = '<div class="empty" style="padding:30px"><p>Текст не витягнуто</p></div>';
                tgtEl.innerHTML = '<div class="empty" style="padding:30px"><p>Текст не витягнуто</p></div>';
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
            srcEl.innerHTML = `<div class="empty"><p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p></div>`;
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

        // Fast path: equal count → 1:1
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
                // 1:1
                if (i < n && j < m) {
                    const c = cur + costFn(sL[i], tL[j]);
                    if (c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c; bt[i + 1][j + 1] = [1, 1]; }
                }
                // 2:1
                if (i + 1 < n && j < m) {
                    const c = cur + costFn(sL[i] + sL[i + 1], tL[j]);
                    if (c < dp[i + 2][j + 1]) { dp[i + 2][j + 1] = c; bt[i + 2][j + 1] = [2, 1]; }
                }
                // 1:2
                if (i < n && j + 1 < m) {
                    const c = cur + costFn(sL[i], tL[j] + tL[j + 1]);
                    if (c < dp[i + 1][j + 2]) { dp[i + 1][j + 2] = c; bt[i + 1][j + 2] = [1, 2]; }
                }
                // Skip source
                if (i < n) {
                    const c = cur + 3;
                    if (c < dp[i + 1][j]) { dp[i + 1][j] = c; bt[i + 1][j] = [1, 0]; }
                }
                // Skip target
                if (j < m) {
                    const c = cur + 3;
                    if (c < dp[i][j + 1]) { dp[i][j + 1] = c; bt[i][j + 1] = [0, 1]; }
                }
            }
        }

        // Backtrack
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

            const emptySpan = '<span style="color:var(--hint);font-style:italic">—</span>';
            srcHtml += `<div class="text-segment" data-seg-idx="${idx}" data-side="source">${srcText ? App.esc(srcText) : emptySpan}</div>`;
            tgtHtml += `<div class="text-segment" data-seg-idx="${idx}" data-side="target">${tgtText ? App.esc(tgtText) : emptySpan}</div>`;
        }

        srcEl.innerHTML = srcHtml;
        tgtEl.innerHTML = tgtHtml;

        // Cross-highlight events
        const allSegs = document.querySelectorAll('.text-segment');
        allSegs.forEach(seg => {
            seg.addEventListener('mouseenter', () => {
                if (this.lockedSegIdx !== null) return;
                const idx = seg.dataset.segIdx;
                document.querySelectorAll(`.text-segment[data-seg-idx="${idx}"]`).forEach(s => s.classList.add('seg-highlight'));
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
                document.querySelectorAll(`.text-segment[data-seg-idx="${idx}"]`).forEach(s => s.classList.add('seg-locked'));

                const otherSide = seg.dataset.side === 'source' ? 'target' : 'source';
                const counterpart = document.querySelector(`.text-segment[data-seg-idx="${idx}"][data-side="${otherSide}"]`);
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
