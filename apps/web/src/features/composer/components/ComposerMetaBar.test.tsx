/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadTokenUsage } from "../../../types";
import { ComposerMetaBar } from "./ComposerMetaBar";

const baseProps = {
  disabled: false,
  collaborationModes: [],
  selectedCollaborationModeId: null,
  onSelectCollaborationMode: vi.fn(),
  models: [],
  selectedModelId: null,
  onSelectModel: vi.fn(),
  reasoningOptions: [],
  selectedEffort: null,
  onSelectEffort: vi.fn(),
  reasoningSupported: false,
  accessMode: "current" as const,
  onSelectAccessMode: vi.fn(),
};

describe("ComposerMetaBar", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows compact session token usage when context data is available", () => {
    const tokenUsage: ThreadTokenUsage = {
      total: {
        totalTokens: 1200,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      last: {
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
      },
      modelContextWindow: null,
    };

    render(<ComposerMetaBar {...baseProps} contextUsage={tokenUsage} />);

    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("1.2k")).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Session token usage\nTotal: 1,200\nInput: 0\nCached input: 0\nOutput: 0\nReasoning output: 0",
      ),
    ).toBeTruthy();
  });

  it("shows placeholder session token usage when data is unavailable", () => {
    render(<ComposerMetaBar {...baseProps} contextUsage={null} />);

    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("--")).toBeTruthy();
    expect(screen.getByLabelText("Session token usage\nNo usage data yet")).toBeTruthy();
  });
});
