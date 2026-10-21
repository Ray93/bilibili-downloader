// 分集标签/番外判定/重名去重，以及清单条目的 id、文件名与 path 契约。
import { describe, expect, it } from "vitest";
import {
  buildEpisodeItems,
  collapseToBestQuality,
  disambiguateEpisodeNames,
  episodeDisplayName,
  episodeLabel,
  filterBangumiEpisodes,
  groupEpisodes,
  isBangumiExtraEpisode,
  type EpisodeRef,
} from "../bilibili/media/episodes";
import type { Variant } from "../bilibili/media/quality";
import type { SeasonResult } from "../bilibili/shared/types";

function variant(qualityId: number, height: number, label = height + "p"): Variant {
  return {
    label,
    url: "https://cdn/" + qualityId + ".m4s",
    fileName: "x.mp4",
    qualityId,
    totalBytes: 1000,
    bandwidth: 100,
    width: 1920,
    height,
    container: "mp4",
  };
}

function episode(id: string, baseName: string, path = ""): EpisodeRef {
  return { id, baseName, showTitle: "", bvid: "BV1", cid: "1", path };
}

describe("episodeLabel", () => {
  it("combines index and long title", () => {
    expect(episodeLabel({ index_show: "第1话", long_title: "起点" })).toBe("第1话 起点");
  });

  it("avoids repeating an identical title", () => {
    expect(episodeLabel({ index_show: "第1话", long_title: "第1话" })).toBe("第1话");
  });
});

describe("isBangumiExtraEpisode", () => {
  it("treats a non-zero section type as an extra", () => {
    expect(isBangumiExtraEpisode({ section_type: 1 })).toBe(true);
  });

  it("detects extras by badge and title text", () => {
    expect(isBangumiExtraEpisode({ badge_info: { text: "预告" } })).toBe(true);
    expect(isBangumiExtraEpisode({ share_copy: "PV 第2弹" })).toBe(true);
  });

  it("keeps main episodes", () => {
    expect(isBangumiExtraEpisode({ index_show: "第1话" })).toBe(false);
  });
});

describe("filterBangumiEpisodes", () => {
  const episodes = [{ index_show: "第1话" }, { section_type: 1, index_show: "预告" }];

  it("drops extras unless they are requested", () => {
    expect(filterBangumiEpisodes(episodes, false)).toHaveLength(1);
    expect(filterBangumiEpisodes(episodes, true)).toHaveLength(2);
  });
});

describe("disambiguateEpisodeNames", () => {
  it("appends the show title for duplicated names", () => {
    const entries = [
      { id: "1", baseName: "第1话", showTitle: "A" },
      { id: "2", baseName: "第1话", showTitle: "B" },
    ];
    expect(disambiguateEpisodeNames(entries).map((item) => item.baseName)).toEqual([
      "第1话 [A]",
      "第1话 [B]",
    ]);
  });

  it("falls back to the episode id when the show title adds nothing", () => {
    const entries = [
      { id: "7", baseName: "第1话", showTitle: "" },
      { id: "8", baseName: "第1话", showTitle: "" },
    ];
    expect(disambiguateEpisodeNames(entries)[0].baseName).toBe("第1话 [ep7]");
  });
});

describe("groupEpisodes", () => {
  const result: SeasonResult = {
    episodes: [{ id: 1, index_show: "第1话" }, { id: 2, section_type: 1, index_show: "预告" }],
    section: [{ title: "花絮", episodes: [{ id: 3, index_show: "花絮1" }] }],
  };

  it("only returns main episodes by default", () => {
    const groups = groupEpisodes(result, false);
    expect(groups).toHaveLength(1);
    expect(groups[0].episodes).toHaveLength(1);
  });

  it("adds section groups when extras are included", () => {
    const groups = groupEpisodes(result, true);
    expect(groups.map((group) => group.title)).toEqual(["正片", "花絮"]);
  });
});

describe("episodeDisplayName", () => {
  it("resolves the name from the season payload", () => {
    const result: SeasonResult = {
      episodes: [
        { id: 1, index_show: "第1话", long_title: "起点" },
        { id: 2, index_show: "第2话", long_title: "起点" },
      ],
    };
    expect(episodeDisplayName(result, 2)).toBe("第2话 起点");
  });

  it("falls back to an EP label", () => {
    expect(episodeDisplayName({}, 9)).toBe("EP9");
  });
});

describe("buildEpisodeItems", () => {
  it("emits one item per quality and a fallback item without variants", () => {
    const items = buildEpisodeItems(
      [episode("1", "第1话"), episode("2", "第2话", "花絮")],
      [[variant(80, 1080, "1080p 高清"), variant(64, 720, "720p")], []],
    );
    expect(items[0]).toEqual({
      id: "ep:1@q:80",
      name: "第1话 [1080p-高清].mp4",
      path: "",
      size: 1000,
      kind: "file",
    });
    expect(items[1].id).toBe("ep:1@q:64");
    expect(items[2]).toEqual({
      id: "ep:2",
      name: "第2话.mp4",
      path: "花絮",
      size: 0,
      kind: "file",
    });
  });
});

describe("collapseToBestQuality", () => {
  it("keeps the highest variant only", () => {
    const collapsed = collapseToBestQuality([variant(64, 720), variant(80, 1080)]);
    expect(collapsed.map((item) => item.qualityId)).toEqual([80]);
  });

  it("returns an empty list for quality-less input", () => {
    expect(collapseToBestQuality([])).toEqual([]);
  });
});
