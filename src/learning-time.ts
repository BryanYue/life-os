/** Shared strict timestamps without Store or filesystem dependencies. */
export function learningClock(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
export function validateLearningTimestamp(value: string, timeZone?: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value ?? "",
    );
  if (!match) throw Error("Expected an explicit-offset ISO timestamp");
  const calendar = new Date(match[1] + "T00:00:00Z"),
    offset =
      match[5] === "Z" ? [0, 0] : match[5].slice(1).split(":").map(Number);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== match[1] ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59 ||
    offset[0] > 14 ||
    offset[1] > 59 ||
    (offset[0] === 14 && offset[1] !== 0) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error("Invalid calendar timestamp or UTC offset");
  if (
    timeZone !== undefined &&
    (typeof timeZone !== "string" ||
      !timeZone.trim() ||
      timeZone.length > 1000 ||
      learningClock(Date.parse(value), timeZone) !== value.slice(0, 19))
  )
    throw Error(
      "Timestamp offset does not match declared IANA time zone (including DST)",
    );
  return Date.parse(value);
}
