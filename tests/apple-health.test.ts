import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { app } from "../src/server.js";
import {
  importAppleHealthXml,
  parseAppleHealthXml,
} from "../src/apple-health.js";

const options = {
  timeZone: "Asia/Tokyo",
  sourceId: "fictional-local-export",
  synthetic: true,
};
const steps = `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Synthetic &amp; Watch" sourceVersion="1" device="fictional-device" creationDate="2030-04-01 10:05:00 +0900" startDate="2030-04-01 10:00:00 +0900" endDate="2030-04-01 10:05:00 +0900" unit="count" value="1200"><MetadataEntry key="HKTimeZone" value="Asia/Tokyo"/></Record>`;
const heartRate = `<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Synthetic Watch" sourceVersion="1" startDate="2030-04-01 10:02:00 +0900" endDate="2030-04-01 10:02:00 +0900" unit="count/min" value="78"/>`;
const workout = `<Workout workoutActivityType="HKWorkoutActivityTypeWalking" sourceName="Synthetic Watch" duration="1800" durationUnit="s" startDate="2030-04-01 10:00:00 +0900" endDate="2030-04-01 10:30:00 +0900"><MetadataEntry key="HKTimeZone" value="Asia/Tokyo"/></Workout>`;
const xml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><HealthData locale="en_US"><ExportDate value="2030-04-02 00:00:00 +0900"/>${body}</HealthData>`;

test("A01 public XML import requires local authentication and exposes imported records plus errors without real device claims", async () => {
  const root = mkdtempSync(join(tmpdir(), "life-apple-http-")),
    store = new Store(root),
    server = app(store);
  try {
    const host = { host: "localhost:4310" },
      payload = { xml: xml(steps + heartRate + workout), ...options };
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/api/import/apple-health",
          headers: host,
          payload,
        })
      ).statusCode,
      401,
    );
    const session = await server.inject({ url: "/api/session", headers: host });
    const headers = {
      ...host,
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    const imported = await server.inject({
      method: "POST",
      url: "/api/import/apple-health",
      headers,
      payload,
    });
    assert.equal(imported.statusCode, 200, imported.body);
    assert.equal(imported.json().imported.length, 3);
    assert.deepEqual(imported.json().errors, []);
    const retry = await server.inject({
      method: "POST",
      url: "/api/import/apple-health",
      headers,
      payload,
    });
    assert.deepEqual(
      retry.json().imported.map((e: { id: string }) => e.id),
      imported.json().imported.map((e: { id: string }) => e.id),
    );
    const denied = await server.inject({
      method: "POST",
      url: "/api/import/apple-health",
      headers,
      payload: {
        ...payload,
        xml:
          '<!DOCTYPE HealthData SYSTEM "https://example.invalid/health.dtd">' +
          payload.xml,
      },
    });
    assert.equal(denied.statusCode, 200, denied.body);
    assert.equal(denied.json().errors[0].code, "forbidden-dtd");
    assert.equal(denied.json().imported.length, 0);
    assert.equal(store.list().length, 3);
    const status = (
      await server.inject({ url: "/api/status", headers })
    ).json();
    assert.match(status.watch, /未联动/);
  } finally {
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("A01 complete synthetic native export accepts inert Apple ELEMENT/ATTLIST declarations without applying defaults", () => {
  const doctype = `<!DOCTYPE HealthData [
    <!ELEMENT HealthData (ExportDate,Record*,Workout*)>
    <!ATTLIST HealthData locale CDATA #REQUIRED>
    <!ELEMENT ExportDate EMPTY>
    <!ATTLIST ExportDate value CDATA #REQUIRED>
    <!ELEMENT Record (MetadataEntry*)>
    <!ATTLIST Record type CDATA #REQUIRED sourceName CDATA "DTD-default-must-not-apply" unit CDATA #IMPLIED value CDATA #IMPLIED>
    <!ELEMENT Workout (MetadataEntry*)>
    <!ATTLIST Workout workoutActivityType CDATA #REQUIRED duration CDATA #IMPLIED durationUnit CDATA #IMPLIED>
    <!ELEMENT MetadataEntry EMPTY>
    <!ATTLIST MetadataEntry key CDATA #REQUIRED value CDATA #REQUIRED>
  ]>`;
  const complete = xml(steps + heartRate + workout).replace(
    "?><HealthData",
    "?>" + doctype + "<HealthData",
  );
  const report = parseAppleHealthXml(complete, options);
  assert.deepEqual(report.errors, []);
  assert.equal(report.entities.length, 3);
  assert.deepEqual(
    report.entities,
    parseAppleHealthXml(xml(steps + heartRate + workout), options).entities,
  );
  const noSource = complete.replace('sourceName="Synthetic &amp; Watch"', "");
  assert.match(
    parseAppleHealthXml(noSource, options).errors[0].message,
    /requires a sourceName/,
  );
  // An inert declaration cannot teach the parser a new entity.
  assert.ok(
    parseAppleHealthXml(
      complete.replace('value="1200"', 'value="&unregistered;"'),
      options,
    ).errors.length,
  );
});

test("A01 native Apple XML synthetic fixture: steps, heart rate, duration, explicit zone and local source identity", () => {
  const report = parseAppleHealthXml(xml(steps + heartRate + workout), options);
  assert.deepEqual(report.errors, []);
  assert.equal(report.entities.length, 3);
  assert.deepEqual(
    report.entities.map((e) => [
      e.fields.metric,
      e.fields.value,
      e.fields.unit,
    ]),
    [
      ["steps", 1200, "count"],
      ["heartRate", 78, "bpm"],
      ["duration", 30, "min"],
    ],
  );
  for (const e of report.entities) {
    assert.equal(e.kind, "fact");
    assert.equal(e.timeZone, "Asia/Tokyo");
    assert.equal(e.fields.measurement, "设备测量");
    assert.equal(e.source!.namespace, "synthetic-apple-health-xml-v1");
    assert.match(e.source!.recordId, /^[a-f0-9]{64}$/);
    assert.match(e.source!.revision, /^[a-f0-9]{64}$/);
    assert.match(e.body, /不证明 HealthKit 授权/);
  }
  assert.equal(report.entities[0].occurredAt, "2030-04-01T10:00:00+09:00");
  assert.match(report.entities[0].body, /Synthetic & Watch/);
  assert.notEqual(
    parseAppleHealthXml(xml(steps), {
      ...options,
      sourceId: "other-local-series",
    }).entities[0].source!.recordId,
    report.entities[0].source!.recordId,
  );
  assert.equal(
    parseAppleHealthXml(xml(steps + steps), options).entities.length,
    1,
  );
});

test("A01 native XML import deduplicates retries, applies revisions and keeps revised values on old export replay/restart", () => {
  const root = mkdtempSync(join(tmpdir(), "life-apple-"));
  let store = new Store(root);
  try {
    const first = importAppleHealthXml(
      store,
      xml(steps + heartRate + workout),
      options,
    );
    assert.equal(first.imported.length, 3);
    assert.deepEqual(first.errors, []);
    const step = first.imported[0];
    assert.equal(
      importAppleHealthXml(store, xml(steps), options).imported[0].version,
      1,
    );
    const correctedXml = xml(
      steps
        .replace('value="1200"', 'value="1300"')
        .replace('sourceVersion="1"', 'sourceVersion="2"'),
    );
    const corrected = importAppleHealthXml(store, correctedXml, options)
      .imported[0];
    assert.equal(corrected.id, step.id);
    assert.equal(corrected.version, 2);
    assert.equal(corrected.fields.value, 1300);
    assert.equal(
      importAppleHealthXml(store, xml(steps), options).imported[0].fields.value,
      1300,
    );
    assert.equal(store.list().length, 3);
    store.close();
    store = new Store(root);
    assert.equal(
      importAppleHealthXml(store, correctedXml, options).imported[0].version,
      2,
    );
    assert.equal(store.audit().length, 4);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("A01 XML semantic errors report index/location, skip unsupported records and prevent prefix writes", () => {
  const root = mkdtempSync(join(tmpdir(), "life-apple-")),
    store = new Store(root);
  try {
    const invalids = [
      heartRate.replace('unit="count/min"', 'unit="count"'),
      steps.replace('value="1200"', 'value="1.5"'),
      steps.replace('value="1200"', 'value="NaN"'),
      steps.replace('value="1200"', 'value="-1"'),
      steps.replace("2030-04-01 10:00:00 +0900", "2030-02-30 10:00:00 +0900"),
      steps.replace("2030-04-01 10:00:00 +0900", "2030-04-01 10:00:00 +1500"),
      workout.replace('durationUnit="s"', 'durationUnit="cal"'),
      workout.replace("10:30:00", "09:30:00"),
      steps.replace('value="Asia/Tokyo"', 'value="Mars/Olympus"'),
      steps.replace('sourceName="Synthetic &amp; Watch"', 'sourceName=""'),
    ];
    for (const invalid of invalids) {
      const report = importAppleHealthXml(
        store,
        xml(heartRate + invalid),
        options,
      );
      assert.equal(report.imported.length, 0);
      assert.equal(report.errors[0].code, "sample");
      assert.equal(report.errors[0].index, 1);
      assert.ok(report.errors[0].line > 0);
      assert.ok(report.errors[0].column > 0);
      assert.equal(store.list().length, 0);
    }
    const unknown = steps.replace(
      "HKQuantityTypeIdentifierStepCount",
      "HKQuantityTypeIdentifierDistanceWalkingRunning",
    );
    const skipped = parseAppleHealthXml(xml(unknown + heartRate), options);
    assert.equal(skipped.skipped, 1);
    assert.equal(skipped.entities.length, 1);
    assert.deepEqual(skipped.errors, []);
    const noMetadata = steps.replace(
      '<MetadataEntry key="HKTimeZone" value="Asia/Tokyo"/>',
      "",
    );
    assert.match(
      parseAppleHealthXml(xml(noMetadata), { ...options, timeZone: "UTC" })
        .errors[0].message,
      /offset.*zone/,
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("A01 strict parser rejects active/external DTD/entity declarations, malformed/truncated XML, bad nesting and limits without writes", () => {
  const root = mkdtempSync(join(tmpdir(), "life-apple-")),
    store = new Store(root);
  try {
    const unsafe = [
      '<!DOCTYPE HealthData SYSTEM "https://example.invalid/health.dtd">' +
        xml(steps),
      '<!DOCTYPE HealthData [<!ENTITY exfil SYSTEM "file:///synthetic/secret">]>' +
        xml(steps.replace('value="1200"', 'value="&exfil;"')),
      '<!DOCTYPE HealthData PUBLIC "synthetic" "https://example.invalid/health.dtd">' +
        xml(steps),
      '<!DOCTYPE HealthData [<!ENTITY % p "synthetic">%p;]>' + xml(steps),
      "<!DOCTYPE HealthData [<!ELEMENT HealthData (%p;)>]>" + xml(steps),
      '<!DOCTYPE HealthData [<!NOTATION image SYSTEM "https://example.invalid">]>' +
        xml(steps),
      xml(steps).replace("</HealthData>", ""),
      xml(steps).replace(
        "<Record type=",
        '<Record sourceName="duplicate" type=',
      ),
      xml(steps).replace('value="1200"', 'value="&unknown;"'),
      xml("<Group>" + steps + "</Group>"),
      "<OtherRoot>" + steps + "</OtherRoot>",
      xml(steps + "</Extra>"),
    ];
    for (const value of unsafe) {
      const report = importAppleHealthXml(store, value, options);
      assert.equal(report.imported.length, 0);
      assert.equal(report.entities.length, 0);
      assert.ok(report.errors.length > 0);
      assert.equal(store.list().length, 0);
    }
    assert.equal(
      parseAppleHealthXml(unsafe[0], options).errors[0].code,
      "forbidden-dtd",
    );
    assert.equal(
      parseAppleHealthXml(xml(steps.repeat(1001)), options).errors.at(-1)!.code,
      "limit",
    );
    assert.equal(
      parseAppleHealthXml(" ".repeat(2_000_001), options).errors[0].code,
      "limit",
    );
    assert.equal(
      parseAppleHealthXml(
        xml("<Group>".repeat(33) + "</Group>".repeat(33)),
        options,
      ).errors[0].code,
      "limit",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("A01 fallback identity reports ambiguous records; supplied UUID keeps separate overlapping samples", () => {
  const changed = steps.replace('value="1200"', 'value="1300"');
  assert.match(
    parseAppleHealthXml(xml(steps + changed), options).errors[0].message,
    /Ambiguous samples/,
  );
  const identified = parseAppleHealthXml(
    xml(
      steps.replace("<Record ", '<Record uuid="synthetic-a" ') +
        changed.replace("<Record ", '<Record uuid="synthetic-b" '),
    ),
    options,
  );
  assert.deepEqual(identified.errors, []);
  assert.equal(identified.entities.length, 2);
});

test("A01 metadata timezone supports daylight saving offset change; missing explicit zone is an error", () => {
  const dst = workout
    .replace('duration="1800"', 'duration="3600"')
    .replace('durationUnit="s"', 'durationUnit="s"')
    .replace("2030-04-01 10:00:00 +0900", "2030-03-10 01:30:00 -0500")
    .replace("2030-04-01 10:30:00 +0900", "2030-03-10 03:30:00 -0400")
    .replace('value="Asia/Tokyo"', 'value="America/New_York"');
  const report = parseAppleHealthXml(xml(dst), options);
  assert.deepEqual(report.errors, []);
  assert.equal(report.entities[0].timeZone, "America/New_York");
  assert.equal(report.entities[0].fields.value, 60);
  assert.match(
    parseAppleHealthXml(xml(steps), {} as typeof options).errors[0].message,
    /Explicit timeZone/,
  );
});
