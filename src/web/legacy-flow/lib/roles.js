/**
 * Role-Based Access Control (RBAC)
 */

const ROLES = {
    OWNER: 'owner',
    ADMIN: 'admin',
    TRANSLATOR: 'translator',
    REVIEWER: 'reviewer',
    CLIENT: 'client',
    GUEST: 'guest'
};

const PERMISSIONS = {
    PROJECT_DELETE: 'project:delete',
    PROJECT_EDIT: 'project:edit',
    PROJECT_VIEW: 'project:view',
    PROJECT_INVITE: 'project:invite',
    FILE_UPLOAD: 'file:upload',
    FILE_DELETE: 'file:delete',
    FILE_VIEW: 'file:view',
    FILE_DOWNLOAD: 'file:download',
    GLOSSARY_CREATE: 'glossary:create',
    GLOSSARY_EDIT: 'glossary:edit',
    GLOSSARY_APPROVE: 'glossary:approve',
    GLOSSARY_REJECT: 'glossary:reject',
    GLOSSARY_EXPORT: 'glossary:export',
    GLOSSARY_VIEW: 'glossary:view',
    TRANSLATE: 'translate:execute',
    TRANSLATE_REVIEW: 'translate:review',
    COMMENT_ADD: 'comment:add',
    COMMENT_EDIT: 'comment:edit',
    COMMENT_DELETE: 'comment:delete',
    VERSION_CREATE: 'version:create',
    VERSION_MERGE: 'version:merge',
    VERSION_REVERT: 'version:revert',
    TEAM_INVITE: 'team:invite',
    TEAM_REMOVE: 'team:remove',
    TEAM_EDIT_ROLES: 'team:edit_roles',
    SETTINGS_EDIT: 'settings:edit',
    BILLING_VIEW: 'billing:view',
    BILLING_EDIT: 'billing:edit'
};

const ROLE_PERMISSIONS = {
    [ROLES.OWNER]: Object.values(PERMISSIONS),

    [ROLES.ADMIN]: [
        PERMISSIONS.PROJECT_EDIT, PERMISSIONS.PROJECT_VIEW, PERMISSIONS.PROJECT_INVITE,
        PERMISSIONS.FILE_UPLOAD, PERMISSIONS.FILE_DELETE, PERMISSIONS.FILE_VIEW, PERMISSIONS.FILE_DOWNLOAD,
        PERMISSIONS.GLOSSARY_CREATE, PERMISSIONS.GLOSSARY_EDIT, PERMISSIONS.GLOSSARY_APPROVE,
        PERMISSIONS.GLOSSARY_REJECT, PERMISSIONS.GLOSSARY_EXPORT, PERMISSIONS.GLOSSARY_VIEW,
        PERMISSIONS.TRANSLATE, PERMISSIONS.TRANSLATE_REVIEW,
        PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_EDIT, PERMISSIONS.COMMENT_DELETE,
        PERMISSIONS.VERSION_CREATE, PERMISSIONS.VERSION_MERGE, PERMISSIONS.VERSION_REVERT,
        PERMISSIONS.TEAM_INVITE, PERMISSIONS.TEAM_REMOVE, PERMISSIONS.TEAM_EDIT_ROLES,
        PERMISSIONS.SETTINGS_EDIT, PERMISSIONS.BILLING_VIEW
    ],

    [ROLES.TRANSLATOR]: [
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.FILE_VIEW, PERMISSIONS.FILE_DOWNLOAD, PERMISSIONS.FILE_UPLOAD,
        PERMISSIONS.GLOSSARY_EDIT, PERMISSIONS.GLOSSARY_VIEW, PERMISSIONS.GLOSSARY_EXPORT,
        PERMISSIONS.TRANSLATE, PERMISSIONS.COMMENT_ADD, PERMISSIONS.COMMENT_EDIT,
        PERMISSIONS.VERSION_CREATE
    ],

    [ROLES.REVIEWER]: [
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.FILE_VIEW, PERMISSIONS.FILE_DOWNLOAD,
        PERMISSIONS.GLOSSARY_APPROVE, PERMISSIONS.GLOSSARY_REJECT, PERMISSIONS.GLOSSARY_VIEW,
        PERMISSIONS.GLOSSARY_EXPORT, PERMISSIONS.TRANSLATE_REVIEW,
        PERMISSIONS.COMMENT_ADD, PERMISSIONS.VERSION_CREATE
    ],

    [ROLES.CLIENT]: [
        PERMISSIONS.PROJECT_VIEW,
        PERMISSIONS.FILE_VIEW, PERMISSIONS.FILE_DOWNLOAD, PERMISSIONS.FILE_UPLOAD,
        PERMISSIONS.GLOSSARY_APPROVE, PERMISSIONS.GLOSSARY_REJECT,
        PERMISSIONS.GLOSSARY_VIEW, PERMISSIONS.GLOSSARY_EXPORT,
        PERMISSIONS.COMMENT_ADD
    ],

    [ROLES.GUEST]: [
        PERMISSIONS.PROJECT_VIEW, PERMISSIONS.FILE_VIEW, PERMISSIONS.GLOSSARY_VIEW
    ]
};

// Single global instance — no class to avoid lexical shadowing
const RoleManager = {
    currentUser: null,
    currentRole: ROLES.ADMIN,  // Default: full working access

    setUser(user, role) {
        this.currentUser = user;
        this.currentRole = role || ROLES.ADMIN;
        this.updateUI();
    },

    can(permission) {
        const perms = ROLE_PERMISSIONS[this.currentRole] || [];
        return perms.includes(permission);
    },

    cannot(permission) {
        return !this.can(permission);
    },

    isOwner() { return this.currentRole === ROLES.OWNER; },
    isAdmin() { return this.currentRole === ROLES.ADMIN || this.isOwner(); },

    updateUI() {
        document.querySelectorAll('[data-permission]').forEach(el => {
            el.style.display = this.cannot(el.dataset.permission) ? 'none' : '';
        });
        document.querySelectorAll('button[data-require-permission]').forEach(btn => {
            btn.disabled = this.cannot(btn.dataset.requirePermission);
        });
    }
};
