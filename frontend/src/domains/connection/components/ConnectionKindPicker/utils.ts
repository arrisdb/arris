import { kindStyle } from "@domains/connection/utils/databaseKindIcon";
import { pickerKinds } from "../utils/drivers/registry";
import {
  DATA_SOURCES_GROUP_TITLE,
  OTHER_GROUP_TITLE,
  OTHER_KINDS,
} from "./constants";
import type { PickerKindGroup, PickerKindOption } from "./types";

function matchingOptions(query: string): PickerKindOption[] {
  const normalized = query.trim().toLowerCase();
  return pickerKinds()
    .map((kind) => ({ kind, displayName: kindStyle(kind).displayName }))
    .filter((option) => option.displayName.toLowerCase().includes(normalized))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function pickerKindGroups(query: string): PickerKindGroup[] {
  const options = matchingOptions(query);
  const databases = options.filter((option) => !OTHER_KINDS.has(option.kind));
  const others = options.filter((option) => OTHER_KINDS.has(option.kind));
  return [
    { title: DATA_SOURCES_GROUP_TITLE, options: databases },
    { title: OTHER_GROUP_TITLE, options: others },
  ].filter((group) => group.options.length > 0);
}

export { pickerKindGroups };
