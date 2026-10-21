import { defineMain } from "fluxdown-plugin-sdk/runtime";
import type { ViewEvent } from "fluxdown-plugin-sdk";
import { clearAuthProfiles, readAuthStatus } from "./auth/session";
import { hostFromFlux, settingBool, settingString, type PluginHost } from "./host";

type AuthState = "logged-in" | "logged-out" | "unknown";

interface State {
  auth: AuthState;
  profileCount: number;
  quality: string;
  includeExtras: boolean;
  highestQualityOnly: boolean;
  reuseStoredSession: boolean;
  message: string;
}

type AuthFields = Pick<State, "auth" | "profileCount">;
type SettingFields = Pick<
  State,
  "quality" | "includeExtras" | "highestQualityOnly" | "reuseStoredSession"
>;

const QUALITY_OPTIONS = [
  { value: "best", label: "最佳画质" },
  { value: "2160", label: "不超过 2160p" },
  { value: "1440", label: "不超过 1440p" },
  { value: "1080", label: "不超过 1080p" },
  { value: "720", label: "不超过 720p" },
  { value: "480", label: "不超过 480p" },
  { value: "audio", label: "仅音频" },
];

function lastSegment(node: string): string {
  const parts = node.split("/");
  return parts[parts.length - 1] || "";
}

function readSettings(host: PluginHost): SettingFields {
  return {
    quality: settingString(host, "quality", "best"),
    includeExtras: settingBool(host, "includeExtras", false),
    highestQualityOnly: settingBool(host, "highestQualityOnly", false),
    reuseStoredSession: settingBool(host, "reuseStoredSession", true),
  };
}

async function readAuth(host: PluginHost): Promise<AuthFields> {
  if (!host.auth) return { auth: "unknown", profileCount: 0 };
  const status = await readAuthStatus(host);
  return {
    auth: status.loggedIn ? "logged-in" : "logged-out",
    profileCount: status.profileCount,
  };
}

defineMain((flux) => {
  // `flux.settings` 可能是脚本求值时的快照，所以每次读取都重新适配一次门面，
  // 而不是在注册时缓存 `host`。
  const currentHost = (): PluginHost => hostFromFlux(flux);

  flux.ui.view<State>("dashboard", {
    init: async () => {
      const host = currentHost();
      return { ...readSettings(host), ...(await readAuth(host)), message: "" };
    },

    render: (state) => (
      <stack gap="md" padding="md">
        <heading text="Bilibili Downloader" />
        <section
          title="登录状态"
          description="登录入口在插件卡片的「认证/登录」，登录后可获取更高画质。"
        >
          <stack gap="sm">
            <stack direction="row" gap="sm" align="center">
              {state.auth === "logged-in" ? <badge text="已登录" tone="success" /> : null}
              {state.auth === "logged-out" ? <badge text="未登录" tone="warning" /> : null}
              {state.auth === "unknown" ? <badge text="无法读取登录状态" tone="muted" /> : null}
              {state.auth === "logged-in" ? (
                <text text={`${state.profileCount} 个认证档案`} size="sm" tone="muted" />
              ) : null}
            </stack>
            {state.auth === "logged-out" ? (
              <callout
                tone="info"
                text="在插件卡片的「认证/登录」中扫描二维码，或在设置中导入 Bilibili Cookie。"
              />
            ) : null}
            {state.auth === "unknown" ? (
              <callout tone="warning" text="插件缺少 auth 权限，无法读取或清除登录状态。" />
            ) : null}
            <stack direction="row" gap="sm">
              <button key="refresh" text="刷新状态" variant="outline" />
              <button
                key="logout"
                text="注销登录"
                variant="danger"
                disabled={state.auth !== "logged-in"}
              />
            </stack>
          </stack>
        </section>
        <section title="解析设置" description="与插件设置卡片共用同一份配置。">
          <stack gap="sm">
            <switch
              key="include-extras"
              label="包含番外与花絮"
              checked={state.includeExtras}
            />
            <switch
              key="highest-quality"
              label="优先最高画质"
              checked={state.highestQualityOnly}
            />
            <switch
              key="reuse-session"
              label="复用已保存登录态"
              checked={state.reuseStoredSession}
            />
            <select key="quality" options={QUALITY_OPTIONS} value={state.quality} />
          </stack>
        </section>
        {state.message ? <text text={state.message} size="xs" tone="muted" /> : null}
        <text
          text={`插件 ${flux.info.version} · 客户端 ${flux.info.appVersion}`}
          size="xs"
          tone="muted"
        />
      </stack>
    ),

    event: async (state, ev: ViewEvent) => {
      const action = lastSegment(ev.node);
      const host = currentHost();

      if (ev.type === "press" && action === "refresh") {
        Object.assign(state, await readAuth(host));
        state.message = "登录状态已刷新。";
        return;
      }

      if (ev.type === "press" && action === "logout") {
        try {
          await clearAuthProfiles(host);
          Object.assign(state, await readAuth(host));
          state.message = "已清除保存的 Bilibili 登录状态。";
          flux.ui.toast("success", "已注销 Bilibili 登录");
        } catch (error) {
          flux.ui.toast("error", "注销失败: " + String(error));
        }
        return;
      }

      if (ev.type !== "change") return;
      const enabled = ev.value === true || ev.value === "true";

      if (
        action === "include-extras" ||
        action === "highest-quality" ||
        action === "reuse-session"
      ) {
        const key =
          action === "include-extras"
            ? "includeExtras"
            : action === "highest-quality"
              ? "highestQualityOnly"
              : "reuseStoredSession";
        try {
          await flux.settings.update({ [key]: enabled ? "true" : "false" });
        } catch (error) {
          flux.ui.toast("error", "保存设置失败: " + String(error));
          return;
        }
        state[key] = enabled;
        state.message = "设置已保存。";
        return;
      }

      if (action === "quality") {
        const value = typeof ev.value === "string" ? ev.value : "";
        if (!QUALITY_OPTIONS.some((option) => option.value === value)) return;
        try {
          await flux.settings.update({ quality: value });
        } catch (error) {
          flux.ui.toast("error", "保存设置失败: " + String(error));
          return;
        }
        state.quality = value;
        state.message = "设置已保存。";
      }
    },
  });
});
