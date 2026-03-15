// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import TerminalView from "./TerminalViewV2";

const { mockTerminal, mockSocket, mockApiFetch, mockTermSocket } = vi.hoisted(() => ({
  mockTerminal: {
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onSelectionChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onScroll: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onWriteParsed: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    focus: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    hasSelection: vi.fn().mockReturnValue(false),
    getSelection: vi.fn(),
    loadAddon: vi.fn(),
    scrollToBottom: vi.fn(),
    cols: 80,
    rows: 24,
    options: {},
    unicode: { activeVersion: "6" },
    buffer: { active: { viewportY: 0, baseY: 0 } },
  },
  mockSocket: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
  mockApiFetch: vi.fn(),
  mockTermSocket: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connected: true,
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => mockTerminal),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: vi.fn().mockImplementation(() => ({
    serialize: vi.fn().mockReturnValue(""),
    dispose: vi.fn(),
  })),
}));

vi.mock("socket.io-client", () => ({
  io: vi.fn().mockReturnValue(mockTermSocket),
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
    mockApiFetch.mockRejectedValue(new Error("test"));

    // Make requestAnimationFrame fire synchronously
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });

    // Patch HTMLElement.prototype.offsetWidth/Height so the container appears sized
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    // Restore offset properties
    delete (HTMLElement.prototype as any).offsetWidth;
    delete (HTMLElement.prototype as any).offsetHeight;
  });

  it("does not steal focus when text is selected", () => {
    const { container } = render(<TerminalView />);

    // With dimensions mocked, requestAnimationFrame fires tryInit synchronously,
    // which finds dimensions and opens the terminal immediately
    expect(mockTerminal.open).toHaveBeenCalled();

    mockTerminal.focus.mockClear();
    mockTerminal.hasSelection.mockReturnValue(true);

    const clickableDiv = container.querySelector(".flex-1.min-h-0.relative");
    expect(clickableDiv).not.toBeNull();
    fireEvent.click(clickableDiv!);

    expect(mockTerminal.focus).not.toHaveBeenCalled();
  });
});
