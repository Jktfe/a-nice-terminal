// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import TerminalView from "./TerminalView";

const { mockTerminal, mockSocket, mockApiFetch } = vi.hoisted(() => ({
  mockTerminal: {
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onSelectionChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    focus: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    hasSelection: vi.fn().mockReturnValue(false),
    getSelection: vi.fn(),
    loadAddon: vi.fn(),
    scrollToBottom: vi.fn(),
    cols: 80,
    rows: 24,
  },
  mockSocket: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  mockApiFetch: vi.fn(),
}));

vi.mock("xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => mockTerminal),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("../store.ts", () => ({
  useStore: () => ({
    activeSessionId: "test-session",
    socket: mockSocket,
    uploadFile: vi.fn(),
    connected: true,
    sessionHealth: {},
    sessions: [{ id: "test-session", name: "Test", type: "terminal", ttl_minutes: null }],
    loadSessions: vi.fn(),
    terminalFontSize: 14,
    terminalTheme: "dark",
  }),
  apiFetch: mockApiFetch,
}));

describe("TerminalView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiFetch.mockResolvedValue({
      events: [],
      sessionId: "test-session",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not steal focus when text is selected", async () => {
    const { container } = render(<TerminalView />);

    // Advance timers to trigger requestAnimationFrame + init polling loop
    // (20 attempts × 50ms = 1000ms, then last-resort open)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(mockTerminal.open).toHaveBeenCalled();

    // Clear focus calls that happened during initialization
    mockTerminal.focus.mockClear();

    // Simulate active text selection in the terminal
    mockTerminal.hasSelection.mockReturnValue(true);

    // Click the terminal container wrapper
    const clickableDiv = container.querySelector(".flex-1.min-h-0.relative");
    expect(clickableDiv).not.toBeNull();
    fireEvent.click(clickableDiv!);

    // focus() should NOT have been called because there is a selection
    expect(mockTerminal.focus).not.toHaveBeenCalled();
  });
});
