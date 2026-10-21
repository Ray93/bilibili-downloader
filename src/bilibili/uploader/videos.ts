// UP 主投稿列表：WBI 签名接口取最新投稿，再用 /x/web-interface/view 补 cid。
// 只负责「读列表」，订阅与二段解析分别在 uploader/subscribe.ts 与 uploader/resolve.ts。

import type { ResolveContext, SubscribeContext } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { apiGetWbi } from "../http/wbi";
import { episodePubDate } from "../media/episodes";
import { fetchVideoView } from "../media/video";
import { UPLOADER_VIDEO_LIMIT } from "../shared/constants";
import { asArray, asNumber, asRecord, asText, sanitizeFileName } from "../shared/text";
import type { SpaceVideoRaw } from "../shared/types";

export interface UploaderVideo {
  bvid: string;
  aid: number;
  title: string;
  description: string;
  cover: string;
  pubdate: number;
  duration: string;
  cid: number;
  pageCount: number;
}

export function uploaderInfoPath(): string {
  return "/x/space/wbi/acc/info";
}

export function uploaderVideosPath(): string {
  return "/x/space/wbi/arc/search";
}

export function uploaderVideoUrl(bvid: string): string {
  return "https://www.bilibili.com/video/" + encodeURIComponent(bvid);
}

/** 投稿用通用播放接口（番剧分集则走 PGC 接口，见 media/episodes.ts）。 */
export function videoPlayUrl(video: { bvid: string; cid: number }, qualityId?: number): string {
  const qn = Number(qualityId) || 127;
  return (
    "/x/player/playurl?bvid=" +
    encodeURIComponent(video.bvid) +
    "&cid=" +
    encodeURIComponent(String(video.cid)) +
    "&qn=" +
    encodeURIComponent(String(qn)) +
    "&fnval=4048&fourk=1&fnver=0&otype=json&platform=pc"
  );
}

/**
 * 读取 UP 主最新普通投稿。
 *
 * 列表接口只有 bvid/title 等字段，播放与解析都需要 cid，因此再并发（最多 4 路）
 * 调一次 view 接口补 `pages[0].cid`；拿不到 cid 的条目会被过滤掉。
 */
export async function listUploaderVideos(
  host: PluginHost,
  mid: string,
  ctx: ResolveContext | SubscribeContext,
  cookie: string,
  limit: number,
): Promise<UploaderVideo[]> {
  const pageSize = Math.min(30, Math.max(1, Number(limit) || UPLOADER_VIDEO_LIMIT));
  const listing = await apiGetWbi<Record<string, unknown>>(
    host,
    uploaderVideosPath(),
    { mid, ps: pageSize, pn: 1, order: "pubdate", platform: "web", web_location: "1550101" },
    ctx,
    cookie,
  );
  const listingData = asRecord(listing);
  const data = asRecord(listingData.list ?? listingData);
  const rawVideos = asArray(data.vlist).map(asRecord) as SpaceVideoRaw[];

  const normalized: UploaderVideo[] = [];
  const seen: Record<string, boolean> = {};
  for (const item of rawVideos) {
    if (normalized.length >= pageSize) break;
    const bvid = asText(item.bvid || item.BV);
    if (!bvid || seen[bvid]) continue;
    seen[bvid] = true;
    normalized.push({
      bvid,
      aid: asNumber(item.aid),
      title: sanitizeFileName(asText(item.title || bvid).replace(/<[^>]+>/g, "")),
      description: asText(item.description),
      cover: asText(item.pic),
      pubdate: episodePubDate({ pub_time: asNumber(item.created) }),
      duration: asText(item.length),
      cid: 0,
      pageCount: 0,
    });
  }

  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= normalized.length) return;
      const current = normalized[index];
      try {
        const view = await fetchVideoView(host, { bvid: current.bvid }, ctx, cookie);
        const first = view.pages[0];
        current.cid = first ? first.cid : 0;
        current.pageCount = view.pages.length;
      } catch {
        current.cid = 0;
      }
    }
  }
  const workerCount = Math.min(4, normalized.length);
  const jobs: Array<Promise<void>> = [];
  for (let index = 0; index < workerCount; index += 1) jobs.push(worker());
  await Promise.all(jobs);
  return normalized.filter((video) => video.cid > 0);
}
