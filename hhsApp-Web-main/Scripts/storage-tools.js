function validateProtocol() {
    const errors = [];
    const steps = Array.isArray(QUESTIONS_CONFIG) ? QUESTIONS_CONFIG : [];

    const stepNumberCounts = {};
    steps.forEach(q => {
        stepNumberCounts[q.step] = (stepNumberCounts[q.step] || 0) + 1;
    });
    Object.entries(stepNumberCounts).forEach(([stepNum, count]) => {
        if (count > 1) {
            errors.push(`Step number ${stepNum} is used by ${count} different steps — step numbers must be unique.`);
        }
    });

    // Empty title / prompt
    steps.forEach(q => {
        if (!q.title || !q.title.trim()) errors.push(`Step ${q.step}: title is empty.`);
        if (!q.prompt || !q.prompt.trim()) errors.push(`Step ${q.step}: prompt text is empty.`);
    });

    const validStepNumbers = new Set(steps.map(q => q.step));
    steps.forEach(q => {
        const target = q.ifNoGoToStep;
        if (target !== null && target !== undefined && !validStepNumbers.has(target)) {
            errors.push(`Step ${q.step}: "No" branch points to Step ${target}, which doesn't exist.`);
        }
    });

    return { isValid: errors.length === 0, errors };
}

let currentFileHandle = null; 

function logImportDebug(stage, details = {}) {
    console.log(`[HHS DEBUG] ${stage}`, details);
}

const MAX_LOCAL_BACKUPS = 3;

function rotateLocalBackups(previousDataString) {
    if (!previousDataString) return;
    try {
        const backups = JSON.parse(localStorage.getItem('hhsQuestionsConfigBackups') || '[]');
        backups.unshift({ timestamp: Date.now(), data: previousDataString });
        while (backups.length > MAX_LOCAL_BACKUPS) backups.pop();
        localStorage.setItem('hhsQuestionsConfigBackups', JSON.stringify(backups));
    } catch (err) {
        console.error('Backup rotation failed:', err);
    }
}

function listLocalBackups() {
    try {
        return JSON.parse(localStorage.getItem('hhsQuestionsConfigBackups') || '[]');
    } catch (err) {
        return [];
    }
}

async function restoreLocalBackup(index) {
    const backups = listLocalBackups();
    const target = backups[index];
    if (!target) {
        alert('That backup is no longer available.');
        return;
    }
    const confirmed = confirm(`Restore the version saved at ${new Date(target.timestamp).toLocaleString()}? Your current data will be saved as a backup first, so this itself can be undone.`);
    if (!confirmed) return;

    const decryptedData = typeof decryptFromStorage === 'function'
        ? await decryptFromStorage(target.data)
        : target.data;
    if (!decryptedData) {
        alert("Couldn't read that backup — it may have been saved under a different account.");
        return;
    }

    QUESTIONS_CONFIG = JSON.parse(decryptedData);
    await commitDatabaseChangesToDisk({ immediate: true, changeDescription: `Restored backup from ${new Date(target.timestamp).toLocaleString()}` });
    buildWorkflowUI();
    showToast?.('Backup restored.', { duration: 4000 });
}
async function commitDatabaseChangesToDisk(opts = {}) {
    if (typeof canEdit === 'function' && !canEdit()) {
        console.warn('[HHS DEBUG] Blocked save — current account has view-only access.');
        showToast?.("You have view-only access and can't save changes.", { duration: 5000 });
        return;
    }

    const updatedDataString = JSON.stringify(QUESTIONS_CONFIG, null, 2);

    const previousDataStringRaw = localStorage.getItem('hhsQuestionsConfig');
    const previousDataStringPlain = previousDataStringRaw && typeof decryptFromStorage === 'function'
        ? await decryptFromStorage(previousDataStringRaw)
        : previousDataStringRaw;

    if (previousDataStringRaw && previousDataStringPlain !== updatedDataString) {
        rotateLocalBackups(previousDataStringRaw);
    }

    if (isNativePlatform() && window.Capacitor?.Plugins?.Filesystem) {
        const { Filesystem } = window.Capacitor.Plugins;
        try {
            await Filesystem.writeFile({
                path: 'questions.txt',
                directory: 'DATA',
                data: updatedDataString,
                encoding: 'utf8'
            });
            logImportDebug('commitDatabaseChangesToDisk:savedNative', { directory: 'DATA' });
        } catch (err) {
            console.error('Native filesystem save failed:', err);
        }
        await pushConfigToCloud(updatedDataString, { ...opts, previousDataString: previousDataStringPlain });
        updateStatusBar?.();
        return;
    }

    try {
        const toStore = typeof encryptForStorage === 'function'
            ? await encryptForStorage(updatedDataString) 
            : updatedDataString;
        localStorage.setItem('hhsQuestionsConfig', toStore);
        localStorage.setItem('hhsLastSavedAt', String(Date.now()));
        logImportDebug('commitDatabaseChangesToDisk:savedLocalStorage', {});
    } catch (err) {
        console.error('localStorage save failed:', err);
    }

    await pushConfigToCloud(updatedDataString, { ...opts, previousDataString: previousDataStringPlain });
    updateStatusBar?.();
}

async function exportDatabaseToFile() {
    const updatedDataString = JSON.stringify(QUESTIONS_CONFIG, null, 2);

    if (isNativePlatform() && window.Capacitor?.Plugins?.Filesystem) {
        const { Filesystem, Share } = window.Capacitor.Plugins;
        try {
            const written = await Filesystem.writeFile({
                path: 'questions.txt',
                directory: 'CACHE',
                data: updatedDataString,
                encoding: 'utf8'
            });

            if (Share) {
                await Share.share({
                    title: 'Export Protocol Data',
                    text: 'HHS protocol data export',
                    url: written.uri,
                    dialogTitle: 'Save or send questions.txt'
                });
            } else {
                alert("Exported file saved to app cache (no Share plugin installed to hand it off — run `npm install @capacitor/share && npx cap sync`).");
            }
            logImportDebug('exportDatabaseToFile:savedNative', { uri: written.uri });
        } catch (err) {
            if (err?.message !== 'Share canceled') {
                console.error('Export failed:', err);
                alert("Failed to export file: " + err.message);
            }
        }
        return;
    }

    if ('showSaveFilePicker' in window) {
        try {
            if (!currentFileHandle) {
                currentFileHandle = await window.showSaveFilePicker({
                    suggestedName: 'questions.txt',
                    types: [{ description: 'JSON File', accept: { 'application/json': ['.txt', '.json'] } }],
                });
            }
            const writable = await currentFileHandle.createWritable();
            await writable.write(updatedDataString);
            await writable.close();
            logImportDebug('exportDatabaseToFile:savedNative', { path: currentFileHandle.name });
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Export failed:', err);
                alert("Failed to export file: " + err.message);
            }
        }
    } else {
        downloadTxtFile();
    }
}

function downloadTxtFile() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(QUESTIONS_CONFIG, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "questions.txt");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

async function triggerTxtImport() {
    document.getElementById('importTxtInput').click();
}

async function applyImportedTxtPayload(jsonString, filePath) {
    const importedData = JSON.parse(jsonString);
    QUESTIONS_CONFIG = importedData;

    activeDataFilePath = filePath;

    await attemptSave({ immediate: true, changeDescription: `Imported protocol (${Array.isArray(importedData) ? importedData.length : '?'} steps)` });

    buildWorkflowUI();

    closeControlPage();

    alert("✅ Data imported successfully");
    window.location.reload();
}

async function attemptSave(opts = {}) {
    const validation = validateProtocol();

    if (!validation.isValid) {
        alert("Cannot Save:\n\n" + validation.errors.join("\n"));
        return; 
    }

    await commitDatabaseChangesToDisk(opts);
    
    console.log("[HHS DEBUG] Save validated and committed successfully.");
}
function handleTxtImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    logImportDebug('handleTxtImport:fileSelected', {
        name: file.name,
        type: file.type,
        size: file.size
    });

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            applyImportedTxtPayload(e.target.result, file.name || null);
        } catch (err) {
            alert("Error importing: " + err.message);
        }
        if (event.target) {
            event.target.value = "";
        }
    };
    reader.readAsText(file);
}