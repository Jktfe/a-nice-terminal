import { beforeEach, describe, expect, it } from 'vitest';
import {
  answerAsk,
  dismissAsk,
  findAskById,
  listAllOpenAsks,
  listOpenAsksInRoom,
  openAskInRoom,
  resetAskStoreForTests,
  AskTargetNotHumanError
} from './askStore';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';

describe('askStore', () => {
  beforeEach(() => {
    resetAskStoreForTests();
  });

  it('openAskInRoom stores an ask with status=open and a generated id', () => {
    const ask = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 'shall we ship?',
      body: 'all tests pass, code-qa clean'
    });
    expect(ask.id.startsWith('ask_')).toBe(true);
    expect(ask.roomId).toBe('r1');
    expect(ask.openedByHandle).toBe('@you');
    expect(ask.openedByDisplayName).toBe('@you');
    expect(ask.title).toBe('shall we ship?');
    expect(ask.body).toBe('all tests pass, code-qa clean');
    expect(ask.status).toBe('open');
    expect(ask.openedAt.length).toBeGreaterThan(0);
  });

  it('uses openedByDisplayName when provided (trimmed)', () => {
    const ask = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@kimi',
      openedByDisplayName: '  Kimi K2  ',
      title: 't',
      body: 'b'
    });
    expect(ask.openedByDisplayName).toBe('Kimi K2');
  });

  it('trims title and body fields', () => {
    const ask = openAskInRoom({
      roomId: '  r1  ',
      openedByHandle: '  @you  ',
      title: '  padded title  ',
      body: '  padded body  '
    });
    expect(ask.roomId).toBe('r1');
    expect(ask.openedByHandle).toBe('@you');
    expect(ask.title).toBe('padded title');
    expect(ask.body).toBe('padded body');
  });

  it('rejects a blank roomId', () => {
    expect(() =>
      openAskInRoom({ roomId: '   ', openedByHandle: '@you', title: 't', body: 'b' })
    ).toThrow();
  });

  it('rejects a blank openedByHandle', () => {
    expect(() =>
      openAskInRoom({ roomId: 'r1', openedByHandle: '   ', title: 't', body: 'b' })
    ).toThrow();
  });

  it('rejects a blank title', () => {
    expect(() =>
      openAskInRoom({ roomId: 'r1', openedByHandle: '@you', title: '   ', body: 'b' })
    ).toThrow();
  });

  it('rejects a blank body', () => {
    expect(() =>
      openAskInRoom({ roomId: 'r1', openedByHandle: '@you', title: 't', body: '   ' })
    ).toThrow();
  });

  it('listOpenAsksInRoom returns open asks in open order', () => {
    const first = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 'first',
      body: 'b'
    });
    const second = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 'second',
      body: 'b'
    });
    const list = listOpenAsksInRoom('r1');
    expect(list.map((ask) => ask.id)).toEqual([first.id, second.id]);
  });

  it('listOpenAsksInRoom returns empty for an unknown room', () => {
    expect(listOpenAsksInRoom('nope')).toEqual([]);
  });

  it('listOpenAsksInRoom returns defensive copies (mutating result does not affect store)', () => {
    openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 't',
      body: 'b'
    });
    const list = listOpenAsksInRoom('r1');
    list[0].title = 'mutated';
    const refreshed = listOpenAsksInRoom('r1');
    expect(refreshed[0].title).toBe('t');
  });

  it('listAllOpenAsks aggregates across rooms', () => {
    openAskInRoom({ roomId: 'r1', openedByHandle: '@you', title: 'a', body: 'b' });
    openAskInRoom({ roomId: 'r2', openedByHandle: '@you', title: 'c', body: 'd' });
    expect(listAllOpenAsks()).toHaveLength(2);
  });

  it('listAllOpenAsks preserves global insertion order across interleaved rooms', () => {
    const firstInR1 = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 'first-r1',
      body: 'b'
    });
    const secondInR2 = openAskInRoom({
      roomId: 'r2',
      openedByHandle: '@you',
      title: 'second-r2',
      body: 'b'
    });
    const thirdInR1 = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 'third-r1',
      body: 'b'
    });
    expect(listAllOpenAsks().map((ask) => ask.id)).toEqual([
      firstInR1.id,
      secondInR2.id,
      thirdInR1.id
    ]);
  });

  it('findAskById returns the ask when present', () => {
    const ask = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 't',
      body: 'b'
    });
    expect(findAskById(ask.id)?.id).toBe(ask.id);
  });

  it('findAskById returns undefined for an unknown id', () => {
    expect(findAskById('does_not_exist')).toBeUndefined();
  });

  it('findAskById returns a defensive copy', () => {
    const ask = openAskInRoom({
      roomId: 'r1',
      openedByHandle: '@you',
      title: 't',
      body: 'b'
    });
    const found = findAskById(ask.id);
    if (found) found.title = 'mutated';
    expect(findAskById(ask.id)?.title).toBe('t');
  });

  it('keeps asks per-room independent', () => {
    openAskInRoom({ roomId: 'r1', openedByHandle: '@you', title: 't', body: 'b' });
    openAskInRoom({ roomId: 'r2', openedByHandle: '@you', title: 't', body: 'b' });
    expect(listOpenAsksInRoom('r1')).toHaveLength(1);
    expect(listOpenAsksInRoom('r2')).toHaveLength(1);
  });

  it('resetAskStoreForTests clears every ask', () => {
    openAskInRoom({ roomId: 'r1', openedByHandle: '@you', title: 't', body: 'b' });
    resetAskStoreForTests();
    expect(listAllOpenAsks()).toEqual([]);
    expect(listOpenAsksInRoom('r1')).toEqual([]);
  });

  describe('slice 2 status transitions', () => {
    it('answerAsk moves an open ask to answered and records the answer', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      const result = answerAsk({
        askId: ask.id,
        answeredByHandle: '@responder',
        answer: 'because we shipped it'
      });
      expect(result.status).toBe('answered');
      expect(result.answer).toBe('because we shipped it');
      expect(result.answeredByHandle).toBe('@responder');
      expect(result.answeredAt).toBeDefined();
    });

    it('answerAsk trims handle + answer fields', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      const result = answerAsk({
        askId: ask.id,
        answeredByHandle: '  @bob  ',
        answer: '  padded answer  '
      });
      expect(result.answeredByHandle).toBe('@bob');
      expect(result.answer).toBe('padded answer');
    });

    it('answerAsk rejects a blank answer', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      expect(() =>
        answerAsk({ askId: ask.id, answeredByHandle: '@bob', answer: '   ' })
      ).toThrow();
    });

    it('answerAsk rejects a blank answeredByHandle', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      expect(() =>
        answerAsk({ askId: ask.id, answeredByHandle: '   ', answer: 'x' })
      ).toThrow();
    });

    it('answerAsk rejects an unknown askId', () => {
      expect(() =>
        answerAsk({ askId: 'does_not_exist', answeredByHandle: '@bob', answer: 'x' })
      ).toThrow();
    });

    it('answerAsk rejects an already-answered ask', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      answerAsk({ askId: ask.id, answeredByHandle: '@bob', answer: 'first' });
      expect(() =>
        answerAsk({ askId: ask.id, answeredByHandle: '@bob', answer: 'second' })
      ).toThrow();
    });

    it('answerAsk rejects an already-dismissed ask', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      dismissAsk({ askId: ask.id, dismissedByHandle: '@bob' });
      expect(() =>
        answerAsk({ askId: ask.id, answeredByHandle: '@bob', answer: 'x' })
      ).toThrow();
    });

    it('dismissAsk moves an open ask to dismissed', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      const result = dismissAsk({
        askId: ask.id,
        dismissedByHandle: '@bob'
      });
      expect(result.status).toBe('dismissed');
      expect(result.dismissedByHandle).toBe('@bob');
      expect(result.dismissedAt).toBeDefined();
    });

    it('dismissAsk rejects an unknown askId', () => {
      expect(() =>
        dismissAsk({ askId: 'does_not_exist', dismissedByHandle: '@bob' })
      ).toThrow();
    });

    it('dismissAsk rejects an already-answered ask', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      answerAsk({ askId: ask.id, answeredByHandle: '@bob', answer: 'x' });
      expect(() =>
        dismissAsk({ askId: ask.id, dismissedByHandle: '@bob' })
      ).toThrow();
    });

    it('dismissAsk rejects an already-dismissed ask', () => {
      const ask = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 't',
        body: 'b'
      });
      dismissAsk({ askId: ask.id, dismissedByHandle: '@bob' });
      expect(() =>
        dismissAsk({ askId: ask.id, dismissedByHandle: '@bob' })
      ).toThrow();
    });

    it('answered and dismissed asks drop out of listOpenAsksInRoom and listAllOpenAsks', () => {
      const openOne = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 'still open',
        body: 'b'
      });
      const willAnswer = openAskInRoom({
        roomId: 'r1',
        openedByHandle: '@asker',
        title: 'will answer',
        body: 'b'
      });
      const willDismiss = openAskInRoom({
        roomId: 'r2',
        openedByHandle: '@asker',
        title: 'will dismiss',
        body: 'b'
      });
      answerAsk({ askId: willAnswer.id, answeredByHandle: '@bob', answer: 'x' });
      dismissAsk({ askId: willDismiss.id, dismissedByHandle: '@bob' });
      expect(listOpenAsksInRoom('r1').map((ask) => ask.id)).toEqual([openOne.id]);
      expect(listAllOpenAsks().map((ask) => ask.id)).toEqual([openOne.id]);
    });
  });

  describe('targetHandle (asks-as-pill slice 2)', () => {
    beforeEach(() => {
      resetChatRoomStoreForTests();
    });

    it('persists targetHandle when present + a human room member', () => {
      const room = createChatRoom({ name: 'pill-target-human', whoCreatedIt: '@you' });
      const ask = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@agentaskr',
        targetHandle: '@you',
        title: 'q',
        body: 'b'
      });
      expect(ask.targetHandle).toBe('@you');
      const reread = findAskById(ask.id);
      expect(reread?.targetHandle).toBe('@you');
    });

    it('throws AskTargetNotHumanError when targetHandle is an agent member', () => {
      const room = createChatRoom({ name: 'pill-target-agent', whoCreatedIt: '@you' });
      inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
      let raised: AskTargetNotHumanError | null = null;
      try {
        openAskInRoom({
          roomId: room.id,
          openedByHandle: '@you',
          targetHandle: '@evolveantcodex',
          title: 'q',
          body: 'b'
        });
      } catch (cause) {
        if (cause instanceof AskTargetNotHumanError) raised = cause;
      }
      expect(raised?.reason).toBe('is-agent');
      expect(raised?.targetHandle).toBe('@evolveantcodex');
    });

    it('throws AskTargetNotHumanError when targetHandle is not a member', () => {
      const room = createChatRoom({ name: 'pill-target-stranger', whoCreatedIt: '@you' });
      let raised: AskTargetNotHumanError | null = null;
      try {
        openAskInRoom({
          roomId: room.id,
          openedByHandle: '@you',
          targetHandle: '@randomstranger',
          title: 'q',
          body: 'b'
        });
      } catch (cause) {
        if (cause instanceof AskTargetNotHumanError) raised = cause;
      }
      expect(raised?.reason).toBe('not-a-member');
    });

    it('back-compat: omitting targetHandle still opens a room-broadcast ask', () => {
      const room = createChatRoom({ name: 'pill-no-target', whoCreatedIt: '@you' });
      const ask = openAskInRoom({
        roomId: room.id,
        openedByHandle: '@you',
        title: 'broadcast',
        body: 'b'
      });
      expect(ask.targetHandle).toBeUndefined();
    });
  });
});
