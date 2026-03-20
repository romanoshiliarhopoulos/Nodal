import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDuRxWodtBftlj0tUJv-8zQM1yKm2flCFo",
  authDomain: "nodal-4e6a0.firebaseapp.com",
  projectId: "nodal-4e6a0",
  storageBucket: "nodal-4e6a0.firebasestorage.app",
  messagingSenderId: "668963156881",
  appId: "1:668963156881:web:01897eefc92da35f4ae030",
  measurementId: "G-W1E6VSKPE9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
