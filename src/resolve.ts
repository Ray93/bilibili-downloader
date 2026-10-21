import { defineResolver, defineSubscription } from "fluxdown-plugin-sdk/runtime";
import { resolveEpisode, resolveManifest } from "./bilibili/bangumi/resolve";
import { subscribe } from "./bilibili/subscribe";
import { isUploaderItem } from "./bilibili/shared/ids";
import { resolveUploaderVideo } from "./bilibili/uploader/resolve";
import { hostFromFlux } from "./host";

// `resolve.js` 同时承载 resolver 与订阅 provider：manifest 的两个入口都指向这个 bundle。
// resolverItem 为空 = 第一段（番剧链接 → 清单）；非空 = 第二段（分集/投稿 → 临时直链）。
defineResolver(async (ctx) => {
  const host = hostFromFlux(flux);
  if (isUploaderItem(ctx.resolverItem)) return await resolveUploaderVideo(host, ctx);
  if (ctx.resolverItem) return await resolveEpisode(host, ctx);
  return await resolveManifest(host, ctx);
});

defineSubscription(async (ctx) => {
  const host = hostFromFlux(flux);
  return await subscribe(host, ctx);
});
