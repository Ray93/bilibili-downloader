// 画质变体构造与选择：排序、编码偏好、16 条上限、按高度/画质码匹配。
import { describe, expect, it } from "vitest";
import {
  buildManifestVariantsFromPlay,
  buildVariantsFromPlay,
  chooseDashIndex,
  chooseVariantIndex,
  pickAudioTrack,
  playDurationMs,
  selectListedQualityVariants,
  streamBytes,
  variantQualityTag,
  videoHeight,
  videoQualityLabel,
  type Variant,
} from "../bilibili/media/quality";
import type { DashStream, PlayResult } from "../bilibili/shared/types";

const audioStream: DashStream = {
  id: 30280,
  bandwidth: 192000,
  base_url: "https://cdn/audio.m4s",
  size: 1000,
};

function videoStream(
  quality: number,
  height: number,
  codecs = "avc1.640028",
  bandwidth = 1000,
): DashStream {
  return {
    id: quality,
    height,
    width: 1920,
    codecs,
    bandwidth,
    base_url: "https://cdn/" + quality + "-" + codecs + ".m4s",
    size: 2000,
  };
}

function playWith(videos: DashStream[], audios: DashStream[] = [audioStream]): PlayResult {
  return { dash: { video: videos, audio: audios } };
}

function variant(qualityId: number, height: number, label = height + "p"): Variant {
  return {
    label,
    url: "https://cdn/" + qualityId + ".m4s",
    fileName: "x.mp4",
    qualityId,
    totalBytes: 1000,
    bandwidth: 100,
    width: 1920,
    height,
    container: "mp4",
  };
}

describe("videoHeight", () => {
  it("prefers the reported height", () => {
    expect(videoHeight({ height: 720, id: 80 })).toBe(720);
  });

  it("falls back to the quality-code table", () => {
    expect(videoHeight({ id: 120 })).toBe(2160);
    expect(videoHeight({ id: 80 })).toBe(1080);
    expect(videoHeight({ id: 999 })).toBe(0);
  });
});

describe("quality labels", () => {
  it("uses the support_formats description", () => {
    const play: PlayResult = { support_formats: [{ quality: 80, new_description: "1080P 高清" }] };
    expect(videoQualityLabel({ id: 80 }, 1080, play)).toBe("1080p 高清");
  });

  it("appends the quality code when no description exists", () => {
    expect(videoQualityLabel({ id: 80 }, 1080, {})).toBe("1080p [qn80]");
  });

  it("builds a file-name tag without the resolution prefix", () => {
    expect(variantQualityTag({ label: "1080p 高清", qualityId: 80, height: 1080 })).toBe(
      "1080p-高清",
    );
    expect(variantQualityTag({ label: "1080p", qualityId: 0, height: 0 })).toBe(
      "unknown-quality",
    );
  });
});

describe("stream size", () => {
  function sizedless(id: number, height: number, bandwidth: number): DashStream {
    return {
      id,
      height,
      width: 1920,
      codecs: "avc1.640028",
      bandwidth,
      base_url: "https://cdn/" + id + ".m4s",
    };
  }

  it("prefers an explicit size from the API", () => {
    expect(streamBytes({ size: 1234, bandwidth: 999 }, 1000)).toBe(1234);
  });

  it("estimates from bandwidth and duration when size is missing", () => {
    // 1 000 000 bit/s × 8 s / 8 = 1 000 000 bytes
    expect(streamBytes(sizedless(80, 1080, 1000000), 8000)).toBe(1000000);
    expect(streamBytes(sizedless(80, 1080, 1000000), 0)).toBe(0);
    expect(streamBytes(undefined, 8000)).toBe(0);
  });

  it("reads the duration from timelength or dash.duration", () => {
    expect(playDurationMs({ timelength: 1262680 })).toBe(1262680);
    expect(playDurationMs({ dash: { duration: 1263 } })).toBe(1263000);
    expect(playDurationMs({})).toBe(0);
    expect(playDurationMs(null)).toBe(0);
  });

  it("fills variant sizes when playurl omits them", () => {
    const play: PlayResult = {
      timelength: 8000,
      dash: {
        duration: 8,
        video: [sizedless(80, 1080, 1000000)],
        audio: [sizedless(30280, 0, 192000)],
      },
    };
    const variants = buildVariantsFromPlay(play, "t");
    expect(variants[0].totalBytes).toBe(1000000 + 192000);
    expect(variants[variants.length - 1].totalBytes).toBe(192000);
  });
});

describe("buildVariantsFromPlay", () => {
  it("orders by height and appends an audio-only variant", () => {
    const variants = buildVariantsFromPlay(
      playWith([videoStream(64, 720), videoStream(80, 1080)]),
      "第1话",
    );
    expect(variants.map((item) => item.height)).toEqual([1080, 720, 0]);
    expect(variants[2].label).toBe("Audio only (m4a)");
    expect(variants[2].fileName).toBe("第1话 [audio].m4a");
    expect(variants[0].totalBytes).toBe(3000);
  });

  it("prefers AVC for the same quality id", () => {
    const variants = buildVariantsFromPlay(
      playWith([videoStream(80, 1080, "hev1.1.6"), videoStream(80, 1080, "avc1.640028")]),
      "t",
    );
    expect(variants).toHaveLength(2);
    expect(variants[0].url).toContain("avc1");
  });

  it("falls back to durl when DASH is empty", () => {
    const play: PlayResult = {
      durl: [{ url: "https://cdn/flv.flv", size: 500, quality: 32 }],
      quality: 32,
      timelength: 1000,
      format: "flv",
    };
    const variants = buildVariantsFromPlay(play, "t");
    expect(variants).toHaveLength(1);
    expect(variants[0].container).toBe("flv");
    expect(variants[0].height).toBe(480);
    expect(variants[0].fileName).toBe("t [480p].flv");
  });
});

describe("buildManifestVariantsFromPlay", () => {
  it("caps the list at 16 variants", () => {
    const videos: DashStream[] = [];
    for (let index = 0; index < 20; index += 1) {
      videos.push(videoStream(100 + index, 100 + index));
    }
    expect(buildManifestVariantsFromPlay(playWith(videos), "t")).toHaveLength(16);
  });
});

describe("variant selection", () => {
  const variants = [variant(80, 1080), variant(64, 720), variant(32, 480)];

  it("matches a numeric quality key", () => {
    expect(chooseVariantIndex(variants, "64")).toBe(1);
  });

  it("matches an h-prefixed height key", () => {
    expect(chooseVariantIndex(variants, "h480")).toBe(2);
    expect(chooseVariantIndex(variants, "h999")).toBe(-1);
  });

  it("keeps only the highest variant when asked", () => {
    expect(selectListedQualityVariants(variants, true)).toEqual([variants[0]]);
    expect(selectListedQualityVariants(variants, false)).toHaveLength(3);
  });

  it("selects by quality ceiling and audio-only", () => {
    expect(chooseDashIndex(variants, "best")).toBe(0);
    expect(chooseDashIndex(variants, "1080")).toBe(0);
    expect(chooseDashIndex(variants, "720")).toBe(1);
    expect(chooseDashIndex(variants, "480")).toBe(2);
    // 没有变体满足上限时，实现回退到第一个（最高）画质。
    expect(chooseDashIndex(variants, "360")).toBe(0);
    const withAudio = [variant(80, 1080), { ...variant(0, 0), label: "Audio only (m4a)" }];
    expect(chooseDashIndex(withAudio, "audio")).toBe(1);
  });
});

describe("pickAudioTrack", () => {
  it("chooses the highest-bandwidth playable track", () => {
    const picked = pickAudioTrack([
      { id: 30216, bandwidth: 64000, base_url: "https://cdn/low.m4s" },
      { id: 30280, bandwidth: 192000, base_url: "https://cdn/high.m4s" },
      { id: 30232, bandwidth: 128000 },
    ]);
    expect(picked && picked.id).toBe(30280);
  });
});
