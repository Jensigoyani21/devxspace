// src/services/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // ✅ Firestore instead
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBkayhyWcB4T7uAEaHyw7x1VTMN6GUxcVs",
  authDomain: "dexspace-a48b2.firebaseapp.com",
  projectId: "dexspace-a48b2",
  storageBucket: "dexspace-a48b2.appspot.com", // fix typo: should be `.appspot.com`
  messagingSenderId: "509060697268",
  appId: "1:509060697268:web:a289fd89ef783f402d5be1",
  measurementId: "G-1YWEG82BYB"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app); // ✅ Correct one
