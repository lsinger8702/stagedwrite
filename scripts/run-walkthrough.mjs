// Deterministic identity source ONLY for this standalone fictional demonstration.
// Production entry points and the real Stripe sandbox never load this launcher.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
let sequence = 0;
crypto.randomUUID = () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`;
syncBuiltinESMExports();
await import('../dist/examples/publish-and-resume.js');
