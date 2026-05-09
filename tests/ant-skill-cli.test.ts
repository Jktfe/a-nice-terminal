import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listSkills,
  loadSkill,
  parseSkillMarkdown,
  resolveSkillName,
  skillAliasFromFlags,
} from '../cli/commands/skill.js';

let root: string;

function writeSkill(name: string, content: string) {
  const dir = join(root, 'docs', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content);
}

describe('ant skill loader', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ant-skill-repo-'));
    writeSkill('planning', [
      '---',
      'name: planning',
      'description: Plan-backed ANT work',
      'aliases: [plan, plantools, planningtools]',
      '---',
      '',
      '# Planning',
      '',
      'Use tasks and plan events.',
      '',
    ].join('\n'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('parses skill frontmatter from SKILL.md without a duplicate index', () => {
    const parsed = parseSkillMarkdown([
      '---',
      'name: chat-routing',
      'description: Mention routing rules',
      'aliases: [chattools, routing]',
      '---',
      '# Chat Routing',
    ].join('\n'));

    expect(parsed).toMatchObject({
      name: 'chat-routing',
      description: 'Mention routing rules',
      aliases: ['chattools', 'routing'],
    });
  });

  it('lists skills with descriptions from frontmatter', () => {
    expect(listSkills(root)).toEqual([
      expect.objectContaining({
        name: 'planning',
        description: 'Plan-backed ANT work',
        aliases: ['plan', 'plantools', 'planningtools'],
      }),
    ]);
  });

  it('resolves names, aliases, and --<name>tools style flags', () => {
    expect(resolveSkillName('planning', root)).toBe('planning');
    expect(resolveSkillName('plan', root)).toBe('planning');
    expect(resolveSkillName('plantools', root)).toBe('planning');
    expect(resolveSkillName('planningtools', root)).toBe('planning');
    expect(skillAliasFromFlags({ plantools: true }, root)).toBe('planning');
  });

  it('loads a skill by alias and returns the original markdown', () => {
    const skill = loadSkill('plantools', root);
    expect(skill.name).toBe('planning');
    expect(skill.raw).toContain('# Planning');
  });
});

describe('ant skill CLI', () => {
  it('ships the initial compact ANT skill set', () => {
    const names = listSkills(process.cwd()).map((skill) => skill.name);
    expect(names).toEqual([
      'artefacts',
      'chat-break',
      'chat-routing',
      'planning',
      'task-lifecycle',
    ]);

    for (const skill of listSkills(process.cwd())) {
      expect(skill.description.length).toBeGreaterThan(20);
    }
  });

  it('prints the planning skill via ant --plantools', () => {
    const result = spawnSync('bun', ['cli/index.ts', '--plantools'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ANT_DISABLE_PID_IDENTITY: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('name: planning');
    expect(result.stdout).toContain('# ANT Planning Skill');
    expect(result.stdout).toContain('Long form: `docs/ANT-PLANNING-SKILL.md`.');
  });

  it('prints other skills via generic --<name>tools aliases', () => {
    const result = spawnSync('bun', ['cli/index.ts', '--tasktools'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ANT_DISABLE_PID_IDENTITY: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('name: task-lifecycle');
    expect(result.stdout).toContain('# ANT Task Lifecycle Skill');
  });

  it('lists skills from repo-shipped SKILL.md frontmatter', () => {
    const result = spawnSync('bun', ['cli/index.ts', 'skill', 'list'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ANT_DISABLE_PID_IDENTITY: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('planning');
    expect(result.stdout).toContain('chat-break');
    expect(result.stdout).toContain('artefacts');
    expect(result.stdout).toContain('Compact ANT planning primer');
  });

  it('prints a named skill with ant skill <name>', () => {
    const result = spawnSync('bun', ['cli/index.ts', 'skill', 'planning'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        ANT_DISABLE_PID_IDENTITY: '1',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('# ANT Planning Skill');
  });
});
