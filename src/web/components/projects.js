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
                    <div class="card" style="cursor:pointer" onclick='ProjectsView.select(${JSON.stringify(p).replace(/'/g, "\\'")})'>
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div class="card-title">${App.esc(p.name)}</div>
                            <span class="card-badge">${App.esc(p.role)}</span>
                        </div>
                        <div class="card-sub" style="margin-top:4px">${App.esc(p.description || (p.source_lang && p.target_lang ? p.source_lang + ' \u2192 ' + p.target_lang : ''))}</div>
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
    }
};
