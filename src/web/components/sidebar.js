/* ---------------------------------------------------------------
 *  sidebar.js — Left sidebar navigation (desktop) + mobile bottom nav
 *  Global object: SidebarView
 * --------------------------------------------------------------- */
const SidebarView = {
    _open: false,

    /** Main navigation items (shown in sidebar + bottom nav) */
    navItems: [
        { id: 'projects',     label: 'Замовлення',    icon: 'projects',     accent: 'blue' },
        { id: 'pricing',      label: 'Оплата',        icon: 'pricing',      accent: 'green' },
        { id: 'files',        label: 'Файли',         icon: 'files',        accent: 'pink' },
        { id: 'team',         label: 'Команда',       icon: 'team',         accent: 'cyan' },
    ],

    /** Secondary navigation items (sidebar only, mobile "more" menu) */
    secondaryItems: [
        { id: 'guide', label: 'Інструкція', icon: 'info', accent: 'blue' },
        { id: 'audit', label: 'Журнал', icon: 'clock', accent: 'orange' },
        { id: 'admin', label: 'Адмін', icon: 'admin', accent: 'orange', adminOnly: true },
    ],

    /** Render the desktop sidebar */
    render() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        const mainNav = this.navItems.map(item => this._navItem(item)).join('');
        const secNav = this._visibleSecondaryItems().map(item => this._navItem(item)).join('');

        sidebar.innerHTML = `
            <div class="sidebar-header">
                <div class="sidebar-logo">
                    ${Icons.wrap('globe', 28)}
                    <span>Перекладач</span>
                </div>
            </div>
            <nav class="sidebar-nav">
                <div class="sidebar-section">
                    ${mainNav}
                </div>
                <div class="sidebar-divider"></div>
                <div class="sidebar-section">
                    ${secNav}
                </div>
            </nav>
            <div class="sidebar-footer">
                ${App.isAdmin ? '<div class="sidebar-admin-badge">' + Icons.wrap('admin', 14) + ' Адмін</div>' : ''}
                <a href="https://kaminskyi.chat" target="_blank" class="sidebar-link">kaminskyi.chat</a>
            </div>`;

        // Click handlers for nav items
        sidebar.querySelectorAll('.sidebar-item').forEach(el => {
            el.addEventListener('click', () => {
                const view = el.dataset.view;
                if (view) {
                    App.navigate(view);
                    // Close mobile sidebar if open
                    if (window.innerWidth < 768) this.close();
                }
            });
        });
    },

    /** Build the mobile bottom navigation bar */
    renderBottomNav() {
        const nav = document.getElementById('bottom-nav');
        if (!nav) return;

        const items = this.navItems.slice(0, 4);
        const moreItems = [
            ...this.navItems.slice(4),
            ...this._visibleSecondaryItems()
        ];
        nav.innerHTML = items.map(item => `
            <button class="bottom-nav-item${App.currentView === item.id ? ' active' : ''}" data-view="${item.id}">
                ${Icons.wrap(item.icon, 22)}
                <span>${item.label}</span>
            </button>
        `).join('') + (moreItems.length ? `
            <button class="bottom-nav-item" id="bottom-nav-more">
                ${Icons.wrap('more', 22)}
                <span>Ще</span>
            </button>` : '');

        nav.querySelectorAll('.bottom-nav-item[data-view]').forEach(el => {
            el.addEventListener('click', () => {
                App.navigate(el.dataset.view);
            });
        });

        const moreBtn = document.getElementById('bottom-nav-more');
        if (moreBtn) {
            moreBtn.addEventListener('click', () => this._showMoreSheet());
        }
    },

    /** Highlight active nav item */
    setActive(viewId) {
        // Desktop sidebar
        document.querySelectorAll('.sidebar-item').forEach(el => {
            el.classList.toggle('active', el.dataset.view === viewId);
        });
        // Mobile bottom nav
        document.querySelectorAll('.bottom-nav-item[data-view]').forEach(el => {
            el.classList.toggle('active', el.dataset.view === viewId);
        });
        // Check "more" if secondary view is active
        const moreBtn = document.getElementById('bottom-nav-more');
        if (moreBtn) {
            const isSecondary = this.secondaryItems.some(i => i.id === viewId) ||
                                this.navItems.slice(4).some(i => i.id === viewId);
            moreBtn.classList.toggle('active', isSecondary);
        }
    },

    /** Toggle mobile sidebar (hamburger) */
    toggle() {
        this._open ? this.close() : this.open();
    },

    open() {
        this._open = true;
        const sidebar = document.getElementById('sidebar');
        const overlay = this._getOverlay();
        if (sidebar) sidebar.classList.add('open');
        if (overlay) overlay.classList.add('visible');
        document.body.style.overflow = 'hidden';
    },

    close() {
        this._open = false;
        const sidebar = document.getElementById('sidebar');
        const overlay = this._getOverlay();
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('visible');
        document.body.style.overflow = '';
    },

    /** Show mobile "more" bottom sheet */
    _showMoreSheet() {
        // Combine secondary + remaining main items
        const moreItems = [
            ...this.navItems.slice(4),
            ...this._visibleSecondaryItems()
        ];

        const overlay = document.createElement('div');
        overlay.className = 'more-sheet-overlay';
        overlay.innerHTML = `
            <div class="more-sheet">
                <div class="more-sheet-handle"></div>
                <div class="more-sheet-items">
                    ${moreItems.map(item => `
                        <button class="more-sheet-item" data-view="${item.id}">
                            ${Icons.wrap(item.icon, 22)}
                            <span>${item.label}</span>
                            ${App.currentView === item.id ? '<span class="active-dot"></span>' : ''}
                        </button>
                    `).join('')}
                </div>
            </div>`;

        document.body.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => overlay.classList.add('visible'));

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 300);
            }
        });

        // Nav item clicks
        overlay.querySelectorAll('.more-sheet-item').forEach(el => {
            el.addEventListener('click', () => {
                const view = el.dataset.view;
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 300);
                if (view) App.navigate(view);
            });
        });
    },

    /** Build a single sidebar nav item HTML */
    _navItem(item) {
        return `<button class="sidebar-item sidebar-item--${item.accent}" data-view="${item.id}">
            <span class="sidebar-icon">${Icons.wrap(item.icon, 20)}</span>
            <span class="sidebar-label">${item.label}</span>
        </button>`;
    },

    _visibleSecondaryItems() {
        return this.secondaryItems.filter(item => !item.adminOnly || App.isAdmin);
    },

    /** Get or create mobile overlay */
    _getOverlay() {
        let overlay = document.getElementById('sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'sidebar-overlay';
            overlay.className = 'sidebar-overlay';
            overlay.addEventListener('click', () => this.close());
            document.body.appendChild(overlay);
        }
        return overlay;
    }
};
