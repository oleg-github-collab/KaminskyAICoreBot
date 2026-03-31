/**
 * File Statistics & Analytics
 * Advanced file analysis with charts and insights
 */

class FileStats {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Analyze a file and return detailed statistics
     */
    async analyze(file) {
        const cacheKey = `${file.id}_${file.updated_at || file.created_at}`;

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const stats = {
            id: file.id,
            name: file.filename,
            size: file.size,
            type: file.mime_type,
            chars: file.char_count || 0,
            words: file.word_count || 0,
            lines: file.line_count || 0,
            pages: file.page_count || 0,
            created: file.created_at,
            updated: file.updated_at
        };

        // Estimated reading time (250 words per minute)
        stats.readingTime = Math.ceil((stats.words || stats.chars / 6) / 250);

        // Estimated translation time (250-350 words per hour for professional)
        stats.translationTime = Math.ceil((stats.words || stats.chars / 6) / 300);

        // Cost estimates
        stats.estimatedCost = this.estimateCost(file);

        // Complexity score (based on various factors)
        stats.complexity = this.calculateComplexity(stats);

        this.cache.set(cacheKey, stats);
        return stats;
    }

    /**
     * Calculate complexity score (0-100)
     */
    calculateComplexity(stats) {
        let score = 0;

        // File size contribution (0-30 points)
        if (stats.size > 1048576) score += 30; // >1MB
        else if (stats.size > 524288) score += 20; // >512KB
        else if (stats.size > 102400) score += 10; // >100KB

        // Length contribution (0-30 points)
        if (stats.words > 10000) score += 30;
        else if (stats.words > 5000) score += 20;
        else if (stats.words > 1000) score += 10;

        // File type contribution (0-40 points)
        const complexTypes = ['application/pdf', 'application/vnd.openxmlformats'];
        if (complexTypes.some(t => stats.type.includes(t))) {
            score += 40;
        } else if (stats.type.includes('text/')) {
            score += 10;
        }

        return Math.min(score, 100);
    }

    /**
     * Estimate processing cost
     */
    estimateCost(file) {
        const charCount = file.char_count || 0;
        const pageCount = file.page_count || 0;

        // Text files: €0.58 per 1800 chars
        // PDF/binary: €0.89 per page

        let cost = 0;

        if (file.mime_type.includes('text/') || file.mime_type.includes('word')) {
            cost = (charCount / 1800) * 0.58;
        } else {
            cost = pageCount * 0.89;
        }

        return {
            amount: cost,
            currency: 'EUR',
            formatted: `€${cost.toFixed(2)}`
        };
    }

    /**
     * Render statistics panel
     */
    render(file) {
        const stats = this.analyze(file);

        return `
            <div class="file-stats-panel">
                <div class="stats-header">
                    <h4>📊 Статистика файлу</h4>
                    <button class="btn btn-sm btn-icon" onclick="this.closest('.file-stats-panel').remove()" title="Закрити">
                        ✕
                    </button>
                </div>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">📝</div>
                        <div class="stat-value">${this.formatNumber(stats.chars)}</div>
                        <div class="stat-label">Символів</div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon">📄</div>
                        <div class="stat-value">${this.formatNumber(stats.words)}</div>
                        <div class="stat-label">Слів</div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon">📑</div>
                        <div class="stat-value">${stats.pages || Math.ceil(stats.chars / 1800)}</div>
                        <div class="stat-label">Сторінок</div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon">⏱️</div>
                        <div class="stat-value">${stats.translationTime}h</div>
                        <div class="stat-label">Час перекладу</div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon">💰</div>
                        <div class="stat-value">${stats.estimatedCost.formatted}</div>
                        <div class="stat-label">Оцінка вартості</div>
                    </div>

                    <div class="stat-card">
                        <div class="stat-icon">📈</div>
                        <div class="stat-value">${stats.complexity}%</div>
                        <div class="stat-label">Складність</div>
                    </div>
                </div>

                <div class="stats-details">
                    <h5>Деталі</h5>
                    <table class="stats-table">
                        <tr>
                            <td>Назва файлу:</td>
                            <td><strong>${App.esc(stats.name)}</strong></td>
                        </tr>
                        <tr>
                            <td>Розмір:</td>
                            <td>${App.fmtSize(stats.size)}</td>
                        </tr>
                        <tr>
                            <td>Тип:</td>
                            <td>${App.esc(stats.type)}</td>
                        </tr>
                        <tr>
                            <td>Час читання:</td>
                            <td>~${stats.readingTime} хв</td>
                        </tr>
                        <tr>
                            <td>Створено:</td>
                            <td>${App.fmtDate(stats.created)}</td>
                        </tr>
                        ${stats.updated ? `
                        <tr>
                            <td>Оновлено:</td>
                            <td>${App.fmtDate(stats.updated)}</td>
                        </tr>
                        ` : ''}
                    </table>
                </div>

                <div class="stats-chart">
                    ${this.renderComplexityChart(stats)}
                </div>

                <div class="stats-actions">
                    <button class="btn btn-sm btn-primary" onclick="FileStats.exportStats(${file.id})">
                        📥 Експорт статистики
                    </button>
                    <button class="btn btn-sm" onclick="FileStats.compare(${file.id})">
                        ⚖️ Порівняти з іншим
                    </button>
                </div>
            </div>
        `;
    }

    renderComplexityChart(stats) {
        const factors = [
            { label: 'Розмір', value: Math.min((stats.size / 1048576) * 100, 100) },
            { label: 'Довжина', value: Math.min((stats.words / 10000) * 100, 100) },
            { label: 'Тип файлу', value: stats.type.includes('pdf') ? 80 : 30 }
        ];

        return `
            <div class="complexity-breakdown">
                <h5>Аналіз складності</h5>
                ${factors.map(f => `
                    <div class="complexity-factor">
                        <div class="factor-label">${f.label}</div>
                        <div class="factor-bar-container">
                            <div class="factor-bar" style="width: ${f.value}%"></div>
                        </div>
                        <div class="factor-value">${Math.round(f.value)}%</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    formatNumber(num) {
        if (!num) return '0';
        return num.toLocaleString('uk-UA');
    }

    /**
     * Show stats in a modal
     */
    async showModal(file) {
        const stats = await this.analyze(file);
        const html = this.render(file);

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal modal-stats">${html}</div>`;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    /**
     * Export statistics to JSON
     */
    static async exportStats(fileId) {
        const file = await API.getFile(fileId);
        const stats = await window.FileStatsInstance.analyze(file);

        const json = JSON.stringify(stats, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `stats_${file.filename}.json`;
        a.click();

        URL.revokeObjectURL(url);
        App.toast('✓ Статистику експортовано', 'success');
    }

    /**
     * Compare two files
     */
    static compare(fileId) {
        // TODO: Implement file comparison
        App.toast('Функція порівняння в розробці', 'info');
    }
}

// Global instance
window.FileStatsInstance = new FileStats();

// Add CSS
const style = document.createElement('style');
style.textContent = `
    .file-stats-panel {
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 20px;
        margin: 16px 0;
    }

    .stats-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
    }

    .stats-header h4 {
        margin: 0;
        font-size: 18px;
    }

    .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 24px;
    }

    .stat-card {
        background: var(--bg-secondary);
        padding: 16px;
        border-radius: 8px;
        text-align: center;
        transition: transform 0.2s, box-shadow 0.2s;
    }

    .stat-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    .stat-icon {
        font-size: 24px;
        margin-bottom: 8px;
    }

    .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: var(--primary);
        margin-bottom: 4px;
    }

    .stat-label {
        font-size: 12px;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .stats-details {
        margin-bottom: 24px;
    }

    .stats-details h5 {
        font-size: 14px;
        margin-bottom: 12px;
        color: var(--text-secondary);
    }

    .stats-table {
        width: 100%;
        font-size: 14px;
    }

    .stats-table td {
        padding: 8px 0;
        border-bottom: 1px solid var(--border);
    }

    .stats-table td:first-child {
        color: var(--text-secondary);
        width: 40%;
    }

    .stats-chart {
        margin-bottom: 24px;
    }

    .complexity-breakdown h5 {
        font-size: 14px;
        margin-bottom: 12px;
        color: var(--text-secondary);
    }

    .complexity-factor {
        display: grid;
        grid-template-columns: 100px 1fr 50px;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }

    .factor-label {
        font-size: 13px;
        color: var(--text-secondary);
    }

    .factor-bar-container {
        background: var(--bg-secondary);
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
    }

    .factor-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--success), var(--warning));
        transition: width 0.3s ease;
    }

    .factor-value {
        font-size: 13px;
        font-weight: 600;
        text-align: right;
    }

    .stats-actions {
        display: flex;
        gap: 8px;
        justify-content: center;
    }

    .modal-stats {
        max-width: 700px;
        max-height: 90vh;
        overflow-y: auto;
    }
`;
document.head.appendChild(style);
