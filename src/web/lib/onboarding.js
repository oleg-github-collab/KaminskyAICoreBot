/**
 * Onboarding & Help System
 * Interactive tooltips, full workflow guide, persistent help button
 */

class OnboardingSystem {
    constructor() {
        this.currentStep = 0;
        this.isActive = false;
        this.completedTours = this.loadCompletedTours();
        this.tours = {
            fullWorkflow: [
                {
                    target: '.header-left',
                    title: 'KI Beratung',
                    content: 'Професійна платформа для перекладу документів з підтримкою глосаріїв, перевіркою якості та командною співпрацею.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="projects"]',
                    title: 'Крок 1: Проєкти',
                    content: 'Створіть <b>проєкт</b> для кожного замовлення. Проєкт об\'єднує всі файли, глосарій, коментарі та оплати.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="files"]',
                    title: 'Крок 2: Файли',
                    content: 'Завантажте <b>вихідні документи</b> (оригінали) та <b>референсні</b> матеріали. Підтримуються PDF, DOCX, TXT та інші.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="pricing"]',
                    title: 'Крок 3: Глосарій',
                    content: 'Замовте <b>створення глосарію</b>. Спеціаліст підготує термінологію з ваших текстів для точного перекладу.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="glossary"]',
                    title: 'Крок 4: Перевірка глосарію',
                    content: 'Перегляньте терміни, залиште коментарі, запропонуйте зміни. Разом доведемо термінологію до ідеалу.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="pricing"]',
                    title: 'Крок 5: Переклад',
                    content: 'Коли глосарій затверджено, замовте переклад. Оберіть рівень:<br><br><b>Оптимум</b> \u2014 швидкий якісний переклад з глосарієм (TXT, DOCX, PDF)<br><b>Ультра</b> \u2014 максимальна якість, збереження форматування, 30+ форматів',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="files"]',
                    title: 'Крок 6: Перевірка',
                    content: 'Спеціаліст перевірить якість. Ви зможете переглянути переклад, порівняти з оригіналом, залишити коментарі та затвердити.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="instructions"]',
                    title: 'Інструкції',
                    content: 'Додайте побажання до перекладу: тон, стиль, особливості. Можна завантажити файл Word з детальними вказівками.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="settings"]',
                    title: 'Налаштування',
                    content: 'Оберіть формальність (Sie/Ви чи du/ти), рівень перекладу за замовчуванням та інші параметри.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="team"]',
                    title: 'Команда',
                    content: 'Запросіть колег через посилання. Кожен учасник зможе переглядати файли, коментувати та перевіряти переклади.',
                    position: 'bottom'
                }
            ],
            quickStart: [
                {
                    target: '.nav-btn[data-view="projects"]',
                    title: 'Почніть тут',
                    content: 'Створіть проєкт, завантажте файли, замовте глосарій \u2014 все починається з проєкту.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="pricing"]',
                    title: 'Замовлення',
                    content: 'Глосарій та переклад замовляються тут. Після оплати спеціаліст одразу починає роботу.',
                    position: 'bottom'
                },
                {
                    target: '.nav-btn[data-view="glossary"]',
                    title: 'Спільна робота',
                    content: 'Переглядайте глосарій, коментуйте файли \u2014 все в одному місці.',
                    position: 'bottom'
                }
            ]
        };
    }

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

    renderStep(step) {
        document.querySelectorAll('.onboarding-tooltip, .onboarding-overlay').forEach(el => el.remove());
        document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));

        const target = document.querySelector(step.target);
        if (!target) { this.nextStep(); return; }

        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.skipTour(); });

        const total = this.tours[this.currentTour].length;
        const tooltip = document.createElement('div');
        tooltip.className = 'onboarding-tooltip';
        tooltip.innerHTML = `
            <div class="ob-header">
                <h3>${step.title}</h3>
                <button class="ob-close" onclick="onboardingSystem.skipTour()">&#10005;</button>
            </div>
            <div class="ob-content">${step.content}</div>
            <div class="ob-footer">
                <div class="ob-progress">${this.currentStep + 1} / ${total}</div>
                <div class="ob-buttons">
                    ${this.currentStep > 0 ? '<button class="btn btn-sm btn-secondary" onclick="onboardingSystem.prevStep()">\u2190 Назад</button>' : ''}
                    <button class="btn btn-sm btn-primary" onclick="onboardingSystem.nextStep()">
                        ${this.currentStep === total - 1 ? 'Готово \u2713' : 'Далі \u2192'}
                    </button>
                </div>
            </div>`;

        document.body.appendChild(overlay);
        document.body.appendChild(tooltip);
        target.classList.add('onboarding-highlight');

        const rect = target.getBoundingClientRect();
        const tr = tooltip.getBoundingClientRect();
        let top, left;
        switch (step.position) {
            case 'top': top = rect.top - tr.height - 14; left = rect.left + (rect.width - tr.width) / 2; break;
            case 'bottom': top = rect.bottom + 14; left = rect.left + (rect.width - tr.width) / 2; break;
            case 'left': top = rect.top + (rect.height - tr.height) / 2; left = rect.left - tr.width - 14; break;
            case 'right': top = rect.top + (rect.height - tr.height) / 2; left = rect.right + 14; break;
            default: top = window.innerHeight / 2 - tr.height / 2; left = window.innerWidth / 2 - tr.width / 2;
        }
        top = Math.max(10, Math.min(top, window.innerHeight - tr.height - 10));
        left = Math.max(10, Math.min(left, window.innerWidth - tr.width - 10));
        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
            App.toast('\u2713 Інструктаж завершено!', 'success', 4000);
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
                <h3 style="margin-bottom:16px">Довідка</h3>
                <div style="display:flex;flex-direction:column;gap:10px">
                    <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove();onboardingSystem.startTour('fullWorkflow')" style="text-align:left;padding:14px 16px">
                        <div style="font-weight:600;margin-bottom:2px">Повний інструктаж</div>
                        <div style="font-size:13px;opacity:.8;font-weight:400">Покроковий огляд всіх функцій платформи</div>
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove();onboardingSystem.startTour('quickStart')" style="text-align:left;padding:14px 16px">
                        <div style="font-weight:600;margin-bottom:2px">Швидкий старт</div>
                        <div style="font-size:13px;opacity:.8;font-weight:400">3 кроки для початку роботи</div>
                    </button>
                    <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
                        <div style="font-size:14px;font-weight:600;margin-bottom:8px">Як працює платформа:</div>
                        <div style="font-size:13px;color:var(--hint);line-height:1.7">
                            <b>1.</b> Створіть проєкт та завантажте файли<br>
                            <b>2.</b> Замовте глосарій (вкладка Вартість)<br>
                            <b>3.</b> Перевірте та затвердіть терміни<br>
                            <b>4.</b> Замовте переклад (Оптимум або Ультра)<br>
                            <b>5.</b> Перегляньте та прийміть результат
                        </div>
                    </div>
                    <a href="https://kaminskyi.chat" target="_blank" class="btn btn-secondary" style="text-align:center;font-size:13px;text-decoration:none;color:var(--text)">
                        kaminskyi.chat \u2014 зв\u2019язатися з нами
                    </a>
                </div>
                <button class="btn btn-secondary" style="margin-top:16px;width:100%" onclick="this.closest('.modal-overlay').remove()">Закрити</button>
            </div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    createHelpButton() {
        if (document.getElementById('help-fab')) return;
        const btn = document.createElement('button');
        btn.id = 'help-fab';
        btn.className = 'help-fab';
        btn.innerHTML = '?';
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
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,.5); z-index: 9998;
        backdrop-filter: blur(2px); animation: obFadeIn .25s ease;
    }
    .onboarding-tooltip {
        position: fixed; background: var(--bg, #fff);
        border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.25);
        max-width: 380px; width: calc(100vw - 32px);
        z-index: 9999; animation: obSlideIn .25s ease;
    }
    .ob-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 14px 18px; border-bottom: 1px solid var(--border, #e5e5e5);
    }
    .ob-header h3 { margin: 0; font-size: 17px; font-weight: 700; }
    .ob-close {
        background: none; border: none; font-size: 18px; color: var(--hint);
        cursor: pointer; width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 8px; transition: background .15s;
    }
    .ob-close:hover { background: var(--bg2, #f0f0f0); }
    .ob-content {
        padding: 16px 18px; font-size: 14px; line-height: 1.65;
        color: var(--text, #333);
    }
    .ob-content b { font-weight: 600; }
    .ob-footer {
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 18px; border-top: 1px solid var(--border, #e5e5e5);
        background: var(--bg2, #f9f9f9); border-radius: 0 0 14px 14px;
    }
    .ob-progress { font-size: 12px; color: var(--hint); font-weight: 600; }
    .ob-buttons { display: flex; gap: 8px; }
    .onboarding-highlight {
        position: relative; z-index: 9997;
        box-shadow: 0 0 0 4px rgba(37,99,235,.5), 0 0 24px rgba(37,99,235,.2) !important;
        border-radius: 8px; animation: obPulse 2s infinite;
    }
    .help-fab {
        position: fixed; bottom: 20px; right: 20px;
        width: 48px; height: 48px; border-radius: 50%;
        background: var(--gradient-primary, linear-gradient(135deg, #667eea, #764ba2));
        color: #fff; font-size: 22px; font-weight: 700;
        border: none; cursor: pointer; z-index: 8000;
        box-shadow: 0 4px 16px rgba(102,126,234,.4);
        transition: all .2s ease;
        display: flex; align-items: center; justify-content: center;
    }
    .help-fab:hover {
        transform: scale(1.08) translateY(-2px);
        box-shadow: 0 6px 24px rgba(102,126,234,.5);
    }
    .help-fab:active { transform: scale(.95); }
    @keyframes obFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes obSlideIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes obPulse {
        0%, 100% { box-shadow: 0 0 0 4px rgba(37,99,235,.5), 0 0 24px rgba(37,99,235,.2); }
        50% { box-shadow: 0 0 0 8px rgba(37,99,235,.25), 0 0 32px rgba(37,99,235,.1); }
    }
    @media (max-width: 767px) {
        .onboarding-tooltip { max-width: calc(100vw - 24px); }
        .help-fab { bottom: 80px; right: 14px; width: 44px; height: 44px; font-size: 20px; }
    }
`;
document.head.appendChild(onboardingStyle);
