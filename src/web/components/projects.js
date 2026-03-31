const ProjectsView = {
    async render(c) {
        c.innerHTML = '<div class="loading">Завантаження...</div>';
        try {
            const data = await API.getProjects();
            const projects = data.projects || [];

            let html = '<h2 style="font-size:16px;margin-bottom:12px">Мої проєкти</h2>';

            html += `
                <div class="card" style="margin-bottom:16px">
                    <div class="card-title" style="margin-bottom:8px">Створити новий проєкт</div>
                    <div style="display:flex;gap:8px">
                        <input class="input" id="new-project-name" placeholder="Назва проєкту" style="flex:1">
                        <button class="btn btn-primary" style="width:auto;padding:8px 16px" onclick="ProjectsView.create()">Створити</button>
                    </div>
                </div>`;

            if (!projects.length) {
                html += `
                    <div class="empty">
                        <div class="empty-icon">📁</div>
                        <p>Ще немає проєктів</p>
                        <p style="font-size:13px;margin-top:8px;color:var(--hint)">Створіть перший проєкт вище</p>
                    </div>`;
            } else {
                html += projects.map(p => `
                    <div class="card project-card" style="cursor:pointer" onclick='ProjectsView.select(${JSON.stringify(p).replace(/'/g, "\\'")})'>
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div style="flex:1;min-width:0">
                                <div class="card-title">${App.esc(p.name)}</div>
                                <div class="card-sub" style="margin-top:4px">${App.esc(p.description || (p.source_lang && p.target_lang ? p.source_lang + ' \u2192 ' + p.target_lang : ''))}</div>
                            </div>
                            <div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;align-items:center">
                                <span class="card-badge">${App.esc(p.role)}</span>
                                ${p.role === 'owner' ? `
                                    <button class="btn btn-sm btn-secondary project-action-btn"
                                            onclick="event.stopPropagation(); ProjectsView.editProject(${p.id}, '${App.esc(p.name).replace(/'/g, "\\'")}', '${App.esc(p.description || '').replace(/'/g, "\\'")}')"
                                            data-tooltip="Редагувати">
                                        Ред.
                                    </button>
                                    <button class="btn btn-sm btn-danger project-action-btn"
                                            onclick="event.stopPropagation(); ProjectsView.deleteProject(${p.id}, '${App.esc(p.name).replace(/'/g, "\\'")}')"
                                            data-tooltip="Видалити">
                                        Вид.
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `).join('');
            }

            c.innerHTML = html;
        } catch (e) {
            c.innerHTML = `<div class="empty"><p>Помилка: ${App.esc(e.message)}</p></div>`;
        }
    },

    select(project) {
        App.selectProject(project);
    },

    async create() {
        const input = document.getElementById('new-project-name');
        const name = (input.value || '').trim();
        if (!name) { App.alert('Введіть назву проєкту'); return; }
        if (name.length > 100) { App.alert('Назва занадто довга (макс. 100 символів)'); return; }
        try {
            const data = await API.createProject(name, '');
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
                <h3>Редагувати проєкт</h3>
                <form id="edit-project-form">
                    <div style="margin-bottom:12px">
                        <label class="label">Назва проєкту:</label>
                        <input type="text" id="edit-name" class="input" value="${App.esc(currentName)}" required maxlength="100">
                    </div>
                    <div style="margin-bottom:16px">
                        <label class="label">Опис (необов'язково):</label>
                        <textarea id="edit-desc" class="input" rows="3" maxlength="500">${App.esc(currentDescription)}</textarea>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                        <button type="submit" class="btn btn-primary">Зберегти</button>
                    </div>
                </form>
            </div>`;

        document.body.appendChild(overlay);

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
                App.toast('Проєкт оновлено', 'success');
            } catch (err) {
                App.toast(err.message, 'error');
            }
        });

        // Close on background click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    async deleteProject(projectId, projectName) {
        App.modalConfirm(
            'Видалити проєкт?',
            `Ви впевнені, що хочете видалити проєкт "${projectName}"? Це видалить усі файли, глосарії та повідомлення. Цю дію не можна скасувати.`,
            async () => {
                try {
                    await API.deleteProject(projectId);
                    this.render(document.getElementById('content'));
                    App.toast('Проєкт видалено', 'success');
                } catch (err) {
                    App.toast(err.message, 'error');
                }
            },
            'Видалити',
            'Скасувати'
        );
    }
};
