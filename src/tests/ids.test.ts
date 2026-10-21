// 条目 id（ep/video）的解析与拼接、UP 主 mid 提取。
import { describe, expect, it } from "vitest";
import {
  buildEpisodeItemId,
  buildVideoItemId,
  isUploaderItem,
  isUploaderUrl,
  isVideoUrl,
  parseEpisodeItem,
  parseVideoItem,
  uploaderMidFromUrl,
  videoRefFromUrl,
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

describe("videoRefFromUrl", () => {
  it("reads a BV video URL", () => {
    expect(videoRefFromUrl("https://www.bilibili.com/video/BV1h6H76sEEJ")).toEqual({
      bvid: "BV1h6H76sEEJ",
      aid: "",
      page: 0,
    });
  });

  it("reads an av video URL without losing precision", () => {
    expect(videoRefFromUrl("https://www.bilibili.com/video/av114772146134896")).toEqual({
      bvid: "",
      aid: "114772146134896",
      page: 0,
    });
  });

  it("keeps the page number and ignores share noise", () => {
    expect(
      videoRefFromUrl(
        "https://www.bilibili.com/video/BV1h6H76sEEJ/?p=3&spm_id_from=333.999&vd_source=abc",
      ),
    ).toEqual({ bvid: "BV1h6H76sEEJ", aid: "", page: 3 });
  });

  it("normalizes only the BV prefix", () => {
    expect(videoRefFromUrl("https://m.bilibili.com/video/bv1h6H76sEEJ")?.bvid).toBe(
      "BV1h6H76sEEJ",
    );
  });

  it("ignores non-video URLs", () => {
    expect(videoRefFromUrl("https://www.bilibili.com/bangumi/play/ss12345")).toEqual({
      bvid: "",
      aid: "",
      page: 0,
    });
    expect(isVideoUrl("https://space.bilibili.com/123456")).toBe(false);
    expect(isVideoUrl("https://b23.tv/abcdefg")).toBe(false);
    expect(isVideoUrl("https://www.bilibili.com/video/av114772146134896")).toBe(true);
  });
});

describe("isUploaderItem", () => {
  it("only matches the video prefix", () => {
    expect(isUploaderItem("video:BV1:cid:2")).toBe(true);
    expect(isUploaderItem("ep:1@q:80")).toBe(false);
  });
});
