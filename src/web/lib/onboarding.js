/**
 * Beginner Onboarding System
 * Interactive tooltips, pinpoints, and step-by-step guidance for new users
 */

class OnboardingSystem {
    constructor() {
        this.currentStep = 0;
        this.isActive = false;
        this.completedTours = this.loadCompletedTours();
        this.tours = {
            firstVisit: [
                {
                    target: '.header',
                    title: '👋 Вітаємо у KI Beratung!',
                    content: 'Це професійна система для обробки перекладацьких документів та створення глосаріїв. Давайте познайомимося з інтерфейсом!',
                    position: 'bottom'
                },
                {
                    target: '.nav-item[onclick*="projects"]',
                    title: '📁 Проєкти',
                    content: 'Тут ви створюєте та керуєте вашими проєктами. Проєкт — це окремий робочий простір для документів.',
                    position: 'right'
                },
                {
                    target: '.nav-item[onclick*="files"]',
                    title: '📄 Файли',
                    content: 'Завантажуйте вихідні документи та референсні переклади для аналізу та створення глосаріїв.',
                    position: 'right'
                },
                {
                    target: '.nav-item[onclick*="glossary"]',
                    title: '📚 Глосарій',
                    content: 'Переглядайте, затверджуйте та експортуйте професійні терміни, підготовлені нашими спеціалістами.',
                    position: 'right'
                },
                {
                    target: '.nav-item[onclick*="payments"]',
                    title: '💳 Оплата',
                    content: 'Керуйте рахунками та оплатою за обробку документів. Ми приймаємо картки та інші методи.',
                    position: 'right'
                },
                {
                    target: '.user-menu',
                    title: '👤 Ваш профіль',
                    content: 'Тут знаходяться налаштування акаунту та вихід із системи.',
                    position: 'left'
                }
            ],
            createProject: [
                {
                    target: '.btn-primary[onclick*="createProject"]',
                    title: '🎯 Створіть перший проєкт',
                    content: 'Щоб почати роботу, створіть новий проєкт. Кожен проєкт має окремі файли, глосарій та історію.',
                    position: 'bottom'
                },
                {
                    target: '.modal',
                    title: '📝 Назва проєкту',
                    content: 'Оберіть зрозумілу назву, наприклад "Медичний переклад 2025" або "Юридичні документи".',
                    position: 'center',
                    waitFor: '.modal'
                }
            ],
            uploadFiles: [
                {
                    target: '.upload-zone',
                    title: '📤 Завантаження файлів',
                    content: 'Перетягніть файли сюди або натисніть, щоб обрати. Підтримуються: .txt, .doc, .docx, .pdf',
                    position: 'top'
                },
                {
                    target: '.file-type-selector',
                    title: '🎯 Тип файлу',
                    content: '<b>Вихідні файли</b> — оригінальні документи для перекладу<br><b>Референсні</b> — вже перекладені версії для створення глосарію',
                    position: 'bottom'
                }
            ],
            glossaryView: [
                {
                    target: '#glossary-search',
                    title: '🔍 Пошук термінів',
                    content: 'Швидко знаходьте потрібні терміни за допомогою пошуку. Підтримується пошук по всіх полях.',
                    position: 'bottom'
                },
                {
                    target: '.term-row',
                    title: '📋 Терміни',
                    content: 'Кожен рядок — це професійний термін з перекладом. Ви можете затвердити, відхилити або відредагувати.',
                    position: 'top'
                },
                {
                    target: '.btn[onclick*="exportTSV"]',
                    title: '💾 Експорт',
                    content: 'Завантажте готовий глосарій у форматі TSV для використання в CAT-tools (SDL Trados, MemoQ тощо).',
                    position: 'left'
                }
            ]
        };
    }

    loadCompletedTours() {
        try {
            return JSON.parse(localStorage.getItem('onboarding_completed') || '[]');
        } catch {
            return [];
        }
    }

    saveCompletedTour(tourName) {
        if (!this.completedTours.includes(tourName)) {
            this.completedTours.push(tourName);
            localStorage.setItem('onboarding_completed', JSON.stringify(this.completedTours));
        }
    }

    shouldShowTour(tourName) {
        return !this.completedTours.includes(tourName);
    }

    startTour(tourName) {
        if (!this.tours[tourName]) {
            console.warn(`Tour ${tourName} not found`);
            return;
        }

        this.currentTour = tourName;
        this.currentStep = 0;
        this.isActive = true;
        this.showStep();
    }

    showStep() {
        const tour = this.tours[this.currentTour];
        if (!tour || this.currentStep >= tour.length) {
            this.endTour();
            return;
        }

        const step = tour[this.currentStep];

        // Wait for target element if specified
        if (step.waitFor) {
            const checkElement = setInterval(() => {
                if (document.querySelector(step.waitFor)) {
                    clearInterval(checkElement);
                    this.renderStep(step);
                }
            }, 100);
            setTimeout(() => clearInterval(checkElement), 5000); // Timeout after 5s
        } else {
            this.renderStep(step);
        }
    }

    renderStep(step) {
        // Remove previous tooltip
        const existing = document.querySelector('.onboarding-tooltip');
        if (existing) existing.remove();

        const target = document.querySelector(step.target);
        if (!target) {
            console.warn(`Target ${step.target} not found, skipping step`);
            this.nextStep();
            return;
        }

        // Create spotlight overlay
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.skipTour();
        });

        // Create tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'onboarding-tooltip';
        tooltip.innerHTML = `
            <div class="onboarding-tooltip-header">
                <h3>${step.title}</h3>
                <button class="onboarding-close" onclick="onboardingSystem.skipTour()" title="Закрити">✕</button>
            </div>
            <div class="onboarding-tooltip-content">
                ${step.content}
            </div>
            <div class="onboarding-tooltip-footer">
                <div class="onboarding-progress">
                    ${this.currentStep + 1} / ${this.tours[this.currentTour].length}
                </div>
                <div class="onboarding-buttons">
                    ${this.currentStep > 0 ? '<button class="btn btn-sm btn-secondary" onclick="onboardingSystem.prevStep()">← Назад</button>' : ''}
                    <button class="btn btn-sm btn-primary" onclick="onboardingSystem.nextStep()">
                        ${this.currentStep === this.tours[this.currentTour].length - 1 ? 'Завершити ✓' : 'Далі →'}
                    </button>
                </div>
            </div>
        `;

        // Position tooltip
        document.body.appendChild(overlay);
        document.body.appendChild(tooltip);

        // Highlight target
        target.classList.add('onboarding-highlight');

        // Calculate position
        const rect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        let top, left;
        switch (step.position) {
            case 'top':
                top = rect.top - tooltipRect.height - 20;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'bottom':
                top = rect.bottom + 20;
                left = rect.left + (rect.width - tooltipRect.width) / 2;
                break;
            case 'left':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.left - tooltipRect.width - 20;
                break;
            case 'right':
                top = rect.top + (rect.height - tooltipRect.height) / 2;
                left = rect.right + 20;
                break;
            case 'center':
                top = window.innerHeight / 2 - tooltipRect.height / 2;
                left = window.innerWidth / 2 - tooltipRect.width / 2;
                break;
        }

        // Keep tooltip in viewport
        top = Math.max(20, Math.min(top, window.innerHeight - tooltipRect.height - 20));
        left = Math.max(20, Math.min(left, window.innerWidth - tooltipRect.width - 20));

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;

        // Scroll target into view
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    nextStep() {
        const target = document.querySelector('.onboarding-highlight');
        if (target) target.classList.remove('onboarding-highlight');

        this.currentStep++;
        this.showStep();
    }

    prevStep() {
        const target = document.querySelector('.onboarding-highlight');
        if (target) target.classList.remove('onboarding-highlight');

        this.currentStep--;
        this.showStep();
    }

    skipTour() {
        if (confirm('Ви впевнені, що хочете пропустити інструктаж? Ви завжди можете повернутися до нього пізніше.')) {
            this.endTour();
        }
    }

    endTour() {
        this.isActive = false;
        this.saveCompletedTour(this.currentTour);

        const overlay = document.querySelector('.onboarding-overlay');
        const tooltip = document.querySelector('.onboarding-tooltip');
        const highlight = document.querySelector('.onboarding-highlight');

        if (overlay) overlay.remove();
        if (tooltip) tooltip.remove();
        if (highlight) highlight.classList.remove('onboarding-highlight');

        // Show completion message
        if (this.currentStep >= this.tours[this.currentTour].length) {
            App.toast('✓ Інструктаж завершено! Тепер ви знаєте як користуватися системою.', 'success', 5000);
        }
    }

    resetAll() {
        localStorage.removeItem('onboarding_completed');
        this.completedTours = [];
        App.toast('Інструктаж скинуто. Перезавантажте сторінку для повторного проходження.', 'info');
    }

    /**
     * Show context-sensitive help pinpoint
     */
    showPinpoint(selector, message, autoHide = 5000) {
        const target = document.querySelector(selector);
        if (!target) return;

        const pinpoint = document.createElement('div');
        pinpoint.className = 'pinpoint';
        pinpoint.innerHTML = `
            <div class="pinpoint-pulse"></div>
            <div class="pinpoint-tooltip">${message}</div>
        `;

        target.style.position = 'relative';
        target.appendChild(pinpoint);

        if (autoHide) {
            setTimeout(() => pinpoint.remove(), autoHide);
        }
    }
}

// Global instance
window.onboardingSystem = new OnboardingSystem();

// Auto-start first visit tour
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (onboardingSystem.shouldShowTour('firstVisit')) {
            onboardingSystem.startTour('firstVisit');
        }
    }, 1000);
});

// Add CSS
const onboardingStyle = document.createElement('style');
onboardingStyle.textContent = `
    .onboarding-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 9998;
        backdrop-filter: blur(2px);
        animation: fadeIn 0.3s ease;
    }

    .onboarding-tooltip {
        position: fixed;
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        padding: 0;
        max-width: 400px;
        z-index: 9999;
        animation: slideIn 0.3s ease;
    }

    .onboarding-tooltip-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid #e0e0e0;
    }

    .onboarding-tooltip-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
    }

    .onboarding-close {
        background: none;
        border: none;
        font-size: 24px;
        color: #666;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: all 0.2s;
    }

    .onboarding-close:hover {
        background: #f0f0f0;
        color: #333;
    }

    .onboarding-tooltip-content {
        padding: 20px;
        font-size: 15px;
        line-height: 1.6;
        color: #333;
    }

    .onboarding-tooltip-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-top: 1px solid #e0e0e0;
        background: #f9f9f9;
        border-radius: 0 0 12px 12px;
    }

    .onboarding-progress {
        font-size: 13px;
        color: #666;
        font-weight: 500;
    }

    .onboarding-buttons {
        display: flex;
        gap: 8px;
    }

    .onboarding-highlight {
        position: relative;
        z-index: 9997;
        box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.5), 0 0 32px rgba(37, 99, 235, 0.3) !important;
        border-radius: 8px;
        animation: pulse 2s infinite;
    }

    /* Pinpoint system */
    .pinpoint {
        position: absolute;
        top: -8px;
        right: -8px;
        z-index: 100;
    }

    .pinpoint-pulse {
        width: 16px;
        height: 16px;
        background: #2563eb;
        border-radius: 50%;
        animation: pulsePinpoint 1.5s infinite;
        cursor: pointer;
    }

    .pinpoint-tooltip {
        position: absolute;
        top: 24px;
        right: 0;
        background: #1e293b;
        color: white;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 13px;
        white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        pointer-events: none;
        opacity: 0;
        animation: fadeInDown 0.3s ease 0.5s forwards;
    }

    .pinpoint-tooltip::before {
        content: '';
        position: absolute;
        top: -6px;
        right: 8px;
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 6px solid #1e293b;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes pulse {
        0%, 100% {
            box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.5), 0 0 32px rgba(37, 99, 235, 0.3);
        }
        50% {
            box-shadow: 0 0 0 8px rgba(37, 99, 235, 0.3), 0 0 48px rgba(37, 99, 235, 0.5);
        }
    }

    @keyframes pulsePinpoint {
        0%, 100% {
            transform: scale(1);
            opacity: 1;
        }
        50% {
            transform: scale(1.3);
            opacity: 0.7;
        }
    }

    @keyframes fadeInDown {
        from {
            opacity: 0;
            transform: translateY(-8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @media (prefers-color-scheme: dark) {
        .onboarding-tooltip {
            background: #1e293b;
            color: #f1f5f9;
        }

        .onboarding-tooltip-header {
            border-bottom-color: #334155;
        }

        .onboarding-tooltip-footer {
            background: #0f172a;
            border-top-color: #334155;
        }

        .onboarding-close {
            color: #94a3b8;
        }

        .onboarding-close:hover {
            background: #334155;
            color: #f1f5f9;
        }

        .onboarding-tooltip-content {
            color: #e2e8f0;
        }
    }
`;
document.head.appendChild(onboardingStyle);
