/* ---------------------------------------------------------------
 *  transitions.js — lightweight view-transition helpers
 *  Global object: Transitions
 *
 *  CSS classes used:
 *    .view-exit / .view-exit-active   — leaving content
 *    .view-enter / .view-enter-active — entering content
 *    .stagger-item / .stagger-visible — list stagger
 *
 *  All easings: cubic-bezier(0.4, 0, 0.2, 1)
 *  Respects prefers-reduced-motion: reduce
 * --------------------------------------------------------------- */

const Transitions = (() => {
    /* ---------- helpers ---------- */

    const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

    function prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /** Wait for N ms, resolves immediately when reduced-motion is on. */
    function wait(ms) {
        if (prefersReducedMotion()) return Promise.resolve();
        return new Promise(r => setTimeout(r, ms));
    }

    /** Schedule a double-rAF so the browser paints the "before" frame. */
    function nextFrame() {
        return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    /* ---------- public API ---------- */

    return {

        /**
         * Animate content change inside a container.
         *
         * @param {HTMLElement}  container  — wrapper element
         * @param {Function}     renderFn   — called between exit and enter to mutate the DOM
         * @param {'fade'|'slide-left'|'slide-right'|'slide-up'} direction
         */
        async switchView(container, renderFn, direction) {
            if (direction === undefined) direction = 'fade';
            if (!container) { renderFn(); return; }

            if (prefersReducedMotion()) {
                renderFn();
                return;
            }

            // --- exit phase ---
            container.classList.add('view-exit', 'view-exit--' + direction);
            await nextFrame();
            container.classList.add('view-exit-active');
            await wait(150);

            // --- swap content ---
            container.classList.remove(
                'view-exit', 'view-exit-active', 'view-exit--' + direction
            );
            renderFn();

            // --- enter phase ---
            container.classList.add('view-enter', 'view-enter--' + direction);
            await nextFrame();
            container.classList.add('view-enter-active');
            await wait(300);

            // --- cleanup ---
            container.classList.remove(
                'view-enter', 'view-enter-active', 'view-enter--' + direction
            );
        },

        /**
         * Stagger-animate a list of child elements (cards appearing one by one).
         *
         * @param {HTMLElement} container — parent element
         * @param {string}      selector — CSS selector for items inside container
         * @param {number}      delay    — ms between each item (default 50)
         * @returns {Promise}   resolves when the last item has finished its entrance
         */
        staggerIn(container, selector, delay) {
            if (delay === undefined) delay = 50;
            if (!container) return Promise.resolve();

            var items = container.querySelectorAll(selector);
            if (!items.length) return Promise.resolve();

            if (prefersReducedMotion()) {
                items.forEach(function(el) {
                    el.classList.add('stagger-item', 'stagger-visible');
                });
                return Promise.resolve();
            }

            // Prepare: every item starts invisible
            items.forEach(function(el, i) {
                el.classList.add('stagger-item');
                el.style.transitionDelay = (i * delay) + 'ms';
                el.style.transitionTimingFunction = EASING;
            });

            // Trigger: add visible class in next frame so transition fires
            return nextFrame().then(function() {
                items.forEach(function(el) { el.classList.add('stagger-visible'); });

                // Resolve after last item finishes (300ms base + total stagger)
                var totalMs = 300 + (items.length - 1) * delay;
                return wait(totalMs);
            });
        },

        /**
         * Fade a single element in (opacity 0 + slight translateY to full).
         *
         * @param {HTMLElement} element
         * @param {number}      duration — ms (default 300)
         * @returns {Promise}
         */
        fadeIn(element, duration) {
            if (duration === undefined) duration = 300;
            if (!element) return Promise.resolve();

            if (prefersReducedMotion()) {
                element.style.opacity = '1';
                element.style.transform = 'none';
                return Promise.resolve();
            }

            element.style.opacity = '0';
            element.style.transform = 'translateY(8px)';
            element.style.transition = 'opacity ' + duration + 'ms ' + EASING + ', transform ' + duration + 'ms ' + EASING;

            return nextFrame().then(function() {
                element.style.opacity = '1';
                element.style.transform = 'translateY(0)';
                return wait(duration);
            }).then(function() {
                element.style.transition = '';
                element.style.transform = '';
            });
        },

        /**
         * Fade a single element out then remove it from the DOM.
         *
         * @param {HTMLElement} element
         * @param {number}      duration — ms (default 200)
         * @returns {Promise}
         */
        fadeOut(element, duration) {
            if (duration === undefined) duration = 200;
            if (!element) return Promise.resolve();

            if (prefersReducedMotion()) {
                element.remove();
                return Promise.resolve();
            }

            element.style.transition = 'opacity ' + duration + 'ms ' + EASING + ', transform ' + duration + 'ms ' + EASING;
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';

            return nextFrame().then(function() {
                element.style.opacity = '0';
                element.style.transform = 'translateY(8px)';
                return wait(duration);
            }).then(function() {
                element.remove();
            });
        },

        /**
         * Slide an element in from a given direction.
         *
         * @param {HTMLElement} element
         * @param {'bottom'|'top'|'left'|'right'} from — origin direction (default 'bottom')
         * @param {number} duration — ms (default 300)
         * @returns {Promise}
         */
        slideIn(element, from, duration) {
            if (from === undefined) from = 'bottom';
            if (duration === undefined) duration = 300;
            if (!element) return Promise.resolve();

            var offsets = {
                bottom: 'translateY(24px)',
                top:    'translateY(-24px)',
                left:   'translateX(-24px)',
                right:  'translateX(24px)'
            };

            if (prefersReducedMotion()) {
                element.style.opacity = '1';
                element.style.transform = 'none';
                return Promise.resolve();
            }

            element.style.opacity = '0';
            element.style.transform = offsets[from] || offsets.bottom;
            element.style.transition = 'opacity ' + duration + 'ms ' + EASING + ', transform ' + duration + 'ms ' + EASING;

            return nextFrame().then(function() {
                element.style.opacity = '1';
                element.style.transform = 'translate(0, 0)';
                return wait(duration);
            }).then(function() {
                element.style.transition = '';
                element.style.transform = '';
            });
        }
    };
})();
