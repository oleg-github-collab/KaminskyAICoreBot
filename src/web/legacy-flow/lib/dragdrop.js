/**
 * Universal Drag & Drop System
 * Enterprise-grade drag-drop for all components
 */

class DragDropManager {
    constructor() {
        this.handlers = new Map();
        this.currentDrag = null;
        this.dropZones = new Set();
    }

    /**
     * Register a draggable element
     * @param {HTMLElement} element
     * @param {Object} options - { type, data, onStart, onEnd, handle, ghost }
     */
    makeDraggable(element, options) {
        const handle = options.handle ? element.querySelector(options.handle) : element;
        if (!handle) return;

        handle.style.cursor = 'grab';
        handle.draggable = true;

        handle.addEventListener('dragstart', (e) => {
            handle.style.cursor = 'grabbing';
            this.currentDrag = {
                type: options.type,
                data: options.data,
                element: element
            };

            // Set drag image (ghost)
            if (options.ghost) {
                const ghost = options.ghost(element, options.data);
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 0, 0);
                setTimeout(() => ghost.remove(), 0);
            }

            e.dataTransfer.effectAllowed = 'all';
            e.dataTransfer.setData('text/plain', JSON.stringify({
                type: options.type,
                data: options.data
            }));

            element.classList.add('dragging');
            document.body.classList.add('dragging-active');

            if (options.onStart) options.onStart(e, options.data);
        });

        handle.addEventListener('dragend', (e) => {
            handle.style.cursor = 'grab';
            element.classList.remove('dragging');
            document.body.classList.remove('dragging-active');
            this.currentDrag = null;

            if (options.onEnd) options.onEnd(e, options.data);
        });
    }

    /**
     * Register a drop zone
     * @param {HTMLElement} element
     * @param {Object} options - { accept, onDrop, onDragOver, onDragLeave, canDrop }
     */
    makeDropZone(element, options) {
        this.dropZones.add(element);

        element.addEventListener('dragover', (e) => {
            if (!this.currentDrag) return;

            // Check if this drop zone accepts the dragged type
            const accepts = Array.isArray(options.accept) ? options.accept : [options.accept];
            if (!accepts.includes(this.currentDrag.type) && options.accept !== '*') {
                return;
            }

            // Check custom canDrop predicate
            if (options.canDrop && !options.canDrop(this.currentDrag.data)) {
                element.classList.remove('drop-zone-over');
                return;
            }

            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            element.classList.add('drop-zone-over');

            if (options.onDragOver) {
                options.onDragOver(e, this.currentDrag.data);
            }
        });

        element.addEventListener('dragleave', (e) => {
            // Only if leaving the drop zone (not child elements)
            if (e.target === element) {
                element.classList.remove('drop-zone-over');
                if (options.onDragLeave) {
                    options.onDragLeave(e);
                }
            }
        });

        element.addEventListener('drop', async (e) => {
            e.preventDefault();
            element.classList.remove('drop-zone-over');

            if (!this.currentDrag) {
                // Handle file drops
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    if (options.onFileDrop) {
                        options.onFileDrop(Array.from(e.dataTransfer.files));
                    }
                    return;
                }
                return;
            }

            const accepts = Array.isArray(options.accept) ? options.accept : [options.accept];
            if (!accepts.includes(this.currentDrag.type) && options.accept !== '*') {
                return;
            }

            if (options.canDrop && !options.canDrop(this.currentDrag.data)) {
                App.toast('Неможливо перемістити сюди', 'warning');
                return;
            }

            if (options.onDrop) {
                try {
                    await options.onDrop(this.currentDrag.data, e);
                    App.toast('✓ Переміщено', 'success');
                } catch (err) {
                    console.error('Drop failed:', err);
                    App.toast('Помилка при переміщенні', 'error');
                }
            }
        });
    }

    /**
     * Make a list sortable via drag-drop
     * @param {HTMLElement} list - Container element
     * @param {Object} options - { itemSelector, handle, onReorder, animation }
     */
    makeSortable(list, options) {
        const items = list.querySelectorAll(options.itemSelector);
        let draggedItem = null;

        items.forEach((item, index) => {
            this.makeDraggable(item, {
                type: 'sortable-item',
                data: { item, index },
                handle: options.handle,
                onStart: () => {
                    draggedItem = item;
                    item.style.opacity = '0.4';
                },
                onEnd: () => {
                    item.style.opacity = '1';
                    draggedItem = null;
                }
            });

            item.addEventListener('dragover', (e) => {
                if (!draggedItem || draggedItem === item) return;
                e.preventDefault();

                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const insertBefore = e.clientY < midY;

                if (insertBefore) {
                    list.insertBefore(draggedItem, item);
                } else {
                    list.insertBefore(draggedItem, item.nextSibling);
                }
            });
        });

        list.addEventListener('drop', async (e) => {
            e.preventDefault();
            if (!draggedItem) return;

            // Get new order
            const newOrder = Array.from(list.querySelectorAll(options.itemSelector)).map(el => {
                return el.dataset.id || el.id;
            });

            if (options.onReorder) {
                try {
                    await options.onReorder(newOrder);
                    if (options.animation !== false) {
                        App.toast('✓ Порядок оновлено', 'success');
                    }
                } catch (err) {
                    console.error('Reorder failed:', err);
                    App.toast('Не вдалося змінити порядок', 'error');
                }
            }
        });
    }

    /**
     * Create a visual drop indicator
     */
    createDropIndicator(text) {
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.innerHTML = `
            <div class="drop-indicator-icon">📥</div>
            <div class="drop-indicator-text">${App.esc(text || 'Перетягніть сюди')}</div>
        `;
        return indicator;
    }

    /**
     * Enable file drag-drop for an area
     * @param {HTMLElement} area
     * @param {Function} onFiles - callback(files)
     */
    enableFileDrop(area, onFiles, options = {}) {
        let dragCounter = 0;
        const overlay = document.createElement('div');
        overlay.className = 'file-drop-overlay';
        overlay.innerHTML = `
            <div class="file-drop-content">
                <div class="file-drop-icon">📁</div>
                <div class="file-drop-text">${App.esc(options.text || 'Перетягніть файли сюди')}</div>
                ${options.subtitle ? `<div class="file-drop-subtitle">${App.esc(options.subtitle)}</div>` : ''}
            </div>
        `;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            area.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        area.addEventListener('dragenter', (e) => {
            dragCounter++;
            if (dragCounter === 1) {
                area.appendChild(overlay);
                area.classList.add('file-drop-active');
            }
        });

        area.addEventListener('dragleave', (e) => {
            dragCounter--;
            if (dragCounter === 0) {
                overlay.remove();
                area.classList.remove('file-drop-active');
            }
        });

        area.addEventListener('drop', async (e) => {
            dragCounter = 0;
            overlay.remove();
            area.classList.remove('file-drop-active');

            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) return;

            // Filter by accepted types if specified
            let filtered = files;
            if (options.accept) {
                const accepts = options.accept.split(',').map(a => a.trim());
                filtered = files.filter(f => {
                    return accepts.some(accept => {
                        if (accept.startsWith('.')) {
                            return f.name.endsWith(accept);
                        } else if (accept.includes('*')) {
                            const regex = new RegExp('^' + accept.replace('*', '.*') + '$');
                            return regex.test(f.type);
                        } else {
                            return f.type === accept;
                        }
                    });
                });
            }

            if (filtered.length === 0 && options.accept) {
                App.toast('Непідтримуваний тип файлів', 'warning');
                return;
            }

            // Check max size
            if (options.maxSize) {
                const tooBig = filtered.find(f => f.size > options.maxSize);
                if (tooBig) {
                    App.toast(`Файл ${tooBig.name} завеликий (макс. ${App.fmtSize(options.maxSize)})`, 'error');
                    return;
                }
            }

            // Check max count
            if (options.maxFiles && filtered.length > options.maxFiles) {
                App.toast(`Максимум ${options.maxFiles} файлів одночасно`, 'warning');
                filtered = filtered.slice(0, options.maxFiles);
            }

            if (onFiles) {
                await onFiles(filtered);
            }
        });
    }
}

// Global instance
window.DragDrop = new DragDropManager();

// Add CSS for drag-drop effects
const style = document.createElement('style');
style.textContent = `
    .dragging {
        opacity: 0.5;
        cursor: grabbing !important;
    }

    .dragging-active * {
        cursor: grabbing !important;
    }

    .drop-zone-over {
        background: var(--primary-light) !important;
        border: 2px dashed var(--primary) !important;
        box-shadow: 0 0 0 4px rgba(var(--primary-rgb), 0.1) !important;
    }

    .drop-indicator {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
        background: var(--bg-secondary);
        border: 2px dashed var(--border);
        border-radius: 8px;
        color: var(--text-secondary);
        font-size: 14px;
    }

    .drop-indicator-icon {
        font-size: 32px;
    }

    .file-drop-overlay {
        position: absolute;
        inset: 0;
        background: rgba(var(--primary-rgb), 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        pointer-events: none;
        animation: dropFadeIn 0.2s ease;
    }

    .file-drop-content {
        text-align: center;
        color: white;
    }

    .file-drop-icon {
        font-size: 64px;
        margin-bottom: 16px;
        animation: dropBounce 1s infinite;
    }

    .file-drop-text {
        font-size: 24px;
        font-weight: 600;
        margin-bottom: 8px;
    }

    .file-drop-subtitle {
        font-size: 14px;
        opacity: 0.9;
    }

    .file-drop-active {
        position: relative;
    }

    @keyframes dropFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @keyframes dropBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
    }

    .role-badge {
        display: inline-block;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        background: var(--bg-secondary);
        color: var(--text);
        border: 2px solid var(--border);
        margin-right: 12px;
        white-space: nowrap;
    }

    .role-owner { background: #ffd700; color: #000; }
    .role-admin { background: #ff6b6b; color: #fff; }
    .role-translator { background: #4ecdc4; color: #fff; }
    .role-reviewer { background: #95e1d3; color: #000; }
    .role-client { background: #a8dadc; color: #000; }
    .role-guest { background: #e0e0e0; color: #666; }
`;
document.head.appendChild(style);
