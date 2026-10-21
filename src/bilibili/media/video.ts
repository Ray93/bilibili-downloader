// 单个投稿视频（/video/BV...、/video/av...）的 view 元数据与分P命名。
// 第一段清单（video/resolve.ts）与第二段直链（uploader/resolve.ts）共用这里的命名，
// 保证清单条目名与最终落盘文件名一致。

import type { PluginHost } from "../../host";
import { apiGet, requestHeaders, type RequestContext } from "../http/client";
import { MAX_VIDEO_PAGES } from "../shared/constants";
import { asArray, asNumber, asRecord, asText, sanitizeFileName } from "../shared/text";

export interface VideoPageRef {
  cid: number;
  /** 1 起的分P序号。 */
  page: number;
  part: string;
  duration: number;
}

export interface VideoView {
  bvid: string;
  aid: string;
  title: string;
  pages: VideoPageRef[];
}

/** view 接口返回的宽松 JSON → 规整结构；cid 缺失或重复的分P直接丢掉。 */
export function normalizeVideoView(raw: unknown): VideoView {
  const value = asRecord(raw);
  const pages: VideoPageRef[] = [];
  const seen: Record<string, boolean> = {};
  for (const entry of asArray(value.pages)) {
    const page = asRecord(entry);
    const cid = asNumber(page.cid);
    if (cid <= 0 || seen[String(cid)]) continue;
    seen[String(cid)] = true;
    pages.push({
      cid,
      page: asNumber(page.page) || pages.length + 1,
      part: asText(page.part).trim(),
      duration: asNumber(page.duration),
    });
    if (pages.length >= MAX_VIDEO_PAGES) break;
  }
  return {
    bvid: asText(value.bvid),
    aid: asText(value.aid),
    title: asText(value.title),
    pages,
  };
}

export function videoViewPath(ref: { bvid?: string; aid?: string }): string {
  const bvid = asText(ref && ref.bvid).trim();
  if (bvid) return "/x/web-interface/view?bvid=" + encodeURIComponent(bvid);
  return "/x/web-interface/view?aid=" + encodeURIComponent(asText(ref && ref.aid).trim());
}

/** 视频页 HTML 兜底：av 号被接口拒绝时，从页面里把 bvid 捞回来。 */
export function bvidFromVideoPageHtml(html: unknown): string {
  const text = asText(html);
  const state = /"bvid"\s*:\s*"(BV[0-9A-Za-z]{10})"/.exec(text);
  if (state && state[1]) return "BV" + state[1].slice(2);
  const canonical = /\/video\/(BV[0-9A-Za-z]{10})/.exec(text);
  return canonical && canonical[1] ? "BV" + canonical[1].slice(2) : "";
}

/**
 * 读取视频 view（标题 + 分P）。
 *
 * av 链接先直接问接口；接口拒绝时再用视频页 HTML 反查 bvid 重试一次。
 * 只有两次都失败才抛出原始中文错误。
 */
export async function fetchVideoView(
  host: PluginHost,
  ref: { bvid?: string; aid?: string },
  ctx: RequestContext | null | undefined,
  cookie: string,
): Promise<VideoView> {
  const bvid = asText(ref && ref.bvid).trim();
  const aid = asText(ref && ref.aid).trim();
  try {
    return normalizeVideoView(
      await apiGet<Record<string, unknown>>(host, videoViewPath({ bvid, aid }), ctx, cookie),
    );
  } catch (error) {
    if (bvid || !aid) throw error;
    let html = "";
    try {
      const response = await host.fetch({
        method: "GET",
        url: "https://www.bilibili.com/video/av" + encodeURIComponent(aid),
        headers: requestHeaders(cookie, ctx),
      });
      if (response && response.status >= 200 && response.status < 400) html = asText(response.body);
    } catch {
      html = "";
    }
    const fallbackBvid = bvidFromVideoPageHtml(html);
    if (!fallbackBvid) throw error;
    const view = normalizeVideoView(
      await apiGet<Record<string, unknown>>(host, videoViewPath({ bvid: fallbackBvid }), ctx, cookie),
    );
    if (!view.bvid) view.bvid = fallbackBvid;
    return view;
  }
}

/**
 * 分P的基准名（不含画质标签与扩展名）。
 *
 * 多P时带上 `P<序号> <分P标题>`，否则各分P会撞成同一个文件名；
 * 单P保持纯视频标题，和 UP 主投稿订阅的命名习惯一致。
 */
export function videoPageBaseName(view: VideoView | null | undefined, cid: unknown): string {
  const target = asNumber(cid);
  const title = asText(view && view.title).trim() || asText(view && view.bvid) || "video";
  const pages = (view && view.pages) || [];
  let page: VideoPageRef | null = null;
  for (const entry of pages) {
    if (entry.cid === target) {
      page = entry;
      break;
    }
  }
  if (!page || pages.length <= 1) return sanitizeFileName(title);
  const part = page.part && page.part !== title ? page.part : "";
  const label = "P" + String(page.page || 1) + (part ? " " + part : "");
  return sanitizeFileName(title + " - " + label);
}
