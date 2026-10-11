// Runs every browser smoke scenario, and the Node-side checks that rebuild the browser's
// downloads from their answer keys. usage: npm run smoke
import { spawnSync } from 'node:child_process';

const steps = [['baseline'], ['stream'], ['hygiene'], ['answerkey', 'answerkey.verify.mts'], ['scorecard'], ['knobs', 'knobs.verify.mts'], ['identify'], ['formatting', 'formatting.verify.mts'], ['text'], ['fixture'], ['maskcheck'], ['benchmark'], ['picker'], ['tables']];
const failed = [];
for (const [scenario, verify] of steps) {
  console.log(`\n== ${scenario}`);
  let ok = spawnSync('node', ['smoke/harness.mjs', scenario], { stdio: 'inherit' }).status === 0;
  if (ok && verify) ok = spawnSync('npx', ['tsx', `smoke/${verify}`], { stdio: 'inherit' }).status === 0;
  if (!ok) failed.push(scenario);
}
console.log(failed.length ? `\nSMOKE FAILED: ${failed.join(', ')}` : '\nALL SMOKE SCENARIOS PASSED');
process.exit(failed.length ? 1 : 0);
