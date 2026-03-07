export function buildWorkspaceThreadKey(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}
