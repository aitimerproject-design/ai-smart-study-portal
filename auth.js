// =========================================================
// AI TIMER - AUTHENTICATION ENGINE (auth.js)
// =========================================================

const firebaseConfig = {
  apiKey: "AIzaSyC5X_133pN6wO6YvdbsB01OdokD1l9qpB4",
  authDomain: "ai-timer-project.firebaseapp.com",
  databaseURL: "https://ai-timer-project-default-rtdb.firebaseio.com",
  projectId: "ai-timer-project",
  storageBucket: "ai-timer-project.firebasestorage.app",
  messagingSenderId: "134965203763",
  appId: "1:134965203763:web:bd128c0ca23454666c2446"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();

let currentRole = "student"; // 'student' or 'parent'
let isSignUpMode = false;

// Switch Student / Parent Role
function switchRole(role) {
    currentRole = role;
    const btnStudent = document.getElementById("btnStudentRole");
    const btnParent = document.getElementById("btnParentRole");
    const title = document.getElementById("authTitle");

    if (role === "student") {
        btnStudent.style.opacity = "1";
        btnParent.style.opacity = "0.6";
        title.innerText = isSignUpMode ? "🎓 Student Signup" : "🎓 Student Login";
    } else {
        btnStudent.style.opacity = "0.6";
        btnParent.style.opacity = "1";
        title.innerText = isSignUpMode ? "👨‍👦 Parent Signup" : "👨‍👦 Parent Login";
    }
}

// Toggle Login vs Signup Mode
function toggleAuthMode() {
    isSignUpMode = !isSignUpMode;
    const title = document.getElementById("authTitle");
    const submitBtn = document.getElementById("btnSubmit");
    const toggleText = document.getElementById("toggleText");
    const toggleLink = document.getElementById("toggleLink");

    if (isSignUpMode) {
        title.innerText = currentRole === "student" ? "🎓 Student Signup" : "👨‍👦 Parent Signup";
        submitBtn.innerText = "Create Account";
        toggleText.innerText = "Already have an account?";
        toggleLink.innerText = "Login";
    } else {
        title.innerText = currentRole === "student" ? "🎓 Student Login" : "👨‍👦 Parent Login";
        submitBtn.innerText = "Login";
        toggleText.innerText = "Don't have an account?";
        toggleLink.innerText = "Sign Up";
    }
}

// Handle Login / Signup Action
function handleAuthSubmit() {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value.trim();

    if (!email || !password) {
        alert("Bhai, Email aur Password dono bharna zaroori hai!");
        return;
    }

    if (isSignUpMode) {
        // Sign Up
        auth.createUserWithEmailAndPassword(email, password)
            .then((userCredential) => {
                alert("Account Created Successfully! Redirecting...");
                redirectToDashboard();
            })
            .catch((error) => alert("Signup Error: " + error.message));
    } else {
        // Login
        auth.signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                redirectToDashboard();
            })
            .catch((error) => alert("Login Error: " + error.message));
    }
}

// Redirect based on selected Role
function redirectToDashboard() {
    if (currentRole === "student") {
        window.location.href = "index.html";
    } else {
        window.location.href = "parent.html";
    }
}