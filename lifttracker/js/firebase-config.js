// Firebase project configuration.
//
// This is the project that AI Studio provisioned for the original LiftTracker app, so
// signing in here shows the same routines / history you already have in the cloud.
// Web API keys are public identifiers, not secrets — access is governed by Firestore rules.
//
// To point at a different project, paste a new `firebaseConfig` from
// Firebase console → Project settings → Your apps, and set `firestoreDatabaseId`
// to '(default)' unless you created a named database.
export const firebaseConfig = {
  projectId: 'gen-lang-client-0529107446',
  appId: '1:906425567579:web:4e067b58abe0d81ca4327e',
  apiKey: 'AIzaSyCcLVWM8f9N8X4suT_E5HOsbjQCjZfcXfY',
  authDomain: 'gen-lang-client-0529107446.firebaseapp.com',
  storageBucket: 'gen-lang-client-0529107446.firebasestorage.app',
  messagingSenderId: '906425567579',
  firestoreDatabaseId: 'ai-studio-6522f832-f09e-46af-bb93-9dd556445ef9',
};

// Set to false to run purely on-device (no sign-in UI).
export const CLOUD_ENABLED = true;

// Firebase JS SDK version served from the gstatic CDN (no bundler needed).
export const FIREBASE_VERSION = '12.11.0';
