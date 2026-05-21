import { describe, it, expect } from 'vitest';
import { classifyQwen } from './qwen';

const classify = (buf: string) => classifyQwen(buf);

describe('classifyQwen — TUI chrome demotion', () => {
  it('demotes box-drawing + 4+ q-runs', () => {
    expect(classify('│ ─ │\n').events[0].kind).toBe('raw');
    expect(classify('qqqqqqqqqq\n').events[0].kind).toBe('raw');
  });

  it('demotes spinner / status badges', () => {
    expect(classify('Generating...\n').events[0].kind).toBe('raw');
    expect(classify('Done\n').events[0].kind).toBe('raw');
  });

  it('demotes separators + underscore cursor', () => {
    expect(classify('--------\n').events[0].kind).toBe('raw');
    expect(classify('___\n').events[0].kind).toBe('raw');
  });
});

describe('classifyQwen — mlx_lm-mediated patterns', () => {
  it('demotes bare >>> REPL prompt', () => {
    expect(classify('>>>\n').events[0].kind).toBe('raw');
  });

  it('demotes role markers User: / Assistant: / System:', () => {
    expect(classify('User:\n').events[0].kind).toBe('raw');
    expect(classify('Assistant:\n').events[0].kind).toBe('raw');
    expect(classify('System:\n').events[0].kind).toBe('raw');
  });

  it('demotes mlx_lm load status lines', () => {
    expect(classify('Loading model from /Users/foo/qwen3-7b\n').events[0].kind).toBe('raw');
    expect(classify('Fetching 6 files\n').events[0].kind).toBe('raw');
    expect(classify('Loaded weights\n').events[0].kind).toBe('raw');
  });

  it('demotes mlx_lm timing lines', () => {
    expect(classify('Tokens generated: 512\n').events[0].kind).toBe('raw');
    expect(classify('Peak memory: 6.2 GB\n').events[0].kind).toBe('raw');
    expect(classify('Generation took 2.3s\n').events[0].kind).toBe('raw');
    expect(classify('25.4 tok/s\n').events[0].kind).toBe('raw');
  });
});

describe('classifyQwen — preserves real reply text', () => {
  it('plain text stays kind=message', () => {
    expect(classify('Sure, I can help with that file.\n').events[0].kind).toBe('message');
    expect(classify('The answer involves matrix multiplication.\n').events[0].kind).toBe('message');
  });

  it('classifies <think> qwen3 thinking blocks correctly', () => {
    expect(classify('<think>step by step</think>\n').events[0].kind).toBe('thinking');
  });

  it('classifies thinking/tool_call prefix rules', () => {
    expect(classify('[thinking] step\n').events[0].kind).toBe('thinking');
    expect(classify('[tool_use] grep\n').events[0].kind).toBe('tool_call');
  });

  it('text mentioning tokens word stays message when not standalone', () => {
    expect(classify('Tokens are the basic unit of LLM input\n').events[0].kind).toBe('message');
  });
});
