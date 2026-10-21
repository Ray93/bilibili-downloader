// 订阅条目标题。纯函数，不依赖宿主，便于用单测钉住命名规则。

import { sanitizeFileName } from "./text";

export interface TitleVariant {
  label?: string;
  height?: number;
  qualityId?: number;
  fileName?: string;
}

function extensionOf(fileName: unknown): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(String(fileName || ""));
  return match ? match[1].toLowerCase() : "mp4";
}

export function subscriptionItemTitle(
  seriesTitle: string,
  name: string,
  variant: TitleVariant,
): string {
  let label = String((variant && variant.label) || "").trim();
  if (!label || label === "quality-unknown") {
    const height = Number(variant && variant.height) || 0;
    label = height ? height + "p" : "unknown-quality";
    const qualityId = Number(variant && variant.qualityId) || 0;
    if (qualityId) label += " [qn" + qualityId + "]";
  }
  return sanitizeFileName(
    seriesTitle + " - " + name + " [" + label + "]." + extensionOf(variant && variant.fileName),
  );
}

export function uploaderVideoTitle(
  uploaderName: string,
  videoTitle: string,
  variant: TitleVariant,
): string {
  const label = String((variant && variant.label) || "").trim() || "unknown-quality";
  return sanitizeFileName(
    uploaderName + " - " + videoTitle + " [" + label + "]." + extensionOf(variant && variant.fileName),
  );
}

/**
 * 把宿主可能已给过的条目名退成基准名：去掉扩展名与尾部画质标签。
 *
 * `ResolveContext.title` 有时就是清单里的 `<名> [<画质标签>].mp4`，直接当基准名会拼出
 * `xxx.mp4 [1080p-高清].mp4` 这种重复后缀。只认本插件自己生成的画质标签
 * （`<height>p...`、`unknown-quality`、`audio`），标题里本来就有的 `[4K]` 之类不动。
 */
export function itemBaseName(name: unknown): string {
  const value = String(name == null ? "" : name).trim();
  if (!value) return "";
  return value
    .replace(/\.(mp4|m4a|flv|mkv|webm|mp3|aac)$/i, "")
    .replace(/\s*\[(?:\d{3,4}p|unknown-quality|audio)[^\]]*\]$/i, "")
    .trim();
}
