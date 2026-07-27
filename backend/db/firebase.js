const admin = require('firebase-admin');

/**
 * Credentials can be supplied two ways:
 *
 *   1. FIREBASE_SERVICE_ACCOUNT — the entire service-account JSON, pasted as
 *      one value. This is the easy path: download the file from Firebase,
 *      paste it whole, done. One env var instead of three.
 *
 *   2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY —
 *      the three fields separately, for hosts that dislike long values.
 *
 * Option 1 wins if both are present.
 */
function loadCredentials() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();

  if (raw) {
    let json;
    try {
      // Some dashboards mangle a pasted JSON blob; base64 is accepted too
      const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      json = JSON.parse(text);
    } catch (e) {
      console.error('❌  FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
      console.error('    Paste the whole service-account file, starting with { and ending with }');
      process.exit(1);
    }

    if (!json.project_id || !json.client_email || !json.private_key) {
      console.error('❌  FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.');
      process.exit(1);
    }

    return {
      projectId:   json.project_id,
      clientEmail: json.client_email,
      privateKey:  String(json.private_key).replace(/\\n/g, '\n')
    };
  }

  // Fall back to the three separate vars
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    console.error('❌  No Firebase credentials found.');
    console.error('    Easiest: set FIREBASE_SERVICE_ACCOUNT to the whole service-account JSON.');
    console.error('    Or set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.');
    process.exit(1);
  }

  return {
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey
  };
}

if (!admin.apps.length) {
  const creds = loadCredentials();
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  console.log(`[FIREBASE] Connected to project ${creds.projectId}`);
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, db };
