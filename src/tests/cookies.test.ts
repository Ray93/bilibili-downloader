// Cookie 解析/归一化，以及「显式输入优先于缓存」的登录态选择规则。
import { describe, expect, it } from "vitest";
import {
  appendStoredBfeId,
  cookieContains,
  cookieHeader,
  cookieHeaderFromNetscape,
  effectiveCookie,
  normalizeSessdataCookie,
} from "../bilibili/http/cookies";
import { makeHost } from "./fake-host";

describe("cookieHeaderFromNetscape", () => {
  it("reads HttpOnly cookies and skips comments", () => {
    const raw = [
      "# Netscape HTTP Cookie File",
      ".bilibili.com\tTRUE\t/\tFALSE\t0\tbuvid3\tAAA",
      "#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tsec%2Cret",
      "# a plain comment",
    ].join("\n");
    expect(cookieHeaderFromNetscape(raw)).toBe("buvid3=AAA; SESSDATA=sec%2Cret");
  });

  it("keeps tab-separated value tails", () => {
    const raw = ".bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tab\tcd";
    expect(cookieHeaderFromNetscape(raw)).toBe("SESSDATA=ab\tcd");
  });
});

describe("cookieHeader", () => {
  it("passes a browser cookie header through", () => {
    expect(cookieHeader("SESSDATA=a; bili_jct=b")).toBe("SESSDATA=a; bili_jct=b");
  });

  it("collapses newlines in a pasted header", () => {
    expect(cookieHeader("a=1\nb=2")).toBe("a=1 b=2");
  });

  it("detects Netscape exports", () => {
    expect(cookieHeader("# Netscape HTTP Cookie File\n.bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tx")).toBe(
      "SESSDATA=x",
    );
  });
});

describe("normalizeSessdataCookie", () => {
  it("percent-encodes the characters Bilibili treats specially", () => {
    expect(normalizeSessdataCookie("SESSDATA=a,b*c; bili_jct=d")).toBe(
      "SESSDATA=a%2Cb%2Ac; bili_jct=d",
    );
  });
});

describe("cookieContains", () => {
  it("matches a full cookie name only", () => {
    expect(cookieContains("SESSDATA=x", "SESSDATA")).toBe(true);
    expect(cookieContains("a=1; sessdata=x", "SESSDATA")).toBe(true);
    expect(cookieContains("XSESSDATA=x", "SESSDATA")).toBe(false);
  });
});

describe("appendStoredBfeId", () => {
  it("appends a cached bfe_id once", async () => {
    const host = makeHost();
    host.store.set("auth.bfe_id", "bfe-1");
    expect(await appendStoredBfeId(host, "SESSDATA=x")).toBe("SESSDATA=x; bfe_id=bfe-1");
    expect(await appendStoredBfeId(host, "SESSDATA=x; bfe_id=bfe-1")).toBe(
      "SESSDATA=x; bfe_id=bfe-1",
    );
  });

  it("returns the cookie unchanged without a cache", async () => {
    const host = makeHost();
    expect(await appendStoredBfeId(host, "SESSDATA=x")).toBe("SESSDATA=x");
  });
});

describe("effectiveCookie", () => {
  it("prefers explicit input and caches the normalised value", async () => {
    const host = makeHost({ settings: { cookies: "SESSDATA=settings" } });
    const cookie = await effectiveCookie(host, { cookies: "SESSDATA=a,b" });
    expect(cookie).toBe("SESSDATA=a%2Cb");
    expect(host.store.get("auth.cookie")).toBe("SESSDATA=a%2Cb");
  });

  it("falls back to the settings cookie", async () => {
    const host = makeHost({ settings: { cookies: "SESSDATA=from-settings" } });
    expect(await effectiveCookie(host, { cookies: "" })).toBe("SESSDATA=from-settings");
  });

  it("reuses a cached cookie by default", async () => {
    const host = makeHost();
    host.store.set("auth.cookie", "SESSDATA=cached");
    expect(await effectiveCookie(host, null)).toBe("SESSDATA=cached");
  });

  it("skips cached state when reuse is disabled", async () => {
    const host = makeHost({ settings: { reuseStoredSession: false } });
    host.store.set("auth.cookie", "SESSDATA=cached");
    expect(await effectiveCookie(host, null)).toBe("");
  });

  it("reads the stored auth profile when no cookie is cached", async () => {
    const host = makeHost({
      authProfiles: {
        "fluxdown@bilibili-downloader::api.bilibili.com": { cookies: "SESSDATA=profile" },
      },
    });
    expect(await effectiveCookie(host, null)).toBe("SESSDATA=profile");
    expect(host.store.get("auth.cookie")).toBe("SESSDATA=profile");
  });
});
