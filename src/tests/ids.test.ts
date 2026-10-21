// 条目 id（ep/video）的解析与拼接、UP 主 mid 提取。
import { describe, expect, it } from "vitest";
import {
  buildEpisodeItemId,
  buildVideoItemId,
  isUploaderItem,
  isUploaderUrl,
  parseEpisodeItem,
  parseVideoItem,
  uploaderMidFromUrl,
} from "../bilibili/shared/ids";

describe("parseEpisodeItem", () => {
  it("parses the plain episode form", () => {
    expect(parseEpisodeItem("ep:123")).toEqual({ epId: "123", qualityKey: "" });
  });

  it("parses quality and height keys", () => {
    expect(parseEpisodeItem("ep:123@q:80")?.qualityKey).toBe("80");
    expect(parseEpisodeItem("ep:123@q:h720")?.qualityKey).toBe("h720");
  });

  it("rejects unknown formats", () => {
    expect(parseEpisodeItem("ep:abc")).toBeNull();
    expect(parseEpisodeItem("video:1:cid:2")).toBeNull();
    expect(parseEpisodeItem("")).toBeNull();
  });
});

describe("parseVideoItem", () => {
  it("parses the uploader video form", () => {
    expect(parseVideoItem("video:BV1xx411c7mD:cid:456@q:80")).toEqual({
      bvid: "BV1xx411c7mD",
      cid: 456,
      qualityKey: "80",
    });
  });

  it("rejects a missing cid", () => {
    expect(parseVideoItem("video:BV1xx411c7mD")).toBeNull();
  });
});

describe("item id builders", () => {
  it("round-trips episode ids", () => {
    expect(parseEpisodeItem(buildEpisodeItemId("42", "80"))).toEqual({
      epId: "42",
      qualityKey: "80",
    });
    expect(buildEpisodeItemId("42", "")).toBe("ep:42");
  });

  it("round-trips video ids", () => {
    expect(parseVideoItem(buildVideoItemId("BV1", 7, "64"))).toEqual({
      bvid: "BV1",
      cid: 7,
      qualityKey: "64",
    });
  });
});

describe("uploaderMidFromUrl", () => {
  it("reads a space URL", () => {
    expect(uploaderMidFromUrl("https://space.bilibili.com/123456")).toBe("123456");
  });

  it("reads a mid query parameter", () => {
    expect(uploaderMidFromUrl("https://www.bilibili.com/video/BV1?mid=42")).toBe("42");
  });

  it("accepts a bare mid", () => {
    expect(uploaderMidFromUrl("987654")).toBe("987654");
  });

  it("ignores non-uploader URLs", () => {
    expect(uploaderMidFromUrl("https://www.bilibili.com/bangumi/play/ss1")).toBe("");
    expect(isUploaderUrl("https://www.bilibili.com/bangumi/play/ss1")).toBe(false);
  });
});

describe("isUploaderItem", () => {
  it("only matches the video prefix", () => {
    expect(isUploaderItem("video:BV1:cid:2")).toBe(true);
    expect(isUploaderItem("ep:1@q:80")).toBe(false);
  });
});
