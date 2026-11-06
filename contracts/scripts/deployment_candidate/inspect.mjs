import { inspect } from './common.mjs';
try { await inspect(); } catch { console.error('BLOCKED: public candidate inspection failed; no writes attempted.'); process.exitCode=1; }
