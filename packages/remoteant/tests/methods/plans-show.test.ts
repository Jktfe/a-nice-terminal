import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/mcp-stdio/methods.ts";
import { installFetchMock, restoreFetch } from "./fetch-mock.ts";

describe("ant.plans.show", () => {
  afterEach(() => restoreFetch());

  it("fetches plan events and groups them by kind", async () => {
    installFetchMock(vi.fn(async () => new Response(JSON.stringify({
      events: [
        { id: "s1", kind: "plan_section", title: "Section" },
        { id: "m1", kind: "plan_milestone", title: "Milestone" },
        { id: "d1", kind: "plan_decision", title: "Decision" },
        { id: "a1", kind: "plan_acceptance", title: "Acceptance" },
      ],
    }), { status: 200 })) as unknown as typeof fetch);

    const response = await dispatch({
      jsonrpc: "2.0",
      id: 6,
      method: "ant.plans.show",
      params: { planId: "remoteant-mac-delivery-2026-05-29" },
    }) as { result?: { plan: { id: string; milestones: unknown[]; sections: unknown[]; decisions: unknown[]; acceptance: unknown[] } } };

    expect(response.result?.plan.id).toBe("remoteant-mac-delivery-2026-05-29");
    expect(response.result?.plan.sections).toHaveLength(1);
    expect(response.result?.plan.milestones).toHaveLength(1);
    expect(response.result?.plan.decisions).toHaveLength(1);
    expect(response.result?.plan.acceptance).toHaveLength(1);
  });
});
