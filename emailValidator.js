const dns = require('dns').promises;

// Known temporary, throwaway, and disposable email domains blacklist
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', 'guerrillamail.com', 'guerrillamailblock.com',
  '10minutemail.com', '10minutemail.net', 'throwawaymail.com', 'sharklasers.com', 'yopmail.com',
  'dispostable.com', 'trashmail.com', 'trashmail.net', 'fakeinbox.com', 'generator.email',
  'mohmal.com', 'burnermail.io', 'crazymailing.com', 'tmpmail.org', 'mytemp.email',
  'maildrop.cc', 'getairmail.com', 'inboxkitten.com', 'nada.ltd', 'emailondeck.com',
  'fakemailgenerator.com', 'dropmail.me', 'tempinbox.com', 'fakemail.net', 'minuteinbox.com'
]);

// Google specific mail exchangers
const GOOGLE_MX_PATTERNS = [
  'google.com',
  'googlemail.com',
  'aspmx.l.google.com',
  'alt1.aspmx.l.google.com',
  'alt2.aspmx.l.google.com',
  'alt3.aspmx.l.google.com',
  'alt4.aspmx.l.google.com',
  'smtp.google.com'
];

/**
 * Validates email authenticity, structural validity, and Google / DNS MX verification.
 * @param {string} email
 * @returns {Promise<{ isValid: boolean, error?: string, isGoogle?: boolean, domain?: string }>}
 */
async function validateEmailAuthenticity(email) {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }

  const cleanEmail = email.trim().toLowerCase();

  // 1. Basic RFC format syntax verification
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(cleanEmail)) {
    return { isValid: false, error: 'The email address format is invalid.' };
  }

  const [username, domain] = cleanEmail.split('@');

  if (!username || !domain || username.length > 64 || domain.length > 255) {
    return { isValid: false, error: 'The email address length exceeds standard limits.' };
  }

  // 2. Reject disposable / temporary fake email addresses
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      isValid: false,
      error: 'Temporary and disposable email addresses are not permitted on EasyMarket for fraud prevention.'
    };
  }

  // 3. Google (@gmail.com or @googlemail.com) specific verification rules
  const isGoogleDomain = domain === 'gmail.com' || domain === 'googlemail.com';
  if (isGoogleDomain) {
    // Google usernames must be between 6 and 30 characters
    if (username.length < 6) {
      return {
        isValid: false,
        error: 'Google (@gmail.com) username must be at least 6 characters long.'
      };
    }
    if (username.length > 30) {
      return {
        isValid: false,
        error: 'Google (@gmail.com) username cannot exceed 30 characters.'
      };
    }
    // Google only allows alphanumeric characters and periods (no consecutive periods, cannot start or end with period)
    if (!/^[a-z0-9]+(\.[a-z0-9]+)*$/.test(username)) {
      return {
        isValid: false,
        error: 'Google (@gmail.com) email contains invalid characters or consecutive dots.'
      };
    }
  }

  // 4. DNS MX record validation (checks if the domain has active, registered mail servers)
  try {
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('DNS_TIMEOUT')), 3000)
    );

    const mxRecords = await Promise.race([
      dns.resolveMx(domain),
      timeoutPromise
    ]);

    if (!mxRecords || mxRecords.length === 0) {
      return {
        isValid: false,
        error: `The email domain "@${domain}" does not have active mail servers to receive messages.`
      };
    }

    // Check if the MX records belong to Google Workspace
    const isGoogleMx = mxRecords.some(r => 
      GOOGLE_MX_PATTERNS.some(p => r.exchange.toLowerCase().includes(p))
    );

    return {
      isValid: true,
      isGoogle: isGoogleDomain || isGoogleMx,
      domain
    };
  } catch (err) {
    if (err.message === 'DNS_TIMEOUT') {
      // In case of transient DNS timeout, accept valid syntax to avoid blocking authentic users
      return { isValid: true, isGoogle: isGoogleDomain, domain };
    }

    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA' || err.code === 'EREFUSED') {
      return {
        isValid: false,
        error: `The email domain "@${domain}" could not be verified or is not a registered mail server.`
      };
    }

    // Default fallback to allow legitimate users if DNS is unreachable in test container
    return { isValid: true, isGoogle: isGoogleDomain, domain };
  }
}

module.exports = {
  validateEmailAuthenticity,
  DISPOSABLE_DOMAINS
};
