// 番剧订阅：把番剧链接变成一批订阅条目。
// 轮询、去重、过滤、建任务都由 FluxDown 核心负责，这里只负责「本轮有哪些条目」。

import type { SubscribeContext, SubscribeItem, SubscribeResult } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { settingBool } from "../../host";
import { effectiveCookie } from "../http/cookies";
import { apiGet } from "../http/client";
import {
  episodeDisplayName,
  episodePageUrl,
  episodePubDate,
  groupEpisodes,
  playerPlayUrl,
} from "../media/episodes";
import { seasonIdFromUrl } from "../media/season";
import { subscriptionQualityCandidates } from "../media/quality";
import { buildEpisodeItemId } from "../shared/ids";
import { subscriptionItemTitle } from "../shared/naming";
import { MAX_SUBSCRIPTION_EPISODES } from "../shared/constants";
import { asRecord, asText, sanitizeFileName } from "../shared/text";
import type { PlayResult, RawEpisode, SeasonResult } from "../shared/types";

interface SubscriptionEpisode {
  id: string;
  episode: RawEpisode;
  name: string;
}

/**
 * 只保留最近 N 集：订阅每次调用都有墙钟预算，老分集由核心按 guid 记住，
 * 后续轮询会继续追赶最新分集。
 */
export function pickRecentEpisodes<T>(list: T[], limit: number): T[] {
  return list.length > limit ? list.slice(-limit) : list;
}

/**
 * 番剧订阅主体。
 *
 * 每条条目同时给出 `guid`、`resolverItem` 与人类可读 `title`；`guid` 与
 * `resolverItem` 复用清单条目 id（`ep:<id>@q:<qn>`），这样核心派发下载时
 * 会回到第二段解析，从而保留「视频轨 + 音频轨合并」的路径。
 */
export async function subscribeBangumi(
  host: PluginHost,
  ctx: SubscribeContext,
): Promise<SubscribeResult> {
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
  const includeExtras = settingBool(host, "includeExtras", false);

  const entries: SubscriptionEpisode[] = [];
  const seen: Record<string, boolean> = {};
  for (const group of groupEpisodes(result, includeExtras)) {
    for (const raw of group.episodes) {
      const episode = asRecord(raw) as RawEpisode;
      const epId = asText(episode.id || episode.ep_id);
      if (!epId || seen[epId]) continue;
      seen[epId] = true;
      entries.push({ id: epId, episode, name: episodeDisplayName(result, epId, episode) });
    }
  }
  const episodes = pickRecentEpisodes(entries, MAX_SUBSCRIPTION_EPISODES);
  if (!episodes.length) throw new Error("Bilibili 未返回可订阅分集");

  // 订阅条目沿用直接下载的画质集合；核心把 resolverItem 传回第二段解析，
  // 继续走视频 + 音频合并，因此 4K/HDR/高码率也能正常下载。
  const highestQualityOnly = settingBool(host, "highestQualityOnly", false);
  const buckets: Array<SubscribeItem[] | undefined> = new Array(episodes.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= episodes.length) return;
      const current = episodes[index];
      try {
        const play = await apiGet<PlayResult>(
          host,
          playerPlayUrl(current.episode),
          ctx,
          cookie,
        );
        const candidates = subscriptionQualityCandidates(play, current.name, highestQualityOnly);
        for (const candidate of candidates) {
          const qualityKey = String(candidate.qualityId);
          const resolverItem = buildEpisodeItemId(current.id, qualityKey);
          const bucket = buckets[index] || (buckets[index] = []);
          bucket.push({
            guid: resolverItem,
            title: subscriptionItemTitle(title, current.name, {
              label: candidate.label,
              qualityId: candidate.qualityId,
              height: candidate.height,
              fileName: current.name + ".mp4",
            }),
            link: episodePageUrl(current.id, current.episode),
            enclosureUrl: "",
            enclosureLength:
              Number(candidate.totalBytes) > 0 ? Number(candidate.totalBytes) : 0,
            pubDate: episodePubDate(current.episode),
            resolverItem,
          });
        }
      } catch {
        // 单集暂时不可访问（地区/权限/接口抖动）时跳过，下一轮轮询会重试全部画质。
      }
    }
  }
  const workerCount = Math.min(6, episodes.length);
  const jobs: Array<Promise<void>> = [];
  for (let index = 0; index < workerCount; index += 1) jobs.push(worker());
  await Promise.all(jobs);

  const ready: SubscribeItem[] = [];
  for (const bucket of buckets) {
    if (!bucket) continue;
    for (const item of bucket) ready.push(item);
  }
  if (!ready.length) throw new Error("Bilibili 分集均未返回可下载的单文件直链");
  return { title, link: ctx.url, items: ready };
}
