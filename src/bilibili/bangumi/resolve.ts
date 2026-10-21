// 番剧两段式解析：
//   1. season/media 链接 → 分集清单（扁平条目，每集每个画质一条）；
//   2. `ep:<id>@q:<key>` → 该画质的 DASH 视频/音频直链，交回下载引擎合并。
// 本模块只负责解析，不做订阅轮询，也不创建任务。

import type { ResolveContext, ResolveResult } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { settingString } from "../../host";
import { effectiveCookie } from "../http/cookies";
import { collectEpisodes, episodeDisplayName, playerPlayUrl } from "../media/episodes";
import { findEpisode, seasonIdFromUrl } from "../media/season";
import { apiGet, requestHeaders } from "../http/client";
import { parseEpisodeItem } from "../shared/ids";
import {
  audioUrl,
  buildVariantsFromPlay,
  chooseDashIndex,
  chooseVariantIndex,
  pickAudioTrack,
  streamSize,
  type Variant,
} from "../media/quality";
import { asArray, asRecord, asText, sanitizeFileName } from "../shared/text";
import type { DashStream, DurlPart, PlayResult, RawEpisode, SeasonResult } from "../shared/types";

/** 与 `settingBool` 等价，但只在已拿到原始 settings 值时使用（避免额外宿主读取）。 */
function asBool(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return fallback;
}

/**
 * 第一段：把番剧链接展开成清单。
 *
 * 清单名称取番剧标题；条目为 `<分集名> [<画质标签>].<容器>`，番外分区写入 `path`。
 * 画质探测在 `collectEpisodes` 内完成，超长番剧会回退成每集单画质。
 */
export async function resolveManifest(
  host: PluginHost,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const cookie = await effectiveCookie(host, ctx);
  const seasonId = await seasonIdFromUrl(host, ctx.url, ctx, cookie);
  if (!seasonId) {
    throw new Error("无法从 Bilibili 番剧链接识别 season_id 或 media_id");
  }
  const result = await apiGet<SeasonResult>(
    host,
    "/pgc/view/web/season?season_id=" + encodeURIComponent(seasonId),
    ctx,
    cookie,
  );
  const title = sanitizeFileName(result.title || result.season_title || "Bilibili " + seasonId);
  const includeExtras = asBool(host.settings.includeExtras, false);
  const items = await collectEpisodes(host, result, includeExtras, ctx, cookie);
  if (!items.length) throw new Error("Bilibili 未返回可下载分集");
  return { manifest: { name: title, items } };
}

/**
 * 第二段：把清单条目解析成临时直链。
 *
 * 条目带具体画质码时按该 qn 再请求一次，确保拿到与清单一致的那一条资源；
 * 播放地址是短期直链，所以结果必须带 `ephemeral` 与 `extraHeaders`（Cookie/Referer/UA），
 * 否则下载阶段会拿不到资源。
 */
export async function resolveEpisode(
  host: PluginHost,
  ctx: ResolveContext,
): Promise<ResolveResult> {
  const parsed = parseEpisodeItem(ctx.resolverItem);
  if (!parsed) throw new Error("Bilibili 分集标识非法: " + asText(ctx.resolverItem));
  const { epId, qualityKey } = parsed;
  const cookie = await effectiveCookie(host, ctx);
  const season = await apiGet<SeasonResult>(
    host,
    "/pgc/view/web/season?ep_id=" + encodeURIComponent(epId),
    ctx,
    cookie,
  );
  const episode = findEpisode(season, epId);
  const episodeRef: RawEpisode = {
    id: epId,
    bvid: episode ? episode.bvid : undefined,
    cid: episode ? episode.cid : undefined,
  };
  // 清单条目带着具体画质码，下载阶段就按该 qn 请求；
  // qn=127 只用于「列出全部画质」，不保证每次返回同一条资源。
  const requestedQualityId = /^\d+$/.test(qualityKey) ? Number(qualityKey) : 0;
  let play: PlayResult | null = null;
  if (requestedQualityId) {
    try {
      play = await apiGet<PlayResult>(
        host,
        playerPlayUrl(episodeRef, requestedQualityId),
        ctx,
        cookie,
      );
    } catch {
      play = null;
    }
  }
  if (!play) play = await apiGet<PlayResult>(host, playerPlayUrl(episodeRef), ctx, cookie);
  if (play.code != null && Number(play.code) !== 0) {
    throw new Error("Bilibili 播放接口错误 code=" + String(play.code));
  }

  // 清单里的 name 就是最终落盘文件名；番剧名由宿主清单组承载，
  // 这里不要再拼一遍，否则预览名与实际文件名会不一致。
  const title = episode
    ? episodeDisplayName(season, epId, episode)
    : sanitizeFileName("EP" + epId);
  const headers = requestHeaders(cookie, ctx);
  const dash = asRecord(play.dash);
  const audios = asArray(dash.audio) as DashStream[];
  const audio = pickAudioTrack(audios);
  const quality = settingString(host, "quality", "best");
  const variants = buildVariantsFromPlay(play, title);
  const chosenIndex = qualityKey
    ? chooseVariantIndex(variants, qualityKey)
    : chooseDashIndex(variants, quality);

  if (qualityKey) {
    const fixed = variants[chosenIndex];
    if (chosenIndex < 0 || !fixed) {
      throw new Error("Bilibili 未返回所选画质: " + qualityKey);
    }
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

  if (quality === "audio") {
    if (!audio) {
      throw new Error("Bilibili 当前返回的是封装视频流，没有独立音频轨，无法仅下载音频");
    }
    return {
      url: audioUrl(audio),
      fileName: title + " [audio].m4a",
      totalBytes: streamSize(audio),
      extraHeaders: headers,
      ephemeral: true,
      rangeSupported: true,
    };
  }

  if (variants.length) {
    const chosen: Variant = variants[chosenIndex] || variants[0];
    if (!chosen.url) throw new Error("Bilibili 播放接口未返回视频地址");
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

  // 极少数稿件只给 FLV（durl），此时没有音频轨可合并。
  const durl = Array.isArray(play.durl) ? play.durl[0] : (play.durl as DurlPart | undefined);
  if (durl && durl.url) {
    return {
      url: durl.url,
      fileName: title + " [unknown-quality]." + asText(play.format || "flv").toLowerCase(),
      totalBytes: Number(durl.size) > 0 ? Number(durl.size) : 0,
      extraHeaders: headers,
      ephemeral: true,
      rangeSupported: true,
    };
  }
  throw new Error("Bilibili 播放接口未返回 DASH 或 FLV 地址");
}
