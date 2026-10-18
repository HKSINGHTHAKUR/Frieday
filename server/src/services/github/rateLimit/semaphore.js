/**
 * FIFO concurrency semaphore.
 */

const { DEFAULT_CONCURRENCY } = require('./constants.js');

/**
 * FIFO concurrency semaphore.
 * @param {number} [maxConcurrent]
 * @returns {{ acquire: () => Promise<void>, release: () => void, active: number, queued: number }}
 */
function createSemaphore(maxConcurrent = DEFAULT_CONCURRENCY) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new TypeError('maxConcurrent must be a positive integer');
  }
  let active = 0;
  const waiters = [];
  function acquire() {
    return new Promise((resolve) => {
      if (active < maxConcurrent) {
        active += 1;
        resolve();
      } else {
        waiters.push(resolve);
      }
    });
  }
  function release() {
    const next = waiters.shift(); // FIFO hand-off keeps the permit in flight
    if (next) {
      next();
    } else if (active > 0) {
      active -= 1;
    }
  }
  return {
    acquire,
    release,
    get active() {
      return active;
    },
    get queued() {
      return waiters.length;
    },
  };
}

module.exports = { createSemaphore };
