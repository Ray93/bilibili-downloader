// resolver、登录入口与状态面板共用的常量。
// 条目 id、设置键与订阅 guid 都是持久化契约：改这些值会让已保存的任务和现有订阅失效。

export const API_BASE = "https://api.bilibili.com";
export const PASSPORT_BASE = "https://passport.bilibili.com";
export const DEFAULT_SITE = "api.bilibili.com";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export const MAX_EPISODES = 1000;
export const MAX_VARIANTS = 16;
/** 单个投稿视频最多列出的分P数：/video/ 链接的清单上限。 */
export const MAX_VIDEO_PAGES = 100;
/** 分P很多时只为前 N 个分P探测画质，其余分P出无画质条目，避免超出解析超时。 */
export const MAX_VIDEO_QUALITY_PROBES = 24;
export const MAX_SUBSCRIPTION_EPISODES = 50;
export const UPLOADER_VIDEO_LIMIT = 20;

export const AUTH_COOKIE_KEY = "auth.cookie";
export const AUTH_REFS_KEY = "auth.refs";
export const BFE_ID_KEY = "auth.bfe_id";
export const WBI_CACHE_KEY = "bilibili.wbi.keys";
export const AUTH_SESSION_KEY = "bilibili.auth.session";

export const SUBSCRIPTION_PROVIDER_ID = "bilibili-bangumi";

/** DASH 一般会返回 height，但部分账号只返回画质码，这里是缺失时的回退表。 */
export const QUALITY_HEIGHT_BY_ID: Record<number, number> = {
  127: 4320, // 8K
  126: 1080, // 杜比视界
  125: 1080, // HDR
  120: 2160, // 4K
  116: 1080, // 1080P 60 帧
  112: 1080, // 1080P+
  80: 1080,
  74: 720,
  64: 720,
  32: 480,
  16: 360,
};

export const AUTH_COOKIE_NAMES = [
  "sid",
  "DedeUserID",
  "DedeUserID__ckMd5",
  "SESSDATA",
  "bili_jct",
  "buvid3",
  "buvid4",
  "ac_time_value",
] as const;
