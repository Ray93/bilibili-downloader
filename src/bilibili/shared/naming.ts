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
