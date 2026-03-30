const SettingsView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">⚙️</div><p>Оберіть проєкт</p></div>';
            return;
        }
        c.innerHTML = `
            <h2 style="font-size:16px;margin-bottom:12px">${App.esc(project.name)} — Налаштування перекладу</h2>
            <div id="settings-form"><div class="loading">Завантаження...</div></div>`;
        this.loadSettings(project.id);
    },

    async loadSettings(pid) {
        const form = document.getElementById('settings-form');
        if (!form) return;
        try {
            const data = await API.getSettings(pid);
            form.innerHTML = `
                <div class="card" style="margin-bottom:12px">
                    <div class="card-title" style="margin-bottom:8px">Формальність</div>
                    <select id="s-formality" class="input" style="width:100%;padding:8px">
                        <option value="default" ${data.formality === 'default' ? 'selected' : ''}>За замовчуванням</option>
                        <option value="more" ${data.formality === 'more' ? 'selected' : ''}>Формальніше (Sie/Ви)</option>
                        <option value="less" ${data.formality === 'less' ? 'selected' : ''}>Менш формально (du/ти)</option>
                        <option value="prefer_more" ${data.formality === 'prefer_more' ? 'selected' : ''}>Бажано формальніше</option>
                        <option value="prefer_less" ${data.formality === 'prefer_less' ? 'selected' : ''}>Бажано менш формально</option>
                    </select>
                </div>
                <div class="card" style="margin-bottom:12px">
                    <div class="card-title" style="margin-bottom:8px">Контекст (не тарифікується)</div>
                    <textarea id="s-context" class="input" rows="3" style="width:100%;padding:8px"
                        placeholder="Додатковий контекст для покращення якості перекладу">${App.esc(data.context || '')}</textarea>
                </div>
                <div class="card" style="margin-bottom:12px">
                    <div class="card-title" style="margin-bottom:8px">Розбиття речень</div>
                    <select id="s-split" class="input" style="width:100%;padding:8px">
                        <option value="1" ${data.split_sentences === '1' ? 'selected' : ''}>Увімкнено</option>
                        <option value="0" ${data.split_sentences === '0' ? 'selected' : ''}>Вимкнено</option>
                        <option value="nonewlines" ${data.split_sentences === 'nonewlines' ? 'selected' : ''}>Без нових рядків</option>
                    </select>
                </div>
                <div class="card" style="margin-bottom:12px">
                    <label style="display:flex;align-items:center;gap:8px">
                        <input type="checkbox" id="s-formatting" ${data.preserve_formatting ? 'checked' : ''}>
                        Зберігати форматування
                    </label>
                </div>
                <button class="btn btn-primary" style="width:100%;padding:10px" onclick="SettingsView.save(${pid})">Зберегти налаштування</button>`;
        } catch (e) {
            form.innerHTML = `<p style="color:var(--hint)">Помилка: ${App.esc(e.message)}</p>`;
        }
    },

    async save(pid) {
        try {
            await API.updateSettings(pid, {
                formality: document.getElementById('s-formality').value,
                context: document.getElementById('s-context').value,
                split_sentences: document.getElementById('s-split').value,
                preserve_formatting: document.getElementById('s-formatting').checked,
            });
            App.alert('Налаштування збережено!');
        } catch (e) { App.alert(e.message); }
    }
};
