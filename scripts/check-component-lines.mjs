import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const maximumLineCount = 260;
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
