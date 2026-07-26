const crypto = require('crypto');

/** Format: NK-XXXXXXXX-XXXXXXXX-XXXXXXXX  (96-bit hex, uppercase) */
function generateKey() {
  const hex = crypto.randomBytes(12).toString('hex').toUpperCase();
  return `NK-${hex.slice(0,8)}-${hex.slice(8,16)}-${hex.slice(16,24)}`;
}

module.exports = { generateKey };
