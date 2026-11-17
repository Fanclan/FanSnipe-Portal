/** Canonical origin is stable across preview and production builds. */
export function canonicalSite(value = process.env.PUBLIC_SITE_URL) {
  if (!value) return "https://fansnipe.com";
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_SITE_URL must be an absolute HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query or fragment",
    );
  }
  return url.origin;
}
