/**
 * Shared fake GitHub server for fetcher tests.
 * Provides a test HTTP server that responds based on a pre-configured queue.
 */

const http = require('node:http');

/**
 * Create a fake GitHub server with a request queue.
 * Each test pushes expected responses to the queue.
 * @returns {{ fake: object, server: http.Server, url: string, ready: Promise<void>, close: () => Promise<void> }}
 */
function createFakeGithub() {
  const fake = {
    calls: [],
    queue: [],
    delayMs: 0,
  };

  const server = http.createServer((req, res) => {
    const callInfo = {
      url: req.url,
      method: req.method,
      headers: req.headers,
      at: Date.now(),
    };
    fake.calls.push(callInfo);

    const next = fake.queue.length > 0 ? fake.queue.shift() : null;
    const status = next?.status ?? 200;
    const headers = { 'Content-Type': 'application/json' };
    if (next?.headers) Object.assign(headers, next.headers);

    const body = next?.body ?? (status >= 400 ? { message: 'Simulated GitHub error' } : []);

    setTimeout(() => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    }, fake.delayMs);
  });

  const ready = new Promise((resolve) => server.listen(0, resolve)).then(() => {
    fake.url = `http://127.0.0.1:${server.address().port}`;
    return fake;
  });

  const close = () =>
    new Promise((resolve, reject) => {
      server.closeAllConnections?.();
      const timeout = setTimeout(() => reject(new Error('server.close timeout')), 5000);
      server.close(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

  return { fake, server, ready, close };
}

/**
 * Push a response to the fake server queue.
 * @param {object} fake - The fake object from createFakeGithub
 * @param {object} response - Response configuration
 * @param {number} response.status - HTTP status code
 * @param {any} response.body - Response body
 * @param {object} [response.headers] - Response headers
 */
function pushResponse(fake, { status = 200, body, headers = {} } = {}) {
  // Leave body undefined when not given so the server applies its
  // status-aware default (message object for errors, [] for 200s).
  fake.queue.push({ status, body, headers });
}

/**
 * Push multiple responses to the fake server queue.
 * @param {object} fake - The fake object from createFakeGithub
 * @param {Array<object>} responses - Array of response configurations
 */
function pushResponses(fake, responses) {
  for (const resp of responses) pushResponse(fake, resp);
}

/**
 * Clear the fake server queue and call history.
 * @param {object} fake - The fake object from createFakeGithub
 */
function resetFake(fake) {
  fake.queue = [];
  fake.calls = [];
}

/**
 * Get the last call made to the fake server.
 * @param {object} fake - The fake object from createFakeGithub
 * @returns {object|null}
 */
function getLastCall(fake) {
  return fake.calls[fake.calls.length - 1] ?? null;
}

/**
 * Assert that a request was made to a specific path.
 * @param {object} fake - The fake object from createFakeGithub
 * @param {string} path - Expected path (partial match)
 */
function assertRequestMade(fake, path) {
  const call = getLastCall(fake);
  if (!call) throw new Error('No request was made');
  if (!call.url.includes(path)) {
    throw new Error(`Expected request to ${path}, got ${call.url}`);
  }
}

module.exports = {
  createFakeGithub,
  pushResponse,
  pushResponses,
  resetFake,
  getLastCall,
  assertRequestMade,
};
