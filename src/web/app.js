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
            this.isAdmin = !!(Auth.currentUser && Auth.currentUser.is_admin);
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

            // Escape closes any open modal.
            if (e.key === 'Escape') {
                const modals = document.querySelectorAll('.modal-overlay');
                if (modals.length > 0) { modals.forEach(m => m.remove()); return; }
            }

            // Alt + 1-7 switches between active screens.
            if (e.altKey && e.key >= '1' && e.key <= '7') {
                e.preventDefault();
                const views = ['projects', 'pricing', 'files', 'team', 'guide', 'audit', 'admin'];
                const index = parseInt(e.key) - 1;
                if (views[index]) this.navigate(views[index]);
            }
        });
    },

    navigate(view) {
        const prev = this.currentView;
        if (prev === 'pricing' && view !== 'pricing' && typeof PricingView !== 'undefined' && PricingView.stopStatusPolling) {
            PricingView.stopStatusPolling();
        }
        const allowedViews = ['projects', 'pricing', 'files', 'team', 'guide', 'audit'];
        if (this.isAdmin) allowedViews.push('admin');
        if (!allowedViews.includes(view)) view = 'projects';
        this.currentView = view;

        // Update sidebar + bottom nav active states
        SidebarView.setActive(view);
        this.updateBreadcrumb();

        const c = document.getElementById('content');
        const renderFn = () => {
            switch (view) {
                case 'projects': ProjectsView.render(c); break;
                case 'files': FilesView.render(c, this.currentProject); break;
                case 'pricing': PricingView.render(c, this.currentProject); break;
                case 'team': TeamView.render(c, this.currentProject); break;
                case 'guide': GuideView.render(c, this.currentProject); break;
                case 'audit': AuditView.render(c, this.currentProject); break;
                case 'admin': AdminView.render(c); break;
            }
        };

        // Use transitions if available and view actually changed
        if (typeof Transitions !== 'undefined' && prev !== view) {
            Transitions.switchView(c, renderFn, 'fade');
        } else {
            renderFn();
        }
    },

    selectProject(project) {
        this.currentProject = project;
        this.navigate('pricing');
    },

    updateBreadcrumb() {
        const breadcrumb = document.getElementById('breadcrumb');
        const projectInfo = document.getElementById('project-info');
        const title = document.getElementById('app-title');
        if (!breadcrumb) return;

        let crumbs = [];

        if (this.currentProject) {
            crumbs.push('<a href="#" onclick="App.backToProjects(); return false;">\u0417\u0430\u043c\u043e\u0432\u043b\u0435\u043d\u043d\u044f</a>');
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
