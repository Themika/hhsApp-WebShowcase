if (typeof require === 'undefined') {
    window.require = function(moduleName) {
        console.warn("Blocked attempt to require: " + moduleName);
        return {}; // Return empty object so the app doesn't crash
    };
}
// Lower-level: shows any PDF data URL in the fullscreen overlay. Used both
// by the screening-view path below (openFullscreenPdfViewer, for already-
// saved trials) and directly by the editor (editor-tools.js) to preview a
// staged, not-yet-saved PDF before it's attached to a trial.
window.openPdfInViewer = function(pdfDataUrl, title) {
    if (!pdfDataUrl) {
        alert("Execution Error: No protocol asset mapped for this entry.");
        return;
    }

    const overlay = document.getElementById('fullscreenPdfOverlay');
    const frame = document.getElementById('fullscreenPdfFrame');
    const titleLabel = document.getElementById('fullscreenPdfTitle');

    if (overlay && frame && titleLabel) {
        titleLabel.textContent = title || 'Protocol Reference Document';
        frame.src = pdfDataUrl;
        overlay.style.display = 'flex';
    }
};

// cachedIndex = which trial in the current results list; pdfIndex = which
// PDF within that trial's pdfFiles array (defaults to the first). Falls
// back to the old singular trial.pdfData field for trials saved before
// multi-PDF support existed.
window.openFullscreenPdfViewer = function(cachedIndex, pdfIndex = 0) {
    const trialObj = window.activeMatchesRuntimeCache ? window.activeMatchesRuntimeCache[cachedIndex] : null;
    if (!trialObj) {
        alert("Execution Error: No protocol asset mapped for this entry.");
        return;
    }

    const file = Array.isArray(trialObj.pdfFiles) && trialObj.pdfFiles.length > 0
        ? trialObj.pdfFiles[pdfIndex]
        : (pdfIndex === 0 && trialObj.pdfData ? { name: trialObj.name, data: trialObj.pdfData } : null);

    if (!file || !file.data) {
        alert("Execution Error: No protocol asset mapped for this entry.");
        return;
    }

    window.openPdfInViewer(file.data, `Protocol Reference Map — ${trialObj.name}${file.name ? ' (' + file.name + ')' : ''}`);
};

window.closeFullscreenPdfViewer = function() {
    const overlay = document.getElementById('fullscreenPdfOverlay');
    const frame = document.getElementById('fullscreenPdfFrame');
    if (overlay && frame) {

        // The embedded PDF plugin view can hold onto keyboard focus even
        // after this iframe is hidden/cleared, which silently blocks
        // typing anywhere else in the app afterward. Explicitly blur it
        // and hand focus back to the document before tearing it down.
        try { frame.blur(); } catch (e) {}

        overlay.style.display = 'none';
        frame.src = "";

        if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
        document.body.focus();
    }
};