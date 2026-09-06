/**
 * Withholds sample values whose key suggests a credential.
 *
 * Redaction is decided by key name and never by inspecting the value. Guessing
 * from content produces both misses and false alarms, and the point is a
 * predictable rule the reader can reason about: if a key is called `secret_key`
 * its value never reaches the screen, whatever it happens to contain.
 *
 * This exists because stash dumps are captured from real renders. The dump this
 * project was designed against carried live reCAPTCHA secrets.
 */
const SECRET_KEY = /(?:^|[_.-])(secret|password|passwd|token|apikey|api_key|credential|private_key|privatekey|auth|signature|sig|salt|nonce)(?:$|[_.-])|secret|password|token|credential/i;

export const REDACTED = "••••••••";

/** True when a key's value must never be displayed. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/** The value to display for `key`, redacted when the key looks sensitive. */
export function safeValue(key: string, value: string): { value: string; redacted: boolean } {
  return isSecretKey(key) ? { value: REDACTED, redacted: true } : { value, redacted: false };
}
