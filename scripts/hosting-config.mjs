import { readFileSync } from "node:fs";

/**
 * Deployment metadata is provided by Sites and is optional for local builds.
 * A missing file means no local storage bindings; malformed metadata must still
 * fail so a deployment configuration error cannot pass unnoticed.
 * @param {string | URL} [path]
 * @returns {{ d1?: string, r2?: string, [key: string]: unknown }}
 */
export function readHostingConfig(
  path = new URL("../.openai/hosting.json", import.meta.url),
) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }

  const config = JSON.parse(contents);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(".openai/hosting.json must contain a JSON object.");
  }
  for (const binding of ["d1", "r2"]) {
    if (
      config[binding] !== undefined &&
      (typeof config[binding] !== "string" || !config[binding].trim())
    ) {
      throw new Error(`.openai/hosting.json ${binding} must be a non-empty binding name.`);
    }
  }
  return config;
}
