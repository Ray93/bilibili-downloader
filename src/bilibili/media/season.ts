// 番剧 season 定位：链接 → season_id，以及在 season 结果里按 ep_id 找分集。
// 这里只做「找」——不解析播放地址、不构造清单，因此番剧解析与番剧订阅可以共用。

import type { PluginHost } from "../../host";
import { apiGet, type RequestContext } from "../http/client";
import { asRecord, asText, firstMatch } from "../shared/text";
import type { RawEpisode, SeasonResult } from "../shared/types";

/**
 * 把番剧链接换算成 season_id。
 *
 * 支持 `/bangumi/play/ss<id>`、`/bangumi/media/md<id>`、`/bangumi/play/ep<id>`
 * 与 `?season_id=` 四种形式；md/ep 需要额外调一次接口反查 season_id。
 * 返回空字符串表示链接不被识别（调用方负责抛出中文错误）。
 */
export async function seasonIdFromUrl(
  host: PluginHost,
  url: unknown,
  ctx: RequestContext | null | undefined,
  cookie: string,
): Promise<string> {
  const seasonId = firstMatch(url, /\/bangumi\/play\/ss(\d+)/i);
  if (seasonId) return seasonId;

  const mediaId = firstMatch(url, /\/bangumi\/media\/md(\d+)/i);
  if (mediaId) {
    const media = await apiGet<SeasonResult>(
      host,
      "/pgc/review/user?media_id=" + encodeURIComponent(mediaId),
      ctx,
      cookie,
    );
    const mediaInfo = asRecord(media.media) as SeasonResult["media"];
    if (mediaInfo && mediaInfo.season_id) return asText(mediaInfo.season_id);
  }

  const episodeId = firstMatch(url, /\/bangumi\/play\/ep(\d+)/i);
  if (episodeId) {
    const episodeResult = await apiGet<SeasonResult>(
      host,
      "/pgc/view/web/season?ep_id=" + encodeURIComponent(episodeId),
      ctx,
      cookie,
    );
    if (episodeResult.season_id) return asText(episodeResult.season_id);
  }

  const query = /[?&]season_id=(\d+)/i.exec(asText(url));
  return query && query[1] ? query[1] : "";
}

/** 在正片与各分区分组里按 ep_id 找原始分集对象，找不到返回 null。 */
export function findEpisode(
  result: SeasonResult | null | undefined,
  epId: unknown,
): RawEpisode | null {
  const groups: RawEpisode[][] = [];
  if (result && Array.isArray(result.episodes)) groups.push(result.episodes);
  if (result && Array.isArray(result.section)) {
    for (const section of result.section) {
      if (section && Array.isArray(section.episodes)) groups.push(section.episodes);
    }
  }
  for (const group of groups) {
    for (const raw of group) {
      const episode = asRecord(raw) as RawEpisode;
      if (asText(episode.id || episode.ep_id) === asText(epId)) return episode;
    }
  }
  return null;
}
