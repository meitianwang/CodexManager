import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeFileAtomically(data: string | Buffer, destination: string): Promise<void> {
  const directory = dirname(destination);
  await mkdir(directory, { recursive: true });

  const temporaryPath = join(directory, `.${basename(destination)}.tmp-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, data, { mode: 0o600 });
    await setPrivatePermissions(temporaryPath);
    await rename(temporaryPath, destination);
    await setPrivatePermissions(destination);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function setPrivatePermissions(path: string): Promise<void> {
  await chmod(path, 0o600).catch(() => undefined);
}
