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

let credentials = null;

if (!admin.apps.length) {
  credentials = loadCredentials();
  admin.initializeApp({ credential: admin.credential.cert(credentials) });
  console.log(`[FIREBASE] Initialised for project ${credentials.projectId}`);
}

const db = admin.firestore();

// On a serverless host (Vercel), firebase-admin's default gRPC transport opens
// an HTTP/2 connection that the platform can freeze between invocations. The
// next call then hangs until the function times out — and Vercel answers a
// hung function with an HTML error page, which is why a normal-looking request
// can come back as "Unexpected token '<'". Forcing the REST transport avoids
// the long-lived gRPC socket entirely and is the recommended setting there.
// Default it on under Vercel; a env var can still override it either way.
if (process.env.FIRESTORE_PREFER_REST === undefined && process.env.VERCEL) {
  process.env.FIRESTORE_PREFER_REST = 'true';
}
db.settings({
  ignoreUndefinedProperties: true,
  preferRest: /^(1|true|yes)$/i.test(process.env.FIRESTORE_PREFER_REST || '')
});

/**
 * Which project and identity we are actually talking to.
 *
 * Worth exposing because the two failures people hit here — a service-account
 * JSON from a different (or deleted) project, and an identity without Firestore
 * access — both surface as an opaque PERMISSION_DENIED. Being able to read back
 * the project id turns that into a one-glance diagnosis.
 */
const identity = {
  projectId:   credentials?.projectId   || null,
  clientEmail: credentials?.clientEmail || null,
  source:      process.env.FIREBASE_SERVICE_ACCOUNT ? 'FIREBASE_SERVICE_ACCOUNT' : 'FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY'
};

module.exports = { admin, db, identity };
