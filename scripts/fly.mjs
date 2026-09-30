// `npm run fly -- <args>` (phase 19): runs flyctl with FLY_API_TOKEN from .env in its environment. The token is never
// printed. flyctl comes from .fly/bin/flyctl.exe (downloaded locally, git-ignored), else `flyctl` on the PATH.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch { /* no .env: flyctl reports the missing auth */ }
const local = new URL('../.fly/bin/flyctl.exe', import.meta.url);
const bin = existsSync(local) ? local.pathname.replace(/^\/([A-Za-z]:)/, '$1') : 'flyctl';
spawn(bin, process.argv.slice(2), { stdio: 'inherit', env: process.env })
  .on('error', (e) => { console.error(`can't run flyctl (${bin}): ${e.message}`); process.exit(1); })
  .on('exit', (code) => process.exit(code ?? 1));
