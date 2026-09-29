// Web-app config from Firebase console → Project settings → Your apps.
// These values are not secrets (they identify the project; access is enforced by
// firestore.rules + sign-in). Set apiKey to '' to run in local-only mode
// (configs stored in this browser's localStorage, no login).
export const firebaseConfig = {
  apiKey: 'AIzaSyAln9VmEGwVDBdo6hrloNb53PRSy8uUvh0',
  authDomain: 'microscope-optics.firebaseapp.com',
  projectId: 'microscope-optics',
  storageBucket: 'microscope-optics.firebasestorage.app',
  messagingSenderId: '1013336750875',
  appId: '1:1013336750875:web:d64899aedc15344f7ab1be',
};

// Usernames typed on the login screen get this suffix to form the Firebase
// email. Create users in the console as e.g. "alice@scope.lab".
export const USERNAME_DOMAIN = 'scope.lab';
