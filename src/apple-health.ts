import { SaxesParser } from "saxes";
import type { Entity, EntityInput } from "./types.js";
import { Store } from "./store.js";
import { hash } from "./vault.js";

export type AppleHealthOptions = {
  timeZone: string;
  sourceId?: string;
  synthetic?: boolean;
};
export type AppleHealthError = {
  code: "xml" | "forbidden-dtd" | "limit" | "sample" | "import";
  message: string;
  line: number;
  column: number;
  index?: number;
};
export type AppleHealthReport = {
  entities: EntityInput[];
  errors: AppleHealthError[];
  skipped: number;
};
type Sample = {
  tag: string;
  attributes: Record<string, string>;
  metadata: Record<string, string>;
  depth: number;
  index: number;
  line: number;
  column: number;
};
function inertAppleDoctype(declaration: string): boolean {
  // Saxes emits declarations as text; it does not load a DTD or register its
  // entities. This lexical allowlist never applies schemas/default attributes.
  // Apple exports contain ELEMENT/ATTLIST text, which can safely remain inert.
  if (
    declaration.length > 100000 ||
    /\b(?:ENTITY|SYSTEM|PUBLIC)\b|[%&]/.test(declaration)
  )
    return false;
  const value = declaration.trim();
  if (value === "HealthData") return true;
  if (
    !value.startsWith("HealthData") ||
    !/^HealthData\s*\[/.test(value) ||
    !value.endsWith("]")
  )
    return false;
  const contents = value.slice(value.indexOf("[") + 1, -1);
  const allowed =
    /<!(?:ELEMENT|ATTLIST)\s+[A-Za-z_][A-Za-z0-9_.:-]*\s+(?:[A-Za-z0-9_.:\s(),|?*+#-]|"[^"<>&%\[\]]*"|'[^'<>&%\[\]]*')+>/y;
  let position = 0;
  while (position < contents.length) {
    while (/\s/.test(contents[position] ?? "") && position < contents.length)
      position++;
    if (position === contents.length) return true;
    allowed.lastIndex = position;
    if (!allowed.exec(contents)) return false;
    position = allowed.lastIndex;
  }
  return true;
}
function date(value: string): string {
  const parts =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(
      value ?? "",
    );
  if (!parts) throw Error("Expected Apple offset-aware date");
  const [year, month, day] = parts[1].split("-").map(Number),
    [hour, minute, second] = parts[2].split(":").map(Number),
    offsetHour = Number(parts[4]),
    offsetMinute = Number(parts[5]);
  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  )
    throw Error("Invalid Apple date or UTC offset");
  const calendar = new Date(parts[1] + "T00:00:00Z");
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() + 1 !== month ||
    calendar.getUTCDate() !== day
  )
    throw Error("Invalid Apple calendar date");
  const iso = parts[1] + "T" + parts[2] + parts[3] + parts[4] + ":" + parts[5];
  if (!Number.isFinite(Date.parse(iso))) throw Error("Invalid Apple date");
  return iso;
}
function checkZone(iso: string, zone: string) {
  const pieces = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) => pieces.find((p) => p.type === type)?.value;
  const local = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
  if (local !== iso.slice(0, 19))
    throw Error("Timestamp offset does not match declared time zone");
}
const stable = (value: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
function convert(
  sample: Sample,
  options: AppleHealthOptions,
): EntityInput | null {
  const a = sample.attributes;
  const metric =
    sample.tag === "Workout"
      ? "duration"
      : {
          HKQuantityTypeIdentifierStepCount: "steps",
          HKQuantityTypeIdentifierHeartRate: "heartRate",
        }[a.type];
  if (!metric) return null;
  if (!a.sourceName?.trim()) throw Error("Sample requires a sourceName");
  const start = date(a.startDate),
    end = date(a.endDate);
  if (Date.parse(end) < Date.parse(start))
    throw Error("Sample ends before it starts");
  const timeZone = sample.metadata.HKTimeZone ?? options.timeZone;
  checkZone(start, timeZone);
  checkZone(end, timeZone);
  const raw = sample.tag === "Workout" ? a.duration : a.value;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw ?? ""))
    throw Error("Sample requires a finite nonnegative numeric value");
  let value = Number(raw);
  let unit: string;
  if (metric === "steps") {
    if (a.unit !== "count" || !Number.isSafeInteger(value))
      throw Error("Steps require integer count units");
    unit = "count";
  } else if (metric === "heartRate") {
    if (!["count/min", "bpm"].includes(a.unit))
      throw Error("Heart rate requires count/min or bpm units");
    unit = "bpm";
  } else {
    const multiplier = { min: 1, s: 1 / 60, h: 60 }[a.durationUnit];
    if (multiplier === undefined)
      throw Error("Workout duration requires min, s, or h units");
    value *= multiplier;
    unit = "min";
  }
  if (!Number.isFinite(value) || value < 0)
    throw Error("Sample value exceeds finite range");
  const scope = options.sourceId ?? "local-export";
  const externalId = a.uuid ?? sample.metadata.HKMetadataKeySyncIdentifier;
  // Apple exports often omit UUIDs. The fallback excludes measurement values
  // and software versions so corrected exports retain their sample identity.
  const identity = externalId
    ? [scope, a.sourceName, metric, externalId]
    : [
        scope,
        sample.tag,
        metric,
        a.workoutActivityType ?? "",
        a.sourceName,
        a.device ?? "",
        new Date(start).toISOString(),
        new Date(end).toISOString(),
      ];
  return {
    module: "health",
    type: "metric",
    title:
      (options.synthetic ? "合成演示 · " : "") +
      "Apple Health 手动导入 · " +
      metric,
    kind: "fact",
    status: "done",
    occurredAt: start,
    timeZone,
    fields: { metric, value, unit, measurement: "设备测量" },
    relations: [],
    source: {
      namespace: options.synthetic
        ? "synthetic-apple-health-xml-v1"
        : "apple-health-xml-v1",
      recordId: hash(JSON.stringify(identity)),
      revision: hash(
        JSON.stringify([stable(a), stable(sample.metadata), timeZone]),
      ),
      mode: "import",
    },
    body:
      "手动导出 XML 导入，不证明 HealthKit 授权或 Apple Watch 自动联动。\n" +
      "本地导出系列：" +
      scope +
      "\n源名称：" +
      a.sourceName +
      "\n结束：" +
      end +
      "\n原始单位：" +
      (a.unit ?? a.durationUnit) +
      "\n原始属性与元数据：" +
      JSON.stringify({
        attributes: stable(a),
        metadata: stable(sample.metadata),
      }),
  };
}

export function parseAppleHealthXml(
  xml: string,
  options: AppleHealthOptions,
): AppleHealthReport {
  const report: AppleHealthReport = { entities: [], errors: [], skipped: 0 };
  let failureCode: AppleHealthError["code"] = "xml";
  const parser = new SaxesParser({ xmlns: false });
  const fail = (
    message: string,
    code: AppleHealthError["code"] = "xml",
  ): never => {
    failureCode = code;
    throw Error(message);
  };
  let depth = 0,
    count = 0,
    rootSeen = false;
  let active: Sample | undefined;
  const seen = new Map<string, string>();
  try {
    if (!options || typeof options.timeZone !== "string")
      fail("Explicit timeZone is required", "sample");
    new Intl.DateTimeFormat("en", { timeZone: options.timeZone });
    if (
      options.sourceId !== undefined &&
      (typeof options.sourceId !== "string" ||
        !options.sourceId.trim() ||
        options.sourceId.length > 300)
    )
      fail("Invalid local export sourceId", "sample");
    if (
      options.synthetic !== undefined &&
      typeof options.synthetic !== "boolean"
    )
      fail("Invalid synthetic flag", "sample");
    if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > 2_000_000)
      fail("XML exceeds the 2 MB import limit", "limit");
    parser.on("doctype", (declaration) => {
      if (!inertAppleDoctype(declaration))
        fail(
          "Only inert HealthData ELEMENT/ATTLIST declarations are allowed; entities and external DTDs are forbidden",
          "forbidden-dtd",
        );
    });
    parser.on("error", (error) => {
      throw error;
    });
    parser.on("opentag", (tag) => {
      depth++;
      if (depth > 32) fail("XML nesting exceeds import limit", "limit");
      if (
        Object.keys(tag.attributes).length > 128 ||
        Object.values(tag.attributes).some((v) => v.length > 20000)
      )
        fail("XML attributes exceed import limit", "limit");
      if (depth === 1) {
        if (tag.name !== "HealthData" || rootSeen)
          fail("Expected one HealthData root");
        rootSeen = true;
      }
      if (["Record", "Workout"].includes(tag.name)) {
        if (depth !== 2 || active)
          fail("Health samples must be direct children of HealthData");
        if (++count > 1000)
          fail("XML exceeds 1000 sample import limit", "limit");
        active = {
          tag: tag.name,
          attributes: tag.attributes,
          metadata: {},
          depth,
          index: count - 1,
          line: parser.line,
          column: parser.column,
        };
      } else if (
        active &&
        tag.name === "MetadataEntry" &&
        depth === active.depth + 1
      ) {
        const { key, value } = tag.attributes;
        if (!key || value === undefined)
          fail("MetadataEntry requires key and value");
        if (
          Object.hasOwn(active.metadata, key) &&
          active.metadata[key] !== value
        )
          fail("Conflicting duplicate sample metadata");
        active.metadata[key] = value;
      }
    });
    parser.on("closetag", () => {
      if (active && depth === active.depth) {
        const sample = active;
        try {
          const entity = convert(sample, options);
          if (!entity) report.skipped++;
          else {
            const identity = entity.source!.recordId,
              revision = entity.source!.revision;
            if (seen.has(identity) && seen.get(identity) !== revision)
              throw Error(
                "Ambiguous samples share identity with different contents; supply stable sample UUIDs",
              );
            if (!seen.has(identity)) report.entities.push(entity);
            seen.set(identity, revision);
          }
        } catch (error) {
          report.errors.push({
            code: "sample",
            message:
              error instanceof Error ? error.message : "Invalid health sample",
            line: sample.line,
            column: sample.column,
            index: sample.index,
          });
        }
        active = undefined;
      }
      depth--;
    });
    parser.write(xml).close();
    if (!rootSeen) fail("Expected HealthData root");
  } catch (error) {
    report.entities = [];
    report.errors.push({
      code: failureCode,
      message: error instanceof Error ? error.message : "XML import failed",
      line: parser.line,
      column: parser.column,
    });
  }
  return report;
}

export function importAppleHealthXml(
  store: Store,
  xml: string,
  options: AppleHealthOptions,
): AppleHealthReport & { imported: Entity[] } {
  const report = parseAppleHealthXml(xml, options),
    imported: Entity[] = [];
  // Parsing is completed before any write: malformed XML and sample errors
  // cannot import a valid-looking prefix of the document.
  if (!report.errors.length) {
    for (const [index, entity] of report.entities.entries()) {
      try {
        imported.push(store.importSource(entity));
      } catch (error) {
        report.errors.push({
          code: "import",
          message:
            error instanceof Error ? error.message : "Store import failed",
          index,
          line: 0,
          column: 0,
        });
      }
    }
  }
  return { ...report, imported };
}
