import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  TemplateManager,
  type TemplateDefinition,
  type TemplateApplyInput,
} from "../src/templates.js";
import { HUMAN, type Capability } from "../src/types.js";

const date = { occurredAt: "2030-04-01", timeZone: "Asia/Tokyo" };
const request = (operationId = "adopt-reading"): TemplateApplyInput => ({
  templateId: "reading.basic",
  operationId,
  ...date,
});
const custom = (version = 1): TemplateDefinition => ({
  id: "personal.reading",
  version,
  name: "虚构个人阅读模板",
  requires: ["learning"],
  parameters: [
    {
      key: "title",
      label: "标题",
      type: "text",
      required: true,
      default: "虚构阅读计划",
    },
  ],
  target: {
    module: "learning",
    type: "checklist-item",
    kind: "plan",
    status: "active",
  },
  defaults: {
    title: { parameter: "title" },
    fields: { focus: "提出一个问题" },
  },
});
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "life-templates-")),
    store = new Store(join(root, "private"));
  return {
    root,
    store,
    manager: new TemplateManager(store),
    close: () => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
};
function state(store: Store) {
  return JSON.stringify({
    entities: store.db.prepare("SELECT * FROM entities ORDER BY id").all(),
    operations: store.db.prepare("SELECT * FROM operations ORDER BY seq").all(),
    requests: store.db.prepare("SELECT * FROM requests ORDER BY id").all(),
    audit: store.db.prepare("SELECT * FROM audit ORDER BY id").all(),
    notes: readdirSync(store.vault.root)
      .sort()
      .map((path) => [
        path,
        readFileSync(join(store.vault.root, path), "utf8"),
      ]),
  });
}

test("template listing and preview are read-only; only explicit adoption creates a plan", () => {
  const f = fixture();
  try {
    const before = state(f.store),
      files = readdirSync(f.store.root).sort();
    const list = f.manager.list();
    assert.equal(list.length, 2);
    assert.ok(list.every((t) => t.source === "builtin" && t.available));
    list[0].defaults.title = "mutated listing";
    const preview = f.manager.preview({ templateId: "reading.basic", ...date });
    assert.equal(preview.entity.id, undefined);
    assert.equal(preview.entity.title, "阅读学习计划");
    assert.equal(preview.entity.kind, "plan");
    assert.equal(state(f.store), before);
    assert.deepEqual(readdirSync(f.store.root).sort(), files);
    assert.equal(existsSync(f.manager.registryPath), false);
    const entity = f.manager.apply(request());
    assert.equal(entity.type, "checklist-item");
    assert.equal(entity.status, "draft");
    assert.equal(entity.fields.minutes, undefined);
    assert.equal(f.store.list().length, 1);
    assert.equal(f.store.list().filter((e) => e.kind === "fact").length, 0);
  } finally {
    f.close();
  }
});

test("personal registry persists atomic, private versioned declarations without adopting them", () => {
  const f = fixture();
  try {
    const before = state(f.store),
      first = custom();
    f.manager.register(first);
    assert.equal(state(f.store), before);
    assert.equal(lstatSync(f.manager.registryPath).mode & 0o777, 0o600);
    assert.equal(
      readdirSync(f.store.root).some((name) => name.startsWith(".templates-")),
      false,
    );
    const bytes = readFileSync(f.manager.registryPath, "utf8");
    const restart = new TemplateManager(f.store);
    assert.equal(
      restart.list().find((t) => t.id === first.id)?.source,
      "personal",
    );
    restart.register(structuredClone(first));
    assert.equal(readFileSync(f.manager.registryPath, "utf8"), bytes);
    assert.throws(
      () => restart.register({ ...first, name: "changed same version" }),
      /version reused/,
    );
    restart.register({ ...custom(3), defaults: { title: "未来计划" } });
    assert.throws(() => restart.register(custom(2)), /must increase/);
    assert.equal(
      restart.preview({ templateId: first.id, version: 1, ...date }).entity
        .title,
      "虚构阅读计划",
    );
    assert.equal(
      restart.preview({ templateId: first.id, ...date }).entity.title,
      "未来计划",
    );
    assert.equal(f.store.list().length, 0);
  } finally {
    f.close();
  }
});

test("adoption receipts survive edits, restart, template upgrades, deletion and module disablement", () => {
  const f = fixture();
  try {
    f.manager.register(custom());
    const input = {
      ...request(),
      templateId: "personal.reading",
      parameters: { title: "最初采用" },
    };
    const initial = f.manager.apply(input);
    f.store.save({
      expectedVersion: initial.version,
      expectedNoteHash: initial.noteHash,
      entity: {
        ...initial,
        title: "后来编辑",
        body: "用户自己的补充",
        deleted: true,
      },
    });
    f.manager.register({ ...custom(2), defaults: { title: "升级后默认值" } });
    f.store.setEnabled("learning", false);
    const before = state(f.store),
      replay = new TemplateManager(f.store).apply(input);
    assert.equal(replay.id, initial.id);
    assert.equal(replay.title, "后来编辑");
    assert.equal(replay.body, "用户自己的补充");
    assert.equal(replay.deleted, true);
    assert.equal(state(f.store), before);
    assert.throws(
      () => f.manager.apply({ ...input, parameters: { title: "变更请求" } }),
      /different content/,
    );
    assert.throws(
      () => f.manager.apply({ ...input, version: 2 }),
      /different content/,
    );
    const restricted: Capability = { ...HUMAN, write: [], read: [] };
    assert.throws(
      () => f.manager.apply(input, restricted),
      /Permission denied/,
    );
    const scoped: Capability = {
      ...HUMAN,
      scope: { learning: { entityIds: ["other-entity"] } },
    };
    assert.throws(() => f.manager.apply(input, scoped), /scope/);
    assert.equal(state(f.store), before);
  } finally {
    f.close();
  }
});

test("invalid adoption validates dependencies, parameters and Store fields before any write", () => {
  const f = fixture();
  try {
    const before = state(f.store);
    assert.throws(
      () => f.manager.apply({ ...request(), parameters: { missing: "x" } }),
      /Unknown template parameter/,
    );
    assert.throws(
      () => f.manager.apply({ ...request(), parameters: { title: 9 } }),
      /Invalid template parameter/,
    );
    assert.throws(
      () => f.manager.apply({ ...request(), occurredAt: "2030-02-30" }),
      /calendar date/,
    );
    assert.throws(
      () =>
        f.manager.apply({
          ...request(),
          templateId: "languages.reading",
          parameters: { language: "unknown-language" },
        }),
      /Invalid fields/,
    );
    f.manager.register({ ...custom(), requires: ["learning", "projects"] });
    f.store.setEnabled("projects", false);
    assert.throws(
      () => f.manager.apply({ ...request(), templateId: "personal.reading" }),
      /disabled/,
    );
    assert.equal(
      f.manager.list().find((t) => t.id === "personal.reading")?.available,
      false,
    );
    assert.throws(
      () =>
        f.manager.register({
          ...custom(2),
          requires: ["learning", "missing-module"],
        }),
      /Unknown module/,
    );
    const ai: Capability = { ...HUMAN, role: "ai" };
    assert.throws(
      () => f.manager.apply(request(), ai),
      /AI may create draft inferences only/,
    );
    assert.throws(() => f.manager.register(custom(2), ai), /Only humans/);
    assert.equal(state(f.store), before);
  } finally {
    f.close();
  }
});

test("registry rejects code, unknown properties, facts, result fields and path inputs", () => {
  const f = fixture();
  try {
    const bad = [
      { ...custom(), script: "process.exit()" },
      { ...custom(), id: "../../outside" },
      { ...custom(), target: { ...custom().target, kind: "fact" } },
      { ...custom(), target: { ...custom().target, status: "done" } },
      { ...custom(), defaults: { title: "x", fields: { minutes: 30 } } },
      { ...custom(), defaults: { title: "x", fields: { result: "完成" } } },
      { ...custom(), defaults: { title: { code: "return 'x'" } } },
      { ...custom(), defaults: { title: { parameter: "undeclared" } } },
      { ...custom(), defaults: { title: () => "execute" } },
      JSON.parse('{"id":"personal.reading","__proto__":{"polluted":true}}'),
      { ...custom(), defaults: { title: "x", fields: { nonexistent: "x" } } },
    ];
    const before = state(f.store);
    for (const input of bad)
      assert.throws(() => f.manager.register(input as TemplateDefinition));
    assert.throws(
      () =>
        f.manager.apply({
          ...request(),
          path: "/tmp/code.js",
        } as TemplateApplyInput),
      /Unknown template property/,
    );
    assert.throws(
      () => f.manager.register({ ...custom(), id: "reading.basic" }),
      /reserved/,
    );
    assert.equal(state(f.store), before);
    assert.equal(existsSync(f.manager.registryPath), false);
  } finally {
    f.close();
  }
});

test("parameter ranges and relation permissions are validated; failures leave no entity or receipt", () => {
  const f = fixture();
  try {
    const goal = f.store.save({
      expectedVersion: 0,
      entity: {
        module: "projects",
        type: "goal",
        kind: "plan",
        status: "active",
        title: "虚构项目目标",
        fields: {},
        relations: [],
        body: "",
        ...date,
      },
    });
    const template: TemplateDefinition = {
      ...custom(),
      parameters: [
        ...custom().parameters,
        { key: "target", label: "目标", type: "text", required: true },
        {
          key: "effort",
          label: "计划级别",
          type: "number",
          min: 1,
          max: 3,
          default: 2,
        },
        {
          key: "focus",
          label: "重点",
          type: "select",
          options: ["问题", "方法"],
          default: "问题",
        },
      ],
      defaults: {
        title: { parameter: "title" },
        fields: { focus: { parameter: "focus" } },
        relations: [{ type: "supports", target: { parameter: "target" } }],
      },
    };
    f.manager.register(template);
    const before = state(f.store),
      input = {
        ...request(),
        templateId: template.id,
        parameters: { target: goal.id },
      };
    assert.throws(
      () =>
        f.manager.apply({
          ...input,
          parameters: { ...input.parameters, effort: 4 },
        }),
      /out of range/,
    );
    assert.throws(
      () =>
        f.manager.apply({
          ...input,
          parameters: { ...input.parameters, focus: "other" },
        }),
      /option/,
    );
    assert.throws(
      () => f.manager.apply({ ...input, parameters: { target: "missing" } }),
      /relation target/,
    );
    const denied: Capability = { ...HUMAN, read: ["learning"] };
    assert.throws(() => f.manager.apply(input, denied), /Permission denied/);
    const scoped: Capability = {
      ...HUMAN,
      scope: { projects: { entityIds: ["different"] } },
    };
    assert.throws(() => f.manager.apply(input, scoped), /entity scope/);
    assert.equal(state(f.store), before);
    assert.equal(f.manager.apply(input).relations[0].target, goal.id);
  } finally {
    f.close();
  }
});

test("registry reads and writes reject symlinks, including dangling links", () => {
  const f = fixture();
  try {
    const outside = join(f.root, "outside.json"),
      contents = '{"format":1,"templates":[]}';
    writeFileSync(outside, contents);
    symlinkSync(outside, f.manager.registryPath);
    assert.throws(() => f.manager.list());
    assert.throws(() => f.manager.register(custom()));
    assert.equal(readFileSync(outside, "utf8"), contents);
    rmSync(f.manager.registryPath);
    symlinkSync(join(f.root, "does-not-exist.json"), f.manager.registryPath);
    assert.throws(() => f.manager.list(), /symlink/);
    assert.throws(() => f.manager.register(custom()), /symlink/);
    assert.equal(existsSync(join(f.root, "does-not-exist.json")), false);
  } finally {
    f.close();
  }
});

test("operation IDs cannot collide with ordinary saves or non-template receipts", () => {
  const f = fixture();
  try {
    f.store.save({
      operationId: "occupied",
      expectedVersion: 0,
      entity: {
        module: "planning",
        type: "goal",
        title: "虚构普通目标",
        kind: "plan",
        status: "draft",
        fields: {},
        relations: [],
        body: "",
        ...date,
      },
    });
    const before = state(f.store);
    assert.throws(
      () => f.manager.apply(request("occupied")),
      /different content/,
    );
    assert.equal(state(f.store), before);
  } finally {
    f.close();
  }
});

test("registration locks prevent lost updates and preserve locks owned by another writer", () => {
  const f = fixture();
  try {
    f.manager.register(custom());
    const lock = join(f.store.root, ".templates-register.lock"),
      contents = readFileSync(f.manager.registryPath, "utf8");
    assert.equal(existsSync(lock), false);
    mkdirSync(lock);
    const owner = join(lock, "other-writer");
    writeFileSync(owner, "do not remove");
    assert.throws(
      () => f.manager.register({ ...custom(), id: "personal.other" }),
      /busy; retry/,
    );
    assert.equal(readFileSync(f.manager.registryPath, "utf8"), contents);
    assert.equal(readFileSync(owner, "utf8"), "do not remove");
    assert.equal(
      f.manager.list().some((template) => template.id === "personal.reading"),
      true,
    );
    rmSync(lock, { recursive: true });
    f.manager.register({ ...custom(), id: "personal.other" });
    assert.deepEqual(
      f.manager
        .list()
        .filter((template) => template.source === "personal")
        .map((template) => template.id),
      ["personal.other", "personal.reading"],
    );
    const updated = readFileSync(f.manager.registryPath, "utf8");
    assert.throws(
      () => f.manager.register({ ...custom(), name: "conflicting version" }),
      /version reused/,
    );
    assert.equal(readFileSync(f.manager.registryPath, "utf8"), updated);
    assert.equal(existsSync(lock), false);
    assert.equal(
      readdirSync(f.store.root).some((name) => name.startsWith(".templates-")),
      false,
    );
    const foreign = join(f.root, "foreign-lock");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "owner"), "foreign");
    symlinkSync(foreign, lock);
    assert.throws(() => f.manager.register(custom(2)), /lock symlink denied/);
    assert.equal(lstatSync(lock).isSymbolicLink(), true);
    assert.equal(readFileSync(join(foreign, "owner"), "utf8"), "foreign");
    assert.equal(readFileSync(f.manager.registryPath, "utf8"), updated);
  } finally {
    f.close();
  }
});
