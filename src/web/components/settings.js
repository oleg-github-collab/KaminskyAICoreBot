const SettingsView = {
    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty"><div class="empty-icon">\u2699\ufe0f</div><p>Оберіть проєкт</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">До проєктів</button></div>';
            return;
        }
        c.innerHTML = `
            <div class="section-header">
                <button class="back-btn" onclick="App.backToProjects()">\u2190</button>
                <h2>${App.esc(project.name)} \u2014 Налаштування</h2>
            </div>
            <div id="settings-form"><div class="loading">Завантаження...</div></div>`;
        this.loadSettings(project.id);
    },

    async loadSettings(pid) {
        const form = document.getElementById('settings-form');
        if (!form) return;
        try {
            const data = await API.getSettings(pid);
            form.innerHTML = `
                <div class="settings-card">
                    <div class="settings-card-header">
                        <div class="settings-card-icon">\ud83c\udfad</div>
                        <span>Формальність</span>
                    </div>
                    <div class="settings-card-desc">Визначає рівень формальності перекладу</div>
                    <select id="s-formality" class="input" style="width:100%">
                        <option value="default" ${data.formality === 'default' ? 'selected' : ''}>За замовчуванням</option>
                        <option value="more" ${data.formality === 'more' ? 'selected' : ''}>Формальніше (Sie/Ви)</option>
                        <option value="less" ${data.formality === 'less' ? 'selected' : ''}>Менш формально (du/ти)</option>
                        <option value="prefer_more" ${data.formality === 'prefer_more' ? 'selected' : ''}>Бажано формальніше</option>
                        <option value="prefer_less" ${data.formality === 'prefer_less' ? 'selected' : ''}>Бажано менш формально</option>
                    </select>
                </div>
                <div class="settings-card">
                    <div class="settings-card-header">
                        <div class="settings-card-icon">\ud83d\udcac</div>
                        <span>Контекст</span>
                    </div>
                    <div class="settings-card-desc">Додатковий контекст для покращення якості перекладу (не тарифікується)</div>
                    <textarea id="s-context" class="form-textarea" rows="3"
                        placeholder="Наприклад: юридичний договір між компаніями">${App.esc(data.context || '')}</textarea>
                </div>
                <div class="settings-card">
                    <div class="settings-card-header">
                        <div class="settings-card-icon">\u2702\ufe0f</div>
                        <span>Розбиття речень</span>
                    </div>
                    <div class="settings-card-desc">Як обробляти розбиття тексту на речення</div>
                    <select id="s-split" class="input" style="width:100%">
                        <option value="1" ${data.split_sentences === '1' ? 'selected' : ''}>Увімкнено</option>
                        <option value="0" ${data.split_sentences === '0' ? 'selected' : ''}>Вимкнено</option>
                        <option value="nonewlines" ${data.split_sentences === 'nonewlines' ? 'selected' : ''}>Без нових рядків</option>
                    </select>
                </div>
                <div class="settings-card">
                    <div class="settings-card-header">
                        <div class="settings-card-icon">\ud83d\udcce</div>
                        <span>Форматування</span>
                    </div>
                    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 0">
                        <input type="checkbox" id="s-formatting" ${data.preserve_formatting ? 'checked' : ''} style="width:18px;height:18px">
                        <span style="font-size:14px">Зберігати форматування документів</span>
                    </label>
                </div>
                <button class="btn btn-primary" style="margin-top:8px" onclick="SettingsView.save(${pid})">Зберегти налаштування</button>`;
        } catch (e) {
            form.innerHTML = `<p style="color:var(--hint);padding:12px">Помилка: ${App.esc(e.message)}</p>`;
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
            App.toast('Налаштування збережено', 'success');
        } catch (e) { App.toast(e.message, 'error'); }
    }
};
