import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '@/firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
  login_hint: 'abdullahmohamedharoon8@gmail.com',
});

export const firebaseProjectInfo = {
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId,
  authDomain: firebaseConfig.authDomain,
  bootstrappedAdminEmail: 'abdullahmohamedharoon8@gmail.com',
  bootstrappedAdminEmails: [
    'abdullahmohamedharoon8@gmail.com',
    'abdullahharoon360@gmail.com',
  ],
};

export async function testFirestoreConnection(): Promise<{
  reachable: boolean;
  offline: boolean;
  errorMessage?: string;
}> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { reachable: true, offline: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { reachable: false, offline: true, errorMessage: message };
    }
    // A permission-denied response proves the client reached Firestore online
    return { reachable: true, offline: false };
  }
}

void testFirestoreConnection();
