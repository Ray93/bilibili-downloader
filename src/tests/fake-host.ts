// 单元测试用的假宿主：内存 storage、可配置 settings、可记录 remove 的 auth。
import type { FluxSettingsValues } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../host";

export interface FakeHostOptions {
  settings?: Record<string, unknown>;
  storage?: Map<string, string>;
  authProfiles?: Record<string, unknown>;
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
    async fetch(): Promise<never> {
      throw new Error("fetch is not stubbed in this test");
    },
  };
  return host;
}
