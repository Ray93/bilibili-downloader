// 普通投稿视频的第一段解析：`/video/BV...` 或 `/video/av...` → 分P × 画质清单。
// 第二段（清单条目 → DASH 直链）复用 uploader/resolve.ts 的
// `video:<bvid>:cid:<cid>@q:<qualityKey>` 解析，条目格式与 UP 主投稿一致。

import type { ManifestItem, ResolveContext, ResolveResult } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { settingBool } from "../../host";
import { apiGetWithRetry } from "../http/client";
import { effectiveCookie } from "../http/cookies";
import {
  buildManifestVariantsFromPlay,
  selectListedQualityVariants,
  variantQualityKey,
  variantQualityTag,
  type Variant,
} from "../media/quality";
import {
  fetchVideoView,
  videoPageBaseName,
  type VideoPageRef,
  type VideoView,
} from "../media/video";
import { MAX_EPISODES, MAX_VIDEO_PAGES, MAX_VIDEO_QUALITY_PROBES } from "../shared/constants";
import { buildVideoItemId, videoRefFromUrl } from "../shared/ids";
import { sanitizeFileName } from "../shared/text";
import type { PlayResult } from "../shared/types";
import { videoPlayUrl } from "../uploader/videos";

/**
 * 选出要列进清单的分P。
 *
 * 链接带合法 `?p=N` 时只列该分P；序号越界（例如视频被改过）就退回「全部」，
 * 避免用户拿到一个空清单。
 */
export function selectVideoPages(view: VideoView, page: number): VideoPageRef[] {
  const all = (view.pages || []).slice(0, MAX_VIDEO_PAGES);
  if (page > 0) {
    const matched = all.filter((entry) => entry.page === page);
    if (matched.length) return matched;
  }
  return all;
}

/**
 * 分P × 画质 → 扁平清单条目。
 *
 * 宿主清单 UI 没有嵌套 variants，所以和番剧一样把画质展平成独立条目；
 * 探测不到画质的分P仍然出一个无画质条目，第二段会按「默认画质」再解析一次。
 */
export function buildVideoManifestItems(
  view: VideoView,
  pages: VideoPageRef[],
  qualityVariants: Variant[][],
): ManifestItem[] {
  const items: ManifestItem[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const baseName = videoPageBaseName(view, page.cid);
    const variants = qualityVariants[index] || [];
    let added = false;
    for (const variant of variants) {
      if (!(Number(variant.height) > 0)) continue;
      const qualityKey = variantQualityKey(variant);
      if (!qualityKey) continue;
      items.push({
        id: buildVideoItemId(view.bvid, page.cid, qualityKey),
        name: baseName + " [" + variantQualityTag(variant) + "]." + (variant.container || "mp4"),
        path: "",
        size: Number(variant.totalBytes) > 0 ? Number(variant.totalBytes) : 0,
        kind: "file",
      });
      added = true;
    }
    if (!added) {
      items.push({
        id: buildVideoItemId(view.bvid, page.cid, ""),
        name: baseName + ".mp4",
        path: "",
        size: 0,
        kind: "file",
      });
    }
  }
  return items;
}

export async function resolveVideoManifest(
  host: PluginHost,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const ref = videoRefFromUrl(ctx.url);
  if (!ref.bvid && !ref.aid) {
    throw new Error("无法从 Bilibili 视频链接识别 BV 号或 av 号");
  }
  const cookie = await effectiveCookie(host, ctx);
  const view = await fetchVideoView(host, ref, ctx, cookie);
  if (!view.bvid) throw new Error("Bilibili 视频接口未返回 BV 号");
  if (!view.pages.length) throw new Error("Bilibili 未返回可分P信息");

  const pages = selectVideoPages(view, ref.page);
  const title = sanitizeFileName(view.title || "Bilibili " + view.bvid);
  const highestQualityOnly = settingBool(host, "highestQualityOnly", false);

  // 分P很多时只为前 N 个分P探测画质，其余分P留给第二段按「默认画质」解析，
  // 免得清单阶段把解析超时打满。
  const probeCount = Math.min(pages.length, MAX_VIDEO_QUALITY_PROBES);
  const qualityVariants: Variant[][] = new Array<Variant[]>(pages.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= probeCount) return;
      try {
        const play = await apiGetWithRetry<PlayResult>(
          host,
          videoPlayUrl({ bvid: view.bvid, cid: pages[index].cid }),
          ctx,
          cookie,
          3,
        );
        qualityVariants[index] = selectListedQualityVariants(
          buildManifestVariantsFromPlay(play, "quality"),
          highestQualityOnly,
        );
      } catch {
        qualityVariants[index] = [];
      }
    }
  }
  const workerCount = Math.min(6, probeCount);
  const jobs: Array<Promise<void>> = [];
  for (let index = 0; index < workerCount; index += 1) jobs.push(worker());
  await Promise.all(jobs);

  let items = buildVideoManifestItems(view, pages, qualityVariants);
  if (items.length > MAX_EPISODES) {
    // 宿主拒绝超长扁平清单：回退成「每P只留最高画质」。
    items = buildVideoManifestItems(
      view,
      pages,
      qualityVariants.map((variants) => selectListedQualityVariants(variants || [], true)),
    ).slice(0, MAX_EPISODES);
  }
  if (!items.length) throw new Error("Bilibili 未返回可下载分P");
  return { manifest: { name: title, items } };
}
