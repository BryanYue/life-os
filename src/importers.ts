import type { EntityInput } from "./types.js";
import { Store } from "./store.js";
export type HealthExport = {
  format: "life-os-health-v1";
  synthetic?: boolean;
  samples: {
    id: string;
    revision: string;
    metric: "duration" | "steps" | "heartRate";
    value: number;
    unit: "min" | "count" | "bpm";
    start: string;
    timeZone: string;
  }[];
};
export function parseHealthExport(data: HealthExport): EntityInput[] {
  if (
    data?.format !== "life-os-health-v1" ||
    !Array.isArray(data.samples) ||
    data.samples.length > 1000
  )
    throw Error("Invalid health export envelope");
  return data.samples.map((s, i) => {
    const expected = { duration: "min", steps: "count", heartRate: "bpm" }[
      s.metric
    ];
    if (
      !expected ||
      s.unit !== expected ||
      !Number.isFinite(s.value) ||
      s.value < 0 ||
      !s.id ||
      !s.revision ||
      !Number.isFinite(Date.parse(s.start)) ||
      !/[Zz]|[+-]\d{2}:\d{2}$/.test(s.start)
    )
      throw Error("Invalid health sample at index " + i);
    new Intl.DateTimeFormat("en", { timeZone: s.timeZone });
    return {
      module: "health",
      type: "metric",
      title: (data.synthetic ? "合成演示 · " : "") + "导入指标 · " + s.metric,
      kind: "fact",
      status: "done",
      occurredAt: s.start,
      timeZone: s.timeZone,
      fields: {
        metric: s.metric,
        value: s.value,
        unit: s.unit,
        measurement: "设备测量",
      },
      relations: [],
      source: {
        namespace: data.synthetic
          ? "synthetic-health-export-v1"
          : "health-export-v1",
        recordId: s.id,
        revision: s.revision,
        mode: "import",
      },
      body: "手动导出接口导入；这条记录不证明 Apple Watch 已自动联动。",
    };
  });
}
export function importHealth(store: Store, data: HealthExport) {
  const entities = parseHealthExport(data);
  return entities.map((entity) => store.importSource(entity));
}
