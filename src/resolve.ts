import { defineResolver, defineSubscription } from "fluxdown-plugin-sdk/runtime";
import { resolveEpisode, resolveManifest } from "./bilibili/bangumi/resolve";
import { subscribe } from "./bilibili/subscribe";
import { isUploaderItem, isVideoUrl } from "./bilibili/shared/ids";
import { resolveUploaderVideo } from "./bilibili/uploader/resolve";
import { resolveVideoManifest } from "./bilibili/video/resolve";
import { hostFromFlux } from "./host";

// `resolve.js` 同时承载 resolver 与订阅 provider：manifest 的两个入口都指向这个 bundle。
// resolverItem 为空 = 第一段（链接 → 清单）；非空 = 第二段（分集/投稿 → 临时直链）。
defineResolver(async (ctx) => {
  const host = hostFromFlux(flux);
  if (isUploaderItem(ctx.resolverItem)) return await resolveUploaderVideo(host, ctx);
  if (ctx.resolverItem) return await resolveEpisode(host, ctx);
  // 第一段按链接形态分流：普通投稿视频 `/video/BV...`、`/video/av...` 走分P清单，
  // 其余（番剧播放页/媒体页）仍交给番剧解析。
  if (isVideoUrl(ctx.url)) return await resolveVideoManifest(host, ctx);
  return await resolveManifest(host, ctx);
});

defineSubscription(async (ctx) => {
  const host = hostFromFlux(flux);
  return await subscribe(host, ctx);
});
