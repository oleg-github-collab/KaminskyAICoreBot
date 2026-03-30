const ProjectsView = {
    async render(c) {
        c.innerHTML = '<div class="loading">Завантаження...</div>';
        try {
            const data = await API.getProjects();
            const projects = data.projects || [];
            if (!projects.length) {
                c.innerHTML = `
                    <div class="empty">
                        <div class="empty-icon">📁</div>
                        <p>Ще немає проєктів</p>
                        <p style="font-size:13px;margin-top:8px">Створіть проєкт через бот: /newproject</p>
                    </div>`;
                return;
            }
            c.innerHTML = projects.map(p => `
                <div class="card" onclick='App.selectProject(${JSON.stringify(p).replace(/'/g, "\\'")})'>
                    <div class="card-title">${App.esc(p.name)}</div>
                    <div class="card-sub">${App.esc(p.description || p.source_lang + ' → ' + p.target_lang)}</div>
                </div>
            `).join('');
        } catch (e) {
            c.innerHTML = `<div class="empty"><p>Помилка: ${App.esc(e.message)}</p></div>`;
        }
    }
};
