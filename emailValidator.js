const dns = require('dns').promises;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', 'temp-mail.org', 'guerrillamail.com',
  'guerrillamailblock.com', '10minutemail.com', '10minutemail.net',
  'throwawaymail.com', 'sharklasers.com', 'yopmail.com', 'dispostable.com',
  'trashmail.com', 'trashmail.net', 'fakeinbox.com', 'generator.email',
  'mohmal.com', 'burnermail.io', 'crazymailing.com', 'tmpmail.org',
  'mytemp.email', 'maildrop.cc', 'getairmail.com', 'inboxkitten.com',
  'nada.ltd', 'emailondeck.com', 'fakemailgenerator.com', 'dropmail.me',
  'tempinbox.com', 'fakemail.net', 'minuteinbox.com'
]);

const GOOGLE_MX_DOMAINS = new Set([
  'google.com',
  'googlemail.com',
  'aspmx.l.google.com',
  'alt1.aspmx.l.google.com',
  'alt2.aspmx.l.google.com',
  'alt3.aspmx.l.google.com',
  'alt4.aspmx.l.google.com',
  'smtp.google.com'
]);

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function timeoutAfter(ms) {
  return new Promise((_, reject) => {
    const error = new Error('DNS_TIMEOUT');
    error.code = 'DNS_TIMEOUT';
    setTimeout(() => reject(error), ms).unref?.();
  });
}

async function validateEmailAuthenticity(email) {
  if (typeof email !== 'string') {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }

  const cleanEmail = email.trim().toLowerCase();
  if (cleanEmail.length > 254 || !EMAIL_RE.test(cleanEmail)) {
    return { isValid: false, error: 'The email address format is invalid.' };
  }

  const at = cleanEmail.lastIndexOf('@');
  const username = cleanEmail.slice(0, at);
  const domain = cleanEmail.slice(at + 1);

  if (username.length > 64 || domain.length > 253 || DISPOSABLE_DOMAINS.has(domain)) {
    return { isValid: false, error: 'This email address cannot be used.' };
  }

  const isGoogleDomain = domain === 'gmail.com' || domain === 'googlemail.com';
  if (isGoogleDomain && (username.length < 6 || username.length > 30 || !/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(username))) {
    return { isValid: false, error: 'The Google email address is invalid.' };
  }

  try {
    const mxRecords = await Promise.race([dns.resolveMx(domain), timeoutAfter(3000)]);
    if (!Array.isArray(mxRecords) || mxRecords.length === 0) {
      return { isValid: false, error: `The email domain "@${domain}" has no active mail server.` };
    }

    const isGoogle = isGoogleDomain || mxRecords.some(({ exchange }) => {
      const normalized = String(exchange || '').toLowerCase().replace(/\.$/, '');
      return GOOGLE_MX_DOMAINS.has(normalized);
    });

    return { isValid: true, isGoogle, domain };
  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA' || error.code === 'EREFUSED') {
      return { isValid: false, error: `The email domain "@${domain}" could not be verified.` };
    }

    // A temporary DNS outage should not reject an otherwise valid address.
    return { isValid: true, isGoogle: isGoogleDomain, domain, dnsUnavailable: true };
  }
}

module.exports = { validateEmailAuthenticity, DISPOSABLE_DOMAINS };
