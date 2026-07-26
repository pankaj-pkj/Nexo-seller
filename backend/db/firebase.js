const admin = require('firebase-admin');

if (!admin.apps.length) {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n');   // Render stores \n as literal \\n

  if (!process.env.FIREBASE_PROJECT_ID || !privateKey) {
    console.error('❌  Missing Firebase env vars. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY');
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db };
