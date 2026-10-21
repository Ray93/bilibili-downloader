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

export interface VideoRef {
  bvid: string;
  aid: string;
  /** 1 起的分P序号；0 表示链接没有指定分P（列出全部）。 */
  page: number;
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

/**
 * 从 `/video/` 链接识别 BV 号、av 号与分P序号。
 *
 * av 号只作接口入参：新式 av 号与经典 BV 算法的换算不再可靠，所以这里不做本地换算，
 * 由调用方用 view 接口回读 bvid，条目 id 才会始终是 `video:<bvid>:cid:<cid>`。
 */
export function videoRefFromUrl(url: unknown): VideoRef {
  const value = asText(url).trim();
  const ref: VideoRef = { bvid: "", aid: "", page: 0 };
  if (!value) return ref;
  const bvid = /\/video\/(BV[0-9A-Za-z]{10})/i.exec(value);
  if (bvid && bvid[1]) {
    // 只归一 `BV` 前缀，其余 10 位大小写敏感，不能整体转大小写。
    ref.bvid = "BV" + bvid[1].slice(2);
  } else {
    const aid = /\/video\/av(\d+)/i.exec(value);
    if (aid && aid[1]) ref.aid = aid[1].replace(/^0+(?=\d)/, "");
  }
  if (!ref.bvid && !ref.aid) return ref;
  const page = /[?&]p=(\d+)/i.exec(value);
  const pageNumber = page && page[1] ? Number(page[1]) : 0;
  if (pageNumber > 0 && Number.isFinite(pageNumber)) ref.page = Math.floor(pageNumber);
  return ref;
}

export function isVideoUrl(url: unknown): boolean {
  const ref = videoRefFromUrl(url);
  return Boolean(ref.bvid || ref.aid);
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
