// WBI 请求签名（UP 主投稿接口需要）。mixin key 缓存 12 小时，
// 遇到 Bilibili 的 -352 / -799 签名拒绝时清缓存并重签一次。

import type { PluginHost } from "../../host";
import { storageGetJson, storageSetJson } from "../../host";
import { WBI_CACHE_KEY } from "../shared/constants";
import { md5 } from "../shared/crypto";
import { apiGet, apiGetPayload, type RequestContext } from "./client";
import { asRecord, asText, delay } from "../shared/text";
import type { NavPayload } from "../shared/types";

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30,
  4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
];

interface WbiCache {
  mixinKey?: string;
  expiresAt?: number;
}

export function wbiKeyPart(url: unknown): string {
  const value = asText(url).split("?")[0];
  const slash = value.lastIndexOf("/");
  const name = slash >= 0 ? value.slice(slash + 1) : value;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function wbiMixinKey(imgKey: unknown, subKey: unknown): string {
  const raw = asText(imgKey) + asText(subKey);
  let out = "";
  for (const index of WBI_MIXIN_KEY_ENC_TAB) {
    if (raw[index]) out += raw[index];
  }
  return out.slice(0, 32);
}

export async function getWbiKeys(
  host: PluginHost,
  ctx: RequestContext | null | undefined,
  cookie: string | undefined,
  forceRefresh: boolean,
): Promise<string> {
  if (!forceRefresh) {
    const cached = await storageGetJson<WbiCache>(host, WBI_CACHE_KEY);
    if (cached && cached.mixinKey && Number(cached.expiresAt) > Date.now()) {
      return cached.mixinKey;
    }
  }
  const payload = await apiGetPayload(host, "/x/web-interface/nav", ctx, cookie);
  const data = asRecord(payload.data) as NavPayload["data"];
  const image = asRecord(data && data.wbi_img);
  const mixinKey = wbiMixinKey(wbiKeyPart(image.img_url), wbiKeyPart(image.sub_url));
  if (!mixinKey) throw new Error("Bilibili WBI key 获取失败");
  await storageSetJson(host, WBI_CACHE_KEY, {
    mixinKey,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  });
  return mixinKey;
}

export function wbiEncode(value: unknown): string {
  return encodeURIComponent(asText(value)).replace(/[!'()*]/g, "");
}

export async function signedWbiPath(
  host: PluginHost,
  path: string,
  params: Record<string, unknown>,
  ctx: RequestContext | null | undefined,
  cookie: string | undefined,
  forceRefresh: boolean,
): Promise<string> {
  const mixinKey = await getWbiKeys(host, ctx, cookie, forceRefresh);
  const all: Record<string, unknown> = {};
  for (const key of Object.keys(params || {})) all[key] = params[key];
  all.wts = Math.floor(Date.now() / 1000);
  const query = Object.keys(all)
    .sort()
    .map((key) => wbiEncode(key) + "=" + wbiEncode(all[key]));
  const queryString = query.join("&");
  return path + "?" + queryString + "&w_rid=" + md5(queryString + mixinKey);
}

export async function apiGetWbi<T>(
  host: PluginHost,
  path: string,
  params: Record<string, unknown>,
  ctx: RequestContext | null | undefined,
  cookie: string | undefined,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const signed = await signedWbiPath(host, path, params, ctx, cookie, attempt > 0);
      return await apiGet<T>(host, signed, ctx, cookie);
    } catch (error) {
      lastError = error;
      if (attempt === 0 && /code=(-352|-799)/.test(String(error))) {
        try {
          await host.storage.set(WBI_CACHE_KEY, "");
        } catch {
          // 忽略失败：不影响主流程
        }
        await delay(800);
        continue;
      }
      break;
    }
  }
  throw lastError || new Error("Bilibili WBI 接口请求失败");
}
