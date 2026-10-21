// 番剧分集：发现、命名与 playurl 构造。只做清单侧的事，
// 单集直链解析在 bangumi/resolve.ts。

import type { ManifestItem } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { settingBool } from "../../host";
import { MAX_EPISODES } from "../shared/constants";
import { apiGetWithRetry, type RequestContext } from "../http/client";
import {
  buildManifestVariantsFromPlay,
  selectListedQualityVariants,
  variantQualityKey,
  variantQualityTag,
  type Variant,
} from "./quality";
import { asArray, asNumber, asRecord, asText, sanitizeFileName, sanitizePath } from "../shared/text";
import type { PlayResult, RawEpisode, SeasonResult } from "../shared/types";

export interface NamedEpisode {
  id: string;
  baseName: string;
  showTitle: string;
}

export interface EpisodeRef extends NamedEpisode {
  bvid: string;
  cid: string;
  path: string;
}

export function episodeLabel(episode: RawEpisode): string {
  const index = episode.index_show || episode.title || "EP" + asText(episode.id);
  const longTitle = asText(episode.long_title);
  return longTitle && longTitle !== index ? index + " " + longTitle : index;
}

export function isBangumiExtraEpisode(episode: RawEpisode): boolean {
  const sectionType = asNumber(episode.section_type || episode.sectionType);
  if (sectionType > 0) return true;
  const badgeInfo = episode.badge_info;
  const text = [
    asText(episode.badge),
    asText(badgeInfo && badgeInfo.text),
    asText(episode.show_title),
    asText(episode.share_copy),
  ].join(" ");
  return /预告|花絮|番外|特别篇|PV|preview|trailer/i.test(text);
}

export function filterBangumiEpisodes(episodes: unknown, includeExtras: boolean): RawEpisode[] {
  const list = asArray(episodes) as RawEpisode[];
  if (includeExtras) return list;
  return list.filter((episode) => !isBangumiExtraEpisode(episode));
}

export function episodePageUrl(epId: unknown, episode?: RawEpisode | null): string {
  const id = asText(epId || (episode && (episode.id || episode.ep_id)));
  return id ? "https://www.bilibili.com/bangumi/play/ep" + encodeURIComponent(id) : "";
}

export function disambiguateEpisodeNames(episodes: NamedEpisode[]): NamedEpisode[] {
  const counts: Record<string, number> = {};
  for (const episode of episodes) {
    const name = String(episode.baseName || "");
    counts[name] = (counts[name] || 0) + 1;
  }
  for (const episode of episodes) {
    if (counts[episode.baseName] <= 1) continue;
    let suffix = String(episode.showTitle || "").trim();
    if (!suffix || suffix === episode.baseName) suffix = "ep" + String(episode.id);
    episode.baseName = sanitizeFileName(episode.baseName + " [" + suffix + "]");
  }
  return episodes;
}

export function episodeDisplayName(
  result: SeasonResult | null | undefined,
  epId: unknown,
  fallbackEpisode?: RawEpisode | null,
): string {
  const groups: RawEpisode[][] = [];
  if (result && Array.isArray(result.episodes)) groups.push(result.episodes);
  if (result && Array.isArray(result.section)) {
    for (const section of result.section) {
      if (section && Array.isArray(section.episodes)) groups.push(section.episodes);
    }
  }
  const entries: NamedEpisode[] = [];
  const seen: Record<string, boolean> = {};
  for (const group of groups) {
    for (const raw of group) {
      const episode = asRecord(raw) as RawEpisode;
      const id = asText(episode.id || episode.ep_id);
      if (!id || seen[id]) continue;
      seen[id] = true;
      entries.push({
        id,
        baseName: sanitizeFileName(episodeLabel(episode)),
        showTitle: asText(episode.show_title),
      });
    }
  }
  disambiguateEpisodeNames(entries);
  for (const entry of entries) {
    if (entry.id === String(epId)) return entry.baseName;
  }
  return sanitizeFileName(episodeLabel(fallbackEpisode || { id: asText(epId) }));
}

export function episodePubDate(episode: RawEpisode): number {
  const raw = episode.pub_time || episode.pubTime || episode.publish_time || 0;
  let numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 100000000000) numeric /= 1000;
    return Math.floor(numeric);
  }
  const parsed = Date.parse(asText(raw));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed / 1000) : 0;
}

export function episodePlayUrl(epId: unknown, qualityId?: number): string {
  const qn = Number(qualityId) || 127;
  return (
    "/pgc/player/web/playurl?ep_id=" +
    encodeURIComponent(asText(epId)) +
    "&qn=" +
    encodeURIComponent(String(qn)) +
    "&fnval=4048&fourk=1&fnver=0&otype=json&platform=web"
  );
}

/**
 * The generic /x/player/playurl endpoint now often answers 412 for bangumi
 * episodes, so episodes always go through the PGC endpoint.
 */
export function playerPlayUrl(episode: RawEpisode | null | undefined, qualityId?: number): string {
  const epId = asText(episode && (episode.id || episode.ep_id));
  return episodePlayUrl(epId, qualityId);
}

export function subscriptionPlayUrl(epId: unknown, qualityId?: number): string {
  const qn = Number(qualityId) || 127;
  return (
    "/pgc/player/web/playurl?ep_id=" +
    encodeURIComponent(asText(epId)) +
    "&qn=" +
    encodeURIComponent(String(qn)) +
    "&fnval=0&fourk=1&fnver=0&otype=json&platform=web"
  );
}

export function buildEpisodeItems(
  episodes: EpisodeRef[],
  qualityVariants: Variant[][],
): ManifestItem[] {
  const items: ManifestItem[] = [];
  for (let index = 0; index < episodes.length; index += 1) {
    const episode = episodes[index];
    const variants = qualityVariants[index] || [];
    let added = false;
    for (const variant of variants) {
      if (!(Number(variant.height) > 0)) continue;
      const qualityKey = variantQualityKey(variant);
      if (!qualityKey) continue;
      items.push({
        id: "ep:" + episode.id + "@q:" + qualityKey,
        name: episode.baseName + " [" + variantQualityTag(variant) + "]." + (variant.container || "mp4"),
        path: episode.path,
        size: Number(variant.totalBytes) > 0 ? Number(variant.totalBytes) : 0,
        kind: "file",
      });
      added = true;
    }
    if (!added) {
      items.push({
        id: "ep:" + episode.id,
        name: episode.baseName + ".mp4",
        path: episode.path,
        size: 0,
        kind: "file",
      });
    }
  }
  return items;
}

export function collapseToBestQuality(variants: Variant[]): Variant[] {
  return selectListedQualityVariants(variants || [], true);
}

export interface EpisodeGroup {
  title: string;
  episodes: RawEpisode[];
}

export function groupEpisodes(result: SeasonResult, includeExtras: boolean): EpisodeGroup[] {
  const groups: EpisodeGroup[] = [];
  if (Array.isArray(result.episodes)) {
    groups.push({ title: "正片", episodes: filterBangumiEpisodes(result.episodes, includeExtras) });
  }
  if (includeExtras && Array.isArray(result.section)) {
    for (const section of result.section) {
      if (section && Array.isArray(section.episodes)) {
        groups.push({ title: section.title || "番外", episodes: section.episodes });
      }
    }
  }
  return groups;
}

export async function collectEpisodes(
  host: PluginHost,
  result: SeasonResult,
  includeExtras: boolean,
  ctx: RequestContext | null | undefined,
  cookie: string,
): Promise<ManifestItem[]> {
  const groups = groupEpisodes(result, includeExtras);
  const seen: Record<string, boolean> = {};
  const episodes: EpisodeRef[] = [];
  for (const group of groups) {
    for (const raw of group.episodes) {
      const episode = asRecord(raw) as RawEpisode;
      const id = asText(episode.id || episode.ep_id);
      if (!id || seen[id]) continue;
      seen[id] = true;
      episodes.push({
        id,
        bvid: asText(episode.bvid || episode.bv_id),
        cid: asText(episode.cid),
        baseName: sanitizeFileName(episodeLabel(episode)),
        showTitle: asText(episode.show_title),
        path: group.title === "正片" ? "" : sanitizePath(group.title),
      });
      if (episodes.length >= MAX_EPISODES) break;
    }
    if (episodes.length >= MAX_EPISODES) break;
  }
  disambiguateEpisodeNames(episodes);

  if (!episodes.length || !ctx) {
    return episodes.map((episode) => ({
      id: "ep:" + episode.id,
      name: episode.baseName,
      path: episode.path,
      size: 0,
      kind: "file",
    }));
  }

  // 宿主清单 UI 没有嵌套的 item.variants，所以画质必须以扁平条目表达。
  // 这里逐集探测画质，最多 6 路并发，把单次调用的墙钟时间控住。
  const qualityVariants: Variant[][] = new Array<Variant[]>(episodes.length);
  const highestQualityOnly = settingBool(host, "highestQualityOnly", false);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= episodes.length) return;
      try {
        const play = await apiGetWithRetry<PlayResult>(
          host,
          playerPlayUrl(episodes[index]),
          ctx,
          cookie,
          3,
        );
        const variants = buildManifestVariantsFromPlay(play, "quality");
        qualityVariants[index] = selectListedQualityVariants(variants, highestQualityOnly);
      } catch {
        qualityVariants[index] = [];
      }
    }
  }
  const workerCount = Math.min(6, episodes.length);
  const jobs: Array<Promise<void>> = [];
  for (let index = 0; index < workerCount; index += 1) jobs.push(worker());
  await Promise.all(jobs);

  let items = buildEpisodeItems(episodes, qualityVariants);
  if (items.length > MAX_EPISODES) {
    // 宿主会拒绝超过 MAX_EPISODES 的扁平清单：短番剧保留全部画质，
    // 超长番剧回退为每集只留一个可下载的画质。
    items = buildEpisodeItems(episodes, qualityVariants.map(collapseToBestQuality));
  }
  return items;
}
