// 插件宿主适配层：所有依赖宿主的模块都通过这里的 `PluginHost` 拿能力，
// 入口脚本只适配一次注入的 `flux` 门面；单元测试则构造假宿主，不加载 SDK 运行时。

import type {
  Flux,
  FluxAuth,
  FluxFetchOptions,
  FluxFetchResponse,
  FluxLogger,
  FluxSettingsValues,
} from "fluxdown-plugin-sdk";
import type { MainFlux } from "fluxdown-plugin-sdk";

export interface PluginHost {
  info: Flux["info"];
  settings: FluxSettingsValues;
  storage: Flux["storage"];
  auth?: FluxAuth;
  logger: FluxLogger;
  fetch(opts: FluxFetchOptions): Promise<FluxFetchResponse>;
}

/** 同时适配无状态入口的 `flux` 与常驻 `main` 的 `flux`（后者额外带 ui/commands 等）。 */
export function hostFromFlux(flux: Flux | MainFlux): PluginHost {
  return {
    info: flux.info,
    settings: flux.settings as FluxSettingsValues,
    storage: flux.storage,
    auth: flux.auth,
    logger: flux.logger,
    fetch: (opts) => flux.fetch(opts),
  };
}

/** 日志失败永远不能影响解析主流程。 */
export function pluginLog(
  host: PluginHost,
  level: "info" | "warn" | "error",
  ...args: unknown[]
): void {
  try {
    const logger = host.logger;
    const fn = logger && logger[level];
    if (typeof fn !== "function") return;
    fn.apply(logger, args);
  } catch {
    // 忽略失败：不影响主流程
  }
}

export function settingString(host: PluginHost, key: string, fallback: string): string {
  const value = host.settings[key];
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/**
 * 布尔设置：宿主通常给布尔值，但清单里的默认值是 "true"/"false" 字符串，
 * 两者都接受，避免字符串 "false" 被当成真值。
 */
export function settingBool(host: PluginHost, key: string, fallback: boolean): boolean {
  const value = host.settings[key];
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return fallback;
}

export async function storageGetJson<T>(host: PluginHost, key: string): Promise<T | null> {
  try {
    const raw = await host.storage.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function storageSetJson(
  host: PluginHost,
  key: string,
  value: unknown,
): Promise<void> {
  try {
    await host.storage.set(key, JSON.stringify(value));
  } catch {
    // 忽略失败：不影响主流程
  }
}
