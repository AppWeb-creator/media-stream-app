import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCk866gWmDIIdv1HwlaExFzxVP_2DQsKEg',
  authDomain: 'ps-manager-140b1.firebaseapp.com',
  projectId: 'ps-manager-140b1',
  storageBucket: 'ps-manager-140b1.firebasestorage.app',
  messagingSenderId: '50503139288',
  appId: '1:50503139288:web:a613c776f717acaf657cad',
  measurementId: 'G-LTTVBSBCS4',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
