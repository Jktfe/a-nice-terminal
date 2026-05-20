/**
 * ant plan show — Plan Mode CLI read verb.
 *
 * GETs /api/plan/:planId and renders the projected event set. Supports
 * --json for raw dump and --include-archived to keep archived rows visible
 * (default is to hide them, matching the §3 archive-as-hide guideline).
 *
 * Loaded lazily by scripts/ant-cli-plan.mjs so the write-only path is not
 * weighed down by render code at import time.
 */

export async function runShowVerb(planId, flags, runtime, CliInputError) {
  if (!planId || planId.length === 0) {
    throw new CliInputError('plan show needs a planId');
  }
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/plan/${encodeURIComponent(planId)}`);
  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`GET /api/plan/${planId} returned ${response.status}: ${bodyText.slice(0, 200)}`);
  }
  const parsed = await response.json();
  const allEvents = parsed.events ?? [];
  const visibleEvents = flags['include-archived'] !== undefined
    ? allEvents
    : allEvents.filter((event) => event.status !== 'archived');
  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify({ events: visibleEvents }, null, 2));
    return 0;
  }
  renderEventsAsText(visibleEvents, runtime);
  return 0;
}

function renderEventsAsText(events, runtime) {
  if (events.length === 0) {
    runtime.writeOut('(no events)');
    return;
  }
  for (const event of events) {
    runtime.writeOut(formatEventLine(event));
  }
}

function formatEventLine(event) {
  const statusTag = event.status ? `[${event.status}]` : '';
  const ownerTag = event.owner ? `(${event.owner})` : '';
  return `${indentForKind(event.kind)}${event.kind}${statusTag ? ' ' + statusTag : ''}\t${event.title}${ownerTag ? ' ' + ownerTag : ''}`;
}

function indentForKind(kind) {
  switch (kind) {
    case 'plan_section': return '';
    case 'plan_milestone': return '  ';
    case 'plan_decision': return '  ';
    case 'plan_acceptance': return '    ';
    case 'plan_test': return '      ';
    default: return '';
  }
}
