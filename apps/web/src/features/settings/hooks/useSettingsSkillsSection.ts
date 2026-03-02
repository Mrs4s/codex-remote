import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportRemoteSkill,
  getSkillsList,
  getSkillsRemoteList,
  setSkillEnabled,
} from "@services/tauri";

type UseSettingsSkillsSectionArgs = {
  skillsWorkspaceId: string | null;
};

export type ManagedSkill = {
  name: string;
  path: string;
  description: string | null;
  scope: string | null;
  enabled: boolean;
};

export type RemoteSkill = {
  hazelnutId: string;
  name: string;
  description: string | null;
};

export type SettingsSkillsSectionProps = {
  hasSkillsWorkspace: boolean;
  skillsLoading: boolean;
  skillsError: string | null;
  skills: ManagedSkill[];
  updatingSkillPath: string | null;
  remoteSkills: RemoteSkill[];
  remoteLoading: boolean;
  remoteError: string | null;
  remoteLoaded: boolean;
  remoteNextCursor: string | null;
  importingHazelnutId: string | null;
  manualImportId: string;
  manualImportError: string | null;
  manualImportStatus: string | null;
  onRefreshSkills: () => void;
  onToggleSkill: (skill: ManagedSkill) => void;
  onLoadRemoteSkills: () => void;
  onLoadMoreRemoteSkills: () => void;
  onImportRemoteSkill: (hazelnutId: string) => void;
  onManualImportIdChange: (value: string) => void;
  onManualImport: () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickResultRoot(response: unknown): Record<string, unknown> {
  const record = asRecord(response);
  const result = asRecord(record?.result);
  return result ?? record ?? {};
}

function normalizeSkill(item: unknown): ManagedSkill | null {
  const record = asRecord(item);
  if (!record) {
    return null;
  }
  const name = String(record.name ?? "").trim();
  const path = String(record.path ?? "").trim() || name;
  if (!name || !path) {
    return null;
  }
  const description =
    typeof record.description === "string" && record.description.trim()
      ? record.description
      : null;
  const scope =
    typeof record.scope === "string" && record.scope.trim() ? record.scope : null;
  const enabled =
    typeof record.enabled === "boolean" ? record.enabled : Boolean(record.enabled);

  return {
    name,
    path,
    description,
    scope,
    enabled,
  };
}

function parseSkillsListResponse(response: unknown): ManagedSkill[] {
  const root = pickResultRoot(response);
  const directSkills = Array.isArray(root.skills) ? root.skills : [];
  const buckets = Array.isArray(root.data) ? root.data : [];
  const bucketSkills = buckets.flatMap((bucket) => {
    const record = asRecord(bucket);
    return Array.isArray(record?.skills) ? record.skills : [];
  });
  const source = directSkills.length > 0 ? directSkills : bucketSkills;

  const deduped = new Map<string, ManagedSkill>();
  for (const item of source) {
    const skill = normalizeSkill(item);
    if (!skill) {
      continue;
    }
    if (!deduped.has(skill.path)) {
      deduped.set(skill.path, skill);
    }
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function normalizeRemoteSkill(item: unknown): RemoteSkill | null {
  const record = asRecord(item);
  if (!record) {
    return null;
  }
  const hazelnutId =
    typeof record.hazelnutId === "string"
      ? record.hazelnutId.trim()
      : typeof record.hazelnut_id === "string"
        ? record.hazelnut_id.trim()
        : typeof record.id === "string"
          ? record.id.trim()
          : "";
  if (!hazelnutId) {
    return null;
  }

  const rawName =
    typeof record.name === "string"
      ? record.name
      : typeof record.displayName === "string"
        ? record.displayName
        : typeof record.display_name === "string"
          ? record.display_name
          : typeof record.title === "string"
            ? record.title
            : "";
  const name = rawName.trim() || hazelnutId;

  const description =
    typeof record.description === "string"
      ? record.description
      : typeof record.summary === "string"
        ? record.summary
        : null;

  return {
    hazelnutId,
    name,
    description,
  };
}

function parseRemoteListResponse(response: unknown): {
  skills: RemoteSkill[];
  nextCursor: string | null;
} {
  const root = pickResultRoot(response);
  const rawSkills = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.skills)
      ? root.skills
      : [];

  const deduped = new Map<string, RemoteSkill>();
  for (const item of rawSkills) {
    const skill = normalizeRemoteSkill(item);
    if (!skill) {
      continue;
    }
    if (!deduped.has(skill.hazelnutId)) {
      deduped.set(skill.hazelnutId, skill);
    }
  }

  const nextCursor =
    typeof root.nextCursor === "string"
      ? root.nextCursor
      : typeof root.next_cursor === "string"
        ? root.next_cursor
        : null;

  return {
    skills: Array.from(deduped.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    nextCursor,
  };
}

function mergeRemoteSkills(base: RemoteSkill[], incoming: RemoteSkill[]): RemoteSkill[] {
  const merged = new Map<string, RemoteSkill>();
  for (const item of base) {
    merged.set(item.hazelnutId, item);
  }
  for (const item of incoming) {
    merged.set(item.hazelnutId, item);
  }
  return Array.from(merged.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function useSettingsSkillsSection({
  skillsWorkspaceId,
}: UseSettingsSkillsSectionArgs): SettingsSkillsSectionProps {
  const [skills, setSkills] = useState<ManagedSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [updatingSkillPath, setUpdatingSkillPath] = useState<string | null>(null);

  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [remoteNextCursor, setRemoteNextCursor] = useState<string | null>(null);

  const [importingHazelnutId, setImportingHazelnutId] = useState<string | null>(null);
  const [manualImportId, setManualImportId] = useState("");
  const [manualImportError, setManualImportError] = useState<string | null>(null);
  const [manualImportStatus, setManualImportStatus] = useState<string | null>(null);

  const hasSkillsWorkspace = useMemo(() => skillsWorkspaceId !== null, [skillsWorkspaceId]);

  const refreshSkills = useCallback(async () => {
    if (!skillsWorkspaceId) {
      return;
    }
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const response = await getSkillsList(skillsWorkspaceId);
      setSkills(parseSkillsListResponse(response));
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : "Unable to load skills.");
    } finally {
      setSkillsLoading(false);
    }
  }, [skillsWorkspaceId]);

  useEffect(() => {
    if (!skillsWorkspaceId) {
      setSkills([]);
      setSkillsLoading(false);
      setSkillsError(null);
      setUpdatingSkillPath(null);
      setRemoteSkills([]);
      setRemoteLoading(false);
      setRemoteError(null);
      setRemoteLoaded(false);
      setRemoteNextCursor(null);
      setImportingHazelnutId(null);
      setManualImportId("");
      setManualImportError(null);
      setManualImportStatus(null);
      return;
    }
    void refreshSkills();
  }, [refreshSkills, skillsWorkspaceId]);

  const onToggleSkill = useCallback(
    (skill: ManagedSkill) => {
      if (!skillsWorkspaceId) {
        return;
      }
      void (async () => {
        const nextEnabled = !skill.enabled;
        setUpdatingSkillPath(skill.path);
        setSkillsError(null);
        setManualImportError(null);
        try {
          const response = await setSkillEnabled(
            skillsWorkspaceId,
            skill.path || skill.name,
            nextEnabled,
          );
          const responseRecord = asRecord(response);
          const resultRecord = asRecord(responseRecord?.result);
          const effectiveEnabledRaw =
            resultRecord?.effectiveEnabled ?? responseRecord?.effectiveEnabled;
          const effectiveEnabled =
            typeof effectiveEnabledRaw === "boolean"
              ? effectiveEnabledRaw
              : nextEnabled;
          setSkills((current) =>
            current.map((item) =>
              item.path === skill.path
                ? {
                    ...item,
                    enabled: effectiveEnabled,
                  }
                : item,
            ),
          );
        } catch (error) {
          setSkillsError(
            error instanceof Error ? error.message : "Unable to update skill status.",
          );
        } finally {
          setUpdatingSkillPath(null);
        }
      })();
    },
    [skillsWorkspaceId],
  );

  const loadRemoteSkills = useCallback(
    (append: boolean) => {
      if (!skillsWorkspaceId) {
        return;
      }
      if (remoteLoading) {
        return;
      }
      if (append && !remoteNextCursor) {
        return;
      }

      void (async () => {
        setRemoteLoading(true);
        setRemoteError(null);
        try {
          const response = await getSkillsRemoteList(
            skillsWorkspaceId,
            append ? remoteNextCursor : null,
            50,
          );
          const parsed = parseRemoteListResponse(response);
          setRemoteSkills((current) =>
            append ? mergeRemoteSkills(current, parsed.skills) : parsed.skills,
          );
          setRemoteNextCursor(parsed.nextCursor);
          setRemoteLoaded(true);
        } catch (error) {
          setRemoteError(
            error instanceof Error
              ? error.message
              : "Unable to load remote skills.",
          );
        } finally {
          setRemoteLoading(false);
        }
      })();
    },
    [remoteLoading, remoteNextCursor, skillsWorkspaceId],
  );

  const importSkill = useCallback(
    async (rawHazelnutId: string): Promise<boolean> => {
      const hazelnutId = rawHazelnutId.trim();
      if (!skillsWorkspaceId || !hazelnutId) {
        return false;
      }
      setImportingHazelnutId(hazelnutId);
      setManualImportError(null);
      setManualImportStatus(null);
      try {
        await exportRemoteSkill(skillsWorkspaceId, hazelnutId);
        setManualImportStatus(`Imported remote skill: ${hazelnutId}`);
        await refreshSkills();
        return true;
      } catch (error) {
        setManualImportError(
          error instanceof Error ? error.message : "Unable to import remote skill.",
        );
        return false;
      } finally {
        setImportingHazelnutId(null);
      }
    },
    [refreshSkills, skillsWorkspaceId],
  );

  const onImportRemoteSkill = useCallback(
    (hazelnutId: string) => {
      void importSkill(hazelnutId);
    },
    [importSkill],
  );

  const onManualImport = useCallback(() => {
    void (async () => {
      const trimmed = manualImportId.trim();
      if (!trimmed) {
        setManualImportError("Hazelnut ID is required.");
        return;
      }
      const imported = await importSkill(trimmed);
      if (imported) {
        setManualImportId("");
      }
    })();
  }, [importSkill, manualImportId]);

  return {
    hasSkillsWorkspace,
    skillsLoading,
    skillsError,
    skills,
    updatingSkillPath,
    remoteSkills,
    remoteLoading,
    remoteError,
    remoteLoaded,
    remoteNextCursor,
    importingHazelnutId,
    manualImportId,
    manualImportError,
    manualImportStatus,
    onRefreshSkills: () => {
      void refreshSkills();
    },
    onToggleSkill,
    onLoadRemoteSkills: () => {
      loadRemoteSkills(false);
    },
    onLoadMoreRemoteSkills: () => {
      loadRemoteSkills(true);
    },
    onImportRemoteSkill,
    onManualImportIdChange: (value: string) => {
      setManualImportId(value);
      if (manualImportError) {
        setManualImportError(null);
      }
    },
    onManualImport,
  };
}
