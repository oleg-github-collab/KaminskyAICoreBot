/**
 * Instructions Manager
 * Drag-and-drop instructions that generate prompts for glossary creation
 */

const InstructionsView = {
    instructions: [],

    async render(container, project) {
        if (!project) {
            container.innerHTML = '<div class="empty"><div class="empty-icon">📝</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }

        const canEdit = RoleManager.can(PERMISSIONS.SETTINGS_EDIT);

        container.innerHTML = `
            <div class="instructions-container">
                <div class="section-header">
                    <button class="back-btn" onclick="App.backToProjects()">\u2190</button>
                    <h2>Інструкції для промптів</h2>
                    <div class="section-actions">
                        <button class="btn btn-sm btn-secondary" onclick="InstructionsView.refresh()" data-tooltip="Оновити">
                            \ud83d\udd04
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="InstructionsView.uploadWordFile()" ${canEdit ? '' : 'disabled'} data-tooltip="Завантажити файл">
                            \ud83d\udcc2 Файл
                        </button>
                        <button class="btn btn-sm btn-primary" onclick="InstructionsView.addInstruction()" ${canEdit ? '' : 'disabled'}>
                            + Додати
                        </button>
                    </div>
                </div>

                <div class="info-banner">
                    <div class="info-banner-icon">\ud83d\udca1</div>
                    <div class="info-banner-text">
                        <strong>Як це працює:</strong> Перетягніть інструкції у потрібному порядку. Можете також
                        <a href="#" onclick="event.preventDefault(); InstructionsView.uploadWordFile()" style="color:var(--btn);font-weight:600">завантажити Word/PDF файл</a>
                        з побажаннями \u2014 текст буде витягнуто автоматично.
                    </div>
                </div>

                <div class="instructions-zones">
                    <div class="instructions-library">
                        <h3>\ud83d\udcda Бібліотека</h3>
                        <div class="library-search">
                            <input type="text" id="library-search" class="search-input" placeholder="\ud83d\udd0d Шукати інструкції...">
                        </div>
                        <div id="library-list" class="instructions-list">
                            ${App.skeleton(3)}
                        </div>
                        <button class="btn btn-sm btn-block btn-secondary" onclick="InstructionsView.createTemplate()" ${canEdit ? '' : 'disabled'}>
                            + Створити шаблон
                        </button>
                    </div>

                    <div class="instructions-workspace">
                        <h3>\ud83c\udfaf Активні інструкції</h3>
                        <div id="active-instructions" class="instructions-dropzone">
                            ${App.skeleton(2)}
                        </div>

                        <div class="instructions-preview">
                            <h4>\ud83d\udcc4 Попередній перегляд промпту</h4>
                            <div id="prompt-preview" class="prompt-preview-content">
                                ${App.skeleton(3)}
                            </div>
                            <div class="preview-actions">
                                <button class="btn btn-sm btn-secondary" onclick="InstructionsView.copyPrompt()">
                                    \ud83d\udccb Копіювати
                                </button>
                                <button class="btn btn-sm btn-primary" onclick="InstructionsView.generateGlossary()" ${canEdit ? '' : 'disabled'}>
                                    \u2728 Згенерувати глосарій
                                </button>
                            </div>
                        </div>

                        <div class="instructions-stats">
                            <div class="stat-item">
                                <span class="stat-label">Активних</span>
                                <span class="stat-value" id="stat-active">0</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Символів</span>
                                <span class="stat-value" id="stat-length">0</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Токенів</span>
                                <span class="stat-value" id="stat-tokens">0</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        await this.loadInstructions(project.id);
        this.setupDragDrop();
        RoleManager.updateUI();
    },

    async loadInstructions(projectId) {
        try {
            const library = await API.getInstructionTemplates();
            this.libraryTemplates = library || this.getDefaultTemplates();

            let active = [];
            try {
                active = await API.getProjectInstructions(projectId);
            } catch (e) {
                console.warn('Instructions API error, using defaults:', e.message);
            }

            if (!active || active.length === 0) {
                const defaults = this.getDefaultTemplates();
                active = defaults.slice(0, 4);
            }
            this.activeInstructions = active;

            this.renderLibrary();
            this.renderActive();
            this.updatePromptPreview();
        } catch (err) {
            console.error('Failed to load instructions:', err);
            this.libraryTemplates = this.getDefaultTemplates();
            this.activeInstructions = this.getDefaultTemplates().slice(0, 4);
            this.renderLibrary();
            this.renderActive();
        }
    },

    getDefaultTemplates() {
        return [
            { id: 'intro', title: 'Вступна інструкція', content: 'Ви — експерт-перекладач. Ваше завдання — створити глосарій термінів на основі наданих документів.', category: 'general', icon: '\ud83d\udcd6' },
            { id: 'terminology', title: 'Термінологія', content: 'Виділіть ключові терміни, специфічні для галузі. Надайте точні переклади українською мовою.', category: 'extraction', icon: '\ud83d\udd0d' },
            { id: 'context', title: 'Контекст', content: 'Для кожного терміну надайте короткий контекст використання та приклади із документів.', category: 'extraction', icon: '\ud83d\udcdd' },
            { id: 'consistency', title: 'Консистентність', content: 'Забезпечте однаковість перекладу повторюваних термінів у різних контекстах.', category: 'quality', icon: '\u2713' },
            { id: 'domain', title: 'Галузева специфіка', content: 'Враховуйте специфіку галузі (юридична, медична, технічна тощо) при виборі перекладів.', category: 'quality', icon: '\u2699\ufe0f' },
            { id: 'abbreviations', title: 'Абревіатури', content: 'Включіть всі абревіатури та скорочення з їх розшифровкою і перекладом.', category: 'extraction', icon: '\ud83d\udd24' },
            { id: 'frequency', title: 'Частотність', content: 'Пріоритизуйте терміни за частотою використання у документах.', category: 'quality', icon: '\ud83d\udcca' },
            { id: 'format', title: 'Формат виводу', content: 'Надайте глосарій у форматі: термін (мова оригіналу) | переклад | категорія | рівень важливості.', category: 'output', icon: '\ud83d\udccb' }
        ];
    },

    renderLibrary() {
        const list = document.getElementById('library-list');
        if (!list) return;

        list.innerHTML = this.libraryTemplates.map(template => `
            <div class="instruction-card library-card"
                 draggable="true"
                 data-id="${template.id}"
                 data-template="${App.esc(JSON.stringify(template))}">
                <div class="instruction-icon">${template.icon}</div>
                <div class="instruction-content">
                    <div class="instruction-title">${App.esc(template.title)}</div>
                    <div class="instruction-preview">${App.esc(template.content.substring(0, 60))}${template.content.length > 60 ? '...' : ''}</div>
                    <span class="instruction-category">${App.esc(template.category)}</span>
                </div>
                <button class="btn btn-icon btn-sm btn-secondary" onclick="event.stopPropagation(); InstructionsView.addToActive('${template.id}')" data-tooltip="Додати">
                    +
                </button>
            </div>
        `).join('');

        document.getElementById('library-search')?.addEventListener('input', (e) => {
            this.filterLibrary(e.target.value);
        });
    },

    renderActive() {
        const list = document.getElementById('active-instructions');
        if (!list) return;

        if (this.activeInstructions.length === 0) {
            list.innerHTML = '<div class="empty-state" style="padding:24px"><p style="font-size:14px">Перетягніть інструкції сюди або натисніть "+" у бібліотеці</p></div>';
            return;
        }

        list.innerHTML = this.activeInstructions.map((instr, index) => `
            <div class="instruction-card active-card"
                 draggable="true"
                 data-id="${instr.id}"
                 data-index="${index}">
                <div class="instruction-handle">\u2630</div>
                <div class="instruction-order">${index + 1}</div>
                <div class="instruction-icon">${instr.icon}</div>
                <div class="instruction-content">
                    <div class="instruction-title">${App.esc(instr.title)}</div>
                    <div class="instruction-text">${App.esc(instr.content)}</div>
                </div>
                <div class="instruction-actions">
                    <button class="btn btn-icon btn-sm btn-secondary" onclick="InstructionsView.editInstruction(${index})" data-tooltip="Редагувати">
                        \u270f\ufe0f
                    </button>
                    <button class="btn btn-icon btn-sm" onclick="InstructionsView.removeFromActive(${index})" data-tooltip="Видалити" style="color:var(--red)">
                        \u2715
                    </button>
                </div>
            </div>
        `).join('');

        this.updateStats();
    },

    setupDragDrop() {
        const activeZone = document.getElementById('active-instructions');
        if (!activeZone) return;

        DragDrop.makeSortable(activeZone, {
            itemSelector: '.active-card',
            handle: '.instruction-handle',
            onReorder: async (newOrder) => {
                const reordered = newOrder.map(id => {
                    return this.activeInstructions.find(i => i.id === id);
                });
                this.activeInstructions = reordered;
                await this.saveInstructions();
                this.updatePromptPreview();
            }
        });

        DragDrop.makeDropZone(activeZone, {
            accept: '*',
            onDrop: (data) => {
                if (data.templateId) {
                    this.addToActive(data.templateId);
                }
            }
        });

        document.querySelectorAll('.library-card').forEach(card => {
            const templateData = JSON.parse(card.dataset.template);
            DragDrop.makeDraggable(card, {
                type: 'instruction-template',
                data: { templateId: templateData.id },
                ghost: () => {
                    const ghost = card.cloneNode(true);
                    ghost.style.opacity = '0.8';
                    ghost.style.transform = 'rotate(-3deg)';
                    return ghost;
                }
            });
        });
    },

    addToActive(templateId) {
        const template = this.libraryTemplates.find(t => t.id === templateId);
        if (!template) return;

        if (this.activeInstructions.find(i => i.id === templateId)) {
            App.toast('Ця інструкція вже додана', 'warning');
            return;
        }

        this.activeInstructions.push({ ...template });
        this.renderActive();
        this.updatePromptPreview();
        this.saveInstructions();
        App.toast('Інструкцію додано', 'success');
    },

    removeFromActive(index) {
        this.activeInstructions.splice(index, 1);
        this.renderActive();
        this.updatePromptPreview();
        this.saveInstructions();
        App.toast('Інструкцію видалено', 'success');
    },

    editInstruction(index) {
        const instr = this.activeInstructions[index];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>\u270f\ufe0f Редагувати інструкцію</h3>
                <form id="edit-instruction-form">
                    <div class="form-group">
                        <label>Назва</label>
                        <input type="text" id="edit-title" class="form-input" value="${App.esc(instr.title)}" required>
                    </div>
                    <div class="form-group">
                        <label>Зміст інструкції</label>
                        <textarea id="edit-content" class="form-textarea" rows="5" required>${App.esc(instr.content)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Іконка</label>
                        <input type="text" id="edit-icon" class="form-input" value="${App.esc(instr.icon)}" maxlength="2" style="width:80px">
                        <div class="form-hint">Один емодзі-символ</div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                        <button type="submit" class="btn btn-primary">Зберегти</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);
        setTimeout(() => overlay.querySelector('#edit-title')?.focus(), 50);

        overlay.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            instr.title = document.getElementById('edit-title').value;
            instr.content = document.getElementById('edit-content').value;
            instr.icon = document.getElementById('edit-icon').value || '\ud83d\udcdd';

            this.renderActive();
            this.updatePromptPreview();
            await this.saveInstructions();

            overlay.remove();
            App.toast('Інструкцію оновлено', 'success');
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    updatePromptPreview() {
        const preview = document.getElementById('prompt-preview');
        if (!preview) return;

        if (this.activeInstructions.length === 0) {
            preview.innerHTML = '<div class="empty-state" style="padding:16px"><p style="font-size:13px">Додайте інструкції для генерації промпту</p></div>';
            return;
        }

        const prompt = this.generatePrompt();
        preview.innerHTML = `
            <div class="prompt-text">${App.esc(prompt)}</div>
            <div class="prompt-metadata">
                <span>${prompt.length} символів</span>
                <span>\u00b7</span>
                <span>${prompt.split(/\s+/).length} слів</span>
                <span>\u00b7</span>
                <span>${this.activeInstructions.length} інструкцій</span>
            </div>
        `;
    },

    generatePrompt() {
        return this.activeInstructions.map((instr, i) => {
            return `${i + 1}. ${instr.title}\n${instr.content}`;
        }).join('\n\n');
    },

    updateStats() {
        const prompt = this.generatePrompt();
        const activeEl = document.getElementById('stat-active');
        const lengthEl = document.getElementById('stat-length');
        const tokensEl = document.getElementById('stat-tokens');
        if (activeEl) activeEl.textContent = this.activeInstructions.length;
        if (lengthEl) lengthEl.textContent = prompt.length;
        if (tokensEl) tokensEl.textContent = Math.ceil(prompt.length / 4);
    },

    copyPrompt() {
        const prompt = this.generatePrompt();
        navigator.clipboard.writeText(prompt).then(() => {
            App.toast('Промпт скопійовано', 'success');
        }).catch(() => {
            App.toast('Не вдалося скопіювати', 'error');
        });
    },

    async generateGlossary() {
        if (!App.currentProject) return;

        const prompt = this.generatePrompt();
        if (!prompt) {
            App.toast('Додайте інструкції перед генерацією', 'warning');
            return;
        }

        try {
            App.toast('Генерування глосарію...', 'info');
            const result = await API.generateGlossaryFromPrompt(App.currentProject.id, prompt);
            App.toast(`Згенеровано ${result.terms_count} термінів`, 'success');
            App.navigate('glossary');
        } catch (err) {
            console.error('Failed to generate glossary:', err);
            App.toast('Не вдалося згенерувати глосарій', 'error');
        }
    },

    async saveInstructions() {
        if (!App.currentProject) return;
        try {
            await API.updateProjectInstructions(App.currentProject.id, this.activeInstructions);
        } catch (err) {
            console.error('Failed to save instructions:', err);
        }
    },

    filterLibrary(search) {
        const lower = search.toLowerCase();
        document.querySelectorAll('.library-card').forEach(card => {
            const template = JSON.parse(card.dataset.template);
            const matches = template.title.toLowerCase().includes(lower) ||
                          template.content.toLowerCase().includes(lower) ||
                          template.category.toLowerCase().includes(lower);
            card.style.display = matches ? '' : 'none';
        });
    },

    refresh() {
        if (App.currentProject) {
            this.loadInstructions(App.currentProject.id);
        }
    },

    addInstruction() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>+ Нова інструкція</h3>
                <form id="new-instruction-form">
                    <div class="form-group">
                        <label>Назва</label>
                        <input type="text" id="new-title" class="form-input" placeholder="Назва інструкції" required>
                    </div>
                    <div class="form-group">
                        <label>Зміст інструкції</label>
                        <textarea id="new-content" class="form-textarea" rows="4" placeholder="Опишіть інструкцію для промпту..." required></textarea>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                        <button type="submit" class="btn btn-primary">Додати</button>
                    </div>
                </form>
            </div>`;
        document.body.appendChild(overlay);
        setTimeout(() => overlay.querySelector('#new-title')?.focus(), 50);

        overlay.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('new-title').value.trim();
            const content = document.getElementById('new-content').value.trim();
            if (!title || !content) return;
            this.activeInstructions.push({ id: 'custom_' + Date.now(), title, content, icon: '\ud83d\udcdd', category: 'custom' });
            this.renderActive();
            this.updatePromptPreview();
            await this.saveInstructions();
            overlay.remove();
            App.toast('Інструкцію додано', 'success');
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    },

    createTemplate() {
        this.addInstruction();
    },

    // ─── Word/PDF File Upload for Extended Instructions ──────────────────
    uploadWordFile() {
        if (!App.currentProject) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.docx,.doc,.pdf,.txt,.rtf';
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            await this.processUploadedFile(file);
        });
        input.click();
    },

    async processUploadedFile(file) {
        const pid = App.currentProject?.id;
        if (!pid) return;

        // Show loading overlay
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="text-align:center;padding:32px">
                <div class="loading-spinner"></div>
                <p style="margin-top:16px;color:var(--hint);font-size:14px">Обробка файлу «${App.esc(file.name)}»...</p>
                <p style="color:var(--hint);font-size:12px;margin-top:8px">Витягуємо текст для інструкцій</p>
            </div>`;
        document.body.appendChild(overlay);

        try {
            // 1. Upload file to project (temporary)
            const fd = new FormData();
            fd.append('file', file);
            fd.append('category', 'source');
            const uploadResp = await fetch('/api/projects/' + pid + '/files', {
                method: 'POST',
                headers: { 'Authorization': API.initData() },
                body: fd
            });
            const uploadData = await uploadResp.json();
            if (!uploadResp.ok || uploadData.error) {
                throw new Error(uploadData.error || 'Помилка завантаження');
            }
            const fileId = uploadData.id || uploadData.file_id;
            if (!fileId) throw new Error('Не вдалося отримати ID файлу');

            // 2. Extract text content
            let textContent = '';
            try {
                const contentData = await API.getFileContent(pid, fileId);
                textContent = contentData.content || '';
            } catch (e) {
                console.warn('Content extraction failed:', e);
            }

            // 3. Clean up — delete the temp file
            try {
                await API.deleteFile(pid, fileId);
            } catch (e) {
                console.warn('Failed to cleanup temp file:', e);
            }

            overlay.remove();

            if (!textContent || textContent.trim().length < 10) {
                App.toast('Не вдалося витягти текст з файлу. Спробуйте інший формат.', 'error');
                return;
            }

            // 4. Show preview modal
            this.showExtractedTextModal(file.name, textContent.trim());

        } catch (err) {
            overlay.remove();
            App.toast(err.message || 'Помилка обробки файлу', 'error');
        }
    },

    showExtractedTextModal(fileName, text) {
        // Truncate very long texts for display, but keep full text for instruction
        const displayText = text.length > 3000 ? text.substring(0, 3000) + '\n\n... (' + text.length + ' символів загалом)' : text;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal file-instruction-modal">
                <div class="modal-header">
                    <h3>\ud83d\udcc4 Текст з файлу</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">\u2715</button>
                </div>
                <div class="file-source-badge">
                    \ud83d\udcc2 ${App.esc(fileName)} \u00b7 ${text.length.toLocaleString()} символів
                </div>
                <div class="form-group">
                    <label>Назва інструкції</label>
                    <input type="text" id="file-instr-title" class="form-input" value="Побажання з ${App.esc(fileName)}" required>
                </div>
                <div class="form-group">
                    <label>Витягнутий текст <span style="color:var(--hint);font-weight:400">(можна редагувати)</span></label>
                    <textarea id="file-instr-content" class="form-textarea" rows="12">${App.esc(text)}</textarea>
                </div>
                <p style="font-size:12px;color:var(--hint);line-height:1.5;margin-bottom:16px">
                    Цей текст буде додано як інструкцію до промпту для створення глосарію.
                    Відредагуйте за потреби перед додаванням.
                </p>
                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                    <button type="button" class="btn btn-primary" onclick="InstructionsView.confirmFileInstruction()">
                        Додати як інструкцію
                    </button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Store the full text (not truncated) in a data attribute
        overlay.querySelector('#file-instr-content')._fullText = text;
    },

    confirmFileInstruction() {
        const title = document.getElementById('file-instr-title')?.value?.trim();
        const contentEl = document.getElementById('file-instr-content');
        const content = contentEl?.value?.trim();

        if (!title || !content) {
            App.toast('Заповніть назву та текст', 'warning');
            return;
        }

        this.activeInstructions.push({
            id: 'file_' + Date.now(),
            title: title,
            content: content,
            icon: '\ud83d\udcc2',
            category: 'file'
        });

        this.renderActive();
        this.updatePromptPreview();
        this.saveInstructions();

        document.querySelector('.modal-overlay')?.remove();
        App.toast('Інструкцію з файлу додано', 'success');
    }
};

// Add CSS
const instructionsStyle = document.createElement('style');
instructionsStyle.textContent = `
    .instructions-container {
        max-width: 1400px;
        margin: 0 auto;
    }

    .instructions-zones {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 20px;
    }

    .instructions-library,
    .instructions-workspace {
        background: var(--bg-secondary);
        padding: 18px;
        border-radius: 12px;
    }

    .instructions-library h3,
    .instructions-workspace h3 {
        margin: 0 0 14px 0;
        font-size: 15px;
        font-weight: 700;
    }

    .library-search {
        margin-bottom: 14px;
    }

    .instructions-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 14px;
        max-height: 500px;
        overflow-y: auto;
    }

    .instruction-card {
        display: flex;
        gap: 10px;
        align-items: start;
        padding: 12px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 10px;
        cursor: grab;
        transition: all 0.2s;
    }

    .instruction-card:hover {
        box-shadow: var(--shadow-sm);
        border-color: var(--btn);
    }

    .instruction-card:active {
        cursor: grabbing;
    }

    .instruction-handle {
        color: var(--hint);
        font-size: 14px;
        cursor: grab;
        user-select: none;
        padding: 2px;
    }

    .instruction-order {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--btn);
        color: white;
        border-radius: 50%;
        font-size: 11px;
        font-weight: 700;
        flex-shrink: 0;
    }

    .instruction-icon {
        font-size: 20px;
        flex-shrink: 0;
        line-height: 1;
    }

    .instruction-content {
        flex: 1;
        min-width: 0;
    }

    .instruction-title {
        font-weight: 600;
        font-size: 13px;
        margin-bottom: 3px;
    }

    .instruction-preview,
    .instruction-text {
        font-size: 12px;
        color: var(--hint);
        line-height: 1.4;
    }

    .instruction-category {
        display: inline-block;
        margin-top: 4px;
        padding: 1px 8px;
        background: var(--bg-secondary);
        border-radius: 4px;
        font-size: 10px;
        color: var(--hint);
        text-transform: uppercase;
        letter-spacing: .03em;
        font-weight: 600;
    }

    .instruction-actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
    }

    .instructions-dropzone {
        min-height: 160px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        background: var(--bg);
        border: 2px dashed var(--border);
        border-radius: 12px;
        margin-bottom: 20px;
        transition: border-color 0.2s;
    }

    .instructions-dropzone:hover {
        border-color: var(--btn);
    }

    .instructions-preview {
        background: var(--bg);
        padding: 16px;
        border-radius: 12px;
        margin-bottom: 20px;
    }

    .instructions-preview h4 {
        margin: 0 0 10px 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--hint);
    }

    .prompt-preview-content {
        background: var(--bg-secondary);
        padding: 14px;
        border-radius: 8px;
        max-height: 250px;
        overflow-y: auto;
        margin-bottom: 12px;
    }

    .prompt-text {
        white-space: pre-wrap;
        line-height: 1.6;
        font-size: 13px;
        font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
    }

    .prompt-metadata {
        font-size: 11px;
        color: var(--hint);
        padding-top: 10px;
        border-top: 1px solid var(--border);
        display: flex;
        gap: 6px;
    }

    .preview-actions {
        display: flex;
        gap: 8px;
    }

    .instructions-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
    }

    .stat-item {
        background: var(--bg);
        padding: 12px;
        border-radius: 10px;
        text-align: center;
    }

    .stat-item .stat-label {
        display: block;
        font-size: 11px;
        color: var(--hint);
        margin-bottom: 2px;
        font-weight: 500;
    }

    .stat-item .stat-value {
        display: block;
        font-size: 22px;
        font-weight: 800;
        color: var(--btn);
    }

    @media (max-width: 1200px) {
        .instructions-zones {
            grid-template-columns: 1fr;
        }
    }

    /* File instruction modal */
    .file-instruction-modal {
        max-width: 600px;
        width: 95vw;
    }
    .file-instruction-modal .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
    }
    .file-instruction-modal .modal-header h3 {
        margin: 0;
    }
    .file-instruction-modal .modal-close {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--hint);
        padding: 4px 8px;
        border-radius: 6px;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .file-instruction-modal .modal-close:hover {
        background: var(--bg-secondary);
    }
    .file-source-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        background: var(--bg-secondary);
        border-radius: 8px;
        font-size: 12px;
        color: var(--hint);
        font-weight: 500;
        margin-bottom: 16px;
    }
    .file-instruction-modal .form-textarea {
        font-size: 13px;
        line-height: 1.6;
        max-height: 300px;
        overflow-y: auto;
    }

    /* Loading spinner */
    .loading-spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--border);
        border-top-color: var(--btn);
        border-radius: 50%;
        margin: 0 auto;
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    @media (max-width: 767px) {
        .instructions-library,
        .instructions-workspace {
            padding: 14px;
            border-radius: 14px;
        }
        .instructions-zones { gap: 14px; }
        .instruction-card {
            padding: 14px;
            gap: 10px;
        }
        .instruction-card .btn-icon {
            min-width: 44px;
            min-height: 44px;
            font-size: 18px;
        }
        .instruction-handle {
            padding: 8px;
            font-size: 18px;
        }
        .instructions-dropzone {
            min-height: 100px;
            padding: 12px;
        }
        .preview-actions {
            flex-direction: column;
        }
        .preview-actions .btn {
            width: 100%;
        }
        .instructions-stats { gap: 8px; }
        .stat-item { padding: 14px 8px; }
        .library-search .search-input {
            font-size: 16px !important;
            min-height: 48px;
            padding: 14px;
        }
        .file-instruction-modal {
            width: 100vw;
            max-width: 100vw;
            border-radius: 16px 16px 0 0;
            margin-top: auto;
        }
        .file-instruction-modal .form-textarea {
            max-height: 200px;
        }
    }
`;
document.head.appendChild(instructionsStyle);
