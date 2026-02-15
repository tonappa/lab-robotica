// ============================================================
//  Firebase Configuration — Lab Robotica
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB2CGxkBaGEKw1QXYKBTNYBJkINPWt2KZM",
    authDomain: "lab-robotica.firebaseapp.com",
    projectId: "lab-robotica",
    storageBucket: "lab-robotica.firebasestorage.app",
    messagingSenderId: "1019224610908",
    appId: "1:1019224610908:web:181f0bbc9849baa1e7ae99"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot };
