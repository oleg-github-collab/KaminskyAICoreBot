const APP_BASE_PATH = (() => {
    const explicit = (typeof window !== 'undefined' && typeof window.APP_BASE_PATH === 'string')
        ? window.APP_BASE_PATH
        : '';
    if (explicit) return explicit.replace(/\/$/, '');

    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
    const marker = '/app';
    const index = path.indexOf(marker);
    return index > 0 ? path.slice(0, index) : '';
})();

const LanguageMeta = (() => {
    const entries = [
        ['German', 'Deutsch', '🇩🇪', ['de', 'de-de', 'german', 'deutsch']],
        ['Ukrainian', 'Українська', '🇺🇦', ['uk', 'ua', 'uk-ua', 'ukrainian', 'українська']],
        ['English', 'English', '🇬🇧', ['en', 'en-gb', 'english']],
        ['English (US)', 'English', '🇺🇸', ['en-us', 'american english', 'english us', 'english (us)']],
        ['Polish', 'Polski', '🇵🇱', ['pl', 'pl-pl', 'polish', 'polski']],
        ['French', 'Français', '🇫🇷', ['fr', 'fr-fr', 'french', 'français', 'francais']],
        ['Spanish', 'Español', '🇪🇸', ['es', 'es-es', 'spanish', 'español', 'espanol']],
        ['Italian', 'Italiano', '🇮🇹', ['it', 'it-it', 'italian', 'italiano']],
        ['Dutch', 'Nederlands', '🇳🇱', ['nl', 'nl-nl', 'dutch', 'nederlands']],
        ['Czech', 'Čeština', '🇨🇿', ['cs', 'cz', 'cs-cz', 'czech', 'čeština', 'cestina']],
        ['Slovak', 'Slovenčina', '🇸🇰', ['sk', 'sk-sk', 'slovak', 'slovenčina', 'slovencina']],
        ['Romanian', 'Română', '🇷🇴', ['ro', 'ro-ro', 'romanian', 'română', 'romana']],
        ['Russian', 'Русский', '🇷🇺', ['ru', 'ru-ru', 'russian', 'русский']],
        ['Portuguese', 'Português', '🇵🇹', ['pt', 'pt-pt', 'portuguese', 'português', 'portugues']],
        ['Portuguese (BR)', 'Português', '🇧🇷', ['pt-br', 'brazilian portuguese', 'portuguese br', 'portuguese (br)']],
        ['Swedish', 'Svenska', '🇸🇪', ['sv', 'sv-se', 'swedish', 'svenska']],
        ['Danish', 'Dansk', '🇩🇰', ['da', 'da-dk', 'danish', 'dansk']],
        ['Finnish', 'Suomi', '🇫🇮', ['fi', 'fi-fi', 'finnish', 'suomi']],
        ['Norwegian', 'Norsk', '🇳🇴', ['no', 'nb', 'nn', 'norwegian', 'norsk']],
        ['Turkish', 'Türkçe', '🇹🇷', ['tr', 'tr-tr', 'turkish', 'türkçe', 'turkce']],
        ['Greek', 'Ελληνικά', '🇬🇷', ['el', 'el-gr', 'greek', 'ελληνικά']],
        ['Bulgarian', 'Български', '🇧🇬', ['bg', 'bg-bg', 'bulgarian', 'български']],
        ['Hungarian', 'Magyar', '🇭🇺', ['hu', 'hu-hu', 'hungarian', 'magyar']],
        ['Estonian', 'Eesti', '🇪🇪', ['et', 'et-ee', 'estonian', 'eesti']],
        ['Latvian', 'Latviešu', '🇱🇻', ['lv', 'lv-lv', 'latvian', 'latviešu', 'latviesu']],
        ['Lithuanian', 'Lietuvių', '🇱🇹', ['lt', 'lt-lt', 'lithuanian', 'lietuvių', 'lietuviu']],
        ['Slovenian', 'Slovenščina', '🇸🇮', ['sl', 'sl-si', 'slovenian', 'slovenščina', 'slovenscina']],
        ['Croatian', 'Hrvatski', '🇭🇷', ['hr', 'hr-hr', 'croatian', 'hrvatski']],
        ['Serbian', 'Српски', '🇷🇸', ['sr', 'sr-rs', 'serbian', 'српски']],
        ['Arabic', 'العربية', '🇸🇦', ['ar', 'ar-sa', 'arabic', 'العربية']],
        ['Hebrew', 'עברית', '🇮🇱', ['he', 'iw', 'he-il', 'hebrew', 'עברית']],
        ['Japanese', '日本語', '🇯🇵', ['ja', 'jp', 'ja-jp', 'japanese', '日本語']],
        ['Korean', '한국어', '🇰🇷', ['ko', 'ko-kr', 'korean', '한국어']],
        ['Chinese', '中文', '🇨🇳', ['zh', 'zh-cn', 'chinese', '中文']],
        ['Simplified Chinese', '简体中文', '🇨🇳', ['zh-hans', 'zh-cn', 'simplified chinese']],
        ['Traditional Chinese', '繁體中文', '🇹🇼', ['zh-hant', 'zh-tw', 'traditional chinese']],
        ['Hindi', 'हिन्दी', '🇮🇳', ['hi', 'hi-in', 'hindi', 'हिन्दी']],
        ['Indonesian', 'Bahasa Indonesia', '🇮🇩', ['id', 'id-id', 'indonesian', 'bahasa indonesia']],
        ['Vietnamese', 'Tiếng Việt', '🇻🇳', ['vi', 'vi-vn', 'vietnamese', 'tiếng việt', 'tieng viet']],
        ['Thai', 'ไทย', '🇹🇭', ['th', 'th-th', 'thai', 'ไทย']],
    ];
    const byKey = new Map();
    const defaults = entries
        .filter(([name]) => !name.includes('(') && name !== 'Simplified Chinese' && name !== 'Traditional Chinese')
        .map(([name]) => name);

    const normalize = (value) => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')
        .replace(/\s+/g, ' ');

    for (const [name, nativeName, flag, aliases] of entries) {
        const info = { name, nativeName, flag };
        byKey.set(normalize(name), info);
        for (const alias of aliases) byKey.set(normalize(alias), info);
    }

    const info = (value) => {
        const raw = String(value || '').trim();
        const found = byKey.get(normalize(raw));
        if (found) return found;
        return {
            name: raw || 'Language',
            nativeName: '',
            flag: '🌐'
        };
    };

    return {
        defaults: () => defaults.slice(),
        info,
        flag: (value) => info(value).flag,
        optionLabel(value) {
            const item = info(value);
            const native = item.nativeName && item.nativeName !== item.name ? ' · ' + item.nativeName : '';
            return `${item.flag} ${item.name}${native}`;
        },
        ariaLabel(value) {
            const item = info(value);
            const native = item.nativeName && item.nativeName !== item.name ? ' / ' + item.nativeName : '';
            return `${item.name}${native}`;
        }
    };
})();

if (typeof window !== 'undefined') {
    window.LanguageMeta = LanguageMeta;
}

const API = {
    base: APP_BASE_PATH + '/api',
    initData() {
        if (typeof Auth !== 'undefined') return Auth.getAuthHeader();
        return (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData)
            ? 'tma ' + window.Telegram.WebApp.initData : '';
    },
    async req(method, path, body, signal) {
        const opts = {
            method,
            headers: { 'Authorization': this.initData() }
        };
        if (signal) opts.signal = signal;
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
    createProject(name, desc, sourceLang, targetLang) {
        return this.req('POST', '/projects', {
            name,
            description: desc,
            source_lang: sourceLang,
            target_lang: targetLang
        });
    },
    getProject(id) { return this.req('GET', '/projects/' + id); },
    updateProject(id, data) { return this.req('PATCH', '/projects/' + id, data); },
    deleteProject(id) { return this.req('DELETE', '/projects/' + id); },

    // Files
    getFiles(pid, cat, signal) {
        const q = cat ? '?category=' + cat : '';
        return this.req('GET', '/projects/' + pid + '/files' + q, undefined, signal);
    },
    getFileContent(pid, fid) { return this.req('GET', '/projects/' + pid + '/files/' + fid + '/content'); },
    async downloadFileBlob(pid, fid) {
        const r = await fetch(this.base + '/projects/' + pid + '/files/' + fid + '/download', {
            method: 'GET',
            headers: { 'Authorization': this.initData() }
        });
        if (!r.ok) throw new Error('Download failed: ' + r.status);
        return r.blob();
    },
    deleteFile(pid, fid) { return this.req('DELETE', '/projects/' + pid + '/files/' + fid); },
    async uploadFiles(pid, files, category, onProgress) {
        const total = files.length;
        const CONCURRENT = Math.min(3, Math.max(1, total));
        const queue = files.map((file, index) => ({ file, index }));
        const results = new Array(total);
        const now = Date.now();
        const states = files.map((file, index) => ({
            index,
            name: file.name || ('file-' + (index + 1)),
            size: file.size || 0,
            status: 'queued',
            phase: 'У черзі',
            loaded: 0,
            total: file.size || 0,
            uploadPercent: 0,
            startedAt: now,
            analyzingStartedAt: 0,
            elapsedMs: 0,
            pulse: 0,
            error: ''
        }));

        const emit = () => {
            if (!onProgress) return;
            const emittedAt = Date.now();
            for (const s of states) {
                if (s.status === 'analyzing' && s.analyzingStartedAt) {
                    s.elapsedMs = emittedAt - s.analyzingStartedAt;
                }
            }
            const completed = states.filter(s => s.status === 'done').length;
            const failed = states.filter(s => s.status === 'error').length;
            const active = states.find(s => ['uploading', 'analyzing'].includes(s.status));
            const analyzingCount = states.filter(s => s.status === 'analyzing').length;
            const uploadingCount = states.filter(s => s.status === 'uploading').length;
            const contribution = states.reduce((sum, s) => {
                if (s.status === 'done' || s.status === 'error') return sum + 1;
                if (s.status === 'analyzing') {
                    const elapsed = Math.max(0, s.elapsedMs || 0);
                    return sum + Math.min(0.98, 0.84 + Math.min(0.14, elapsed / 120000));
                }
                if (s.status === 'uploading') return sum + (0.08 + 0.72 * (s.uploadPercent / 100));
                return sum;
            }, 0);
            onProgress({
                total,
                completed,
                failed,
                analyzingCount,
                uploadingCount,
                activeFileName: active ? active.name : '',
                phaseLabel: active ? active.phase : (completed + failed >= total ? 'Готово' : 'Очікування'),
                aggregatePercent: Math.max(0, Math.min(100, Math.round((contribution / Math.max(1, total)) * 100))),
                timestamp: emittedAt,
                files: states.map(s => ({ ...s }))
            });
        };

        const uploadOne = (file, index) => new Promise(resolve => {
            const state = states[index];
            let analyzingTimer = null;
            const stopAnalyzingTimer = () => {
                if (analyzingTimer) {
                    clearInterval(analyzingTimer);
                    analyzingTimer = null;
                }
            };
            const startAnalyzingTimer = () => {
                stopAnalyzingTimer();
                analyzingTimer = setInterval(() => {
                    if (state.status !== 'analyzing') {
                        stopAnalyzingTimer();
                        return;
                    }
                    state.elapsedMs = Date.now() - state.analyzingStartedAt;
                    state.pulse = (state.pulse || 0) + 1;
                    emit();
                }, 1000);
            };
            const markAnalyzing = () => {
                if (state.status === 'done' || state.status === 'error') return;
                if (state.status !== 'analyzing') {
                    state.analyzingStartedAt = Date.now();
                    state.elapsedMs = 0;
                    state.pulse = 0;
                }
                state.status = 'analyzing';
                state.phase = 'Сервер рахує символи, сторінки та ціну';
                state.loaded = state.total || file.size || state.loaded;
                state.uploadPercent = 100;
                emit();
                startAnalyzingTimer();
            };
            state.status = 'uploading';
            state.phase = 'Завантаження на сервер';
            emit();

            const fd = new FormData();
            fd.append('file', file);
            fd.append('category', category);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', API.base + '/projects/' + pid + '/files');
            xhr.setRequestHeader('Authorization', API.initData());
            xhr.timeout = 20 * 60 * 1000;

            xhr.upload.onprogress = (evt) => {
                if (state.status === 'analyzing') return;
                state.status = 'uploading';
                state.phase = 'Завантаження на сервер';
                if (evt.lengthComputable) {
                    state.loaded = evt.loaded;
                    state.total = evt.total || state.total || file.size || 0;
                    state.uploadPercent = Math.max(0, Math.min(100, Math.round((evt.loaded / Math.max(1, evt.total)) * 100)));
                }
                emit();
            };
            xhr.upload.onload = markAnalyzing;
            xhr.upload.onloadend = () => {
                if (state.status === 'uploading') markAnalyzing();
            };
            xhr.onload = () => {
                stopAnalyzingTimer();
                let json = {};
                try {
                    json = JSON.parse(xhr.responseText || '{}');
                } catch (_) {
                    json = {};
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    state.status = 'done';
                    state.phase = 'Розрахунок готовий';
                    state.loaded = state.total || file.size || state.loaded;
                    state.uploadPercent = 100;
                    results[index] = json;
                } else {
                    const msg = json.error || ('Помилка ' + xhr.status);
                    state.status = 'error';
                    state.phase = 'Помилка';
                    state.error = msg;
                    results[index] = { error: msg, file: state.name };
                }
                emit();
                resolve();
            };
            xhr.onerror = () => {
                stopAnalyzingTimer();
                state.status = 'error';
                state.phase = 'Помилка мережі';
                state.error = 'Помилка мережі під час завантаження';
                results[index] = { error: state.error, file: state.name };
                emit();
                resolve();
            };
            xhr.ontimeout = () => {
                stopAnalyzingTimer();
                state.status = 'error';
                state.phase = 'Timeout';
                state.error = 'Сервер надто довго обробляє файл. Спробуйте ще раз або зверніться до адміністратора.';
                results[index] = { error: state.error, file: state.name };
                emit();
                resolve();
            };
            try {
                xhr.send(fd);
            } catch (e) {
                stopAnalyzingTimer();
                state.status = 'error';
                state.phase = 'Помилка';
                state.error = e.message || 'Не вдалося почати завантаження';
                results[index] = { error: state.error, file: state.name };
                emit();
                resolve();
            }
        });

        async function worker() {
            while (queue.length > 0) {
                const item = queue.shift();
                await uploadOne(item.file, item.index);
            }
        }

        emit();
        await Promise.all(Array(CONCURRENT).fill(0).map(() => worker()));
        emit();
        return results;
    },

    // Pricing
    getTranslationOptions() { return this.req('GET', '/translation/options'); },
    getPricing(pid) { return this.req('GET', '/projects/' + pid + '/pricing'); },
    createInvoice(pid, body) { return this.req('POST', '/projects/' + pid + '/invoices', body); },
    getInvoices(pid) { return this.req('GET', '/projects/' + pid + '/invoices'); },

    // Support
    sendMessage(pid, content) { return this.req('POST', '/projects/' + pid + '/messages', { content }); },

    // Comments / document collaboration
    getComments(pid, type, id) {
        return this.req('GET', '/projects/' + pid + '/comments?type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id));
    },
    createComment(pid, type, id, data) {
        return this.req('POST', '/projects/' + pid + '/comments', {
            ...(data || {}),
            resource_type: type,
            resource_id: id
        });
    },
    deleteComment(pid, commentId) { return this.req('DELETE', '/projects/' + pid + '/comments/' + commentId); },
    acceptSuggestion(pid, commentId) { return this.req('POST', '/projects/' + pid + '/comments/' + commentId + '/accept', {}); },
    rejectSuggestion(pid, commentId) { return this.req('POST', '/projects/' + pid + '/comments/' + commentId + '/reject', {}); },
    getFilePair(pid, fid) { return this.req('GET', '/projects/' + pid + '/files/' + fid + '/pair'); },

    // Team
    getTeam(pid) { return this.req('GET', '/projects/' + pid + '/team'); },
    createInvite(pid) { return this.req('POST', '/projects/' + pid + '/team/invite', {}); },
    removeMember(pid, memberId) { return this.req('DELETE', '/projects/' + pid + '/team/' + memberId); },

    // Audit
    getProjectAudit(pid) { return this.req('GET', '/projects/' + pid + '/audit'); },
    getAdminAudit() { return this.req('GET', '/admin/audit'); },
    getAdminStatus() { return this.req('GET', '/admin/status'); },

    // Auth
    createSession() { return this.req('POST', '/auth/session'); },
};
