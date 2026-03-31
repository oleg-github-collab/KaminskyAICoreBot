const GitView = {
    currentProject: null,
    currentBranch: null,
    branches: [],
    commits: [],

    async init(projectId) {
        this.currentProject = projectId;
        await this.loadBranches();
    },

    async loadBranches() {
        try {
            const data = await API.getBranches(this.currentProject);
            this.branches = data.branches || [];
            this.currentBranch = data.current_branch || null;
        } catch (e) {
            console.error('Failed to load branches:', e);
        }
    },

    renderBranchSelector() {
        if (!this.currentBranch) return '';

        return `
            <div class="branch-selector" style="display:inline-flex;align-items:center;gap:8px;background:var(--bg-secondary);padding:6px 12px;border-radius:6px">
                <span style="font-size:16px">🌿</span>
                <select id="branch-select" class="input" style="padding:4px 8px;border:none;background:transparent" onchange="GitView.switchBranch(this.value)">
                    ${this.branches.map(b => `
                        <option value="${b.id}" ${b.id === this.currentBranch.id ? 'selected' : ''}>
                            ${App.esc(b.name)}${b.id === this.currentBranch.id ? ' (поточна)' : ''}
                        </option>
                    `).join('')}
                </select>
                <button class="btn btn-sm btn-secondary" onclick="GitView.showBranchModal()">+ Нова гілка</button>
                <button class="btn btn-sm btn-primary" onclick="GitView.showCommitModal()">📝 Commit</button>
            </div>`;
    },

    async switchBranch(branchId) {
        try {
            await API.switchBranch(this.currentProject, parseInt(branchId));
            await this.loadBranches();

            // Reload glossary
            if (typeof GlossaryView !== 'undefined') {
                await GlossaryView.loadTerms(this.currentProject);
            }

            App.toast('Гілку змінено', 'success');
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    showBranchModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width:500px">
                <h3>🌿 Створити нову гілку</h3>
                <p style="font-size:14px;color:var(--hint);margin:12px 0">
                    Нова гілка буде створена на основі поточної гілки "${App.esc(this.currentBranch?.name || 'main')}"
                </p>
                <input type="text" id="new-branch-name" class="input" placeholder="Назва гілки (напр. feature-new-terms)" style="width:100%;margin-bottom:16px">
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                    <button class="btn btn-primary" onclick="GitView.createBranch()">✓ Створити</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.getElementById('new-branch-name').focus();
    },

    async createBranch() {
        const input = document.getElementById('new-branch-name');
        const name = input.value.trim();

        if (!name) {
            App.toast('Введіть назву гілки', 'warning');
            return;
        }

        // Validate branch name
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            App.toast('Назва може містити лише літери, цифри, - та _', 'warning');
            return;
        }

        try {
            await API.createBranch(this.currentProject, name);
            await this.loadBranches();

            document.querySelector('.modal-overlay').remove();
            App.toast(`Гілку "${name}" створено`, 'success');

            // Update UI
            if (typeof GlossaryView !== 'undefined' && document.getElementById('git-branch-selector')) {
                document.getElementById('git-branch-selector').innerHTML = this.renderBranchSelector();
            }
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    showCommitModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width:600px">
                <h3>📝 Створити commit</h3>
                <p style="font-size:14px;color:var(--hint);margin:12px 0">
                    Збережіть поточний стан глосарію в гілці "${App.esc(this.currentBranch?.name || 'main')}"
                </p>

                <label style="display:block;margin-bottom:8px;font-weight:500">Повідомлення commit:</label>
                <textarea id="commit-message" class="input" rows="3"
                    placeholder="Опишіть зміни (напр. 'Додано 15 нових термінів для медичної документації')"
                    style="width:100%;margin-bottom:16px;resize:vertical"></textarea>

                <div id="commit-preview" style="background:var(--bg-secondary);padding:12px;border-radius:6px;margin-bottom:16px">
                    <div class="loading">Завантаження змін...</div>
                </div>

                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Скасувати</button>
                    <button class="btn btn-primary" onclick="GitView.createCommit()">📝 Commit</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.getElementById('commit-message').focus();

        // Load commit preview
        this.loadCommitPreview();
    },

    async loadCommitPreview() {
        try {
            const data = await API.getCommitPreview(this.currentProject);
            const preview = document.getElementById('commit-preview');

            const stats = data.stats || { added: 0, modified: 0, removed: 0 };
            const total = stats.added + stats.modified + stats.removed;

            if (total === 0) {
                preview.innerHTML = `
                    <div style="text-align:center;color:var(--hint)">
                        <p>Немає змін для commit</p>
                    </div>`;
            } else {
                preview.innerHTML = `
                    <div style="display:flex;gap:16px;justify-content:center">
                        <div style="text-align:center">
                            <div style="font-size:24px;color:var(--success)">+${stats.added}</div>
                            <div style="font-size:12px;color:var(--hint)">Додано</div>
                        </div>
                        <div style="text-align:center">
                            <div style="font-size:24px;color:var(--link)">~${stats.modified}</div>
                            <div style="font-size:12px;color:var(--hint)">Змінено</div>
                        </div>
                        <div style="text-align:center">
                            <div style="font-size:24px;color:var(--error)">-${stats.removed}</div>
                            <div style="font-size:12px;color:var(--hint)">Видалено</div>
                        </div>
                    </div>`;
            }
        } catch (e) {
            document.getElementById('commit-preview').innerHTML = `
                <div style="color:var(--error)">Помилка завантаження: ${App.esc(e.message)}</div>`;
        }
    },

    async createCommit() {
        const textarea = document.getElementById('commit-message');
        const message = textarea.value.trim();

        if (!message) {
            App.toast('Введіть повідомлення commit', 'warning');
            return;
        }

        try {
            await API.createCommit(this.currentProject, message);

            document.querySelector('.modal-overlay').remove();
            App.toast('Commit створено', 'success');

            // Haptic feedback
            if (App.tg && App.tg.HapticFeedback) {
                App.tg.HapticFeedback.notificationOccurred('success');
            }
        } catch (e) {
            App.toast(e.message, 'error');
        }
    },

    async showHistory() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width:800px;max-height:90vh">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="margin:0">📜 Історія commits</h3>
                    <button class="btn btn-sm btn-secondary" onclick="this.closest('.modal-overlay').remove()">✕</button>
                </div>
                <div id="commits-list" style="max-height:70vh;overflow-y:auto">
                    <div class="loading">Завантаження...</div>
                </div>
            </div>`;

        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        try {
            const data = await API.getCommits(this.currentProject, this.currentBranch.id);
            this.commits = data.commits || [];
            this.renderCommits();
        } catch (e) {
            document.getElementById('commits-list').innerHTML = `
                <div class="empty" style="padding:20px;color:var(--error)">
                    <p>❌ Помилка: ${App.esc(e.message)}</p>
                </div>`;
        }
    },

    renderCommits() {
        const container = document.getElementById('commits-list');

        if (this.commits.length === 0) {
            container.innerHTML = `
                <div class="empty" style="padding:40px;text-align:center">
                    <div style="font-size:48px;margin-bottom:12px">📝</div>
                    <p>Немає commits</p>
                </div>`;
            return;
        }

        const html = this.commits.map((c, i) => `
            <div class="commit-item" style="padding:16px;border-left:3px solid var(--link);background:var(--bg-secondary);border-radius:6px;margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                    <div>
                        <div style="font-weight:600;font-size:15px;margin-bottom:4px">${App.esc(c.message)}</div>
                        <div style="font-size:12px;color:var(--hint)">
                            ${App.esc(c.author_name || 'Unknown')} • ${App.fmtDate(c.created_at)}
                        </div>
                    </div>
                    ${i === 0 ? '<span class="status-badge status-approved" style="font-size:11px">HEAD</span>' : ''}
                </div>
                <div style="display:flex;gap:12px;font-size:13px;color:var(--hint)">
                    <span style="color:var(--success)">+${c.terms_added || 0}</span>
                    <span style="color:var(--link)">~${c.terms_modified || 0}</span>
                    <span style="color:var(--error)">-${c.terms_removed || 0}</span>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }
};
