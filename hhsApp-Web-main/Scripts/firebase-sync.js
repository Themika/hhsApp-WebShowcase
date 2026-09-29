const FIREBASE_CONFIG = {
    apiKey: "__FIREBASE_API_KEY__",
    authDomain: "__FIREBASE_AUTH_DOMAIN__",
    projectId: "__FIREBASE_PROJECT_ID__",
    storageBucket: "__FIREBASE_STORAGE_BUCKET__",
    messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
    appId: "__FIREBASE_APP_ID__"
};

const FIRESTORE_COLLECTION = 'hhsProtocolSync';
const FIRESTORE_DOC_ID = 'current';
const MAX_HISTORY_ENTRIES = 8; // rolling cap on the change-history log, pruned client-side
const ROLES_COLLECTION = 'userRoles'; // doc ID = lowercased email, e.g. { role: 'manager' | 'editor' | 'viewer' }

// Only @hhsc.ca accounts (plus any one-off exceptions) get access at all —
// shared by the login/register gate below and by fetchUserRole()'s
// automatic-editor default further down. Keep this in sync with
// isHhscEmail() in firestore.rules, which is the actual enforcement
// boundary — this is just what the client uses for UX/role defaults.
const ALLOWED_EMAIL_DOMAIN = 'hhsc.ca';
const ALLOWED_EMAIL_EXCEPTIONS = ['weerasuriyathemika@gmail.com'];
function isAllowedDomain(email) {
    if (!email) return false;
    const lower = email.toLowerCase();
    return lower.endsWith('@' + ALLOWED_EMAIL_DOMAIN) || ALLOWED_EMAIL_EXCEPTIONS.includes(lower);
}

let firestoreDb = null;
let auth = null;
let cachedHistoryEntries = null; // populated by fetchRecentHistory() right after login
let firebaseSyncEnabled = false;
let applyingRemoteUpdate = false; // guards against reacting to our own write
let currentUserRole = null; // 'manager' | 'editor' | 'viewer' | null (not yet determined)

// The most recent updatedAt we KNOW the server actually has — either from
// a push we made ourselves, or a remote update our listener applied. Used
// to detect "someone else wrote since we last knew about" right before we
// overwrite the document ourselves.
let lastKnownRemoteTimestamp = 0;

function logSyncDebug(stage, details = {}) {
    console.log(`[HHS SYNC] ${stage}`, details);
}

function isFirebaseConfigured() {
    return !!(FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith('__FIREBASE_'));
}

function initFirebaseSync() {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        logSyncDebug('init:sdkNotLoaded', {});
        return;
    }
    if (!isFirebaseConfigured()) {
        logSyncDebug('init:configNotFilledIn', {});
        return;
    }
    try {
        firebase.initializeApp(FIREBASE_CONFIG);
        firestoreDb = firebase.firestore();
        auth = firebase.auth();
        firebaseSyncEnabled = true;
        
        initAuthUI();
        logSyncDebug('init:success', {});
    } catch (err) {
        console.error('[HHS SYNC] Firebase init failed:', err);
    }
}

// Turns Firebase Auth error codes into plain-English messages instead of
// the raw "Firebase: Error (auth/email-already-in-use)." string.
function friendlyAuthErrorMessage(err) {
    const code = err?.code || '';
    switch (code) {
        case 'auth/email-already-in-use':
            return 'That email is already registered. Try logging in instead, or use "Forgot password" if needed.';
        case 'auth/invalid-email':
            return 'That email address doesn\'t look valid. Double-check it and try again.';
        case 'auth/weak-password':
            return 'That password is too weak — Firebase requires at least 6 characters.';
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return 'Incorrect email or password.';
        case 'auth/user-not-found':
            return 'No account found with that email.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please wait a moment and try again.';
        case 'auth/network-request-failed':
            return 'Network error — check your connection and try again.';
        default:
            return err?.message || 'An unknown error occurred.';
    }
}

// Sets up the Authentication listeners and wires up the UI
function initAuthUI() {
    // Get your DOM elements
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-container');
    const loginError = document.getElementById('login-error');
    const loginButton = document.getElementById('login-button');
    const registerButton = document.getElementById('register-button');
    const logoutButton = document.getElementById('logout-button');
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    
    // New Forgot Password Button
    const forgotPasswordButton = document.getElementById('forgot-password-button');

    // 1. Watch the user's login state
    let protocolDataLoaded = false;
    let remoteListenerUnsubscribe = null;
    let roleFetchedThisSession = false;
    let historyFetchedThisSession = false;
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            // Defense-in-depth: the login/register buttons already block
            // non-@hhsc.ca attempts, but that's client-side and bypassable
            // (e.g. calling the Firebase SDK directly from devtools), and
            // this also catches any account that existed before this
            // restriction was added. Firestore rules are the real backstop
            // for data access either way, but there's no reason to leave
            // someone sitting in a signed-in state they shouldn't have.
            if (!isAllowedDomain(user.email)) {
                console.warn('[HHS AUTH] Signing out non-allowed-domain account:', user.email);
                await auth.signOut();
                const message = `Only @${ALLOWED_EMAIL_DOMAIN} accounts are allowed. You've been signed out.`;
                if (loginError) {
                    loginError.innerText = message;
                    loginError.style.display = 'block';
                }
                window.showToast?.(message, { duration: 8000 });
                return;
            }

            // The domain check above only confirms the email address is
            // *shaped* like @hhsc.ca — it doesn't confirm the person
            // actually controls that mailbox (they could type any string
            // ending in @hhsc.ca at registration and Firebase would accept
            // it; it never actually contacts hhsc.ca's mail server). This
            // is what email verification is for: don't let them past this
            // point — and don't let Firestore rules let them read/write
            // anything (see request.auth.token.email_verified in
            // firestore.rules) — until they've clicked the link Firebase
            // emailed them. Deliberately does NOT sign them out here, since
            // that would also invalidate the ability to call
            // sendEmailVerification()/reload() on this same user object.
            if (!user.emailVerified) {
                console.warn('[HHS AUTH] Email not yet verified, blocking app access:', user.email);
                showVerifyEmailNotice(user.email);
                return;
            }
            hideVerifyEmailNotice();

            if (loginContainer) loginContainer.style.display = 'none';
            if (appContainer) appContainer.style.display = 'block';

            if (typeof initEncryptionKey === 'function') {
                await initEncryptionKey(user.uid);
            }


            // Guarded the same way as protocolDataLoaded below — a token
            // refresh or tab-focus re-check can refire onAuthStateChanged
            // without an actual sign-in/out happening, and this doesn't
            // need to re-run every time that does. Doesn't affect the
            // explicit fetchUserRole() re-checks elsewhere (e.g. after
            // changing your own role in Manage Access) — those call it
            // directly, bypassing this guard entirely.
            if (!roleFetchedThisSession && typeof fetchUserRole === 'function') {
                roleFetchedThisSession = true;
                await fetchUserRole();
            }

            // Only now — with a confirmed authenticated user — pull the
            // protocol data in and render it. Guarded so a token refresh
            // or tab-focus re-check doesn't re-fetch/re-render every time.
            if (!protocolDataLoaded && typeof loadProtocolData === 'function') {
                protocolDataLoaded = true;
                loadProtocolData().catch(err => {
                    console.error('Failed to load protocol data after login:', err);
                    protocolDataLoaded = false;
                });
            }

            if (!remoteListenerUnsubscribe && typeof listenForRemoteUpdates === 'function') {
                remoteListenerUnsubscribe = listenForRemoteUpdates();
            }

            // One-shot GET of recent change history, so it's ready to show
            // instantly if the person opens the History panel instead of
            // fetching on first click. Same re-fire guard as above — this
            // is billed per document returned (up to MAX_HISTORY_ENTRIES),
            // not per query, so an unguarded re-run on every token refresh
            // would have been a real, avoidable read cost.
            if (!historyFetchedThisSession && typeof fetchRecentHistory === 'function') {
                historyFetchedThisSession = true;
                fetchRecentHistory().catch(err => {
                    console.error('Failed to fetch change history after login:', err);
                    historyFetchedThisSession = false;
                });
            }
        } else {
            if (loginContainer) loginContainer.style.display = 'block';
            if (appContainer) appContainer.style.display = 'none';
            hideVerifyEmailNotice();

            // Logged out (or never logged in) — make sure nothing sensitive
            // is left sitting in memory, rendered in the DOM, still
            // streaming in over an open Firestore listener, or decryptable
            // via a lingering in-memory key.
            if (remoteListenerUnsubscribe) {
                remoteListenerUnsubscribe();
                remoteListenerUnsubscribe = null;
            }
            if (typeof clearEncryptionKey === 'function') clearEncryptionKey();
            currentUserRole = null;
            roleFetchedThisSession = false;
            historyFetchedThisSession = false;
            document.body.classList.remove('view-only-mode');
            document.getElementById('hhsViewOnlyBanner')?.remove();
            cachedHistoryEntries = null;
            if (protocolDataLoaded) {
                protocolDataLoaded = false;
                if (typeof QUESTIONS_CONFIG !== 'undefined') QUESTIONS_CONFIG = [];
                if (typeof buildWorkflowUI === 'function') buildWorkflowUI();
            }
        }
    });

    // Only @hhsc.ca accounts are allowed to use this app. This is a
    // convenience check, not real security — the actual enforcement lives
    // in the Firestore rules (isHhscEmail() there), since anyone can bypass
    // this by calling the Firebase SDK directly from devtools. This just
    // gives a friendly error instead of a confusing Firestore permission
    // error, and stops the attempt before it even reaches Firebase.
    // Toggles between the normal login form and the "please verify your
    // email" notice. Kept as simple show/hide of two sibling containers
    // rather than removing/recreating anything, so it's cheap to call from
    // onAuthStateChanged on every auth check.
    const loginFormFields = document.getElementById('loginFormFields');
    const verifyEmailNotice = document.getElementById('verifyEmailNotice');
    const verifyEmailMessage = document.getElementById('verifyEmailMessage');
    function showVerifyEmailNotice(email) {
        if (loginFormFields) loginFormFields.classList.add('hidden');
        if (verifyEmailNotice) verifyEmailNotice.classList.remove('hidden');
        if (verifyEmailMessage) verifyEmailMessage.textContent = `We sent a confirmation link to ${email}. Click it, then come back and press "I've Verified".`;
        if (loginContainer) loginContainer.style.display = 'block';
        if (appContainer) appContainer.style.display = 'none';
    }
    function hideVerifyEmailNotice() {
        if (loginFormFields) loginFormFields.classList.remove('hidden');
        if (verifyEmailNotice) verifyEmailNotice.classList.add('hidden');
    }

    document.getElementById('resendVerificationBtn')?.addEventListener('click', async () => {
        if (!auth.currentUser) return;
        try {
            await auth.currentUser.sendEmailVerification();
            window.showToast?.(`Verification email resent to ${auth.currentUser.email}.`, { duration: 5000 });
        } catch (err) {
            window.showToast?.('Could not resend right now — ' + friendlyAuthErrorMessage(err), { duration: 6000 });
        }
    });

    document.getElementById('refreshVerificationBtn')?.addEventListener('click', async () => {
        if (!auth.currentUser) return;
        try {
            // emailVerified on the cached user object doesn't update just
            // because the link was clicked in another tab — reload() pulls
            // the current state from Firebase, then we re-run the same
            // check onAuthStateChanged does.
            await auth.currentUser.reload();
            if (auth.currentUser.emailVerified) {
                window.location.reload(); // cleanest way to re-run the full onAuthStateChanged flow from scratch
            } else {
                window.showToast?.("Still not verified yet — check your inbox (and spam folder) for the link.", { duration: 6000 });
            }
        } catch (err) {
            window.showToast?.('Could not check verification status — ' + friendlyAuthErrorMessage(err), { duration: 6000 });
        }
    });

    document.getElementById('signOutUnverifiedBtn')?.addEventListener('click', async () => {
        await auth.signOut();
    });

    // 2. Existing Login Logic
    if (loginButton) {
        loginButton.addEventListener('click', () => {
            const email = emailInput?.value?.trim();
            const password = passwordInput?.value;
            
            // Reset message styles
            if (loginError) {
                loginError.style.display = 'none';
                loginError.style.color = '#dc2626'; 
            }

            if (!isAllowedDomain(email)) {
                const message = `Login Error: only @${ALLOWED_EMAIL_DOMAIN} email addresses can log in.`;
                if (loginError) {
                    loginError.innerText = message;
                    loginError.style.display = 'block';
                }
                window.showToast?.(message, { duration: 6000 });
                return;
            }

            auth.signInWithEmailAndPassword(email, password).catch(err => {
                const message = "Login Error: " + friendlyAuthErrorMessage(err);
                if (loginError) {
                    loginError.innerText = message;
                    loginError.style.display = 'block';
                }
                window.showToast?.(message, { duration: 6000 });
            });
        });
    }

    // 3. Registration Logic
    if (registerButton) {
        registerButton.addEventListener('click', () => {
            const email = emailInput?.value?.trim();
            const password = passwordInput?.value;
            
            if (loginError) {
                loginError.style.display = 'none';
                loginError.style.color = '#dc2626'; 
            }

            if (!isAllowedDomain(email)) {
                const message = `Registration Error: only @${ALLOWED_EMAIL_DOMAIN} email addresses can create an account.`;
                if (loginError) {
                    loginError.innerText = message;
                    loginError.style.display = 'block';
                }
                window.showToast?.(message, { duration: 6000 });
                return;
            }

            auth.createUserWithEmailAndPassword(email, password)
                .then(async (userCredential) => {
                    logSyncDebug('auth:userRegistered', { email });
                    try {
                        await userCredential.user.sendEmailVerification();
                    } catch (err) {
                        console.error('[HHS AUTH] Failed to send verification email:', err);
                    }
                    // onAuthStateChanged fires from the account creation
                    // itself and will show the verify-email notice since
                    // emailVerified is false on a brand new account — no
                    // need to duplicate that here.
                })
                .catch(err => {
                    const message = "Registration Error: " + friendlyAuthErrorMessage(err);
                    if (loginError) {
                        loginError.innerText = message;
                        loginError.style.display = 'block';
                    }
                    window.showToast?.(message, { duration: 6000 });
                });
        });
    }

    // 4. NEW Forgot Password Logic
    if (forgotPasswordButton) {
        forgotPasswordButton.addEventListener('click', () => {
            const email = emailInput?.value?.trim();
            
            if (!email) {
                if (loginError) {
                    loginError.innerText = "Please enter your email address above to reset your password.";
                    loginError.style.color = '#dc2626';
                    loginError.style.display = 'block';
                }
                return;
            }

            auth.sendPasswordResetEmail(email)
                .then(() => {
                    if (loginError) {
                        loginError.innerText = "Password reset email sent! Check your inbox.";
                        loginError.style.color = '#16a34a'; // Success green
                        loginError.style.display = 'block';
                    }
                })
                .catch(err => {
                    const message = "Reset Error: " + friendlyAuthErrorMessage(err);
                    if (loginError) {
                        loginError.innerText = message;
                        loginError.style.color = '#dc2626';
                        loginError.style.display = 'block';
                    }
                    window.showToast?.(message, { duration: 6000 });
                });
        });
    }

    // 5. Logout Logi
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            auth.signOut();
        });
    }
}
// Live listener — fires immediately with whatever's currently in Firestore,
// then again every time ANY device (including this one) writes to it.
// Returns the unsubscribe function so the caller can detach it on logout.
// ------------------------------------------------------------------
// Offline mode — Firestore signals a spent daily quota with a specific
// error code ('resource-exhausted'), so this is detected precisely
// rather than treating every failure the same way. When it happens: the
// live listener falls back to whatever's cached in localStorage so the
// app still shows something, writes still save locally (they already did
// before this even existed — see commitDatabaseChangesToDisk), and a
// banner makes it obvious why things aren't syncing live right now.
// Self-heals: the next successful push or listener update clears it, and
// the listener also retries itself periodically since a quota error
// terminates that specific subscription rather than leaving it retrying
// in the background on its own.
// ------------------------------------------------------------------
function isQuotaExceededError(err) {
    return err?.code === 'resource-exhausted';
}

let offlineModeActive = false;
function showOfflineModeBanner() {
    offlineModeActive = true;
    if (document.getElementById('hhsOfflineBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'hhsOfflineBanner';
    banner.style.cssText = 'background:#ffedd5; color:#9a3412; padding:8px 16px; font-size:13px; font-weight:600; text-align:center; border-bottom:1px solid #fdba74;';
    banner.textContent = "📡 Offline Mode — today's cloud sync limit has been reached. Your changes are still saved on this device and will sync automatically once the limit resets.";
    const appContainer = document.getElementById('app-container');
    appContainer?.insertBefore(banner, appContainer.firstChild);
}
function hideOfflineModeBanner() {
    if (!offlineModeActive) return;
    offlineModeActive = false;
    document.getElementById('hhsOfflineBanner')?.remove();
}

let offlineRetryTimer = null;
const OFFLINE_RETRY_MS = 10 * 60 * 1000; // 10 min — quota resets daily, no need to hammer it more often
function scheduleOfflineListenerRetry() {
    if (offlineRetryTimer) return; // already scheduled
    offlineRetryTimer = setTimeout(() => {
        offlineRetryTimer = null;
        logSyncDebug('offline:retryingListener', {});
        listenForRemoteUpdates(); // a resource-exhausted error terminates the old subscription, so this opens a fresh one
    }, OFFLINE_RETRY_MS);
}

function listenForRemoteUpdates() {
    if (!firebaseSyncEnabled) return null;
    const docRef = firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC_ID);
    let receivedFirstSnapshot = false;

    return docRef.onSnapshot(async (snapshot) => {
        // Skip our own optimistic local write echoing straight back — it's
        // not a real remote change, and doPush() already updated our local
        // state/timestamp synchronously when the write succeeded. Only
        // process snapshots that are actually confirmed by the server.
        if (snapshot.metadata.hasPendingWrites) {
            logSyncDebug('listener:skippedLocalPendingEcho', {});
            return;
        }

        if (!snapshot.exists) {
            logSyncDebug('listener:noDocumentYet', {});
            return;
        }
        const remote = snapshot.data();
        if (!remote || !Array.isArray(remote.steps)) return;

        const remoteUpdatedAt = remote.updatedAt || 0;
        const localUpdatedAt = parseInt(localStorage.getItem('hhsLastSavedAt') || '0', 10) || 0;

        // The very first snapshot after (re)establishing this listener
        // always applies, regardless of the staleness check below. That
        // check exists to avoid clobbering a fresher in-memory edit with
        // an older remote value — but on the first snapshot there IS no
        // in-memory data yet (QUESTIONS_CONFIG starts as [] on every page
        // load). hhsLastSavedAt can easily be newer than a stale-looking
        // remote timestamp just because nothing's changed since a
        // previous session, which was skipping this load entirely and
        // leaving the app with no data despite Firestore having it all
        // along — the actual bug behind "data never populates after
        // login."
        const isFirstSnapshot = !receivedFirstSnapshot;
        receivedFirstSnapshot = true;

        if (!isFirstSnapshot && remoteUpdatedAt <= localUpdatedAt) {
            logSyncDebug('listener:skippedStale', { remoteUpdatedAt, localUpdatedAt });
            return;
        }

        // Don't yank the rug out from under someone mid-edit in the editor.
        const creatorView = document.getElementById('creatorView');
        if (creatorView && !creatorView.classList.contains('hidden')) {
            window.alert?.('Heads up: newer protocol data was just synced from another device. Finish or cancel your current edit, then reload to see it.');
            return;
        }

        applyingRemoteUpdate = true;
        QUESTIONS_CONFIG = remote.steps;
        const remoteDataString = JSON.stringify(QUESTIONS_CONFIG, null, 2);
        try {
            const toStore = remoteDataString;
            localStorage.setItem('hhsQuestionsConfig', toStore);
        } catch (e) {}
        localStorage.setItem('hhsLastSavedAt', String(remoteUpdatedAt));
        lastPushedDataString = remoteDataString; // this is now the known cloud state — no need to re-push it
        lastKnownRemoteTimestamp = remoteUpdatedAt;
        if (typeof buildWorkflowUI === 'function') buildWorkflowUI();
        logSyncDebug('listener:appliedRemoteUpdate', { stepCount: QUESTIONS_CONFIG.length });
        applyingRemoteUpdate = false;
        hideOfflineModeBanner();
    }, async (err) => {
        console.error('[HHS SYNC] Listener error:', err);
        if (isQuotaExceededError(err)) {
            // The listener itself is dead now (a resource-exhausted error
            // terminates the subscription) — fall back to whatever's
            // cached locally so the app still shows something, rather
            // than just sitting there with stale or no data.
            try {
                const cachedRaw = localStorage.getItem('hhsQuestionsConfig');
                if (cachedRaw) {
                    const cachedPlain = typeof decryptFromStorage === 'function' ? await decryptFromStorage(cachedRaw) : cachedRaw;
                    if (cachedPlain) {
                        QUESTIONS_CONFIG = JSON.parse(cachedPlain);
                        if (typeof buildWorkflowUI === 'function') buildWorkflowUI();
                    }
                }
            } catch (e) {
                console.error('[HHS SYNC] Could not load local cache during offline fallback:', e);
            }
            showOfflineModeBanner();
            scheduleOfflineListenerRetry();
        }
    });
}

// ------------------------------------------------------------------
// Change history — "who changed what, when". Now inherently tied to 
// the authenticated user's email address.
// ------------------------------------------------------------------

// Best-effort description of what changed, used when a call site doesn't
// pass an explicit changeDescription. Step numbers get renumbered on
// almost every mutation, so this compares by title/count rather than by
// step index to stay meaningful across adds/deletes/reorders.
function summarizeChange(oldSteps, newSteps) {
    const oldTitles = oldSteps.map(s => s.title || '(untitled)');
    const newTitles = newSteps.map(s => s.title || '(untitled)');

    if (oldSteps.length === 0 && newSteps.length > 0) {
        return `Loaded initial protocol (${newSteps.length} step${newSteps.length === 1 ? '' : 's'})`;
    }

    if (newSteps.length > oldSteps.length) {
        const diff = newSteps.length - oldSteps.length;
        const oldSet = new Set(oldTitles);
        const added = newTitles.filter(t => !oldSet.has(t));
        if (added.length > 0) return `Added step${diff === 1 ? '' : 's'}: ${added.slice(0, 3).join(', ')}${added.length > 3 ? '…' : ''}`;
        return `Added ${diff} step${diff === 1 ? '' : 's'}`;
    }

    if (newSteps.length < oldSteps.length) {
        const diff = oldSteps.length - newSteps.length;
        const newSet = new Set(newTitles);
        const removed = oldTitles.filter(t => !newSet.has(t));
        if (removed.length > 0) return `Deleted step${diff === 1 ? '' : 's'}: ${removed.slice(0, 3).join(', ')}${removed.length > 3 ? '…' : ''}`;
        return `Deleted ${diff} step${diff === 1 ? '' : 's'}`;
    }

    // Same count — either an edit, or a pure reorder.
    const sameOrder = oldTitles.every((t, i) => t === newTitles[i]);
    if (sameOrder) return 'Edited step content';

    const sameSetDifferentOrder = [...oldTitles].sort().join('|') === [...newTitles].sort().join('|');
    if (sameSetDifferentOrder) return 'Reordered steps';

    return 'Edited step details';
}

// Best-effort diff for the common case: someone opened a single step,
// changed something about it, and saved. In that case every step number
// is unchanged between old and new, so matching by step number is
// reliable. Add/delete/reorder operations renumber steps (see
// renumberFromArrayOrder in workflow-ui.js), which makes a step-number
// match meaningless there — those already get a clear one-line summary
// from summarizeChange() above, so this intentionally returns nothing for
// them rather than guessing at a fragile match.
//
// Covers title, prompt, the "No" branch target, and trial-option-level
// changes (added/removed trials, plus contact/description/criteria/PDF-
// count changes within a matched trial, matched by name since trials
// don't have a stable ID of their own). All of this is computed purely
// from oldSteps/newSteps, which are already fully in memory by the time
// this runs (previousDataString comes from localStorage, not a fresh
// fetch) — no additional Firestore reads either way.
function computeStepDiffs(oldSteps, newSteps) {
    const oldByStep = new Map(oldSteps.map(s => [s.step, s]));
    const newByStep = new Map(newSteps.map(s => [s.step, s]));
    if (oldByStep.size !== newByStep.size) return [];
    for (const step of oldByStep.keys()) {
        if (!newByStep.has(step)) return []; // step numbers shifted — not a simple edit
    }

    const diffs = [];
    for (const [step, oldStep] of oldByStep) {
        const newStep = newByStep.get(step);

        if (oldStep.title !== newStep.title) {
            diffs.push({ step, field: 'Title', before: oldStep.title || '', after: newStep.title || '' });
        }
        if (oldStep.prompt !== newStep.prompt) {
            diffs.push({ step, field: 'Prompt', before: oldStep.prompt || '', after: newStep.prompt || '' });
        }
        const oldBranch = oldStep.ifNoGoToStep ?? null;
        const newBranch = newStep.ifNoGoToStep ?? null;
        if (oldBranch !== newBranch) {
            diffs.push({
                step,
                field: '"No" branch target',
                before: oldBranch != null ? `Step ${oldBranch}` : '(end of protocol)',
                after: newBranch != null ? `Step ${newBranch}` : '(end of protocol)'
            });
        }

        // Trial options within this step — matched by name across
        // old/new since they don't carry a stable ID.
        const oldTrials = Array.isArray(oldStep.trials) ? oldStep.trials : [];
        const newTrials = Array.isArray(newStep.trials) ? newStep.trials : [];
        const oldTrialsByName = new Map(oldTrials.map(t => [t.name, t]));
        const newTrialsByName = new Map(newTrials.map(t => [t.name, t]));

        for (const name of oldTrialsByName.keys()) {
            if (!newTrialsByName.has(name)) {
                diffs.push({ step, field: 'Trial removed', before: name, after: '(removed)' });
            }
        }
        for (const name of newTrialsByName.keys()) {
            if (!oldTrialsByName.has(name)) {
                diffs.push({ step, field: 'Trial added', before: '(none)', after: name });
            }
        }
        for (const [name, oldTrial] of oldTrialsByName) {
            const newTrial = newTrialsByName.get(name);
            if (!newTrial) continue; // already recorded as removed above

            if ((oldTrial.contact || '') !== (newTrial.contact || '')) {
                diffs.push({ step, field: `${name} — Contact`, before: oldTrial.contact || '(none)', after: newTrial.contact || '(none)' });
            }
            if ((oldTrial.desc || '') !== (newTrial.desc || '')) {
                diffs.push({ step, field: `${name} — Description`, before: oldTrial.desc || '(none)', after: newTrial.desc || '(none)' });
            }

            const oldCriteria = Array.isArray(oldTrial.criteria) ? oldTrial.criteria : [];
            const newCriteria = Array.isArray(newTrial.criteria) ? newTrial.criteria : [];
            if (JSON.stringify(oldCriteria) !== JSON.stringify(newCriteria)) {
                diffs.push({
                    step,
                    field: `${name} — Inclusion criteria`,
                    before: oldCriteria.length > 0 ? oldCriteria.join('; ') : '(none)',
                    after: newCriteria.length > 0 ? newCriteria.join('; ') : '(none)'
                });
            }

            const oldPdfCount = Array.isArray(oldTrial.pdfFiles) ? oldTrial.pdfFiles.length : (oldTrial.pdfData ? 1 : 0);
            const newPdfCount = Array.isArray(newTrial.pdfFiles) ? newTrial.pdfFiles.length : (newTrial.pdfData ? 1 : 0);
            if (oldPdfCount !== newPdfCount) {
                diffs.push({
                    step,
                    field: `${name} — Attached PDFs`,
                    before: `${oldPdfCount} file${oldPdfCount === 1 ? '' : 's'}`,
                    after: `${newPdfCount} file${newPdfCount === 1 ? '' : 's'}`
                });
            }
        }
    }
    return diffs;
}

// Fire-and-forget — never blocks or fails the main save if this has
// trouble. opts.changeDescription lets call sites that know exactly what
// happened (delete, duplicate, move, import, restore backup) provide an
// exact label instead of relying on the heuristic diff above.
async function logChangeHistory(newDataString, opts = {}) {
    if (!firebaseSyncEnabled || !auth.currentUser) return;
    try {
        const oldSteps = opts.previousDataString ? JSON.parse(opts.previousDataString) : [];
        const newSteps = JSON.parse(newDataString);

        let summary = opts.changeDescription;
        if (!summary) {
            summary = summarizeChange(oldSteps, newSteps);
        }

        const entry = { timestamp: Date.now(), author: auth.currentUser.email, summary };
        const diffs = computeStepDiffs(oldSteps, newSteps);
        if (diffs.length > 0) entry.diffs = diffs;

        await firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC_ID)
            .collection('history').add(entry);

        cachedHistoryEntries = null; // stale now — next open (or the pre-fetch above) will re-GET it

        // Pruning doesn't need to happen after every single save — a
        // handful of extra entries sitting around briefly is harmless.
        // Only actually check every few saves to cut down on reads.
        saveCountSincePrune++;
        if (saveCountSincePrune >= PRUNE_CHECK_INTERVAL) {
            saveCountSincePrune = 0;
            pruneOldHistoryEntries(); // best-effort, doesn't need to be awaited
        }
    } catch (err) {
        console.error('[HHS SYNC] Failed to log change history (main save still succeeded):', err);
    }
}

// Runs roughly every PRUNE_CHECK_INTERVAL saves, not every save (see
// logChangeHistory above) — cuts the read volume from this alone by
// ~5x on top of the bound below.
let saveCountSincePrune = 0;
const PRUNE_CHECK_INTERVAL = 5;

// Reads only MAX_HISTORY_ENTRIES + 1 docs — just enough to know whether
// there's anything to prune — instead of the previous version, which read
// the ENTIRE history subcollection on every save. That was the single
// biggest source of read volume in the app: a protocol with, say, 500
// history entries was burning 500 reads on every single save, forever,
// just to check whether it needed to delete a handful of old ones.
async function pruneOldHistoryEntries() {
    try {
        const historyRef = firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC_ID).collection('history');
        const snapshot = await historyRef.orderBy('timestamp', 'desc').limit(MAX_HISTORY_ENTRIES + 1).get();
        if (snapshot.size <= MAX_HISTORY_ENTRIES) return; // nothing beyond the cap — done, cheaply

        // There's at least one entry past the cap. Anything strictly
        // older than the cutoff (the last doc we keep) needs deleting —
        // fetch just that tail instead of the whole collection.
        const cutoffDoc = snapshot.docs[MAX_HISTORY_ENTRIES - 1];
        const overflowSnapshot = await historyRef.orderBy('timestamp', 'desc').startAfter(cutoffDoc).get();
        await Promise.all(overflowSnapshot.docs.map(doc => doc.ref.delete()));
        logSyncDebug('history:pruned', { removed: overflowSnapshot.size });
    } catch (err) {
        console.error('[HHS SYNC] History pruning failed (non-critical):', err);
    }
}


async function fetchRecentHistory() {
    if (!firebaseSyncEnabled) {
        cachedHistoryEntries = [];
        return cachedHistoryEntries;
    }
    const snapshot = await firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC_ID)
        .collection('history').orderBy('timestamp', 'desc').limit(MAX_HISTORY_ENTRIES).get();
    cachedHistoryEntries = snapshot.docs.map(doc => doc.data());
    logSyncDebug('history:fetched', { count: cachedHistoryEntries.length });
    return cachedHistoryEntries;
}

async function fetchUserRole() {
    if (!firebaseSyncEnabled || !auth.currentUser) {
        currentUserRole = 'manager'; // no roles system in play (local/dev mode) — behave as before, full access
        return currentUserRole;
    }
    try {
        const email = auth.currentUser.email.toLowerCase();
        const doc = await firestoreDb.collection(ROLES_COLLECTION).doc(email).get();
        const rawRole = doc.exists ? doc.data().role : null;
        if (rawRole === 'manager') {
            currentUserRole = 'manager';
        } else if (rawRole === 'editor' || rawRole === 'viewer') {
            currentUserRole = rawRole; // explicit role doc always wins, even if it's a deliberate downgrade to viewer
        } else {
            // No role doc at all — @hhsc.ca (or an allowed exception) gets
            // editor automatically, no manual setup needed. Persist it as
            // a real doc (allowed by isSelfBootstrapEditor() in
            // firestore.rules) so this person shows up in Manage Access
            // right away instead of only existing as an implicit
            // in-session default. Fire-and-forget: if the write fails
            // (rules not deployed yet, brief network hiccup, whatever)
            // they still get editor access for this session regardless —
            // it'll just try to persist again on their next login.
            currentUserRole = isAllowedDomain(email) ? 'editor' : 'viewer';
            if (currentUserRole === 'editor') {
                firestoreDb.collection(ROLES_COLLECTION).doc(email).set({ role: 'editor' })
                    .then(() => logSyncDebug('role:bootstrapped', { email }))
                    .catch(err => console.warn('[HHS SYNC] Could not persist auto-editor role doc (will retry next login):', err));
            }
        }
        localStorage.setItem('hhsLastKnownRole', currentUserRole); // cache for the offline fallback below
    } catch (err) {
        console.error('[HHS SYNC] Failed to fetch role:', err);
        if (isQuotaExceededError(err)) {
            // Don't punitively demote a real editor/manager to viewer just
            // because Firestore couldn't be reached right now — fall back
            // to whatever role was last successfully confirmed for them.
            // Fails closed to viewer only if there's nothing cached at all.
            const cachedRole = localStorage.getItem('hhsLastKnownRole');
            currentUserRole = (cachedRole === 'manager' || cachedRole === 'editor' || cachedRole === 'viewer') ? cachedRole : 'viewer';
            showOfflineModeBanner();
            window.showToast?.("Couldn't verify your access level right now (today's cloud sync limit reached) — using your last known permissions.", { duration: 8000 });
        } else {
            currentUserRole = 'viewer'; // fail closed, not open, for any other kind of failure
        }
    }
    logSyncDebug('role:fetched', { role: currentUserRole });
    applyRoleToUI();
    return currentUserRole;
}

function canEdit() {
    return currentUserRole === 'editor' || currentUserRole === 'manager';
}

// Only managers can change access levels — add, promote/demote, or remove
// entries in the userRoles collection. Editors can edit protocol content
// but must not be able to grant themselves (or anyone else) more access.
function canManageAccess() {
    return currentUserRole === 'manager' || currentUserRole === 'editor';
}

// Toggles the CSS hooks that hide edit-only controls (Add Step, the
// per-step edit/duplicate/delete/reorder icons, Manage Mode, Import,
// Restore Backup — see the .view-only-mode rules in style.css) and
// shows/removes a small banner so it's obvious why those controls are
// missing, rather than the page just looking half-broken.
function applyRoleToUI() {
    const isViewOnly = currentUserRole === 'viewer';
    document.body.classList.toggle('view-only-mode', isViewOnly);

    // Access Manager is manager-only — inject or remove it here so it stays
    // in sync if someone's role changes while they're already mid-session.
    if (currentUserRole === 'manager' || currentUserRole === 'editor') {
        injectAccessManagerButton();
    } else {
        document.getElementById('hhsAccessManagerBtn')?.remove();
    }

    let banner = document.getElementById('hhsViewOnlyBanner');
    if (isViewOnly) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'hhsViewOnlyBanner';
            banner.style.cssText = 'background:#fef3c7; color:#92400e; padding:8px 16px; font-size:13px; font-weight:600; text-align:center; border-bottom:1px solid #fde68a;';
            banner.textContent = '👁️ View-only access — you can browse the protocol but can\'t make changes.';
            const appContainer = document.getElementById('app-container');
            appContainer?.insertBefore(banner, appContainer.firstChild);
        }
    } else {
        banner?.remove();
    }
}

function injectAccessManagerButton() {
    if (!canManageAccess()) return; // only managers get this control
    if (document.getElementById('hhsAccessManagerBtn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hhsAccessManagerBtn';
    btn.className = 'ctrl-btn';
    btn.style.background = '#5d82ed';
    btn.style.color = '#ffffff';
    if (typeof setSideBtnContent === 'function') {
        setSideBtnContent(btn, '<img src="images/user-lock-alt-1-svgrepo-com.svg" alt="Manage Access">', 'Manage Access');
    } else {
        btn.textContent = '👥 Manage Access';
    }
    btn.addEventListener('click', showAccessManagerModal);

    if (typeof insertIntoSidebarOrHeader === 'function') {
        insertIntoSidebarOrHeader(btn);
    } else {
        document.querySelector('.header-controls')?.appendChild(btn);
    }
}

async function showAccessManagerModal() {
    if (!canManageAccess()) {
        window.showToast?.('Only managers can change access levels.', { duration: 5000 });
        return;
    }
    document.getElementById('hhsAccessModal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hhsAccessModal';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:99999; padding:20px; box-sizing:border-box;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#ffffff; border-radius:8px; padding:24px; width:520px; max-width:100%; max-height:85vh; overflow:hidden; display:flex; flex-direction:column; font-family:system-ui, -apple-system, sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.35);';
    box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <h3 style="margin:0; font-size:16px; color:#1e293b;">Manage access</h3>
            <button type="button" id="hhsAccessClose" style="background:#e2e8f0; color:#334155; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:13px;">Close</button>
        </div>
        <p style="margin:0 0 14px; font-size:12px; color:#64748b;">
            Managers can change anyone's access level, including granting or removing manager access. Editors can change protocol data; viewers can browse but not edit. Adding someone here does <strong>not</strong> let them log in — they still need to be in your login allowlist separately.
        </p>
        <div style="display:flex; gap:8px; margin-bottom:16px;">
            <input type="email" id="hhsNewAccessEmail" placeholder="person@example.com" style="flex:1; padding:8px 10px; border:1px solid #cbd5e1; border-radius:4px; font-size:13px;">
            <select id="hhsNewAccessRole" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:4px; font-size:13px;">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="manager">Manager</option>
            </select>
            <button type="button" id="hhsNewAccessAdd" style="background:#0284c7; color:#fff; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600;">Add</button>
        </div>
        <div id="hhsAccessList" style="font-size:13px; color:#94a3b8; max-height:min(52vh, 420px); overflow-y:auto; overscroll-behavior:contain; padding-right:6px; -webkit-overflow-scrolling:touch;">Loading…</div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('hhsAccessClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    document.getElementById('hhsNewAccessAdd').addEventListener('click', addAccessEntry);

    await renderAccessList();
}

async function renderAccessList() {
    const listEl = document.getElementById('hhsAccessList');
    if (!listEl) return;

    if (!firebaseSyncEnabled) {
        listEl.innerHTML = '<p style="font-style:italic;">Cloud sync isn\'t configured.</p>';
        return;
    }

    try {
        const snapshot = await firestoreDb.collection(ROLES_COLLECTION).get();
        if (snapshot.empty) {
            listEl.innerHTML = '<p style="font-style:italic;">No one has an explicit role yet — everyone defaults to view-only.</p>';
            return;
        }

        const currentEmail = auth.currentUser ? auth.currentUser.email.toLowerCase() : null;
        listEl.innerHTML = snapshot.docs.map(doc => {
            const email = doc.id;
            const rawRole = doc.data().role;
            const role = rawRole === 'manager' ? 'manager' : rawRole === 'editor' ? 'editor' : 'viewer';
            const isSelf = email === currentEmail;
            return `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid #e2e8f0;">
                    <span style="color:#0f172a; overflow-wrap:anywhere;">${email}${isSelf ? ' <em style="color:#64748b;">(you)</em>' : ''}</span>
                    <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                        <select data-email="${email}" class="hhsAccessRoleSelect" style="padding:4px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
                            <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Viewer</option>
                            <option value="editor" ${role === 'editor' ? 'selected' : ''}>Editor</option>
                            <option value="manager" ${role === 'manager' ? 'selected' : ''}>Manager</option>
                        </select>
                        <button type="button" data-email="${email}" class="hhsAccessRemoveBtn" style="background:#fee2e2; color:#dc2626; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:12px;">Remove</button>
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.hhsAccessRoleSelect').forEach(sel => {
            sel.addEventListener('change', (e) => updateAccessRole(e.target.dataset.email, e.target.value));
        });
        listEl.querySelectorAll('.hhsAccessRemoveBtn').forEach(btn => {
            btn.addEventListener('click', (e) => removeAccessEntry(e.target.dataset.email));
        });
    } catch (err) {
        console.error('[HHS SYNC] Failed to load access list:', err);
        listEl.innerHTML = '<p style="color:#dc2626;">Couldn\'t load the access list — check that your Firestore rules let managers read the whole userRoles collection (see the comment above injectAccessManagerButton in firebase-sync.js).</p>';
    }
}

async function addAccessEntry() {
    if (!canManageAccess()) {
        window.showToast?.('Only managers can change access levels.', { duration: 5000 });
        return;
    }
    const emailInput = document.getElementById('hhsNewAccessEmail');
    const roleSelect = document.getElementById('hhsNewAccessRole');
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !email.includes('@')) {
        window.showToast?.('Enter a valid email address.', { duration: 4000 });
        return;
    }
    try {
        await firestoreDb.collection(ROLES_COLLECTION).doc(email).set({ role: roleSelect.value });
        emailInput.value = '';
        await renderAccessList();
        window.showToast?.(`${email} added as ${roleSelect.value}.`, { duration: 4000 });
    } catch (err) {
        console.error('[HHS SYNC] Failed to add access entry:', err);
        window.showToast?.('Failed to save — check your Firestore rules allow this.', { duration: 5000 });
    }
}

async function updateAccessRole(email, role) {
    if (!canManageAccess()) {
        window.showToast?.('Only managers can change access levels.', { duration: 5000 });
        await renderAccessList();
        return;
    }
    const isSelf = auth.currentUser && auth.currentUser.email.toLowerCase() === email;
    if (isSelf && role !== 'manager') {
        const confirmed = confirm("This is your own account — switching away from manager will remove your ability to manage access (and edit access, if you also drop below editor) immediately. Continue?");
        if (!confirmed) { await renderAccessList(); return; }
    } else if (isSelf && role === 'viewer') {
        const confirmed = confirm("This is your own account — switching yourself to viewer will remove your own edit access immediately. Continue?");
        if (!confirmed) { await renderAccessList(); return; }
    }
    try {
        await firestoreDb.collection(ROLES_COLLECTION).doc(email).set({ role }, { merge: true });
        window.showToast?.(`${email} is now ${role}.`, { duration: 4000 });
        if (isSelf) await fetchUserRole(); // re-check our own permissions immediately
    } catch (err) {
        console.error('[HHS SYNC] Failed to update role:', err);
        window.showToast?.('Failed to update role.', { duration: 5000 });
        await renderAccessList(); // revert the dropdown to reflect actual state
    }
}

async function removeAccessEntry(email) {
    if (!canManageAccess()) {
        window.showToast?.('Only managers can change access levels.', { duration: 5000 });
        await renderAccessList();
        return;
    }
    const isSelf = auth.currentUser && auth.currentUser.email.toLowerCase() === email;
    if (isSelf) {
        const confirmed = confirm("This is your own account — removing it will make you view-only (no role doc = viewer by default). Continue?");
        if (!confirmed) return;
    }
    try {
        await firestoreDb.collection(ROLES_COLLECTION).doc(email).delete();
        await renderAccessList();
        window.showToast?.(`${email} removed — they'll default to view-only.`, { duration: 4000 });
        if (isSelf) await fetchUserRole();
    } catch (err) {
        console.error('[HHS SYNC] Failed to remove access entry:', err);
        window.showToast?.('Failed to remove.', { duration: 5000 });
    }
}

function injectHistoryButton() {
    if (document.getElementById('hhsHistoryBtn')) return;
    const controls = document.querySelector('.header-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hhsHistoryBtn';
    btn.className = 'ctrl-btn';
    btn.style.background = '#5d82ed';
    btn.style.color = '#ffffff';
    if (typeof setSideBtnContent === 'function') {
        setSideBtnContent(btn, '<img src="images/clock-two-svgrepo-com.svg" alt="">', 'History');
    } else {
        btn.textContent = 'History';
    }
    btn.addEventListener('click', showHistoryModal);
    controls.appendChild(btn);
}

async function showHistoryModal() {
    document.getElementById('hhsHistoryModal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hhsHistoryModal';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:99999; padding:20px; box-sizing:border-box;';

    const currentEmail = auth.currentUser ? auth.currentUser.email : 'Unknown User';

    const box = document.createElement('div');
    box.style.cssText = 'background:#ffffff; border-radius:8px; padding:24px; width:480px; max-width:100%; max-height:80vh; overflow-y:auto; font-family:system-ui, -apple-system, sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.35);';
    box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <h3 style="margin:0; font-size:16px; color:#1e293b;">Change history</h3>
            <button type="button" id="hhsHistoryClose" style="background:#e2e8f0; color:#334155; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:13px;">Close</button>
        </div>
        <p style="margin:0 0 14px; font-size:12px; color:#64748b;">Logged in as <strong>${currentEmail}</strong></p>
        <div id="hhsHistoryList" style="font-size:13px; color:#94a3b8;">Loading…</div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('hhsHistoryClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });

    const listEl = document.getElementById('hhsHistoryList');
    if (!firebaseSyncEnabled) {
        listEl.innerHTML = '<p style="font-style:italic;">Cloud sync isn\'t configured, so there\'s no shared history to show.</p>';
        return;
    }

    // Already fetched once right after login — show it immediately, no
    // network round-trip needed.
    if (cachedHistoryEntries) {
        listEl.innerHTML = renderHistoryEntriesHtml(cachedHistoryEntries);
        return;
    }

    try {
        const entries = await fetchRecentHistory();
        listEl.innerHTML = renderHistoryEntriesHtml(entries);
    } catch (err) {
        console.error('[HHS SYNC] Failed to load history:', err);
        listEl.innerHTML = '<p style="color:#dc2626;">Failed to load change history.</p>';
    }
}

let lastPushedDataString = null;
let pushDebounceTimer = null;
const PUSH_DEBOUNCE_MS = 3000; 

function pushConfigToCloud(serializedData, opts = {}) {
    if (!firebaseSyncEnabled || applyingRemoteUpdate) return Promise.resolve();

    const dataString = serializedData || JSON.stringify(QUESTIONS_CONFIG, null, 2);

    if (dataString === lastPushedDataString) {
        logSyncDebug('push:skippedNoChange', {});
        if (pushDebounceTimer) { clearTimeout(pushDebounceTimer); pushDebounceTimer = null; }
        return Promise.resolve();
    }

    if (pushDebounceTimer) {
        clearTimeout(pushDebounceTimer);
        pushDebounceTimer = null;
    }

    if (opts.immediate) {
        return doPush(dataString, opts);
    }

    return new Promise((resolve) => {
        pushDebounceTimer = setTimeout(() => {
            pushDebounceTimer = null;
            doPush(dataString, opts).then(resolve);
        }, PUSH_DEBOUNCE_MS);
    });
}

function confirmOverwriteConflict(remoteTimestamp) {
    return new Promise((resolve) => {
        document.getElementById('hhsConflictModal')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'hhsConflictModal';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:100001; padding:20px; box-sizing:border-box;';

        const box = document.createElement('div');
        box.style.cssText = 'background:#ffffff; border-radius:8px; padding:24px; width:420px; max-width:100%; font-family:system-ui, -apple-system, sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.35);';
        box.innerHTML = `
            <h3 style="margin:0 0 10px; font-size:16px; color:#1e293b;">⚠️ Someone else just edited this</h3>
            <p style="margin:0 0 14px; font-size:13px; color:#475569; line-height:1.4;">Another device saved a change at ${new Date(remoteTimestamp).toLocaleTimeString()} — after you started editing here. Saving now will overwrite their change.</p>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button type="button" id="hhsConflictReload" style="background:#e2e8f0; color:#334155; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px;">Reload Latest Instead</button>
                <button type="button" id="hhsConflictOverwrite" style="background:#dc2626; color:#ffffff; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600;">Overwrite Anyway</button>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        document.getElementById('hhsConflictOverwrite').addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });
        document.getElementById('hhsConflictReload').addEventListener('click', () => {
            overlay.remove();
            resolve(false);
            window.location.reload();
        });
    });
}

async function doPush(dataString, opts = {}) {
    if (!auth.currentUser) {
        console.warn('[HHS SYNC] Sync aborted: No active user session.');
        return;
    }

    try {
        const docRef = firestoreDb.collection(FIRESTORE_COLLECTION).doc(FIRESTORE_DOC_ID);

        // Conflict check: read the current server state before overwriting.
        // If someone else wrote more recently than what we knew about
        // (e.g. their write landed while we were mid-edit here, or in the
        // gap before our own listener caught up), warn instead of silently
        // clobbering it.
        const currentSnapshot = await docRef.get();
        if (currentSnapshot.exists) {
            const currentRemote = currentSnapshot.data();
            const currentRemoteUpdatedAt = currentRemote?.updatedAt || 0;
            if (currentRemoteUpdatedAt > lastKnownRemoteTimestamp) {
                const proceed = await confirmOverwriteConflict(currentRemoteUpdatedAt);
                if (!proceed) {
                    logSyncDebug('push:cancelledByUserAfterConflict', { currentRemoteUpdatedAt, lastKnownRemoteTimestamp });
                    return;
                }
                logSyncDebug('push:userChoseOverwriteAfterConflict', {});
            }
        }

        const updatedAt = Date.now();
        await docRef.set({
            steps: JSON.parse(dataString),
            updatedAt
        });
        lastPushedDataString = dataString;
        lastKnownRemoteTimestamp = updatedAt;
        localStorage.setItem('hhsLastSavedAt', String(updatedAt));
        logSyncDebug('push:success', { stepCount: QUESTIONS_CONFIG.length });
        hideOfflineModeBanner();

        logChangeHistory(dataString, opts); // fire-and-forget, never blocks the main save
    } catch (err) {
        console.error('[HHS SYNC] Push to Firestore failed (data is still saved locally):', err);
        if (err?.code === 'permission-denied') {
            window.showToast?.('⚠️ Cloud sync blocked by Firestore rules. Ensure you are logged in and have permission to write. Your changes are still saved on this device.', { duration: 10000 });
        } else if (isQuotaExceededError(err)) {
            showOfflineModeBanner();
            window.showToast?.("⚠️ Today's cloud sync limit has been reached — this change is saved on this device and will sync automatically once the limit resets.", { duration: 10000 });
        }
    }
}
function renderHistoryEntriesHtml(entries) {
    if (!entries || entries.length === 0) {
        return '<p style="font-style:italic;">No changes logged yet.</p>';
    }
    return entries.map(entry => {
        const when = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'unknown time';
        
        // Render step title/prompt diffs if available
        let diffsHtml = '';
        if (entry.diffs && Array.isArray(entry.diffs) && entry.diffs.length > 0) {
            diffsHtml = '<div style="margin-top: 8px; display: flex; flex-direction: column; gap: 6px;">' + entry.diffs.map(d => `
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 8px; font-size: 12px;">
                    <div style="font-weight: 600; color: #334155; margin-bottom: 4px;">Step ${d.step}: ${d.field}</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                        <div style="background: #fef2f2; color: #991b1b; padding: 6px; border-radius: 3px; word-break: break-word;">
                            <span style="font-weight: 600; font-size: 10px; display: block; text-transform: uppercase; color: #b91c1c; margin-bottom: 2px;">Before</span>
                            ${escapeHtml(d.before || '(empty)')}
                        </div>
                        <div style="background: #f0fdf4; color: #166534; padding: 6px; border-radius: 3px; word-break: break-word;">
                            <span style="font-weight: 600; font-size: 10px; display: block; text-transform: uppercase; color: #15803d; margin-bottom: 2px;">After</span>
                            ${escapeHtml(d.after || '(empty)')}
                        </div>
                    </div>
                </div>
            `).join('') + '</div>';
        }

        return `
            <div style="border-bottom:1px solid #e2e8f0; padding:10px 0;">
                <div style="font-weight:600; color:#0f172a;">${escapeHtml(entry.author || 'Unknown')}</div>
                <div style="color:#334155; margin-top: 2px;">${escapeHtml(entry.summary || 'Made a change')}</div>
                ${diffsHtml}
                <div style="color:#94a3b8; font-size:11px; margin-top: 4px;">${when}</div>
            </div>
        `;
    }).join('');
}

// Simple HTML escaper helper to prevent layout issues from injected strings
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}