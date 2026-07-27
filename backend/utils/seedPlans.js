/**
 * The 4 subscription plans, and the seeding logic that writes them.
 *
 * Two ways to run it:
 *   • CLI     — `npm run seed` (needs a terminal)
 *   • Admin   — POST /api/admin/seed, or the "Seed plans" button in admin.html,
 *               for anyone setting the project up without a laptop.
 */
require('dotenv').config();
const { db } = require('../db/firebase');

/**
 * Which upstream(s) every seeded plan proxies to:
 *   'api1'  — only the first upstream
 *   'api2'  — only the second
 *   'both'  — call both in parallel and merge the responses into one
 *
 * Set DEFAULT_API_TARGET in the environment to change it, then re-seed with
 * force. Per-plan values can still be edited directly in Firestore afterwards.
 */
const API_TARGET = process.env.DEFAULT_API_TARGET || 'api1';

const plans = [
  {
    id:             'daily',
    name:           'Daily',
    price_usd:      2,
    duration_days:  1,
    requests_limit: 100,
    description:    'Perfect for quick testing',
    features:       ['100 API Requests', '1 Day Access', 'Full Endpoint Coverage', 'Basic Support'],
    api_target:     API_TARGET,
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
    api_target:     API_TARGET,
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
    api_target:     API_TARGET,
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
    api_target:     API_TARGET,
    color:          '#F59E0B',
    is_active:      true,
    order:          4
  }
];

/**
 * Writes the plans to Firestore.
 * Existing plans are left alone unless `force` is set — so hitting the admin
 * button twice can never wipe prices you edited by hand in the console.
 */
async function seedPlans({ force = false } = {}) {
  const created = [], skipped = [];

  for (const plan of plans) {
    const { id, ...data } = plan;
    const ref = db.collection('plans').doc(id);

    if (!force && (await ref.get()).exists) { skipped.push(id); continue; }

    await ref.set({ ...data, created_at: new Date() });
    created.push(id);
  }

  return { created, skipped };
}

module.exports = { plans, seedPlans };

// CLI mode — only when run directly, not when required by the server
if (require.main === module) {
  const force = process.argv.includes('--force');
  console.log(`Seeding plans${force ? ' (force: overwriting existing)' : ''}...`);

  seedPlans({ force })
    .then(({ created, skipped }) => {
      created.forEach(id => console.log(`  ✓ wrote    ${id}`));
      skipped.forEach(id => console.log(`  – skipped  ${id} (already exists, use --force to overwrite)`));
      console.log('\nDone.\n');
      process.exit(0);
    })
    .catch(err => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
}
