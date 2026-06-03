import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('heads-down claim chip UX wiring', () => {
  it('renders roster-order markers and live countdowns from the claim chip', () => {
    const source = readFileSync('src/lib/components/ClaimChip.svelte', 'utf8');

    expect(source).toContain('members?: RoomMember[]');
    expect(source).toContain('agentOrderByHandle');
    expect(source).toContain('seniorityForHandle');
    expect(source).toContain('class="claim-order"');
    expect(source).toContain('setInterval');
    expect(source).toContain('clockNowMs');
    expect(source).toContain('remainingLabel(claim.expires_at_ms, clockNowMs)');
  });

  it('threads the room member roster from MessageList into ClaimChip', () => {
    const listSource = readFileSync('src/lib/components/MessageList.svelte', 'utf8');
    const rowSource = readFileSync('src/lib/components/MessageRow.svelte', 'utf8');
    const headerSource = readFileSync('src/lib/components/MessageRowHeader.svelte', 'utf8');

    expect(listSource).toContain('{members}');
    expect(rowSource).toContain('members?: RoomMember[]');
    expect(rowSource).toContain('{members}');
    expect(headerSource).toContain('<ClaimChip {claims} {members} {roomMode} />');
  });

  it('uses read/take/pass action copy for the three heads-down claim gestures', () => {
    const source = readFileSync('src/lib/components/ClaimActionBar.svelte', 'utf8');

    expect(source).toContain("{myLooking ? 'reading' : 'read'}");
    expect(source).toContain("{myWorking ? 'taking' : 'take'}");
    expect(source).toContain("{myPass ? 'passed' : 'pass'}");
  });

  it('never treats the human operator handles as an agent claim actor', () => {
    const source = readFileSync('src/lib/components/MessageList.svelte', 'utf8');

    expect(source).toContain('isOperatorLikeHandle');
    expect(source).toContain("lower === '@jwpk'");
    expect(source).toContain("lower === '@you'");
    expect(source).toContain('if (isOperatorLikeHandle(handle)) return false;');
  });
});
