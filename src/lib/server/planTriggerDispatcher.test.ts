import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  addTrigger,
  getTrigger,
  _resetPlanTriggerStoreForTests
} from './planTriggerStore';
import { dispatchPlanEvent } from './planTriggerDispatcher';
import { createChatRoom } from './chatRoomStore';
import { listMessagesInRoom } from './chatMessageStore';
import { createPlan, _resetPlanStoreForTests } from './planStore';
import { attachPlanToRoom, _resetPlanRoomLinksForTests } from './planRoomLinkStore';
import { createTask, _resetTaskStoreForTests } from './taskStore';
import { getIdentityDb } from './db';
import { subscribeRoomEvents } from './eventBroadcast';

function resetAll() {
  _resetPlanTriggerStoreForTests();
  _resetPlanRoomLinksForTests();
  _resetTaskStoreForTests();
  _resetPlanStoreForTests();
  getIdentityDb().prepare(`DELETE FROM chat_messages`).run();
  getIdentityDb().prepare(`DELETE FROM chat_rooms`).run();
}

beforeEach(resetAll);
afterEach(resetAll);

describe('planTriggerDispatcher', () => {
  it('console.log action: fires + records', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const t = addTrigger({
      planId: 'p1',
      event: 'plan.archived',
      action: 'console.log',
      actionConfig: { message: 'archived {planId}' }
    });
    dispatchPlanEvent('plan.archived', { planId: 'p1' });
    expect(spy).toHaveBeenCalledWith('archived p1');
    const after = getTrigger(t.id)!;
    expect(after.fireCount).toBe(1);
    spy.mockRestore();
  });

  it('room.message action: posts a system message to attached rooms', () => {
    const room = createChatRoom({ name: 'fire-test', whoCreatedIt: '@tester' });
    const liveEvents: Record<string, unknown>[] = [];
    const unsubscribe = subscribeRoomEvents(room.id, (event) => liveEvents.push(event));
    createPlan({ id: 'p1', title: 'My Plan' });
    attachPlanToRoom({ planId: 'p1', roomId: room.id });
    // Seed a task so completion has something to template against
    createTask({ id: 't1', subject: 's', planId: 'p1', status: 'completed' });
    try {
      addTrigger({
        planId: 'p1',
        event: 'plan.completed',
        action: 'room.message',
        actionConfig: { messageTemplate: 'Plan {planTitle} done ({pct}%)' }
      });
      dispatchPlanEvent('plan.completed', { planId: 'p1' });
      const msgs = listMessagesInRoom(room.id);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toBe('Plan My Plan done (100%)');
      expect(liveEvents).toHaveLength(1);
      expect(liveEvents[0]).toMatchObject({
        type: 'message_added',
        message: { id: msgs[0].id, kind: 'system' }
      });
    } finally {
      unsubscribe();
    }
  });

  it('wildcard trigger (planId=null) fires for any plan', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    addTrigger({
      planId: null,
      event: 'plan.archived',
      action: 'console.log',
      actionConfig: { message: 'any: {planId}' }
    });
    dispatchPlanEvent('plan.archived', { planId: 'plan-abc' });
    dispatchPlanEvent('plan.archived', { planId: 'plan-xyz' });
    expect(spy).toHaveBeenCalledWith('any: plan-abc');
    expect(spy).toHaveBeenCalledWith('any: plan-xyz');
    spy.mockRestore();
  });

  it('event-mismatched triggers do NOT fire', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const t = addTrigger({
      planId: 'p1',
      event: 'plan.archived',
      action: 'console.log',
      actionConfig: { message: 'archived' }
    });
    dispatchPlanEvent('plan.completed', { planId: 'p1' });
    expect(spy).not.toHaveBeenCalledWith('archived');
    expect(getTrigger(t.id)!.fireCount).toBe(0);
    spy.mockRestore();
  });

  it('one trigger erroring does not abort others', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // First trigger has an unknown action (warning + skip)
    addTrigger({
      planId: 'p1',
      event: 'plan.archived',
      action: 'console.log',
      actionConfig: { message: 'first' }
    });
    addTrigger({
      planId: 'p1',
      event: 'plan.archived',
      action: 'console.log',
      actionConfig: { message: 'second' }
    });
    dispatchPlanEvent('plan.archived', { planId: 'p1' });
    expect(spy).toHaveBeenCalledWith('first');
    expect(spy).toHaveBeenCalledWith('second');
    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('template substitutes all placeholders', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createPlan({ id: 'p1', title: 'My Plan' });
    createTask({ id: 't1', subject: 's', planId: 'p1', status: 'completed' });
    createTask({ id: 't2', subject: 's2', planId: 'p1' });
    addTrigger({
      planId: 'p1',
      event: 'plan.completed',
      action: 'console.log',
      actionConfig: {
        message: '{planId}/{planTitle}/{event}/{completedCount}/{totalCount}/{pct}'
      }
    });
    dispatchPlanEvent('plan.completed', { planId: 'p1' });
    expect(spy).toHaveBeenCalledWith('p1/My Plan/plan.completed/1/2/50');
    spy.mockRestore();
  });

  it('task event placeholders render task fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    addTrigger({
      planId: 'p1',
      event: 'task.completed',
      action: 'console.log',
      actionConfig: { message: '{taskId}: {taskSubject} ({taskStatus}) by {taskAgent}' }
    });
    dispatchPlanEvent('task.completed', {
      planId: 'p1',
      task: { id: 't1', subject: 'Fix the bug', status: 'completed', assignedAgent: '@alex' }
    });
    expect(spy).toHaveBeenCalledWith('t1: Fix the bug (completed) by @alex');
    spy.mockRestore();
  });

  it('standalone-task event (planId=null) fires wildcard triggers only', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Wildcard trigger — should fire
    addTrigger({
      planId: null,
      event: 'task.completed',
      action: 'console.log',
      actionConfig: { message: 'standalone: {taskSubject}' }
    });
    // Plan-scoped trigger — must NOT fire (no plan in context)
    addTrigger({
      planId: 'p1',
      event: 'task.completed',
      action: 'console.log',
      actionConfig: { message: 'scoped: should-not-fire' }
    });
    dispatchPlanEvent('task.completed', {
      planId: null,
      task: { id: 't', subject: 'solo', status: 'completed', assignedAgent: null }
    });
    expect(spy).toHaveBeenCalledWith('standalone: solo');
    expect(spy).not.toHaveBeenCalledWith('scoped: should-not-fire');
    spy.mockRestore();
  });

  it('webhook.post action fires fetch with rendered url + body', async () => {
    const realFetch = globalThis.fetch;
    const calls: { url: string; method: string; body: string; headers: Record<string,string> }[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const i = init as RequestInit | undefined;
      calls.push({
        url: String(input),
        method: String(i?.method ?? 'GET'),
        body: typeof i?.body === 'string' ? i.body : '',
        headers: (i?.headers as Record<string,string>) ?? {}
      });
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      createPlan({ id: 'p1', title: 'P' });
      addTrigger({
        planId: 'p1',
        event: 'plan.archived',
        action: 'webhook.post',
        actionConfig: {
          url: 'https://example.test/hook/{planId}',
          headers: { 'x-plan': '{planId}' },
          bodyTemplate: '{"event":"{event}","title":"{planTitle}"}'
        }
      });
      dispatchPlanEvent('plan.archived', { planId: 'p1' });
      // fetch is fire-and-forget; the call still records synchronously.
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://example.test/hook/p1');
      expect(calls[0].method).toBe('POST');
      expect(calls[0].body).toBe('{"event":"plan.archived","title":"P"}');
      expect(calls[0].headers['x-plan']).toBe('p1');
      expect(calls[0].headers['content-type']).toBe('application/json');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('webhook.post default body is structured JSON when no bodyTemplate', async () => {
    const realFetch = globalThis.fetch;
    let capturedBody = '';
    globalThis.fetch = vi.fn(async (_input, init) => {
      const i = init as RequestInit | undefined;
      capturedBody = typeof i?.body === 'string' ? i.body : '';
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      addTrigger({
        planId: 'p1',
        event: 'plan.archived',
        action: 'webhook.post',
        actionConfig: { url: 'https://example.test/hook' }
      });
      dispatchPlanEvent('plan.archived', { planId: 'p1' });
      const parsed = JSON.parse(capturedBody);
      expect(parsed.event).toBe('plan.archived');
      expect(parsed.planId).toBe('p1');
      expect(parsed).toHaveProperty('firedAtMs');
      expect(parsed).toHaveProperty('completion');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('task.create action creates a follow-up task with same plan when planId="same"', () => {
    createPlan({ id: 'p1', title: 'P' });
    createTask({ id: 't1', subject: 'orig', planId: 'p1', status: 'completed' });
    addTrigger({
      planId: 'p1',
      event: 'plan.completed',
      action: 'task.create',
      actionConfig: {
        subject: 'Retrospective: {planTitle}',
        planId: 'same',
        priority: 1
      }
    });
    dispatchPlanEvent('plan.completed', { planId: 'p1' });
    // Find the auto-created task (id starts with 'auto_').
    const all = getIdentityDb()
      .prepare(`SELECT id, subject, plan_id, priority FROM tasks WHERE id LIKE 'auto_%'`)
      .all() as { id: string; subject: string; plan_id: string; priority: number }[];
    expect(all).toHaveLength(1);
    expect(all[0].subject).toBe('Retrospective: P');
    expect(all[0].plan_id).toBe('p1');
    expect(all[0].priority).toBe(1);
  });
});
