export type JSONPrimitive = string | number | boolean | null;

export type JSONValue =
  | JSONPrimitive
  | JSONValue[]
  | { [key: string]: JSONValue };

export function isJsonObject(value: JSONValue | undefined): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asJsonObject(value: JSONValue, label: string): { [key: string]: JSONValue } {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

export function isJsonValue(value: unknown): value is JSONValue {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) {
        return value.every(isJsonValue);
      }
      return Object.values(value as Record<string, unknown>).every(isJsonValue);
    default:
      return false;
  }
}

export function parseJsonValue(value: unknown, label = "JSON value"): JSONValue {
  if (!isJsonValue(value)) {
    throw new Error(`${label} contains unsupported JSON data`);
  }
  return value;
}
