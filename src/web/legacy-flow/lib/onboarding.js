/**
 * Onboarding & Help System
 * Interactive tooltips, full workflow guide, persistent help button
 * Adapted for sidebar (desktop) + bottom-nav (mobile) layout
 */

class OnboardingSystem {
    constructor() {
        this.currentStep = 0;
        this.isActive = false;
        this.completedTours = this.loadCompletedTours();
        this.tours = {
            fullWorkflow: [
                {
                    title: 'KI Beratung',
                    content: 'Професійна платформа для перекладу документів з підтримкою глосаріїв, перевіркою якості та командною співпрацею.',
                    target: '.sidebar-logo',
                    mobileTarget: '#header',
                    position: 'bottom'
                },
                {
                    title: 'Крок 1: Проєкти',
                    content: 'Створіть <b>проєкт</b> для кожного замовлення. Проєкт об\'єднує всі файли, глосарій, коментарі та оплати.',
                    target: '.sidebar-item[data-view="projects"]',
                    mobileTarget: '.bottom-nav-item[data-view="projects"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Крок 2: Файли',
                    content: 'Завантажте <b>вихідні документи</b> (оригінали) та <b>референсні</b> матеріали. Натисніть кнопку <b>+</b> для завантаження через зручний покроковий майстер.',
                    target: '.sidebar-item[data-view="files"]',
                    mobileTarget: '.bottom-nav-item[data-view="files"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Крок 3: Замовлення',
                    content: 'Замовте <b>створення глосарію</b>. Спеціаліст підготує термінологію з ваших текстів для точного перекладу.',
                    target: '.sidebar-item[data-view="pricing"]',
                    mobileTarget: '.bottom-nav-item[data-view="pricing"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Крок 4: Перевірка глосарію',
                    content: 'Перегляньте терміни, залиште коментарі, запропонуйте зміни. Разом доведемо термінологію до ідеалу.',
                    target: '.sidebar-item[data-view="glossary"]',
                    mobileTarget: '.bottom-nav-item[data-view="glossary"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Крок 5: Переклад',
                    content: 'Коли глосарій затверджено, замовте переклад. Оберіть рівень:<br><br><b>Оптимум</b> \u2014 швидкий якісний переклад з глосарієм<br><b>Ультра</b> \u2014 максимальна якість, збереження макету, 30+ форматів',
                    target: '.sidebar-item[data-view="pricing"]',
                    mobileTarget: '.bottom-nav-item[data-view="pricing"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Крок 6: Перевірка',
                    content: 'Спеціаліст перевірить якість. Ви зможете переглянути переклад, порівняти з оригіналом, залишити коментарі та затвердити.',
                    target: '.sidebar-item[data-view="files"]',
                    mobileTarget: '.bottom-nav-item[data-view="files"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Інструкції',
                    content: 'Додайте побажання до перекладу: тон, стиль, особливості. Можна завантажити файл Word з детальними вказівками.',
                    target: '.sidebar-item[data-view="instructions"]',
                    mobileTarget: null,
                    position: 'right'
                },
                {
                    title: 'Налаштування',
                    content: 'Оберіть формальність (Sie/Ви чи du/ти), рівень перекладу за замовчуванням та інші параметри.',
                    target: '.sidebar-item[data-view="settings"]',
                    mobileTarget: null,
                    position: 'right'
                },
                {
                    title: 'Команда',
                    content: 'Запросіть колег через посилання. Кожен учасник зможе переглядати файли, коментувати та перевіряти переклади.',
                    target: '.sidebar-item[data-view="team"]',
                    mobileTarget: null,
                    position: 'right'
                }
            ],
            quickStart: [
                {
                    title: 'Почніть тут',
                    content: 'Створіть проєкт, завантажте файли, замовте глосарій \u2014 все починається з проєкту.',
                    target: '.sidebar-item[data-view="projects"]',
                    mobileTarget: '.bottom-nav-item[data-view="projects"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Замовлення',
                    content: 'Глосарій та переклад замовляються тут. Після оплати спеціаліст одразу починає роботу.',
                    target: '.sidebar-item[data-view="pricing"]',
                    mobileTarget: '.bottom-nav-item[data-view="pricing"]',
                    position: 'right',
                    mobilePosition: 'top'
                },
                {
                    title: 'Спільна робота',
                    content: 'Переглядайте глосарій, коментуйте файли \u2014 все в одному місці.',
                    target: '.sidebar-item[data-view="glossary"]',
                    mobileTarget: '.bottom-nav-item[data-view="glossary"]',
                    position: 'right',
                    mobilePosition: 'top'
                }
            ]
        };
    }

    get isMobile() { return window.innerWidth < 768; }

    loadCompletedTours() {
        try { return JSON.parse(localStorage.getItem('onboarding_completed') || '[]'); }
        catch { return []; }
    }

    saveCompletedTour(tourName) {
        if (!this.completedTours.includes(tourName)) {
            this.completedTours.push(tourName);
            localStorage.setItem('onboarding_completed', JSON.stringify(this.completedTours));
        }
    }

    shouldShowTour(tourName) { return !this.completedTours.includes(tourName); }

    startTour(tourName) {
        if (!this.tours[tourName]) return;
        this.currentTour = tourName;
        this.currentStep = 0;
        this.isActive = true;
        this.showStep();
    }

    showStep() {
        const tour = this.tours[this.currentTour];
        if (!tour || this.currentStep >= tour.length) { this.endTour(); return; }
        const step = tour[this.currentStep];
        if (step.waitFor) {
            const check = setInterval(() => {
                if (document.querySelector(step.waitFor)) { clearInterval(check); this.renderStep(step); }
            }, 100);
            setTimeout(() => clearInterval(check), 5000);
        } else {
            this.renderStep(step);
        }
    }

    _getTarget(step) {
        if (this.isMobile) {
            if (step.mobileTarget) {
                const el = document.querySelector(step.mobileTarget);
                if (el) return { el, position: step.mobilePosition || 'top' };
            }
            // Fallback: no target on mobile for sidebar-only items — center the tooltip
            return { el: null, position: 'center' };
        }
        const el = document.querySelector(step.target);
        return { el, position: step.position || 'bottom' };
    }

    renderStep(step) {
        document.querySelectorAll('.onboarding-tooltip, .onboarding-overlay').forEach(el => el.remove());
        document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));

        const { el: target, position } = this._getTarget(step);

        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.skipTour(); });

        const total = this.tours[this.currentTour].length;
        const tooltip = document.createElement('div');
        tooltip.className = 'onboarding-tooltip';
        tooltip.innerHTML = `
            <div class="ob-header">
                <h3>${step.title}</h3>
                <button class="ob-close" onclick="onboardingSystem.skipTour()">${Icons.wrap('close', 16)}</button>
            </div>
            <div class="ob-content">${step.content}</div>
            <div class="ob-footer">
                <div class="ob-progress">${this.currentStep + 1} / ${total}</div>
                <div class="ob-buttons">
                    ${this.currentStep > 0 ? '<button class="btn btn-sm btn-secondary" onclick="onboardingSystem.prevStep()">' + Icons.wrap('back', 14) + ' Назад</button>' : ''}
                    <button class="btn btn-sm btn-primary" onclick="onboardingSystem.nextStep()">
                        ${this.currentStep === total - 1 ? 'Готово ' + Icons.wrap('check', 14) : 'Далі ' + Icons.wrap('forward', 14)}
                    </button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        document.body.appendChild(tooltip);

        if (target) {
            target.classList.add('onboarding-highlight');
            const rect = target.getBoundingClientRect();
            const tr = tooltip.getBoundingClientRect();
            let top, left;
            switch (position) {
                case 'top':
                    top = rect.top - tr.height - 14;
                    left = rect.left + (rect.width - tr.width) / 2;
                    break;
                case 'bottom':
                    top = rect.bottom + 14;
                    left = rect.left + (rect.width - tr.width) / 2;
                    break;
                case 'left':
                    top = rect.top + (rect.height - tr.height) / 2;
                    left = rect.left - tr.width - 14;
                    break;
                case 'right':
                    top = rect.top + (rect.height - tr.height) / 2;
                    left = rect.right + 14;
                    break;
                default:
                    top = window.innerHeight / 2 - tr.height / 2;
                    left = window.innerWidth / 2 - tr.width / 2;
            }
            top = Math.max(10, Math.min(top, window.innerHeight - tr.height - 10));
            left = Math.max(10, Math.min(left, window.innerWidth - tr.width - 10));
            tooltip.style.top = top + 'px';
            tooltip.style.left = left + 'px';
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            // Center tooltip (no target available — mobile for sidebar-only items)
            tooltip.style.top = '50%';
            tooltip.style.left = '50%';
            tooltip.style.transform = 'translate(-50%, -50%)';
        }
    }

    nextStep() {
        document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
        this.currentStep++;
        this.showStep();
    }

    prevStep() {
        document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
        this.currentStep--;
        this.showStep();
    }

    skipTour() { this.endTour(); }

    endTour() {
        this.isActive = false;
        this.saveCompletedTour(this.currentTour);
        document.querySelectorAll('.onboarding-overlay, .onboarding-tooltip').forEach(el => el.remove());
        document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
        if (this.currentStep >= (this.tours[this.currentTour]?.length || 0)) {
            App.toast('Інструктаж завершено!', 'success');
        }
    }

    resetAll() {
        localStorage.removeItem('onboarding_completed');
        this.completedTours = [];
    }

    showHelpMenu() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="max-width:440px">
                <h3 style="margin-bottom:16px">${Icons.wrap('info', 20)} Довідка</h3>
                <div style="display:flex;flex-direction:column;gap:10px">
                    <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove();onboardingSystem.startTour('fullWorkflow')" style="text-align:left;padding:14px 16px">
                        <div style="font-weight:600;margin-bottom:2px">${Icons.wrap('forward', 16)} Повний інструктаж</div>
                        <div style="font-size:13px;opacity:.7;font-weight:400">Покроковий огляд всіх функцій платформи</div>
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove();onboardingSystem.startTour('quickStart')" style="text-align:left;padding:14px 16px">
                        <div style="font-weight:600;margin-bottom:2px">${Icons.wrap('star', 16)} Швидкий старт</div>
                        <div style="font-size:13px;opacity:.7;font-weight:400">3 кроки для початку роботи</div>
                    </button>
                    <div style="border-top:1px solid var(--border-dark);padding-top:14px;margin-top:4px">
                        <div style="font-size:14px;font-weight:600;margin-bottom:10px;color:var(--text-primary)">Як працює платформа:</div>
                        <div style="font-size:13px;color:var(--text-secondary);line-height:1.7">
                            <b>1.</b> Створіть проєкт та завантажте файли<br>
                            <b>2.</b> Замовте глосарій (вкладка Вартість)<br>
                            <b>3.</b> Перевірте та затвердіть терміни<br>
                            <b>4.</b> Замовте переклад (Оптимум або Ультра)<br>
                            <b>5.</b> Перегляньте та прийміть результат
                        </div>
                    </div>
                    <a href="https://kaminskyi.chat" target="_blank" class="btn btn-secondary" style="text-align:center;font-size:13px;text-decoration:none">
                        ${Icons.wrap('globe', 16)} kaminskyi.chat \u2014 зв\u2019язатися з нами
                    </a>
                </div>
                <button class="btn btn-secondary" style="margin-top:16px;width:100%" onclick="this.closest('.modal-overlay').remove()">Закрити</button>
            </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('visible');
                setTimeout(() => overlay.remove(), 300);
            }
        });
    }

    createHelpButton() {
        if (document.getElementById('help-fab')) return;
        const btn = document.createElement('button');
        btn.id = 'help-fab';
        btn.className = 'help-fab';
        btn.innerHTML = Icons.wrap('info', 22);
        btn.title = 'Довідка та інструктаж';
        btn.addEventListener('click', () => this.showHelpMenu());
        document.body.appendChild(btn);
    }
}

window.onboardingSystem = new OnboardingSystem();

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        onboardingSystem.createHelpButton();
        if (onboardingSystem.shouldShowTour('fullWorkflow')) {
            onboardingSystem.startTour('fullWorkflow');
        }
    }, 1200);
});

const onboardingStyle = document.createElement('style');
onboardingStyle.textContent = `
    .onboarding-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,.6);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: 9998;
        animation: obFadeIn .25s ease;
    }
    .onboarding-tooltip {
        position: fixed;
        background: var(--bg-surface);
        border: 1px solid var(--border-light);
        border-radius: 16px;
        box-shadow: 0 12px 48px rgba(0,0,0,.4);
        max-width: 380px;
        width: calc(100vw - 32px);
        z-index: 9999;
        animation: obSlideIn .3s var(--ease-spring);
    }
    .ob-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-dark);
    }
    .ob-header h3 {
        margin: 0; font-size: 17px; font-weight: 700;
        color: var(--text-primary);
    }
    .ob-close {
        background: none; border: none;
        color: var(--text-muted);
        cursor: pointer;
        width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 10px;
        transition: all var(--transition);
    }
    .ob-close:hover { background: var(--bg-hover); color: var(--text-primary); }
    .ob-content {
        padding: 18px 20px;
        font-size: 14px; line-height: 1.7;
        color: var(--text-secondary);
    }
    .ob-content b { font-weight: 600; color: var(--text-primary); }
    .ob-footer {
        display: flex; justify-content: space-between; align-items: center;
        padding: 14px 20px;
        border-top: 1px solid var(--border-dark);
        background: var(--bg-surface-2);
        border-radius: 0 0 16px 16px;
    }
    .ob-progress {
        font-size: 12px; color: var(--text-muted); font-weight: 600;
        letter-spacing: 0.02em;
    }
    .ob-buttons { display: flex; gap: 8px; }
    .onboarding-highlight {
        position: relative; z-index: 9997;
        box-shadow: 0 0 0 4px rgba(79,140,255,.5), 0 0 24px rgba(79,140,255,.2) !important;
        border-radius: 10px;
        animation: obPulse 2s infinite;
    }

    /* Help FAB — bottom LEFT on mobile to avoid upload FAB overlap */
    .help-fab {
        position: fixed;
        bottom: 24px; left: 24px;
        width: 44px; height: 44px;
        border-radius: 50%;
        background: var(--bg-surface-2);
        border: 1px solid var(--border-light);
        color: var(--text-secondary);
        font-size: 20px; font-weight: 700;
        cursor: pointer;
        z-index: var(--z-fab);
        box-shadow: var(--shadow);
        transition: all .2s ease;
        display: flex; align-items: center; justify-content: center;
    }
    .help-fab:hover {
        transform: scale(1.08);
        background: var(--bg-hover);
        color: var(--text-primary);
        box-shadow: var(--shadow-lg);
    }
    .help-fab:active { transform: scale(.95); }
    .help-fab .icon { width: 22px; height: 22px; }

    @keyframes obFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes obSlideIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes obPulse {
        0%, 100% { box-shadow: 0 0 0 4px rgba(79,140,255,.5), 0 0 24px rgba(79,140,255,.2); }
        50% { box-shadow: 0 0 0 8px rgba(79,140,255,.2), 0 0 32px rgba(79,140,255,.1); }
    }

    @media (max-width: 767px) {
        .onboarding-tooltip {
            max-width: calc(100vw - 24px);
            border-radius: 14px;
        }
        /* Help button — above bottom nav, LEFT side */
        .help-fab {
            bottom: calc(var(--bottom-nav-height, 56px) + env(safe-area-inset-bottom) + 16px);
            left: 16px;
            width: 40px; height: 40px;
        }
        .help-fab .icon { width: 20px; height: 20px; }
        .ob-header { padding: 14px 16px; }
        .ob-header h3 { font-size: 16px; }
        .ob-content { padding: 14px 16px; font-size: 14px; }
        .ob-footer { padding: 12px 16px; }
        .ob-footer .btn { min-height: 40px; padding: 8px 14px; }
    }
`;
document.head.appendChild(onboardingStyle);
