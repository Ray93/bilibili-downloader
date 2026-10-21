// WBI 签名依赖的 MD5/UTF-8 字节向量。
import { describe, expect, it } from "vitest";
import { md5, utf8Bytes } from "../bilibili/shared/crypto";

describe("utf8Bytes", () => {
  it("encodes ASCII", () => {
    expect(utf8Bytes("abc")).toEqual([97, 98, 99]);
  });

  it("encodes a 3-byte code point", () => {
    expect(utf8Bytes("中")).toEqual([0xe4, 0xb8, 0xad]);
  });

  it("encodes a surrogate pair as one 4-byte sequence", () => {
    expect(utf8Bytes("😀")).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });
});

describe("md5", () => {
  it("matches the empty-string vector", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("matches the abc vector", () => {
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("matches the pangram vector", () => {
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe(
      "9e107d9d372bb6826bd81d3542a419d6",
    );
  });

  it("hashes multi-block input", () => {
    expect(md5("a".repeat(200))).toHaveLength(32);
  });
});
