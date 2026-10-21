// 订阅标题命名与「每轮只取最近 N 集」的裁剪规则。
import { describe, expect, it } from "vitest";
import { subscriptionItemTitle, itemBaseName, uploaderVideoTitle } from "../bilibili/shared/naming";
import { pickRecentEpisodes } from "../bilibili/bangumi/subscribe";

describe("subscriptionItemTitle", () => {
  it("keeps the provided label and extension", () => {
    expect(
      subscriptionItemTitle("番剧名", "第1话", { label: "1080p 高清", fileName: "x.m4a" }),
    ).toBe("番剧名 - 第1话 [1080p 高清].m4a");
  });

  it("falls back to the height and quality code", () => {
    expect(subscriptionItemTitle("番剧名", "第1话", { height: 720, qualityId: 64 })).toBe(
      "番剧名 - 第1话 [720p [qn64]].mp4",
    );
  });

  it("marks unknown qualities", () => {
    expect(subscriptionItemTitle("番剧名", "第1话", {})).toBe(
      "番剧名 - 第1话 [unknown-quality].mp4",
    );
  });
});

describe("uploaderVideoTitle", () => {
  it("prefixes the uploader name", () => {
    expect(
      uploaderVideoTitle("UP主", "标题", { label: "4K 超清", fileName: "a.mp4" }),
    ).toBe("UP主 - 标题 [4K 超清].mp4");
  });

  it("defaults to unknown-quality", () => {
    expect(uploaderVideoTitle("UP主", "标题", {})).toBe("UP主 - 标题 [unknown-quality].mp4");
  });
});

describe("itemBaseName", () => {
  it("strips the extension and one trailing quality tag", () => {
    expect(itemBaseName("标题 [1080p-高清].mp4")).toBe("标题");
    expect(itemBaseName("UP主 - 标题 [1080p 高清].mp4")).toBe("UP主 - 标题");
  });

  it("leaves a plain title alone", () => {
    expect(itemBaseName("标题")).toBe("标题");
    expect(itemBaseName("标题 [4K]")).toBe("标题 [4K]");
    expect(itemBaseName("")).toBe("");
    expect(itemBaseName(undefined)).toBe("");
  });
});

describe("pickRecentEpisodes", () => {
  it("keeps the most recent slice", () => {
    const episodes = Array.from({ length: 60 }, (_value, index) => index);
    const recent = pickRecentEpisodes(episodes, 50);
    expect(recent).toHaveLength(50);
    expect(recent[0]).toBe(10);
    expect(recent[49]).toBe(59);
  });

  it("keeps short lists untouched", () => {
    expect(pickRecentEpisodes([1, 2, 3], 50)).toEqual([1, 2, 3]);
  });
});
