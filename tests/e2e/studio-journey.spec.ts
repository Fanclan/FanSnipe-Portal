import { expect, test, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const local = "http://127.0.0.1:47821";
const firstUrl = "https://picarto.tv/fixture";
const secondUrl = "https://twitch.tv/studio";
async function mockStudio(page: Page, configured = true) {
  const calls: { path: string; method: string; body: any }[] = [];
  let rows: any[] = [];
  await page.route(local + "/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname.startsWith("/app/")) {
      const filename = pathname.slice(5) || "index.html";
      return route.fulfill({
        body: await readFile(resolve("dist-dashboard", filename)),
        contentType: filename.endsWith(".js")
          ? "text/javascript"
          : filename.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    }
    const body = route.request().postDataJSON() || {};
    const path = pathname.replace("/api/v1", "");
    calls.push({ path, method, body });
    let result: unknown = {};
    if (path === "/info")
      result = {
        name: "FanSnipe",
        version: "0.2",
        protocolVersion: 1,
        mode: "docker",
        capabilities: {
          studioPassword: true,
          sourceInspection: true,
          livePreview: true,
        },
        studioPasswordConfigured: configured,
      };
    else if (path === "/studio/unlock") {
      if (body.password !== "fixture-password")
        return route.fulfill({
          status: 401,
          json: { error: "Incorrect studio password" },
        });
      result = { token: "test-session" };
    } else if (
      route.request().headers().authorization !== "Bearer test-session"
    )
      return route.fulfill({ status: 401, json: { error: "Unauthorized" } });
    else if (path === "/recordings") result = rows;
    else if (path === "/channels") result = [];
    else if (path === "/sources/inspect") {
      if (body.url === firstUrl)
        await new Promise((resolve) => setTimeout(resolve, 800));
      result = {
        title: body.url === firstUrl ? "First program" : "Evening stream",
        creator: "Studio",
        platform: "Twitch",
        status: body.url.endsWith("offline") ? "offline" : "live",
      };
    } else if (path === "/recordings/start") {
      rows = [
        {
          id: "r",
          status: "recording",
          title: body.title || "Evening stream",
          platform: "Twitch",
          url: body.url,
          fileSize: 512,
          quality: "best",
          format: "mp4",
          startedAt: new Date().toISOString(),
        },
      ];
      result = rows[0];
    } else if (path === "/recordings/r/stop") rows[0].status = "completed";
    else if (path === "/previews")
      return route.fulfill({
        status: 422,
        json: { error: "Preview is unavailable for this codec." },
      });
    return route.fulfill({ json: result });
  });
  return calls;
}
test("local studio unlocks, resolves the latest link, and preserves the recording when refreshed", async ({
  page,
}) => {
  const calls = await mockStudio(page);
  await page.goto(local + "/app/");
  await page.getByLabel("Studio password").fill("incorrect");
  await page.getByRole("button", { name: "Unlock studio" }).click();
  await expect(page.getByText("Incorrect studio password")).toBeVisible();
  await page.getByLabel("Studio password").fill("fixture-password");
  await page.getByRole("button", { name: "Unlock studio" }).click();
  const input = page.getByLabel("Paste a stream link");
  await input.fill(firstUrl);
  await expect
    .poll(() =>
      calls.some(
        (c) => c.path === "/sources/inspect" && c.body.url === firstUrl,
      ),
    )
    .toBe(true);
  await input.fill(secondUrl);
  await expect(
    page.getByRole("heading", { name: "Evening stream" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit title" }).click();
  await page.getByLabel("Recording title").fill("My show");
  expect(calls.some((c) => c.path === "/previews")).toBe(false);
  await page.getByRole("button", { name: "Play preview" }).click();
  await expect(
    page.getByText(/Preview is unavailable for this codec/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect
    .poll(() => calls.find((c) => c.path === "/recordings/start")?.body)
    .toEqual({ url: secondUrl, title: "My show" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "My show" })).toBeVisible();
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play recording" }),
  ).toBeVisible();
  expect(calls.filter((c) => c.path === "/studio/unlock")).toHaveLength(2);
});
test("offline sources offer a channel without starting a capture", async ({
  page,
}) => {
  const calls = await mockStudio(page);
  await page.addInitScript(() =>
    localStorage.setItem("streamsnipe.token.v1", "test-session"),
  );
  await page.goto(local + "/app/");
  await page.getByLabel("Paste a stream link").fill(secondUrl + "/offline");
  await page.getByRole("button", { name: "Save channel" }).click();
  await expect
    .poll(() =>
      calls.some((c) => c.path === "/channels" && c.method === "POST"),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Record", exact: true }),
  ).toHaveCount(0);
  expect(
    calls.some((c) => c.path === "/recordings/start" || c.path === "/previews"),
  ).toBe(false);
});

test("setup saves the chosen password file entirely on this device", async ({
  page,
}) => {
  const calls = await mockStudio(page, false);
  await page.goto(local + "/app/");
  await page.getByLabel("Choose a studio password").fill("my-example-password");
  await page.getByLabel("Confirm password").fill("my-example-password");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save setup password file" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("fansnipe_studio_password");
  expect(await readFile((await download.path())!, "utf8")).toBe(
    "my-example-password\n",
  );
  expect(JSON.stringify(calls)).not.toContain("my-example-password");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "my-example-password",
  );
});

test("the bundled player decodes local HLS before and during capture and closes only its preview", async ({
  page,
}, testInfo) => {
  const dir = testInfo.outputPath("synthetic-hls");
  await mkdir(dir, { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x96:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "10",
      "-c:a",
      "aac",
      "-f",
      "hls",
      "-hls_time",
      "1",
      "-hls_playlist_type",
      "vod",
      "live.m3u8",
    ],
    { cwd: dir },
  );
  const calls = await mockStudio(page);
  await page.addInitScript(() =>
    localStorage.setItem("streamsnipe.token.v1", "test-session"),
  );
  const previews: { url?: string; recordingId?: string }[] = [];
  const closed: string[] = [];
  await page.route(local + "/api/v1/previews**", async (route) => {
    if (route.request().method() === "DELETE") {
      closed.push(route.request().url().split("/").pop()!);
      return route.fulfill({ json: {} });
    }
    const body = route.request().postDataJSON();
    previews.push(body);
    const id = body.recordingId ? "capture-preview" : "source-preview";
    return route.fulfill({
      json: {
        id,
        url: "/preview-media/" + id + "/live.m3u8",
        expiresAt: new Date(Date.now() + 90000).toISOString(),
      },
    });
  });
  await page.route(local + "/preview-media/**", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop()!;
    if (!/^live(?:\.m3u8|[0-9]+\.ts)$/.test(name)) return route.abort();
    return route.fulfill({
      body: await readFile(resolve(dir, name)),
      contentType: name.endsWith(".ts")
        ? "video/mp2t"
        : "application/vnd.apple.mpegurl",
    });
  });
  await page.goto(local + "/app/");
  await page.getByLabel("Paste a stream link").fill(secondUrl);
  await page.getByRole("button", { name: "Play preview" }).click();
  const moving = () =>
    page
      .locator("video")
      .evaluateAll((v) =>
        v.some(
          (el) => el.currentTime > 0.15 && el.videoWidth === 160 && el.muted,
        ),
      );
  await expect.poll(moving).toBe(true);
  expect(calls.some((c) => c.path === "/recordings/start")).toBe(false);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect.poll(() => previews).toContainEqual({ recordingId: "r" });
  await expect.poll(moving).toBe(true);
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect.poll(() => closed).toContain("capture-preview");
  expect(closed).toContain("source-preview");
  expect(calls.some((c) => c.path.endsWith("/stop"))).toBe(false);
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeEnabled();
});

test("narrow studio navigation keeps its buttons inside the navigation area and away from the title", async ({
  page,
}) => {
  await mockStudio(page);
  await page.addInitScript(() =>
    localStorage.setItem("streamsnipe.token.v1", "test-session"),
  );
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(local + "/app/");
    const title = page.getByRole("heading", { name: "Recording studio" });
    await expect(title).toBeVisible();
    const titleRect = (await title.boundingBox())!;
    const nav = (await page.locator(".sidebar").boundingBox())!;
    for (const button of await page
      .getByRole("navigation")
      .getByRole("button")
      .all()) {
      const item = (await button.boundingBox())!;
      expect(item.x).toBeGreaterThanOrEqual(nav.x - 1);
      expect(item.x + item.width).toBeLessThanOrEqual(nav.x + nav.width + 1);
      expect(
        item.y + item.height <= titleRect.y ||
          item.y >= titleRect.y + titleRect.height ||
          item.x + item.width <= titleRect.x ||
          item.x >= titleRect.x + titleRect.width,
      ).toBe(true);
    }
    await expect(
      page.getByRole("navigation").getByRole("button", { name: "Library" }),
    ).toBeVisible();
  }
});
