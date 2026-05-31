import { parseEnv } from "../env.ts";
import { antApiFetch } from "./http-client.ts";
import { validatePlansShowParams } from "./validation.ts";

type PlanEvent = { kind?: string; [key: string]: unknown };

export async function antPlansShow(params: unknown) {
  const { planId } = validatePlansShowParams(params);
  const response = await antApiFetch<{ events: PlanEvent[] }>(
    `/api/plan/${encodeURIComponent(planId)}`,
    { method: "GET", env: parseEnv() },
  );
  const events = response.events ?? [];
  return {
    plan: {
      id: planId,
      sections: events.filter((event) => event.kind === "plan_section"),
      milestones: events.filter((event) => event.kind === "plan_milestone"),
      decisions: events.filter((event) => event.kind === "plan_decision"),
      acceptance: events.filter((event) => event.kind === "plan_acceptance" || event.kind === "plan_test"),
    },
  };
}
