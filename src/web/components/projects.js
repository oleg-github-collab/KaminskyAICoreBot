const ProjectsView = {
    languages: window.LanguageMeta
        ? window.LanguageMeta.defaults()
        : ['German', 'Ukrainian', 'English', 'Polish', 'French', 'Spanish', 'Italian', 'Dutch'],
    optionsLoaded: false,

    async render(c) {
        c.innerHTML = '<div class="loading">Завантаження замовлень…</div>';
        try {
            await this.loadOptions();
            const data = await API.getProjects();
            const projects = data.projects || [];

            let html = `<div class="section-header">
                <h2>Мої замовлення</h2>
                <div class="section-actions">
                    <span style="font-size:12px;color:var(--text-secondary)">${projects.length} замовлень</span>
                </div>
            </div>`;

            html += `
                <div class="create-card">
                    <div class="card-title">Нове замовлення</div>
                    <div class="create-row">
                        <label class="field-label create-field">
                            Назва замовлення
                            <input class="input" id="new-project-name" placeholder="Наприклад: Договір" onkeydown="if(event.key==='Enter')ProjectsView.create()">
                        </label>
                        <label class="field-label create-field">
                            Мова оригіналу
                            <select class="input" id="new-project-source" aria-label="Мова оригіналу">
                                ${this.renderLanguageOptions('German')}
                            </select>
                        </label>
                        <label class="field-label create-field">
                            Мова перекладу
                            <select class="input" id="new-project-target" aria-label="Мова перекладу">
                                ${this.renderLanguageOptions('Ukrainian')}
                            </select>
                        </label>
                        <button class="btn btn-primary" onclick="ProjectsView.create()">${Icons.wrap('forward', 16)} Далі</button>
                    </div>
                </div>`;

            if (!projects.length) {
                html += `
                    <div class="empty-state">
                        <div class="empty-state-icon">${Icons.wrap('projects', 48)}</div>
                        <p class="empty-state-title">Ще немає замовлень</p>
                        <p class="empty-state-text">Створіть перше замовлення вище</p>
                    </div>`;
            } else {
                html += projects.map(p => {
                    const desc = p.description || '';
                    return `
                    <div class="card project-card" style="cursor:pointer" onclick='ProjectsView.select(${JSON.stringify(p).replace(/'/g, "\\'")})'>
                        <div class="project-card-top">
                            <div class="project-card-info">
                                <div class="card-title">${App.esc(p.name)}</div>
                                ${this.renderProjectRoute(p.source_lang, p.target_lang)}
                                ${desc ? `<div class="card-sub">${App.esc(desc)}</div>` : ''}
                            </div>
                            <span class="card-badge">${App.esc(p.role)}</span>
                        </div>
                        ${p.role === 'owner' ? `
                        <div class="project-card-actions" onclick="event.stopPropagation()">
                            <button class="btn btn-sm btn-secondary"
                                    onclick="ProjectsView.editProject(${p.id}, '${App.esc(p.name).replace(/'/g, "\\'")}', '${App.esc(p.description || '').replace(/'/g, "\\'")}')">${Icons.wrap('edit', 14)} Редагувати</button>
                            <button class="btn btn-sm btn-danger"
                                    onclick="ProjectsView.deleteProject(${p.id}, '${App.esc(p.name).replace(/'/g, "\\'")}')">${Icons.wrap('trash', 14)} Видалити</button>
                        </div>` : ''}
                    </div>`;
                }).join('');
            }

            c.innerHTML = html;
        } catch (e) {
            c.innerHTML = `<div class="empty"><p>Помилка: ${App.esc(e.message)}</p></div>`;
        }
    },

    select(project) {
        App.selectProject(project);
    },

    renderLanguageOptions(selected) {
        return this.languages.map(lang =>
            `<option value="${App.esc(lang)}"${lang === selected ? ' selected' : ''}>${App.esc(this.languageOptionLabel(lang))}</option>`
        ).join('');
    },

    languageFlag(lang) {
        return window.LanguageMeta ? window.LanguageMeta.flag(lang) : '🌐';
    },

    languageOptionLabel(lang) {
        return window.LanguageMeta ? window.LanguageMeta.optionLabel(lang) : String(lang || '');
    },

    languageInfo(lang) {
        return window.LanguageMeta
            ? window.LanguageMeta.info(lang)
            : { name: String(lang || 'Language'), nativeName: '', flag: '🌐' };
    },

    renderLanguageChip(lang) {
        const info = this.languageInfo(lang);
        const native = info.nativeName && info.nativeName !== info.name
            ? `<span class="language-native">${App.esc(info.nativeName)}</span>`
            : '';
        return `
            <span class="language-mini-chip">
                <span class="language-flag" aria-hidden="true">${App.esc(info.flag)}</span>
                <span class="language-name">${App.esc(info.name)}</span>
                ${native}
            </span>`;
    },

    renderProjectRoute(source, targetRaw) {
        if (!source && !targetRaw) return '';
        const targets = String(targetRaw || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
        return `
            <div class="project-language-route">
                ${source ? this.renderLanguageChip(source) : ''}
                ${source && targets.length ? '<span class="project-language-arrow">→</span>' : ''}
                <span class="project-language-targets">
                    ${targets.length ? targets.map(lang => this.renderLanguageChip(lang)).join('') : ''}
                </span>
            </div>`;
    },

    async loadOptions() {
        if (this.optionsLoaded) return;
        this.optionsLoaded = true;
        try {
            const data = await API.getTranslationOptions();
            const languages = Array.isArray(data.languages) ? data.languages.filter(Boolean) : [];
            if (languages.length) this.languages = languages;
        } catch (e) {
            // Keep the local fallback list if the processor options endpoint is unavailable.
        }
    },

    async create() {
        const input = document.getElementById('new-project-name');
        const source = document.getElementById('new-project-source')?.value || 'German';
        const target = document.getElementById('new-project-target')?.value || 'Ukrainian';
        const name = (input.value || '').trim();
        if (!name) { App.alert('Введіть назву замовлення'); return; }
        if (name.length > 100) { App.alert('Назва занадто довга (макс. 100 символів)'); return; }
        if (source === target) { App.alert('Оберіть різні мови'); return; }
        try {
            const data = await API.createProject(name, '', source, target);
            input.value = '';
            if (data.project) {
                App.selectProject(data.project);
            } else {
                this.render(document.getElementById('content'));
            }
        } catch (e) { App.alert(e.message); }
    },

    async editProject(projectId, currentName, currentDescription) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>Редагувати замовлення</h3>
                <form id="edit-project-form">
                    <div class="form-group">
                        <label>Назва замовлення</label>
                        <input type="text" id="edit-name" class="form-input" value="${App.esc(currentName)}" required maxlength="100">
                    </div>
                    <div class="form-group">
                        <label>Опис</label>
                        <textarea id="edit-desc" class="form-textarea" rows="3" maxlength="500" placeholder="Необов'язковий опис замовлення">${App.esc(currentDescription)}</textarea>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                        <button type="submit" class="btn btn-primary">Зберегти</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);
        setTimeout(() => overlay.querySelector('#edit-name')?.focus(), 50);

        overlay.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('edit-name').value.trim();
            const description = document.getElementById('edit-desc').value.trim();

            if (!name) {
                App.toast('Назва не може бути порожньою', 'warning');
                return;
            }

            try {
                await API.updateProject(projectId, { name, description });
                overlay.remove();
                this.render(document.getElementById('content'));
                App.toast('Замовлення оновлено', 'success');
            } catch (err) {
                App.toast(err.message, 'error');
            }
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    async deleteProject(projectId, projectName) {
        App.modalConfirm(
            'Видалити замовлення?',
            `Ви впевнені, що хочете видалити замовлення \u00ab${projectName}\u00bb? Це видалить файли, історію оплати та повідомлення. Цю дію не можна скасувати.`,
            async () => {
                try {
                    await API.deleteProject(projectId);
                    this.render(document.getElementById('content'));
                    App.toast('Замовлення видалено', 'success');
                } catch (err) {
                    App.toast(err.message, 'error');
                }
            },
            'Видалити',
            'Скасувати'
        );
    }
};
