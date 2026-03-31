/**
 * Role-Based Access Control (RBAC) System
 * Enterprise-grade permission management
 */

const ROLES = {
    OWNER: 'owner',           // Project owner - full access
    ADMIN: 'admin',           // Project admin - all except delete
    TRANSLATOR: 'translator',  // Can translate, comment, view files
    REVIEWER: 'reviewer',      // Can review translations, add comments
    CLIENT: 'client',          // View-only, can approve/reject, comment
    GUEST: 'guest'            // Read-only access
};

const PERMISSIONS = {
    // Project permissions
    PROJECT_DELETE: 'project:delete',
    PROJECT_EDIT: 'project:edit',
    PROJECT_VIEW: 'project:view',
    PROJECT_INVITE: 'project:invite',

    // File permissions
    FILE_UPLOAD: 'file:upload',
    FILE_DELETE: 'file:delete',
    FILE_VIEW: 'file:view',
    FILE_DOWNLOAD: 'file:download',

    // Glossary permissions
    GLOSSARY_CREATE: 'glossary:create',
    GLOSSARY_EDIT: 'glossary:edit',
    GLOSSARY_APPROVE: 'glossary:approve',
    GLOSSARY_REJECT: 'glossary:reject',
    GLOSSARY_EXPORT: 'glossary:export',
    GLOSSARY_VIEW: 'glossary:view',

    // Translation permissions
    TRANSLATE: 'translate:execute',
    TRANSLATE_REVIEW: 'translate:review',

    // Comment permissions
    COMMENT_ADD: 'comment:add',
    COMMENT_EDIT: 'comment:edit',
    COMMENT_DELETE: 'comment:delete',

    // Version control permissions
    VERSION_CREATE: 'version:create',
    VERSION_MERGE: 'version:merge',
    VERSION_REVERT: 'version:revert',

    // Team permissions
    TEAM_INVITE: 'team:invite',
    TEAM_REMOVE: 'team:remove',
    TEAM_EDIT_ROLES: 'team:edit_roles',

    // Settings permissions
    SETTINGS_EDIT: 'settings:edit',
    BILLING_VIEW: 'billing:view',
    BILLING_EDIT: 'billing:edit'
};

const ROLE_PERMISSIONS = {
    [ROLES.OWNER]: Object.values(PERMISSIONS),

    [ROLES.ADMIN]: [
        PERMISSIONS.PROJECT_EDIT,
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.PROJECT_INVITE,
        PERMISSIONS.FILE_UPLOAD,
        PERMISSIONS.FILE_DELETE,
        PERMISSIONS.FILE_VIEW,
        PERMISSIONS.FILE_DOWNLOAD,
        PERMISSIONS.GLOSSARY_CREATE,
        PERMISSIONS.GLOSSARY_EDIT,
        PERMISSIONS.GLOSSARY_APPROVE,
        PERMISSIONS.GLOSSARY_REJECT,
        PERMISSIONS.GLOSSARY_EXPORT,
        PERMISSIONS.GLOSSARY_VIEW,
        PERMISSIONS.TRANSLATE,
        PERMISSIONS.TRANSLATE_REVIEW,
        PERMISSIONS.COMMENT_ADD,
        PERMISSIONS.COMMENT_EDIT,
        PERMISSIONS.COMMENT_DELETE,
        PERMISSIONS.VERSION_CREATE,
        PERMISSIONS.VERSION_MERGE,
        PERMISSIONS.VERSION_REVERT,
        PERMISSIONS.TEAM_INVITE,
        PERMISSIONS.TEAM_REMOVE,
        PERMISSIONS.TEAM_EDIT_ROLES,
        PERMISSIONS.SETTINGS_EDIT,
        PERMISSIONS.BILLING_VIEW
    ],

    [ROLES.TRANSLATOR]: [
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.FILE_VIEW,
        PERMISSIONS.FILE_DOWNLOAD,
        PERMISSIONS.GLOSSARY_EDIT,
        PERMISSIONS.GLOSSARY_VIEW,
        PERMISSIONS.TRANSLATE,
        PERMISSIONS.COMMENT_ADD,
        PERMISSIONS.COMMENT_EDIT,
        PERMISSIONS.VERSION_CREATE
    ],

    [ROLES.REVIEWER]: [
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.FILE_VIEW,
        PERMISSIONS.FILE_DOWNLOAD,
        PERMISSIONS.GLOSSARY_APPROVE,
        PERMISSIONS.GLOSSARY_REJECT,
        PERMISSIONS.GLOSSARY_VIEW,
        PERMISSIONS.TRANSLATE_REVIEW,
        PERMISSIONS.COMMENT_ADD,
        PERMISSIONS.VERSION_CREATE
    ],

    [ROLES.CLIENT]: [
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.FILE_VIEW,
        PERMISSIONS.FILE_DOWNLOAD,
        PERMISSIONS.GLOSSARY_APPROVE,
        PERMISSIONS.GLOSSARY_REJECT,
        PERMISSIONS.GLOSSARY_VIEW,
        PERMISSIONS.GLOSSARY_EXPORT,
        PERMISSIONS.COMMENT_ADD
    ],

    [ROLES.GUEST]: [
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.FILE_VIEW,
        PERMISSIONS.GLOSSARY_VIEW
    ]
};

class RoleManager {
    constructor() {
        this.currentUser = null;
        this.currentRole = ROLES.GUEST;
    }

    setUser(user, role) {
        this.currentUser = user;
        this.currentRole = role || ROLES.GUEST;
        this.updateUI();
    }

    hasPermission(permission) {
        const permissions = ROLE_PERMISSIONS[this.currentRole] || [];
        return permissions.includes(permission);
    }

    can(permission) {
        return this.hasPermission(permission);
    }

    cannot(permission) {
        return !this.hasPermission(permission);
    }

    isOwner() {
        return this.currentRole === ROLES.OWNER;
    }

    isAdmin() {
        return this.currentRole === ROLES.ADMIN || this.isOwner();
    }

    canManageProject() {
        return this.can(PERMISSIONS.PROJECT_EDIT);
    }

    canManageTeam() {
        return this.can(PERMISSIONS.TEAM_EDIT_ROLES);
    }

    updateUI() {
        // Hide/show elements based on permissions
        document.querySelectorAll('[data-permission]').forEach(el => {
            const perm = el.dataset.permission;
            if (this.cannot(perm)) {
                el.style.display = 'none';
            } else {
                el.style.display = '';
            }
        });

        // Disable buttons based on permissions
        document.querySelectorAll('button[data-require-permission]').forEach(btn => {
            const perm = btn.dataset.requirePermission;
            btn.disabled = this.cannot(perm);
            if (btn.disabled) {
                btn.title = 'У вас немає прав для цієї дії';
            }
        });

        // Add role badge to UI
        this.updateRoleBadge();
    }

    updateRoleBadge() {
        const existingBadge = document.querySelector('.role-badge');
        if (existingBadge) existingBadge.remove();

        const roleLabels = {
            [ROLES.OWNER]: '👑 Власник',
            [ROLES.ADMIN]: '⚡ Адмін',
            [ROLES.TRANSLATOR]: '✍️ Перекладач',
            [ROLES.REVIEWER]: '✅ Рецензент',
            [ROLES.CLIENT]: '👤 Замовник',
            [ROLES.GUEST]: '👁️ Гість'
        };

        const badge = document.createElement('div');
        badge.className = 'role-badge role-' + this.currentRole;
        badge.textContent = roleLabels[this.currentRole] || '?';
        badge.title = 'Ваша роль у проєкті';

        const nav = document.getElementById('nav');
        if (nav) {
            nav.insertBefore(badge, nav.firstChild);
        }
    }

    getRoleColor(role) {
        const colors = {
            [ROLES.OWNER]: '#ffd700',
            [ROLES.ADMIN]: '#ff6b6b',
            [ROLES.TRANSLATOR]: '#4ecdc4',
            [ROLES.REVIEWER]: '#95e1d3',
            [ROLES.CLIENT]: '#a8dadc',
            [ROLES.GUEST]: '#e0e0e0'
        };
        return colors[role] || '#999';
    }

    promptUpgrade(requiredPermission) {
        const permLabels = {
            [PERMISSIONS.PROJECT_DELETE]: 'видалення проєкту',
            [PERMISSIONS.GLOSSARY_EDIT]: 'редагування глосарію',
            [PERMISSIONS.TRANSLATE]: 'перекладу',
            [PERMISSIONS.FILE_UPLOAD]: 'завантаження файлів'
        };

        const label = permLabels[requiredPermission] || 'цієї дії';
        App.toast(`У вас немає прав для ${label}. Зверніться до власника проєкту.`, 'warning');
    }
}

// Global exports
window.ROLES = ROLES;
window.PERMISSIONS = PERMISSIONS;
window.RoleManager = new RoleManager();
