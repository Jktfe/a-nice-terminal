import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Raised from 260 → 600 per JWPK 2026-05-21. The 260 cap had created
// a 40-file backlog that nobody had bandwidth to refactor; most of
// those flagged components (270-450 lines) are genuinely coherent
// units whose extraction would just spread complexity across files
// rather than reduce it. 600 still flags the real outliers
// (rooms/[roomId] 1243, InterviewModal 888, manual 793, etc.) that
// ARE worth splitting when there's room.
const maximumLineCount = 600;
const foldersToCheck = ['src/lib/components', 'src/routes'];

function listSvelteFiles(folder) {
  return readdirSync(folder).flatMap((entryName) => {
    const absolutePath = join(folder, entryName);
    const entryStat = statSync(absolutePath);
    if (entryStat.isDirectory()) return listSvelteFiles(absolutePath);
    return absolutePath.endsWith('.svelte') ? [absolutePath] : [];
  });
}

const oversizedFiles = foldersToCheck
  .flatMap(listSvelteFiles)
  .map((filePath) => ({
    filePath,
    lineCount: readFileSync(filePath, 'utf8').split('\n').length
  }))
  .filter((file) => file.lineCount > maximumLineCount);

if (oversizedFiles.length > 0) {
  console.error(`Svelte files must stay under ${maximumLineCount} lines.`);
  for (const file of oversizedFiles) {
    console.error(`${file.filePath}: ${file.lineCount} lines`);
  }
  process.exit(1);
}

console.log(`All Svelte files are under ${maximumLineCount} lines.`);
