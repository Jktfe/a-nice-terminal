import { describe, it, expect } from 'vitest';
import { classifyGemini } from './gemini';

function classify(buf: string) {
  return classifyGemini(buf);
}

describe('classifyGemini — TUI chrome demotion', () => {
  it('demotes box-drawing-only lines to raw', () => {
    expect(classify('│ ─ │ ─ │\n').events[0].kind).toBe('raw');
    expect(classify('┌──────┐\n').events[0].kind).toBe('raw');
  });

  it('demotes 4+ q-run horizontal separator (post-strip)', () => {
    expect(classify('qqqqqqqqqq\n').events[0].kind).toBe('raw');
  });

  it('demotes hotkey-footer lines', () => {
    expect(classify('esc to cancel\n').events[0].kind).toBe('raw');
    expect(classify('ctrl+c to exit\n').events[0].kind).toBe('raw');
  });

  it('demotes spinner / status lines', () => {
    expect(classify('Generating...\n').events[0].kind).toBe('raw');
    expect(classify('  Thinking\n').events[0].kind).toBe('raw');
    expect(classify('Done\n').events[0].kind).toBe('raw');
  });

  it('demotes underscore cursor + separator lines', () => {
    expect(classify('___\n').events[0].kind).toBe('raw');
    expect(classify('--------\n').events[0].kind).toBe('raw');
    expect(classify('========\n').events[0].kind).toBe('raw');
  });
});

describe('classifyGemini — gemini-specific patterns', () => {
  it('demotes bare gemini> prompt scaffolding', () => {
    expect(classify('gemini>\n').events[0].kind).toBe('raw');
  });

  it('demotes [model: gemini-1.5-pro] header tag', () => {
    expect(classify('[model: gemini-1.5-pro]\n').events[0].kind).toBe('raw');
    expect(classify('[gemini-cli v2.3]\n').events[0].kind).toBe('raw');
  });

  it('classifies "Using <tool>..." as tool_call', () => {
    expect(classify('Using grep...\n').events[0].kind).toBe('tool_call');
  });

  it('classifies [reasoning] prefix as thinking', () => {
    expect(classify('[reasoning] thinking through it\n').events[0].kind).toBe('thinking');
  });

  it('classifies [tool_use] prefix as tool_call', () => {
    expect(classify('[tool_use] curl example.com\n').events[0].kind).toBe('tool_call');
  });
});

describe('classifyGemini — preserves real reply text', () => {
  it('plain text becomes kind=message', () => {
    expect(classify('Yes, I can help with that file.\n').events[0].kind).toBe('message');
    expect(classify('Here is the answer to your question.\n').events[0].kind).toBe('message');
  });

  it('text mentioning trigger words stays message when not standalone', () => {
    expect(classify('Working on the file you mentioned\n').events[0].kind).toBe('message');
    expect(classify('Done with the analysis and ready\n').events[0].kind).toBe('message');
  });
});
