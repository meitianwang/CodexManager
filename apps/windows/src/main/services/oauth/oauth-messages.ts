import { resolveAppLocale, type AppLocaleID } from "../../../shared/models/settings";

const enOAuthMessages = {
  addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
  browserOpenFailed: "Failed to open the browser sign-in page",
  callbackFailedFormat: "Sign-in failed: %@",
  callbackMissingCode: "Missing authorization code in sign-in callback",
  callbackServerStartFailed: "Failed to start the local sign-in callback service",
  callbackStateMismatch: "Sign-in callback validation failed. Try again.",
  requestCancelled: "Sign-in was cancelled",
  tokenExchangeFailedFormat: "Token exchange failed: %@",
  workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
} as const;

export type OAuthMessageKey = keyof typeof enOAuthMessages;

const oauthMessages = {
  en: enOAuthMessages,
  "zh-Hans": {
    addAccountTimeout: "等待浏览器登录完成超时，请重试",
    browserOpenFailed: "无法打开浏览器登录页",
    callbackFailedFormat: "登录失败：%@",
    callbackMissingCode: "登录回调缺少授权码",
    callbackServerStartFailed: "无法启动本地登录回调服务",
    callbackStateMismatch: "登录回调校验失败，请重试",
    requestCancelled: "登录已取消",
    tokenExchangeFailedFormat: "登录令牌交换失败：%@",
    workspaceMismatchFormat: "登录结果不属于要求的工作区：%@"
  },
  "zh-Hant": {
    addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
    browserOpenFailed: "Failed to open the browser sign-in page",
    callbackFailedFormat: "Sign-in failed: %@",
    callbackMissingCode: "Missing authorization code in sign-in callback",
    callbackServerStartFailed: "Failed to start the local sign-in callback service",
    callbackStateMismatch: "Sign-in callback validation failed. Try again.",
    requestCancelled: "Sign-in was cancelled",
    tokenExchangeFailedFormat: "Token exchange failed: %@",
    workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
  },
  ja: {
    addAccountTimeout: "ブラウザでのサインイン待機がタイムアウトしました。再試行してください。",
    browserOpenFailed: "ブラウザのサインインページを開けませんでした",
    callbackFailedFormat: "サインインに失敗しました: %@",
    callbackMissingCode: "サインインコールバックに認可コードがありません",
    callbackServerStartFailed: "ローカルのサインインコールバックサービスを起動できませんでした",
    callbackStateMismatch: "サインインコールバックの検証に失敗しました。再試行してください。",
    requestCancelled: "サインインはキャンセルされました",
    tokenExchangeFailedFormat: "トークン交換に失敗しました: %@",
    workspaceMismatchFormat: "サインインしたワークスペースが要求されたワークスペースと一致しません: %@"
  },
  ko: {
    addAccountTimeout: "브라우저 로그인 대기 시간이 초과되었습니다. 다시 시도하세요.",
    browserOpenFailed: "브라우저 로그인 페이지를 열지 못했습니다",
    callbackFailedFormat: "로그인 실패: %@",
    callbackMissingCode: "로그인 콜백에 인증 코드가 없습니다",
    callbackServerStartFailed: "로컬 로그인 콜백 서비스를 시작하지 못했습니다",
    callbackStateMismatch: "로그인 콜백 검증에 실패했습니다. 다시 시도하세요.",
    requestCancelled: "로그인이 취소되었습니다",
    tokenExchangeFailedFormat: "토큰 교환 실패: %@",
    workspaceMismatchFormat: "로그인한 워크스페이스가 요구된 워크스페이스와 일치하지 않습니다: %@"
  },
  fr: {
    addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
    browserOpenFailed: "Failed to open the browser sign-in page",
    callbackFailedFormat: "Sign-in failed: %@",
    callbackMissingCode: "Missing authorization code in sign-in callback",
    callbackServerStartFailed: "Failed to start the local sign-in callback service",
    callbackStateMismatch: "Sign-in callback validation failed. Try again.",
    requestCancelled: "Sign-in was cancelled",
    tokenExchangeFailedFormat: "Token exchange failed: %@",
    workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
  },
  de: {
    addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
    browserOpenFailed: "Failed to open the browser sign-in page",
    callbackFailedFormat: "Sign-in failed: %@",
    callbackMissingCode: "Missing authorization code in sign-in callback",
    callbackServerStartFailed: "Failed to start the local sign-in callback service",
    callbackStateMismatch: "Sign-in callback validation failed. Try again.",
    requestCancelled: "Sign-in was cancelled",
    tokenExchangeFailedFormat: "Token exchange failed: %@",
    workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
  },
  it: {
    addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
    browserOpenFailed: "Failed to open the browser sign-in page",
    callbackFailedFormat: "Sign-in failed: %@",
    callbackMissingCode: "Missing authorization code in sign-in callback",
    callbackServerStartFailed: "Failed to start the local sign-in callback service",
    callbackStateMismatch: "Sign-in callback validation failed. Try again.",
    requestCancelled: "Sign-in was cancelled",
    tokenExchangeFailedFormat: "Token exchange failed: %@",
    workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
  },
  es: {
    addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
    browserOpenFailed: "Failed to open the browser sign-in page",
    callbackFailedFormat: "Sign-in failed: %@",
    callbackMissingCode: "Missing authorization code in sign-in callback",
    callbackServerStartFailed: "Failed to start the local sign-in callback service",
    callbackStateMismatch: "Sign-in callback validation failed. Try again.",
    requestCancelled: "Sign-in was cancelled",
    tokenExchangeFailedFormat: "Token exchange failed: %@",
    workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
  },
  ru: {
    addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
    browserOpenFailed: "Failed to open the browser sign-in page",
    callbackFailedFormat: "Sign-in failed: %@",
    callbackMissingCode: "Missing authorization code in sign-in callback",
    callbackServerStartFailed: "Failed to start the local sign-in callback service",
    callbackStateMismatch: "Sign-in callback validation failed. Try again.",
    requestCancelled: "Sign-in was cancelled",
    tokenExchangeFailedFormat: "Token exchange failed: %@",
    workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
  },
  nl: {
    addAccountTimeout: "Timed out waiting for browser sign-in to complete. Try again.",
    browserOpenFailed: "Failed to open the browser sign-in page",
    callbackFailedFormat: "Sign-in failed: %@",
    callbackMissingCode: "Missing authorization code in sign-in callback",
    callbackServerStartFailed: "Failed to start the local sign-in callback service",
    callbackStateMismatch: "Sign-in callback validation failed. Try again.",
    requestCancelled: "Sign-in was cancelled",
    tokenExchangeFailedFormat: "Token exchange failed: %@",
    workspaceMismatchFormat: "The signed-in workspace does not match the required workspace: %@"
  }
} satisfies Record<AppLocaleID, Record<OAuthMessageKey, string>>;

export function oauthMessage(locale: string | undefined, key: OAuthMessageKey, replacement?: string): string {
  const resolvedLocale = locale ? resolveAppLocale(locale) : "en";
  const template = oauthMessages[resolvedLocale][key];
  return replacement === undefined ? template : template.replace("%@", replacement);
}
