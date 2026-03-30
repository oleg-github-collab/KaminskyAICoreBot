const App = {
    tg: window.Telegram && window.Telegram.WebApp,
    currentView: 'projects',
    currentProject: null,
    isAdmin: false,
    isDesktop: false,

    init() {
        if (this.tg && this.tg.initData) {
            this.tg.ready();
            this.tg.expand();
            this.tg.enableClosingConfirmation();
            this.isAdmin = !!(this.tg.initDataUnsafe && this.tg.initDataUnsafe.user &&
                this.tg.initDataUnsafe.user.id && this.tg.initDataUnsafe.start_param === 'admin');
        }

        // Desktop detection
        this.isDesktop = typeof Auth !== 'undefined' && Auth.isDesktop();
        if (this.isDesktop) {
            document.body.classList.add('desktop');
            // Auto-create session if we have TMA auth
            if (this.tg && this.tg.initData && !Auth.getToken()) {
                Auth.createSession();
            }
        }

        this.buildNav();
        this.navigate('projects');
    },

    buildNav() {
        const nav = document.getElementById('nav');
        const views = [
            { id: 'projects', label: 'Проєкти', icon: '📁' },
            { id: 'files', label: 'Файли', icon: '📄' },
            { id: 'pricing', label: 'Вартість', icon: '💰' },
            { id: 'glossary', label: 'Глосарій', icon: '📋' },
            { id: 'versions', label: 'Версії', icon: '📊' },
            { id: 'settings', label: 'Налаштування', icon: '⚙️' },
            { id: 'team', label: 'Команда', icon: '👥' },
            { id: 'messages', label: 'Чат', icon: '💬' },
        ];
        nav.innerHTML = views.map(v =>
            `<button class="nav-btn${v.id === this.currentView ? ' active' : ''}" data-view="${v.id}">${v.icon} ${v.label}</button>`
        ).join('');
        nav.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.navigate(btn.dataset.view));
        });
    },

    navigate(view) {
        this.currentView = view;
        document.querySelectorAll('.nav-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.view === view));
        const c = document.getElementById('content');
        switch (view) {
            case 'projects': ProjectsView.render(c); break;
            case 'files': FilesView.render(c, this.currentProject); break;
            case 'glossary': GlossaryView.render(c, this.currentProject); break;
            case 'versions': GlossaryVersionsView.render(c, this.currentProject); break;
            case 'settings': SettingsView.render(c, this.currentProject); break;
            case 'team': TeamView.render(c, this.currentProject); break;
            case 'pricing': PricingView.render(c, this.currentProject); break;
            case 'messages': MessagesView.render(c, this.currentProject); break;
        }
    },

    selectProject(project) {
        this.currentProject = project;
        this.navigate('files');
    },

    backToProjects() {
        this.currentProject = null;
        this.navigate('projects');
    },

    alert(msg) {
        if (this.tg && this.tg.showAlert) this.tg.showAlert(msg);
        else alert(msg);
    },

    confirm(msg, cb) {
        if (this.tg && this.tg.showConfirm) this.tg.showConfirm(msg, cb);
        else cb(confirm(msg));
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
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
