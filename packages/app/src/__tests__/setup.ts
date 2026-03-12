/// <reference types="@testing-library/jest-dom/vitest" />
import { vi } from "vitest";

// Only apply DOM-specific setup in jsdom environment
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");

  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(cb, 0)) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
  }

  if (typeof globalThis.ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  Element.prototype.scrollIntoView = vi.fn();
}

// ---------- Shared mocks (harmless in node — never imported by server tests) ----------

vi.mock("motion/react", async () => {
  const React = await import("react");

  const motionPropNames = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
    "variants",
    "layout",
    "layoutId",
  ]);

  const filterMotionProps = (props: Record<string, unknown>) => {
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      if (!motionPropNames.has(key)) filtered[key] = val;
    }
    return filtered;
  };

  const createMotionComponent = (tag: string) =>
    React.forwardRef(({ children, ...props }: any, ref: any) =>
      React.createElement(tag, { ...filterMotionProps(props), ref }, children),
    );

  return {
    AnimatePresence: ({ children }: any) => children,
    motion: {
      div: createMotionComponent("div"),
      button: createMotionComponent("button"),
      span: createMotionComponent("span"),
    },
  };
});

vi.mock("lucide-react", async () => {
  const React = await import("react");

  const createIcon = (name: string) =>
    function MockIcon(props: any) {
      return React.createElement("svg", {
        "data-testid": `icon-${name}`,
        ...props,
      });
    };

  return {
    X: createIcon("X"),
    Save: createIcon("Save"),
    AlertCircle: createIcon("AlertCircle"),
    RefreshCw: createIcon("RefreshCw"),
    ChevronDown: createIcon("ChevronDown"),
    Clipboard: createIcon("Clipboard"),
    Edit3: createIcon("Edit3"),
    Send: createIcon("Send"),
    Search: createIcon("Search"),
    Copy: createIcon("Copy"),
    Check: createIcon("Check"),
    User: createIcon("User"),
    Bot: createIcon("Bot"),
    Sparkles: createIcon("Sparkles"),
    Info: createIcon("Info"),
    Clock: createIcon("Clock"),
  };
});
