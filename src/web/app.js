const App = {
    tg: window.Telegram && window.Telegram.WebApp,
    currentView: 'projects',
    currentProject: null,
    isAdmin: false,
    isDesktop: false,
    isMobile: false,

    async init() {
        // Check authentication first (for web browser mode)
        if (typeof Auth !== 'undefined' && Auth.isWebBrowser()) {
            const isAuthed = await Auth.checkAuthAndRedirect();
            if (!isAuthed) return;
        }

        if (this.tg && this.tg.initData) {
            this.tg.ready();
            this.tg.expand();
            this.tg.enableClosingConfirmation();
            this.isAdmin = !!(this.tg.initDataUnsafe && this.tg.initDataUnsafe.user &&
                this.tg.initDataUnsafe.user.id && this.tg.initDataUnsafe.start_param === 'admin');
        }

        this.isDesktop = typeof Auth !== 'undefined' && Auth.isDesktop();
        this.isMobile = window.innerWidth < 768;

        if (this.isDesktop) document.body.classList.add('desktop');

        // Create toast container
        if (!document.querySelector('.toast-container')) {
            const tc = document.createElement('div');
            tc.className = 'toast-container';
            document.body.appendChild(tc);
        }

        // Build sidebar + mobile bottom nav
        SidebarView.render();
        SidebarView.renderBottomNav();

        // Show/hide mobile menu button
        this._updateMobileUI();
        window.addEventListener('resize', () => {
            this.isMobile = window.innerWidth < 768;
            this._updateMobileUI();
        });

        // Set menu icon
        const menuIcon = document.getElementById('menu-icon');
        if (menuIcon) menuIcon.innerHTML = Icons.menu;

        // Set FAB icon
        const fabIcon = document.getElementById('fab-icon');
        if (fabIcon) fabIcon.innerHTML = Icons.plus;

        this.navigate('projects');
        this.setupKeyboardShortcuts();
    },

    _updateMobileUI() {
        const menuBtn = document.getElementById('mobile-menu-btn');
        if (menuBtn) menuBtn.style.display = this.isMobile ? '' : 'none';
    },

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.matches('input, textarea, [contenteditable="true"]')) return;

            // Ctrl/Cmd + K → Focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                const search = document.querySelector('.search-bar input, #glossary-search');
                if (search) { search.focus(); search.select(); }
            }

            // Ctrl/Cmd + S → Export glossary
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (this.currentView === 'glossary' && this.currentProject) {
                    GlossaryView.exportTSV(this.currentProject.id);
                }
            }

            // Ctrl/Cmd + A → Select all terms (in glossary view)
            if ((e.ctrlKey || e.metaKey) && e.key === 'a' && this.currentView === 'glossary') {
                e.preventDefault();
                if (this.currentProject && GlossaryView.selectAll) GlossaryView.selectAll();
            }

            // Ctrl/Cmd + Z → Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (this.currentView === 'glossary' && window.glossaryHistory) {
                    const action = glossaryHistory.undo();
                    if (action) this.toast('\u21b6 \u0421\u043a\u0430\u0441\u043e\u0432\u0430\u043d\u043e: ' + action.description, 'info');
                }
            }

            // Ctrl/Cmd + Shift + Z → Redo
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
                e.preventDefault();
                if (this.currentView === 'glossary' && window.glossaryHistory) {
                    const action = glossaryHistory.redo();
                    if (action) this.toast('\u21b7 \u041f\u043e\u0432\u0442\u043e\u0440\u0435\u043d\u043e: ' + action.description, 'info');
                }
            }

            // Escape → Close modals / wizard / deselect
            if (e.key === 'Escape') {
                // Close wizard first
                if (typeof UploadWizard !== 'undefined' && UploadWizard._visible) {
                    UploadWizard.close(); return;
                }
                const modals = document.querySelectorAll('.modal-overlay');
                if (modals.length > 0) { modals.forEach(m => m.remove()); return; }
                if (this.currentView === 'glossary' && GlossaryView.deselectAll) GlossaryView.deselectAll();
            }

            // ? → Show keyboard shortcuts help
            if (e.key === '?' && !e.shiftKey) { e.preventDefault(); this.showKeyboardHelp(); }

            // Alt + 1-8 → Navigate between views
            if (e.altKey && e.key >= '1' && e.key <= '8') {
                e.preventDefault();
                const views = ['projects', 'files', 'glossary', 'instructions', 'pricing', 'versions', 'team', 'settings'];
                const index = parseInt(e.key) - 1;
                if (views[index]) this.navigate(views[index]);
            }
        });
    },

    showKeyboardHelp() {
        const shortcuts = [
            { keys: 'Ctrl+K', desc: '\u0424\u043e\u043a\u0443\u0441 \u043d\u0430 \u043f\u043e\u0448\u0443\u043a\u0443' },
            { keys: 'Ctrl+S', desc: '\u0415\u043a\u0441\u043f\u043e\u0440\u0442 \u0433\u043b\u043e\u0441\u0430\u0440\u0456\u044e' },
            { keys: 'Ctrl+A', desc: '\u041e\u0431\u0440\u0430\u0442\u0438 \u0432\u0441\u0456 \u0442\u0435\u0440\u043c\u0456\u043d\u0438' },
            { keys: 'Ctrl+Z', desc: '\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438 \u0434\u0456\u044e' },
            { keys: 'Ctrl+Shift+Z', desc: '\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0438 \u0434\u0456\u044e' },
            { keys: 'Escape', desc: '\u0417\u0430\u043a\u0440\u0438\u0442\u0438 \u043c\u043e\u0434\u0430\u043b\u044c\u043d\u0435 \u0432\u0456\u043a\u043d\u043e' },
            { keys: 'Alt+1-8', desc: '\u041f\u0435\u0440\u0435\u043c\u043a\u043d\u0443\u0442\u0438 \u0432\u043a\u043b\u0430\u0434\u043a\u0443' },
            { keys: '?', desc: '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u0438 \u0446\u044e \u0434\u043e\u0432\u0456\u0434\u043a\u0443' },
        ];

        const html = `
            <div class="modal">
                <h3>${Icons.wrap('info', 20)} \u0413\u0430\u0440\u044f\u0447\u0456 \u043a\u043b\u0430\u0432\u0456\u0448\u0456</h3>
                <table style="width:100%;text-align:left;margin:16px 0">
                    ${shortcuts.map(s => `
                        <tr>
                            <td style="padding:6px 12px;font-family:monospace;background:var(--bg-surface-2);border-radius:6px;white-space:nowrap;color:var(--text-primary)">
                                ${this.esc(s.keys)}
                            </td>
                            <td style="padding:6px 12px;color:var(--text-secondary)">${this.esc(s.desc)}</td>
                        </tr>
                    `).join('')}
                </table>
                <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">\u0417\u0430\u043a\u0440\u0438\u0442\u0438</button>
            </div>`;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = html;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    navigate(view) {
        const prev = this.currentView;
        this.currentView = view;

        // Update sidebar + bottom nav active states
        SidebarView.setActive(view);
        this.updateBreadcrumb();

        // Show/hide FAB (only in project context for files-related views)
        this._updateFAB();

        const c = document.getElementById('content');
        const renderFn = () => {
            switch (view) {
                case 'projects': ProjectsView.render(c); break;
                case 'files': FilesView.render(c, this.currentProject); break;
                case 'instructions': InstructionsView.render(c, this.currentProject); break;
                case 'glossary': GlossaryView.render(c, this.currentProject); break;
                case 'versions': GlossaryVersionsView.render(c, this.currentProject); break;
                case 'settings': SettingsView.render(c, this.currentProject); break;
                case 'team': TeamView.render(c, this.currentProject); break;
                case 'pricing': PricingView.render(c, this.currentProject); break;
            }
        };

        // Use transitions if available and view actually changed
        if (typeof Transitions !== 'undefined' && prev !== view) {
            Transitions.switchView(c, renderFn, 'fade');
        } else {
            renderFn();
        }
    },

    _updateFAB() {
        const fab = document.getElementById('fab-upload');
        if (!fab) return;
        const showFab = this.currentProject && ['files', 'glossary', 'instructions'].includes(this.currentView);
        fab.style.display = showFab ? '' : 'none';
    },

    selectProject(project) {
        this.currentProject = project;

        if (window.RoleManager && window.RoleManager.setUser) {
            const roleMap = { 'owner': 'owner', 'admin': 'admin', 'member': 'admin' };
            window.RoleManager.setUser(null, roleMap[project.role] || 'admin');
        }

        this.navigate('files');
    },

    updateBreadcrumb() {
        const breadcrumb = document.getElementById('breadcrumb');
        const projectInfo = document.getElementById('project-info');
        const title = document.getElementById('app-title');
        if (!breadcrumb) return;

        let crumbs = [];

        if (this.currentProject) {
            crumbs.push('<a href="#" onclick="App.backToProjects(); return false;">\u041f\u0440\u043e\u0454\u043a\u0442\u0438</a>');
            crumbs.push('<span>' + this.esc(this.currentProject.name) + '</span>');

            if (projectInfo) {
                const role = this.currentProject.role || 'member';
                const langs = this.currentProject.source_lang && this.currentProject.target_lang
                    ? this.currentProject.source_lang + ' \u2192 ' + this.currentProject.target_lang : '';
                projectInfo.innerHTML = `
                    <span class="project-badge">
                        <span class="project-role">${this.esc(role)}</span>
                        ${langs ? '<span class="project-langs">' + this.esc(langs) + '</span>' : ''}
                    </span>`;
            }
            // Hide title on mobile when breadcrumb is showing
            if (title) title.style.display = this.isMobile ? 'none' : '';
        } else {
            if (projectInfo) projectInfo.innerHTML = '';
            if (title) title.style.display = '';
        }

        breadcrumb.innerHTML = crumbs.join(' <span class="breadcrumb-sep">\u203a</span> ');
    },

    backToProjects() {
        this.currentProject = null;
        this.navigate('projects');
    },

    toast(message, type) {
        type = type || 'info';
        const container = document.querySelector('.toast-container');
        if (!container) return;
        const iconMap = { success: 'success', error: 'error', info: 'info', warning: 'warning' };
        const el = document.createElement('div');
        el.className = 'toast toast-' + type;
        el.innerHTML = Icons.wrap(iconMap[type] || 'info', 16) + '<span>' + this.esc(message) + '</span>';
        container.appendChild(el);
        // Animate in
        requestAnimationFrame(() => el.classList.add('visible'));
        setTimeout(() => {
            el.classList.add('removing');
            setTimeout(() => el.remove(), 300);
        }, 3500);
    },

    modalConfirm(title, message, onConfirm, confirmLabel, cancelLabel) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal">
                <h3>${this.esc(title)}</h3>
                <p>${this.esc(message)}</p>
                <div class="modal-actions">
                    <button class="btn btn-secondary" data-action="cancel">${this.esc(cancelLabel || '\u0421\u043a\u0430\u0441\u0443\u0432\u0430\u0442\u0438')}</button>
                    <button class="btn btn-primary" data-action="confirm">${this.esc(confirmLabel || '\u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0438')}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
        overlay.querySelector('[data-action="cancel"]').onclick = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        };
        overlay.querySelector('[data-action="confirm"]').onclick = () => {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
            if (onConfirm) onConfirm();
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 300);
            }
        });
    },

    alert(msg) { this.toast(msg, 'info'); },

    confirm(msg, cb) {
        this.modalConfirm('\u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f', msg, () => cb(true), '\u0422\u0430\u043a', '\u041d\u0456');
    },

    esc(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    },

    fmtEuro(cents) {
        if (!cents) return '0.00';
        return (cents / 100).toFixed(2);
    },

    fmtDate(ts) {
        if (!ts) return '';
        const d = new Date(ts * 1000);
        return d.toLocaleDateString('uk-UA') + ' ' + d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    },

    fmtSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    },

    skeleton(lines) {
        lines = lines || 3;
        let html = '';
        for (let i = 0; i < lines; i++) {
            const w = i === lines - 1 ? 'width:60%' : '';
            html += '<div class="skeleton skeleton-line" style="' + w + '"></div>';
        }
        return html;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
