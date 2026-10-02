import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveLocalDateTime,
  localDateTimeFromISO,
} from "../src/local-time.js";

test("Shanghai and Tokyo picker times automatically produce the declared IANA offsets and seconds", () => {
  assert.deepEqual(resolveLocalDateTime("2037-03-01T18:30", "Asia/Shanghai"), [
    { iso: "2037-03-01T18:30:00+08:00", offset: "+08:00" },
  ]);
  assert.deepEqual(resolveLocalDateTime("2037-03-01T18:30", "Asia/Tokyo"), [
    { iso: "2037-03-01T18:30:00+09:00", offset: "+09:00" },
  ]);
  assert.deepEqual(
    resolveLocalDateTime("2037-03-01T18:30:45.7", "Asia/Shanghai"),
    [{ iso: "2037-03-01T18:30:45.700+08:00", offset: "+08:00" }],
  );
});

test("New York missing DST wall time has no candidate and a repeated time keeps both explicit choices", () => {
  assert.deepEqual(
    resolveLocalDateTime("2030-03-10T02:30", "America/New_York"),
    [],
  );
  const choices = resolveLocalDateTime("2030-11-03T01:30", "America/New_York");
  assert.deepEqual(choices, [
    { iso: "2030-11-03T01:30:00-04:00", offset: "-04:00" },
    { iso: "2030-11-03T01:30:00-05:00", offset: "-05:00" },
  ]);
  assert.equal(
    Date.parse(choices[1].iso) - Date.parse(choices[0].iso),
    3600000,
  );
  assert.equal(
    localDateTimeFromISO(choices[0].iso, "America/New_York"),
    "2030-11-03T01:30:00",
  );
  assert.equal(
    localDateTimeFromISO(choices[1].iso, "America/New_York"),
    "2030-11-03T01:30:00",
  );
  assert.ok(
    choices.every((choice) =>
      resolveLocalDateTime(
        localDateTimeFromISO(choice.iso, "America/New_York"),
        "America/New_York",
      ).some((candidate) => candidate.iso === choice.iso),
    ),
  );
});

test("Lord Howe thirty-minute transitions are resolved without assuming hour-long DST", () => {
  assert.deepEqual(
    resolveLocalDateTime("2030-10-06T02:15", "Australia/Lord_Howe"),
    [],
  );
  const choices = resolveLocalDateTime(
    "2030-04-07T01:45",
    "Australia/Lord_Howe",
  );
  assert.deepEqual(choices, [
    { iso: "2030-04-07T01:45:00+11:00", offset: "+11:00" },
    { iso: "2030-04-07T01:45:00+10:30", offset: "+10:30" },
  ]);
  assert.equal(
    Date.parse(choices[1].iso) - Date.parse(choices[0].iso),
    1800000,
  );
  assert.deepEqual(
    resolveLocalDateTime("2030-10-06T02:30", "Australia/Lord_Howe"),
    [{ iso: "2030-10-06T02:30:00+11:00", offset: "+11:00" }],
  );
});

test("picker resolution uses the supplied zone even when the system zone differs", () => {
  const prior = process.env.TZ;
  try {
    process.env.TZ = "Pacific/Honolulu";
    assert.equal(
      resolveLocalDateTime("2037-03-01T18:30", "Asia/Shanghai")[0].iso,
      "2037-03-01T18:30:00+08:00",
    );
    assert.equal(
      localDateTimeFromISO("2037-03-01T10:30:00Z", "Asia/Shanghai"),
      "2037-03-01T18:30:00",
    );
    assert.equal(
      resolveLocalDateTime("2037-03-01T18:30", "Asia/Kathmandu")[0].offset,
      "+05:45",
    );
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
  }
});

test("invalid calendars and incomplete clock values fail instead of rolling into another date", () => {
  for (const invalid of [
    "",
    "2030-02-29T10:00",
    "2030-02-30T10:00",
    "2030-04-31T10:00",
    "0000-01-01T10:00",
    "2030-13-01T10:00",
    "2030-04-07T24:00",
    "2030-04-07T10:60",
    "2030-04-07T10:30:60",
    "2030-04-07T10:3",
    "2030-04-07",
    "2030-04-07T10:30Z",
    "2030-04-07T10:30:00.1234",
  ])
    assert.throws(() => resolveLocalDateTime(invalid, "UTC"));
  assert.throws(
    () => resolveLocalDateTime("2030-04-07T10:30", "Fictional/Invalid"),
    /IANA/,
  );
  assert.throws(() => resolveLocalDateTime("2030-04-07T10:30", ""), /IANA/);
  assert.deepEqual(resolveLocalDateTime("2032-02-29T10:00", "UTC"), [
    { iso: "2032-02-29T10:00:00+00:00", offset: "+00:00" },
  ]);
});

test("existing ISO instants display in the requested zone with preserved milliseconds", () => {
  assert.equal(
    localDateTimeFromISO("2037-03-01T10:30:45.123Z", "Asia/Tokyo"),
    "2037-03-01T19:30:45.123",
  );
  const raw = localDateTimeFromISO("2037-03-01T10:30:45.123Z", "Asia/Tokyo");
  assert.equal(
    localDateTimeFromISO("2037-03-01T19:30:45.123456789+09:00", "Asia/Tokyo"),
    "2037-03-01T19:30:45.123",
  );
  assert.equal(
    Date.parse(resolveLocalDateTime(raw, "Asia/Tokyo")[0].iso),
    Date.parse("2037-03-01T10:30:45.123Z"),
  );
  for (const invalid of [
    "2030-02-30T10:00:00Z",
    "2030-04-07T24:00:00Z",
    "2030-04-07T10:30",
    "2030-04-07T10:30:00+14:01",
  ])
    assert.throws(() => localDateTimeFromISO(invalid, "UTC"));
});
