import { describe, expect, it } from "vitest";
import { appLocales, type AppLocaleID } from "../src/shared/models/settings";
import { createTranslator, messageKeys, type MessageKey } from "../src/renderer/src/i18n";

type DesktopMessageContractCase = {
  expected: string;
  key: MessageKey;
  locale: AppLocaleID;
  values?: Record<string, string | number>;
};

const desktopMessageContractCases: readonly DesktopMessageContractCase[] = [
  { locale: "en", key: "accounts.action.sign_in", expected: "Add account" },
  { locale: "zh-Hans", key: "accounts.action.import_current", expected: "导入当前授权" },
  { locale: "zh-Hant", key: "accounts.card.switch_to_this", expected: "切換到此帳號" },
  { locale: "ja", key: "accounts.notice.switch_done_fallback", expected: "アカウントを切り替えました（codex app コマンド経由）" },
  { locale: "ko", key: "accounts.notice.editor_restarted_format", values: { editors: "cursor" }, expected: "재시작된 편집기: cursor" },
  { locale: "fr", key: "proxy.section.control", expected: "Contrôle du proxy" },
  { locale: "de", key: "settings.launch_at_startup", expected: "Beim Start öffnen" },
  { locale: "it", key: "proxy.copy_url", expected: "Copia URL" },
  { locale: "es", key: "accounts.notice.already_best", expected: "La cuenta actual ya es la mejor opción disponible" },
  { locale: "ru", key: "common.quit", expected: "Выйти" },
  { locale: "nl", key: "settings.section.switch_behavior", expected: "Schakelgedrag" }
];

describe("renderer i18n", () => {
  it("has non-empty messages for every supported locale and key", () => {
    for (const locale of appLocales) {
      const t = createTranslator(locale);
      for (const key of messageKeys) {
        expect(t(key).trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("localizes core navigation labels", () => {
    const t = createTranslator("zh-Hans");

    expect(t("tab.accounts")).toBe("账号");
    expect(t("accounts.action.warm_weekly_quota")).toBe("一键预热");
    expect(t("accounts.window.five_hour")).toBe("5h");
    expect(t("accounts.window.weekly")).toBe("1 周");
    expect(t("accounts.window.reset_header")).toBe("重置");
    expect(t("accounts.window.reset_at_format", { value: "2026-05-30" })).toBe("重置时间：2026-05-30");
    expect(t("settings.language")).toBe("语言");
    expect(t("language.japanese")).toBe("日本語");
    expect(t("proxy.section.models")).toBe("可用模型");
  });

  it("keeps representative desktop workflow messages stable across supported locales", () => {
    for (const { expected, key, locale, values } of desktopMessageContractCases) {
      expect(createTranslator(locale)(key, values), `${locale}:${key}`).toBe(expected);
    }
  });

  it("uses a stable desktop proxy API key label for every locale", () => {
    for (const locale of appLocales) {
      expect(createTranslator(locale)("proxy.api_key"), `${locale}:proxy.api_key`).toBe("API Key");
    }
  });
});
