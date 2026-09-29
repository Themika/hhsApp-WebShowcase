let QUESTIONS_CONFIG = [];
let currentStepTarget = null;
let activeDataFilePath = null;

let stagedTrialsArray = [];
let activeBulletPointsArr = [];

// ------------------------------------------------------------------
// Dark mode. Explicit choice (once toggled) always wins via a
// data-theme attribute on <html>; before that, style.css falls back to
// the OS-level prefers-color-scheme automatically — no JS needed for
// that default, only for the manual override + persistence.
// ------------------------------------------------------------------
function getCurrentTheme() {
    const saved = localStorage.getItem('hhsTheme');
    if (saved === 'dark' || saved === 'light') return saved;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

function toggleTheme() {
    const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('hhsTheme', next);
    document.documentElement.setAttribute('data-theme', next);
    const btn = document.getElementById('hhsThemeToggleBtn');
    if (btn) {
        if (typeof setSideBtnContent === 'function') {
            setSideBtnContent(btn, next === 'dark' ? '<img src="images/sun-alt-svgrepo-com.svg">' : '<img src="images/moon-svgrepo-com.svg">', next === 'dark' ? 'Light Mode' : 'Dark Mode');
        } else {
            btn.textContent = next === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
        }
    }
}

function injectThemeToggleButton() {
    if (document.getElementById('hhsThemeToggleBtn')) return;
    const controls = document.querySelector('.header-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hhsThemeToggleBtn';
    btn.className = 'ctrl-btn';
    btn.style.background = '#475569';
    btn.style.color = '#ffffff';
    const isDark = getCurrentTheme() === 'dark';
    if (typeof setSideBtnContent === 'function') {
        setSideBtnContent(btn, isDark ? '<img src="images/sun-alt-svgrepo-com.svg">' : '<img src="images/moon-svgrepo-com.svg">', isDark ? 'Light Mode' : 'Dark Mode');
    } else {
        btn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
    }
    btn.addEventListener('click', toggleTheme);
    controls.appendChild(btn);
}

// Runs immediately at script parse time (document.documentElement already
// exists this early), NOT inside DOMContentLoaded — applying this before
// first paint is what avoids a flash of the wrong theme on load. Only
// sets the attribute if the user has explicitly chosen before; otherwise
// leaves it unset so the CSS prefers-color-scheme fallback governs.
(function applyStoredThemeEarly() {
    const saved = localStorage.getItem('hhsTheme');
    if (saved === 'dark' || saved === 'light') {
        document.documentElement.setAttribute('data-theme', saved);
    }
})();

let stagedPdfFiles = []; // [{ name, data }] — a trial option can now have multiple reference PDFs
let editingStepNumber = null;
let editingTrialIndex = null;
let editingBulletIndex = null;

// True while the step editor (#creatorView) has typed-but-unsaved input.
// Driven by event delegation + a MutationObserver below — doesn't require
// touching editor-tools.js at all.
let hasUnsavedFormChanges = false;

// True when running inside the Capacitor native shell (Android/iOS app),
// false when running in a plain browser (e.g. `npx cap serve` in dev, or
// testing the page directly).
function isNativePlatform() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// ------------------------------------------------------------------
// Lightweight toast notifications (undo prompts, backup restores, etc).
// role="status" + aria-live means screen readers announce these without
// needing focus to move.
// ------------------------------------------------------------------
function showToast(message, opts = {}) {
    const { actionLabel, onAction, duration = 6000 } = opts;
    document.getElementById('hhsToast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'hhsToast';
    toast.className = 'hhs-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = 'position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:#0f172a; color:#fff; padding:12px 16px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.35); display:flex; align-items:center; gap:12px; z-index:100000; font-size:14px; max-width:90vw;';

    const msg = document.createElement('span');
    msg.textContent = message;
    toast.appendChild(msg);

    if (actionLabel && onAction) {
        const actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.textContent = actionLabel;
        actionBtn.style.cssText = 'background:#3b82f6; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-weight:600; cursor:pointer; font-size:13px; white-space:nowrap;';
        actionBtn.addEventListener('click', () => { onAction(); toast.remove(); });
        toast.appendChild(actionBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'background:none; border:none; color:#94a3b8; font-size:18px; cursor:pointer; line-height:1; padding:0 2px;';
    closeBtn.addEventListener('click', () => toast.remove());
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);
    if (duration) window.setTimeout(() => { if (toast.isConnected) toast.remove(); }, duration);
}

// ------------------------------------------------------------------
// "Last saved: 2 minutes ago" status line, injected under the header.
// Updates live so it stays accurate without a reload.
// ------------------------------------------------------------------
function formatRelativeTime(timestampMs) {
    const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

function updateStatusBar() {
    const el = document.getElementById('hhsStatusBar');
    if (!el) return;

    const lastSavedRaw = localStorage.getItem('hhsLastSavedAt');
    const lastSavedText = lastSavedRaw ? formatRelativeTime(parseInt(lastSavedRaw, 10)) : 'never';

    if (hasUnsavedFormChanges) {
        el.textContent = `● Unsaved changes in the editor — last full save ${lastSavedText}`;
        el.style.color = '#f59e0b';
    } else {
        el.textContent = `✓ All changes saved — ${lastSavedText}`;
        el.style.color = '#94a3b8';
    }
}

function markFormDirty() {
    if (!hasUnsavedFormChanges) {
        hasUnsavedFormChanges = true;
        updateStatusBar();
    }
}

function markFormClean() {
    if (hasUnsavedFormChanges) {
        hasUnsavedFormChanges = false;
        updateStatusBar();
    }
}

// ------------------------------------------------------------------
// Sidebar buttons show their label on the left and their icon on the
// right (see .side-btn in style.css, which uses justify-content:
// space-between). Icon and label need to be separate elements — not one
// "icon + text" string — for CSS to be able to position them
// independently, so every button that ends up in the sidebar and has an
// icon should be built with this helper rather than a plain textContent
// assignment.
// ------------------------------------------------------------------
function setSideBtnContent(btn, icon, label) {
    btn.textContent = '';
    const labelSpan = document.createElement('span');
    labelSpan.className = 'side-btn-label';
    labelSpan.textContent = label;
    const iconSpan = document.createElement('span');
    iconSpan.className = 'side-btn-icon';
    // innerHTML (not textContent) so icon can be either a plain emoji
    // string ('🕘') or markup for an SVG icon, e.g.
    // '<img src="images/clock-two-svgrepo-com.svg" alt="">'
    iconSpan.innerHTML = icon;
    btn.appendChild(labelSpan);
    btn.appendChild(iconSpan);
}

// ------------------------------------------------------------------
// Places a header button into the sidebar's nav list. Most buttons exist
// before consolidateHeaderControls() runs and get swept in automatically
// (see below) — this is for the rare case a button is created LATER, after
// the sweep already happened. That's exactly what happens with role-gated
// buttons like "Manage Access": the role check is an async Firestore call
// that resolves after Firebase auth completes, well after the sidebar has
// already been assembled at DOMContentLoaded. Without this, a late button
// would just get appended to the now-mostly-empty .header-controls instead
// of living in the sidebar with everything else.
// ------------------------------------------------------------------
function insertIntoSidebarOrHeader(btn) {
    const sidebar = document.getElementById('hhsSidebar');
    if (sidebar) {
        btn.className = 'side-btn';
        const footer = sidebar.querySelector('.sidebar-footer');
        if (footer) {
            sidebar.insertBefore(btn, footer);
        } else {
            sidebar.appendChild(btn);
        }
        return;
    }
    // Sidebar doesn't exist yet — this button showed up early enough to
    // ride along in the normal header-to-sidebar sweep.
    document.querySelector('.header-controls')?.appendChild(btn);
}

// ------------------------------------------------------------------
// Collapses everything in .header-controls except "Add Step" and
// "Manage All Steps" into a single "⋮ More" dropdown — Import, Export,
// Restore Backup, Preview Flow, and Manage Access all move in there.
// Reparents the actual existing button elements (doesn't recreate them),
// so their click handlers keep working untouched. Runs last, after all
// the other header buttons have already been injected into .header-controls.
// ------------------------------------------------------------------
function consolidateHeaderControls() {
    if (document.getElementById('hhsSidebarToggleBtn')) return;
    
    const controls = document.querySelector('.header-controls');
    if (!controls) return;

    const addStepBtn = controls.querySelector('.add-trigger');
    const manageModeBtn = document.getElementById('hhsManageModeBtn');
    
    const toMove = Array.from(controls.children).filter(el =>
        el.tagName === 'BUTTON' && el !== addStepBtn && el !== manageModeBtn
    );
    if (toMove.length === 0) return;

    const logoutBtn = toMove.find(btn => btn.id === 'logout-button' || btn.textContent.toLowerCase().includes('log out'));
    const standardBtns = toMove.filter(btn => btn !== logoutBtn);

    const sidebar = document.createElement('div');
    sidebar.id = 'hhsSidebar';

    // 1. Sidebar Top
    const brandArea = document.createElement('div');
    brandArea.className = 'sidebar-brand';
    brandArea.innerHTML = `</div><span>HHS Clinical</span>`;
    sidebar.appendChild(brandArea);

    // 2. Search Bar with Logic
    const searchBar = document.createElement('input');
    searchBar.className = 'sidebar-search';
    searchBar.placeholder = '🔍 Quick Search...';
    
    // Add Search functionality here
    searchBar.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const buttons = sidebar.querySelectorAll('.side-btn');
        
        buttons.forEach(btn => {
            // Keep the logout button visible always
            if (btn.id === 'logout-button') return;
            
            // Filter other buttons
            const text = btn.textContent.toLowerCase();
            btn.style.display = text.includes(query) ? 'flex' : 'none';
        });
    });
    
    sidebar.appendChild(searchBar);

    // 3. Navigation Buttons
    standardBtns.forEach((btn, index) => {
        if (index === 2) {
            const divider = document.createElement('div');
            divider.className = 'sidebar-header-text';
            divider.textContent = 'Shortcuts';
            sidebar.appendChild(divider);
        }
        btn.className = 'side-btn';
        sidebar.appendChild(btn);
    });

    // // Spacer
    // const spacer = document.createElement('div');
    // spacer.style.flex = '1';
    // sidebar.appendChild(spacer);

    // 4. Footer
    const footerArea = document.createElement('div');
    footerArea.className = 'sidebar-footer';

    if (logoutBtn) {
        logoutBtn.className = 'side-btn';
        logoutBtn.id = 'logout-button'; 
        logoutBtn.textContent = 'Log Out';
        
        // ADD THIS: Closes the sidebar when clicked
        logoutBtn.addEventListener('click', () => {
            sidebar.classList.remove('sidebar-open');
        });
        
        footerArea.appendChild(logoutBtn);
    }

    sidebar.appendChild(footerArea);
    document.body.appendChild(sidebar);

    // 5. Toggle Logic
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.id = 'hhsSidebarToggleBtn';
    toggleBtn.className = 'ctrl-btn';
    toggleBtn.textContent = '☰ Menu';
    controls.appendChild(toggleBtn);

    toggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        sidebar.classList.toggle('sidebar-open');
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById('pdfUpload')?.addEventListener('change', handlePdfUpload);
    document.getElementById('importTxtInput')?.addEventListener('change', handleTxtImport);

    // Start listening for cross-device updates. This fires immediately with
    // whatever's currently in Firestore (if configured), then again on every
    // future change from any device — see firebase-sync.js for setup.
    if (typeof initFirebaseSync === 'function') initFirebaseSync();

    // --- Status bar injection ---
    const statusBar = document.createElement('div');
    statusBar.id = 'hhsStatusBar';
    statusBar.setAttribute('role', 'status');
    statusBar.style.cssText = 'padding:6px 32px; font-size:12px; font-weight:600; background:#0f172a; color:#94a3b8; border-top:1px solid rgba(255,255,255,0.08);';
    document.querySelector('.dash-header')?.insertAdjacentElement('afterend', statusBar);
    updateStatusBar();
    window.setInterval(updateStatusBar, 20000); 

    // --- Dirty-tracking for the step editor, via event delegation ---
    // Any typing/selection anywhere inside #creatorView marks it dirty.
    // No changes to editor-tools.js needed.
    const creatorView = document.getElementById('creatorView');
    if (creatorView) {
        creatorView.addEventListener('input', markFormDirty);
        creatorView.addEventListener('change', markFormDirty);

        // When #creatorView's "hidden" class toggles, that's either the
        // editor opening (fresh start → clear dirty) or closing (either
        // saved or explicitly cancelled — either way nothing's at risk of
        // being silently lost anymore, so clear dirty).
        const observer = new MutationObserver(() => markFormClean());
        observer.observe(creatorView, { attributes: true, attributeFilter: ['class'] });
    }

    // Warn before leaving the tab if there's typed-but-unsaved editor input.
    window.addEventListener('beforeunload', (event) => {
        if (hasUnsavedFormChanges) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    // Extra header controls (restore backup, flow preview) and the
    // step search box — added via JS since these aren't part of the
    // original markup.
    if (typeof injectRestoreBackupButton === 'function') injectRestoreBackupButton();
    if (typeof injectFlowPreviewButton === 'function') injectFlowPreviewButton();
    if (typeof initStepJumpSearch === 'function') initStepJumpSearch();
    if (typeof injectManageModeButton === 'function') injectManageModeButton();
    if (typeof injectHistoryButton === 'function') injectHistoryButton();
    if (typeof injectAccessManagerButton === 'function') injectAccessManagerButton();
    injectThemeToggleButton();

    // Now that every header button exists, fold everything except
    // "Add Step" into a single dropdown to de-clutter the header.
    consolidateHeaderControls();

    try {
        // 1. Native app: look for previously-saved data in the app's private
        //    storage via the Capacitor Filesystem plugin.
        if (isNativePlatform() && window.Capacitor?.Plugins?.Filesystem) {
            const { Filesystem } = window.Capacitor.Plugins;
            try {
                const result = await Filesystem.readFile({
                    path: 'questions.txt',
                    directory: 'DATA',
                    encoding: 'utf8'
                });
                QUESTIONS_CONFIG = JSON.parse(result.data);
                buildWorkflowUI();
                return;
            } catch (readErr) {
                // No saved file yet (first launch) — fall through to bundled asset below.
                console.log('[HHS DEBUG] No saved questions.txt in app storage yet, loading bundled copy.');
            }
        }

        // 2. Browser/dev fallback: prefer a local autosave if one exists.
        if (!isNativePlatform()) {
            const savedLocal = localStorage.getItem('hhsQuestionsConfig');
            if (savedLocal) {
                const decrypted = typeof decryptFromStorage === 'function'
                    ? await decryptFromStorage(savedLocal)
                    : savedLocal;
                if (decrypted) {
                    QUESTIONS_CONFIG = JSON.parse(decrypted);
                    buildWorkflowUI();
                    return;
                }

                // Decryption failed — two very different reasons this can
                // happen:
                //   1. No encryption key loaded yet. This runs at
                //      DOMContentLoaded, which fires before Firebase Auth
                //      has had a chance to resolve and derive the key (see
                //      initEncryptionKey() in firebase-sync.js) — totally
                //      normal on every fresh page load, not an error. Once
                //      login completes moments later, the Firestore
                //      listener (listenForRemoteUpdates) populates real
                //      data on its own. Falling through to the bundled-file
                //      fetch below (which doesn't exist on a web deploy)
                //      and showing an alert for this case was the actual
                //      bug — just wait quietly instead.
                //   2. The cache genuinely belongs to a different account
                //      and truly can't be decrypted with this key.
                if (typeof encryptionKey !== 'undefined' && !encryptionKey) {
                    console.log('[HHS DEBUG] Local cache present but no encryption key yet — waiting for login to populate data via Firestore instead of treating this as an error.');
                    return;
                }
                console.warn('[HHS DEBUG] Local cache present but not decryptable for this account — ignoring it.');
            }
        }

        // 3. First run (native or browser): load the bundled questions.txt
        //    that ships inside the app's www/ assets.
        let protocolPath = 'questions.txt';
        if (window.location.pathname.includes('/Templates/')) protocolPath = '../Scripts/questions.txt';

        const response = await fetch(protocolPath);
        if (!response.ok) throw new Error("Could not find configuration registry database.");
        QUESTIONS_CONFIG = await response.json();
        buildWorkflowUI();
    } catch (err) {
        console.error("Initialization Error:", err);
        // Only show the blocking alert when there's genuinely no other way
        // to get data — if Firebase sync is enabled, the Firestore
        // listener (listenForRemoteUpdates, in firebase-sync.js) will
        // populate QUESTIONS_CONFIG on its own once login resolves, so an
        // alarming modal error here would just be noise for something
        // that's about to fix itself.
        if (typeof firebaseSyncEnabled === 'undefined' || !firebaseSyncEnabled) {
            alert("Database Error: Could not locate configuration data.");
        }
    }
});