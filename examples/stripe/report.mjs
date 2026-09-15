import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sourceDigest() {
  const hash = createHash('sha256');
  for (const file of ['schema.mjs', 'transport.mjs', 'adapter.mjs', 'run.mjs', 'report.mjs']) {
    hash.update(file).update('\0').update(readFileSync(new URL(file, import.meta.url)));
  }
  return hash.digest('hex');
}

// Allowlist a public summary. Never publish the full local HTTP trace automatically.
export function publicSummary(report) {
  if (!report.assertions?.passed) throw new Error('Cannot export an unsuccessful experiment');
  return {
    formatVersion: 1, recordedAt: report.finishedAt, runtime: report.runtime,
    sampleSourceDigest: report.sampleSourceDigest,
    scenario: 'Real Stripe sandbox; injected annual receipt loss; no LLM or real payment',
    states: report.calls.filter(c => ['publish', 'resume'].includes(c.method)).map(c => ({ method: c.method, state: c.output.state })),
    http: report.http.map(r => ({ method: r.method, path: r.path, status: r.status,
      ...(r.data.error ? { errorType: r.data.error.type, errorParam: r.data.error.param } : { object: r.data.object }) })),
    assertions: Object.fromEntries(['passed', 'products', 'prices', 'bindings', 'singleRun',
      'reopenedTwice', 'repeatedPublishNoRequests', 'unknownRecoveryNoPosts', 'allTestMode', 'repairedKeyChanged']
      .map(key => [key, report.assertions[key]])),
  };
}
