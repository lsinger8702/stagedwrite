import assert from 'node:assert/strict';

// Compare runtime metadata only. Do not scrub business fields, plans, diagnostics or OPs.
export function comparableTrace(trace) {
  const ids = new Map();
  const opaque = new Set(['registration', 'graph', 'fieldIntents', 'preview', 'diagnostics', 'changes', 'payload', 'input', 'chosenOps', 'initialSnapshot']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const identityKeys = new Set(['id', 'draftId', 'checkId', 'artifactId', 'initialArtifactId', 'publishedArtifactId', 'certificate']);
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (identityKeys.has(key) && typeof item === 'string' && uuid.test(item) && !ids.has(item)) ids.set(item, `runtime-id-${ids.size + 1}`);
      if (!opaque.has(key)) collect(item);
    }
  }
  collect(trace);
  function visit(value, key = '') {
    if (typeof value === 'string') {
      if (ids.has(value)) return ids.get(value);
      if (['createdAt', 'updatedAt', 'recordedAt', 'lastPublishedAt'].includes(key) && /^\d{4}-\d\d-\d\dT/.test(value)) return '<runtime timestamp>';
      return value;
    }
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
      // Input positional arguments can reference runtime IDs; request bodies are under payload.
      ['registration', 'graph', 'fieldIntents', 'diagnostics', 'changes', 'payload', 'chosenOps', 'initialSnapshot'].includes(k) ? v : visit(v, k)]));
  }
  return { ...visit(trace), runtime: '<Node version; see raw trace>' };
}

export function verifyTrace(committed, fresh) {
  assert.deepEqual(comparableTrace(fresh), comparableTrace(committed), 'Walkthrough behavior changed: regenerate with npm run demo:html');
}

// ZIP STORE avoids platform/zlib differences. Fixed DOS date, order and attributes.
// The small download trades compression for byte stability across supported Node versions.
export function zipFiles(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, value] of files) {
    const filename = Buffer.from(name), data = Buffer.from(value);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, filename); offset += local.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function verifyArtifacts(expected, read) {
  for (const [name, bytes] of expected) assert.ok(Buffer.from(read(name)).equals(Buffer.from(bytes)), `${name} is stale: run npm run demo:html`);
}
