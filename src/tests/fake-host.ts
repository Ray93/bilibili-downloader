// 单元测试用的假宿主：内存 storage、可配置 settings、可记录 remove 的 auth。
import type { FluxFetchResponse, FluxSettingsValues } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../host";

export interface FakeHostOptions {
  settings?: Record<string, unknown>;
  storage?: Map<string, string>;
  authProfiles?: Record<string, unknown>;
  /** 按 URL 路由的 fetch stub；不给则保持「未 stub」报错。 */
  fetch?: (url: string, headers: Record<string, string>) => FakeResponse;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** 构造 JSON 响应：body 会序列化成字符串，模拟宿主只给文本 body。 */
export function jsonResponse(body: unknown, status = 200): FakeResponse {
  return { status, body: JSON.stringify(body) };
}

export function htmlResponse(body: string, status = 200): FakeResponse {
  return { status, body };
}

export interface FakeHost extends PluginHost {
  store: Map<string, string>;
  removed: string[];
}

export function makeHost(options: FakeHostOptions = {}): FakeHost {
  const store = options.storage ?? new Map<string, string>();
  const profiles = options.authProfiles ?? {};
  const removed: string[] = [];
  const host: FakeHost = {
    store,
    removed,
    info: { identity: "fluxdown@bilibili-downloader", version: "0.1.0", appVersion: "0.1.64" },
    settings: (options.settings ?? {}) as FluxSettingsValues,
    storage: {
      async get(key: string): Promise<string | null> {
        return store.has(key) ? String(store.get(key)) : null;
      },
      async set(key: string, value: string): Promise<void> {
        store.set(key, value);
      },
    },
    auth: {
      async get(ref: string): Promise<unknown> {
        return profiles[ref];
      },
      async save(): Promise<string> {
        return "fluxdown@bilibili-downloader::api.bilibili.com";
      },
      async remove(ref: string): Promise<true> {
        removed.push(ref);
        return true;
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    async fetch(opts): Promise<FluxFetchResponse> {
      if (!options.fetch) throw new Error("fetch is not stubbed in this test");
      const response = options.fetch(opts.url, (opts.headers || {}) as Record<string, string>);
      const body = typeof response.body === "string" ? response.body : String(response.body ?? "");
      return {
        status: response.status ?? 200,
        headers: response.headers ?? {},
        body,
        truncated: false,
      };
    },
  };
  return host;
}
