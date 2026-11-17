import { test, expect } from "@playwright/test";

test("deployed fallback hosts preserve paths and query strings without moving the studio", async ({
  request,
}) => {
  test.skip(
    process.env.RUN_DEPLOYED_REDIRECT_TESTS !== "1",
    "Run after the redirect deployment is live",
  );
  for (const host of [
    "streamsnipe-portal.vercel.app",
    "fansnipe-portal.vercel.app",
  ]) {
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
    ]) {
      const query = "?source=redirect-test&value=a%2Fb";
      const response = await request.get(`https://${host}${pathname}${query}`, {
        maxRedirects: 0,
      });
      expect(response.status(), `${host}${pathname}`).toBe(308);
      const location = new URL(response.headers().location, `https://${host}`);
      expect(location.origin).toBe("https://fansnipe.com");
      expect(location.pathname).toBe(pathname);
      expect(location.search).toBe(query);
    }
    const root = await request.get(`https://${host}/app`, { maxRedirects: 0 });
    expect(root.headers().location || "").not.toContain("fansnipe.com");
    const app = await request.get(`https://${host}/app/`, { maxRedirects: 0 });
    expect(app.status()).toBe(200);
    const html = await app.text();
    const asset = html.match(/src="(\.\/assets\/[^"]+\.js)"/)?.[1];
    expect(asset).toBeTruthy();
    const js = await request.get(new URL(asset!, `https://${host}/app/`).href, {
      maxRedirects: 0,
    });
    expect(js.status()).toBe(200);
    expect(js.headers().location || "").not.toContain("fansnipe.com");
  }
});
