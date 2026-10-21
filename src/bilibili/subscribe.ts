// 订阅 provider 的分发入口：番剧链接走番剧订阅，UP 主空间链接走投稿订阅。
// `resolve.js` 通过 `defineSubscription` 安装这里的 `subscribe`。

import type { SubscribeContext, SubscribeResult } from "fluxdown-plugin-sdk";
import type { PluginHost } from "../host";
import { subscribeBangumi } from "./bangumi/subscribe";
import { isUploaderUrl } from "./shared/ids";
import { subscribeUploader } from "./uploader/subscribe";

export async function subscribe(
  host: PluginHost,
  ctx: SubscribeContext,
): Promise<SubscribeResult> {
  return isUploaderUrl(ctx.url)
    ? await subscribeUploader(host, ctx)
    : await subscribeBangumi(host, ctx);
}
