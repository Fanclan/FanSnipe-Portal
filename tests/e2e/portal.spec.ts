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
  await expect(
    page.getByRole("link", { name: "Open local studio", exact: true }).first(),
  ).toHaveAttribute("href", "http://127.0.0.1:47821/app/");
  await page
    .getByRole("link", { name: "Use hosted studio", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: /open your studio/i }),
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
    page.getByRole("heading", { name: /open your studio/i }),
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
  const desktop = page.locator("section").filter({
    has: page.getByRole("heading", { name: /Version 0\.1\.1-beta\.1/ }),
  });
  await expect(desktop.getByText("This release is unsigned.")).toBeVisible();
  await expect(
    desktop.getByText("The eight-hour Windows test has been deferred."),
  ).toBeVisible();
  await expect(
    desktop.getByText("macOS builds are not notarized."),
  ).toBeVisible();
  await expect(
    desktop.getByRole("link", { name: "Windows x64 (EXE) ↗" }),
  ).toHaveAttribute("href", /FanSnipe\.Setup\.0\.1\.1\.exe$/);
  await expect(
    desktop.getByRole("link", { name: "Published checksums ↗" }),
  ).toHaveAttribute("href", /SHA256SUMS\.txt$/);
  await expect(
    desktop.getByText("OCI image index digest:", { exact: false }),
  ).toContainText(
    "sha256:e6aef80707cc2f2549a308ec448aa8aac74195c5bfd9e4f49bb535ecb988a4f8",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});
test("Docker-only bridge release appears separately from native installers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/downloads/");
  const docker = page.locator("section").filter({
    has: page.getByRole("heading", { name: /Version 0\.1\.2-beta\.1/ }),
  });
  await expect(
    docker.getByText(
      "Docker-only release. macOS and Windows installers remain at 0.1.1-beta.1.",
    ),
  ).toBeVisible();
  await expect(
    docker.getByText("The eight-hour Windows test has been deferred."),
  ).toBeVisible();
  await expect(
    docker.getByRole("link", {
      name: "Docker release verification manifest (JSON) ↗",
    }),
  ).toHaveAttribute("href", /docker-v0\.1\.2-beta\.1\/release-manifest\.json$/);
  await expect(
    docker.getByText("OCI image index digest:", { exact: false }),
  ).toContainText(
    "sha256:3bcd0c443a04ec8e003eaae34fda9e93d74b083a5f5f6e537810b113fe907e6c",
  );
  const desktop = page.locator("section").filter({
    has: page.getByRole("heading", { name: /Version 0\.1\.1-beta\.1/ }),
  });
  await expect(
    desktop.getByRole("link", { name: "Windows x64 (EXE) ↗" }),
  ).toHaveAttribute("href", /v0\.1\.1-beta\.1\/FanSnipe\.Setup\.0\.1\.1\.exe$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("recording fix lists desktop installers and their separate Docker verification", async ({
  page,
}) => {
  await page.goto("/downloads/");
  const release = page.locator("section").filter({
    has: page.getByRole("heading", { name: /Version 0\.1\.3-beta\.1/ }),
  });
  const source = "https://github.com/Fanclan/FanSnipe-Companion/releases";
  const desktop = source + "/download/desktop-v0.1.3-beta.1/";
  const docker = source + "/download/docker-v0.1.3-beta.1/";
  for (const [label, url] of [
    ["macOS 13+ · Apple Silicon (DMG) ↗", desktop + "FanSnipe-0.1.3-arm64.dmg"],
    ["macOS 13+ · Intel (DMG) ↗", desktop + "FanSnipe-0.1.3.dmg"],
    ["Windows x64 (EXE) ↗", desktop + "FanSnipe.Setup.0.1.3.exe"],
    ["Release manifest ↗", desktop + "release-manifest.json"],
    ["Published checksums ↗", desktop + "SHA256SUMS.txt"],
    [
      "Docker release verification manifest (JSON) ↗",
      docker + "release-manifest.json",
    ],
  ]) {
    await expect(
      release.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", url);
  }
  await expect(
    release.getByText("OCI image index digest:", { exact: false }),
  ).toContainText(
    "sha256:9f6828664fac253437152256c656419920a09da7beb55fee59c190d1f2fef9ec",
  );
});

test("Docker setup guide explains both password mounts and the recording journey", async ({
  page,
}) => {
  await page.goto("/docs/");
  await expect(
    page.getByRole("heading", { name: "Docker Desktop" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Docker Compose" }),
  ).toBeVisible();
  await expect(
    page
      .getByText("/run/secrets/fansnipe_studio_password", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Preview and record" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open local studio", exact: true }).first(),
  ).toHaveAttribute("href", "http://127.0.0.1:47821/app/");
});

test("local studio beta lists the verified native installers and matching Docker release", async ({
  page,
}) => {
  await page.goto("/downloads/");
  const release = page.locator("section").filter({
    has: page.getByRole("heading", { name: /Version 0\.1\.4-beta\.1/ }),
  });
  await expect(release.getByText("This release is unsigned.")).toBeVisible();
  await expect(
    release.getByText("The eight-hour Windows test has been deferred."),
  ).toBeVisible();
  const prefix =
    "https://github.com/Fanclan/FanSnipe-Companion/releases/download/";
  for (const [name, suffix] of [
    [
      "macOS 13+ · Apple Silicon (DMG)",
      "desktop-v0.1.4-beta.1/FanSnipe-0.1.4-arm64.dmg",
    ],
    ["macOS 13+ · Intel (DMG)", "desktop-v0.1.4-beta.1/FanSnipe-0.1.4.dmg"],
    ["Windows x64 (EXE)", "desktop-v0.1.4-beta.1/FanSnipe.Setup.0.1.4.exe"],
    [
      "Docker release verification manifest (JSON)",
      "docker-v0.1.4-beta.1/release-manifest.json",
    ],
  ]) {
    await expect(
      release.getByRole("link", { name: name + " ↗", exact: true }),
    ).toHaveAttribute("href", prefix + suffix);
  }
  await expect(
    release.getByText("OCI image index digest:", { exact: false }),
  ).toContainText(
    "sha256:c6b9558701654183c04e73e60380b9841d0edd82721440913b9d807a31013752",
  );
  await expect(
    release.getByText("Unlock it with the password", { exact: false }),
  ).toBeVisible();
});
