import { describe, expect, it } from "vitest";
import { getTransformedRoutes } from "@vercel/routing-utils";
import config from "../vercel.json";

// Use Vercel's own route compiler, then match its emitted source and host expressions.
const result = getTransformedRoutes(
  config as Parameters<typeof getTransformedRoutes>[0],
);
const redirects = (result.routes || []).filter(
  (
    route,
  ): route is typeof route & {
    src: string;
    status: number;
    headers: { Location: string };
    has: { type: string; value: string }[];
  } =>
    "src" in route &&
    "status" in route &&
    route.status === 308 &&
    !!route.headers?.Location &&
    !!route.has,
);
function compiledRedirect(host: string, pathname: string) {
  for (const route of redirects) {
    const condition = route.has.find((item) => item.type === "host");
    const match = new RegExp(route.src).exec(pathname);
    if (match && condition && new RegExp(condition.value).test(host))
      return route.headers.Location.replace(
        /\$(\d+)/g,
        (_, index) => match[Number(index)] || "",
      );
  }
  return null;
}
describe("Vercel public-domain redirects", () => {
  it("compiles and preserves public paths including trailing slashes on both exact hosts", () => {
    expect(result.error).toBeNull();
    for (const host of [
      "streamsnipe-portal.vercel.app",
      "fansnipe-portal.vercel.app",
    ])
      for (const pathname of [
        "/",
        "/docs",
        "/docs/",
        "/downloads",
        "/downloads/",
        "/changelog",
        "/changelog/",
        "/privacy",
        "/privacy/",
        "/robots.txt",
        "/sitemap.xml",
      ])
        expect(compiledRedirect(host, pathname)).toBe(
          `https://fansnipe.com${pathname}`,
        );
  });
  it("leaves dashboard, assets, unrelated hosts and preview hosts alone", () => {
    for (const host of [
      "streamsnipe-portal.vercel.app",
      "fansnipe-portal.vercel.app",
    ])
      for (const pathname of [
        "/app",
        "/app/",
        "/app/assets/example.js",
        "/logo.svg",
        "/_astro/example.css",
        "/docs/nested",
      ])
        expect(compiledRedirect(host, pathname)).toBeNull();
    for (const host of [
      "fansnipe.com",
      "www.fansnipe.com",
      "fansnipe-portal-git-preview.vercel.app",
      "streamsnipe-portalXvercelYapp",
      "attacker-fansnipe-portal.vercel.app",
    ])
      expect(compiledRedirect(host, "/docs/")).toBeNull();
  });
});
