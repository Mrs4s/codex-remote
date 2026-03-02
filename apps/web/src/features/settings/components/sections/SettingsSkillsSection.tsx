import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type {
  ManagedSkill,
  RemoteSkill,
  SettingsSkillsSectionProps,
} from "@settings/hooks/useSettingsSkillsSection";

function localSkillSubtitle(skill: ManagedSkill): string {
  const details: string[] = [];
  if (skill.description) {
    details.push(skill.description);
  }
  if (skill.scope) {
    details.push(`Scope: ${skill.scope}`);
  }
  details.push(`Path: ${skill.path}`);
  return details.join(" · ");
}

function remoteSkillSubtitle(skill: RemoteSkill): string {
  const details: string[] = [];
  if (skill.description) {
    details.push(skill.description);
  }
  details.push(`Hazelnut ID: ${skill.hazelnutId}`);
  return details.join(" · ");
}

export function SettingsSkillsSection({
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
  onRefreshSkills,
  onToggleSkill,
  onLoadRemoteSkills,
  onLoadMoreRemoteSkills,
  onImportRemoteSkill,
  onManualImportIdChange,
  onManualImport,
}: SettingsSkillsSectionProps) {
  return (
    <SettingsSection
      title="Skills"
      subtitle="Manage installed Codex skills and import remote skills."
    >
      {!hasSkillsWorkspace && (
        <div className="settings-help">Connect a workspace to manage skills.</div>
      )}

      {hasSkillsWorkspace && (
        <>
          <SettingsToggleRow
            title="Installed skills"
            subtitle="Refresh local skills and toggle whether each skill is enabled."
          >
            <button
              type="button"
              className="ghost"
              onClick={onRefreshSkills}
              disabled={skillsLoading}
            >
              {skillsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </SettingsToggleRow>

          {skillsError && <div className="settings-help settings-help-error">{skillsError}</div>}
          {!skillsLoading && !skillsError && skills.length === 0 && (
            <div className="settings-help">No installed skills were returned by Codex.</div>
          )}

          {skills.map((skill) => (
            <SettingsToggleRow
              key={skill.path}
              title={skill.name}
              subtitle={localSkillSubtitle(skill)}
            >
              <SettingsToggleSwitch
                pressed={skill.enabled}
                onClick={() => onToggleSkill(skill)}
                disabled={updatingSkillPath === skill.path}
              />
            </SettingsToggleRow>
          ))}

          <SettingsSubsection
            title="Remote skills"
            subtitle="Load the remote catalog, then import skills by one click."
          />

          <div className="settings-field-row">
            <button
              type="button"
              className="ghost"
              onClick={onLoadRemoteSkills}
              disabled={remoteLoading}
            >
              {remoteLoading
                ? "Loading..."
                : remoteLoaded
                  ? "Reload catalog"
                  : "Load catalog"}
            </button>
            {remoteNextCursor && (
              <button
                type="button"
                className="ghost"
                onClick={onLoadMoreRemoteSkills}
                disabled={remoteLoading}
              >
                Load more
              </button>
            )}
          </div>

          {remoteError && <div className="settings-help settings-help-error">{remoteError}</div>}

          {remoteLoaded && !remoteLoading && !remoteError && remoteSkills.length === 0 && (
            <div className="settings-help">No remote skills returned for this account.</div>
          )}

          {remoteSkills.map((skill) => (
            <SettingsToggleRow
              key={skill.hazelnutId}
              title={skill.name}
              subtitle={remoteSkillSubtitle(skill)}
            >
              <button
                type="button"
                className="ghost"
                onClick={() => onImportRemoteSkill(skill.hazelnutId)}
                disabled={importingHazelnutId === skill.hazelnutId}
              >
                {importingHazelnutId === skill.hazelnutId ? "Importing..." : "Import"}
              </button>
            </SettingsToggleRow>
          ))}

          <div className="settings-field">
            <label className="settings-field-label" htmlFor="skills-hazelnut-id">
              Import by Hazelnut ID
            </label>
            <div className="settings-field-row">
              <input
                id="skills-hazelnut-id"
                className="settings-input settings-input--compact"
                value={manualImportId}
                onChange={(event) => onManualImportIdChange(event.target.value)}
                placeholder="hazelnut_..."
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                type="button"
                className="ghost"
                onClick={onManualImport}
                disabled={Boolean(importingHazelnutId)}
              >
                {importingHazelnutId ? "Importing..." : "Import"}
              </button>
            </div>
            <div className="settings-help">
              Use this when you already have a remote skill Hazelnut ID.
            </div>
          </div>

          {manualImportError && (
            <div className="settings-help settings-help-error">{manualImportError}</div>
          )}
          {manualImportStatus && <div className="settings-help">{manualImportStatus}</div>}
        </>
      )}
    </SettingsSection>
  );
}
