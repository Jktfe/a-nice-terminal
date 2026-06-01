import { describe, it, expect } from 'vitest';
import { classifyPi } from './pi';

const classify = (buf: string) => classifyPi(buf);

describe('classifyPi — TUI chrome demotion', () => {
  it('demotes box-drawing + 4+ q-runs', () => {
    expect(classify('│ ─ │\n').events[0].kind).toBe('raw');
    expect(classify('qqqqqq\n').events[0].kind).toBe('raw');
  });

  it('demotes spinner / status badges', () => {
    expect(classify('Streaming...\n').events[0].kind).toBe('raw');
    expect(classify('Done\n').events[0].kind).toBe('raw');
  });

  it('demotes separators + underscore cursor', () => {
    expect(classify('--------\n').events[0].kind).toBe('raw');
    expect(classify('___\n').events[0].kind).toBe('raw');
  });
});

describe('classifyPi — Ollama-mediated patterns', () => {
  it('demotes bare >>> Ollama prompt', () => {
    expect(classify('>>>\n').events[0].kind).toBe('raw');
    expect(classify('   >>>   \n').events[0].kind).toBe('raw');
  });

  it('demotes Ollama startup hint', () => {
    expect(classify('Use Ctrl+D or /bye to exit.\n').events[0].kind).toBe('raw');
  });

  it('demotes model-loading status lines', () => {
    expect(classify('Loading model "pi-base"\n').events[0].kind).toBe('raw');
    expect(classify('pulling manifest\n').events[0].kind).toBe('raw');
    expect(classify('downloading 1.2 GB\n').events[0].kind).toBe('raw');
    expect(classify('verifying sha256 digest\n').events[0].kind).toBe('raw');
    expect(classify('writing manifest\n').events[0].kind).toBe('raw');
    expect(classify('success\n').events[0].kind).toBe('raw');
  });

  it('demotes send/receive timing lines', () => {
    expect(classify('Sending request...\n').events[0].kind).toBe('raw');
    expect(classify('received 1024 bytes\n').events[0].kind).toBe('raw');
    expect(classify('completed done in 2.3s\n').events[0].kind).toBe('raw');
  });
});

describe('classifyPi — preserves real reply text', () => {
  it('plain text stays kind=message', () => {
    expect(classify('Hello! I can help you with that.\n').events[0].kind).toBe('message');
    expect(classify('The answer is 42.\n').events[0].kind).toBe('message');
  });

  it('text mentioning model words stays message when not standalone', () => {
    expect(classify('I am loading the model in my mind\n').events[0].kind).toBe('message');
    expect(classify('Done with the analysis and ready\n').events[0].kind).toBe('message');
  });

  it('classifies thinking/tool_call prefixes correctly', () => {
    expect(classify('[thinking] reasoning step\n').events[0].kind).toBe('thinking');
    expect(classify('[tool_use] grep src/\n').events[0].kind).toBe('tool_call');
  });
});
