// 单视频链接（/video/BV...、/video/av...）的第一段清单与第二段命名。
// 宿主是假的：fetch 按 URL 子串路由到固定 JSON，覆盖分P、画质、av 兜底与命名一致性。

import { describe, expect, it } from "vitest";
import type { ResolveContext } from "fluxdown-plugin-sdk";
import { resolveUploaderVideo } from "../bilibili/uploader/resolve";
import {
  bvidFromVideoPageHtml,
  normalizeVideoView,
  videoPageBaseName,
  videoViewPath,
} from "../bilibili/media/video";
import {
  resolveVideoManifest,
  selectVideoPages,
} from "../bilibili/video/resolve";
import { htmlResponse, jsonResponse, makeHost, type FakeResponse } from "./fake-host";

type Route = [string, FakeResponse];

function routedHost(routes: Route[], settings: Record<string, unknown> = {}) {
  return makeHost({
    settings,
    fetch: (url) => {
      for (const [needle, response] of routes) {
        if (url.indexOf(needle) >= 0) return response;
      }
      throw new Error("unexpected fetch: " + url);
    },
  });
}

/** 记录真实请求过的 URL，用来钉住 av 号确实进了 `?aid=` 参数。 */
function recordingHost(routes: Route[], settings: Record<string, unknown> = {}) {
  const urls: string[] = [];
  const host = makeHost({
    settings,
    fetch: (url) => {
      urls.push(url);
      for (const [needle, response] of routes) {
        if (url.indexOf(needle) >= 0) return response;
      }
      throw new Error("unexpected fetch: " + url);
    },
  });
  return { host, urls };
}

function resolveContext(overrides: Record<string, unknown> = {}): ResolveContext {
  return {
    taskId: "task-1",
    url: "https://www.bilibili.com/video/BV1h6H76sEEJ",
    authRef: "",
    cookies: "",
    referrer: "",
    userAgent: "",
    extraHeaders: {},
    resolverItem: "",
    ...overrides,
  } as ResolveContext;
}

const BV = "BV1h6H76sEEJ";
const AID = "114772146134896";

interface PageSpec {
  cid: number;
  page: number;
  part?: string;
}

function viewPayload(title: string, pages: PageSpec[]): FakeResponse {
  return jsonResponse({
    code: 0,
    data: {
      bvid: BV,
      aid: Number(AID),
      title,
      pages: pages.map((page) => ({
        cid: page.cid,
        page: page.page,
        part: page.part || "",
        duration: 60,
      })),
    },
  });
}

const QUALITIES = [
  { id: 80, height: 1080, label: "1080P 高清" },
  { id: 64, height: 720, label: "720P 高清" },
];

function playPayload(
  entries: Array<{ id: number; height: number; label: string }> = QUALITIES,
): FakeResponse {
  return jsonResponse({
    code: 0,
    data: {
      dash: {
        video: entries.map((entry) => ({
          id: entry.id,
          height: entry.height,
          width: Math.round((entry.height * 16) / 9),
          base_url: "https://cdn.example/" + entry.id + ".m4s",
          bandwidth: entry.height * 1000,
          codecs: "avc1.640032",
          size: 2000,
        })),
        audio: [
          { id: 30280, base_url: "https://cdn.example/audio.m4s", bandwidth: 132000, size: 1000 },
        ],
      },
      support_formats: entries.map((entry) => ({
        quality: entry.id,
        new_description: entry.label,
      })),
    },
  });
}

const SINGLE_PAGE_ROUTES: Route[] = [
  ["view?bvid=" + BV, viewPayload("测试视频", [{ cid: 100, page: 1 }])],
  ["cid=100", playPayload()],
];

const MULTI_PAGE_VIEW = viewPayload("多P视频", [
  { cid: 200, page: 1, part: "第一P" },
  { cid: 201, page: 2, part: "第二P" },
]);

describe("normalizeVideoView", () => {
  it("keeps real pages, drops duplicates and missing cids", () => {
    const view = normalizeVideoView({
      title: "T",
      pages: [{ cid: 5 }, { cid: 5 }, { cid: 0 }, { cid: 7, page: 3 }],
    });
    expect(view.pages).toEqual([
      { cid: 5, page: 1, part: "", duration: 0 },
      { cid: 7, page: 3, part: "", duration: 0 },
    ]);
  });
});

describe("videoViewPath", () => {
  it("prefers bvid and falls back to aid", () => {
    expect(videoViewPath({ bvid: BV })).toBe("/x/web-interface/view?bvid=" + BV);
    expect(videoViewPath({ aid: AID })).toBe("/x/web-interface/view?aid=" + AID);
  });
});

describe("bvidFromVideoPageHtml", () => {
  it("reads the bvid out of the page state", () => {
    expect(bvidFromVideoPageHtml('{"bvid":"BV1h6H76sEEJ"}')).toBe("BV1h6H76sEEJ");
    expect(bvidFromVideoPageHtml('href="https://www.bilibili.com/video/BV1h6H76sEEJ/"')).toBe(BV);
    expect(bvidFromVideoPageHtml("<html></html>")).toBe("");
  });
});

describe("videoPageBaseName", () => {
  const multi = normalizeVideoView({
    title: "多P标题",
    pages: [
      { cid: 1, page: 1, part: "第一P" },
      { cid: 2, page: 2, part: "第二P" },
    ],
  });

  it("uses the plain title for a single page", () => {
    const single = normalizeVideoView({ title: "单P标题", pages: [{ cid: 9, page: 1 }] });
    expect(videoPageBaseName(single, 9)).toBe("单P标题");
  });

  it("adds the page label for multi-page videos", () => {
    expect(videoPageBaseName(multi, 2)).toBe("多P标题 - P2 第二P");
  });

  it("skips a part title that just repeats the title", () => {
    const view = normalizeVideoView({
      title: "同名",
      pages: [
        { cid: 1, page: 1, part: "同名" },
        { cid: 2, page: 2, part: "" },
      ],
    });
    expect(videoPageBaseName(view, 1)).toBe("同名 - P1");
  });

  it("falls back to the title for an unknown cid", () => {
    expect(videoPageBaseName(multi, 99)).toBe("多P标题");
  });
});

describe("selectVideoPages", () => {
  const view = normalizeVideoView({
    title: "多P",
    pages: [
      { cid: 1, page: 1 },
      { cid: 2, page: 2 },
    ],
  });

  it("narrows to the requested page", () => {
    expect(selectVideoPages(view, 2).map((page) => page.cid)).toEqual([2]);
  });

  it("falls back to every page when the page number is out of range", () => {
    expect(selectVideoPages(view, 99).map((page) => page.cid)).toEqual([1, 2]);
    expect(selectVideoPages(view, 0).map((page) => page.cid)).toEqual([1, 2]);
  });
});

describe("resolveVideoManifest", () => {
  it("lists one item per quality for a BV link", async () => {
    const result = await resolveVideoManifest(routedHost(SINGLE_PAGE_ROUTES), resolveContext());
    expect(result.manifest?.name).toBe("测试视频");
    expect(result.manifest?.items.map((item) => item.id)).toEqual([
      "video:" + BV + ":cid:100@q:80",
      "video:" + BV + ":cid:100@q:64",
    ]);
    expect(result.manifest?.items.map((item) => item.name)).toEqual([
      "测试视频 [1080p-高清].mp4",
      "测试视频 [720p-高清].mp4",
    ]);
    expect(result.manifest?.items[0].size).toBe(3000);
    expect(result.manifest?.items[0].kind).toBe("file");
  });

  it("asks the view API with the av number", async () => {
    const { host, urls } = recordingHost([
      ["view?aid=" + AID, viewPayload("测试视频", [{ cid: 100, page: 1 }])],
      ["cid=100", playPayload()],
    ]);
    const result = await resolveVideoManifest(
      host,
      resolveContext({ url: "https://www.bilibili.com/video/av" + AID }),
    );
    expect(urls[0]).toBe(
      "https://api.bilibili.com/x/web-interface/view?aid=" + AID,
    );
    expect(urls.some((url) => url.indexOf("/video/av") >= 0)).toBe(false);
    expect(result.manifest?.items[0].id).toBe("video:" + BV + ":cid:100@q:80");
  });

  it("normalizes an av link to bvid through the view API", async () => {
    const host = routedHost([
      ["view?aid=999", jsonResponse({ code: -404, message: "啥都木有" })],
      [
        "/video/av999",
        htmlResponse('<script>window.__INITIAL_STATE__={"bvid":"' + BV + '"}</script>'),
      ],
      ["view?bvid=" + BV, viewPayload("测试视频", [{ cid: 100, page: 1 }])],
      ["cid=100", playPayload()],
    ]);
    const result = await resolveVideoManifest(
      host,
      resolveContext({ url: "https://www.bilibili.com/video/av999" }),
    );
    expect(result.manifest?.items[0].id).toBe("video:" + BV + ":cid:100@q:80");
  });

  it("lists every page of a multi-page video", async () => {
    const host = routedHost([
      ["view?bvid=" + BV, MULTI_PAGE_VIEW],
      ["cid=200", playPayload([QUALITIES[0]])],
      ["cid=201", playPayload([QUALITIES[0]])],
    ]);
    const result = await resolveVideoManifest(host, resolveContext());
    expect(result.manifest?.items.map((item) => item.id)).toEqual([
      "video:" + BV + ":cid:200@q:80",
      "video:" + BV + ":cid:201@q:80",
    ]);
    expect(result.manifest?.items.map((item) => item.name)).toEqual([
      "多P视频 - P1 第一P [1080p-高清].mp4",
      "多P视频 - P2 第二P [1080p-高清].mp4",
    ]);
  });

  it("narrows to ?p=N", async () => {
    const host = routedHost([
      ["view?bvid=" + BV, MULTI_PAGE_VIEW],
      ["cid=200", playPayload([QUALITIES[0]])],
      ["cid=201", playPayload([QUALITIES[0]])],
    ]);
    const result = await resolveVideoManifest(
      host,
      resolveContext({ url: "https://www.bilibili.com/video/" + BV + "?p=2" }),
    );
    expect(result.manifest?.items.map((item) => item.id)).toEqual([
      "video:" + BV + ":cid:201@q:80",
    ]);
    expect(result.manifest?.items[0].name).toBe("多P视频 - P2 第二P [1080p-高清].mp4");
  });

  it("falls back to every page when ?p=N is out of range", async () => {
    const host = routedHost([
      ["view?bvid=" + BV, MULTI_PAGE_VIEW],
      ["cid=200", playPayload([QUALITIES[0]])],
      ["cid=201", playPayload([QUALITIES[0]])],
    ]);
    const result = await resolveVideoManifest(
      host,
      resolveContext({ url: "https://www.bilibili.com/video/" + BV + "?p=99" }),
    );
    expect(result.manifest?.items).toHaveLength(2);
  });

  it("keeps only the best quality when highestQualityOnly is on", async () => {
    const result = await resolveVideoManifest(
      routedHost(SINGLE_PAGE_ROUTES, { highestQualityOnly: true }),
      resolveContext(),
    );
    expect(result.manifest?.items.map((item) => item.id)).toEqual([
      "video:" + BV + ":cid:100@q:80",
    ]);
  });

  it("still lists a page whose playurl fails", async () => {
    const host = routedHost([
      ["view?bvid=" + BV, viewPayload("测试视频", [{ cid: 100, page: 1 }])],
      ["cid=100", jsonResponse({ code: -501, message: "请求过于频繁" })],
    ]);
    const result = await resolveVideoManifest(host, resolveContext());
    expect(result.manifest?.items).toHaveLength(1);
    expect(result.manifest?.items[0].id).toBe("video:" + BV + ":cid:100");
    expect(result.manifest?.items[0].name).toBe("测试视频.mp4");
    expect(result.manifest?.items[0].size).toBe(0);
  });

  it("fills manifest sizes from bandwidth when playurl omits size", async () => {
    const withoutSize = jsonResponse({
      code: 0,
      data: {
        timelength: 60000,
        dash: {
          duration: 60,
          video: [
            {
              id: 80,
              height: 1080,
              width: 1920,
              codecs: "avc1.640028",
              bandwidth: 1000000,
              base_url: "https://cdn.example/v.m4s",
            },
          ],
          audio: [
            { id: 30280, bandwidth: 128000, base_url: "https://cdn.example/a.m4s" },
          ],
        },
        support_formats: [{ quality: 80, new_description: "1080P 高清" }],
      },
    });
    const host = routedHost([
      ["view?bvid=" + BV, viewPayload("测试视频", [{ cid: 100, page: 1 }])],
      ["cid=100", withoutSize],
    ]);
    const result = await resolveVideoManifest(host, resolveContext());
    // 1 000 000 bit/s × 60 s / 8 + 128 000 bit/s × 60 s / 8
    expect(result.manifest?.items[0].size).toBe(7500000 + 960000);
  });

  it("rejects a view without pages", async () => {
    const host = routedHost([
      ["view?bvid=" + BV, jsonResponse({ code: 0, data: { bvid: BV, title: "空视频" } })],
    ]);
    await expect(resolveVideoManifest(host, resolveContext())).rejects.toThrow(
      "Bilibili 未返回可分P信息",
    );
  });

  it("rejects a link without BV/av", async () => {
    const host = routedHost([]);
    await expect(
      resolveVideoManifest(
        host,
        resolveContext({ url: "https://www.bilibili.com/bangumi/play/ss1" }),
      ),
    ).rejects.toThrow("无法从 Bilibili 视频链接识别 BV 号或 av 号");
  });
});

describe("resolveUploaderVideo title", () => {
  it("matches the manifest item name for a multi-page video", async () => {
    const host = routedHost([
      ["view?bvid=" + BV, MULTI_PAGE_VIEW],
      ["cid=201", playPayload([QUALITIES[0]])],
    ]);
    const result = await resolveUploaderVideo(
      host,
      resolveContext({
        url: "https://www.bilibili.com/video/" + BV + "?p=2",
        resolverItem: "video:" + BV + ":cid:201@q:80",
      }),
    );
    expect(result.fileName).toBe("多P视频 - P2 第二P [1080p-高清].mp4");
    expect(result.ephemeral).toBe(true);
    expect(result.rangeSupported).toBe(true);
    expect(result.audioUrl).toBe("https://cdn.example/audio.m4s");
    expect(result.extraHeaders?.Referer).toBe("https://www.bilibili.com/");
  });

  it("does not append the quality tag twice", async () => {
    const host = routedHost([
      ["view?bvid=" + BV, MULTI_PAGE_VIEW],
      ["cid=201", playPayload([QUALITIES[0]])],
    ]);
    const result = await resolveUploaderVideo(
      host,
      resolveContext({
        resolverItem: "video:" + BV + ":cid:201@q:80",
        title: "UP主 - 标题 [1080p 高清].mp4",
      }),
    );
    expect(result.fileName).toBe("UP主 - 标题 [1080p-高清].mp4");
  });
});
