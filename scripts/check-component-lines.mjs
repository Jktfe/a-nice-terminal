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
// Baseline captured during the 2026-06-28 single-main sweep. These files were
// already over the 600-line target on origin/main; freezing their current size
// keeps the gate useful without turning branch cleanup into an unrelated UI
// decomposition project. Any growth still fails, and no new file gets a pass.
const legacyOversizedLineBudgets = new Map([
  ['src/lib/components/AgentStatusFooter.svelte', 675],
  ['src/lib/components/ChatComposer.svelte', 754],
  ['src/routes/agents/+page.svelte', 692],
  ['src/routes/artefacts/[artefactId]/+page.svelte', 618],
  ['src/routes/asks/+page.svelte', 709],
  ['src/routes/decks/[deckId]/+page.svelte', 1675],
  ['src/routes/manual/v2/+page.svelte', 1637],
  ['src/routes/rooms/+page.svelte', 827],
  ['src/routes/rooms/[roomId]/+page.svelte', 871],
  ['src/routes/terminals/+page.svelte', 849],
  ['src/routes/verification/lenses/+page.svelte', 730]
]);

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
    lineCount: readFileSync(filePath, 'utf8').split('\n').length,
    budget: legacyOversizedLineBudgets.get(filePath) ?? maximumLineCount
  }))
  .filter((file) => file.lineCount > file.budget);

if (oversizedFiles.length > 0) {
  console.error(`Svelte files must stay under ${maximumLineCount} lines unless frozen in the legacy baseline.`);
  for (const file of oversizedFiles) {
    console.error(`${file.filePath}: ${file.lineCount} lines (budget ${file.budget})`);
  }
  process.exit(1);
}

console.log(`All Svelte files are under ${maximumLineCount} lines.`);
