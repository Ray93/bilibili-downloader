// Cookie 处理：解析浏览器 Cookie 头 / Netscape cookies.txt、归一化 SESSDATA，
// 并决定本次请求用哪一份登录态。本模块只读写 storage，不发起网络请求。

import type { PluginHost } from "../../host";
import { storageGetJson } from "../../host";
import { AUTH_COOKIE_KEY, AUTH_REFS_KEY, BFE_ID_KEY, DEFAULT_SITE } from "../shared/constants";
import { asRecord, asText } from "../shared/text";
import type { AuthProfileLike } from "../shared/types";

export interface CookieContext {
  cookies?: string;
}

export function cookieHeaderFromNetscape(raw: unknown): string {
  const lines = asText(raw).split(/\r?\n/);
  const pairs: string[] = [];
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    // Netscape 导出文件会用 `#HttpOnly_` 前缀标记 HttpOnly cookie，它不是注释行。
    if (line.indexOf("#HttpOnly_") === 0) line = line.slice("#HttpOnly_".length);
    else if (line[0] === "#") continue;
    const fields = line.split("\t");
    if (fields.length >= 7 && fields[5]) {
      pairs.push(fields[5] + "=" + fields.slice(6).join("\t"));
    }
  }
  return pairs.join("; ");
}

export function cookieHeader(raw: unknown): string {
  const value = asText(raw).trim();
  if (!value) return "";
  if (/^#\s*(Netscape|HTTP Cookie File)/i.test(value) || /\t/.test(value)) {
    return cookieHeaderFromNetscape(value);
  }
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Bilibili expects SESSDATA's `%2C` / `%2A` escapes to stay encoded. */
export function normalizeSessdataCookie(cookie: unknown): string {
  return asText(cookie).replace(/(^|;\s*)SESSDATA=([^;]*)/i, (_match, prefix: string, value: string) => {
    return prefix + "SESSDATA=" + asText(value).replace(/,/g, "%2C").replace(/\*/g, "%2A");
  });
}

/** `name` is always an internal constant, never user input. */
export function cookieContains(cookie: unknown, name: string): boolean {
  const target = String(name).toLowerCase();
  for (const part of asText(cookie).split(";")) {
    const separator = part.indexOf("=");
    const key = (separator >= 0 ? part.slice(0, separator) : part).trim().toLowerCase();
    if (key === target) return true;
  }
  return false;
}

export async function appendStoredBfeId(host: PluginHost, cookie: string): Promise<string> {
  const value = asText(cookie).trim();
  if (!value || cookieContains(value, "bfe_id")) return value;
  try {
    const bfeId = await host.storage.get(BFE_ID_KEY);
    if (bfeId) return value + "; bfe_id=" + asText(bfeId).trim();
  } catch {
    // 忽略失败：不影响主流程
  }
  return value;
}

export async function cookieFromAuthProfile(host: PluginHost): Promise<string> {
  if (!host.auth || typeof host.auth.get !== "function") return "";
  const refs = await storageGetJson<unknown>(host, AUTH_REFS_KEY);
  let list: string[] = [];
  if (Array.isArray(refs)) {
    list = refs.filter((ref): ref is string => typeof ref === "string" && ref !== "");
  }
  if (!list.length) list.push(host.info.identity + "::" + DEFAULT_SITE);
  for (const ref of list) {
    try {
      const profile = asRecord(await host.auth.get(ref)) as AuthProfileLike;
      const profileCookie = cookieHeader(profile && profile.cookies);
      if (cookieContains(profileCookie, "SESSDATA")) return profileCookie;
    } catch {
      // 忽略失败：不影响主流程
    }
  }
  return "";
}

/**
 * Explicit input wins over cached state. The first resolve stores the normalised
 * cookie so later tasks can reuse it without user action.
 */
export async function effectiveCookie(
  host: PluginHost,
  ctx?: CookieContext | null,
): Promise<string> {
  let raw = asText(ctx && ctx.cookies).trim();
  if (!raw) raw = asText(host.settings.cookies).trim();
  const cookie = normalizeSessdataCookie(cookieHeader(raw));

  if (cookie) {
    try {
      const previous = await host.storage.get(AUTH_COOKIE_KEY);
      if (previous !== cookie) await host.storage.set(AUTH_COOKIE_KEY, cookie);
    } catch {
      // 忽略失败：不影响主流程
    }
    return await appendStoredBfeId(host, cookie);
  }

  const reuse = host.settings.reuseStoredSession;
  const reuseStored = reuse === null || reuse === undefined ? true : !/^(false|0)$/i.test(String(reuse));
  if (reuseStored) {
    try {
      const stored = await host.storage.get(AUTH_COOKIE_KEY);
      if (stored) return await appendStoredBfeId(host, String(stored));
    } catch {
      // 忽略失败：不影响主流程
    }
    const profileCookie = await cookieFromAuthProfile(host);
    if (profileCookie) {
      try {
        await host.storage.set(AUTH_COOKIE_KEY, profileCookie);
      } catch {
        // 忽略失败：不影响主流程
      }
      return await appendStoredBfeId(host, profileCookie);
    }
  }
  return "";
}
