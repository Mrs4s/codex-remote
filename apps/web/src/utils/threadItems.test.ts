import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import {
  buildConversationItem,
  buildConversationItemFromThreadItem,
  buildItemsFromThread,
  getThreadCreatedTimestamp,
  getThreadTimestamp,
  mergeThreadItems,
  normalizeItem,
  prepareThreadItems,
  upsertItem,
} from "./threadItems";

describe("threadItems", () => {
  it("truncates long message text in normalizeItem", () => {
    const text = "a".repeat(21000);
    const item: ConversationItem = {
      id: "msg-1",
      kind: "message",
      role: "assistant",
      text,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("message");
    if (normalized.kind === "message") {
      expect(normalized.text).not.toBe(text);
      expect(normalized.text.endsWith("...")).toBe(true);
      expect(normalized.text.length).toBeLessThan(text.length);
    }
  });

  it("truncates extremely large tool output for fileChange and commandExecution", () => {
    const output = "x".repeat(250000);
    const item: ConversationItem = {
      id: "tool-1",
      kind: "tool",
      toolType: "fileChange",
      title: "File changes",
      detail: "",
      output,
    };
    const normalized = normalizeItem(item);
    expect(normalized.kind).toBe("tool");
    if (normalized.kind === "tool") {
      expect(normalized.output).not.toBe(output);
      expect(normalized.output?.endsWith("...")).toBe(true);
      expect((normalized.output ?? "").length).toBeLessThan(output.length);
    }
  });

  it("truncates older tool output in prepareThreadItems", () => {
    const output = "y".repeat(21000);
    const items: ConversationItem[] = Array.from({ length: 41 }, (_, index) => ({
      id: `tool-${index}`,
      kind: "tool",
      toolType: "commandExecution",
      title: "Tool",
      detail: "",
      output,
    }));
    const prepared = prepareThreadItems(items);
    const firstOutput = prepared[0].kind === "tool" ? prepared[0].output : undefined;
    const secondOutput = prepared[1].kind === "tool" ? prepared[1].output : undefined;
    expect(firstOutput).not.toBe(output);
    expect(firstOutput?.endsWith("...")).toBe(true);
    expect(secondOutput).toBe(output);
  });

  it("respects custom max items per thread in prepareThreadItems", () => {
    const items: ConversationItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `msg-${index}`,
      kind: "message",
      role: "assistant",
      text: `message ${index}`,
    }));
    const prepared = prepareThreadItems(items, { maxItemsPerThread: 3 });
    expect(prepared).toHaveLength(3);
    expect(prepared[0]?.id).toBe("msg-2");
    expect(prepared[2]?.id).toBe("msg-4");
  });

  it("supports unlimited max items per thread in prepareThreadItems", () => {
    const items: ConversationItem[] = Array.from({ length: 5 }, (_, index) => ({
      id: `msg-${index}`,
      kind: "message",
      role: "assistant",
      text: `message ${index}`,
    }));
    const prepared = prepareThreadItems(items, { maxItemsPerThread: null });
    expect(prepared).toHaveLength(5);
  });

  it("drops assistant review summaries that duplicate completed review items", () => {
    const items: ConversationItem[] = [
      {
        id: "review-1",
        kind: "review",
        state: "completed",
        text: "Review summary",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Review summary",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("review");
  });

  it("summarizes explored reads and hides raw commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: sed -n '1,10p' src/bar.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "msg-1",
        kind: "message",
        role: "assistant",
        text: "Done reading",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].label).toContain("foo.ts");
      expect(prepared[0].entries[1].kind).toBe("read");
      expect(prepared[0].entries[1].label).toContain("bar.ts");
    }
    expect(prepared.filter((item) => item.kind === "tool")).toHaveLength(0);
  });

  it("preserves summarized command tool calls under explore items for auditing", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "/repo",
        status: "completed",
        output: "file contents",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg RouterDestination src",
        detail: "/repo",
        status: "completed",
        output: "matches",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].toolCalls?.length).toBe(2);
      expect(prepared[0].toolCalls?.[0]?.title).toContain("cat src/foo.ts");
      expect(prepared[0].toolCalls?.[0]?.output).toBe("file contents");
      expect(prepared[0].toolCalls?.[1]?.title).toContain("rg RouterDestination src");
      expect(prepared[0].toolCalls?.[1]?.output).toBe("matches");
    }
  });

  it("upserts tool updates into explore toolCalls instead of appending a new item", () => {
    const initial: ConversationItem[] = prepareThreadItems([
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg foo src",
        detail: "/repo",
        status: "inProgress",
        output: "partial",
      },
    ]);

    expect(initial).toHaveLength(1);
    expect(initial[0].kind).toBe("explore");

    const updatedList = upsertItem(initial, {
      id: "cmd-1",
      kind: "tool",
      toolType: "commandExecution",
      title: "Command: rg foo src",
      detail: "/repo",
      status: "completed",
      output: "final output",
    });

    expect(updatedList).toHaveLength(1);
    expect(updatedList[0].kind).toBe("explore");
    if (updatedList[0].kind === "explore") {
      expect(updatedList[0].toolCalls?.[0]?.status).toBe("completed");
      expect(updatedList[0].toolCalls?.[0]?.output).toBe("final output");
    }
  });

  it("treats inProgress command status as exploring", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg RouterDestination src",
        detail: "",
        status: "inProgress",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].status).toBe("exploring");
      expect(prepared[0].entries[0]?.kind).toBe("search");
    }
  });

  it("prefers structured command actions when summarizing exploration", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-actions-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: python tool.py",
        detail: "/repo",
        status: "completed",
        output: "",
        commandActions: [
          {
            type: "read",
            command: "python tool.py",
            name: "README.md",
            path: "README.md",
          },
          {
            type: "unknown",
            command: "python tool.py --summarize",
          },
        ],
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toEqual([
        { kind: "read", label: "README.md" },
        { kind: "run", label: "python tool.py --summarize" },
      ]);
    }
  });

  it("deduplicates explore entries when consecutive summaries merge", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/customPrompts.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].label).toContain("customPrompts.ts");
    }
  });

  it("preserves distinct read paths that share the same basename", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
      {
        id: "cmd-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat tests/foo/index.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      const details = prepared[0].entries.map((entry) => entry.detail ?? entry.label);
      expect(details).toContain("src/foo/index.ts");
      expect(details).toContain("tests/foo/index.ts");
    }
  });

  it("preserves multi-path read commands instead of collapsing to the last path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/a.ts src/b.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(2);
      const details = prepared[0].entries.map((entry) => entry.detail ?? entry.label);
      expect(details).toContain("src/a.ts");
      expect(details).toContain("src/b.ts");
    }
  });

  it("ignores glob patterns when summarizing rg --files commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("list");
      expect(prepared[0].entries[0].label).toBe("src");
    }
  });

  it("skips rg glob flag values and keeps the actual search path", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg myQuery -g '*.ts' src",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("myQuery in src");
    }
  });

  it("unwraps unquoted /bin/zsh -lc rg commands", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: /bin/zsh -lc rg -n "RouterDestination" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("RouterDestination in src");
    }
  });

  it("treats nl -ba as a read command", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].detail ?? prepared[0].entries[0].label).toBe(
        "src/foo.ts",
      );
    }
  });

  it("summarizes piped nl commands using the left-hand read", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: nl -ba src/foo.ts | sed -n '1,10p'",
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("read");
      expect(prepared[0].entries[0].detail ?? prepared[0].entries[0].label).toBe(
        "src/foo.ts",
      );
    }
  });

  it("does not trim pipes that appear inside quoted arguments", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: 'Command: rg "foo | bar" src',
        detail: "",
        status: "completed",
        output: "",
      },
    ];

    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("explore");
    if (prepared[0].kind === "explore") {
      expect(prepared[0].entries).toHaveLength(1);
      expect(prepared[0].entries[0].kind).toBe("search");
      expect(prepared[0].entries[0].label).toBe("foo | bar in src");
    }
  });

  it("keeps raw commands when they are not recognized", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: git status",
        detail: "",
        status: "completed",
        output: "",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("tool");
  });

  it("keeps raw commands when they fail", () => {
    const items: ConversationItem[] = [
      {
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: cat src/foo.ts",
        detail: "",
        status: "failed",
        output: "No such file",
      },
    ];
    const prepared = prepareThreadItems(items);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].kind).toBe("tool");
  });

  it("builds file change items with summary details", () => {
    const item = buildConversationItem({
      type: "fileChange",
      id: "change-1",
      status: "done",
      changes: [
        {
          path: "foo.txt",
          kind: "add",
          diff: "diff --git a/foo.txt b/foo.txt",
        },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("File changes");
      expect(item.detail).toBe("A foo.txt");
      expect(item.output).toContain("diff --git a/foo.txt b/foo.txt");
      expect(item.changes?.[0]?.path).toBe("foo.txt");
    }
  });

  it("builds dynamic exec_command tool calls as command executions", () => {
    const item = buildConversationItem({
      type: "dynamicToolCall",
      id: "tool-exec-1",
      tool: "exec_command",
      status: "completed",
      arguments: {
        cmd: "rg buildConversationItem apps/web/src",
        workdir: "/repo",
      },
      contentItems: [{ type: "inputText", text: "matched lines" }],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("commandExecution");
      expect(item.title).toContain("rg buildConversationItem");
      expect(item.detail).toBe("/repo");
      expect(item.output).toBe("matched lines");
    }
  });

  it("builds raw local shell calls as command executions", () => {
    const item = buildConversationItem({
      type: "local_shell_call",
      call_id: "call-shell-1",
      status: "completed",
      action: {
        type: "exec",
        command: ["sed", "-n", "1,40p", "README.md"],
        working_directory: "/repo",
      },
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.id).toBe("call-shell-1");
      expect(item.toolType).toBe("commandExecution");
      expect(item.title).toContain("sed -n 1,40p README.md");
      expect(item.detail).toBe("/repo");
    }
  });

  it("builds raw custom tool calls as dynamic tool items", () => {
    const item = buildConversationItem({
      type: "custom_tool_call",
      call_id: "call-tool-1",
      status: "completed",
      name: "exec_command",
      input: "{\"cmd\":\"cat docs/architecture.md\",\"workdir\":\"/repo\"}",
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.id).toBe("call-tool-1");
      expect(item.toolType).toBe("commandExecution");
      expect(item.title).toContain("cat docs/architecture.md");
      expect(item.detail).toBe("/repo");
    }
  });

  it("parses apply_patch tool calls as file changes", () => {
    const item = buildConversationItem({
      type: "dynamicToolCall",
      id: "tool-apply-patch-1",
      tool: "apply_patch",
      status: "completed",
      arguments: [
        "*** Begin Patch",
        "*** Update File: apps/web/src/utils/threadItems.ts",
        "@@",
        "-old line",
        "+new line",
        "*** Add File: docs/notes.md",
        "+hello",
        "*** End Patch",
      ].join("\n"),
      contentItems: [{ type: "outputText", text: "Patch applied successfully." }],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("fileChange");
      expect(item.detail).toContain("apps/web/src/utils/threadItems.ts");
      expect(item.detail).toContain("docs/notes.md");
      expect(item.changes?.map((change) => change.path)).toEqual([
        "apps/web/src/utils/threadItems.ts",
        "docs/notes.md",
      ]);
      expect(item.output).toContain("+new line");
    }
  });

  it("formats standalone write_stdin tool calls with session details", () => {
    const item = buildConversationItem({
      type: "dynamicToolCall",
      id: "tool-write-stdin-1",
      tool: "write_stdin",
      status: "completed",
      arguments: {
        session_id: 12345,
        chars: "y\n",
      },
      contentItems: [{ type: "outputText", text: "continued output" }],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("dynamicToolCall");
      expect(item.title).toBe("Terminal input");
      expect(item.detail).toBe("Session 12345");
      expect(item.output).toContain("[stdin]");
      expect(item.output).toContain("continued output");
    }
  });

  it("defaults web search items to completed status", () => {
    const item = buildConversationItem({
      type: "webSearch",
      id: "web-1",
      query: "codex monitor",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("webSearch");
      expect(item.status).toBe("completed");
      expect(item.detail).toBe("codex monitor");
    }
  });

  it("merges thread items preferring non-empty remote tool output", () => {
    const remote: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "ok",
      output: "short",
    };
    const local: ConversationItem = {
      id: "tool-2",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      output: "much longer output",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].output).toBe("short");
      expect(merged[0].status).toBe("ok");
    }
  });

  it("keeps local tool output when remote output is empty", () => {
    const remote: ConversationItem = {
      id: "tool-3",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: " ",
    };
    const local: ConversationItem = {
      id: "tool-3",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      output: "streamed output",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].output).toBe("streamed output");
      expect(merged[0].status).toBe("completed");
    }
  });

  it("keeps local tool status when remote status is empty", () => {
    const remote: ConversationItem = {
      id: "tool-remote-status",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "",
      output: "",
    };
    const local: ConversationItem = {
      id: "tool-remote-status",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: "",
    };
    const merged = mergeThreadItems([remote], [local]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("tool");
    if (merged[0].kind === "tool") {
      expect(merged[0].status).toBe("completed");
    }
  });

  it("preserves streamed plan output when completion item has empty output", () => {
    const existing: ConversationItem = {
      id: "plan-1",
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: "Generating plan...",
      status: "in_progress",
      output: "## Plan\n- Step 1\n- Step 2",
    };
    const completed: ConversationItem = {
      id: "plan-1",
      kind: "tool",
      toolType: "plan",
      title: "Plan",
      detail: "",
      status: "completed",
      output: "",
    };

    const next = upsertItem([existing], completed);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("tool");
    if (next[0].kind === "tool") {
      expect(next[0].output).toBe(existing.output);
      expect(next[0].status).toBe("completed");
    }
  });

  it("uses incoming tool output even when shorter than existing output", () => {
    const existing: ConversationItem = {
      id: "tool-4",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "in_progress",
      output: "verbose streamed output that will be replaced",
    };
    const incoming: ConversationItem = {
      id: "tool-4",
      kind: "tool",
      toolType: "webSearch",
      title: "Web search",
      detail: "query",
      status: "completed",
      output: "final",
    };

    const next = upsertItem([existing], incoming);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("tool");
    if (next[0].kind === "tool") {
      expect(next[0].output).toBe("final");
      expect(next[0].status).toBe("completed");
    }
  });

  it("preserves streamed reasoning content when completion item is empty", () => {
    const existing: ConversationItem = {
      id: "reasoning-1",
      kind: "reasoning",
      summary: "Thinking",
      content: "More detail",
    };
    const completed: ConversationItem = {
      id: "reasoning-1",
      kind: "reasoning",
      summary: "",
      content: "",
    };

    const next = upsertItem([existing], completed);
    expect(next).toHaveLength(1);
    expect(next[0].kind).toBe("reasoning");
    if (next[0].kind === "reasoning") {
      expect(next[0].summary).toBe("Thinking");
      expect(next[0].content).toBe("More detail");
    }
  });

  it("builds user message text from mixed inputs", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-1",
      content: [
        { type: "text", text: "Please" },
        { type: "skill", name: "Review" },
        { type: "image", url: "https://example.com/image.png" },
      ],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("Please $Review");
      expect(item.images).toEqual(["https://example.com/image.png"]);
    }
  });

  it("keeps image-only user messages without placeholder text", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "msg-2",
      content: [{ type: "image", url: "https://example.com/only.png" }],
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("user");
      expect(item.text).toBe("");
      expect(item.images).toEqual(["https://example.com/only.png"]);
    }
  });

  it("converts tagged sub-agent notifications from thread history into tool items", () => {
    const item = buildConversationItemFromThreadItem({
      type: "userMessage",
      id: "subagent-history-1",
      content: [
        {
          type: "text",
          text: `<subagent_notification>
{"agent_id":"agent-123","status":{"completed":"Finished the handoff"}}
</subagent_notification>`,
        },
      ],
    });

    expect(item).not.toBeNull();
    expect(item?.kind).toBe("tool");
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("subagentNotification");
      expect(item.detail).toBe("Agent agent-123");
      expect(item.status).toBe("completed");
      expect(item.output).toBe("Finished the handoff");
    }
  });

  it("converts tagged sub-agent notifications from live user items into tool items", () => {
    const item = buildConversationItem({
      type: "userMessage",
      id: "subagent-live-1",
      content: [
        {
          type: "text",
          text: `<subagent_notification>
{"agent_id":"agent-456","status":{"errored":"Interrupted"}}
</subagent_notification>`,
        },
      ],
    });

    expect(item).not.toBeNull();
    expect(item?.kind).toBe("tool");
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("subagentNotification");
      expect(item.detail).toBe("Agent agent-456");
      expect(item.status).toBe("errored");
      expect(item.output).toBe("Interrupted");
    }
  });

  it("extracts structured assistant text from thread history items", () => {
    const item = buildConversationItemFromThreadItem({
      type: "agentMessage",
      id: "assistant-structured-1",
      text: [
        { type: "output_text", text: "First paragraph" },
        { type: "output_text", text: "Second paragraph" },
      ],
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "message") {
      expect(item.role).toBe("assistant");
      expect(item.text).toBe("First paragraph\n\nSecond paragraph");
    }
  });

  it("extracts structured reasoning text without object placeholders", () => {
    const item = buildConversationItem({
      type: "reasoning",
      id: "reasoning-structured-1",
      summary: [{ type: "summary_text", text: "Explored" }],
      content: [
        { type: "output_text", text: "Checked package.json" },
        { type: "output_text", text: "Opened page.tsx" },
      ],
    });

    expect(item).not.toBeNull();
    expect(item?.kind).toBe("reasoning");
    if (item && item.kind === "reasoning") {
      expect(item.summary).toBe("Explored");
      expect(item.content).toBe("Checked package.json\n\nOpened page.tsx");
      expect(item.summary).not.toContain("[object Object]");
      expect(item.content).not.toContain("[object Object]");
    }
  });

  it("falls back to call_id for thread history tool items", () => {
    const item = buildConversationItemFromThreadItem({
      type: "local_shell_call",
      call_id: "call-shell-1",
      status: "completed",
      action: {
        type: "exec",
        command: ["sed", "-n", "1,40p", "README.md"],
        working_directory: "/repo",
      },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.id).toBe("call-shell-1");
      expect(item.toolType).toBe("commandExecution");
      expect(item.title).toContain("sed -n 1,40p README.md");
    }
  });

  it("preserves tool calls from thread history after refresh preparation", () => {
    const items = prepareThreadItems(
      buildItemsFromThread({
        turns: [
          {
            items: [
              {
                type: "local_shell_call",
                call_id: "call-shell-1",
                status: "completed",
                action: {
                  type: "exec",
                  command: ["sed", "-n", "1,40p", "README.md"],
                  working_directory: "/repo",
                },
              },
              {
                type: "custom_tool_call",
                call_id: "call-tool-1",
                status: "completed",
                name: "exec_command",
                input:
                  '{"cmd":"rg buildConversationItem apps/web/src","workdir":"/repo"}',
              },
            ],
          },
        ],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("explore");
    if (items[0]?.kind === "explore") {
      expect(items[0].toolCalls?.map((tool) => tool.id)).toEqual([
        "call-shell-1",
        "call-tool-1",
      ]);
      expect(items[0].entries).toHaveLength(2);
    }
  });

  it("formats collab tool calls with receivers and agent states", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-1",
      tool: "handoff",
      status: "ok",
      senderThreadId: "thread-a",
      receiverThreadIds: ["thread-b"],
      newThreadId: "thread-c",
      prompt: "Coordinate work",
      agentStatus: { "agent-1": { status: "running" } },
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.title).toBe("Collab: handoff");
      expect(item.detail).toContain("From thread-a");
      expect(item.detail).toContain("thread-b");
      expect(item.detail).toContain("thread-c");
      expect(item.output).toBe("Coordinate work\n\nagent-1: running");
    }
  });

  it("captures rich collab metadata from receiver_agents and agent_statuses", () => {
    const item = buildConversationItem({
      type: "collabToolCall",
      id: "collab-rich-1",
      tool: "wait",
      status: "completed",
      sender_thread_id: "thread-parent",
      receiver_agents: [
        {
          thread_id: "thread-child-1",
          agent_nickname: "Robie",
          agent_role: "explorer",
        },
      ],
      agent_statuses: [
        {
          thread_id: "thread-child-1",
          status: "completed",
          agent_nickname: "Robie",
          agent_role: "explorer",
        },
      ],
      prompt: "Wait for workers",
    });

    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.collabSender).toEqual({ threadId: "thread-parent" });
      expect(item.collabReceiver).toEqual({
        threadId: "thread-child-1",
        nickname: "Robie",
        role: "explorer",
      });
      expect(item.collabReceivers).toEqual([
        {
          threadId: "thread-child-1",
          nickname: "Robie",
          role: "explorer",
        },
      ]);
      expect(item.collabStatuses).toEqual([
        {
          threadId: "thread-child-1",
          nickname: "Robie",
          role: "explorer",
          status: "completed",
        },
      ]);
      expect(item.detail).toContain("Robie [explorer]");
      expect(item.output).toContain("Robie [explorer]: completed");
    }
  });

  it("builds context compaction items", () => {
    const item = buildConversationItem({
      type: "contextCompaction",
      id: "compact-1",
      status: "inProgress",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("contextCompaction");
      expect(item.title).toBe("Context compaction");
      expect(item.status).toBe("inProgress");
    }
  });

  it("builds context compaction items from thread history", () => {
    const item = buildConversationItemFromThreadItem({
      type: "contextCompaction",
      id: "compact-2",
    });
    expect(item).not.toBeNull();
    if (item && item.kind === "tool") {
      expect(item.toolType).toBe("contextCompaction");
      expect(item.title).toBe("Context compaction");
      expect(item.status).toBe("completed");
    }
  });

  it("parses ISO timestamps for thread updates", () => {
    const timestamp = getThreadTimestamp({ updated_at: "2025-01-01T00:00:00Z" });
    expect(timestamp).toBe(Date.parse("2025-01-01T00:00:00Z"));
  });

  it("returns 0 for invalid thread timestamps", () => {
    const timestamp = getThreadTimestamp({ updated_at: "not-a-date" });
    expect(timestamp).toBe(0);
  });

  it("parses created timestamps", () => {
    const timestamp = getThreadCreatedTimestamp({ created_at: "2025-01-01T00:00:00Z" });
    expect(timestamp).toBe(Date.parse("2025-01-01T00:00:00Z"));
  });

});
