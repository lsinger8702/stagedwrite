import { rmSync } from 'node:fs';
// Resolve against this script, not cwd: never delete an arbitrary caller's dist directory.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
