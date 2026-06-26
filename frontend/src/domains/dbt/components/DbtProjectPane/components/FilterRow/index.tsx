import { SearchInput } from "@shared/ui";
import type { FilterRowProps } from "../../types";

function FilterRow({ value, onChange }: FilterRowProps) {
  return (
    <SearchInput
      value={value}
      onChange={onChange}
      placeholder="Filter"
      rowTestId="project-filter-row"
      testId="project-filter-input"
    />
  );
}

export { FilterRow };
