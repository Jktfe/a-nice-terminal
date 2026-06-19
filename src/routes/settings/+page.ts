import type { PageLoad } from './$types';

type SkillEntry = { name: string; description: string };

function normaliseHandle(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  return (trimmed.startsWith('@') ? trimmed : `@${trimmed}`).toLowerCase();
}

export const load: PageLoad = async ({ fetch }) => {
  const [skillsResp, capabilitiesResp] = await Promise.all([
    fetch('/api/skills').catch(() => null),
    fetch('/api/capabilities').catch(() => null)
  ]);
  const skills: SkillEntry[] = skillsResp?.ok
    ? ((await skillsResp.json()) as { skills: SkillEntry[] }).skills ?? []
    : [];
  const capabilities = capabilitiesResp?.ok
    ? ((await capabilitiesResp.json().catch(() => null)) as {
        operatorHandle?: string;
        viewerHandle?: string | null;
      } | null)
    : null;
  const operatorHandle = normaliseHandle(capabilities?.operatorHandle);
  const viewerHandle = normaliseHandle(capabilities?.viewerHandle);
  return {
    skills,
    canManageOperatorFileSettings:
      operatorHandle.length > 0 && viewerHandle.length > 0 && operatorHandle === viewerHandle
  };
};
