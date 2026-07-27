const express = require('express');
const router  = express.Router();
const { db }  = require('../db/firebase');

/**
 * GET /api/plans
 *
 * Deliberately fetches the whole (tiny — 4 docs) collection and filters and
 * sorts in JS. Doing `.where('is_active','==',true).orderBy('order')` in
 * Firestore would pair an equality filter with an orderBy on a different
 * field, which needs a hand-built composite index before it will run at all.
 * Not worth making every deployment do that for four documents.
 */
router.get('/', async (req, res) => {
  try {
    const snap = await db.collection('plans').get();

    const plans = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.is_active !== false)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

    res.json({ success: true, plans });
  } catch (err) {
    console.error('[PLANS]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
