/**
 * Startup diagnostics tests (tasks.md T0.2).
 *
 * Verifies that when getEnv() fails at boot, index.js logs the sanitized
 * validation message (variable name + rule) without exposing secret values.
 *
 * index.js calls main() at module load, so we mock getEnv on the env module
 * before requiring index.js, mock logger.error to capture calls, and clear
 * require.cache for index between tests.
 */
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const logger = require('../src/utils/logger');

describe('index.js startup diagnostics', () => {
  let loggerCalls;
  let origEnv;
  let origError;

  beforeEach(() => {
    loggerCalls = [];
    origEnv = { ...process.env };
    origError = logger.error;
    logger.error = mock.fn((o) => loggerCalls.push(o));
    delete require.cache[require.resolve('../src/index')];
  });

  afterEach(() => {
    process.env = origEnv;
    process.exitCode = 0;
    logger.error = origError;
    delete require.cache[require.resolve('../src/index')];
    delete require.cache[require.resolve('../src/config/env')];
  });

  it('logs the missing variable name when JWT_SECRET is absent', () => {
    const envModule = require('../src/config/env');
    envModule.getEnv = () => {
      throw new Error('Missing env: JWT_SECRET');
    };
    require('../src/index');
    assert.equal(loggerCalls.length, 1);
    assert.equal(loggerCalls[0].msg, 'invalid configuration');
    assert.equal(loggerCalls[0].code, 'INVALID_CONFIG');
    assert.equal(loggerCalls[0].operation, 'boot-config');
    assert.equal(loggerCalls[0].message, 'Missing env: JWT_SECRET');
    assert.ok(!loggerCalls[0].message.includes('secret'));
    assert.ok(!loggerCalls[0].message.includes('token'));
  });

  it('logs the missing variable name when TOKEN_ENC_KEY is absent', () => {
    const envModule = require('../src/config/env');
    envModule.getEnv = () => {
      throw new Error('Missing env: TOKEN_ENC_KEY');
    };
    require('../src/index');
    assert.equal(loggerCalls.length, 1);
    assert.equal(loggerCalls[0].message, 'Missing env: TOKEN_ENC_KEY');
  });

  it('logs the zod validation reason for invalid TOKEN_ENC_KEY', () => {
    const envModule = require('../src/config/env');
    envModule.getEnv = () => {
      throw new Error("Invalid env: TOKEN_ENC_KEY — TOKEN_ENC_KEY must be 64 hex characters (32 bytes)");
    };
    require('../src/index');
    assert.equal(loggerCalls[0].message, "Invalid env: TOKEN_ENC_KEY — TOKEN_ENC_KEY must be 64 hex characters (32 bytes)");
    assert.ok(loggerCalls[0].message.includes('TOKEN_ENC_KEY'));
    assert.ok(!/^[0-9a-f]{64}$/.test(loggerCalls[0].message));
  });

  it('logs invalid CLIENT_URL with variable name only', () => {
    const envModule = require('../src/config/env');
    envModule.getEnv = () => {
      throw new Error('Invalid env: CLIENT_URL — Invalid url');
    };
    require('../src/index');
    assert.equal(loggerCalls[0].message, 'Invalid env: CLIENT_URL — Invalid url');
    assert.ok(!loggerCalls[0].message.includes('http://'));
    assert.ok(!loggerCalls[0].message.includes('https://'));
  });

  it('still fails fast (process.exitCode = 1) on invalid config', () => {
    const envModule = require('../src/config/env');
    envModule.getEnv = () => {
      throw new Error('Missing env: JWT_SECRET');
    };
    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    require('../src/index');
    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });
});
