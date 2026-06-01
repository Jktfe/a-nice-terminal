import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pageSource = readFileSync(join(process.cwd(), 'src/routes/plans/[planId]/+page.svelte'), 'utf8');
const overviewSource = readFileSync(join(process.cwd(), 'src/lib/components/PlanCockpit.svelte'), 'utf8');

describe('plan detail user-facing labels', () => {
  it('uses Dashboard rather than Cockpit (or the interim Overview) for the primary plan view', () => {
    // JWPK msg_z0ckdgazh6 ask-answer ('Cockpit is a verb we should be
    // rid of. It's dashboard'): primary plan view label is now Dashboard.
    // Overview was an interim label between Cockpit and Dashboard; both
    // legacy strings are banned to catch regressions.
    expect(pageSource).toContain("'Dashboard.'");
    expect(pageSource).toContain('>Dashboard</button>');
    expect(pageSource).not.toContain("'Cockpit.'");
    expect(pageSource).not.toContain('>Cockpit</button>');
    expect(pageSource).not.toContain("'Overview.'");
    expect(pageSource).not.toContain('>Overview</button>');
  });

  it('does not show cockpit or overview wording in the primary plan view status text', () => {
    expect(overviewSource).toContain('aria-label="Plan dashboard"');
    expect(overviewSource).toContain('Loading plan dashboard');
    expect(overviewSource).not.toContain('aria-label="Plan cockpit"');
    expect(overviewSource).not.toContain('aria-label="Plan overview"');
    expect(overviewSource).not.toContain('Loading cockpit');
    expect(overviewSource).not.toContain('Loading plan overview');
    expect(overviewSource).not.toContain('Could not load cockpit');
    expect(overviewSource).not.toContain('Could not load plan overview');
  });
});
