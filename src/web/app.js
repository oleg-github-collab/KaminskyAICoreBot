const App = {
    tg: window.Telegram && window.Telegram.WebApp,
    currentView: 'projects',
    currentProject: null,
    isAdmin: false,

    init() {
        if (this.tg) {
            this.tg.ready();
            this.tg.expand();
            this.tg.enableClosingConfirmation();
            this.isAdmin = !!(this.tg.initDataUnsafe && this.tg.initDataUnsafe.user &&
                this.tg.initDataUnsafe.user.id && this.tg.initDataUnsafe.start_param === 'admin');
        }
        this.buildNav();
        this.navigate('projects');
    },

    buildNav() {
        const nav = document.getElementById('nav');
        const views = [
            { id: 'projects', label: 'Projects' },
            { id: 'files', label: 'Files' },
            { id: 'glossary', label: 'Glossary' },
            { id: 'team', label: 'Team' },
            { id: 'pricing', label: 'Pricing' },
            { id: 'messages', label: 'Messages' },
        ];
        nav.innerHTML = views.map(v =>
            `<button class="nav-btn${v.id === this.currentView ? ' active' : ''}" data-view="${v.id}">${v.label}</button>`
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
            case 'team': TeamView.render(c, this.currentProject); break;
            case 'pricing': PricingView.render(c, this.currentProject); break;
            case 'messages': MessagesView.render(c, this.currentProject); break;
        }
    },

    selectProject(project) {
        this.currentProject = project;
        this.navigate('files');
    },

    alert(msg) {
        if (this.tg) this.tg.showAlert(msg);
        else alert(msg);
    },

    confirm(msg, cb) {
        if (this.tg) this.tg.showConfirm(msg, cb);
        else cb(confirm(msg));
    },

    esc(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
