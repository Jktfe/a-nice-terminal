import { describe, expect, it } from 'vitest';
import { Osc133BlockParser } from '../src/lib/server/osc133';

function harness() {
  let offset = 0;
  let now = 1_000;
  const parser = new Osc133BlockParser(() => {
    now += 10;
    return now;
  });

  return {
    feed(data: string) {
      const events = parser.push(data, offset);
      offset += Buffer.byteLength(data);
      return events;
    },
  };
}

describe('OSC 133 block parser', () => {
  it('ignores prompt-only command-end markers', () => {
    const h = harness();
    expect(h.feed('\x1b]133;D;0\x07\x1b]133;A\x07')).toEqual([]);
  });

  it('emits a high-trust command block from A/B/C/D markers', () => {
    const h = harness();
    expect(h.feed('\x1b]133;A\x07')).toEqual([]);
    expect(h.feed('\x1b]7;file://host/Users/james/project\x07')).toEqual([]);
    expect(h.feed('$ ls\n\x1b]133;B\x07')).toEqual([]);
    const events = h.feed('\x1b]133;C\x07file.txt\n\x1b]133;D;0\x07');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      command: 'ls',
      exitCode: 0,
      cwd: '/Users/james/project',
    });
    expect(events[0].rawStartByte).toBeLessThan(events[0].rawEndByte);
    expect(events[0].markers.commandStartByte).not.toBeNull();
    expect(events[0].markers.outputStartByte).not.toBeNull();
  });

  it('handles split OSC terminators and OSC 1337 CurrentDir', () => {
    const h = harness();
    h.feed('\x1b]133;A\x07');
    h.feed('\x1b]1337;CurrentDir=/tmp/with%20space\x07');
    h.feed('❯ false\n\x1b]133;B\x07\x1b]133;C\x07');
    expect(h.feed('\x1b]133;D;')).toEqual([]);
    const events = h.feed('1\x07');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      command: 'false',
      exitCode: 1,
      cwd: '/tmp/with space',
    });
  });

  it('extracts zsh prompt commands when the cursor is flush to the prompt marker', () => {
    const h = harness();
    h.feed('\x1b]133;A\x07james@host project %ls\n\x1b]133;B\x07\x1b]133;C\x07');
    const events = h.feed('\x1b]133;D;0\x07');
    expect(events[0].command).toBe('ls');
  });
});
