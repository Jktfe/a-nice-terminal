import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export interface AntSkillMeta {
  name: string;
  description: string;
  aliases: string[];
  path: string;
}

export interface AntSkill extends AntSkillMeta {
  body: string;
  raw: string;
}

function repoRoot(): string {
  return join(MODULE_DIR, '../..');
}

function skillsDir(root = repoRoot()): string {
  return join(root, 'docs', 'skills');
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseAliases(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((part) => parseScalar(part))
      .filter(Boolean);
  }
  return [parseScalar(trimmed)].filter(Boolean);
}

export function parseSkillMarkdown(raw: string, path = ''): AntSkill {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const fields: Record<string, string | string[]> = {};
  let body = raw;

  if (match) {
    body = raw.slice(match[0].length);
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!key) continue;
      fields[key] = key === 'aliases' ? parseAliases(value) : parseScalar(value);
    }
  }

  const name = String(fields.name || '').trim();
  const description = String(fields.description || '').trim();
  const aliases = Array.isArray(fields.aliases)
    ? fields.aliases.map((alias) => String(alias).trim()).filter(Boolean)
    : [];

  if (!name) throw new Error(`Skill missing frontmatter name: ${path || '(inline)'}`);
  if (!description) throw new Error(`Skill missing frontmatter description: ${path || name}`);

  return { name, description, aliases, body: body.trimEnd() + '\n', raw, path };
}

export function listSkills(root = repoRoot()): AntSkillMeta[] {
  const dir = skillsDir(root);
  if (!existsSync(dir)) return [];

  const skills: AntSkillMeta[] = [];
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry, 'SKILL.md');
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    const parsed = parseSkillMarkdown(readFileSync(file, 'utf8'), file);
    skills.push({
      name: parsed.name,
      description: parsed.description,
      aliases: parsed.aliases,
      path: parsed.path,
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveSkillName(input: string, root = repoRoot()): string | null {
  const wanted = normalize(input);
  for (const skill of listSkills(root)) {
    const names = [skill.name, ...skill.aliases, `${skill.name}tools`];
    if (names.some((name) => normalize(name) === wanted)) return skill.name;
  }
  return null;
}

export function loadSkill(input: string, root = repoRoot()): AntSkill {
  const name = resolveSkillName(input, root);
  if (!name) {
    const known = listSkills(root).map((s) => s.name).join(', ') || '(none)';
    throw new Error(`Unknown ANT skill: ${input}. Known: ${known}`);
  }
  const file = join(skillsDir(root), name, 'SKILL.md');
  return parseSkillMarkdown(readFileSync(file, 'utf8'), file);
}

export function skillAliasFromFlags(flags: Record<string, unknown>, root = repoRoot()): string | null {
  for (const [key, value] of Object.entries(flags)) {
    if (value !== true) continue;
    if (!key.endsWith('tools')) continue;
    const name = resolveSkillName(key, root);
    if (name) return name;
  }
  return null;
}

function printSkillList(root = repoRoot()) {
  const skills = listSkills(root);
  if (!skills.length) {
    console.log('No ANT skills found.');
    return;
  }
  console.log(`${skills.length} ANT skill${skills.length === 1 ? '' : 's'}:`);
  for (const item of skills) {
    const aliases = item.aliases.length ? ` (${item.aliases.join(', ')})` : '';
    console.log(`  ${item.name.padEnd(16)} ${item.description}${aliases}`);
  }
}

export async function skill(args: string[], _flags: any = {}) {
  const sub = args[0] || 'list';
  if (sub === 'list') {
    printSkillList();
    return;
  }

  const name = sub === 'show' ? args[1] : sub;
  if (!name) {
    console.error('Usage: ant skill <list|show|name>');
    process.exit(1);
  }
  console.log(loadSkill(name).raw.trimEnd());
}
