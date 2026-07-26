/**
 * Run once: node utils/seedPlans.js
 * Seeds 4 subscription plans into Firebase Firestore.
 */
require('dotenv').config();
const { db } = require('../db/firebase');

const plans = [
  {
    id:             'daily',
    name:           'Daily',
    price_usd:      2,
    duration_days:  1,
    requests_limit: 100,
    description:    'Perfect for quick testing',
    features:       ['100 API Requests', '1 Day Access', 'Full Endpoint Coverage', 'Basic Support'],
    api_target:     'api1',
    color:          '#3B82F6',
    is_active:      true,
    order:          1
  },
  {
    id:             'weekly',
    name:           'Weekly',
    price_usd:      8,
    duration_days:  7,
    requests_limit: 1000,
    description:    'Great for small projects',
    features:       ['1,000 API Requests', '7 Day Access', 'Full Endpoint Coverage', 'Email Support'],
    api_target:     'api1',
    color:          '#8B5CF6',
    is_active:      true,
    order:          2
  },
  {
    id:             'monthly',
    name:           'Monthly',
    price_usd:      25,
    duration_days:  30,
    requests_limit: 10000,
    description:    'Best for growing applications',
    features:       ['10,000 API Requests', '30 Day Access', 'Full Endpoint Coverage', 'Priority Support', 'Usage Analytics'],
    api_target:     'api1',
    color:          '#6366F1',
    is_active:      true,
    order:          3
  },
  {
    id:             'lifetime',
    name:           'Lifetime',
    price_usd:      60,
    duration_days:  null,   // null = never expires
    requests_limit: null,   // null = unlimited
    description:    'One-time payment, forever access',
    features:       ['Unlimited API Requests', 'Never Expires', 'Full Endpoint Coverage', '24/7 Priority Support', 'Usage Analytics', 'Early Access to New APIs'],
    api_target:     'api1',
    color:          '#F59E0B',
    is_active:      true,
    order:          4
  }
];

async function seed() {
  console.log('Seeding plans...');
  for (const plan of plans) {
    const { id, ...data } = plan;
    await db.collection('plans').doc(id).set({ ...data, created_at: new Date() });
    console.log(`  ✓ ${plan.name} — $${plan.price_usd} USDT`);
  }
  console.log('\nDone! All plans seeded.\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
