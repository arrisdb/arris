import type { SettingsSectionProps } from "../../types";

function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="mdbc-settings-section">
      <div className="mdbc-settings-section-header">
        <div className="mdbc-settings-section-title">{title}</div>
        {description && <div className="mdbc-settings-section-description">{description}</div>}
      </div>
      {children}
    </section>
  );
}

export { SettingsSection };
