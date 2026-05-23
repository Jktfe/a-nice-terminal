import { describe, expect, it } from 'vitest';
import { GET } from './+server';
import { GET as GET_ONE } from './[contractId]/+server';

type AnyHandler = (event: unknown) => unknown;

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

function listEvent() {
  const url = new URL('http://localhost/api/contracts');
  return { request: new Request(url), url };
}

function detailEvent(contractId: string) {
  const url = new URL(`http://localhost/api/contracts/${contractId}`);
  return { request: new Request(url), url, params: { contractId } };
}

describe('/api/contracts', () => {
  it('lists public stubs for OSS and premium contracts without contract bodies', async () => {
    const res = await run(GET as unknown as AnyHandler, listEvent());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contractPack).toMatchObject({
      id: 'ant-contract-pack',
      publicSurface: 'stubs-only'
    });
    expect(body.contracts.length).toBeGreaterThan(0);

    const chair = body.contracts.find((contract: { id: string }) => contract.id === 'chair-v1');
    expect(chair).toMatchObject({
      id: 'chair-v1',
      featureKey: 'chair',
      access: 'premium',
      bodyAvailable: false
    });
    expect(JSON.stringify(chair)).not.toContain('prompt');
    expect(JSON.stringify(chair)).not.toContain('playbook');
    expect(JSON.stringify(body)).not.toContain('premiumBody');
  });

  it('returns public contract bodies but keeps premium bodies locked', async () => {
    const publicRes = await run(GET_ONE as unknown as AnyHandler, detailEvent('agent-onboarding-v1'));
    expect(publicRes.status).toBe(200);
    const publicBody = await publicRes.json();
    expect(publicBody.bodyAccess).toBe('public');
    expect(publicBody.body).toContain('Use the ANT CLI');

    const premiumRes = await run(GET_ONE as unknown as AnyHandler, detailEvent('chair-v1'));
    expect(premiumRes.status).toBe(200);
    const premiumBody = await premiumRes.json();
    expect(premiumBody.contract).toMatchObject({
      id: 'chair-v1',
      access: 'premium',
      bodyAvailable: false
    });
    expect(premiumBody.body).toBeNull();
    expect(premiumBody.bodyAccess).toBe('locked');
    expect(premiumBody.lockedReason).toContain('premium app');
    expect(JSON.stringify(premiumBody)).not.toContain('prompt');
    expect(JSON.stringify(premiumBody)).not.toContain('playbook');
  });

  it('404s unknown contracts without leaking registry internals', async () => {
    const res = await run(GET_ONE as unknown as AnyHandler, detailEvent('unknown-contract'));

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('chair');
  });
});
