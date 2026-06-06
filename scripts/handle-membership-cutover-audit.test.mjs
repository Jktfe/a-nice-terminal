import { describe, expect, it } from 'vitest';
import { classifyCutoverFindings, scanTextForCutoverFindings } from './handle-membership-cutover-audit.mjs';

describe('handle membership cutover audit', () => {
  it('flags legacy membership write/read paths that must not survive the replace cutover', () => {
    const findings = scanTextForCutoverFindings('src/example.ts', `
      db.prepare('INSERT INTO chat_room_members (id, room_id, handle) VALUES (?, ?, ?)');
      db.prepare('SELECT * FROM room_memberships WHERE room_id = ?');
      db.prepare('UPDATE memberships SET room_alias = ? WHERE room_id = ?');
    `);

    expect(findings.map((finding) => finding.kind)).toEqual([
      'legacy-chat-room-members',
      'legacy-room-memberships',
      'legacy-v02-memberships'
    ]);
  });

  it('flags operator sentinel auth bypasses separately from display-only references', () => {
    const findings = scanTextForCutoverFindings('src/example.ts', `
      const operatorBypass = callerHandle === OPERATOR_HANDLE;
      const label = operatorDisplayHandle('@you');
    `);

    expect(findings.map((finding) => finding.kind)).toEqual(['operator-sentinel-auth']);
  });

  it('flags CLI config identity cache authority', () => {
    const findings = scanTextForCutoverFindings('scripts/example.mjs', `
      config.antSessions.byName[name] = sessionId;
      config.antSessions.byPane[pane] = sessionId;
    `);

    expect(findings.map((finding) => finding.kind)).toEqual([
      'cli-config-identity-cache',
      'cli-config-identity-cache'
    ]);
  });

  it('does not count this audit script rule table as a cutover blocker', () => {
    const findings = scanTextForCutoverFindings('scripts/handle-membership-cutover-audit.mjs', `
      { kind: 'legacy-chat-room-members', pattern: /\\bchat_room_members\\b/ },
      { kind: 'legacy-room-memberships', pattern: /\\broom_memberships\\b/ },
      { kind: 'legacy-v02-memberships', pattern: /\\bmemberships\\b/ },
      { kind: 'operator-sentinel-auth', pattern: /\\bOPERATOR_HANDLE\\b/ },
      { kind: 'cli-config-identity-cache', pattern: /\\bantSessions\\.(?:byName|byPane)\\b/ }
    `);

    expect(findings).toEqual([]);
  });

  it('summarises blockers by kind for the deploy gate', () => {
    const summary = classifyCutoverFindings([
      { file: 'a.ts', line: 1, kind: 'legacy-room-memberships', text: 'room_memberships' },
      { file: 'b.ts', line: 1, kind: 'legacy-room-memberships', text: 'room_memberships' },
      { file: 'c.ts', line: 1, kind: 'operator-sentinel-auth', text: 'OPERATOR_HANDLE' }
    ]);

    expect(summary).toEqual({
      'legacy-room-memberships': 2,
      'operator-sentinel-auth': 1
    });
  });
});
