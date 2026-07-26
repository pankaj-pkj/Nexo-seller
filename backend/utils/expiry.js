const { db } = require('../db/firebase');

const BATCH_MAX = 450;   // Firestore hard-caps a write batch at 500 ops

/**
 * Flips is_active=false on every key whose expires_at has passed.
 *
 * The expiry comparison is done in JS rather than as a Firestore `<` filter on
 * purpose: Firestore orders null before timestamps, so a range query would also
 * sweep up lifetime keys (expires_at == null) and kill them. Runs once a day.
 */
async function expireKeys() {
  const now  = new Date();
  const snap = await db.collection('api_keys')
    .where('is_active', '==', true)
    .get();

  const stale = snap.docs.filter(doc => {
    const { expires_at } = doc.data();
    if (!expires_at) return false;                       // lifetime — never expires
    const exp = expires_at.toDate ? expires_at.toDate() : new Date(expires_at);
    return exp < now;
  });

  // Commit in chunks so a large backlog doesn't blow the 500-op batch limit
  for (let i = 0; i < stale.length; i += BATCH_MAX) {
    const batch = db.batch();
    stale.slice(i, i + BATCH_MAX).forEach(doc => batch.update(doc.ref, { is_active: false }));
    await batch.commit();
  }

  return stale.length;
}

module.exports = { expireKeys };
