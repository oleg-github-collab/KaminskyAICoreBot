/**
 * Advanced Diff Viewer
 * Side-by-side and unified diff visualization
 */

class DiffViewer {
    constructor() {
        this.mode = 'side-by-side'; // or 'unified'
    }

    /**
     * Generate diff HTML for two texts
     * @param {string} oldText
     * @param {string} newText
     * @param {Object} options
     * @returns {string} HTML
     */
    diff(oldText, newText, options = {}) {
        const diffs = this.computeDiff(oldText, newText);

        if (this.mode === 'side-by-side') {
            return this.renderSideBySide(diffs, options);
        } else {
            return this.renderUnified(diffs, options);
        }
    }

    /**
     * Compute character-level diff using simplified algorithm
     */
    computeDiff(oldText, newText) {
        // Split into words for better readability
        const oldWords = this.tokenize(oldText);
        const newWords = this.tokenize(newText);

        const diffs = [];
        let i = 0, j = 0;

        while (i < oldWords.length || j < newWords.length) {
            // Equal
            if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) {
                diffs.push({ type: 'equal', old: oldWords[i], new: newWords[j] });
                i++;
                j++;
            }
            // Deletion
            else if (i < oldWords.length && (j >= newWords.length || oldWords[i] !== newWords[j])) {
                diffs.push({ type: 'delete', old: oldWords[i] });
                i++;
            }
            // Insertion
            else if (j < newWords.length) {
                diffs.push({ type: 'insert', new: newWords[j] });
                j++;
            }
        }

        return diffs;
    }

    tokenize(text) {
        // Split by words and spaces, keeping both
        return text.match(/\S+|\s+/g) || [];
    }

    renderSideBySide(diffs, options) {
        const title = options.title || 'Порівняння версій';
        const oldLabel = options.oldLabel || 'Стара версія';
        const newLabel = options.newLabel || 'Нова версія';

        let oldHtml = '';
        let newHtml = '';
        let oldLine = 1, newLine = 1;

        diffs.forEach(diff => {
            switch (diff.type) {
                case 'equal':
                    const text = App.esc(diff.old);
                    oldHtml += `<div class="diff-line diff-equal"><span class="line-num">${oldLine++}</span><span class="line-content">${text}</span></div>`;
                    newHtml += `<div class="diff-line diff-equal"><span class="line-num">${newLine++}</span><span class="line-content">${text}</span></div>`;
                    break;
                case 'delete':
                    oldHtml += `<div class="diff-line diff-delete"><span class="line-num">${oldLine++}</span><span class="line-content">${App.esc(diff.old)}</span></div>`;
                    newHtml += `<div class="diff-line diff-empty"><span class="line-num"></span><span class="line-content"></span></div>`;
                    break;
                case 'insert':
                    oldHtml += `<div class="diff-line diff-empty"><span class="line-num"></span><span class="line-content"></span></div>`;
                    newHtml += `<div class="diff-line diff-insert"><span class="line-num">${newLine++}</span><span class="line-content">${App.esc(diff.new)}</span></div>`;
                    break;
            }
        });

        return `
            <div class="diff-viewer-container">
                <div class="diff-header">
                    <h3>${App.esc(title)}</h3>
                    <div class="diff-controls">
                        <button class="btn btn-sm" onclick="DiffViewerInstance.toggleMode()">
                            <span class="icon">⇄</span> Змінити вид
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                            Закрити
                        </button>
                    </div>
                </div>
                <div class="diff-side-by-side">
                    <div class="diff-pane diff-pane-old">
                        <div class="diff-pane-header">${App.esc(oldLabel)}</div>
                        <div class="diff-content">${oldHtml}</div>
                    </div>
                    <div class="diff-pane diff-pane-new">
                        <div class="diff-pane-header">${App.esc(newLabel)}</div>
                        <div class="diff-content">${newHtml}</div>
                    </div>
                </div>
                <div class="diff-stats">
                    ${this.renderStats(diffs)}
                </div>
            </div>
        `;
    }

    renderUnified(diffs, options) {
        const title = options.title || 'Порівняння версій';
        let html = '';
        let lineNum = 1;

        diffs.forEach(diff => {
            switch (diff.type) {
                case 'equal':
                    html += `<div class="diff-line diff-equal"><span class="line-num">${lineNum++}</span><span class="line-content">${App.esc(diff.old)}</span></div>`;
                    break;
                case 'delete':
                    html += `<div class="diff-line diff-delete"><span class="line-num">-</span><span class="line-content">${App.esc(diff.old)}</span></div>`;
                    break;
                case 'insert':
                    html += `<div class="diff-line diff-insert"><span class="line-num">+</span><span class="line-content">${App.esc(diff.new)}</span></div>`;
                    lineNum++;
                    break;
            }
        });

        return `
            <div class="diff-viewer-container">
                <div class="diff-header">
                    <h3>${App.esc(title)}</h3>
                    <div class="diff-controls">
                        <button class="btn btn-sm" onclick="DiffViewerInstance.toggleMode()">
                            <span class="icon">⇄</span> Змінити вид
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="this.closest('.modal-overlay').remove()">
                            Закрити
                        </button>
                    </div>
                </div>
                <div class="diff-unified">
                    <div class="diff-content">${html}</div>
                </div>
                <div class="diff-stats">
                    ${this.renderStats(diffs)}
                </div>
            </div>
        `;
    }

    renderStats(diffs) {
        const stats = {
            additions: diffs.filter(d => d.type === 'insert').length,
            deletions: diffs.filter(d => d.type === 'delete').length,
            unchanged: diffs.filter(d => d.type === 'equal').length
        };

        const total = stats.additions + stats.deletions + stats.unchanged;
        const addPct = ((stats.additions / total) * 100).toFixed(1);
        const delPct = ((stats.deletions / total) * 100).toFixed(1);

        return `
            <div class="diff-stat-bar">
                <div class="diff-stat-section diff-stat-add" style="width: ${addPct}%" title="${stats.additions} додано"></div>
                <div class="diff-stat-section diff-stat-del" style="width: ${delPct}%" title="${stats.deletions} видалено"></div>
            </div>
            <div class="diff-stat-text">
                <span class="stat-add">+${stats.additions}</span>
                <span class="stat-del">-${stats.deletions}</span>
                <span class="stat-unchanged">${stats.unchanged} без змін</span>
            </div>
        `;
    }

    toggleMode() {
        this.mode = this.mode === 'side-by-side' ? 'unified' : 'side-by-side';
        // Refresh current diff
        const modal = document.querySelector('.modal-overlay');
        if (modal) {
            const oldText = modal.dataset.oldText;
            const newText = modal.dataset.newText;
            if (oldText && newText) {
                this.show(oldText, newText);
            }
        }
    }

    /**
     * Show diff in modal
     */
    show(oldText, newText, options = {}) {
        const html = this.diff(oldText, newText, options);

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay modal-overlay-large';
        overlay.dataset.oldText = oldText;
        overlay.dataset.newText = newText;
        overlay.innerHTML = html;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        // Sync scroll for side-by-side
        if (this.mode === 'side-by-side') {
            const oldPane = overlay.querySelector('.diff-pane-old .diff-content');
            const newPane = overlay.querySelector('.diff-pane-new .diff-content');

            oldPane.addEventListener('scroll', () => {
                newPane.scrollTop = oldPane.scrollTop;
            });

            newPane.addEventListener('scroll', () => {
                oldPane.scrollTop = newPane.scrollTop;
            });
        }
    }
}

// Global instance
window.DiffViewerInstance = new DiffViewer();

// Add CSS
const style = document.createElement('style');
style.textContent = `
    .modal-overlay-large .diff-viewer-container {
        width: 90vw;
        max-width: 1400px;
        height: 80vh;
        background: var(--bg);
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .diff-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border);
        background: var(--bg-secondary);
    }

    .diff-header h3 {
        margin: 0;
        font-size: 18px;
    }

    .diff-controls {
        display: flex;
        gap: 8px;
    }

    .diff-side-by-side {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1px;
        background: var(--border);
        flex: 1;
        overflow: hidden;
    }

    .diff-pane {
        background: var(--bg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .diff-pane-header {
        padding: 8px 12px;
        background: var(--bg-secondary);
        font-weight: 600;
        font-size: 14px;
        border-bottom: 1px solid var(--border);
    }

    .diff-content {
        flex: 1;
        overflow-y: auto;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 13px;
        line-height: 1.6;
    }

    .diff-line {
        display: flex;
        align-items: center;
        padding: 2px 8px;
        min-height: 24px;
    }

    .line-num {
        width: 50px;
        flex-shrink: 0;
        text-align: right;
        padding-right: 12px;
        color: var(--text-secondary);
        font-size: 11px;
        user-select: none;
    }

    .line-content {
        flex: 1;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .diff-equal {
        background: var(--bg);
    }

    .diff-delete {
        background: #ffeef0;
        color: #24292e;
    }

    .diff-delete .line-num {
        background: #ffdce0;
        color: #d73a49;
    }

    .diff-insert {
        background: #e6ffed;
        color: #24292e;
    }

    .diff-insert .line-num {
        background: #cdffd8;
        color: #22863a;
    }

    .diff-empty {
        background: #fafbfc;
    }

    .diff-unified {
        flex: 1;
        overflow: hidden;
    }

    .diff-stats {
        padding: 12px 20px;
        border-top: 1px solid var(--border);
        background: var(--bg-secondary);
    }

    .diff-stat-bar {
        height: 8px;
        border-radius: 4px;
        display: flex;
        overflow: hidden;
        background: var(--border);
        margin-bottom: 8px;
    }

    .diff-stat-section {
        height: 100%;
    }

    .diff-stat-add {
        background: #2ea44f;
    }

    .diff-stat-del {
        background: #d73a49;
    }

    .diff-stat-text {
        display: flex;
        gap: 16px;
        font-size: 13px;
    }

    .stat-add {
        color: #2ea44f;
        font-weight: 600;
    }

    .stat-del {
        color: #d73a49;
        font-weight: 600;
    }

    .stat-unchanged {
        color: var(--text-secondary);
    }

    @media (prefers-color-scheme: dark) {
        .diff-delete {
            background: #4c1f1f;
            color: #f0f0f0;
        }

        .diff-delete .line-num {
            background: #7a1f1f;
            color: #ff7b7b;
        }

        .diff-insert {
            background: #1f4c2f;
            color: #f0f0f0;
        }

        .diff-insert .line-num {
            background: #2f7a3f;
            color: #7bff9b;
        }

        .diff-empty {
            background: #1a1a1a;
        }
    }
`;
document.head.appendChild(style);
