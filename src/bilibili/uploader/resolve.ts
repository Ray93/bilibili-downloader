// UP 主投稿的第二段解析：`video:<bvid>:cid:<cid>@q:<qn>` → DASH 直链。
// 与番剧分集不同，这里用通用播放接口，并把 cid 直接写进条目 id。

import type { ResolveContext, ResolveResult } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { settingString } from "../../host";
import { apiGet, requestHeaders } from "../http/client";
import { effectiveCookie } from "../http/cookies";
import {
  audioUrl,
  buildVariantsFromPlay,
  chooseDashIndex,
  chooseVariantIndex,
  pickAudioTrack,
  playDurationMs,
  streamBytes,
  type Variant,
} from "../media/quality";
import { parseVideoItem } from "../shared/ids";
import { itemBaseName } from "../shared/naming";
import { asArray, asRecord, asText, sanitizeFileName } from "../shared/text";
import type { DashStream, PlayResult } from "../shared/types";
import { fetchVideoView, videoPageBaseName, type VideoView } from "../media/video";
import { videoPlayUrl } from "./videos";

/**
 * 解析单条投稿视频。
 *
 * 标题优先取任务上下文里的 `title`（宿主可能已由清单给出），其次 view 接口，
 * 最后退回 bvid；结果同样带 `ephemeral` 与 `extraHeaders`，供下载阶段直接使用。
 */
export async function resolveUploaderVideo(
  host: PluginHost,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const parsed = parseVideoItem(ctx.resolverItem);
  if (!parsed) throw new Error("Bilibili 投稿视频标识非法: " + asText(ctx.resolverItem));
  const { bvid, cid, qualityKey } = parsed;
  const video = { bvid, cid };
  const cookie = await effectiveCookie(host, ctx);

  let play: PlayResult | null = null;
  const requestedQualityId = /^\d+$/.test(qualityKey) ? Number(qualityKey) : 0;
  if (requestedQualityId) {
    try {
      play = await apiGet<PlayResult>(host, videoPlayUrl(video, requestedQualityId), ctx, cookie);
    } catch {
      play = null;
    }
  }
  if (!play) play = await apiGet<PlayResult>(host, videoPlayUrl(video), ctx, cookie);

  let view: VideoView | null = null;
  try {
    view = await fetchVideoView(host, { bvid }, ctx, cookie);
  } catch {
    // 取不到 view 不影响下载：标题退回宿主给的条目名或 bvid。
  }
  // 宿主可能把清单条目名（已含画质标签与扩展名）当标题传来，先退成基准名再拼，
  // 否则会出现 `xxx.mp4 [1080p-高清].mp4` 这类重复后缀。
  const ctxTitle = itemBaseName(asRecord(ctx).title);
  // 多P视频按 cid 取分P名，和第一段清单条目名保持一致；单P仍是纯视频标题。
  const title = sanitizeFileName(
    ctxTitle || (view ? videoPageBaseName(view, cid) : "") || bvid,
  );
  const headers = requestHeaders(cookie, ctx);
  const dash = asRecord(play.dash);
  const audios = asArray(dash.audio) as DashStream[];
  const audio = pickAudioTrack(audios);
  const variants = buildVariantsFromPlay(play, title);
  const chosenIndex = qualityKey
    ? chooseVariantIndex(variants, qualityKey)
    : chooseDashIndex(variants, settingString(host, "quality", "best"));

  if (qualityKey) {
    const fixed = variants[chosenIndex];
    if (chosenIndex < 0 || !fixed) throw new Error("Bilibili 未返回所选画质: " + qualityKey);
    const fixedResult: ResolveResult = {
      url: fixed.url,
      fileName: fixed.fileName,
      totalBytes: fixed.totalBytes,
      extraHeaders: headers,
      ephemeral: true,
      rangeSupported: true,
    };
    if (fixed.audioUrl) fixedResult.audioUrl = fixed.audioUrl;
    return fixedResult;
  }

  if (settingString(host, "quality", "best") === "audio") {
    if (!audio) throw new Error("Bilibili 当前没有独立音频轨");
    return {
      url: audioUrl(audio),
      fileName: title + " [audio].m4a",
      totalBytes: streamBytes(audio, playDurationMs(play)),
      extraHeaders: headers,
      ephemeral: true,
      rangeSupported: true,
    };
  }

  if (variants.length) {
    const chosen: Variant = variants[chosenIndex] || variants[0];
    const result: ResolveResult = {
      url: chosen.url,
      fileName: chosen.fileName,
      totalBytes: chosen.totalBytes,
      extraHeaders: headers,
      ephemeral: true,
      rangeSupported: true,
      variants,
      defaultVariantIndex: chosenIndex,
    };
    if (chosen.audioUrl) result.audioUrl = chosen.audioUrl;
    return result;
  }

  throw new Error("Bilibili 投稿播放接口未返回 DASH 地址");
}
