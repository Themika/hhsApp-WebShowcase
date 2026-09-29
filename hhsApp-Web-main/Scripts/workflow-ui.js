// ------------------------------------------------------------------
// Step card color — applied as a left accent border plus a light
// background tint, so it's visible without overwhelming the card's
// actual content or fighting with light/dark mode text contrast. Chosen
// per-step in the editor (see newCardColor in index.html), stored as a
// plain hex string on the step object; null/undefined means "no color,
// use the default card look" and is a no-op here.
// ------------------------------------------------------------------
function hexToRgba(hex, alpha) {
    const clean = (hex || '').replace('#', '');
    if (clean.length !== 6) return `rgba(37, 99, 235, ${alpha})`; // fallback if somehow malformed
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyStepCardColor(card, colorHex) {
    if (!colorHex) return;
    card.style.borderLeft = `5px solid ${colorHex}`;
    card.style.backgroundColor = hexToRgba(colorHex, 0.08);
}

// ------------------------------------------------------------------
// Read-only "preview the full flow" — a scrollable list of every step
// with its Yes/No branches, so a researcher can review the whole
// protocol's logic at a glance before publishing/exporting.
// ------------------------------------------------------------------
function injectFlowPreviewButton() {
    if (document.getElementById('hhsFlowPreviewBtn')) return;
    const controls = document.querySelector('.header-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hhsFlowPreviewBtn';
    btn.className = 'ctrl-btn';
    btn.style.background = '#5d82ed';
    btn.style.color = '#ffffff';
    if (typeof setSideBtnContent === 'function') {
        setSideBtnContent(btn, '<img src="images/data-magnifying-glass-svgrepo-com.svg" alt="" class="btn-icon">', 'Preview Flow');
    } else {
        btn.textContent = '🔎 Preview Flow';
    }
    btn.addEventListener('click', showFlowPreviewModal);
    controls.appendChild(btn);
}

function showFlowPreviewModal() {
    document.getElementById('hhsFlowPreview')?.remove();
    const sorted = [...QUESTIONS_CONFIG].sort((a, b) => a.step - b.step);
    const validStepNumbers = new Set(sorted.map(q => q.step));

    const overlay = document.createElement('div');
    overlay.id = 'hhsFlowPreview';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:99999; padding:20px; box-sizing:border-box;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#ffffff; border-radius:8px; padding:24px; width:640px; max-width:100%; max-height:85vh; overflow-y:auto; font-family:system-ui, -apple-system, sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.35);';

    const itemsHtml = sorted.map(q => {
        const truncatedPrompt = q.prompt && q.prompt.length > 140 ? q.prompt.slice(0, 140) + '…' : (q.prompt || '(no prompt text)');
        const yesLabel = q.trials && q.trials.length > 0
            ? `${q.trials.length} trial option${q.trials.length === 1 ? '' : 's'}`
            : 'no trial options attached';
        const noLabel = q.ifNoGoToStep ? `Step ${q.ifNoGoToStep}` : 'End of protocol';
        const noIsOrphaned = q.ifNoGoToStep !== null && q.ifNoGoToStep !== undefined && !validStepNumbers.has(q.ifNoGoToStep);

        return `
            <div style="border:1px solid #e2e8f0; border-radius:6px; padding:14px; margin-bottom:10px; background:#f8fafc;">
                <strong style="color:#0f172a; font-size:14px;">Step ${q.step}: ${q.title || '(untitled)'}</strong>
                <p style="font-size:13px; color:#475569; margin:6px 0 8px;">${truncatedPrompt}</p>
                <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:12px;">
                    <span style="background:#eff6ff; color:#1d4ed8; padding:3px 8px; border-radius:10px;">Yes → ${yesLabel}</span>
                    <span style="background:${noIsOrphaned ? '#fee2e2' : '#fef2f2'}; color:${noIsOrphaned ? '#dc2626' : '#991b1b'}; padding:3px 8px; border-radius:10px; ${noIsOrphaned ? 'font-weight:700;' : ''}">No → ${noLabel}${noIsOrphaned ? ' ⚠️ invalid reference' : ''}</span>
                </div>
            </div>
        `;
    }).join('');

    box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <h3 style="margin:0; font-size:17px; color:#1e293b;">Protocol flow overview</h3>
            <button type="button" id="hhsFlowPreviewClose" style="background:#e2e8f0; color:#334155; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:13px;">Close</button>
        </div>
        <p style="margin:0 0 14px; font-size:13px; color:#64748b;">${sorted.length} step${sorted.length === 1 ? '' : 's'} total. Read-only — close this to keep editing.</p>
        ${itemsHtml || '<p style="font-size:13px; color:#94a3b8; font-style:italic;">No steps yet.</p>'}
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#hhsFlowPreviewClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
}

// ------------------------------------------------------------------
// Search / jump-to-step — since the screening view only ever shows one
// active card at a time by design, this jumps straight to whichever
// step matches instead of filtering a visible list.
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// Search / jump-to-step — collapsed to a small icon by default, expands
// into a text input on click (classic "expanding search" pattern) so it
// doesn't permanently eat header space. Since the screening view only
// ever shows one active card at a time by design, this jumps straight to
// whichever step matches instead of filtering a visible list.
// ------------------------------------------------------------------
function initStepJumpSearch() {
    if (document.getElementById('hhsStepSearch')) return;
    const container = document.getElementById('dynamicQuestionsContainer');
    if (!container || !container.parentElement) return;

    const wrap = document.createElement('div');
    wrap.id = 'hhsStepSearch';
    wrap.style.cssText = 'padding: 0 32px; margin-top: 8px; display:flex; justify-content:flex-end;';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex; align-items:center; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:20px; height:36px; overflow:hidden;';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.id = 'hhsStepSearchToggle';
    toggleBtn.setAttribute('aria-label', 'Jump to step');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.innerHTML = '<img src="images/magnifying-glass-backup-svgrepo-com.svg" alt="" style="width:16px; height:16px;">';
    toggleBtn.style.cssText = 'background:none; border:none; cursor:pointer; font-size:15px; padding:0 10px; height:100%; display:flex; align-items:center; color:#475569; flex-shrink:0;';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'hhsStepSearchInput';
    input.autocomplete = 'off';
    input.placeholder = 'Step number or title keyword…';
    input.setAttribute('aria-label', 'Jump to step — enter a step number or title keyword, then press Enter');
    input.style.cssText = 'width:0; opacity:0; border:none; background:transparent; outline:none; font-size:14px; padding:0; color:#0f172a; transition: width 0.22s ease, opacity 0.18s ease, padding 0.22s ease;';

    bar.appendChild(toggleBtn);
    bar.appendChild(input);
    wrap.appendChild(bar);
    container.parentElement.insertBefore(wrap, container);

    let isExpanded = false;

    function expand() {
        isExpanded = true;
        toggleBtn.setAttribute('aria-expanded', 'true');
        input.style.width = '220px';
        input.style.opacity = '1';
        input.style.padding = '0 10px 0 0';
        window.setTimeout(() => input.focus(), 50);
    }

    function collapse() {
        isExpanded = false;
        toggleBtn.setAttribute('aria-expanded', 'false');
        input.style.width = '0';
        input.style.opacity = '0';
        input.style.padding = '0';
        input.value = '';
    }

    function jumpToStep(rawQuery) {
        const query = rawQuery.trim().toLowerCase();
        if (!query) return;

        const byNumber = QUESTIONS_CONFIG.find(q => String(q.step) === query);
        const match = byNumber || QUESTIONS_CONFIG.find(q =>
            (q.title || '').toLowerCase().includes(query) || 
            (q.prompt || '').toLowerCase().includes(query) ||
            (q.trials || []).some(t => 
                (t.name || '').toLowerCase().includes(query) || 
                (t.desc || '').toLowerCase().includes(query) || 
                (t.criteria || []).some(c => (c || '').toLowerCase().includes(query))
            )
        );

        if (!match) {
            showToast?.(`No step matches "${rawQuery.trim()}"`, { duration: 3000 });
            return;
        }

        clearDownstreamCards(0);
        activateStepCard(match.step); // also moves focus onto the card
        const card = document.getElementById(`cardStep-${match.step}`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.transition = 'box-shadow 0.3s ease';
            card.style.boxShadow = '0 0 0 3px #3b82f6';
            window.setTimeout(() => { card.style.boxShadow = ''; }, 1500);
        }
        collapse();
    }

    toggleBtn.addEventListener('click', () => {
        if (!isExpanded) {
            expand();
        } else if (input.value.trim()) {
            jumpToStep(input.value);
        } else {
            collapse();
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            jumpToStep(input.value);
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            collapse();
        }
    });

    // Collapse on losing focus, unless the user is mid-click on the toggle
    // button itself (give that click a moment to register first).
    input.addEventListener('blur', () => {
        window.setTimeout(() => {
            if (!input.value.trim() && document.activeElement !== toggleBtn) collapse();
        }, 150);
    });
}

if (typeof require === 'undefined') {
    window.require = function(moduleName) {
        console.warn("Blocked attempt to require: " + moduleName);
        return {}; // Return empty object so the app doesn't crash
    };
}
let isManageStepsMode = false;

// ------------------------------------------------------------------
// "Manage All Steps" — shows every card at once (no active/hidden
// toggling, no Yes/No answering), so reordering and duplicating steps
// can actually be done with the full list visible instead of one card
// at a time.
// ------------------------------------------------------------------
function injectManageModeButton() {
    if (document.getElementById('hhsManageModeBtn')) return;
    const controls = document.querySelector('.header-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hhsManageModeBtn';
    btn.className = 'ctrl-btn';
    btn.style.background = '#5d82ed';
    btn.style.color = '#ffffff';
    btn.innerHTML = '<img src="images/clipboard-text-svgrepo-com.svg" alt="" class="btn-icon"> Manage All Steps';
    btn.addEventListener('click', toggleManageStepsMode);
    controls.appendChild(btn);
}

function toggleManageStepsMode() {
    isManageStepsMode = !isManageStepsMode;
    const btn = document.getElementById('hhsManageModeBtn');
    if (btn) {
        btn.innerHTML = isManageStepsMode
            ? '<img src="images/play-svgrepo-com.svg" alt="" class="btn-icon"> Screening View'
            : '<img src="images/clipboard-text-svgrepo-com.svg" alt="" class="btn-icon"> Manage All Steps';
    }
    if (isManageStepsMode) hideResultsPanel();
    buildWorkflowUI();
}

// Shared by both modes — a compact, uniform row of icon-only controls
// instead of the old mix of small icon buttons next to large labeled
// pills. Tooltips (title) + aria-label carry the meaning that visible
// text used to.
function buildStepControlsHtml(q, isFirst, isLast) {
    return `
        <div class="step-controls">
            <div class="reorder-stack" style="visibility: ${isManageStepsMode ? 'visible' : 'hidden'};">
                <button type="button" class="icon-action-btn" onclick="moveStepUp(${q.step})" ${isFirst ? 'disabled' : ''} aria-label="Move Step ${q.step} up" title="Move up">▲</button>
                <button type="button" class="icon-action-btn" onclick="moveStepDown(${q.step})" ${isLast ? 'disabled' : ''} aria-label="Move Step ${q.step} down" title="Move down">▼</button>
            </div>
            <button type="button" class="icon-action-btn" onclick="duplicateStep(${q.step})" aria-label="Duplicate Step ${q.step}" title="Duplicate step"><img src="images/clipboard-text-svgrepo-com.svg" alt="" class="btn-icon"></button>
            <button type="button" class="icon-action-btn" onclick="openControlPage(true, ${q.step})" aria-label="Edit Step ${q.step}: ${q.title}" title="Edit step & options"> <img src="images/pencil-svgrepo-com.svg" alt="" class="btn-icon"> </button>
            <button type="button" class="icon-action-btn" onclick="showStepShareModal(${q.step})" aria-label="Share link and QR code for Step ${q.step}: ${q.title}" title="Share link / QR code to this step"><img src="images/qr-code-svgrepo-com.svg" alt="" class="btn-icon"></button>
            <button type="button" class="icon-action-btn danger" onclick="deleteExistingStep(${q.step})" aria-label="Delete Step ${q.step}: ${q.title}" title="Delete step"> <img src="images/trash-bin-minimalistic-svgrepo-com.svg" alt="" class="btn-icon"> </button>
        </div>
    `;
}

function buildWorkflowUI() {
    const container = document.getElementById("dynamicQuestionsContainer");
    if (!container) return;
    console.log('[HHS DEBUG] buildWorkflowUI:start', {
        stepCount: Array.isArray(QUESTIONS_CONFIG) ? QUESTIONS_CONFIG.length : 0,
        activeDataFilePath,
        hasContainer: !!container,
        isManageStepsMode
    });
    container.innerHTML = "";
    container.classList.toggle('manage-mode', isManageStepsMode);

    QUESTIONS_CONFIG.sort((a, b) => a.step - b.step);

    QUESTIONS_CONFIG.forEach((q, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === QUESTIONS_CONFIG.length - 1;
        const card = document.createElement("div");
        card.id = `cardStep-${q.step}`;
        card.setAttribute('role', 'region');
        card.setAttribute('aria-labelledby', `stepTitle-${q.step}`);
        card.tabIndex = -1; // programmatic focus target only, not in normal tab order
        applyStepCardColor(card, q.color);

        if (isManageStepsMode) {
            // Every card visible, no active/hidden state, no answering —
            // this is a management list, not the guided screening flow.
            card.className = 'step-card manage-card';
            card.innerHTML = `
                <div class="card-num" aria-hidden="true">${String(q.step).padStart(2, '0')}</div>
                <div class="question-body">
                    <div class="card-title-row manage-title-row">
                        <h3 id="stepTitle-${q.step}">${q.title}</h3>
                        ${buildStepControlsHtml(q, isFirst, isLast)}
                    </div>
                    <p class="question-prompt" id="stepPrompt-${q.step}" style="margin-bottom: 0;">${q.prompt}</p>
                </div>
            `;
        } else {
            card.className = `step-card ${q.step === 1 ? 'active-card' : 'hidden'}`;
            card.innerHTML = `
                <div class="card-num" aria-hidden="true">${String(q.step).padStart(2, '0')}</div>
                <div class="question-body">
                    <div class="card-title-row">
                        <h3 id="stepTitle-${q.step}">${q.title}</h3>
                        ${buildStepControlsHtml(q, isFirst, isLast)}
                    </div>
                    <p class="question-prompt" id="stepPrompt-${q.step}">${q.prompt}</p>
                    <div class="action-buttons" role="group" aria-label="Answer for: ${q.title}">
                        <button type="button" class="btn btn-yes" id="btn-yes-${q.step}" onclick="processChoice(${q.step}, true)" aria-pressed="false" aria-describedby="stepPrompt-${q.step}">Yes</button>
                        <button type="button" class="btn btn-no" id="btn-no-${q.step}" onclick="processChoice(${q.step}, false)" aria-pressed="false" aria-describedby="stepPrompt-${q.step}">No</button>
                    </div>
                </div>
            `;
        }
        container.appendChild(card);
    });

    console.log('[HHS DEBUG] buildWorkflowUI:complete', {
        renderedCards: QUESTIONS_CONFIG.length,
        firstStep: QUESTIONS_CONFIG[0] ? QUESTIONS_CONFIG[0].step : null,
        lastStep: QUESTIONS_CONFIG.length > 0 ? QUESTIONS_CONFIG[QUESTIONS_CONFIG.length - 1].step : null
    });

    handleDeepLinkStep();
}

// ------------------------------------------------------------------
// Deep-linking: opening the app with ?step=N in the URL scrolls straight
// to that step's card and highlights it briefly — handy for a QR code on
// a printed reference sheet/poster that jumps right to a specific step.
// See showStepShareModal() below for how the link/QR actually get built
// and shown to the person editing the protocol.
//
// Called from the end of buildWorkflowUI() itself rather than hooked into
// the login/data-load flow elsewhere, since buildWorkflowUI() is the one
// function guaranteed to run whenever there's actually data to show —
// simpler and more robust than trying to time this against auth/fetch
// callbacks in another file.
// ------------------------------------------------------------------
let deepLinkStepHandled = false;
function handleDeepLinkStep() {
    if (deepLinkStepHandled) return;
    if (!Array.isArray(QUESTIONS_CONFIG) || QUESTIONS_CONFIG.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get('step');
    if (!stepParam) return;

    const stepNum = parseInt(stepParam, 10);
    if (isNaN(stepNum)) return;

    const answerParam = params.get('answer'); // 'yes' | 'no' | absent

    // Mark handled BEFORE the mode switch below triggers its own
    // buildWorkflowUI() call — otherwise that re-render would call this
    // function again and loop.
    deepLinkStepHandled = true;

    // Strip ?step=/&answer= from the URL right away, once and for all.
    // Without this, a bookmarked or simply reloaded deep link keeps
    // re-triggering this on every single visit forever — this was a real
    // bug: opening one QR/share link a single time could permanently force
    // Manage All Steps mode on every future login, since the URL (and
    // whatever it forces) never went away on its own. history.replaceState
    // just rewrites the address bar silently, no reload/navigation.
    params.delete('step');
    params.delete('answer');
    const remainingSearch = params.toString();
    const cleanedUrl = window.location.pathname + (remainingSearch ? `?${remainingSearch}` : '') + window.location.hash;
    window.history.replaceState(null, '', cleanedUrl);

    const stepExists = QUESTIONS_CONFIG.some(q => q.step === stepNum);
    if (!stepExists) {
        window.showToast?.(`Step ${stepNum} doesn't exist in this protocol.`, { duration: 5000 });
        return;
    }

    if (answerParam === 'yes' || answerParam === 'no') {
        // Simulating what happens right after answering — this needs the
        // real guided-screening UI (Yes/No buttons, results panel), not
        // the flat Manage All Steps list, so make sure we're in that mode.
        if (isManageStepsMode) {
            isManageStepsMode = false;
            buildWorkflowUI(); // safe re-entry — deepLinkStepHandled is already true
        }
        setTimeout(() => {
            activateStepCard(stepNum); // reveals this step's card directly, no need to have "answered" everything before it
            processChoice(stepNum, answerParam === 'yes');
        }, 50);
        return;
    }

    // No answer specified — just show this step's own content/question,
    // regardless of where it sits in the branching flow. Manage All Steps
    // mode guarantees it's rendered even if nobody's reached it yet.
    if (!isManageStepsMode) {
        isManageStepsMode = true;
        buildWorkflowUI(); // safe re-entry — deepLinkStepHandled is already true
    }

    setTimeout(() => {
        const card = document.getElementById(`cardStep-${stepNum}`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('deep-link-highlight');
        card.focus({ preventScroll: true });
        setTimeout(() => card.classList.remove('deep-link-highlight'), 3000);
    }, 50);
}

// Builds the shareable link for a step and shows it alongside a QR code
// image (generated via api.qrserver.com — a free, no-key-required QR
// image API; requires network access when the modal is opened, same as
// the rest of this app already needs for Firebase sync). Meant for a
// one-off "print this for the wall" action, not something used constantly.
//
// Three link variants, switchable live in the modal without reopening it:
//   - "content"  — ?step=N            — just shows this step's question
//   - "yes"      — ?step=N&answer=yes — jumps straight to the trial
//                                        matches shown after answering Yes
//   - "no"       — ?step=N&answer=no  — jumps to wherever answering No
//                                        leads (the next step, or the
//                                        "complete" message if there's
//                                        nowhere further to go)
function buildStepShareUrl(stepNum, mode) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('step', stepNum);
    if (mode === 'yes' || mode === 'no') url.searchParams.set('answer', mode);
    return url.toString();
}

function showStepShareModal(stepNum) {
    const step = QUESTIONS_CONFIG.find(q => q.step === stepNum);
    if (!step) return;

    document.getElementById('hhsShareStepModal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hhsShareStepModal';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:99999; padding:20px; box-sizing:border-box;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#ffffff; border-radius:8px; padding:24px; width:380px; max-width:100%; text-align:center; font-family:system-ui, -apple-system, sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.35);';
    box.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
            <h3 style="margin:0; font-size:16px; color:#1e293b;">Share Step ${stepNum}</h3>
            <button type="button" id="hhsShareStepClose" style="background:#e2e8f0; color:#334155; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:13px;">Close</button>
        </div>
        <p style="margin:0 0 14px; font-size:13px; color:#475569; overflow-wrap:anywhere;">${typeof escapeHtml === 'function' ? escapeHtml(step.title) : step.title}</p>

        <div id="hhsShareStepModeGroup" role="radiogroup" aria-label="What this link should show" style="display:flex; gap:4px; background:#f1f5f9; padding:4px; border-radius:6px; margin-bottom:16px;">
            <label style="flex:1; text-align:center; padding:7px 4px; border-radius:4px; font-size:12px; font-weight:600; cursor:pointer; color:#475569;">
                <input type="radio" name="hhsShareStepMode" value="content" checked style="display:none;"> This step
            </label>
            <label style="flex:1; text-align:center; padding:7px 4px; border-radius:4px; font-size:12px; font-weight:600; cursor:pointer; color:#475569;">
                <input type="radio" name="hhsShareStepMode" value="yes" style="display:none;"> After Yes
            </label>
            <label style="flex:1; text-align:center; padding:7px 4px; border-radius:4px; font-size:12px; font-weight:600; cursor:pointer; color:#475569;">
                <input type="radio" name="hhsShareStepMode" value="no" style="display:none;"> After No
            </label>
        </div>

        <img id="hhsShareStepQr" src="" alt="QR code for Step ${stepNum}" style="width:200px; height:200px; margin-bottom:14px; border:1px solid #e2e8f0; border-radius:6px;">
        <p id="hhsShareStepHint" style="font-size:11px; color:#94a3b8; margin:0 0 10px;"></p>
        <div style="display:flex; gap:8px;">
            <input type="text" id="hhsShareStepLink" value="" readonly style="flex:1; padding:8px 10px; border:1px solid #cbd5e1; border-radius:4px; font-size:12px;">
            <button type="button" id="hhsShareStepCopy" style="background:#0284c7; color:#fff; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600; flex-shrink:0;">Copy</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const HINTS = {
        content: 'Scans to this step\'s own question — nothing pre-answered.',
        yes: 'Scans straight to the trial matches shown after answering "Yes" here.',
        no: 'Scans straight to wherever answering "No" here leads.'
    };

    function refreshShareLink() {
        const mode = box.querySelector('input[name="hhsShareStepMode"]:checked')?.value || 'content';
        const shareUrl = buildStepShareUrl(stepNum, mode);
        document.getElementById('hhsShareStepLink').value = shareUrl;
        document.getElementById('hhsShareStepQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(shareUrl)}`;
        document.getElementById('hhsShareStepHint').textContent = HINTS[mode];
        box.querySelectorAll('#hhsShareStepModeGroup label').forEach(label => {
            const isChecked = label.querySelector('input').checked;
            label.style.background = isChecked ? '#2563eb' : 'transparent';
            label.style.color = isChecked ? '#ffffff' : '#475569';
        });
    }

    box.querySelectorAll('input[name="hhsShareStepMode"]').forEach(input => {
        input.addEventListener('change', refreshShareLink);
    });
    refreshShareLink();

    document.getElementById('hhsShareStepClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
    document.getElementById('hhsShareStepCopy').addEventListener('click', () => {
        const input = document.getElementById('hhsShareStepLink');
        input.select();
        (navigator.clipboard?.writeText(input.value) ?? Promise.reject())
            .then(() => window.showToast?.('Link copied.', { duration: 3000 }))
            .catch(() => {
                document.execCommand('copy'); // fallback for older/embedded WebViews without the Clipboard API
                window.showToast?.('Link copied.', { duration: 3000 });
            });
    });
}

function handleUnifiedAddStepClick() {
    const config = Array.isArray(QUESTIONS_CONFIG) ? QUESTIONS_CONFIG : [];
    const lastStep = config.length > 0 ? config[config.length - 1].step : 0;
    const nextEndStepNum = lastStep + 1;

    showAddStepPositionPicker(nextEndStepNum, (targetPos) => {
        if (targetPos === null) return; // cancelled
        if (targetPos === nextEndStepNum) {
            openControlPage(false, null, null);
        } else {
            openControlPage(false, null, targetPos);
        }
    });
}

function showAddStepPositionPicker(nextEndStepNum, onSubmit) {
    document.getElementById('hhsAddStepPicker')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'hhsAddStepPicker';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.55); display:flex; align-items:center; justify-content:center; z-index:99999;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#ffffff; border-radius:8px; padding:20px; width:360px; max-width:90vw; font-family:system-ui, -apple-system, sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.35);';
    box.innerHTML = `
        <h3 style="margin:0 0 10px; font-size:16px; color:#1e293b;">Where should this step go?</h3>
        <p style="margin:0 0 12px; font-size:13px; color:#475569; line-height:1.4;">Leave blank or enter <strong>${nextEndStepNum}</strong> to add it at the end, or enter a number 1&ndash;${nextEndStepNum} to insert it there.</p>
        <input id="hhsAddStepPickerInput" type="number" min="1" max="${nextEndStepNum}" placeholder="${nextEndStepNum}" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #cbd5e1; border-radius:4px; font-size:14px; margin-bottom:14px;">
        <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button type="button" id="hhsAddStepPickerCancel" style="background:#e2e8f0; color:#334155; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px;">Cancel</button>
            <button type="button" id="hhsAddStepPickerOk" style="background:#2563eb; color:#ffffff; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600;">Add Step</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = box.querySelector('#hhsAddStepPickerInput');
    input.focus();

    function cleanup() {
        overlay.remove();
    }

    function submit() {
        const raw = input.value.trim();
        let targetPos = nextEndStepNum;
        if (raw !== "") {
            const parsed = parseInt(raw, 10);
            if (isNaN(parsed) || parsed < 1 || parsed > nextEndStepNum) {
                alert("Invalid step position selected.");
                return;
            }
            targetPos = parsed;
        }
        cleanup();
        onSubmit(targetPos);
    }

    box.querySelector('#hhsAddStepPickerOk').addEventListener('click', submit);
    box.querySelector('#hhsAddStepPickerCancel').addEventListener('click', () => { cleanup(); onSubmit(null); });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submit(); }
        if (event.key === 'Escape') { event.preventDefault(); cleanup(); onSubmit(null); }
    });
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) { cleanup(); onSubmit(null); }
    });
}


let lastDeletedStep = null;
let lastDeletedStepTimeout = null;

function renumberStepsSequentially() {
    QUESTIONS_CONFIG.sort((a, b) => a.step - b.step);
    QUESTIONS_CONFIG.forEach((q, idx) => {
        q.step = idx + 1;
        q.ifNoGoToStep = (idx < QUESTIONS_CONFIG.length - 1) ? (idx + 2) : null;
    });
}

// Reassigns step numbers purely from current ARRAY order, with no sort
// first. Used by move/duplicate below — renumberStepsSequentially() can't
// be reused there since its leading sort-by-.step would immediately undo
// a positional reorder.
function renumberFromArrayOrder() {
    QUESTIONS_CONFIG.forEach((q, idx) => {
        q.step = idx + 1;
        q.ifNoGoToStep = (idx < QUESTIONS_CONFIG.length - 1) ? (idx + 2) : null;
    });
}

// direction: -1 to move up, +1 to move down.
async function moveStep(stepNum, direction) {
    QUESTIONS_CONFIG.sort((a, b) => a.step - b.step); // normalize array order to match current step numbers
    const currentIdx = QUESTIONS_CONFIG.findIndex(q => q.step === stepNum);
    if (currentIdx === -1) return;
    const targetIdx = currentIdx + direction;
    if (targetIdx < 0 || targetIdx >= QUESTIONS_CONFIG.length) return; // already at the top/bottom

    const movedTitle = QUESTIONS_CONFIG[currentIdx].title;
    [QUESTIONS_CONFIG[currentIdx], QUESTIONS_CONFIG[targetIdx]] = [QUESTIONS_CONFIG[targetIdx], QUESTIONS_CONFIG[currentIdx]];
    renumberFromArrayOrder();

    buildWorkflowUI(); // instant local re-render — the (debounced) save below runs in the background so a quick double-click doesn't force two separate writes/reads
    commitDatabaseChangesToDisk({ changeDescription: `Moved step "${movedTitle}" ${direction < 0 ? 'up' : 'down'}` });

    const newStepNumber = targetIdx + 1;
    const movedCard = document.getElementById(`cardStep-${newStepNumber}`);
    if (movedCard) {
        movedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        movedCard.focus();
    }
    showToast?.(`Step moved ${direction < 0 ? 'up' : 'down'}.`, { duration: 2000 });
}

function moveStepUp(stepNum) { moveStep(stepNum, -1); }
function moveStepDown(stepNum) { moveStep(stepNum, 1); }

async function duplicateStep(stepNum) {
    QUESTIONS_CONFIG.sort((a, b) => a.step - b.step);
    const idx = QUESTIONS_CONFIG.findIndex(q => q.step === stepNum);
    if (idx === -1) return;

    // Deep copy so the clone's trials/criteria/pdfFiles are independent
    // from the original, not shared references.
    const clone = JSON.parse(JSON.stringify(QUESTIONS_CONFIG[idx]));
    clone.title = `${clone.title} (Copy)`;

    QUESTIONS_CONFIG.splice(idx + 1, 0, clone); // insert right after the original
    renumberFromArrayOrder();

    buildWorkflowUI(); // instant local re-render — save runs debounced in the background
    commitDatabaseChangesToDisk({ changeDescription: `Duplicated step "${QUESTIONS_CONFIG[idx].title}"` });

    const newCard = document.getElementById(`cardStep-${idx + 2}`); // clone's new step number
    if (newCard) {
        newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        newCard.focus();
    }
    showToast?.(`Step duplicated as "${clone.title}".`, { duration: 3000 });
}

// NOTE: this used to force a window.location.reload() right after deleting.
// That's been removed — buildWorkflowUI() already fully rebuilds the step
// list from QUESTIONS_CONFIG, and a reload would wipe out the in-memory
// lastDeletedStep before the Undo toast's action could ever fire.
async function deleteExistingStep(stepNum) {
    const confirmation = confirm(`Are you absolutely sure you want to delete Step #${stepNum}?\nThis will remove its trial criteria entirely and automatically fix the routing flow mapping layout for all remaining steps.\n\n(You'll have a few seconds to undo this after.)`);
    if (!confirmation) return;
    const targetIndex = QUESTIONS_CONFIG.findIndex(q => q.step === stepNum);
    if (targetIndex === -1) return;

    const removed = QUESTIONS_CONFIG[targetIndex];
    lastDeletedStep = { originalStep: removed.step, data: JSON.parse(JSON.stringify(removed)) };
    if (lastDeletedStepTimeout) clearTimeout(lastDeletedStepTimeout);

    QUESTIONS_CONFIG.splice(targetIndex, 1);
    renumberStepsSequentially();
    buildWorkflowUI(); // instant local re-render — save runs debounced in the background
    commitDatabaseChangesToDisk({ changeDescription: `Deleted step "${removed.title}"` });

    showToast?.(`Step "${removed.title}" deleted.`, {
        actionLabel: 'Undo',
        onAction: undoLastStepDelete,
        duration: 8000
    });
    lastDeletedStepTimeout = window.setTimeout(() => { lastDeletedStep = null; }, 8000);
}

async function undoLastStepDelete() {
    if (!lastDeletedStep) {
        showToast?.('Undo window has expired — that step is gone for good. Check Restore Backup instead.', { duration: 5000 });
        return;
    }
    const insertAt = Math.min(lastDeletedStep.originalStep - 1, QUESTIONS_CONFIG.length);
    QUESTIONS_CONFIG.splice(insertAt, 0, lastDeletedStep.data);
    renumberStepsSequentially();
    const restoredTitle = lastDeletedStep.data.title;
    lastDeletedStep = null;
    if (lastDeletedStepTimeout) { clearTimeout(lastDeletedStepTimeout); lastDeletedStepTimeout = null; }

    buildWorkflowUI(); // instant local re-render — save runs debounced in the background
    commitDatabaseChangesToDisk({ changeDescription: `Restored deleted step "${restoredTitle}" (undo)` });
    showToast?.('Step restored.', { duration: 3000 });
}

// ------------------------------------------------------------------
// "Restore Backup" — lets a researcher recover from a bad import or any
// mistake outside the 8-second Undo window, using the rolling local
// backups kept by storage-tools.js.
// ------------------------------------------------------------------
function injectRestoreBackupButton() {
    if (document.getElementById('hhsRestoreBackupBtn')) return;
    const controls = document.querySelector('.header-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hhsRestoreBackupBtn';
    btn.className = 'ctrl-btn';
    btn.style.background = '#5d82ed';
    btn.style.color = '#ffffff';
    if (typeof setSideBtnContent === 'function') {
        setSideBtnContent(btn, '<img src="images/history-svgrepo-com.svg" alt="" class="btn-icon">', 'Restore Backup');
    } else {
        btn.textContent = '🕐 Restore Backup';
    }
    btn.addEventListener('click', showBackupsModal);
    controls.appendChild(btn);
}

function showBackupsModal() {
    document.getElementById('hhsBackupsModal')?.remove();
    const backups = typeof listLocalBackups === 'function' ? listLocalBackups() : [];

    const overlay = document.createElement('div');
    overlay.id = 'hhsBackupsModal';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.55); display:flex; align-items:center; justify-content:center; z-index:99999;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#ffffff; border-radius:8px; padding:20px; width:420px; max-width:90vw; font-family:system-ui, -apple-system, sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.35);';

    const rows = backups.length === 0
        ? `<p style="font-size:13px; color:#94a3b8; font-style:italic; padding:8px 0;">No backups yet — one gets created automatically each time a change is saved.</p>`
        : backups.map((b, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; background:#f8fafc; border:1px solid #e2e8f0; padding:10px 12px; border-radius:6px; margin-bottom:8px;">
                <span style="font-size:13px; color:#334155;">${new Date(b.timestamp).toLocaleString()}</span>
                <button type="button" data-restore-idx="${idx}" style="background:#2563eb; color:#fff; border:none; padding:6px 12px; border-radius:4px; font-size:12px; font-weight:600; cursor:pointer;">Restore</button>
            </div>
        `).join('');

    box.innerHTML = `
        <h3 style="margin:0 0 6px; font-size:16px; color:#1e293b;">Restore a backup</h3>
        <p style="margin:0 0 14px; font-size:13px; color:#475569; line-height:1.4;">The last ${backups.length > 0 ? backups.length : 'few'} autosaved versions, most recent first. Restoring replaces your current data (which itself gets backed up first).</p>
        ${rows}
        <div style="display:flex; justify-content:flex-end; margin-top:10px;">
            <button type="button" id="hhsBackupsModalClose" style="background:#e2e8f0; color:#334155; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px;">Close</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelectorAll('[data-restore-idx]').forEach(btnEl => {
        btnEl.addEventListener('click', () => {
            const idx = parseInt(btnEl.getAttribute('data-restore-idx'), 10);
            overlay.remove();
            restoreLocalBackup(idx);
        });
    });
    box.querySelector('#hhsBackupsModalClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
}

function processChoice(stepNum, isYes) {
    const config = QUESTIONS_CONFIG.find(q => q.step === stepNum);
    console.log('[HHS DEBUG] processChoice', {
        stepNum,
        isYes,
        found: !!config,
        trialCount: config && config.trials ? config.trials.length : 0,
        nextStep: config ? config.ifNoGoToStep : null
    });
    const yesBtn = document.getElementById(`btn-yes-${stepNum}`);
    const noBtn = document.getElementById(`btn-no-${stepNum}`);
    yesBtn.classList.toggle('selected', isYes);
    yesBtn.setAttribute('aria-pressed', String(isYes));
    noBtn.classList.toggle('selected', !isYes);
    noBtn.setAttribute('aria-pressed', String(!isYes));
    clearDownstreamCards(stepNum);

    if (isYes) {
        displayTrialPayload(config.trials, config.ifNoGoToStep);
        // Move focus to the results region so screen reader / keyboard
        // users land on the new content instead of staying on the Yes button.
        const resultsCard = document.getElementById('cardResults');
        window.setTimeout(() => resultsCard?.focus(), 50);
    } else {
        hideResultsPanel();
        if (config.ifNoGoToStep) {
            activateStepCard(config.ifNoGoToStep); // also moves focus — see below
        } else {
            alert("Protocol processing complete. No further actions required.");
        }
    }
}

function displayTrialPayload(trialsArray, nextStepPointer) {
    const resultsCard = document.getElementById('cardResults');
    const contentArea = document.getElementById('resultsContent');
    const continueBtn = document.getElementById('continueBtn');
    const badge = document.getElementById('matchBadge');

    // Make this a programmatic focus target that gets announced as its
    // content changes (idempotent — cheap to set on every call).
    resultsCard.setAttribute('role', 'region');
    resultsCard.setAttribute('aria-live', 'polite');
    resultsCard.setAttribute('aria-label', 'Trial match results');
    resultsCard.tabIndex = -1;

    currentStepTarget = nextStepPointer;
    badge.textContent = `${trialsArray ? trialsArray.length : 0} Target Trial Match(es)`;

    window.activeMatchesRuntimeCache = trialsArray || [];

    if (!trialsArray || trialsArray.length === 0) {
        contentArea.innerHTML = `<div class="trial-panel">No active open trial profiles map directly to this setting.</div>`;
    } else {
        contentArea.innerHTML = trialsArray.map((trial, index) => `
            <div class="trial-panel" style="margin-bottom: 15px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
                <div class="trial-title-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span class="trial-name" style="font-weight: bold; font-size: 16px; color: #1e3a8a;">${trial.name}</span>
                    <span class="trial-contact" style="font-size: 13px; color: #64748b;">${trial.contact}</span>
                </div>
                <div class="trial-desc" style="font-size: 14px; color: #334155; margin-bottom: 10px;">${trial.desc}</div>
                ${trial.criteria && trial.criteria.length > 0 ? `
                    <ul class="trial-crit-list" style="margin-bottom: 10px; padding-left: 20px;">
                        ${trial.criteria.map(c => `<li style="font-size: 13px; color: #475569; margin-bottom: 2px;">${c}</li>`).join('')}
                    </ul>
                ` : ''}
                ${(() => {
                    const files = Array.isArray(trial.pdfFiles) && trial.pdfFiles.length > 0
                        ? trial.pdfFiles
                        : (trial.pdfData ? [{ name: trial.name, data: trial.pdfData }] : []);
                    if (files.length === 0) return '';
                    return `
                    <div class="pdf-action-block" style="margin-top: 12px; border-top: 1px dashed #cbd5e1; padding-top: 10px; display: flex; flex-direction: column; gap: 6px;">
                        ${files.map((file, pdfIdx) => `
                        <button type="button" class="ctrl-btn" style="background: #2563eb; color: white; padding: 8px 14px; border-radius: 4px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;" onclick="openFullscreenPdfViewer(${index}, ${pdfIdx})" aria-label="View protocol document ${file.name || pdfIdx + 1} for ${trial.name}">
                            📄 View Protocol Document${files.length > 1 ? `: ${file.name || 'Document ' + (pdfIdx + 1)}` : ' (Full Screen)'}
                        </button>`).join('')}
                    </div>
                    `;
                })()}
            </div>
        `).join('');
    }

    resultsCard.classList.remove('hidden');
    continueBtn.classList.toggle('hidden', nextStepPointer === null);
}

function advanceWorkflow() { if (currentStepTarget) activateStepCard(currentStepTarget); hideResultsPanel(); }

// Activating a card also moves focus onto it — this is the single place
// that happens so every caller (answering "No", the Continue button,
// search/jump-to-step) gets consistent keyboard/screen-reader behavior
// for free.
function activateStepCard(stepId) {
    document.querySelectorAll('.step-card').forEach(c => c.classList.remove('active-card'));
    const targetCard = document.getElementById(`cardStep-${stepId}`);
    if (targetCard) {
        targetCard.classList.remove('hidden');
        targetCard.classList.add('active-card');
        window.setTimeout(() => targetCard.focus(), 50);
    }
}

function clearDownstreamCards(fromStepNum) {
    QUESTIONS_CONFIG.forEach(q => {
        if (q.step > fromStepNum) {
            const card = document.getElementById(`cardStep-${q.step}`);
            if (card) {
                card.classList.add('hidden'); card.classList.remove('active-card');
                const yesBtn = document.getElementById(`btn-yes-${q.step}`);
                const noBtn = document.getElementById(`btn-no-${q.step}`);
                yesBtn.classList.remove('selected');
                yesBtn.setAttribute('aria-pressed', 'false');
                noBtn.classList.remove('selected');
                noBtn.setAttribute('aria-pressed', 'false');
            }
        }
    });
    hideResultsPanel();
}

function hideResultsPanel() {
    document.getElementById('cardResults').classList.add('hidden');
}

function resetWorkflowEngine() {
    if (isManageStepsMode) {
        isManageStepsMode = false;
        const btn = document.getElementById('hhsManageModeBtn');
        if (btn) btn.textContent = '📋 Manage All Steps';
    }
    buildWorkflowUI();
    hideResultsPanel();
}