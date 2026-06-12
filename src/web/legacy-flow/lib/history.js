/**
 * History Stack for Undo/Redo
 *
 * Tracks actions that can be undone and redone.
 * Usage:
 *   history.push({
 *     apply: () => { term.approved = true; render(); },
 *     rollback: () => { term.approved = false; render(); }
 *   });
 *
 *   history.undo();  // Calls rollback of last action
 *   history.redo();  // Calls apply of undone action
 */

class HistoryStack {
    constructor(maxSize = 20) {
        this.past = [];
        this.future = [];
        this.maxSize = maxSize;
    }

    /**
     * Push a new action onto the history stack
     * @param {Object} action - {apply: Function, rollback: Function, description?: string}
     */
    push(action) {
        if (!action.apply || !action.rollback) {
            console.error('[History] Action must have apply and rollback functions');
            return;
        }

        this.past.push({
            apply: action.apply,
            rollback: action.rollback,
            description: action.description || 'Unknown action',
            timestamp: Date.now(),
        });

        // Limit stack size
        if (this.past.length > this.maxSize) {
            this.past.shift();
        }

        // Clear redo stack on new action
        this.future = [];
    }

    /**
     * Undo the last action
     * @returns {Object|null} The undone action, or null if nothing to undo
     */
    undo() {
        if (this.past.length === 0) {
            return null;
        }

        const action = this.past.pop();
        this.future.push(action);

        try {
            action.rollback();
            return action;
        } catch (e) {
            console.error('[History] Undo failed:', e);
            // Remove from future since rollback failed
            this.future.pop();
            return null;
        }
    }

    /**
     * Redo the last undone action
     * @returns {Object|null} The redone action, or null if nothing to redo
     */
    redo() {
        if (this.future.length === 0) {
            return null;
        }

        const action = this.future.pop();
        this.past.push(action);

        try {
            action.apply();
            return action;
        } catch (e) {
            console.error('[History] Redo failed:', e);
            // Remove from past since apply failed
            this.past.pop();
            return null;
        }
    }

    /**
     * Check if undo is available
     */
    canUndo() {
        return this.past.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo() {
        return this.future.length > 0;
    }

    /**
     * Get the description of the next undo action
     */
    getUndoDescription() {
        if (this.past.length === 0) return null;
        return this.past[this.past.length - 1].description;
    }

    /**
     * Get the description of the next redo action
     */
    getRedoDescription() {
        if (this.future.length === 0) return null;
        return this.future[this.future.length - 1].description;
    }

    /**
     * Clear all history
     */
    clear() {
        this.past = [];
        this.future = [];
    }

    /**
     * Get history summary (for debugging)
     */
    getSummary() {
        return {
            past: this.past.map((a, i) => ({ index: i, description: a.description })),
            future: this.future.map((a, i) => ({ index: i, description: a.description })),
        };
    }
}

// Global history stacks for different views
const glossaryHistory = new HistoryStack(30);
const projectHistory = new HistoryStack(20);
const fileHistory = new HistoryStack(15);
