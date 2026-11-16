import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const enginePath = process.env.STREAMSNIPE_ENGINE_DIST;
test("bundled dashboard pairs with real engine, plays local ranges and revokes", async ({
  page,
}) => {
  test.skip(
    !enginePath,
    "Set STREAMSNIPE_ENGINE_DIST to the companion dist/app.js",
  );
  test.setTimeout(45000);
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "streamsnipe-browser-")),
  );
  const media = path.join(dir, "media");
  await mkdir(media);
  const mp4 = path.join(media, "fixture.mp4"),
    jpeg = path.join(media, "fixture.preview.jpg");
  const movie = spawnSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=10",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    mp4,
  ]);
  expect(movie.status, String(movie.stderr)).toBe(0);
  const still = spawnSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    mp4,
    "-frames:v",
    "1",
    jpeg,
  ]);
  expect(still.status, String(still.stderr)).toBe(0);
  const { createEngine } = await import(
    pathToFileURL(path.resolve(enginePath!)).href
  );
  const engine = createEngine({
    dataDir: path.join(dir, "data"),
    recordingsPath: media,
    dashboardPath: path.resolve("dist-dashboard"),
    port: 0,
    mode: "docker",
    monitor: false,
  });
  try {
    const addr = await engine.start(),
      origin = `http://127.0.0.1:${addr.port}`;
    const db = new DatabaseSync(path.join(dir, "data", "engine.sqlite"));
    const record = {
      id: "fixture",
      url: "https://twitch.tv/example",
      platform: "twitch",
      title: "Real local fixture",
      status: "completed",
      quality: "best",
      format: "mp4",
      filePath: mp4,
      previewPath: jpeg,
      thumbnailPath: jpeg,
      mediaRoot: media,
      managed: true,
      fileSize: (await stat(mp4)).size,
      startedAt: new Date().toISOString(),
      uploadedToCloud: false,
    };
    db.prepare("INSERT INTO recordings(id,data) VALUES(?,?)").run(
      record.id,
      JSON.stringify(record),
    );
    db.close();
    const origins: string[] = [],
      ranges: string[] = [];
    let previewResponse = false;
    page.on("request", (req) => {
      origins.push(new URL(req.url()).origin);
      if (req.url().includes("/media/") && req.headers().range)
        ranges.push(req.headers().range);
    });
    page.on("response", (res) => {
      if (
        res.url().includes("/media/") &&
        res.headers()["content-type"]?.startsWith("image/jpeg") &&
        res.status() === 200
      )
        previewResponse = true;
    });
    let streamRequests = 0;
    await page.route(
      "**/api/v1/recordings/fixture/media-ticket",
      async (route) => {
        const payload = route.request().postDataJSON();
        if (payload.kind !== "stream") return route.continue();
        streamRequests++;
        if (streamRequests === 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          return route.fulfill({
            status: 503,
            json: { error: "temporary ticket failure" },
          });
        }
        const response = await route.fetch();
        const ticket = await response.json();
        if (streamRequests === 1)
          ticket.expiresAt = new Date(Date.now() + 31000).toISOString();
        return route.fulfill({ response, json: ticket });
      },
    );
    await page.goto(origin + "/app/");
    await page.getByRole("button", { name: "Pair this browser" }).click();
    await expect.poll(() => engine.auth.listPending().length).toBe(1);
    expect(engine.auth.approve(engine.auth.listPending()[0].id)).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Good to see you." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("button", { name: /Real local fixture/ }).click();
    await expect(page.locator("video")).toBeVisible();
    await expect.poll(() => ranges.length).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThan(0);
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.pause();
      v.currentTime = 1;
    });
    await expect
      .poll(() => streamRequests, { timeout: 5000 })
      .toBeGreaterThanOrEqual(2);
    await page.locator("video").evaluate((v: HTMLVideoElement) => {
      v.pause();
      v.currentTime = 2;
    });
    await expect
      .poll(() => streamRequests, { timeout: 10000 })
      .toBeGreaterThanOrEqual(3);
    await expect
      .poll(
        () =>
          page
            .locator("video")
            .evaluate((v: HTMLVideoElement) => v.currentTime),
        { timeout: 5000 },
      )
      .toBeGreaterThan(1.8);
    expect(
      await page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    ).toBe(true);
    await page.getByRole("button", { name: "Preview frame" }).click();
    await expect(
      page.getByRole("img", { name: "Preview frame from this recording" }),
    ).toBeVisible();
    await expect.poll(() => previewResponse).toBe(true);
    expect([...new Set(origins)]).toEqual([origin]);
    // A second browser session is paired through the same local approval API and revokes the first.
    const post = (url: string, body: any, token?: string) =>
      fetch(origin + "/api/v1" + url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    const pair = await (
      await post("/pairings", { name: "Second browser" })
    ).json();
    expect(engine.auth.approve(pair.id)).toBe(true);
    const second = await (
      await fetch(origin + "/api/v1/pairings/" + pair.id, {
        headers: { "X-Pairing-Token": pair.pollToken },
      })
    ).json();
    const sessions = await (
      await fetch(origin + "/api/v1/sessions", {
        headers: { authorization: `Bearer ${second.token}` },
      })
    ).json();
    const first = sessions.find(
      (s: any) =>
        s.id !== sessions.find((x: any) => x.name === "Second browser").id,
    );
    expect(
      (
        await fetch(origin + "/api/v1/sessions/" + first.id, {
          method: "DELETE",
          headers: { authorization: `Bearer ${second.token}` },
        })
      ).status,
    ).toBe(200);
    await expect(
      page.getByRole("heading", { name: /connect your studio/ }),
    ).toBeVisible({ timeout: 20000 });
    expect(
      await page.evaluate(() => localStorage.getItem("streamsnipe.token.v1")),
    ).toBeNull();
  } finally {
    await engine.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
