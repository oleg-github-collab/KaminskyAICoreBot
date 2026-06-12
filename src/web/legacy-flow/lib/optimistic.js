/**
 * Optimistic UI Helper
 *
 * Provides instant UI updates that rollback on error.
 * Usage:
 *   await optimistic.execute(
 *     'approve_term',
 *     () => { term.is_approved = true; render(); },        // Optimistic update
 *     () => API.approveTerms(pid, [termId]),              // Actual API call
 *     () => { term.is_approved = false; render(); }       // Rollback on error
 *   );
 */

class OptimisticUI {
    constructor() {
        this.pendingOps = new Map();  // opId → {type, rollback, timestamp}
        this.opCounter = 0;
    }

    /**
     * Execute an optimistic operation
     * @param {string} type - Operation type for debugging
     * @param {Function} optimisticFn - Function to apply optimistic update immediately
     * @param {Function} apiFn - Async function that performs the actual API call
     * @param {Function} rollbackFn - Function to rollback the optimistic update on error
     * @returns {Promise} Resolves when API call succeeds, rejects on error
     */
    async execute(type, optimisticFn, apiFn, rollbackFn) {
        const opId = ++this.opCounter;
        const timestamp = Date.now();

        // 1. Apply optimistic update immediately
        try {
            optimisticFn();
        } catch (e) {
            console.error('[OptimisticUI] Optimistic function failed:', e);
            throw e;
        }

        // 2. Store rollback function
        this.pendingOps.set(opId, { type, rollback: rollbackFn, timestamp });

        // 3. Execute API call in background
        try {
            const result = await apiFn();
            this.pendingOps.delete(opId);
            return result;
        } catch (e) {
            // 4. Rollback on error
            console.warn(`[OptimisticUI] Operation ${type} failed, rolling back:`, e.message);
            try {
                rollbackFn();
            } catch (rollbackError) {
                console.error('[OptimisticUI] Rollback function failed:', rollbackError);
            }
            this.pendingOps.delete(opId);
            throw e;
        }
    }

    /**
     * Batch execute multiple operations optimistically
     * @param {Array} operations - Array of {type, optimistic, api, rollback}
     * @returns {Promise<Array>} Array of results (success or error objects)
     */
    async executeBatch(operations) {
        const opIds = [];
        const rollbacks = [];

        // 1. Apply all optimistic updates immediately
        for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            const opId = ++this.opCounter;
            opIds.push(opId);

            try {
                op.optimistic();
                this.pendingOps.set(opId, {
                    type: op.type,
                    rollback: op.rollback,
                    timestamp: Date.now(),
                });
                rollbacks.push(op.rollback);
            } catch (e) {
                console.error(`[OptimisticUI] Batch optimistic ${i} failed:`, e);
                // Rollback all previous operations
                for (let j = i - 1; j >= 0; j--) {
                    rollbacks[j]();
                }
                throw e;
            }
        }

        // 2. Execute all API calls in parallel
        const results = await Promise.allSettled(
            operations.map(op => op.api())
        );

        // 3. Process results and rollback failures
        const finalResults = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const opId = opIds[i];

            if (result.status === 'fulfilled') {
                this.pendingOps.delete(opId);
                finalResults.push({ success: true, value: result.value });
            } else {
                // Rollback this operation
                console.warn(`[OptimisticUI] Batch operation ${i} failed, rolling back`);
                try {
                    rollbacks[i]();
                } catch (rollbackError) {
                    console.error('[OptimisticUI] Batch rollback failed:', rollbackError);
                }
                this.pendingOps.delete(opId);
                finalResults.push({ success: false, error: result.reason });
            }
        }

        return finalResults;
    }

    /**
     * Get all pending operations (for debugging)
     */
    getPending() {
        return Array.from(this.pendingOps.entries()).map(([id, op]) => ({
            id,
            type: op.type,
            age_ms: Date.now() - op.timestamp,
        }));
    }

    /**
     * Clear all pending operations (use with caution)
     */
    clear() {
        this.pendingOps.clear();
    }

    /**
     * Check if there are pending operations
     */
    hasPending() {
        return this.pendingOps.size > 0;
    }
}

// Global singleton instance
const optimistic = new OptimisticUI();
