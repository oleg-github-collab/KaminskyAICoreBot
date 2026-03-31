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

    // Projects
    getProjects() { return this.req('GET', '/projects'); },
    createProject(name, desc) { return this.req('POST', '/projects', { name, description: desc }); },
    getProject(id) { return this.req('GET', '/projects/' + id); },
    updateProject(id, data) { return this.req('PATCH', '/projects/' + id, data); },
    deleteProject(id) { return this.req('DELETE', '/projects/' + id); },

    // Files
    getFiles(pid, cat) {
        const q = cat ? '?category=' + cat : '';
        return this.req('GET', '/projects/' + pid + '/files' + q);
    },
    getFileContent(pid, fid) { return this.req('GET', '/projects/' + pid + '/files/' + fid + '/content'); },
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

    // Team
    getTeam(pid) { return this.req('GET', '/projects/' + pid + '/team'); },
    createInvite(pid) { return this.req('POST', '/projects/' + pid + '/team/invite'); },
    removeMember(pid, mid) { return this.req('DELETE', '/projects/' + pid + '/team/' + mid); },

    // Glossary
    getGlossary(pid) { return this.req('GET', '/projects/' + pid + '/glossary'); },
    approveTerms(pid, termIds) { return this.req('POST', '/projects/' + pid + '/glossary/approve', { term_ids: termIds }); },
    rejectTerms(pid, termIds) { return this.req('POST', '/projects/' + pid + '/glossary/reject', { term_ids: termIds }); },
    updateTerm(pid, termId, data) { return this.req('POST', '/projects/' + pid + '/glossary/terms/' + termId, data); },
    exportGlossary(pid, format) { return this.req('GET', '/projects/' + pid + '/glossary/export?format=' + (format || 'tsv')); },
    syncGlossary(pid) { return this.req('POST', '/projects/' + pid + '/glossary/sync'); },

    // Glossary versions
    getGlossaryVersions(pid) { return this.req('GET', '/projects/' + pid + '/glossary/versions'); },
    getGlossaryVersion(pid, vid) { return this.req('GET', '/projects/' + pid + '/glossary/versions/' + vid); },
    getGlossaryDiff(pid, a, b) { return this.req('GET', '/projects/' + pid + '/glossary/diff?a=' + a + '&b=' + b); },

    // Messages
    getMessages(pid) { return this.req('GET', '/projects/' + pid + '/messages'); },
    sendMessage(pid, content) { return this.req('POST', '/projects/' + pid + '/messages', { content }); },

    // WebSocket stream helper (replaces SSE)
    connectMessageStream(pid, onMessage, onError) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const auth = encodeURIComponent(this.initData());
        const wsUrl = `${protocol}//${window.location.host}/api/projects/${pid}/ws?auth=${auth}`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[WebSocket] Connected to project', pid);
            // Send ping every 30s to keep connection alive
            ws._pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'pong') {
                    // Ignore ping/pong
                    return;
                }
                if (onMessage) onMessage(data);
            } catch (e) {
                console.error('[WebSocket] Parse error:', e);
            }
        };

        ws.onerror = (err) => {
            console.error('[WebSocket] Error:', err);
            if (onError) onError();
        };

        ws.onclose = () => {
            console.log('[WebSocket] Disconnected from project', pid);
            clearInterval(ws._pingInterval);
            // Auto-reconnect after 3 seconds
            setTimeout(() => {
                console.log('[WebSocket] Attempting reconnect...');
                this.connectMessageStream(pid, onMessage, onError);
            }, 3000);
        };

        // Helper method to send typing indicator
        ws.sendTyping = function() {
            if (this.readyState === WebSocket.OPEN) {
                this.send(JSON.stringify({ type: 'typing' }));
            }
        };

        return ws;
    },

    // Pricing
    getPricing(pid) { return this.req('GET', '/projects/' + pid + '/pricing'); },
    createInvoice(pid) { return this.req('POST', '/projects/' + pid + '/invoices'); },
    getInvoices(pid) { return this.req('GET', '/projects/' + pid + '/invoices'); },

    // Settings
    getSettings(pid) { return this.req('GET', '/projects/' + pid + '/settings'); },
    updateSettings(pid, settings) { return this.req('POST', '/projects/' + pid + '/settings', settings); },

    // Workflow
    getWorkflow(pid) { return this.req('GET', '/projects/' + pid + '/workflow'); },

    // Auth
    createSession() { return this.req('POST', '/auth/session'); },

    // Search (FTS5)
    searchGlossary(pid, query, filters) {
        const params = new URLSearchParams({ q: query });
        if (filters) {
            if (filters.approved !== undefined) params.append('approved', filters.approved);
            if (filters.pending !== undefined) params.append('pending', filters.pending);
            if (filters.source !== undefined) params.append('source', filters.source);
            if (filters.target !== undefined) params.append('target', filters.target);
            if (filters.domain !== undefined) params.append('domain', filters.domain);
        }
        return this.req('GET', '/projects/' + pid + '/glossary/search?' + params.toString());
    },

    // Comments
    getComments(pid, resourceType, resourceId) {
        return this.req('GET', '/projects/' + pid + '/comments?type=' + resourceType + '&id=' + resourceId);
    },
    createComment(pid, resourceType, resourceId, data) {
        return this.req('POST', '/projects/' + pid + '/comments', { ...data, resource_type: resourceType, resource_id: resourceId });
    },
    deleteComment(pid, commentId) {
        return this.req('DELETE', '/projects/' + pid + '/comments/' + commentId);
    },

    // Git versioning
    getBranches(pid) { return this.req('GET', '/projects/' + pid + '/branches'); },
    createBranch(pid, name) { return this.req('POST', '/projects/' + pid + '/branches', { name }); },
    switchBranch(pid, branchId) { return this.req('POST', '/projects/' + pid + '/branches/' + branchId + '/switch'); },
    getCommits(pid, branchId) { return this.req('GET', '/projects/' + pid + '/branches/' + branchId + '/commits'); },
    getCommitPreview(pid) { return this.req('GET', '/projects/' + pid + '/commit-preview'); },
    createCommit(pid, message) { return this.req('POST', '/projects/' + pid + '/commits', { message }); },

    // Project CRUD
    updateProject(pid, data) { return this.req('PUT', '/projects/' + pid, data); },
};
