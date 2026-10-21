// DASH / FLV 变体构造与画质命名。全部为纯函数，
// 让命名与选择规则可以被单测固定住。

import { MAX_VARIANTS, QUALITY_HEIGHT_BY_ID } from "../shared/constants";
import { asArray, asNumber, asRecord, asText, sanitizeFileName } from "../shared/text";
import type { DashStream, DurlEntry, PlayResult, SupportFormat } from "../shared/types";

export interface Variant {
  label: string;
  url: string;
  audioUrl?: string;
  fileName: string;
  qualityId: number;
  totalBytes: number;
  bandwidth: number;
  width: number;
  height: number;
  container: string;
}

export interface VariantQualityRef {
  label?: string;
  qualityId?: number;
  height?: number;
}

export function streamUrl(stream: DashStream | null | undefined): string {
  if (!stream || typeof stream !== "object") return "";
  const primary = stream.base_url || stream.baseUrl || stream.url || "";
  if (primary) return asText(primary);
  const backups = stream.backup_url || stream.backupUrl;
  if (Array.isArray(backups) && backups.length && backups[0]) return asText(backups[0]);
  if (typeof backups === "string" && backups) return backups;
  return "";
}

export function audioUrl(stream: DashStream | null | undefined): string {
  return streamUrl(stream);
}

export function streamSize(stream: DashStream | null | undefined): number {
  const value = asNumber(
    stream && (stream.size || stream.filesize || stream.filesize_approx),
  );
  return value > 0 ? value : 0;
}

export function pickAudioTrack(audios: DashStream[]): DashStream | null {
  let best: DashStream | null = null;
  let score = -1;
  for (const track of audios) {
    if (!track || !streamUrl(track)) continue;
    const current = asNumber(track.bandwidth) || asNumber(track.id);
    if (current > score) {
      score = current;
      best = track;
    }
  }
  return best;
}

export function videoHeight(video: DashStream): number {
  const height = asNumber(video.height) || asNumber(video.height_cm);
  if (height) return height;
  const qualityId = asNumber(video.id) || asNumber(video.quality);
  return QUALITY_HEIGHT_BY_ID[qualityId] || 0;
}

export function qualityHeight(qualityId: unknown): number {
  return QUALITY_HEIGHT_BY_ID[asNumber(qualityId)] || 0;
}

export function videoQualityTag(video: DashStream, height: number): string {
  if (!height) return "unknown-quality";
  const width = asNumber(video.width);
  return width ? height + "p-" + width + "x" + height : height + "p";
}

// 同一画质码可能返回多种编码。优先 AVC（播放器/硬件兼容性最好），
// 没有 AVC 时再回退到 HEVC 或 AV1。
export function videoCodecScore(video: DashStream | null | undefined): number {
  const codecs = asText(video && (video.codecs || video.codecs_name)).toLowerCase();
  if (/avc1|avc3/.test(codecs)) return 3;
  if (/hev1|hvc1/.test(codecs)) return 2;
  if (/av01/.test(codecs)) return 1;
  return 0;
}

export function supportFormat(play: PlayResult | null | undefined, qualityId: unknown): SupportFormat | null {
  const formats = asArray(play && play.support_formats).map(asRecord);
  const target = Number(qualityId);
  for (const format of formats) {
    if (Number(format.quality) === target) return format as SupportFormat;
  }
  return null;
}

export function qualityLabelFromPlay(
  play: PlayResult | null | undefined,
  qualityId: unknown,
  height: number,
): string {
  const label = height ? height + "p" : "quality-" + asText(qualityId || "unknown");
  const format = supportFormat(play, qualityId);
  const description = asText(
    format && (format.new_description || format.description),
  ).replace(/^\s*\d{3,4}P[+＋]?\s*/i, "").trim();
  return description ? label + " " + description : label;
}

export function videoQualityLabel(video: DashStream, height: number, play: PlayResult | null): string {
  if (!height) return "Unknown quality";
  const qualityId = asNumber(video.id) || asNumber(video.quality);
  let label = qualityLabelFromPlay(play || {}, qualityId, height);
  // 文件名只保留 Bilibili 的画质名称；没有 support_formats 描述时
  // 追加画质码，避免同分辨率的两条变体重名。
  if (qualityId && label === height + "p") label += " [qn" + qualityId + "]";
  return label;
}

function asVideoList(value: unknown): DashStream[] {
  return asArray(value) as DashStream[];
}

export function buildDashVariants(
  videos: DashStream[],
  audio: DashStream | null,
  title: string,
  play: PlayResult | null,
): Variant[] {
  const candidates: Array<{ video: DashStream; height: number }> = [];
  const seen: Record<string, number> = {};
  for (const video of videos) {
    const url = streamUrl(video);
    const height = videoHeight(video);
    const qualityId = asNumber(video.id) || asNumber(video.quality);
    const key = qualityId ? "q" + qualityId : "h" + height;
    if (!url || !height) continue;
    const previousIndex = seen[key];
    if (previousIndex != null) {
      const previous = candidates[previousIndex];
      const currentScore = videoCodecScore(video);
      const previousScore = videoCodecScore(previous.video);
      if (
        currentScore > previousScore ||
        (currentScore === previousScore &&
          asNumber(video.bandwidth) > asNumber(previous.video.bandwidth))
      ) {
        candidates[previousIndex] = { video, height };
      }
      continue;
    }
    seen[key] = candidates.length;
    candidates.push({ video, height });
  }
  candidates.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    return asNumber(b.video.bandwidth) - asNumber(a.video.bandwidth);
  });

  const variants: Variant[] = [];
  for (const item of candidates) {
    if (variants.length >= MAX_VARIANTS) break;
    const video = item.video;
    const label = videoQualityLabel(video, item.height, play);
    const qualityId = asNumber(video.id) || asNumber(video.quality);
    const variant: Variant = {
      label,
      url: streamUrl(video),
      fileName:
        title + " [" + variantQualityTag({ label, qualityId, height: item.height }) + "].mp4",
      qualityId,
      totalBytes: streamSize(video) + streamSize(audio),
      bandwidth: asNumber(video.bandwidth),
      width: asNumber(video.width),
      height: item.height,
      container: "mp4",
    };
    if (audio) variant.audioUrl = audioUrl(audio);
    variants.push(variant);
  }
  if (audio && variants.length < MAX_VARIANTS) {
    variants.push({
      label: "Audio only (m4a)",
      url: audioUrl(audio),
      fileName: title + " [audio].m4a",
      qualityId: 0,
      totalBytes: streamSize(audio),
      bandwidth: asNumber(audio.bandwidth),
      width: 0,
      height: 0,
      container: "m4a",
    });
  }
  return variants;
}

export function buildDurlVariants(play: PlayResult, title: string): Variant[] {
  let entries: unknown[] = [];
  if (Array.isArray(play.durls) && play.durls.length) {
    entries = play.durls;
  } else if (Array.isArray(play.durl)) {
    entries = [{ quality: play.quality, durl: play.durl }];
  } else if (play.durl && typeof play.durl === "object") {
    entries = [{ quality: play.quality, durl: [play.durl] }];
  }

  const candidates: Array<{
    part: Record<string, unknown>;
    qualityId: number;
    height: number;
    bandwidth: number;
  }> = [];
  const seen: Record<string, boolean> = {};
  for (const rawEntry of entries) {
    const source = asRecord(rawEntry) as DurlEntry & Record<string, unknown>;
    const parts = asArray(source.durl).map(asRecord);
    const part = parts[0] ?? source;
    const url = asText(part.url);
    const qualityId = Number(asNumber(source.quality) || asNumber(part.quality) || asNumber(play.quality));
    const height = qualityHeight(qualityId);
    const key = String(qualityId || height || url);
    if (!url || seen[key]) continue;
    seen[key] = true;
    const durationMs = asNumber(play.timelength);
    const size = asNumber(part.size);
    const bandwidth = durationMs > 0 && size > 0 ? Math.round((size * 8 * 1000) / durationMs) : 0;
    candidates.push({ part, qualityId, height, bandwidth });
  }
  candidates.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    return b.qualityId - a.qualityId;
  });

  const variants: Variant[] = [];
  let format = asText(play.format || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!format) format = "mp4";
  for (const item of candidates) {
    if (variants.length >= MAX_VARIANTS) break;
    const label = qualityLabelFromPlay(play, item.qualityId, item.height);
    variants.push({
      label,
      qualityId: item.qualityId,
      url: asText(item.part.url),
      fileName:
        title + " [" + variantQualityTag({ label, qualityId: item.qualityId, height: item.height }) + "]." + format,
      totalBytes: asNumber(item.part.size) > 0 ? asNumber(item.part.size) : 0,
      bandwidth: item.bandwidth,
      width: 0,
      height: item.height,
      container: format,
    });
  }
  return variants;
}

export function buildVariantsFromPlay(play: PlayResult | null | undefined, title: string): Variant[] {
  const dash = asRecord(play && play.dash);
  const videos = asVideoList(dash.video);
  const audios = asVideoList(dash.audio);
  const dashVariants = buildDashVariants(videos, pickAudioTrack(audios), title, play || null);
  return dashVariants.length ? dashVariants : buildDurlVariants(play || {}, title);
}

export function buildManifestVariantsFromPlay(
  play: PlayResult | null | undefined,
  title: string,
): Variant[] {
  // accept_quality 里也包含「仅登录可用」的画质；只暴露真正带有视频地址的变体，
  // 否则用户选中后会得到一个永远解析不出来的条目。
  const variants = buildVariantsFromPlay(play, title).slice();
  variants.sort((a, b) => {
    if (Number(b.height) !== Number(a.height)) return Number(b.height) - Number(a.height);
    return (Number(b.qualityId) || 0) - (Number(a.qualityId) || 0);
  });
  return variants.slice(0, MAX_VARIANTS);
}

export function selectListedQualityVariants(
  variants: Variant[],
  highestQualityOnly: boolean,
): Variant[] {
  if (!highestQualityOnly) return variants;
  let best: Variant | null = null;
  for (const variant of variants) {
    const height = Number(variant.height) || 0;
    if (!height) continue;
    if (
      !best ||
      height > Number(best.height) ||
      (height === Number(best.height) && (Number(variant.qualityId) || 0) > (Number(best.qualityId) || 0))
    ) {
      best = variant;
    }
  }
  return best ? [best] : [];
}

export interface SubscriptionQuality {
  qualityId: number;
  height: number;
  label: string;
  totalBytes: number;
}

/** Qualities a subscription exposes: only entries with a real qn and height. */
export function subscriptionQualityCandidates(
  play: PlayResult | null | undefined,
  title: string,
  highestQualityOnly: boolean,
): SubscriptionQuality[] {
  const variants = selectListedQualityVariants(
    buildManifestVariantsFromPlay(play, title),
    highestQualityOnly,
  );
  const candidates: SubscriptionQuality[] = [];
  for (const variant of variants) {
    const qualityId = Number(variant.qualityId) || 0;
    const height = Number(variant.height) || 0;
    if (!qualityId || !height) continue;
    candidates.push({
      qualityId,
      height,
      label: variant.label,
      totalBytes: Number(variant.totalBytes) > 0 ? Number(variant.totalBytes) : 0,
    });
  }
  return candidates;
}

export function chooseDashIndex(variants: Variant[], quality: string): number {
  if (!variants.length) return 0;
  if (quality === "audio") {
    for (let index = 0; index < variants.length; index += 1) {
      if (variants[index].height === 0) return index;
    }
    return 0;
  }
  if (quality === "best") return 0;
  const target = Number(quality) || 1080;
  let best = 0;
  let bestHeight = 0;
  for (let index = 0; index < variants.length; index += 1) {
    const height = Number(variants[index].height) || 0;
    if (height && height <= target && height >= bestHeight) {
      best = index;
      bestHeight = height;
    }
  }
  return best;
}

export function variantQualityKey(variant: VariantQualityRef): string {
  const qualityId = Number(variant.qualityId) || 0;
  if (qualityId) return String(qualityId);
  const height = Number(variant.height) || 0;
  return height ? "h" + String(height) : "";
}

export function variantQualityTag(variant: VariantQualityRef): string {
  const height = Number(variant.height) || 0;
  let base = height ? height + "p" : "unknown-quality";
  const label = String(variant.label || "");
  const suffix = height ? label.replace(new RegExp("^" + height + "p\\s*", "i"), "").trim() : "";
  if (suffix) base += "-" + suffix;
  return sanitizeFileName(base).replace(/\s+/g, "-");
}

export function chooseVariantIndex(variants: Variant[], qualityKey: string): number {
  if (!qualityKey) return -1;
  if (qualityKey.indexOf("h") === 0) {
    const targetHeight = Number(qualityKey.slice(1)) || 0;
    for (let index = 0; index < variants.length; index += 1) {
      if (Number(variants[index].height) === targetHeight) return index;
    }
    return -1;
  }
  const targetId = Number(qualityKey) || 0;
  for (let index = 0; index < variants.length; index += 1) {
    if (Number(variants[index].qualityId) === targetId) return index;
  }
  return -1;
}
