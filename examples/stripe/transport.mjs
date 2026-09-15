import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// Preserve the engine's identity, but encode it without quotes or header delimiters.
export const requestKey = key => createHash('sha256').update(key).digest('hex');

export function assertTestKey(key) {
  if (typeof key !== 'string' || !/^(rk|sk)_test_[A-Za-z0-9]{20,}$/.test(key)) {
    throw new Error('A test secret/restricted key is required; live/public keys are refused.');
  }
}

// curl keeps this sample dependency-free and uses the host's TLS/proxy configuration.
// No automatic retries, redirects, shell interpolation, or credentials in argv/logs.
export function createTransport(secret, onResponse = () => {}) {
  assertTestKey(secret);
  return async function request(method, path, params = {}, key, signal) {
    if (!['GET', 'POST'].includes(method) || !/^\/v1\/(products|prices)$/.test(path)) {
      throw new Error('Endpoint outside this catalog sample');
    }
    const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    const args = ['--silent', '--show-error', '--max-time', '20', '--request', method,
      '--config', '-', '--write-out', '\n%{http_code}',
      `https://api.stripe.com${path}${method === 'GET' && body ? `?${body}` : ''}`];
    const wireKey = key === undefined ? undefined : requestKey(key);
    let config = `header = "Authorization: Bearer ${secret}"\n`;
    if (wireKey) config += `header = "Idempotency-Key: ${wireKey}"\n`;
    if (method === 'POST') args.push('--data', body);
    const output = await new Promise((resolve, reject) => {
      const child = spawn('curl', args, { signal });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', () => reject(new Error('Stripe transport failed or was aborted')));
      child.on('close', code => code === 0 ? resolve(out) : reject(new Error(`curl failed (${code}); outcome unknown`)));
      child.stdin.end(config);
    });
    const split = output.lastIndexOf('\n');
    const response = { status: Number(output.slice(split + 1)), data: JSON.parse(output.slice(0, split)) };
    // The callback records request bodies and responses, never Authorization headers.
    onResponse({ method, path, params, wireKey, ...response });
    return response;
  };
}

// A complete traversal is necessary before claiming uniqueness; absence remains unknown.
export async function listAll(request, path, params, signal) {
  const objects = [], cursors = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const result = await request('GET', path, { ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, undefined, signal);
    if (result.status !== 200 || result.data.object !== 'list' || !Array.isArray(result.data.data)) throw new Error('Incomplete Stripe lookup');
    objects.push(...result.data.data);
    if (result.data.has_more === false) return objects;
    cursor = result.data.data.at(-1)?.id;
    if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Incomplete Stripe pagination');
    cursors.add(cursor);
  }
  throw new Error('Stripe lookup exceeded sample page budget');
}
