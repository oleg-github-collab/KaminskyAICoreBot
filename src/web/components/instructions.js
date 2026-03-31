/**
 * Instructions Manager
 * Drag-and-drop instructions that generate prompts for glossary creation
 */

const InstructionsView = {
    instructions: [],

    async render(container, project) {
        if (!project) {
            container.innerHTML = '<div class="empty-state">Оберіть проєкт</div>';
            return;
        }

        const canEdit = RoleManager.can(PERMISSIONS.SETTINGS_EDIT);

        container.innerHTML = `
            <div class="instructions-container">
                <div class="instructions-header">
                    <h2>📝 Інструкції для промптів</h2>
                    <div class="instructions-actions">
                        <button class="btn btn-sm" onclick="InstructionsView.refresh()">
                            🔄 Оновити
                        </button>
                        <button class="btn btn-sm btn-primary" onclick="InstructionsView.addInstruction()" ${canEdit ? '' : 'disabled'}>
                            ➕ Додати інструкцію
                        </button>
                    </div>
                </div>

                <div class="instructions-info">
                    <div class="info-box">
                        <div class="info-icon">💡</div>
                        <div class="info-content">
                            <strong>Як це працює:</strong>
                            Перетягніть інструкції у потрібному порядку. Вони будуть об'єднані у промпт для створення глосарію на основі ваших документів.
                        </div>
                    </div>
                </div>

                <div class="instructions-zones">
                    <div class="instructions-library">
                        <h3>📚 Бібліотека інструкцій</h3>
                        <div class="library-search">
                            <input type="text" id="library-search" class="search-input" placeholder="🔍 Шукати інструкції...">
                        </div>
                        <div id="library-list" class="instructions-list">
                            ${App.skeleton(3)}
                        </div>
                        <button class="btn btn-sm btn-block" onclick="InstructionsView.createTemplate()" ${canEdit ? '' : 'disabled'}>
                            ➕ Створити шаблон
                        </button>
                    </div>

                    <div class="instructions-workspace">
                        <h3>🎯 Активні інструкції (перетягніть для зміни порядку)</h3>
                        <div id="active-instructions" class="instructions-dropzone">
                            ${App.skeleton(2)}
                        </div>

                        <div class="instructions-preview">
                            <h4>📄 Попередній перегляд промпту</h4>
                            <div id="prompt-preview" class="prompt-preview-content">
                                ${App.skeleton(3)}
                            </div>
                            <div class="preview-actions">
                                <button class="btn btn-sm" onclick="InstructionsView.copyPrompt()">
                                    📋 Копіювати промпт
                                </button>
                                <button class="btn btn-sm btn-primary" onclick="InstructionsView.generateGlossary()" ${canEdit ? '' : 'disabled'}>
                                    ✨ Згенерувати глосарій
                                </button>
                            </div>
                        </div>

                        <div class="instructions-stats">
                            <div class="stat-item">
                                <span class="stat-label">Активних інструкцій:</span>
                                <span class="stat-value" id="stat-active">0</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Довжина промпту:</span>
                                <span class="stat-value" id="stat-length">0</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">Оцінка токенів:</span>
                                <span class="stat-value" id="stat-tokens">0</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Load instructions
        await this.loadInstructions(project.id);

        // Setup drag-drop
        this.setupDragDrop();

        // Apply RBAC
        RoleManager.updateUI();
    },

    async loadInstructions(projectId) {
        try {
            // Load library templates
            const library = await API.getInstructionTemplates();
            this.libraryTemplates = library || this.getDefaultTemplates();

            // Load active instructions for project
            const active = await API.getProjectInstructions(projectId);
            this.activeInstructions = active || [];

            this.renderLibrary();
            this.renderActive();
            this.updatePromptPreview();
        } catch (err) {
            console.error('Failed to load instructions:', err);
            // Fallback to defaults
            this.libraryTemplates = this.getDefaultTemplates();
            this.activeInstructions = [];
            this.renderLibrary();
            this.renderActive();
        }
    },

    getDefaultTemplates() {
        return [
            {
                id: 'intro',
                title: 'Вступна інструкція',
                content: 'Ви — експерт-перекладач. Ваше завдання — створити глосарій термінів на основі наданих документів.',
                category: 'general',
                icon: '📖'
            },
            {
                id: 'terminology',
                title: 'Термінологія',
                content: 'Виділіть ключові терміни, специфічні для галузі. Надайте точні переклади українською мовою.',
                category: 'extraction',
                icon: '🔍'
            },
            {
                id: 'context',
                title: 'Контекст',
                content: 'Для кожного терміну надайте короткий контекст використання та приклади із документів.',
                category: 'extraction',
                icon: '📝'
            },
            {
                id: 'consistency',
                title: 'Консистентність',
                content: 'Забезпечте однаковість перекладу повторюваних термінів у різних контекстах.',
                category: 'quality',
                icon: '✓'
            },
            {
                id: 'domain',
                title: 'Галузева специфіка',
                content: 'Враховуйте специфіку галузі (юридична, медична, технічна тощо) при виборі перекладів.',
                category: 'quality',
                icon: '⚙️'
            },
            {
                id: 'abbreviations',
                title: 'Абревіатури',
                content: 'Включіть всі абревіатури та скорочення з їх розшифровкою і перекладом.',
                category: 'extraction',
                icon: '🔤'
            },
            {
                id: 'frequency',
                title: 'Частотність',
                content: 'Пріоритизуйте терміни за частотою використання у документах.',
                category: 'quality',
                icon: '📊'
            },
            {
                id: 'format',
                title: 'Формат виводу',
                content: 'Надайте глосарій у форматі: термін (мова оригіналу) | переклад | категорія | рівень важливості.',
                category: 'output',
                icon: '📋'
            }
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
                    <div class="instruction-preview">${App.esc(template.content.substring(0, 80))}...</div>
                    <div class="instruction-category">${App.esc(template.category)}</div>
                </div>
                <button class="btn btn-icon btn-sm" onclick="event.stopPropagation(); InstructionsView.addToActive('${template.id}')" title="Додати до активних">
                    ➕
                </button>
            </div>
        `).join('');

        // Setup search
        document.getElementById('library-search')?.addEventListener('input', (e) => {
            this.filterLibrary(e.target.value);
        });
    },

    renderActive() {
        const list = document.getElementById('active-instructions');
        if (!list) return;

        if (this.activeInstructions.length === 0) {
            list.innerHTML = DragDrop.createDropIndicator('Перетягніть інструкції сюди').outerHTML;
            return;
        }

        list.innerHTML = this.activeInstructions.map((instr, index) => `
            <div class="instruction-card active-card"
                 draggable="true"
                 data-id="${instr.id}"
                 data-index="${index}">
                <div class="instruction-handle">☰</div>
                <div class="instruction-order">${index + 1}</div>
                <div class="instruction-icon">${instr.icon}</div>
                <div class="instruction-content">
                    <div class="instruction-title">${App.esc(instr.title)}</div>
                    <div class="instruction-text">${App.esc(instr.content)}</div>
                </div>
                <div class="instruction-actions">
                    <button class="btn btn-icon btn-sm" onclick="InstructionsView.editInstruction(${index})" title="Редагувати">
                        ✏️
                    </button>
                    <button class="btn btn-icon btn-sm" onclick="InstructionsView.removeFromActive(${index})" title="Видалити">
                        ✕
                    </button>
                </div>
            </div>
        `).join('');

        this.updateStats();
    },

    setupDragDrop() {
        const activeZone = document.getElementById('active-instructions');
        if (!activeZone) return;

        // Make active instructions sortable
        DragDrop.makeSortable(activeZone, {
            itemSelector: '.active-card',
            handle: '.instruction-handle',
            onReorder: async (newOrder) => {
                // Reorder active instructions
                const reordered = newOrder.map(id => {
                    return this.activeInstructions.find(i => i.id === id);
                });
                this.activeInstructions = reordered;
                await this.saveInstructions();
                this.updatePromptPreview();
            }
        });

        // Make active zone a drop zone for library items
        DragDrop.makeDropZone(activeZone, {
            accept: '*',
            onDrop: (data) => {
                if (data.templateId) {
                    this.addToActive(data.templateId);
                }
            }
        });

        // Make library items draggable
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

        // Check if already added
        if (this.activeInstructions.find(i => i.id === templateId)) {
            App.toast('Ця інструкція вже додана', 'warning');
            return;
        }

        this.activeInstructions.push({ ...template });
        this.renderActive();
        this.updatePromptPreview();
        this.saveInstructions();

        App.toast('✓ Інструкцію додано', 'success');
    },

    removeFromActive(index) {
        this.activeInstructions.splice(index, 1);
        this.renderActive();
        this.updatePromptPreview();
        this.saveInstructions();

        App.toast('✓ Інструкцію видалено', 'success');
    },

    editInstruction(index) {
        const instr = this.activeInstructions[index];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>✏️ Редагувати інструкцію</h3>
                <form id="edit-instruction-form">
                    <div class="form-group">
                        <label>Назва:</label>
                        <input type="text" id="edit-title" class="form-input" value="${App.esc(instr.title)}" required>
                    </div>
                    <div class="form-group">
                        <label>Зміст:</label>
                        <textarea id="edit-content" class="form-textarea" rows="6" required>${App.esc(instr.content)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Іконка:</label>
                        <input type="text" id="edit-icon" class="form-input" value="${App.esc(instr.icon)}" maxlength="2">
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                        <button type="submit" class="btn btn-primary">Зберегти</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            instr.title = document.getElementById('edit-title').value;
            instr.content = document.getElementById('edit-content').value;
            instr.icon = document.getElementById('edit-icon').value || '📝';

            this.renderActive();
            this.updatePromptPreview();
            await this.saveInstructions();

            overlay.remove();
            App.toast('✓ Інструкцію оновлено', 'success');
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    updatePromptPreview() {
        const preview = document.getElementById('prompt-preview');
        if (!preview) return;

        if (this.activeInstructions.length === 0) {
            preview.innerHTML = '<div class="empty-state">Додайте інструкції для генерації промпту</div>';
            return;
        }

        const prompt = this.generatePrompt();
        preview.innerHTML = `
            <div class="prompt-text">${App.esc(prompt)}</div>
            <div class="prompt-metadata">
                <span>Символів: ${prompt.length}</span>
                <span>•</span>
                <span>Слів: ${prompt.split(/\s+/).length}</span>
                <span>•</span>
                <span>Інструкцій: ${this.activeInstructions.length}</span>
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

        document.getElementById('stat-active').textContent = this.activeInstructions.length;
        document.getElementById('stat-length').textContent = prompt.length;
        document.getElementById('stat-tokens').textContent = Math.ceil(prompt.length / 4); // Rough estimate
    },

    copyPrompt() {
        const prompt = this.generatePrompt();
        navigator.clipboard.writeText(prompt).then(() => {
            App.toast('✓ Промпт скопійовано', 'success');
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
            App.toast('⏳ Генерування глосарію...', 'info');

            const result = await API.generateGlossaryFromPrompt(App.currentProject.id, prompt);

            App.toast(`✓ Згенеровано ${result.terms_count} термінів`, 'success');

            // Navigate to glossary view
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
        // TODO: Implement custom instruction creation
        App.toast('Функція створення власної інструкції в розробці', 'info');
    },

    createTemplate() {
        // TODO: Implement template creation
        App.toast('Функція створення шаблону в розробці', 'info');
    }
};

// Add CSS
const instructionsStyle = document.createElement('style');
style.textContent = `
    .instructions-container {
        max-width: 1400px;
        margin: 0 auto;
    }

    .instructions-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
    }

    .instructions-actions {
        display: flex;
        gap: 8px;
    }

    .instructions-info {
        margin-bottom: 24px;
    }

    .info-box {
        display: flex;
        gap: 16px;
        padding: 16px;
        background: var(--primary-light);
        border: 1px solid var(--primary);
        border-radius: 8px;
    }

    .info-icon {
        font-size: 32px;
        flex-shrink: 0;
    }

    .info-content {
        flex: 1;
        line-height: 1.6;
    }

    .instructions-zones {
        display: grid;
        grid-template-columns: 350px 1fr;
        gap: 24px;
    }

    .instructions-library,
    .instructions-workspace {
        background: var(--bg-secondary);
        padding: 20px;
        border-radius: 8px;
    }

    .instructions-library h3,
    .instructions-workspace h3 {
        margin: 0 0 16px 0;
        font-size: 16px;
    }

    .library-search {
        margin-bottom: 16px;
    }

    .instructions-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
        max-height: 600px;
        overflow-y: auto;
    }

    .instruction-card {
        display: flex;
        gap: 12px;
        align-items: start;
        padding: 12px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        cursor: grab;
        transition: all 0.2s;
    }

    .instruction-card:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        transform: translateY(-1px);
    }

    .instruction-card:active {
        cursor: grabbing;
    }

    .instruction-handle {
        color: var(--text-secondary);
        font-size: 16px;
        cursor: grab;
        user-select: none;
    }

    .instruction-order {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--primary);
        color: white;
        border-radius: 50%;
        font-size: 12px;
        font-weight: 600;
        flex-shrink: 0;
    }

    .instruction-icon {
        font-size: 24px;
        flex-shrink: 0;
    }

    .instruction-content {
        flex: 1;
        min-width: 0;
    }

    .instruction-title {
        font-weight: 600;
        margin-bottom: 4px;
    }

    .instruction-preview,
    .instruction-text {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.4;
    }

    .instruction-category {
        display: inline-block;
        margin-top: 6px;
        padding: 2px 8px;
        background: var(--bg-secondary);
        border-radius: 4px;
        font-size: 11px;
        color: var(--text-secondary);
    }

    .instruction-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }

    .instructions-dropzone {
        min-height: 200px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: var(--bg);
        border: 2px dashed var(--border);
        border-radius: 8px;
        margin-bottom: 24px;
    }

    .instructions-preview {
        background: var(--bg);
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 24px;
    }

    .instructions-preview h4 {
        margin: 0 0 12px 0;
        font-size: 14px;
    }

    .prompt-preview-content {
        background: var(--bg-secondary);
        padding: 16px;
        border-radius: 6px;
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: 12px;
    }

    .prompt-text {
        white-space: pre-wrap;
        line-height: 1.6;
        font-size: 14px;
        font-family: 'Monaco', monospace;
    }

    .prompt-metadata {
        font-size: 12px;
        color: var(--text-secondary);
        padding-top: 12px;
        border-top: 1px solid var(--border);
        display: flex;
        gap: 8px;
    }

    .preview-actions {
        display: flex;
        gap: 8px;
    }

    .instructions-stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
    }

    .stat-item {
        background: var(--bg);
        padding: 12px;
        border-radius: 6px;
        text-align: center;
    }

    .stat-label {
        display: block;
        font-size: 12px;
        color: var(--text-secondary);
        margin-bottom: 4px;
    }

    .stat-value {
        display: block;
        font-size: 24px;
        font-weight: 700;
        color: var(--primary);
    }

    @media (max-width: 1200px) {
        .instructions-zones {
            grid-template-columns: 1fr;
        }
    }
`;
document.head.appendChild(instructionsStyle);
