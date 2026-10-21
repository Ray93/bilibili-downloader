// WBI key 推导：key 截取、mixin-key 重排与参数编码。
import { describe, expect, it } from "vitest";
import { wbiEncode, wbiKeyPart, wbiMixinKey } from "../bilibili/http/wbi";

describe("wbiKeyPart", () => {
  it("strips directories, query and extension", () => {
    expect(
      wbiKeyPart("https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png"),
    ).toBe("7cd084941338484aae1ad9425b84077c");
  });

  it("handles empty input", () => {
    expect(wbiKeyPart("")).toBe("");
  });
});

describe("wbiMixinKey", () => {
  it("scrambles the concatenated keys by the fixed table", () => {
    expect(wbiMixinKey("abcdefghij", "")).toBe("cidfjhabeg");
  });

  it("truncates real keys to 32 characters", () => {
    const mixin = wbiMixinKey(
      "7cd084941338484aae1ad9425b84077c",
      "4932caff0ff746eab6f01bf08b70ac45",
    );
    expect(mixin).toHaveLength(32);
  });
});

describe("wbiEncode", () => {
  it("drops the characters Bilibili's signer strips", () => {
    expect(wbiEncode("a b!'()*")).toBe("a%20b");
  });

  it("stringifies nullish values", () => {
    expect(wbiEncode(null)).toBe("");
    expect(wbiEncode(undefined)).toBe("");
  });
});
