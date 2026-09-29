// Import the necessary Auth functions from Firebase
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged,
    signOut 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"; // Match your current Firebase version!

// Get the auth instance (assuming 'app' is your initialized Firebase app)
const auth = getAuth(app);

// Get your DOM elements
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginError = document.getElementById('login-error');

// --- 1. Watch the user's login state ---
// Firebase automatically remembers if the user logged in previously!
onAuthStateChanged(auth, (user) => {
    if (user) {
        // User is signed in, show the main app
        console.log("Logged in as:", user.email);
        loginContainer.style.display = 'none';
        appContainer.style.display = 'block';
    } else {
        // User is signed out, show the login screen
        loginContainer.style.display = 'block';
        appContainer.style.display = 'none';
    }
});

// --- 2. Handle the Login Button ---
document.getElementById('login-button').addEventListener('click', () => {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;
    
    // Hide previous errors
    loginError.style.display = 'none'; 

    signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Success! The onAuthStateChanged listener will automatically switch the UI
            console.log("Success! Firebase token generated.");
        })
        .catch((error) => {
            // Failure (wrong password, invalid email, etc.)
            loginError.innerText = "Error: " + error.message;
            loginError.style.display = 'block';
        });
});

// --- 3. Handle the Logout Button (Optional but recommended) ---
document.getElementById('logout-button').addEventListener('click', () => {
    signOut(auth).then(() => {
        console.log("Successfully logged out.");
    }).catch((error) => {
        console.error("Error logging out:", error);
    });
});

async function configurePersistence(rememberMe) {
    const auth = getAuth();
    const persistence = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    
    try {
        await setPersistence(auth, persistence);
    } catch (error) {
        console.error("Persistence error:", error);
    }
}