// UP 主投稿订阅：最新 N 条投稿 × 每条的可用画质 → 订阅条目。
// 投稿列表固定读最新 20 条；轮询、去重与建任务仍由 FluxDown 核心负责。

import type { SubscribeContext, SubscribeItem, SubscribeResult } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { apiGet } from "../http/client";
import { effectiveCookie } from "../http/cookies";
import { apiGetWbi } from "../http/wbi";
import { subscriptionQualityCandidates } from "../media/quality";
import { UPLOADER_VIDEO_LIMIT } from "../shared/constants";
import { buildVideoItemId, uploaderMidFromUrl } from "../shared/ids";
import { uploaderVideoTitle } from "../shared/naming";
import { asRecord, asText, sanitizeFileName } from "../shared/text";
import type { PlayResult, SpaceCard } from "../shared/types";
import {
  listUploaderVideos,
  uploaderInfoPath,
  uploaderVideoUrl,
  videoPlayUrl,
} from "./videos";

/**
 * 订阅 UP 主投稿。
 *
 * `guid`/`resolverItem` 使用 `video:<bvid>:cid:<cid>@q:<qn>`，核心派发下载时会
 * 回到 `uploader/resolve.ts` 的第二段解析；画质固定取「全部可用」，由订阅过滤
 * 让用户自行筛选。单个投稿失败只跳过该投稿，下一轮重试。
 */
export async function subscribeUploader(
  host: PluginHost,
  ctx: SubscribeContext,
): Promise<SubscribeResult> {
  const mid = uploaderMidFromUrl(ctx.url);
  if (!mid) throw new Error("无法从 Bilibili UP 主链接识别 mid");
  const cookie = await effectiveCookie(host, ctx);
  const infoResult = await apiGetWbi<Record<string, unknown>>(
    host,
    uploaderInfoPath(),
    { mid },
    ctx,
    cookie,
  );
  const card = asRecord(infoResult.card ?? infoResult) as SpaceCard;
  const uploaderName = sanitizeFileName(asText(card.name || card.uname) || "UP主 " + mid);
  const videos = await listUploaderVideos(host, mid, ctx, cookie, UPLOADER_VIDEO_LIMIT);
  if (!videos.length) throw new Error("Bilibili 未返回可订阅的普通投稿视频");

  const items: SubscribeItem[] = [];
  for (const video of videos) {
    try {
      const play = await apiGet<PlayResult>(host, videoPlayUrl(video), ctx, cookie);
      const variants = subscriptionQualityCandidates(play, video.title, true);
      for (const variant of variants) {
        const resolverItem = buildVideoItemId(video.bvid, video.cid, String(variant.qualityId));
        items.push({
          guid: resolverItem,
          title: uploaderVideoTitle(uploaderName, video.title, variant),
          link: uploaderVideoUrl(video.bvid),
          enclosureUrl: "",
          enclosureLength: Number(variant.totalBytes) > 0 ? Number(variant.totalBytes) : 0,
          pubDate: video.pubdate,
          resolverItem,
        });
      }
    } catch {
      // 单个投稿解析失败只跳过它，下一轮轮询会重新尝试。
    }
  }
  if (!items.length) throw new Error("Bilibili 投稿均未返回可下载画质");
  return { title: "Bilibili UP主 - " + uploaderName, link: ctx.url, items };
}
