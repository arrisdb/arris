import {
  DAYS_AGO_SUFFIX,
  DURATION_SEPARATOR,
  HOURS_AGO_SUFFIX,
  JUST_NOW_LABEL,
  MINUTES_AGO_SUFFIX,
  MINUTE_UNIT,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  MS_PER_TENTH,
  MS_SUFFIX,
  NO_VALUE,
  SECONDS_FRACTION_DIGITS,
  SECONDS_PER_MINUTE,
  SECONDS_SUFFIX,
  SECOND_UNIT,
  SQL_LINE_SEPARATOR,
} from "./constants";
import type { RunRecord } from "./types";

// Rounds before splitting units so 119.6 s reads 2m 0s, never 1m 60s.
function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return NO_VALUE;
  const total = Math.round(ms);
  if (total < MS_PER_SECOND) return `${total}${MS_SUFFIX}`;
  const tenths = Math.round(total / MS_PER_TENTH);
  if (tenths < MS_PER_MINUTE / MS_PER_TENTH)
    return `${(tenths / (MS_PER_SECOND / MS_PER_TENTH)).toFixed(SECONDS_FRACTION_DIGITS)}${SECONDS_SUFFIX}`;
  const seconds = Math.round(total / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}${MINUTE_UNIT}${DURATION_SEPARATOR}${seconds % SECONDS_PER_MINUTE}${SECOND_UNIT}`;
}

function formatRelativeTime(iso: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(iso));
  if (elapsed < MS_PER_MINUTE) return JUST_NOW_LABEL;
  if (elapsed < MS_PER_HOUR)
    return `${Math.floor(elapsed / MS_PER_MINUTE)}${MINUTES_AGO_SUFFIX}`;
  if (elapsed < MS_PER_DAY) return `${Math.floor(elapsed / MS_PER_HOUR)}${HOURS_AGO_SUFFIX}`;
  return `${Math.floor(elapsed / MS_PER_DAY)}${DAYS_AGO_SUFFIX}`;
}

function firstSqlLine(sql: string): string {
  return sql.split(SQL_LINE_SEPARATOR).find((line) => line.trim() !== "")?.trim() ?? "";
}

function filterRuns(
  runs: RunRecord[],
  query: string,
  connectionName: (id: string) => string,
): RunRecord[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return runs;
  return runs.filter(
    (run) =>
      run.sql.toLowerCase().includes(needle) ||
      connectionName(run.connectionId).toLowerCase().includes(needle),
  );
}

export { filterRuns, firstSqlLine, formatDuration, formatRelativeTime };
