// Offline smoke test of the exact production transcode path (no Supabase, no R2):
//   node dist/cli/transcode-local.js <input> <output.mp3> [--loudnorm]
// Prints one progress line per second and a final summary line.

import { stat } from 'node:fs/promises';
import { Throttle } from '../ffmpegProgress.js';
import { createFfmpegTools } from '../media.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const loudnorm = args.includes('--loudnorm');
  const [input, output] = args.filter((a) => !a.startsWith('--'));
  if (!input || !output) {
    console.error('usage: transcode-local <input> <output.mp3> [--loudnorm]');
    process.exit(2);
  }

  const media = createFfmpegTools();
  const started = Date.now();
  const durationSec = await media.probeDuration(input);
  console.log(`input=${input} duration_sec=${durationSec ?? 'unknown'} loudnorm=${loudnorm}`);

  const throttle = new Throttle(1000);
  let last = 0;
  await media.transcode({
    input,
    output,
    loudnorm,
    durationSec,
    onProgress: (f) => {
      last = f;
      if (throttle.tryPass(Date.now())) console.log(`progress=${f.toFixed(3)}`);
    },
  });
  if (last < 1) console.log('progress=1.000');

  const { size } = await stat(output);
  const outDuration = await media.probeDuration(output);
  console.log(`done output=${output} size_bytes=${size} duration_sec=${outDuration ?? 'unknown'} ms=${Date.now() - started}`);
}

main().catch((err: unknown) => {
  console.error(`transcode failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
