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
    addAccountTimeout: "等待瀏覽器登入完成逾時，請重試",
    browserOpenFailed: "無法開啟瀏覽器登入頁面",
    callbackFailedFormat: "登入失敗：%@",
    callbackMissingCode: "登入回調缺少授權碼",
    callbackServerStartFailed: "無法啟動本機登入回調服務",
    callbackStateMismatch: "登入回調驗證失敗，請重試",
    requestCancelled: "登入已取消",
    tokenExchangeFailedFormat: "登入權杖交換失敗：%@",
    workspaceMismatchFormat: "登入結果不屬於要求的工作區：%@"
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
    addAccountTimeout: "Le délai d'attente de la connexion dans le navigateur a expiré. Réessayez.",
    browserOpenFailed: "Impossible d'ouvrir la page de connexion dans le navigateur",
    callbackFailedFormat: "Connexion échouée : %@",
    callbackMissingCode: "Code d'autorisation manquant dans le rappel de connexion",
    callbackServerStartFailed: "Impossible de démarrer le service local de rappel de connexion",
    callbackStateMismatch: "La validation du rappel de connexion a échoué. Réessayez.",
    requestCancelled: "La connexion a été annulée",
    tokenExchangeFailedFormat: "Échange de jeton échoué : %@",
    workspaceMismatchFormat: "L'espace de travail connecté ne correspond pas à l'espace requis : %@"
  },
  de: {
    addAccountTimeout: "Zeitüberschreitung beim Warten auf die Browser-Anmeldung. Bitte erneut versuchen.",
    browserOpenFailed: "Die Browser-Anmeldeseite konnte nicht geöffnet werden",
    callbackFailedFormat: "Anmeldung fehlgeschlagen: %@",
    callbackMissingCode: "Autorisierungscode im Anmelde-Callback fehlt",
    callbackServerStartFailed: "Der lokale Anmelde-Callback-Dienst konnte nicht gestartet werden",
    callbackStateMismatch: "Validierung des Anmelde-Callbacks fehlgeschlagen. Bitte erneut versuchen.",
    requestCancelled: "Anmeldung wurde abgebrochen",
    tokenExchangeFailedFormat: "Token-Austausch fehlgeschlagen: %@",
    workspaceMismatchFormat: "Der angemeldete Arbeitsbereich entspricht nicht dem erforderlichen Arbeitsbereich: %@"
  },
  it: {
    addAccountTimeout: "Tempo scaduto in attesa del completamento dell'accesso nel browser. Riprova.",
    browserOpenFailed: "Impossibile aprire la pagina di accesso nel browser",
    callbackFailedFormat: "Accesso non riuscito: %@",
    callbackMissingCode: "Codice di autorizzazione mancante nel callback di accesso",
    callbackServerStartFailed: "Impossibile avviare il servizio locale di callback di accesso",
    callbackStateMismatch: "Validazione del callback di accesso non riuscita. Riprova.",
    requestCancelled: "Accesso annullato",
    tokenExchangeFailedFormat: "Scambio del token non riuscito: %@",
    workspaceMismatchFormat: "L'area di lavoro connessa non corrisponde a quella richiesta: %@"
  },
  es: {
    addAccountTimeout: "Se agotó el tiempo de espera para completar el inicio de sesión en el navegador. Inténtalo de nuevo.",
    browserOpenFailed: "No se pudo abrir la página de inicio de sesión en el navegador",
    callbackFailedFormat: "Error de inicio de sesión: %@",
    callbackMissingCode: "Falta el código de autorización en la devolución de llamada de inicio de sesión",
    callbackServerStartFailed: "No se pudo iniciar el servicio local de devolución de llamada de inicio de sesión",
    callbackStateMismatch: "Falló la validación de la devolución de llamada de inicio de sesión. Inténtalo de nuevo.",
    requestCancelled: "Inicio de sesión cancelado",
    tokenExchangeFailedFormat: "Error al intercambiar el token: %@",
    workspaceMismatchFormat: "El espacio de trabajo conectado no coincide con el espacio requerido: %@"
  },
  ru: {
    addAccountTimeout: "Время ожидания входа в браузере истекло. Повторите попытку.",
    browserOpenFailed: "Не удалось открыть страницу входа в браузере",
    callbackFailedFormat: "Ошибка входа: %@",
    callbackMissingCode: "В обратном вызове входа отсутствует код авторизации",
    callbackServerStartFailed: "Не удалось запустить локальную службу обратного вызова входа",
    callbackStateMismatch: "Проверка обратного вызова входа не удалась. Повторите попытку.",
    requestCancelled: "Вход отменен",
    tokenExchangeFailedFormat: "Не удалось обменять токен: %@",
    workspaceMismatchFormat: "Рабочая область входа не совпадает с требуемой рабочей областью: %@"
  },
  nl: {
    addAccountTimeout: "Time-out tijdens wachten op voltooien van aanmelden in de browser. Probeer het opnieuw.",
    browserOpenFailed: "Kan de aanmeldpagina in de browser niet openen",
    callbackFailedFormat: "Aanmelden mislukt: %@",
    callbackMissingCode: "Autorisatiecode ontbreekt in de aanmeldcallback",
    callbackServerStartFailed: "Kan de lokale aanmeldcallbackservice niet starten",
    callbackStateMismatch: "Validatie van de aanmeldcallback is mislukt. Probeer het opnieuw.",
    requestCancelled: "Aanmelden is geannuleerd",
    tokenExchangeFailedFormat: "Tokenuitwisseling mislukt: %@",
    workspaceMismatchFormat: "De aangemelde werkruimte komt niet overeen met de vereiste werkruimte: %@"
  }
} satisfies Record<AppLocaleID, Record<OAuthMessageKey, string>>;

export function oauthMessage(locale: string | undefined, key: OAuthMessageKey, replacement?: string): string {
  const resolvedLocale = locale ? resolveAppLocale(locale) : "en";
  const template = oauthMessages[resolvedLocale][key];
  return replacement === undefined ? template : template.replace("%@", replacement);
}
