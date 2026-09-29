const ENC_PREFIX = 'enc:v1:';       // marks a value as encrypted by this module
const PBKDF2_SALT = 'hhs-protocol-storage-salt-v1'; // not secret — just needs to be stable
const PBKDF2_ITERATIONS = 100000;

let encryptionKey = null; // cached CryptoKey for the current session, cleared on logout

function isEncryptionSupported() {
    return typeof window !== 'undefined' && window.crypto && window.crypto.subtle;
}

// Derives and caches the AES key for the given Firebase UID. Call this
// once right after a successful login (see firebase-sync.js). Safe to
// call again with the same UID — it's a no-op if already cached.
async function initEncryptionKey(uid) {
    if (!isEncryptionSupported() || !uid) {
        encryptionKey = null;
        return;
    }
    try {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(uid),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        encryptionKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: enc.encode(PBKDF2_SALT),
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256',
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        logSyncDebug?.('crypto:keyReady', {});
    } catch (err) {
        console.error('[HHS CRYPTO] Failed to derive encryption key — falling back to plaintext storage:', err);
        encryptionKey = null;
    }
}

// Call on logout so the key doesn't linger in memory for the next person
// to use this device/browser profile.
function clearEncryptionKey() {
    encryptionKey = null;
}

function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

// Encrypts a plaintext string for storage. If no key is available (no
// Firebase Auth configured, or key derivation failed), returns the
// plaintext UNCHANGED — this keeps the local-dev-without-Firebase path
// working exactly as before, since there's no user session to key off of
// in that case anyway.
async function encryptForStorage(plaintext) {
    if (plaintext === null || plaintext === undefined) return plaintext;
    if (!encryptionKey) return plaintext;

    try {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plaintext);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, encoded);
        return ENC_PREFIX + bufferToBase64(iv) + ':' + bufferToBase64(ciphertext);
    } catch (err) {
        console.error('[HHS CRYPTO] Encryption failed — storing as plaintext:', err);
        return plaintext;
    }
}

// Decrypts a value read back from storage. Transparently handles three
// cases: a value encrypted by this module, legacy/unencrypted plaintext
// from before this feature existed, and a null/missing value. Never
// throws — worst case it returns what it was given, so a corrupt or
// undecryptable value doesn't hard-crash the app (it'll just fail
// JSON.parse upstream, same as any other bad data would have before).
async function decryptFromStorage(stored) {
    if (stored === null || stored === undefined) return stored;
    if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext — pass through

    if (!encryptionKey) {
        console.warn('[HHS CRYPTO] Found encrypted data but no key is loaded (not logged in yet?).');
        return null;
    }

    try {
        const [ivB64, dataB64] = stored.slice(ENC_PREFIX.length).split(':');
        const iv = new Uint8Array(base64ToBuffer(ivB64));
        const ciphertext = base64ToBuffer(dataB64);
        const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, ciphertext);
        return new TextDecoder().decode(plainBuffer);
    } catch (err) {
        console.error('[HHS CRYPTO] Decryption failed (wrong key, or data from a different account?):', err);
        return null;
    }
}