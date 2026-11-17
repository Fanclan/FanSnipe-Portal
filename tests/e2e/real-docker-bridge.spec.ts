import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, realpath, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const enginePath =
  process.env.FANSNIPE_ENGINE_DIST || process.env.STREAMSNIPE_ENGINE_DIST;
test("canonical hosted page pairs through local approval with real Docker bridge CORS", async ({
  page,
  context,
}) => {
  test.skip(
    !enginePath,
    "Set FANSNIPE_ENGINE_DIST to a bridge-capable companion dist/app.js",
  );
  test.setTimeout(45000);
  const dir = await realpath(
      await mkdtemp(path.join(tmpdir(), "fansnipe-hosted-bridge-")),
    ),
    media = path.join(dir, "media");
  await mkdir(media);
  const movie = path.join(media, "fixture.mp4");
  const made = spawnSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=10",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    movie,
  ]);
  expect(made.status, String(made.stderr)).toBe(0);
  const { createEngine } = await import(
    pathToFileURL(path.resolve(enginePath!)).href
  );
  const engine = createEngine({
    dataDir: path.join(dir, "data"),
    recordingsPath: media,
    dashboardPath: path.resolve("dist-dashboard"),
    port: 0,
    mode: "docker",
    hostedDashboard: true,
    setupToken: "synthetic-operator-token",
    monitor: false,
  });
  try {
    const address = await engine.start(),
      local = `http://127.0.0.1:${address.port}`;
    const observed: {
      url: string;
      origin: string | undefined;
      referer: string | undefined;
      hasSetup: boolean;
    }[] = [];
    engine.server.on("request", (req: any) =>
      observed.push({
        url: req.url || "",
        origin: req.headers.origin,
        referer: req.headers.referer,
        hasSetup: !!req.headers["x-setup-token"],
      }),
    );
    const db = new DatabaseSync(path.join(dir, "data", "engine.sqlite"));
    db.prepare("INSERT INTO recordings(id,data) VALUES(?,?)").run(
      "bridge-fixture",
      JSON.stringify({
        id: "bridge-fixture",
        url: "https://twitch.tv/example",
        platform: "twitch",
        title: "Bridge fixture",
        status: "completed",
        quality: "best",
        format: "mp4",
        filePath: movie,
        mediaRoot: media,
        managed: true,
        fileSize: (await stat(movie)).size,
        startedAt: new Date().toISOString(),
        uploadedToCloud: false,
      }),
    );
    db.close();
    const leaked: string[] = [];
    let mediaResponse: { status: number; range: string | undefined } | null =
      null;
    page.on("response", (response) => {
      if (response.url().startsWith(`${local}/media/`))
        mediaResponse = {
          status: response.status(),
          range: response.headers()["content-range"],
        };
    });
    await context.grantPermissions(["local-network-access"], {
      origin: "https://fansnipe.com",
    });
    context.on("request", (req) => {
      if (req.headers()["x-setup-token"] && new URL(req.url()).origin !== local)
        leaked.push(req.url());
    });
    // Serve the real hosted build at its true HTTPS origin. Only the test response's loopback port is adapted to the isolated engine; API traffic goes directly to the engine, without interception.
    await context.route("https://fansnipe.com/**", async (route) => {
      const u = new URL(route.request().url());
      const rel =
        u.pathname === "/app/"
          ? "index.html"
          : u.pathname.startsWith("/app/assets/")
            ? u.pathname.slice("/app/".length)
            : "";
      if (!rel) return route.fulfill({ status: 404, body: "not found" });
      let content = await readFile(path.resolve("dist/app", rel));
      if (rel.endsWith(".js")) {
        const text = content.toString();
        expect(text).toContain("http://127.0.0.1:47821");
        content = Buffer.from(text.replaceAll("http://127.0.0.1:47821", local));
      }
      return route.fulfill({
        body: content,
        contentType: rel.endsWith(".js")
          ? "text/javascript"
          : rel.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    });
    await page.goto("https://fansnipe.com/app/");
    await page.getByRole("button", { name: "Pair this browser" }).click();
    const code = (
      await page.locator(".pair-code strong").textContent()
    )?.trim();
    expect(code).toMatch(/^\d{6}$/);
    const link = page.getByRole("link", { name: /approve.*local/i });
    expect(await link.getAttribute("href")).toMatch(
      new RegExp(`^${local}/app/#approve=[a-f0-9-]+$`),
    );
    const [operator] = await Promise.all([
      context.waitForEvent("page"),
      link.click(),
    ]);
    await operator
      .getByLabel("Docker setup token")
      .fill("synthetic-operator-token");
    await operator.getByRole("button", { name: "Review request" }).click();
    await expect(operator.getByText("https://fansnipe.com")).toBeVisible();
    await expect(operator.locator(".pair-code strong")).toHaveText(code!);
    await expect(
      operator.getByRole("button", { name: "Approve pairing" }),
    ).toBeDisabled();
    await operator.getByRole("checkbox", { name: /codes match/i }).check();
    await operator.getByRole("button", { name: "Approve pairing" }).click();
    await expect(
      page.getByRole("heading", { name: /Good to see you|Recording studio/ }),
    ).toBeVisible({ timeout: 7000 });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: /Bridge fixture/ }).click();
    await expect(page.locator("video")).toBeVisible();
    await expect
      .poll(() => observed.some((req) => req.url.startsWith("/media/")))
      .toBe(true);
    await expect.poll(() => mediaResponse?.status).toBe(206);
    expect(mediaResponse?.range).toMatch(/^bytes /);
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThan(0);
    expect(
      await page
        .locator("video")
        .evaluate(
          (video: HTMLVideoElement) => new URL(video.currentSrc).origin,
        ),
    ).toBe(local);
    await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
      video.muted = true;
      await video.play();
    });
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(0.25);
    await page.locator("video").evaluate((video: HTMLVideoElement) => {
      video.pause();
      video.currentTime = 1;
    });
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime),
      )
      .toBeGreaterThan(0.9);
    expect(
      observed.some(
        (req) =>
          req.url === "/api/v1/pairings" &&
          req.origin === "https://fansnipe.com",
      ),
    ).toBe(true);
    expect(observed.filter((req) => req.hasSetup)).toHaveLength(2);
    expect(
      observed
        .filter((req) => req.hasSetup)
        .every(
          (req) =>
            req.origin === local ||
            (!req.origin &&
              !!req.referer &&
              new URL(req.referer).origin === local),
        ),
    ).toBe(true);
    expect(leaked).toEqual([]);
    const denied = await fetch(
      `${local}/api/v1/pairings/does-not-exist/pending`,
      {
        headers: {
          Origin: "https://fansnipe.com",
          "X-Setup-Token": "synthetic-operator-token",
        },
      },
    );
    expect(denied.status).toBe(403);
    const rejected = await fetch(`${local}/api/v1/info`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(rejected.status).toBe(403);
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
