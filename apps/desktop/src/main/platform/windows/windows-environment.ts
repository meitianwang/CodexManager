import { win32 } from "node:path";

export function environmentValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  return environment[Object.keys(environment).find((candidate) => candidate.toUpperCase() === key.toUpperCase()) ?? key];
}

export function userProfileDirectory(environment: NodeJS.ProcessEnv): string | undefined {
  const userProfile = environmentValue(environment, "USERPROFILE");
  if (userProfile) {
    return userProfile;
  }
  const homeDrive = environmentValue(environment, "HOMEDRIVE");
  const homePath = environmentValue(environment, "HOMEPATH");
  if (homeDrive && homePath) {
    return win32.join(homeDrive, homePath);
  }
  return undefined;
}

export function localAppDataDirectory(environment: NodeJS.ProcessEnv): string | undefined {
  const localAppData = environmentValue(environment, "LOCALAPPDATA");
  if (localAppData) {
    return localAppData;
  }
  const userProfile = userProfileDirectory(environment);
  return userProfile ? win32.join(userProfile, "AppData", "Local") : undefined;
}

export function roamingAppDataDirectory(environment: NodeJS.ProcessEnv): string | undefined {
  const appData = environmentValue(environment, "APPDATA");
  if (appData) {
    return appData;
  }
  const userProfile = userProfileDirectory(environment);
  return userProfile ? win32.join(userProfile, "AppData", "Roaming") : undefined;
}

export function programFilesDirectories(environment: NodeJS.ProcessEnv): string[] {
  return uniqueStrings([
    environmentValue(environment, "ProgramFiles"),
    environmentValue(environment, "ProgramFiles(x86)")
  ]);
}

export function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value.toLowerCase())) {
      continue;
    }
    seen.add(value.toLowerCase());
    unique.push(value);
  }
  return unique;
}
