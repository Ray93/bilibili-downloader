// 文本/数值小工具，供各模块共用。故意不引用 `flux` 全局，
// 这样单元测试可以直接跑这些纯函数。

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asNumber(value: unknown): number {
  return Number(value) || 0;
}

export function asText(value: unknown): string {
  return value == null ? "" : String(value);
}

export function sanitizeFileName(name: unknown): string {
  const value = name ? String(name) : "video";
  return (
    value
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\.{2,}/g, ".")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "video"
  );
}

export function sanitizePath(name: unknown): string {
  return sanitizeFileName(name).replace(/\./g, " ").slice(0, 80).trim();
}

export function firstMatch(url: unknown, pattern: RegExp): string {
  const match = pattern.exec(url == null ? "" : String(url));
  return match && match[1] ? match[1] : "";
}

type TimerFn = (handler: () => void, ms?: number) => unknown;

/**
 * The plugin host's QuickJS prelude provides `setTimeout`, but it is not part of
 * the ES2022 lib types, so it is resolved through `globalThis` at call time.
 */
export function delay(ms: number): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    const globalScope = globalThis as unknown as { setTimeout?: TimerFn };
    if (typeof globalScope.setTimeout !== "function") {
      resolvePromise();
      return;
    }
    try {
      globalScope.setTimeout(() => resolvePromise(), ms);
    } catch {
      resolvePromise();
    }
  });
}
