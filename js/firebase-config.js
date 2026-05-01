// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// TODO: Replace with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyBgIe6XqeMLEepAjxxMOh869FFJH_elVNM",
  authDomain: "estinol2.firebaseapp.com",
  projectId: "estinol2",
  storageBucket: "estinol2.firebasestorage.app",
  messagingSenderId: "577733338609",
  appId: "1:577733338609:web:4306c2daa1c55e19709050"
};

// Initialize Firebase
let app, auth, db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("Firebase initialized successfully.");
} catch (error) {
  console.error("Firebase initialization error:", error);
}

export { auth, db };