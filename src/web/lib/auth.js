const Auth = {
    SESSION_KEY: 'ki_session_token',

    getToken() {
        return localStorage.getItem(this.SESSION_KEY) || '';
    },

    setToken(token) {
        localStorage.setItem(this.SESSION_KEY, token);
    },

    clearToken() {
        localStorage.removeItem(this.SESSION_KEY);
    },

    isDesktop() {
        return !(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    },

    async createSession() {
        try {
            const data = await API.createSession();
            if (data.token) {
                this.setToken(data.token);
                return true;
            }
        } catch (e) {
            console.error('Session creation failed:', e);
        }
        return false;
    },

    getAuthHeader() {
        if (!this.isDesktop()) {
            return 'tma ' + (window.Telegram.WebApp.initData || '');
        }
        const token = this.getToken();
        if (token) return 'Bearer ' + token;
        return '';
    }
};
