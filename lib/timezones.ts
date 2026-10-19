// Reporting timezones: each workspace counts its days (today, last 7 days, daily charts) at its
// own local midnight. Plain functions, safe in the browser and on the server.

export const DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur";

// Every IANA zone this runtime knows, such as "Asia/Kuala_Lumpur".
export function timezoneNames(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

export function isTimezone(value: string): boolean {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// The zone's current offset, such as "GMT+8" (or "GMT+5:30").
export function timezoneOffset(timeZone: string, at = new Date()): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName");
  return part?.value === "GMT" ? "GMT+0" : (part?.value ?? "");
}

// "Asia/Kuala_Lumpur (GMT+8)", for settings and the "days in" notes.
export function timezoneLabel(timeZone: string, at = new Date()): string {
  return `${timeZone.replaceAll("_", " ")} (${timezoneOffset(timeZone, at)})`;
}
