import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appLocales } from "../src/shared/models/settings";
import { createTranslator, messageKeys, type MessageKey } from "../src/renderer/src/i18n";

const sharedLabelParityKeys: Array<[MessageKey, string]> = [
  ["tab.accounts", "tab.accounts"],
  ["tab.proxy", "tab.proxy"],
  ["tab.settings", "tab.settings"],
  ["common.copy", "common.copy"],
  ["common.start", "common.start"],
  ["common.stop", "common.stop"],
  ["common.refresh", "common.refresh"],
  ["common.quit", "common.quit"],
  ["common.cancel", "common.cancel"],
  ["common.select_all", "common.select_all"],
  ["common.deselect_all", "common.deselect_all"],
  ["accounts.action.sign_in", "accounts.action.add_account"],
  ["accounts.action.import_current", "accounts.action.import_current_auth"],
  ["accounts.action.import_package", "accounts.action.import_backup"],
  ["accounts.action.warm_weekly_quota", "accounts.action.warm_up_weekly_quota"],
  ["accounts.action.smart_switch", "accounts.action.smart_switch"],
  ["accounts.action.export", "accounts.action.export_accounts"],
  ["accounts.action.view_grid", "accounts.action.view_grid"],
  ["accounts.action.view_list", "accounts.action.view_list"],
  ["accounts.action.collapse_all", "accounts.action.collapse_all"],
  ["accounts.action.expand_all", "accounts.action.expand_all"],
  ["accounts.transfer.export.title", "accounts.transfer.export.title"],
  ["accounts.transfer.import.title", "accounts.transfer.import.title"],
  ["accounts.transfer.account_count_format", "accounts.transfer.account_count_format"],
  ["accounts.transfer.export.action", "accounts.transfer.export.action"],
  ["accounts.transfer.import.action", "accounts.transfer.import.action"],
  ["accounts.empty.title", "accounts.empty.title"],
  ["accounts.empty.message", "accounts.empty.message.no_accounts"],
  ["accounts.card.current", "accounts.card.current"],
  ["accounts.card.team_alias", "accounts.card.team.set_name"],
  ["accounts.window.five_hour", "accounts.window.five_hour"],
  ["accounts.window.weekly", "accounts.window.one_week"],
  ["accounts.window.reset_header", "accounts.window.reset_header"],
  ["accounts.window.reset_at_format", "accounts.window.reset_at_format"],
  ["accounts.notice.imported_format", "accounts.notice.imported_format"],
  ["accounts.notice.imported_new_format", "accounts.notice.imported_new_format"],
  ["accounts.notice.exported_format", "accounts.notice.exported_format"],
  ["accounts.notice.usage_refreshed", "accounts.notice.usage_refreshed"],
  ["accounts.notice.accounts_refreshed", "accounts.notice.accounts_refreshed"],
  ["accounts.notice.account_deleted", "accounts.notice.account_deleted"],
  ["accounts.notice.team_name_updated", "accounts.notice.team_name_updated"],
  ["accounts.notice.no_switch_target", "accounts.notice.no_switch_target"],
  ["accounts.notice.smart_switched_prefix_format", "accounts.notice.smart_switched_prefix_format"],
  ["accounts.notice.switch_done", "accounts.notice.switch_done"],
  ["accounts.notice.switch_done_fallback", "accounts.notice.switch_done_fallback"],
  ["accounts.notice.editor_restart_failed_format", "accounts.notice.editor_restart_failed_format"],
  ["accounts.notice.editor_restarted_format", "accounts.notice.editor_restarted_format"],
  ["proxy.section.control", "proxy.section.control"],
  ["proxy.section.endpoints", "proxy.section.endpoints"],
  ["proxy.section.models", "proxy.section.models"],
  ["proxy.section.usage", "proxy.section.usage"],
  ["proxy.status.running", "proxy.status.running"],
  ["proxy.status.stopped", "proxy.status.stopped"],
  ["proxy.notice.started", "proxy.notice.started"],
  ["proxy.notice.stopped", "proxy.notice.stopped"],
  ["proxy.notice.url_copied", "proxy.notice.url_copied"],
  ["proxy.port", "proxy.port"],
  ["proxy.api_key.regenerate", "proxy.api_key.regenerate"],
  ["proxy.copy_url", "proxy.copy_url"],
  ["proxy.usage.curl_example", "proxy.usage.curl_example"],
  ["proxy.usage.config_hint", "proxy.usage.config_hint"],
  ["proxy.endpoint.chat_completions", "proxy.endpoint.chat_completions"],
  ["proxy.endpoint.responses", "proxy.endpoint.responses"],
  ["proxy.endpoint.messages", "proxy.endpoint.messages"],
  ["settings.section.general", "settings.section.general"],
  ["settings.launch_at_startup", "settings.launch_at_startup"],
  ["settings.auto_start_proxy", "settings.auto_start_proxy"],
  ["settings.section.switch_behavior", "settings.section.switch_behavior"],
  ["settings.launch_codex_after_switch", "settings.launch_codex_after_switch"],
  ["settings.auto_smart_switch", "settings.auto_smart_switch"],
  ["settings.restart_editors_on_switch", "settings.restart_editors_on_switch"],
  ["settings.editor_restart_target", "settings.editor_restart_target"],
  ["settings.notice.updated", "settings.notice.updated"],
  ["settings.notice.restart_target_updated", "settings.notice.restart_target_updated"],
  ["settings.star_on_github", "settings.star_on_github"],
  ["settings.section.language", "settings.section.language"],
  ["settings.language", "settings.language"]
];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

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

  it("keeps shared UI labels aligned with macOS localizations for every locale", () => {
    for (const locale of appLocales) {
      const macMessages = readMacLocalization(locale);
      const t = createTranslator(locale);

      for (const [windowsKey, macKey] of sharedLabelParityKeys) {
        expect(normalizePlaceholders(t(windowsKey)), `${locale}:${windowsKey}`).toBe(
          normalizePlaceholders(macMessages.get(macKey) ?? "")
        );
      }
    }
  });

  it("uses the macOS team-name placeholder wording for every locale", () => {
    for (const locale of appLocales) {
      const macMessages = readMacLocalization(locale);
      const expected = macMessages.get("accounts.card.team.set_name");
      expect(expected, `${locale}:macOS team-name localization`).toBeDefined();
      expect(createTranslator(locale)("accounts.card.team_alias"), `${locale}:accounts.card.team_alias`).toBe(expected);
    }
  });

  it("uses the macOS hard-coded proxy API key label for every locale", () => {
    expect(readSwiftSource("Sources/CodexManager/Features/Proxy/ProxyPageView.swift")).toContain('ProxyFormRow(title: "API Key")');

    for (const locale of appLocales) {
      expect(createTranslator(locale)("proxy.api_key"), `${locale}:proxy.api_key`).toBe("API Key");
    }
  });
});

function readSwiftSource(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function readMacLocalization(locale: string): Map<string, string> {
  const stringsPath = resolve(repositoryRoot, "Sources/CodexManager/Resources", `${locale}.lproj`, "Localizable.strings");
  const contents = readFileSync(stringsPath, "utf8");
  const messages = new Map<string, string>();
  const pattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)";/g;
  for (const match of contents.matchAll(pattern)) {
    messages.set(unescapeAppleString(match[1] ?? ""), unescapeAppleString(match[2] ?? ""));
  }
  return messages;
}

function unescapeAppleString(value: string): string {
  return value
    .replaceAll("\\\\", "\\")
    .replaceAll('\\"', '"')
    .replaceAll("\\n", "\n");
}

function normalizePlaceholders(value: string): string {
  return value
    .replaceAll("%@", "{value}")
    .replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "{value}");
}
