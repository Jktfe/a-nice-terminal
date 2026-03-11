// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import MessageList from "./MessageList";

const mockUseStore = vi.hoisted(() => vi.fn());

vi.mock("../store.ts", () => ({
  useStore: mockUseStore,
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => children,
}));

vi.mock("remark-gfm", () => ({ default: {} }));
vi.mock("rehype-highlight", () => ({ default: {} }));

const makeMessage = (id: string, content: string) => ({
  id,
  session_id: "session-1",
  role: "agent" as const,
  content,
  format: "markdown",
  status: "complete" as const,
  created_at: new Date().toISOString(),
});

describe("MessageList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-render and lose text selection when new messages arrive", () => {
    const msg1 = makeMessage("1", "Hello");
    const msg2 = makeMessage("2", "World");
    const msg3 = makeMessage("3", "New message");

    // Initial render with two messages
    mockUseStore.mockReturnValue({ messages: [msg1, msg2] });
    const { rerender } = render(<MessageList />);

    // Simulate the user selecting text (triggers selectionchange listener)
    const mockSelection = { toString: () => "selected text" };
    vi.spyOn(window, "getSelection").mockReturnValue(mockSelection as any);
    document.dispatchEvent(new Event("selectionchange"));

    // Clear any scrollIntoView calls from the initial render
    const scrollMock = Element.prototype.scrollIntoView as ReturnType<
      typeof vi.fn
    >;
    scrollMock.mockClear();

    // A new message arrives — component re-renders with updated list
    mockUseStore.mockReturnValue({ messages: [msg1, msg2, msg3] });
    act(() => {
      rerender(<MessageList />);
    });

    // scrollIntoView must NOT be called while the user has an active selection
    expect(scrollMock).not.toHaveBeenCalled();
  });
});
