// 宿主适配层的设置读取：布尔值可能是布尔也可能是清单里的 "true"/"false" 字符串，
// 以及 storage JSON 容错。
import { describe, expect, it } from "vitest";
import { settingBool, settingString, storageGetJson, storageSetJson } from "../host";
import { makeHost } from "./fake-host";

describe("settingString", () => {
  it("returns the configured value", () => {
    const host = makeHost({ settings: { quality: "1080" } });
    expect(settingString(host, "quality", "best")).toBe("1080");
  });

  it("falls back when unset", () => {
    const host = makeHost();
    expect(settingString(host, "quality", "best")).toBe("best");
    const nullHost = makeHost({ settings: { quality: null } });
    expect(settingString(nullHost, "quality", "best")).toBe("best");
  });
});

describe("settingBool", () => {
  it("accepts booleans", () => {
    const host = makeHost({ settings: { includeExtras: true, highestQualityOnly: false } });
    expect(settingBool(host, "includeExtras", false)).toBe(true);
    expect(settingBool(host, "highestQualityOnly", true)).toBe(false);
  });

  it("accepts the manifest string defaults", () => {
    const host = makeHost({ settings: { includeExtras: "false", reuseStoredSession: "true" } });
    expect(settingBool(host, "includeExtras", true)).toBe(false);
    expect(settingBool(host, "reuseStoredSession", false)).toBe(true);
  });

  it("falls back for unset or unparsable values", () => {
    expect(settingBool(makeHost(), "includeExtras", true)).toBe(true);
    const oddHost = makeHost({ settings: { includeExtras: "yes" } });
    expect(settingBool(oddHost, "includeExtras", false)).toBe(false);
  });
});

describe("storage json helpers", () => {
  it("round-trips values", async () => {
    const host = makeHost();
    await storageSetJson(host, "auth.refs", ["a", "b"]);
    expect(await storageGetJson<string[]>(host, "auth.refs")).toEqual(["a", "b"]);
  });

  it("returns null for missing or invalid payloads", async () => {
    const host = makeHost();
    expect(await storageGetJson(host, "missing")).toBeNull();
    host.store.set("broken", "{not json");
    expect(await storageGetJson(host, "broken")).toBeNull();
  });
});
