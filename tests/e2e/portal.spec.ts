import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("public site explains local boundary and offers studio", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Catch the live/ }),
  ).toBeVisible();
  await expect(page.getByText("Your machine.")).toBeVisible();
  await page.getByRole("link", { name: "Open the studio ↗" }).first().click();
  await expect(
    page.getByRole("heading", { name: /connect your studio/ }),
  ).toBeVisible();
});
test("dashboard pairs and displays real companion data", async ({ page }) => {
  await page.route("http://127.0.0.1:47821/api/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let data: any = {};
    if (path.endsWith("/info"))
      data = {
        name: "StreamSnipe",
        version: "1.0",
        protocolVersion: 1,
        mode: "desktop",
      };
    else if (path.endsWith("/pairings") && route.request().method() === "POST")
      data = {
        id: "p",
        code: "123456",
        expiresAt: new Date(Date.now() + 120000).toISOString(),
        pollToken: "poll",
      };
    else if (path.endsWith("/pairings/p"))
      data = { status: "approved", token: "test-token" };
    else if (path.endsWith("/channels")) data = [];
    else if (path.endsWith("/recordings")) data = [];
    else if (path.endsWith("/status"))
      data = {
        activeRecordings: 0,
        totalRecordings: 0,
        totalChannels: 0,
        disk: { available: 1024, usedPercent: 10 },
      };
    await route.fulfill({
      json: data,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    });
  });
  await page.goto("/app/");
  await page.getByRole("button", { name: "Pair this browser" }).click();
  await expect(page.getByText("123456")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("1.0 KB")).toBeVisible();
  await expect(
    page.getByText("Your first recording starts here"),
  ).toBeVisible();
});

test("public and pairing pages have no serious accessibility violations", async ({
  page,
}) => {
  for (const path of ["/", "/app/"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
  }
});
test("marketing page fits narrow mobile screens", async ({ page }) => {
  for (const width of [390, 423]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

test("nested dashboard fallback loads its assets", async ({ page }) => {
  await page.goto("/app/example/nested/");
  await expect(
    page.getByRole("heading", { name: /connect your studio/ }),
  ).toBeVisible();
});
test("indexable pages have distinct metadata and app is excluded from search", async ({
  page,
}) => {
  const titles = new Set<string>(),
    descriptions = new Set<string>();
  for (const path of [
    "/",
    "/docs/",
    "/downloads/",
    "/changelog/",
    "/privacy/",
  ]) {
    await page.goto(path);
    titles.add(await page.title());
    descriptions.add(
      (await page
        .locator('meta[name="description"]')
        .getAttribute("content")) || "",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(new URL(canonical!).pathname).toBe(path);
    expect(new URL(canonical!).origin).toBe("https://fansnipe.com");
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
  }
  expect(titles.size).toBe(5);
  expect(descriptions.size).toBe(5);
  await page.goto("/app/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("sitemap and robots advertise the canonical domain and exclude studio", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /app/");
  expect(robots).toContain("https://fansnipe.com/sitemap.xml");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("https://fansnipe.com/docs/");
  expect(sitemap).not.toContain("https://fansnipe.com/app/");
});
test("structured metadata describes each page without adding an application to privacy", async ({
  page,
}) => {
  for (const [path, software] of [
    ["/", true],
    ["/privacy/", false],
  ] as const) {
    await page.goto(path);
    const json = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent())!,
    );
    const types = json["@graph"].map(
      (node: { "@type": string }) => node["@type"],
    );
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
    expect(types).toContain("WebPage");
    expect(types.includes("SoftwareApplication")).toBe(software);
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
      "content",
      "en_US",
    );
    await expect(page.locator('meta[name="twitter:image:alt"]')).toHaveCount(1);
  }
});
test("published beta lists actual artifacts and clearly separates signing, test and OCI status", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/downloads/");
  await expect(page.getByText("This release is unsigned.")).toBeVisible();
  await expect(
    page.getByText("The eight-hour Windows test has been deferred."),
  ).toBeVisible();
  await expect(page.getByText("macOS builds are not notarized.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Windows x64 (EXE) ↗" }),
  ).toHaveAttribute("href", /FanSnipe\.Setup\.0\.1\.1\.exe$/);
  await expect(
    page.getByRole("link", { name: "Published checksums ↗" }),
  ).toHaveAttribute("href", /SHA256SUMS\.txt$/);
  await expect(
    page.getByText("OCI image index digest:", { exact: false }),
  ).toContainText(
    "sha256:e6aef80707cc2f2549a308ec448aa8aac74195c5bfd9e4f49bb535ecb988a4f8",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
