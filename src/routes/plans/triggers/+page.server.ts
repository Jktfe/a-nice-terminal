/**
 * /plans/triggers — server-side load. We import the event/action const
 * sets directly from `$lib/server/planTriggerStore` so the UI auto-picks
 * up any new events/actions the BE adds (the sibling dispatcher slice
 * may extend these sets while this page exists). The public fetches
 * (triggers + plans) happen in the sibling +page.ts on top of this.
 */

import type { PageServerLoad } from './$types';
import {
  PLAN_TRIGGER_ACTIONS,
  PLAN_TRIGGER_EVENTS,
  type PlanTriggerAction,
  type PlanTriggerEvent
} from '$lib/server/planTriggerStore';

export const load: PageServerLoad = () => {
  const events: PlanTriggerEvent[] = Array.from(PLAN_TRIGGER_EVENTS).sort();
  const actions: PlanTriggerAction[] = Array.from(PLAN_TRIGGER_ACTIONS).sort();
  return { events, actions };
};
