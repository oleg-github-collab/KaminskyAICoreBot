const API = {
    base: '/api',
    initData() {
        if (typeof Auth !== 'undefined') return Auth.getAuthHeader();
        return (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData)
            ? 'tma ' + window.Telegram.WebApp.initData : '';
    },
    async req(method, path, body) {
        const opts = {
            method,
            headers: { 'Authorization': this.initData() }
        };
        if (body && !(body instanceof FormData)) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        } else if (body instanceof FormData) {
            opts.body = body;
        }
        const r = await fetch(this.base + path, opts);
        if (!r.ok) {
            const e = await r.json().catch(() => ({ error: 'Помилка ' + r.status }));
            throw new Error(e.error || 'Помилка ' + r.status);
        }
        return r.json();
    },

    getProjects() { return this.req('GET', '/projects'); },
    createProject(name, desc) { return this.req('POST', '/projects', { name, description: desc }); },
    getProject(id) { return this.req('GET', '/projects/' + id); },
    deleteProject(id) { return this.req('DELETE', '/projects/' + id); },

    getFiles(pid, cat) {
        const q = cat ? '?category=' + cat : '';
        return this.req('GET', '/projects/' + pid + '/files' + q);
    },
    deleteFile(pid, fid) { return this.req('DELETE', '/projects/' + pid + '/files/' + fid); },
    async uploadFiles(pid, files, category, onProgress) {
        const CONCURRENT = 5;
        const queue = [...files];
        let done = 0;
        const total = files.length;
        const results = [];

        async function worker() {
            while (queue.length > 0) {
                const file = queue.shift();
                const fd = new FormData();
                fd.append('file', file);
                fd.append('category', category);
                try {
                    const r = await fetch('/api/projects/' + pid + '/files', {
                        method: 'POST',
                        headers: { 'Authorization': API.initData() },
                        body: fd
                    });
                    results.push(await r.json());
                } catch (e) {
                    results.push({ error: e.message });
                }
                done++;
                if (onProgress) onProgress(done, total);
            }
        }
        await Promise.all(Array(Math.min(CONCURRENT, total)).fill(0).map(() => worker()));
        return results;
    },

    getTeam(pid) { return this.req('GET', '/projects/' + pid + '/team'); },
    createInvite(pid) { return this.req('POST', '/projects/' + pid + '/team/invite'); },
    removeMember(pid, mid) { return this.req('DELETE', '/projects/' + pid + '/team/' + mid); },

    getGlossary(pid) { return this.req('GET', '/projects/' + pid + '/glossary'); },
    approveTerms(pid, termIds) { return this.req('POST', '/projects/' + pid + '/glossary/approve', { term_ids: termIds }); },
    rejectTerms(pid, termIds) { return this.req('POST', '/projects/' + pid + '/glossary/reject', { term_ids: termIds }); },
    exportGlossary(pid, format) { return this.req('GET', '/projects/' + pid + '/glossary/export?format=' + (format || 'tsv')); },
    syncGlossary(pid) { return this.req('POST', '/projects/' + pid + '/glossary/sync'); },

    getGlossaryVersions(pid) { return this.req('GET', '/projects/' + pid + '/glossary/versions'); },
    getGlossaryVersion(pid, vid) { return this.req('GET', '/projects/' + pid + '/glossary/versions/' + vid); },
    getGlossaryDiff(pid, a, b) { return this.req('GET', '/projects/' + pid + '/glossary/diff?a=' + a + '&b=' + b); },

    getMessages(pid) { return this.req('GET', '/projects/' + pid + '/messages'); },
    sendMessage(pid, content) { return this.req('POST', '/projects/' + pid + '/messages', { content }); },

    getPricing(pid) { return this.req('GET', '/projects/' + pid + '/pricing'); },
    createInvoice(pid) { return this.req('POST', '/projects/' + pid + '/invoices'); },
    getInvoices(pid) { return this.req('GET', '/projects/' + pid + '/invoices'); },

    getSettings(pid) { return this.req('GET', '/projects/' + pid + '/settings'); },
    updateSettings(pid, settings) { return this.req('POST', '/projects/' + pid + '/settings', settings); },

    getWorkflow(pid) { return this.req('GET', '/projects/' + pid + '/workflow'); },

    createSession() { return this.req('POST', '/auth/session'); },
};
