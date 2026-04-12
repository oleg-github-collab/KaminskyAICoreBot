const FilesView = {
    category: 'all',

    async render(c, project) {
        if (!project) {
            c.innerHTML = '<div class="empty-state"><div class="empty-state-icon">' + Icons.wrap('projects', 48) + '</div><p class="empty-state-title">\u041e\u0431\u0435\u0440\u0456\u0442\u044c \u043f\u0440\u043e\u0454\u043a\u0442</p><button class="btn btn-primary" style="margin-top:12px" onclick="App.backToProjects()">\u0414\u043e \u043f\u0440\u043e\u0454\u043a\u0442\u0456\u0432</button></div>';
            return;
        }
        c.innerHTML = `
            <div class="section-header">
                <h2>${App.esc(project.name)} \u2014 \u0424\u0430\u0439\u043b\u0438</h2>
            </div>
            <div class="tabs" id="file-tabs">
                <button class="tab active" data-cat="all">\u0412\u0441\u0456</button>
                <button class="tab" data-cat="source">\u0412\u0438\u0445\u0456\u0434\u043d\u0456</button>
                <button class="tab" data-cat="reference">\u0420\u0435\u0444\u0435\u0440\u0435\u043d\u0441</button>
                <button class="tab" data-cat="translated">\u041f\u0435\u0440\u0435\u043a\u043b\u0430\u0434\u0438</button>
            </div>
            <div id="files-stats"></div>
            <div id="files-list"><div class="loading">\u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f...</div></div>`;

        c.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                c.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.category = tab.dataset.cat;
                this.loadFiles(project.id);
            });
        });

        this.loadFiles(project.id);
    },

    async loadFiles(pid) {
        const list = document.getElementById('files-list');
        const statsEl = document.getElementById('files-stats');
        if (!list) return;
        try {
            const cat = this.category === 'all' ? null : this.category;
            const data = await API.getFiles(pid, cat);
            const files = data.files || [];

            if (statsEl && files.length) {
                const totalChars = files.reduce((s, f) => s + (f.char_count || 0), 0);
                const totalPages = files.reduce((s, f) => s + (f.page_count || 0), 0);
                const totalPrice = files.reduce((s, f) => s + (f.estimated_price_cents || 0), 0);
                statsEl.innerHTML = `
                    <div class="stats" style="margin-bottom:12px">
                        <div class="stat"><div class="stat-value">${files.length}</div><div class="stat-label">\u0424\u0430\u0439\u043b\u0456\u0432</div></div>
                        <div class="stat"><div class="stat-value">${totalChars.toLocaleString()}</div><div class="stat-label">\u0421\u0438\u043c\u0432\u043e\u043b\u0456\u0432</div></div>
                        <div class="stat"><div class="stat-value">${totalPages}</div><div class="stat-label">\u0421\u0442\u043e\u0440\u0456\u043d\u043e\u043a</div></div>
                        <div class="stat"><div class="stat-value">\u20ac${App.fmtEuro(totalPrice)}</div><div class="stat-label">\u0412\u0430\u0440\u0442\u0456\u0441\u0442\u044c</div></div>
                    </div>`;
            } else if (statsEl) {
                statsEl.innerHTML = '';
            }

            if (!files.length) {
                const isFiltered = this.category !== 'all';
                list.innerHTML = `<div class="empty-state" style="padding:32px">
                    <div class="empty-state-icon">${Icons.wrap('files', 48)}</div>
                    <p class="empty-state-title">${isFiltered ? '\u041d\u0435\u043c\u0430\u0454 \u0444\u0430\u0439\u043b\u0456\u0432 \u0443 \u0446\u0456\u0439 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0456\u0457' : '\u041d\u0435\u043c\u0430\u0454 \u0444\u0430\u0439\u043b\u0456\u0432'}</p>
                    <p class="empty-state-text">${isFiltered ? '\u0421\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0456\u043d\u0448\u0443 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0456\u044e' : '\u041d\u0430\u0442\u0438\u0441\u043d\u0456\u0442\u044c + \u0449\u043e\u0431 \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438 \u0444\u0430\u0439\u043b\u0438'}</p>
                    <button class="btn btn-primary" style="margin-top:12px" onclick="UploadWizard.open()">${Icons.wrap('plus', 16)} \u0417\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0438\u0442\u0438</button>
                </div>`;
                return;
            }

            list.innerHTML = files.map(f => {
                const safeName = App.esc(f.original_name).replace(/'/g, "\\'");
                const catLabel = this.categoryLabel(f.category);
                return `
                <div class="file-item">
                    <div class="file-icon">${this.icon(f.category)}</div>
                    <div class="file-info">
                        <div class="file-name">${App.esc(f.original_name)}</div>
                        <div class="file-meta">
                            ${catLabel} \u00b7 ${App.fmtSize(f.file_size)}
                            ${f.char_count ? ' \u00b7 ' + f.char_count.toLocaleString() + ' \u0441\u0438\u043c.' : ''}
                            ${f.page_count ? ' \u00b7 ' + f.page_count + ' \u0441\u0442\u043e\u0440.' : ''}
                            ${f.estimated_price_cents ? ' \u00b7 \u20ac' + App.fmtEuro(f.estimated_price_cents) : ''}
                        </div>
                        ${f.review_status && f.review_status !== 'pending' ? '<div style="margin-top:4px"><span class="review-badge ' + this.reviewClass(f.review_status) + '">' + this.reviewLabel(f.review_status) + '</span></div>' : ''}
                    </div>
                    <div class="file-actions">
                        <button class="btn btn-icon btn-secondary"
                                onclick="FileViewer.show(${pid}, ${f.id}, '${safeName}')"
                                data-tooltip="\u041f\u0435\u0440\u0435\u0433\u043b\u044f\u043d\u0443\u0442\u0438">
                            ${Icons.wrap('eye', 16)}
                        </button>
                        ${f.category === 'translated' ? `
                        <button class="btn btn-icon btn-secondary"
                                onclick="FileViewer.showPair(${pid}, ${f.id}, '${safeName}')"
                                data-tooltip="\u041f\u043e\u0440\u0456\u0432\u043d\u044f\u0442\u0438 \u0437 \u043e\u0440\u0438\u0433\u0456\u043d\u0430\u043b\u043e\u043c">
                            ${Icons.wrap('compare', 16)}
                        </button>` : ''}
                        <button class="btn btn-icon btn-secondary"
                                onclick="FilesView.downloadFile(${pid},${f.id},'${safeName}')"
                                data-tooltip="\u0421\u043a\u0430\u0447\u0430\u0442\u0438">
                            ${Icons.wrap('download', 16)}
                        </button>
                        <button class="btn btn-icon"
                                style="color:var(--red);background:var(--red-bg)"
                                onclick="FilesView.deleteFile(${pid},${f.id},'${safeName}')"
                                data-tooltip="\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438">
                            ${Icons.wrap('trash', 16)}
                        </button>
                    </div>
                </div>`;
            }).join('');

            // Stagger animation
            if (typeof Transitions !== 'undefined') {
                Transitions.staggerIn(list, '.file-item', 40);
            }
        } catch (e) {
            list.innerHTML = '<p style="color:var(--text-muted);padding:12px">\u041f\u043e\u043c\u0438\u043b\u043a\u0430: ' + App.esc(e.message) + '</p>';
        }
    },

    async deleteFile(pid, fid, name) {
        App.confirm('\u0412\u0438\u0434\u0430\u043b\u0438\u0442\u0438 \u0444\u0430\u0439\u043b \u00ab' + name + '\u00bb?', async (ok) => {
            if (!ok) return;
            try {
                await API.deleteFile(pid, fid);
                this.loadFiles(pid);
            } catch (e) { App.alert(e.message); }
        });
    },

    async downloadFile(pid, fid, name) {
        try {
            const blob = await API.downloadFileBlob(pid, fid);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name; a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            App.toast('\u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u0437\u0430\u0432\u0430\u043d\u0442\u0430\u0436\u0435\u043d\u043d\u044f: ' + e.message, 'error');
        }
    },

    reviewClass(status) {
        const map = {
            'admin_review': 'review', 'admin_approved': 'approved', 'admin_edited': 'edited',
            'client_review': 'review', 'client_approved': 'approved', 'revision_requested': 'revision',
        };
        return map[status] || 'pending';
    },

    reviewLabel(status) {
        const map = {
            'pending': Icons.wrap('clock', 14) + ' \u041e\u0447\u0456\u043a\u0443\u0454',
            'admin_review': Icons.wrap('search', 14) + ' \u041d\u0430 \u043f\u0435\u0440\u0435\u0432\u0456\u0440\u0446\u0456',
            'admin_approved': Icons.wrap('check', 14) + ' \u0421\u0445\u0432\u0430\u043b\u0435\u043d\u043e',
            'admin_edited': Icons.wrap('edit', 14) + ' \u0412\u0456\u0434\u0440\u0435\u0434\u0430\u0433\u043e\u0432\u0430\u043d\u043e',
            'client_review': Icons.wrap('send', 14) + ' \u041e\u0447\u0456\u043a\u0443\u0454 \u043f\u0435\u0440\u0435\u0432\u0456\u0440\u043a\u0438',
            'client_approved': Icons.wrap('check', 14) + ' \u0417\u0430\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043e',
            'revision_requested': Icons.wrap('forward', 14) + ' \u041f\u043e\u0442\u0440\u0435\u0431\u0443\u0454 \u043f\u0440\u0430\u0432\u043e\u043a',
        };
        return map[status] || status;
    },

    icon(cat) {
        const map = { source: 'files', reference: 'glossary', glossary: 'glossary', translated: 'check' };
        return Icons.wrap(map[cat] || 'files', 20);
    },

    categoryLabel(cat) {
        return { source: '\u0412\u0438\u0445\u0456\u0434\u043d\u0438\u0439', reference: '\u0420\u0435\u0444\u0435\u0440\u0435\u043d\u0441', glossary: '\u0413\u043b\u043e\u0441\u0430\u0440\u0456\u0439', translated: '\u041f\u0435\u0440\u0435\u043a\u043b\u0430\u0434' }[cat] || cat;
    }
};
