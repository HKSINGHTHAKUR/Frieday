/**
 * Token encryption (architecture.md §13): AES-256-GCM.
 * Key: TOKEN_ENC_KEY — 64 hex characters decoding to exactly 32 bytes;
 * fail-fast when missing/invalid. Payload format: `v1:<iv>:<ciphertext>:<tag>`
 * (hex parts; the version prefix allows future key rotation).
 *
 * Decryption failure → error with code `UNAUTHENTICATED` (tasks.md T1.2):
 * a stale/rotated/foreign stored token means the user must reconnect.
 */
const crypto = require('node:crypto');
const { getEnv } = require('../../config/env');

const PREFIX = 'v1';

/**
 * @returns {Buffer} the 32-byte key, or throws a named INVALID_CONFIG error
 */
function getKey() {
  const key = Buffer.from(getEnv().TOKEN_ENC_KEY, 'hex');
  if (key.length !== 32) {
    const err = new Error('TOKEN_ENC_KEY must decode to exactly 32 bytes (64 hex characters).');
    err.code = 'INVALID_CONFIG';
    throw err;
  }
  return key;
}

/**
 * @param {string} plainToken the GitHub access token
 * @returns {string} versioned encrypted payload
 */
function encryptToken(plainToken) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainToken), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

/**
 * @param {string} payload `v1:iv:ciphertext:tag`
 * @returns {string} the decrypted token
 * @throws {Error} code `UNAUTHENTICATED` when the payload is malformed or
 *   fails authentication (wrong key, tampered ciphertext, legacy raw token)
 */
function decryptToken(payload) {
  const key = getKey();
  let iv;
  let encrypted;
  let tag;
  try {
    const parts = String(payload).split(':');
    if (parts.length !== 4 || parts[0] !== PREFIX) {
      throw new Error('malformed payload');
    }
    iv = Buffer.from(parts[1], 'hex');
    encrypted = Buffer.from(parts[2], 'hex');
    tag = Buffer.from(parts[3], 'hex');
    if (iv.length !== 12 || encrypted.length === 0 || tag.length !== 16) {
      throw new Error('malformed payload');
    }
  } catch {
    const err = new Error('Stored token could not be decrypted.');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    const err = new Error('Stored token could not be decrypted.');
    err.code = 'UNAUTHENTICATED';
    throw err;
  }
}

module.exports = { encryptToken, decryptToken };
