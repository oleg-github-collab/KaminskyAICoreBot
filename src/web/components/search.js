const SearchView = {
    currentProject: null,
    searchQuery: '',
    searchResults: [],
    isSearching: false,

    init(projectId) {
        this.currentProject = projectId;
        this.attachGlobalSearchHandler();
    },

    attachGlobalSearchHandler() {
        // Global search shortcut (Ctrl+Shift+F)
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'f') {
                e.preventDefault();
                this.showSearchModal();
            }
        });
    },

    showSearchModal() {
        if (!this.currentProject) {
            App.toast('Оберіть проєкт для пошуку', 'warning');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal search-modal" style="max-width:800px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="margin:0">🔍 Пошук по глосарію</h3>
                    <button class="btn btn-sm btn-secondary" onclick="this.closest('.modal-overlay').remove()">✕</button>
                </div>

                <div class="search-input-container" style="position:relative;margin-bottom:20px">
                    <input type="text" id="search-modal-input" class="input"
                        placeholder="Пошук термінів, перекладів, доменів..."
                        style="width:100%;padding-right:100px"
                        autofocus>
                    <div style="position:absolute;right:8px;top:8px;display:flex;gap:8px">
                        <button class="btn btn-sm btn-primary" onclick="SearchView.performSearch()">Шукати</button>
                    </div>
                </div>

                <div id="search-filters" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
                    <label class="filter-chip">
                        <input type="checkbox" id="filter-approved" checked>
                        <span>✓ Затверджені</span>
                    </label>
                    <label class="filter-chip">
                        <input type="checkbox" id="filter-pending" checked>
                        <span>⏳ На перевірці</span>
                    </label>
                    <label class="filter-chip">
                        <input type="checkbox" id="filter-source" checked>
                        <span>📝 Оригінал</span>
                    </label>
                    <label class="filter-chip">
                        <input type="checkbox" id="filter-target" checked>
                        <span>🎯 Переклад</span>
                    </label>
                    <label class="filter-chip">
                        <input type="checkbox" id="filter-domain" checked>
                        <span>🏷️ Домен</span>
                    </label>
                </div>

                <div id="search-results-container">
                    <div class="empty" style="padding:40px;text-align:center;color:var(--hint)">
                        <div style="font-size:48px;margin-bottom:12px">🔍</div>
                        <p>Введіть запит для пошуку</p>
                        <p style="font-size:13px;margin-top:8px">Пошук використовує FTS5 для миттєвих результатів</p>
                    </div>
                </div>

                <div id="search-stats" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;color:var(--hint);display:none"></div>
            </div>`;

        document.body.appendChild(modal);

        // Close on outside click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // Search on Enter
        const input = document.getElementById('search-modal-input');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.performSearch();
            }
        });

        input.focus();
    },

    async performSearch() {
        const input = document.getElementById('search-modal-input');
        const query = input.value.trim();

        if (!query || query.length < 2) {
            App.toast('Введіть мінімум 2 символи', 'warning');
            return;
        }

        this.searchQuery = query;
        this.isSearching = true;

        const resultsContainer = document.getElementById('search-results-container');
        resultsContainer.innerHTML = '<div class="loading">Пошук...</div>';

        const startTime = Date.now();

        try {
            // Get filters
            const includeApproved = document.getElementById('filter-approved').checked;
            const includePending = document.getElementById('filter-pending').checked;
            const searchSource = document.getElementById('filter-source').checked;
            const searchTarget = document.getElementById('filter-target').checked;
            const searchDomain = document.getElementById('filter-domain').checked;

            const data = await API.searchGlossary(this.currentProject, query, {
                approved: includeApproved,
                pending: includePending,
                source: searchSource,
                target: searchTarget,
                domain: searchDomain
            });

            const duration = Date.now() - startTime;
            this.searchResults = data.results || [];

            this.renderResults(duration);
        } catch (e) {
            resultsContainer.innerHTML = `<div class="empty" style="padding:20px;color:var(--error)">
                <p>❌ Помилка пошуку: ${App.esc(e.message)}</p>
            </div>`;
        } finally {
            this.isSearching = false;
        }
    },

    renderResults(duration) {
        const container = document.getElementById('search-results-container');
        const statsEl = document.getElementById('search-stats');

        if (this.searchResults.length === 0) {
            container.innerHTML = `
                <div class="empty" style="padding:40px;text-align:center">
                    <div style="font-size:48px;margin-bottom:12px">🔍</div>
                    <p>Нічого не знайдено</p>
                    <p style="font-size:13px;color:var(--hint);margin-top:8px">Спробуйте інший запит або змініть фільтри</p>
                </div>`;
            statsEl.style.display = 'none';
            return;
        }

        const html = this.searchResults.map(r => `
            <div class="search-result-item" onclick="SearchView.selectResult(${r.id})">
                <div class="search-result-header">
                    <span class="status-badge ${r.is_approved ? 'status-approved' : 'status-pending'}">
                        ${r.is_approved ? '✓' : '⏳'}
                    </span>
                    ${r.domain ? `<span class="domain-tag" style="margin-left:8px">${App.esc(r.domain)}</span>` : ''}
                </div>
                <div class="search-result-content">
                    <div class="search-result-source">
                        <span style="font-size:11px;color:var(--hint);text-transform:uppercase">Оригінал:</span>
                        <div style="font-weight:500">${this.highlightMatch(r.source_term_highlight || r.source_term)}</div>
                    </div>
                    <div style="margin:0 12px;color:var(--hint)">→</div>
                    <div class="search-result-target">
                        <span style="font-size:11px;color:var(--hint);text-transform:uppercase">Переклад:</span>
                        <div style="font-weight:500">${this.highlightMatch(r.target_term_highlight || r.target_term)}</div>
                    </div>
                </div>
                <div class="search-result-meta">
                    <span>Впевненість: ${Math.round((r.confidence || 0) * 100)}%</span>
                    <span>Rank: ${r.rank ? r.rank.toFixed(2) : 'N/A'}</span>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;

        statsEl.innerHTML = `Знайдено ${this.searchResults.length} результат${this.searchResults.length === 1 ? '' : 'ів'} за ${duration}мс`;
        statsEl.style.display = 'block';
    },

    highlightMatch(text) {
        // Already contains <mark> tags from backend
        return text;
    },

    selectResult(termId) {
        // Close search modal
        document.querySelector('.search-modal')?.closest('.modal-overlay')?.remove();

        // Navigate to glossary and highlight term
        App.navigate('glossary');

        setTimeout(() => {
            const termRow = document.querySelector(`.term-row[data-id="${termId}"]`);
            if (termRow) {
                termRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                termRow.classList.add('highlight');
                setTimeout(() => termRow.classList.remove('highlight'), 2000);
            }
        }, 100);
    }
};
