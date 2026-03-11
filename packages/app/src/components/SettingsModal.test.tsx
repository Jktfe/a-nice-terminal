// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SettingsModal from "./SettingsModal";

const mockToggleSettings = vi.hoisted(() => vi.fn());
const mockApiFetch = vi.hoisted(() => vi.fn());

vi.mock("../store.ts", () => ({
  useStore: () => ({
    settingsOpen: true,
    toggleSettings: mockToggleSettings,
  }),
  apiFetch: mockApiFetch,
}));

describe("SettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("loads and displays ANT_PORT and ANT_ROOT_DIR from environment variables", async () => {
    mockApiFetch.mockResolvedValueOnce({
      ANT_PORT: "4000",
      ANT_ROOT_DIR: "/home/user/projects",
    });

    render(<SettingsModal />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("4000")).toBeInTheDocument();
      expect(
        screen.getByDisplayValue("/home/user/projects"),
      ).toBeInTheDocument();
    });
  });

  it("saves updated ANT_PORT and ANT_ROOT_DIR to the .env file", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ANT_PORT: "3000", ANT_ROOT_DIR: "" })
      .mockResolvedValueOnce({ success: true });

    render(<SettingsModal />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("3000")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue("3000"), {
      target: { value: "5000" },
    });

    fireEvent.change(screen.getByPlaceholderText("~/CascadeProjects"), {
      target: { value: "/opt/projects" },
    });

    fireEvent.click(screen.getByText("Save Settings"));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          ANT_PORT: "5000",
          ANT_ROOT_DIR: "/opt/projects",
        }),
      });
    });
  });

  it("displays an error message if saving settings fails", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ ANT_PORT: "3000", ANT_ROOT_DIR: "" })
      .mockRejectedValueOnce(new Error("Permission denied"));

    render(<SettingsModal />);

    await waitFor(() => {
      expect(screen.getByDisplayValue("3000")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Save Settings"));

    await waitFor(() => {
      expect(screen.getByText("Permission denied")).toBeInTheDocument();
    });
  });
});
