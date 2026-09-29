(function () {
    const MOBILE_QUERY = '(max-width: 640px)';
    const CLOSE_THRESHOLD = 160;     // px — release below this height => close
    const DEFAULT_HEIGHT_VH = 0.55;  // where it opens to by default
    const MAX_HEIGHT_VH = 0.92;      // as far up as a drag can expand it
    const MIN_DRAG_HEIGHT = 60;      // px — floor while actively dragging

    function isMobile() {
        return window.matchMedia(MOBILE_QUERY).matches;
    }
    function maxHeightPx() {
        return window.innerHeight * MAX_HEIGHT_VH;
    }
    function defaultHeightPx() {
        return window.innerHeight * DEFAULT_HEIGHT_VH;
    }

    function ensureHandle(sidebar) {
        let handle = sidebar.querySelector('.hhs-sidebar-handle');
        if (handle) return handle;
        handle = document.createElement('div');
        handle.className = 'hhs-sidebar-handle';
        handle.setAttribute('aria-hidden', 'true');
        sidebar.insertBefore(handle, sidebar.firstChild);
        return handle;
    }

    function attachDrag(sidebar) {
        if (sidebar.dataset.dragBound === 'true') return;
        sidebar.dataset.dragBound = 'true';

        const handle = ensureHandle(sidebar);
        let dragging = false;
        let startY = 0;
        let startHeight = 0;

        function onPointerDown(e) {
            if (!isMobile()) return;
            dragging = true;
            sidebar.dataset.dragBusy = 'true';
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            startHeight = sidebar.getBoundingClientRect().height;
            sidebar.style.transition = 'none';
            document.addEventListener('touchmove', onPointerMove, { passive: false });
            document.addEventListener('touchend', onPointerUp);
            document.addEventListener('mousemove', onPointerMove);
            document.addEventListener('mouseup', onPointerUp);
        }

        function onPointerMove(e) {
            if (!dragging) return;
            const currentY = e.touches ? e.touches[0].clientY : e.clientY;
            const delta = startY - currentY; // positive = dragging up
            const newHeight = Math.max(MIN_DRAG_HEIGHT, Math.min(startHeight + delta, maxHeightPx()));
            sidebar.style.height = newHeight + 'px';
            sidebar.style.maxHeight = newHeight + 'px';
            if (e.cancelable) e.preventDefault();
        }

        function onPointerUp() {
            if (!dragging) return;
            dragging = false;
            document.removeEventListener('touchmove', onPointerMove);
            document.removeEventListener('touchend', onPointerUp);
            document.removeEventListener('mousemove', onPointerMove);
            document.removeEventListener('mouseup', onPointerUp);

            const currentHeight = sidebar.getBoundingClientRect().height;
            sidebar.style.transition =
                'height 0.3s cubic-bezier(0.16, 1, 0.3, 1), max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1), bottom 0.4s cubic-bezier(0.16, 1, 0.3, 1)';

            if (currentHeight < CLOSE_THRESHOLD) {
                // Dragged down far enough — close it and let style.css's
                // bottom:-100% slide it fully off-screen.
                sidebar.classList.remove('sidebar-open');
                window.setTimeout(() => {
                    sidebar.style.height = '';
                    sidebar.style.maxHeight = '';
                    sidebar.style.transition = '';
                    delete sidebar.dataset.dragBusy;
                }, 400);
            } else {
                // Snap to whichever is closer: default partial height, or full expansion.
                const midpoint = (defaultHeightPx() + maxHeightPx()) / 2;
                const snapTo = currentHeight > midpoint ? maxHeightPx() : defaultHeightPx();
                sidebar.style.height = snapTo + 'px';
                sidebar.style.maxHeight = snapTo + 'px';
                window.setTimeout(() => {
                    sidebar.style.transition = '';
                    delete sidebar.dataset.dragBusy;
                }, 300);
            }
        }

        handle.addEventListener('touchstart', onPointerDown, { passive: true });
        handle.addEventListener('mousedown', onPointerDown);
    }

    // Every time the sheet (re)opens, reset it to the default partial
    // height — unless a drag is actively in progress.
    function watchOpenState(sidebar) {
        const observer = new MutationObserver(() => {
            if (sidebar.classList.contains('sidebar-open') && isMobile() && !sidebar.dataset.dragBusy) {
                sidebar.style.height = defaultHeightPx() + 'px';
                sidebar.style.maxHeight = defaultHeightPx() + 'px';
            }
        });
        observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    }

    function init(sidebar) {
        attachDrag(sidebar);
        watchOpenState(sidebar);
    }

    const existing = document.getElementById('hhsSidebar');
    if (existing) {
        init(existing);
    } else {
        const bodyObserver = new MutationObserver(() => {
            const el = document.getElementById('hhsSidebar');
            if (el) {
                init(el);
                bodyObserver.disconnect();
            }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }
})();