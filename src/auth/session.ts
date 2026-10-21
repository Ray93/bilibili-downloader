// Bilibili 二维码登录（`authenticate` 入口）与状态面板共用的登录态工具。
// Cookie 只写入 auth 档案与 storage，从不打印到日志。

import type { AuthContext, AuthResult, FluxFetchOptions, FluxFetchResponse } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../host";
import { storageGetJson } from "../host";
import {
  AUTH_COOKIE_KEY,
  AUTH_COOKIE_NAMES,
  AUTH_REFS_KEY,
  AUTH_SESSION_KEY,
  DEFAULT_SITE,
  PASSPORT_BASE,
  USER_AGENT,
} from "../bilibili/shared/constants";
import { cookieContains } from "../bilibili/http/cookies";
import { responseHeader } from "../bilibili/http/client";
import { asRecord, asText } from "../bilibili/shared/text";
import type { AuthProfileLike } from "../bilibili/shared/types";

interface AuthSession {
  id?: string;
  kind?: string;
  qrcodeKey?: string;
  challenge?: string;
  cookie?: string;
  createdAt?: number;
  site?: string;
}

interface RequestOptions {
  headers?: Record<string, string>;
  body?: string;
  cookie?: string;
}

interface LoginRequestResult {
  response: FluxFetchResponse;
  payload: Record<string, unknown>;
}

export interface AuthStatusSnapshot {
  loggedIn: boolean;
  profileCount: number;
  refs: string[];
}

function jsonInput(raw: unknown): Record<string, unknown> {
  const text = asText(raw).trim();
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" ? asRecord(value) : { value: text };
  } catch {
    return { value: text };
  }
}

function randomId(prefix: string): string {
  const now = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0x7fffffff).toString(36);
  return prefix + "-" + now + "-" + random;
}

async function loadSession(host: PluginHost): Promise<AuthSession | null> {
  return await storageGetJson<AuthSession>(host, AUTH_SESSION_KEY);
}

async function saveSession(host: PluginHost, session: AuthSession): Promise<void> {
  try {
    await host.storage.set(AUTH_SESSION_KEY, JSON.stringify(session || {}));
  } catch {
    // 忽略失败：不影响主流程
  }
}

async function clearSession(host: PluginHost): Promise<void> {
  try {
    await host.storage.set(AUTH_SESSION_KEY, "");
  } catch {
    // 忽略失败：不影响主流程
  }
}

async function clearStored(host: PluginHost, key: string): Promise<void> {
  try {
    await host.storage.set(key, "");
  } catch {
    // 忽略失败：不影响主流程
  }
}

function headers(cookie: string): Record<string, string> {
  const result: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    Referer: "https://www.bilibili.com/",
    "User-Agent": USER_AGENT,
  };
  if (cookie) result.Cookie = cookie;
  return result;
}

async function request(
  host: PluginHost,
  method: string,
  url: string,
  options: RequestOptions,
): Promise<LoginRequestResult> {
  const opts = options || {};
  const fetchOptions: FluxFetchOptions = {
    method,
    url,
    headers: opts.headers || headers(opts.cookie || ""),
    body: opts.body,
  };
  const response = await host.fetch(fetchOptions);
  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(asText(response.body)));
  } catch {
    throw new Error("Bilibili 登录接口返回非法 JSON: HTTP " + String(response.status));
  }
  return { response, payload };
}

function decode(value: unknown): string {
  try {
    return decodeURIComponent(asText(value).replace(/\+/g, " "));
  } catch {
    return asText(value);
  }
}

/** Cookie header values keep their exact bytes, including SESSDATA's %2C/%2A. */
function decodeCookie(value: unknown): string {
  return asText(value).trim();
}

function cookieQueryValue(name: string, value: unknown): string {
  if (name.toLowerCase() === "sessdata") return asText(value).trim();
  return decode(value);
}

function cookieMap(cookie: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  const text = asText(cookie);
  for (const name of AUTH_COOKIE_NAMES) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp("(?:^|[;\n,]\\s*)" + escaped + "=([^;\n,]*)", "i").exec(text);
    if (match && match[1]) map[name] = decodeCookie(match[1].trim());
  }
  return map;
}

function mergeCookieParts(parts: unknown[]): string {
  const map: Record<string, string> = {};
  for (const part of parts) {
    const current = cookieMap(part);
    for (const name of Object.keys(current)) map[name] = current[name];
  }
  const output: string[] = [];
  for (const name of AUTH_COOKIE_NAMES) {
    if (map[name]) output.push(name + "=" + map[name]);
  }
  return output.join("; ");
}

function cookiesFromResult(result: LoginRequestResult, existing: string): string {
  const response = result.response;
  const payload = result.payload;
  const data = asRecord(payload.data);
  const parts: unknown[] = [existing, responseHeader(response, "set-cookie"), responseHeader(response, "cookie")];
  const urls = [data.url, data.redirectUrl, data.goUrl];
  for (const rawUrl of urls) {
    const url = asText(rawUrl);
    if (!url) continue;
    const query = /[?&]([^=#]+)=([^&#]*)/g;
    let match = query.exec(url);
    while (match !== null) {
      const key = decode(match[1]);
      for (const name of AUTH_COOKIE_NAMES) {
        if (key === name) parts.push(key + "=" + cookieQueryValue(key, match[2]));
      }
      match = query.exec(url);
    }
  }
  return mergeCookieParts(parts);
}

function apiError(payload: Record<string, unknown>): number {
  const nested = Number(asRecord(payload.data).code);
  const topLevel = Number(payload.code);
  // 二维码轮询接口的外层 code 恒为 0，真正的扫码状态在 data.code。
  return nested || topLevel || 0;
}

function resultError(payload: Record<string, unknown>): string {
  const message = asText(asRecord(payload.data).message) || asText(payload.message) || "unknown";
  return "Bilibili 登录失败 code=" + String(apiError(payload)) + ": " + message;
}

function successResult(sessionId: string, authRef: string | null): AuthResult {
  return {
    status: "success",
    sessionId: sessionId || "",
    authRef: authRef || undefined,
    message: "Bilibili 登录成功，认证状态已保存，后续解析会自动复用。",
  };
}

function pendingResult(
  session: AuthSession,
  challenge: string,
  message: string,
  type: string,
): AuthResult {
  return {
    status: "pending",
    sessionId: asText(session.id),
    challenge: challenge || undefined,
    challengeType: type || session.kind,
    message: message || "请完成验证后继续。",
  };
}

async function saveAuth(
  host: PluginHost,
  cookie: string,
  account: { site?: string; username?: string },
): Promise<string> {
  if (!cookie) throw new Error("Bilibili 登录成功但未取得 Cookie，请重新扫码");
  if (!cookieContains(cookie, "SESSDATA")) {
    throw new Error("Bilibili 登录成功但未取得 SESSDATA，请重新扫码");
  }
  if (!host.auth) throw new Error("登录成功，但 FD 未能保存 Bilibili 认证档案");

  const sites = [DEFAULT_SITE, "passport.bilibili.com", "www.bilibili.com"];
  const requested = asText(account && account.site).trim();
  if (requested) sites.unshift(requested);
  const uniqueSites: string[] = [];
  for (const site of sites) {
    if (uniqueSites.indexOf(site) < 0) uniqueSites.push(site);
  }

  const refs: string[] = [];
  for (const site of uniqueSites) {
    try {
      const authRef = await host.auth.save({
        site,
        kind: "cookie",
        account: asText(account && account.username),
        cookies: cookie,
        refreshToken: "",
        metadata: { provider: "bilibili", login: "qrcode" },
      });
      refs.push(asText(authRef));
    } catch {
      // 单个站点保存失败不应阻塞其他站点。
    }
  }
  if (!refs.length) throw new Error("登录成功，但 FD 未能保存 Bilibili 认证档案");
  try {
    await host.storage.set(AUTH_REFS_KEY, JSON.stringify(refs));
  } catch {
    // 忽略失败：不影响主流程
  }
  // 兼容早期版本：它们只写缓存 Cookie，没有 auth.refs。
  try {
    await host.storage.set(AUTH_COOKIE_KEY, cookie);
  } catch {
    // 忽略失败：不影响主流程
  }
  return refs[0];
}

async function authRefs(host: PluginHost): Promise<string[]> {
  const raw = await storageGetJson<unknown>(host, AUTH_REFS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((ref): ref is string => typeof ref === "string" && ref !== "");
}

export async function readAuthStatus(host: PluginHost): Promise<AuthStatusSnapshot> {
  const refs = await authRefs(host);
  let profileCount = 0;
  if (host.auth) {
    for (const ref of refs) {
      try {
        const profile = asRecord(await host.auth.get(ref)) as AuthProfileLike;
        if (cookieContains(profile.cookies, "SESSDATA")) profileCount += 1;
      } catch {
        // 忽略失败：不影响主流程
      }
    }
  }
  if (!profileCount) {
    try {
      const legacy = await host.storage.get(AUTH_COOKIE_KEY);
      if (legacy && cookieContains(legacy, "SESSDATA")) profileCount = 1;
    } catch {
      // 忽略失败：不影响主流程
    }
  }
  return { loggedIn: profileCount > 0, profileCount, refs };
}

export async function clearAuthProfiles(host: PluginHost, extraRef?: string): Promise<void> {
  const refs = await authRefs(host);
  if (extraRef && refs.indexOf(extraRef) < 0) refs.push(extraRef);
  if (host.auth) {
    for (const ref of refs) {
      if (!ref) continue;
      try {
        await host.auth.remove(ref);
      } catch {
        // 忽略失败：不影响主流程
      }
    }
  }
  await clearStored(host, AUTH_REFS_KEY);
  await clearStored(host, AUTH_COOKIE_KEY);
  await clearSession(host);
}

async function logoutAuth(host: PluginHost, authRef: string): Promise<AuthResult> {
  await clearAuthProfiles(host, authRef);
  return {
    status: "success",
    sessionId: "",
    authRef: undefined,
    message: "Bilibili 已注销，认证状态已清除。",
  };
}

async function statusAuth(host: PluginHost): Promise<AuthResult> {
  const session = await loadSession(host);
  if (session && session.kind === "qrcode" && session.challenge) {
    return pendingResult(
      session,
      session.challenge,
      "请用 Bilibili App 扫描上面的二维码；系统会自动检查登录状态。",
      "qrcode",
    );
  }

  let refs = await authRefs(host);
  // 兼容早期版本：只存了归一化 Cookie，没有 auth.refs。
  if (!refs.length) {
    try {
      const cookie = await host.storage.get(AUTH_COOKIE_KEY);
      if (cookie) refs = [host.info.identity + "::" + DEFAULT_SITE];
    } catch {
      // 忽略失败：不影响主流程
    }
  }

  for (const ref of refs) {
    if (!ref || !host.auth) continue;
    try {
      const profile = asRecord(await host.auth.get(ref)) as AuthProfileLike;
      if (cookieContains(profile.cookies, "SESSDATA")) return successResult("", ref);
    } catch {
      // 忽略失败：不影响主流程
    }
  }

  // 未登录不是异常：UI 会据此展示二维码登录入口。
  return { status: "error", sessionId: "", message: "" };
}

async function beginQr(host: PluginHost, ctx: AuthContext): Promise<AuthResult> {
  const result = await request(host, "GET", PASSPORT_BASE + "/x/passport-login/web/qrcode/generate", {});
  if (apiError(result.payload) !== 0 || !result.payload.data) throw new Error(resultError(result.payload));
  const data = asRecord(result.payload.data);
  const session: AuthSession = {
    id: randomId("qr"),
    kind: "qrcode",
    qrcodeKey: asText(data.qrcode_key),
    challenge: asText(data.url),
    cookie: cookiesFromResult(result, ""),
    createdAt: Date.now(),
    site: ctx.site || DEFAULT_SITE,
  };
  if (!session.qrcodeKey || !session.challenge) throw new Error("Bilibili 未返回有效二维码");
  await saveSession(host, session);
  return pendingResult(
    session,
    asText(session.challenge),
    "请用 Bilibili App 扫描上面的二维码；系统会自动检查登录状态。",
    "qrcode",
  );
}

async function pollQr(host: PluginHost, session: AuthSession): Promise<AuthResult> {
  const result = await request(
    host,
    "GET",
    PASSPORT_BASE +
      "/x/passport-login/web/qrcode/poll?qrcode_key=" +
      encodeURIComponent(asText(session.qrcodeKey)),
    { cookie: session.cookie || "" },
  );
  const code = apiError(result.payload);
  if (code === 86101 || code === 86090) {
    session.cookie = cookiesFromResult(result, session.cookie || "");
    await saveSession(host, session);
    return pendingResult(
      session,
      asText(session.challenge),
      code === 86090 ? "已扫描，请在 Bilibili App 确认登录。" : "等待扫码确认。",
      "qrcode",
    );
  }
  if (code === 86038) {
    await clearSession(host);
    return { status: "error", sessionId: "", message: "二维码已过期，请重新开始二维码登录。" };
  }
  if (code !== 0) throw new Error(resultError(result.payload));
  const cookie = cookiesFromResult(result, session.cookie || "");
  const authRef = await saveAuth(host, cookie, { site: asText(session.site), username: "" });
  await clearSession(host);
  return successResult(asText(session.id), authRef);
}

function unknownSessionResult(sessionId: string): AuthResult {
  return {
    status: "error",
    sessionId,
    message: "当前仅支持二维码登录，请重新开始。",
  };
}

export async function authenticate(host: PluginHost, ctx: AuthContext): Promise<AuthResult> {
  const input = jsonInput(ctx && ctx.input);
  if (ctx && ctx.action === "status") return await statusAuth(host);
  if (ctx && ctx.action === "logout") return await logoutAuth(host, asText(ctx.authRef));
  if (ctx && ctx.action === "cancel") {
    await clearSession(host);
    return {
      status: "error",
      sessionId: asText(ctx.sessionId),
      message: "已取消 Bilibili 登录。",
    };
  }
  if (ctx && ctx.action === "begin") {
    const mode = (asText(input.mode) || asText(input.value)).toLowerCase();
    if (!mode || mode === "qr" || mode === "qrcode" || mode === "二维码") {
      return await beginQr(host, ctx);
    }
    return {
      status: "error",
      sessionId: "",
      message: "当前仅支持二维码登录，请使用二维码登录。",
    };
  }

  const session = await loadSession(host);
  if (!session || (ctx && ctx.sessionId && session.id !== ctx.sessionId)) {
    throw new Error("Bilibili 登录会话不存在或已过期，请重新开始。");
  }
  if (session.kind !== "qrcode") {
    await clearSession(host);
    return unknownSessionResult(asText(session.id));
  }
  return await pollQr(host, session);
}
