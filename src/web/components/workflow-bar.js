/** Workflow progress bar — shows project stage as a horizontal stepper. */
const WorkflowBar = {
    STAGES: [
        { key: 'files_uploaded', label: 'Файли', shortLabel: 'Файли', tab: 'files' },
        { key: 'glossary_paid', label: 'Глосарій', shortLabel: 'Глос.', tab: 'glossary' },
        { key: 'glossary_review', label: 'Глосарій', shortLabel: 'Глос.', tab: 'glossary' },
        { key: 'glossary_approved', label: 'Глосарій', shortLabel: 'Глос.', tab: 'glossary' },
        { key: 'translation_paid', label: 'Переклад', shortLabel: 'Перекл.', tab: 'pricing' },
        { key: 'translation_processing', label: 'Переклад', shortLabel: 'Перекл.', tab: 'pricing' },
        { key: 'translation_review', label: 'Перевірка', shortLabel: 'Перев.', tab: 'files' },
        { key: 'completed', label: 'Готово', shortLabel: 'Готово', tab: 'files' },
    ],

    // Collapsed display steps (merge sub-stages into visible steps)
    DISPLAY_STEPS: [
        { label: 'Файли', shortLabel: 'Файли', stages: ['files_uploaded'], tab: 'files' },
        { label: 'Глосарій', shortLabel: 'Глос.', stages: ['glossary_paid', 'glossary_review', 'glossary_approved'], tab: 'glossary' },
        { label: 'Переклад', shortLabel: 'Перекл.', stages: ['translation_paid', 'translation_processing'], tab: 'pricing' },
        { label: 'Перевірка', shortLabel: 'Перев.', stages: ['translation_review'], tab: 'files' },
        { label: 'Готово', shortLabel: 'Готово', stages: ['completed'], tab: 'files' },
    ],

    getStepIndex(workflowStage) {
        for (let i = 0; i < this.DISPLAY_STEPS.length; i++) {
            if (this.DISPLAY_STEPS[i].stages.includes(workflowStage)) return i;
        }
        return 0;
    },

    render(container, workflowStage) {
        if (!container) return;
        const currentIdx = this.getStepIndex(workflowStage || 'files_uploaded');

        let html = '<div class="workflow-bar">';
        this.DISPLAY_STEPS.forEach((step, i) => {
            // Dot
            const isCompleted = i < currentIdx;
            const isActive = i === currentIdx;
            const dotCls = isCompleted ? 'completed' : isActive ? 'active' : '';
            const icon = isCompleted ? '&#10003;' : (isActive ? '&#9679;' : '');
            const clickable = isCompleted ? ` onclick="App.navigate('${step.tab}')"` : '';

            if (i > 0) {
                const lineCls = i <= currentIdx ? 'completed' : '';
                html += `<div class="workflow-line ${lineCls}"></div>`;
            }

            html += `<div class="workflow-step"${clickable} style="${isCompleted ? 'cursor:pointer' : ''}">`;
            html += `<div class="workflow-dot ${dotCls}">${icon}</div>`;
            html += `<div class="workflow-label">${App.esc(step.label)}</div>`;

            // Sub-status hint for active step
            if (isActive && workflowStage) {
                const hint = this.getStageHint(workflowStage);
                if (hint) html += `<div class="workflow-hint">${App.esc(hint)}</div>`;
            }

            html += '</div>';
        });
        html += '</div>';
        container.innerHTML = html;
    },

    getStageHint(stage) {
        const hints = {
            'files_uploaded': 'завантажте файли',
            'glossary_paid': 'оплачено',
            'glossary_review': 'на перевірці',
            'glossary_approved': 'затверджено',
            'translation_paid': 'оплачено',
            'translation_processing': 'в роботі',
            'translation_review': 'на перевірці',
            'completed': '',
        };
        return hints[stage] || '';
    }
};
