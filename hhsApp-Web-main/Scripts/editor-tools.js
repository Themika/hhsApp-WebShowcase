if (typeof require === 'undefined') {
    window.require = function(moduleName) {
        console.warn("Blocked attempt to require: " + moduleName);
        return {}; // Return empty object so the app doesn't crash
    };
}

// Step card color — null means "no color set, use the default card look".
// Kept as a separate flag rather than trusting the <input type="color">'s
// own value, since that input can never actually be empty (browsers
// default it to black) — there'd be no way to tell "user picked black"
// apart from "user never touched this" without it.
let stagedStepColor = null;

function handleCardColorChange(hexValue) {
    stagedStepColor = hexValue;
    updateCardColorUI();
}

function clearStepCardColor() {
    stagedStepColor = null;
    updateCardColorUI();
}

// Add live preview synchronization hooks inside your existing update script
function updateCardColorUI() {
    const input = document.getElementById('newCardColor');
    const status = document.getElementById('cardColorStatus');
    const previewCard = document.getElementById('cardLivePreview');
    
    if (input) input.value = stagedStepColor || '#2563eb';
    
    if (status) {
        status.textContent = stagedStepColor
            ? `Card will be tinted ${stagedStepColor}`
            : 'No color set';
    }

    if (previewCard) {
        previewCard.style.borderLeftColor = stagedStepColor || '#2563eb';
    }

    document.querySelectorAll('.preset-btn').forEach(btn => {
        const btnColor = btn.getAttribute('data-color');
        if (btnColor === stagedStepColor || (!stagedStepColor && !btnColor && btn.classList.contains('clear-preset'))) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Bind live text change preview to the title textarea
document.addEventListener('DOMContentLoaded', () => {
    const titleInput = document.getElementById('newTitle');
    const previewTitle = document.getElementById('previewCardTitleText');
    if (titleInput && previewTitle) {
        titleInput.addEventListener('input', (e) => {
            previewTitle.textContent = e.target.value.trim() || 'Card Section Title';
        });
    }
});

function setPresetColor(color) {
    stagedStepColor = color;
    updateCardColorUI();
}

function handleCustomColor(color) {
    stagedStepColor = color;
    updateCardColorUI();
}

function getEditableFieldValue(id) {
    const element = document.getElementById(id);
    if (!element) return "";
    return typeof element.value === 'string' ? element.value.trim() : "";
}

function setEditableFieldValue(id, value) {
    const element = document.getElementById(id);
    if (!element) return;
    element.value = value == null ? "" : String(value);
}

function placeCaretAtEnd(element) {
    if (!element) return;
    element.focus();
    if (typeof element.setSelectionRange === 'function') {
        const caretPos = typeof element.value === 'string' ? element.value.length : 0;
        element.setSelectionRange(caretPos, caretPos);
    }
}

function focusEditorTextField(fieldId) {
    const element = document.getElementById(fieldId);
    if (!element) return;
    placeCaretAtEnd(element);
    console.log('[HHS DEBUG] focusEditorTextField', {
        fieldId,
        activeElementId: document.activeElement ? document.activeElement.id : null,
        value: element.value,
        selectionStart: typeof element.selectionStart === 'number' ? element.selectionStart : null,
        selectionEnd: typeof element.selectionEnd === 'number' ? element.selectionEnd : null
    });
}

function getSelectionRange(element) {
    return {
        start: typeof element.selectionStart === 'number' ? element.selectionStart : 0,
        end: typeof element.selectionEnd === 'number' ? element.selectionEnd : 0
    };
}

function setSelectionRange(element, start, end) {
    if (!element || typeof element.setSelectionRange !== 'function') return;
    element.setSelectionRange(start, end);
}

function applyTextInputMutation(element, insertedText, deleteBackward = false, deleteForward = false) {
    if (!element) return;
    const currentValue = typeof element.value === 'string' ? element.value : '';
    const bounds = getSelectionRange(element);
    let start = bounds.start;
    let end = bounds.end;

    if (deleteBackward && start === end && start > 0) {
        start -= 1;
    }
    if (deleteForward && start === end && end < currentValue.length) {
        end += 1;
    }

    const nextValue = currentValue.slice(0, start) + insertedText + currentValue.slice(end);
    element.value = nextValue;
    const nextCaret = start + insertedText.length;
    setSelectionRange(element, nextCaret, nextCaret);
}

function bindTextAreaEditing(element) {
    if (!element || element.dataset.hhsTextEditBound === 'true') return;
    element.dataset.hhsTextEditBound = 'true';

    element.addEventListener('keydown', (event) => {
        console.log('[HHS DEBUG] field:manualKeydown', {
            id: element.id,
            key: event.key,
            valueBefore: element.value,
            selection: getSelectionRange(element),
            activeElementId: document.activeElement ? document.activeElement.id : null
        });

        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }

        if (event.key.length === 1) {
            event.preventDefault();
            applyTextInputMutation(element, event.key);
            return;
        }

        if (event.key === 'Backspace') {
            event.preventDefault();
            applyTextInputMutation(element, '', true, false);
            return;
        }

        if (event.key === 'Delete') {
            event.preventDefault();
            applyTextInputMutation(element, '', false, true);
            return;
        }

        if (event.key === 'Enter' && element.id !== 'newTitle') {
            event.preventDefault();
            applyTextInputMutation(element, '\n');
        }
    });

    element.addEventListener('paste', (event) => {
        const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
        console.log('[HHS DEBUG] field:manualPaste', {
            id: element.id,
            pasteLength: text.length,
            valueBefore: element.value,
            selection: getSelectionRange(element)
        });
        if (!text) return;
        event.preventDefault();
        applyTextInputMutation(element, text);
    });

    element.addEventListener('input', () => {
        console.log('[HHS DEBUG] field:manualInput', {
            id: element.id,
            valueAfter: element.value,
            activeElementId: document.activeElement ? document.activeElement.id : null
        });
    });

    element.addEventListener('pointerdown', () => {
        window.setTimeout(() => focusEditorTextField(element.id), 0);
    });
}

function openControlPage(isEditMode = false, targetStepId = null, insertionPosition = null) {
    console.log('[HHS DEBUG] openControlPage', { isEditMode, targetStepId, insertionPosition, stepCount: Array.isArray(QUESTIONS_CONFIG) ? QUESTIONS_CONFIG.length : 0 });
    document.getElementById('screeningView').classList.add('hidden');
    document.getElementById('creatorView').classList.remove('hidden');

    clearDraftOptionForm();

    const creatorFields = ['newTitle', 'newPrompt', 'tName', 'tContact', 'tDesc', 'bulletInput', 'commitTrialBtn', 'formSubmitBtn'];
    creatorFields.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.removeAttribute('readonly');
        element.removeAttribute('disabled');
    });

    if (isEditMode && targetStepId !== null) {
        editingStepNumber = targetStepId;
        document.getElementById('pageViewModeTitle').textContent = "Protocol Stage Editor";
        document.getElementById('managementActionLabel').textContent = "Modify";
        document.getElementById('routingEngineHelperText').textContent = "Modifying parameters inside an existing runtime structural workflow step.";
        document.getElementById('formSubmitBtn').textContent = "Save and Update Protocol Step & Options";

        const stepData = QUESTIONS_CONFIG.find(q => q.step === targetStepId);
        if (!stepData) {
            console.error('[HHS DEBUG] openControlPage:stepDataMissing');
            closeControlPage();
            return;
        }
        document.getElementById('autoStepBadge').textContent = `Step #${targetStepId}`;
        document.getElementById('autoStepBadge').dataset.stepval = targetStepId;
        setEditableFieldValue('newTitle', stepData.title);
        setEditableFieldValue('newPrompt', stepData.prompt);
        stagedStepColor = stepData.color || null;
        updateCardColorUI();
        stagedTrialsArray = stepData.trials ? JSON.parse(JSON.stringify(stepData.trials)) : [];
    } else {
        editingStepNumber = null;
        setEditableFieldValue('newTitle', '');
        setEditableFieldValue('newPrompt', '');
        stagedStepColor = null;
        updateCardColorUI();
        document.getElementById('pageViewModeTitle').textContent = "Protocol Stage Configurator";
        document.getElementById('managementActionLabel').textContent = "Create";
        document.getElementById('formSubmitBtn').textContent = "Save Complete Step with Options";

        let assignedPositionNum;
        if (insertionPosition !== null) {
            assignedPositionNum = insertionPosition;
            document.getElementById('routingEngineHelperText').textContent = `Inserting a mid-chain step sequence explicitly at Position #${insertionPosition}. Steps downstream will be offset automatically.`;
            document.getElementById('autoStepBadge').dataset.isInsertion = "true";
        } else {
            QUESTIONS_CONFIG.sort((a, b) => a.step - b.step);
            assignedPositionNum = QUESTIONS_CONFIG.length > 0 ? QUESTIONS_CONFIG[QUESTIONS_CONFIG.length - 1].step + 1 : 1;
            document.getElementById('routingEngineHelperText').textContent = "The system automatically links this new step into the end of your protocol chain.";
            document.getElementById('autoStepBadge').dataset.isInsertion = "false";
        }
        document.getElementById('autoStepBadge').textContent = `Step #${assignedPositionNum}`;
        document.getElementById('autoStepBadge').dataset.stepval = assignedPositionNum;
        stagedTrialsArray = [];
    }

    renderQueuedTrialsList();

    // FOCUS TARGET
    const initialField = document.getElementById('newTitle') || document.getElementById('tName');

    if (initialField) {
        placeCaretAtEnd(initialField);
        window.setTimeout(() => focusEditorTextField(initialField.id), 250);
    }
}

function closeControlPage() {
    document.getElementById('creatorView').classList.add('hidden');
    document.getElementById('screeningView').classList.remove('hidden');
    document.querySelectorAll('#creatorView input, #creatorView textarea').forEach(el => {
        el.value = "";
    });
    delete document.getElementById('autoStepBadge').dataset.isInsertion;
    stagedTrialsArray = [];
    activeBulletPointsArr = [];
    stagedPdfFiles = [];
    editingStepNumber = null;
    editingTrialIndex = null;
    editingBulletIndex = null;
    renderQueuedTrialsList();
}

function addBulletPointToDraft() {
    const field = document.getElementById('bulletInput');
    const rawValue = field.value.trim();
    if (!rawValue) return;

    console.log('[HHS DEBUG] addBulletPointToDraft', { editingBulletIndex, rawValue });

    if (editingBulletIndex !== null) {
        activeBulletPointsArr[editingBulletIndex] = rawValue;
        editingBulletIndex = null;
        document.querySelector('.add-bullet-btn').textContent = "+ Add Bullet";
    } else {
        activeBulletPointsArr.push(rawValue);
    }

    field.value = "";
    renderBulletDraftPreview();
}

function renderBulletDraftPreview() {
    const container = document.getElementById('bulletPreviewList');
    if (!container) return;
    container.innerHTML = activeBulletPointsArr.map((str, index) => `
        <li style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; border:1px solid #e2e8f0; padding:6px 10px; margin-bottom:4px; border-radius:4px;">
            <span style="font-size:13px; color:#334155;">&bull; ${str}</span>
            <div style="display:flex; gap:4px;">
                <button type="button" class="edit-bullet-btn" style="background:none; border:none; color:#2563eb; cursor:pointer; font-size:12px;" onclick="editDraftBullet(${index})"><img src="images/pencil-svgrepo-com.svg" alt="" class="btn-icon-pencil"></button>
                <button type="button" class="del-bullet-btn" style="background:none; border:none; color:#dc2626; cursor:pointer; font-size:14px; font-weight:bold;" onclick="removeDraftBullet(${index})">&times;<img src="images/trash-bin-minimalistic-svgrepo-com.svg" alt="" class="btn-icon-pencil"></button>
            </div>
        </li>
    `).join('');
}

function editDraftBullet(index) {
    console.log('[HHS DEBUG] editDraftBullet', { index, currentValue: activeBulletPointsArr[index] });
    editingBulletIndex = index;
    const field = document.getElementById('bulletInput');
    if (field) {
        field.value = activeBulletPointsArr[index];
        document.querySelector('.add-bullet-btn').textContent = "💾 Save Bullet";
        field.focus();
    }
}

function removeDraftBullet(index) {
    console.log('[HHS DEBUG] removeDraftBullet', { index, currentValue: activeBulletPointsArr[index] });
    if (editingBulletIndex === index) {
        editingBulletIndex = null;
        document.getElementById('bulletInput').value = "";
        document.querySelector('.add-bullet-btn').textContent = "+ Add Bullet";
    }
    activeBulletPointsArr.splice(index, 1);
    renderBulletDraftPreview();
}

function editOptionFromStepQueue(index) {
    console.log('[HHS DEBUG] editOptionFromStepQueue', { index, trial: stagedTrialsArray[index] });
    editingTrialIndex = index;
    const trial = stagedTrialsArray[index];

    document.getElementById('trialDraftingCard').classList.add('editing-active-pulse');
    document.getElementById('trialFormActionHeading').innerHTML = `<img src="images/pencil-svgrepo-com.svg" alt="" class="btn-icon-pencil"> Modify Trial Option: <strong>${trial.name}</strong>`;
    document.getElementById('commitTrialBtn').textContent = "Apply Changes to Option";
    document.getElementById('cancelTrialEditBtn').classList.remove('hidden');

    document.getElementById('tName').value = trial.name;
    document.getElementById('tContact').value = trial.contact;
    document.getElementById('tDesc').value = trial.desc;

    activeBulletPointsArr = trial.criteria ? [...trial.criteria] : [];
    renderBulletDraftPreview();

    // New trials store pdfFiles (array); trials saved before multi-PDF
    // support only have the old singular pdfData field — treat that as a
    // one-item list so editing an old trial doesn't lose its document.
    stagedPdfFiles = Array.isArray(trial.pdfFiles) && trial.pdfFiles.length > 0
        ? [...trial.pdfFiles]
        : (trial.pdfData ? [{ name: trial.name, data: trial.pdfData }] : []);

    renderStagedPdfList();
    document.getElementById('contentModeSwitcher').value = stagedPdfFiles.length > 0 ? 'pdf' : 'bullets';
    toggleContentMode();
    document.getElementById('trialDraftingCard').scrollIntoView({ behavior: 'smooth' });
}

function commitOptionToStepQueue() {
    const name = document.getElementById('tName').value.trim() || "Unknown Trial Program Name";
    const contact = document.getElementById('tContact').value.trim() || "N/A";
    const desc = document.getElementById('tDesc').value.trim() || "No descriptive notes recorded.";
    console.log('[HHS DEBUG] commitOptionToStepQueue:start', {
        editingTrialIndex,
        name,
        contact,
        desc,
        bulletCount: activeBulletPointsArr.length,
        pdfFileCount: stagedPdfFiles.length
    });

    if (!name) {
        alert("To attach a trial option block, you must input a 'Trial Program Name'.");
        return;
    }

    const compiledTrialPayload = {
        name: name,
        contact: contact,
        desc: desc,
        criteria: [...activeBulletPointsArr],
        pdfFiles: [...stagedPdfFiles]
    };

    if (editingTrialIndex !== null) {
        stagedTrialsArray[editingTrialIndex] = compiledTrialPayload;
    } else {
        stagedTrialsArray.push(compiledTrialPayload);
    }

    console.log('[HHS DEBUG] commitOptionToStepQueue:queuedTrials', {
        total: stagedTrialsArray.length,
        editingTrialIndex,
        lastTrial: stagedTrialsArray[stagedTrialsArray.length - 1]
    });

    clearDraftOptionForm();
    renderQueuedTrialsList();
}

let draggedTrialIndex = null;

function handleQueuedTrialDragStart(event, index) {
    draggedTrialIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    event.currentTarget.classList.add('is-dragging');
}

function handleQueuedTrialDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('is-drag-over');
}

function handleQueuedTrialDragLeave(event) {
    event.currentTarget.classList.remove('is-drag-over');
}

function handleQueuedTrialDrop(event, targetIndex) {
    event.preventDefault();
    const sourceIndex = draggedTrialIndex === null
        ? Number(event.dataTransfer.getData('text/plain'))
        : draggedTrialIndex;

    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= stagedTrialsArray.length || sourceIndex === targetIndex) {
        return;
    }

    const [movedTrial] = stagedTrialsArray.splice(sourceIndex, 1);
    stagedTrialsArray.splice(targetIndex, 0, movedTrial);
    renderQueuedTrialsList();
}

function handleQueuedTrialDragEnd(event) {
    draggedTrialIndex = null;
    event.currentTarget.classList.remove('is-dragging', 'is-drag-over');
    document.querySelectorAll('.queued-trial-item-row.is-drag-over').forEach(row => {
        row.classList.remove('is-drag-over');
    });
}

function renderQueuedTrialsList() {
    const container = document.getElementById('queuedTrialsContainer');
    if (!container) return;
    if (stagedTrialsArray.length === 0) {
        container.innerHTML = `<p class="empty-state-text">No trial allocation options attached to this step yet.</p>`;
        return;
    }

    container.innerHTML = stagedTrialsArray.map((trial, index) => `
        <div class="queued-trial-item-row" draggable="true"
            ondragstart="handleQueuedTrialDragStart(event, ${index})"
            ondragover="handleQueuedTrialDragOver(event)"
            ondragleave="handleQueuedTrialDragLeave(event)"
            ondrop="handleQueuedTrialDrop(event, ${index})"
            ondragend="handleQueuedTrialDragEnd(event)">
            <span class="queued-trial-drag-handle" aria-hidden="true" title="Drag to reorder">☷</span>
            <div class="queued-item-meta">
                <strong>${trial.name}</strong> <span style="color:#64748b; font-size:12px;">(${trial.contact})</span>
                <div style="font-size:12px; color:#475569; margin-top:2px;">${trial.desc}</div>
                <div style="font-size:11px; color:#3b82f6; margin-top:4px; cursor:pointer; user-select:none; display:inline-block; font-weight:500;" onclick="toggleInlineCriteria(this, ${index})">
                    • Includes ${trial.criteria ? trial.criteria.length : 0} inclusion bullet points <span class="toggle-arrow" style="font-size:9px; vertical-align:middle; margin-left:2px;">▶</span>
                </div>
                <ul id="inline-criteria-${index}" style="display:none; margin-top:6px; margin-bottom:6px; padding-left:20px; font-size:12px; color:#475569; list-style-type:disc; line-height:1.4;">
                    ${(trial.criteria || []).map(c => `<li style="margin-bottom:2px;">${c}</li>`).join('')}
                </ul>
            </div>
            <div class="queued-item-control-buttons">
                <button type="button" class="edit-option-inline-btn" onclick="editOptionFromStepQueue(${index})"><img src="images/pencil-svgrepo-com.svg" alt="" class="btn-icon-pencil"></button>
                <button type="button" class="remove-option-from-queue-btn" onclick="removeOptionFromStepQueue(${index})"><img src="images/trash-bin-minimalistic-svgrepo-com.svg" alt="" class="btn-icon-trash"></button>
            </div>
        </div>
    `).join('');
}

function removeOptionFromStepQueue(index) {
    if (editingTrialIndex === index) {
        clearDraftOptionForm();
    }
    stagedTrialsArray.splice(index, 1);
    renderQueuedTrialsList();
}

function clearDraftOptionForm() {
    console.log('[HHS DEBUG] clearDraftOptionForm:start', {
        editingTrialIndex,
        editingBulletIndex,
        stagedTrialsCount: stagedTrialsArray.length,
        activeBulletPointsCount: activeBulletPointsArr.length,
        stagedPdfFileCount: stagedPdfFiles.length
    });
    document.getElementById('tName').value = "";
    document.getElementById('tContact').value = "";
    document.getElementById('tDesc').value = "";
    document.getElementById('bulletInput').value = "";
    const fileSelectorInput = document.getElementById('pdfUpload');
    if (fileSelectorInput) fileSelectorInput.value = "";

    activeBulletPointsArr = [];
    stagedPdfFiles = [];
    editingTrialIndex = null;
    editingBulletIndex = null;
    document.getElementById('bulletPreviewList').innerHTML = "";

    renderStagedPdfList();

    document.querySelector('.add-bullet-btn').textContent = "+ Add Bullet";
    document.getElementById('trialDraftingCard').classList.remove('editing-active-pulse');
    document.getElementById('trialFormActionHeading').innerHTML = "➕ Add / Draft a Trial Option";
    document.getElementById('commitTrialBtn').textContent = "Attach Option to Step Data Matrix";
    document.getElementById('cancelTrialEditBtn').classList.add('hidden');

    console.log('[HHS DEBUG] clearDraftOptionForm:complete', {
        tName: document.getElementById('tName')?.value,
        tContact: document.getElementById('tContact')?.value,
        tDesc: document.getElementById('tDesc')?.value,
        bulletInput: document.getElementById('bulletInput')?.value,
        activeElementId: document.activeElement ? document.activeElement.id : null
    });
}

function saveNewStepAndReturn() {
    const computedStep = parseInt(document.getElementById('autoStepBadge').dataset.stepval);
    const title = getEditableFieldValue('newTitle');
    const prompt = getEditableFieldValue('newPrompt');
    const isInsertion = document.getElementById('autoStepBadge').dataset.isInsertion === "true";

    console.log('[HHS DEBUG] saveNewStepAndReturn:start', {
        editingStepNumber,
        computedStep,
        title,
        prompt,
        isInsertion,
        stagedTrialsCount: stagedTrialsArray.length
    });

    if (!title || !prompt) {
        alert("Validation Fault: A Stage Section Title and Clinical Question Prompt description are required parameters.");
        return;
    }

    console.log('[HHS DEBUG] saveNewStepAndReturn:fieldSnapshot', {
        title,
        prompt,
        titleElementState: {
            disabled: document.getElementById('newTitle')?.disabled,
            readOnly: document.getElementById('newTitle')?.readOnly,
            value: document.getElementById('newTitle')?.value
        },
        promptElementState: {
            disabled: document.getElementById('newPrompt')?.disabled,
            readOnly: document.getElementById('newPrompt')?.readOnly,
            value: document.getElementById('newPrompt')?.value
        }
    });

    let stepToFocus = computedStep;

    if (editingStepNumber !== null) {
        stepToFocus = editingStepNumber;
        const targetIdx = QUESTIONS_CONFIG.findIndex(q => q.step === editingStepNumber);
        if (targetIdx !== -1) {
            const originalNextPointer = QUESTIONS_CONFIG[targetIdx].ifNoGoToStep;
            QUESTIONS_CONFIG[targetIdx] = { step: editingStepNumber, title, prompt, ifNoGoToStep: originalNextPointer, trials: [...stagedTrialsArray], color: stagedStepColor };
        }
    } else if (isInsertion) {
        QUESTIONS_CONFIG.forEach(q => {
            if (q.step >= computedStep) q.step += 1;
        });
        QUESTIONS_CONFIG.push({ step: computedStep, title, prompt, ifNoGoToStep: null, trials: [...stagedTrialsArray], color: stagedStepColor });
    } else {
        if (QUESTIONS_CONFIG.length > 0) {
            QUESTIONS_CONFIG.sort((a, b) => a.step - b.step);
            QUESTIONS_CONFIG[QUESTIONS_CONFIG.length - 1].ifNoGoToStep = computedStep;
        }
        QUESTIONS_CONFIG.push({ step: computedStep, title, prompt, ifNoGoToStep: null, trials: [...stagedTrialsArray], color: stagedStepColor });
    }

    QUESTIONS_CONFIG.sort((a, b) => a.step - b.step);
    QUESTIONS_CONFIG.forEach((q, idx) => {
        q.ifNoGoToStep = (idx < QUESTIONS_CONFIG.length - 1) ? (QUESTIONS_CONFIG[idx + 1].step) : null;
    });

    console.log('[HHS DEBUG] saveNewStepAndReturn:postNormalize', {
        totalSteps: QUESTIONS_CONFIG.length,
        firstStep: QUESTIONS_CONFIG[0] ? QUESTIONS_CONFIG[0].step : null,
        lastStep: QUESTIONS_CONFIG.length > 0 ? QUESTIONS_CONFIG[QUESTIONS_CONFIG.length - 1].step : null,
        focusedStep: stepToFocus,
        savedStepSnapshot: QUESTIONS_CONFIG.find(q => q.step === stepToFocus) || null
    });

    attemptSave();
    buildWorkflowUI();
    closeControlPage();

    console.log('[HHS DEBUG] saveNewStepAndReturn:complete', { stepToFocus });

    const modifiedCard = document.getElementById(`cardStep-${stepToFocus}`);
    if (modifiedCard) {
        modifiedCard.classList.remove('hidden');
        modifiedCard.classList.add('active-card');
        modifiedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function toggleContentMode() {
    const mode = document.getElementById('contentModeSwitcher').value;
    const bulletContainer = document.getElementById('bulletModeContainer');
    const pdfContainer = document.getElementById('pdfModeContainer');

    if (mode === 'pdf') {
        bulletContainer.classList.add('hidden');
        pdfContainer.classList.remove('hidden');
    } else {
        bulletContainer.classList.remove('hidden');
        pdfContainer.classList.add('hidden');
    }
}

function handlePdfUpload(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const validFiles = [];
    const rejected = [];
    files.forEach(file => {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
            validFiles.push(file);
        } else {
            rejected.push(file.name);
        }
    });

    if (rejected.length > 0) {
        alert(`Skipped ${rejected.length} file(s) that aren't PDFs: ${rejected.join(', ')}`);
    }
    if (validFiles.length === 0) return;

    // Read every selected file as a data URL in parallel, then append them
    // all to the staged list once they're done — avoids re-rendering the
    // list once per file and racing partial updates.
    Promise.all(validFiles.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve({ name: file.name, data: e.target.result });
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
    }))).then(readFiles => {
        stagedPdfFiles.push(...readFiles);
        renderStagedPdfList();
        // Clear the input so selecting the same file(s) again later (e.g.
        // after removing one) still fires a change event.
        event.target.value = "";
    }).catch(err => {
        console.error('[HHS DEBUG] handlePdfUpload failed:', err);
        alert("One or more PDF files couldn't be read. Please try again.");
    });
}

// Rebuilds the staged-PDFs list in the editor — a row per file with a
// View (opens the fullscreen previewer) and Remove (drops just that one)
// button. Called after every upload, removal, or when loading an existing
// trial for editing.
function renderStagedPdfList() {
    const container = document.getElementById('pdfFilesList');
    if (!container) return;

    if (stagedPdfFiles.length === 0) {
        container.innerHTML = `<p style="color: #64748b; text-align: center; padding: 30px 10px;">No documents uploaded yet. Select one or more PDF files above.</p>`;
        return;
    }

    container.innerHTML = stagedPdfFiles.map((file, index) => `
        <div class="staged-pdf-row" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 4px; background: #ffffff; margin-bottom: 6px;">
            <span style="font-size: 13px; color: #334155; overflow-wrap: anywhere;">📄 ${file.name}</span>
            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                <button type="button" class="ctrl-btn" style="background: #2563eb; color: white; padding: 6px 10px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px;" onclick="window.openPdfInViewer(stagedPdfFiles[${index}].data, stagedPdfFiles[${index}].name)">View</button>
                <button type="button" class="ctrl-btn" style="background: #fee2e2; color: #dc2626; padding: 6px 10px; border-radius: 4px; border: none; cursor: pointer; font-size: 12px;" onclick="removeStagedPdfAt(${index})">Remove</button>
            </div>
        </div>
    `).join('');
}

// Removes a single staged PDF by index — the other files stay attached.
function removeStagedPdfAt(index) {
    stagedPdfFiles.splice(index, 1);
    renderStagedPdfList();
}

function toggleInlineCriteria(element, index) {
    const targetList = document.getElementById(`inline-criteria-${index}`);
    const arrow = element.querySelector('.toggle-arrow');

    if (targetList) {
        if (targetList.style.display === 'none') {
            targetList.style.display = 'block';
            if (arrow) arrow.textContent = '▼';
        } else {
            targetList.style.display = 'none';
            if (arrow) arrow.textContent = '▶';
        }
    }
}

function validateProtocol() {
    const errors = [];
    const config = Array.isArray(QUESTIONS_CONFIG) ? QUESTIONS_CONFIG : [];
    
    // 1. Get all valid step numbers
    const validStepNumbers = config.map(q => q.step);
    
    // 2. Check for Duplicate Step Numbers
    const uniqueSteps = new Set(validStepNumbers);
    if (uniqueSteps.size !== validStepNumbers.length) {
        errors.push("❌ Duplicate step numbers found. Please fix ordering.");
    }

    // 3. Loop through steps for content and logical orphans
    config.forEach((q) => {
        // Content checks
        if (!q.title || q.title.trim() === "") errors.push(`Step ${q.step} is missing a title.`);
        if (!q.prompt || q.prompt.trim() === "") errors.push(`Step ${q.step} is missing a prompt.`);
        
        // Orphan check: If "No" goes to a step, does that step exist?
        // Note: Check only if q.ifNoGoToStep is set (not null/undefined)
        if (q.ifNoGoToStep !== null && q.ifNoGoToStep !== undefined) {
            if (!validStepNumbers.includes(q.ifNoGoToStep)) {
                errors.push(`Step ${q.step} points to non-existent Step ${q.ifNoGoToStep}.`);
            }
        }
    });

    return { 
        isValid: errors.length === 0, 
        errors: errors 
    };
}