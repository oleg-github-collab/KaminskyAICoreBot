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

    isTelegramMiniApp() {
        return !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    },

    isWebBrowser() {
        return !this.isTelegramMiniApp();
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
        // Priority: session token > TMA initData
        const token = this.getToken();
        if (token) {
            return 'Bearer ' + token;
        }

        if (this.isTelegramMiniApp()) {
            return 'tma ' + (window.Telegram.WebApp.initData || '');
        }

        return '';
    },

    async verifySession() {
        const token = this.getToken();
        if (!token) return false;

        try {
            const response = await fetch('/api/auth/verify', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const data = await response.json();
            return data.valid === true;
        } catch (e) {
            console.error('Session verification failed:', e);
            return false;
        }
    },

    async checkAuthAndRedirect() {
        // If in Telegram Mini App, no redirect needed
        if (this.isTelegramMiniApp()) {
            return true;
        }

        // Check session token from URL (after OAuth callback)
        const urlParams = new URLSearchParams(window.location.search);
        const sessionToken = urlParams.get('session_token');
        if (sessionToken) {
            this.setToken(sessionToken);
            // Remove token from URL
            window.history.replaceState({}, document.title, window.location.pathname);
            return true;
        }

        // Verify existing session
        const hasValidSession = await this.verifySession();
        if (!hasValidSession) {
            // Redirect to login
            window.location.href = '/login';
            return false;
        }

        return true;
    },

    logout() {
        this.clearToken();
        if (this.isWebBrowser()) {
            window.location.href = '/login';
        } else {
            window.location.reload();
        }
    }
};
