import { describe, expect, it } from "vitest";
import { appLocales } from "../src/shared/models/settings";
import { createTranslator, messageKeys, type MessageKey } from "../src/renderer/src/i18n";

const windowsParityLocalizedKeys: MessageKey[] = [
  "accounts.action.import_package",
  "accounts.action.export",
  "accounts.notice.exported_format",
  "accounts.notice.imported_accounts_format",
  "proxy.api_key.regenerate",
  "proxy.endpoint.messages",
  "settings.auto_start_proxy"
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

  it("does not leave Windows parity labels in English for non-English locales", () => {
    const english = createTranslator("en");

    for (const locale of appLocales.filter((candidate) => candidate !== "en")) {
      const t = createTranslator(locale);
      for (const key of windowsParityLocalizedKeys) {
        expect(t(key), `${locale}:${key}`).not.toBe(english(key));
      }
    }
  });
});
