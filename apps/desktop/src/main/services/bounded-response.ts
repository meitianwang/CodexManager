const defaultLimitBytes = 8 * 1024;

export async function boundedResponseText(response: Response, limitBytes = defaultLimitBytes): Promise<string> {
  if (!response.body) {
    return trimToLimit(await response.text(), limitBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let collected = "";
  let totalBytes = 0;

  try {
    while (totalBytes < limitBytes) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }

      const remaining = limitBytes - totalBytes;
      const slice = value.byteLength > remaining ? value.slice(0, remaining) : value;
      collected += decoder.decode(slice, { stream: true });
      totalBytes += slice.byteLength;
    }
    collected += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return collected.trim();
}

function trimToLimit(value: string, limitBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= limitBytes) {
    return value.trim();
  }

  return new TextDecoder().decode(encoded.slice(0, limitBytes)).trim();
}
