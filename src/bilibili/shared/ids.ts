// resolver、订阅与测试共用的稳定标识：条目 id 的解析与拼接、UP 主 mid 提取。
// 这里的格式是持久契约，改动会让已保存任务与已有订阅失效。

import { asText } from "./text";

export interface EpisodeItemId {
  epId: string;
  qualityKey: string;
}

export interface VideoItemId {
  bvid: string;
  cid: number;
  qualityKey: string;
}

export function parseEpisodeItem(value: unknown): EpisodeItemId | null {
  const match = /^ep:(\d+)(?:@q:(\d+|h\d+))?$/.exec(asText(value));
  if (!match) return null;
  return { epId: match[1], qualityKey: match[2] || "" };
}

export function parseVideoItem(value: unknown): VideoItemId | null {
  const match = /^video:([^:]+):cid:(\d+)(?:@q:(\d+|h\d+))?$/.exec(asText(value));
  if (!match) return null;
  return { bvid: match[1], cid: Number(match[2]), qualityKey: match[3] || "" };
}

export function isUploaderItem(value: unknown): boolean {
  return asText(value).indexOf("video:") === 0;
}

export function buildEpisodeItemId(epId: unknown, qualityKey: string): string {
  return qualityKey ? "ep:" + asText(epId) + "@q:" + qualityKey : "ep:" + asText(epId);
}

export function buildVideoItemId(bvid: unknown, cid: unknown, qualityKey: string): string {
  const base = "video:" + asText(bvid) + ":cid:" + asText(cid);
  return qualityKey ? base + "@q:" + qualityKey : base;
}

export function uploaderMidFromUrl(url: unknown): string {
  const value = asText(url).trim();
  let match = /space\.bilibili\.com\/(\d+)/i.exec(value);
  if (match && match[1]) return match[1];
  match = /[?&]mid=(\d+)/i.exec(value);
  if (match && match[1]) return match[1];
  if (/^\d+$/.test(value)) return value;
  return "";
}

export function isUploaderUrl(url: unknown): boolean {
  return Boolean(uploaderMidFromUrl(url));
}
