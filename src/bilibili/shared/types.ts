// 我们实际用到的 Bilibili Web 接口的宽松类型。所有字段都故意可选：
// 接口少字段、改字段名都只当作数据缺失处理，不让整个解析失败。

export interface DashStream {
  id?: number;
  quality?: number;
  height?: number;
  height_cm?: number;
  width?: number;
  codecs?: string;
  codecs_name?: string;
  bandwidth?: number;
  size?: number;
  filesize?: number;
  filesize_approx?: number;
  base_url?: string;
  baseUrl?: string;
  url?: string;
  backup_url?: string[] | string;
  backupUrl?: string[] | string;
}

export interface DashInfo {
  /** 秒；部分接口只给 play.timelength，所以两者都要看。 */
  duration?: number;
  video?: DashStream[];
  audio?: DashStream[];
}

export interface DurlPart {
  url?: string;
  size?: number;
  quality?: number;
}

export interface DurlEntry {
  quality?: number;
  durl?: DurlPart[];
}

export interface SupportFormat {
  quality?: number;
  quality_id?: number;
  format?: string;
  new_description?: string;
  description?: string;
  display_desc?: string;
}

export interface PlayResult {
  code?: number | string;
  dash?: DashInfo;
  durl?: DurlPart[] | DurlPart;
  durls?: DurlEntry[];
  quality?: number;
  timelength?: number;
  format?: string;
  support_formats?: SupportFormat[];
  accept_quality?: Array<number | string>;
}

export interface RawEpisode {
  id?: number | string;
  ep_id?: number | string;
  bvid?: string;
  bv_id?: string;
  cid?: number | string;
  index_show?: string;
  title?: string;
  long_title?: string;
  show_title?: string;
  share_copy?: string;
  badge?: string;
  badge_info?: { text?: string };
  section_type?: number;
  sectionType?: number;
  pub_time?: number | string;
  pubTime?: number | string;
  publish_time?: number | string;
}

export interface RawSection {
  title?: string;
  episodes?: RawEpisode[];
}

export interface SeasonResult {
  season_id?: number | string;
  title?: string;
  season_title?: string;
  episodes?: RawEpisode[];
  section?: RawSection[];
  media?: { season_id?: number | string };
}

export interface WbiImage {
  img_url?: string;
  sub_url?: string;
}

export interface NavPayload {
  data?: {
    isLogin?: boolean;
    wbi_img?: WbiImage;
  };
}

export interface SpaceVideoRaw {
  bvid?: string;
  BV?: string;
  aid?: number;
  title?: string;
  description?: string;
  pic?: string;
  created?: number;
  length?: string;
}

export interface SpaceArcListing {
  list?: { vlist?: SpaceVideoRaw[] };
  vlist?: SpaceVideoRaw[];
}

export interface SpaceCard {
  name?: string;
  uname?: string;
}

export interface AuthProfileLike {
  cookies?: string;
  site?: string;
  account?: string;
}

export interface LoginPayload {
  code?: number;
  message?: string;
  data?: {
    code?: number;
    message?: string;
    url?: string;
    redirectUrl?: string;
    goUrl?: string;
    qrcode_key?: string;
  };
}
