const express = require('express');
const router  = express.Router();
const { db }  = require('../db/firebase');

router.get('/', async (req, res) => {
  try {
    const snap = await db.collection('plans')
      .where('is_active', '==', true)
      .orderBy('order')
      .get();

    const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ success: true, plans });
  } catch (err) {
    console.error('[PLANS]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
