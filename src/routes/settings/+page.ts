import type { PageLoad } from './$types';

type SkillEntry = { name: string; description: string };

export const load: PageLoad = async ({ fetch }) => {
  const skillsResp = await fetch('/api/skills').catch(() => null);
  const skills: SkillEntry[] = skillsResp?.ok
    ? ((await skillsResp.json()) as { skills: SkillEntry[] }).skills ?? []
    : [];
  return { skills };
};
