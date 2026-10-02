export type LocalDateTimeCandidate = { iso: string; offset: string };

function parseWall(local: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      local,
    );
  if (!match) throw Error("请输入完整日期和时间。");
  const calendar = new Date(match[1] + "T00:00:00Z");
  if (
    !Number.isFinite(calendar.getTime()) ||
    Number(match[1].slice(0, 4)) < 1 ||
    calendar.toISOString().slice(0, 10) !== match[1] ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4] ?? 0) > 59
  )
    throw Error("日期或时间无效，请核对年月日和钟点。");
  const wall = `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}${match[5] ? "." + match[5].padEnd(3, "0") : ""}`;
  return { wall, instant: Date.parse(wall + "Z") };
}
function formatter(timeZone: string) {
  if (typeof timeZone !== "string" || !timeZone.trim())
    throw Error("请选择有效的 IANA 时区。");
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw Error("请选择有效的 IANA 时区。");
  }
}
function wallAt(instant: number, format: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(
    format.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Enumerates observed IANA offsets, without using the browser's system time zone. */
export function resolveLocalDateTime(
  local: string,
  timeZone: string,
): LocalDateTimeCandidate[] {
  const { wall, instant } = parseWall(local);
  const format = formatter(timeZone);
  const offsets = new Set<number>();
  const wholeSecond = Math.floor(instant / 1000) * 1000;
  for (let hour = -48; hour <= 48; hour += 6) {
    const sample = wholeSecond + hour * 3600000;
    const offset = Date.parse(wallAt(sample, format) + "Z") - sample;
    if (Number.isFinite(offset)) offsets.add(offset);
  }
  return [...offsets]
    .map((offset) => ({ offset, instant: instant - offset }))
    .filter(
      (candidate) => wallAt(candidate.instant, format) === wall.slice(0, 19),
    )
    .sort((a, b) => a.instant - b.instant)
    .map(({ offset }) => {
      if (
        !Number.isFinite(offset) ||
        offset % 60000 ||
        Math.abs(offset) > 14 * 3600000
      )
        throw Error("该历史时区偏移无法用分钟表示，请选择受支持的日期。");
      const minutes = Math.abs(offset) / 60000;
      const label = `${offset < 0 ? "-" : "+"}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      return { iso: wall + label, offset: label };
    });
}

/** Shows an existing instant in the requested zone, retaining its explicit fold choice. */
export function localDateTimeFromISO(iso: string, timeZone: string): string {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?)(Z|[+-]\d{2}:\d{2})$/.exec(
      iso,
    );
  if (!match) throw Error("已有时间缺少明确 UTC 偏移，请重新选择。");
  parseWall(match[1].replace(/\.(\d{3})\d+$/, ".$1"));
  const offset =
    match[2] === "Z" ? [0, 0] : match[2].slice(1).split(":").map(Number);
  if (offset[0] > 14 || offset[1] > 59 || (offset[0] === 14 && offset[1]))
    throw Error("已有时间的 UTC 偏移无效。");
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) throw Error("已有时间无效，请重新选择。");
  const milliseconds = new Date(instant).getUTCMilliseconds();
  return (
    wallAt(instant, formatter(timeZone)) +
    (milliseconds ? "." + String(milliseconds).padStart(3, "0") : "")
  );
}
