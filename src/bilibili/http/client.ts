// Bilibili 接口传输层：公共请求头、JSON 信封解包、重试、bfe_id 捕获，
// 以及 playurl/nav 的诊断日志（用于排查「画质不全」与「登录态无效」）。

import type { FluxFetchResponse } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../../host";
import { pluginLog } from "../../host";
import { API_BASE, BFE_ID_KEY, USER_AGENT } from "../shared/constants";
import { cookieContains, effectiveCookie } from "./cookies";
import { asArray, asNumber, asRecord, asText, delay } from "../shared/text";
import type { NavPayload } from "../shared/types";

export interface RequestContext {
  cookies?: string;
  extraHeaders?: Record<string, string>;
  referrer?: string;
  userAgent?: string;
}

export function responseHeader(response: FluxFetchResponse | null | undefined, name: string): string {
  const headers = asRecord(response && response.headers);
  const target = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return asText(headers[key]);
  }
  return "";
}

export async function rememberResponseBfeId(
  host: PluginHost,
  response: FluxFetchResponse | null | undefined,
): Promise<void> {
  const setCookie = responseHeader(response, "set-cookie");
  const match = /(?:^|[;\n,]\s*)bfe_id=([^;\n,]+)/i.exec(setCookie);
  if (!match || !match[1]) return;
  try {
    await host.storage.set(BFE_ID_KEY, match[1].trim());
  } catch {
    // 忽略失败：不影响主流程
  }
}

export function requestHeaders(
  cookie: string,
  ctx?: RequestContext | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    Referer: "https://www.bilibili.com/",
    "User-Agent": USER_AGENT,
  };
  const taskHeaders = asRecord(ctx && ctx.extraHeaders);
  for (const key of Object.keys(taskHeaders)) {
    if (taskHeaders[key] != null) headers[key] = asText(taskHeaders[key]);
  }
  if (ctx && ctx.referrer) headers.Referer = asText(ctx.referrer);
  if (ctx && ctx.userAgent) headers["User-Agent"] = asText(ctx.userAgent);
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function playQualityDiagnostics(play: unknown): Record<string, unknown> {
  const value = asRecord(play);
  const dash = asRecord(value.dash);
  const videos = asArray(dash.video).map(asRecord);
  const formats = asArray(value.support_formats).map(asRecord);
  const acceptQuality = asArray(value.accept_quality).map((item) => Number(item) || item);
  const heights = videos
    .map((video) => ({
      id: asNumber(video.id ?? video.quality),
      height: asNumber(video.height ?? video.height_cm),
      width: asNumber(video.width),
      codec: asText(video.codecs ?? video.codecs_name),
    }))
    .filter((item) => item.id || item.height);
  heights.sort((a, b) => b.height - a.height || b.id - a.id);
  return {
    acceptQuality,
    supportFormats: formats.map((item) => ({
      quality: asNumber(item.quality ?? item.quality_id),
      format: asText(item.format ?? item.new_description ?? item.display_desc),
    })),
    dashVideo: heights.slice(0, 16),
    dashMaxHeight: heights.reduce((max, item) => Math.max(max, item.height), 0),
    durlQuality: asNumber(value.quality),
  };
}

function logAuthDiagnostics(
  host: PluginHost,
  source: string,
  cookie: string,
  payload: unknown,
): void {
  const data = asRecord(asRecord(payload).data) as NavPayload["data"];
  const wbi = asRecord(data && data.wbi_img);
  pluginLog(host, "info", "[bilibili] auth diagnostics", {
    source,
    hasSessdata: cookieContains(cookie, "SESSDATA"),
    isLogin: data && data.isLogin === true,
    hasWbiImage: Boolean(wbi.img_url && wbi.sub_url),
  });
}

interface RawPayload {
  payload: Record<string, unknown>;
  requestCookie: string;
  response: FluxFetchResponse;
}

async function requestPayload(
  host: PluginHost,
  path: string,
  ctx?: RequestContext | null,
  cookie?: string,
): Promise<RawPayload> {
  let response: FluxFetchResponse;
  const requestCookie = cookie || (await effectiveCookie(host, ctx));
  try {
    response = await host.fetch({
      method: "GET",
      url: API_BASE + path,
      headers: requestHeaders(requestCookie, ctx),
    });
  } catch (error) {
    throw new Error("Bilibili 接口请求失败: " + String(error));
  }
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error("Bilibili 接口 HTTP 状态异常: " + String(response && response.status));
  }
  let payload: unknown;
  try {
    payload = JSON.parse(asText(response.body));
  } catch (error) {
    throw new Error("Bilibili 接口返回非法 JSON: " + String(error));
  }
  return { payload: asRecord(payload), requestCookie, response };
}

/** Returns `payload.result` (PGC endpoints) or `payload.data` (everything else). */
export async function apiGet<T>(
  host: PluginHost,
  path: string,
  ctx?: RequestContext | null,
  cookie?: string,
): Promise<T> {
  const { payload, requestCookie, response } = await requestPayload(host, path, ctx, cookie);
  if (Number(payload.code) !== 0) {
    throw new Error(
      "Bilibili 接口错误 code=" +
        String(payload.code) +
        ": " +
        asText(payload.message || "unknown"),
    );
  }
  await rememberResponseBfeId(host, response);
  const result = asRecord(payload.result ?? payload.data ?? {});
  if (/\/playurl(?:\?|$)/.test(path)) {
    pluginLog(host, "info", "[bilibili] playurl diagnostics", {
      hasSessdata: cookieContains(requestCookie, "SESSDATA"),
      diagnostics: playQualityDiagnostics(result),
    });
  }
  return result as T;
}

/** Raw envelope, used by the WBI key lookup (the nav payload has no `data` unwrap). */
export async function apiGetPayload(
  host: PluginHost,
  path: string,
  ctx?: RequestContext | null,
  cookie?: string,
): Promise<Record<string, unknown>> {
  const { payload, requestCookie, response } = await requestPayload(host, path, ctx, cookie);
  await rememberResponseBfeId(host, response);
  if (/\/x\/web-interface\/nav(?:\?|$)/.test(path)) {
    logAuthDiagnostics(host, "nav", requestCookie, payload);
  }
  return payload;
}

export async function apiGetWithRetry<T>(
  host: PluginHost,
  path: string,
  ctx: RequestContext | null | undefined,
  cookie: string | undefined,
  attempts: number,
): Promise<T> {
  const limit = Number(attempts) || 3;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < limit; attempt += 1) {
    try {
      return await apiGet<T>(host, path, ctx, cookie);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < limit) await delay(500 + attempt * 1000);
    }
  }
  throw lastError || new Error("Bilibili 接口请求失败");
}
