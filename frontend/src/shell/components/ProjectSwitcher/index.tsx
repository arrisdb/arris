import { useMemo } from "react";
import { Select } from "@shared/ui";
import { currentProject, setCurrentProject } from "@shared/api";
import { NO_PROJECT_MESSAGE, SWITCHER_PLACEHOLDER, SWITCHER_TEST_ID, SWITCHER_TITLE } from "./constants";
import { useProjects } from "./hooks";
import { projectLabel, projectUrl } from "./utils";
import "./index.css";

function ProjectSwitcher() {
  const projects = useProjects();
  const options = useMemo(
    () => projects.map(({ root }) => ({ value: root, label: projectLabel(root) })),
    [projects],
  );
  const active = currentProject() ?? "";

  const switchTo = (root: string) => {
    setCurrentProject(root);
    window.location.assign(projectUrl(root));
  };

  return (
    <Select
      value={active}
      options={options}
      onChange={switchTo}
      placeholder={SWITCHER_PLACEHOLDER}
      title={active || SWITCHER_TITLE}
      data-testid={SWITCHER_TEST_ID}
    />
  );
}

function NoProjectScreen() {
  return (
    <div className="mdbc-no-project">
      <p>{NO_PROJECT_MESSAGE}</p>
      <ProjectSwitcher />
    </div>
  );
}

export { NoProjectScreen, ProjectSwitcher };
