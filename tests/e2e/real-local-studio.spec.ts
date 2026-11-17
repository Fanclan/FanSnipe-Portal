import { expect, test, type Locator } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const enginePath =
  process.env.FANSNIPE_ENGINE_DIST || process.env.STREAMSNIPE_ENGINE_DIST;

function makeFeed(folder: string, name: "before" | "after") {
  // A moving picture with a red marker before Record and a green marker afterwards.
  const color = name === "before" ? "red" : "lime";
  const made = spawnSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=12",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=550:sample_rate=44100",
    "-t",
    "100",
    "-vf",
    `drawbox=x=0:y=0:w=48:h=48:color=${color}:t=fill`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "1",
    "-g",
    "12",
    "-sc_threshold",
    "0",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-f",
    "hls",
    "-hls_time",
    "1",
    "-hls_list_size",
    "0",
    "-hls_segment_filename",
    path.join(folder, name + "%03d.ts"),
    path.join(folder, name + ".m3u8"),
  ]);
  expect(made.status, String(made.stderr)).toBe(0);
}

async function expectMoving(video: Locator) {
  await expect(video).toBeVisible();
  await expect
    .poll(
      () =>
        video.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2),
      { timeout: 25000 },
    )
    .toBe(true);
  const at = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: 12000,
    })
    .toBeGreaterThan(at + 0.3);
}

test("Docker studio unlocks, previews moving video, records only after Record, and plays the saved file", async ({
  page,
}) => {
  test.skip(!enginePath, "Requires the companion dist/app.js");
  test.setTimeout(110000);
  const folder = await realpath(
    await mkdtemp(path.join(tmpdir(), "fansnipe-local-journey-")),
  );
  const media = path.join(folder, "media"),
    catalog = path.join(folder, "catalog"),
    secret = path.join(folder, "private-password");
  const password = "Synthetic browser acceptance passphrase";
  await mkdir(media);
  await writeFile(secret, password, { mode: 0o600 });
  let phase: "before" | "after" = "before";
  const sourceRequests: string[] = [];
  const began = Date.now();
  const upstream = createServer(async (req, res) => {
    const name = req.url?.split("/").pop() ?? "";
    if (name === "stream.m3u8") {
      const last = Math.min(98, 3 + Math.floor((Date.now() - began) / 1000)),
        first = last - 2;
      const lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-TARGETDURATION:1",
        "#EXT-X-MEDIA-SEQUENCE:" + first,
      ];
      for (let i = first; i <= last; i++)
        lines.push("#EXTINF:1.0,", phase + String(i).padStart(3, "0") + ".ts");
      res
        .writeHead(200, {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        })
        .end(lines.join("\n") + "\n");
      return;
    }
    if (!/^(before|after)\d{3}\.ts$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(path.join(folder, name));
      sourceRequests.push(name);
      res.writeHead(200, { "Content-Type": "video/mp2t" }).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const address = upstream.address();
  if (!address || typeof address === "string")
    throw Error("Missing fixture port");
  const upstreamOrigin = `http://127.0.0.1:${address.port}`,
    url = upstreamOrigin + "/TestChannel/stream.m3u8";
  const { createEngine } = await import(
    pathToFileURL(path.resolve(enginePath!)).href
  );
  const engine = createEngine({
    mode: "docker",
    port: 0,
    dataDir: catalog,
    recordingsPath: media,
    dashboardPath: path.resolve("dist-dashboard"),
    studioPasswordFile: secret,
    monitor: false,
    fixtureOrigins: [upstreamOrigin],
  });
  try {
    const addr = await engine.start(),
      origin = `http://127.0.0.1:${addr.port}`;
    const info = await (await fetch(origin + "/api/v1/info")).json();
    // Portal backwards-compatibility CI also tests against the last published engine.
    if (!process.env.FANSNIPE_REQUIRE_STUDIO_JOURNEY)
      test.skip(
        !info.capabilities?.studioPassword,
        "Pinned engine predates local studio unlock",
      );
    expect(info.capabilities).toMatchObject({
      studioPassword: true,
      sourceInspection: true,
      livePreview: true,
    });
    makeFeed(folder, "before");
    makeFeed(folder, "after");
    engine.server.prependListener(
      "request",
      (req: { method: string; url: string }) => {
        if (req.method === "POST" && req.url === "/api/v1/recordings/start")
          phase = "after";
      },
    );
    const wrongOrigins = new Set<string>(),
      previewRequests: string[] = [];
    let unlockCount = 0,
      playlistSeen = false,
      segmentSeen = false,
      savedRangeSeen = false;
    let mediaSentCredential = false;
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (["http:", "https:"].includes(u.protocol) && u.origin !== origin)
        wrongOrigins.add(u.origin);
      if (u.pathname === "/api/v1/studio/unlock") unlockCount++;
      if (
        u.pathname.startsWith("/preview-media/") ||
        u.pathname.startsWith("/media/")
      ) {
        const headers = r.headers();
        mediaSentCredential ||= Boolean(
          headers.authorization || headers["x-setup-token"],
        );
        playlistSeen ||= u.pathname.endsWith(".m3u8");
        segmentSeen ||= u.pathname.endsWith(".ts");
        savedRangeSeen ||= u.pathname.startsWith("/media/") && !!headers.range;
      }
      if (u.pathname === "/api/v1/previews" && r.method() === "POST")
        previewRequests.push(
          r.postDataJSON().recordingId ? "capture" : "source",
        );
    });
    await page.goto(origin);
    await expect(page).toHaveURL(origin + "/app/");
    await page.getByLabel("Studio password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Unlock studio" }).click();
    await page.getByLabel("Paste a stream link").fill(url);
    await expect(
      page.getByRole("button", { name: "Record", exact: true }),
    ).toBeVisible();
    expect(sourceRequests).toHaveLength(0);
    expect(previewRequests).toHaveLength(0);
    await page.getByRole("button", { name: "Play preview" }).click();
    const before = page.getByLabel("Live stream preview");
    await expectMoving(before);
    expect(await before.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    expect(sourceRequests.some((f) => f.startsWith("before"))).toBe(true);
    const db = new DatabaseSync(path.join(catalog, "engine.sqlite"), {
      readOnly: true,
    });
    try {
      expect(db.prepare("SELECT count(*) n FROM recordings").get()?.n).toBe(0);
      await page.getByRole("button", { name: "Record", exact: true }).click();
      const card = page.getByRole("article", { name: /Capture: TestChannel/ });
      await expect(
        card.getByRole("button", { name: "Stop recording" }),
      ).toBeVisible({ timeout: 15000 });
      await expectMoving(card.getByLabel("Live stream preview"));
      expect(previewRequests).toContain("capture");
      await page.reload();
      await expect(
        card.getByRole("button", { name: "Stop recording" }),
      ).toBeVisible();
      expect(unlockCount).toBe(1);
      const playAgain = card.getByRole("button", { name: "Play preview" });
      if (await playAgain.isVisible()) await playAgain.click();
      await expectMoving(card.getByLabel("Live stream preview"));
      await card.getByRole("button", { name: "Stop recording" }).click();
      await expect(
        card.getByText("Saved to library", { exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const saved = JSON.parse(
        String(db.prepare("SELECT data FROM recordings").get()?.data),
      );
      expect(saved).toMatchObject({
        status: "completed",
        title: expect.stringContaining("TestChannel"),
      });
      expect(saved.fileSize).toBeGreaterThan(10000);
      const probe = spawnSync(
        "ffprobe",
        ["-v", "error", "-of", "json", "-show_streams", saved.filePath],
        { encoding: "utf8" },
      );
      expect(probe.status, probe.stderr).toBe(0);
      expect(
        JSON.parse(probe.stdout)
          .streams.map((s: { codec_type: string }) => s.codec_type)
          .sort(),
      ).toEqual(["audio", "video"]);
      const rgb = spawnSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        saved.filePath,
        "-vf",
        "crop=16:16:8:8,scale=1:1",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      expect(rgb.status, String(rgb.stderr)).toBe(0);
      expect(rgb.stdout[1]).toBeGreaterThan(rgb.stdout[0] + 100);
      await card.getByRole("button", { name: "Play recording" }).click();
      const finished = page.getByRole("dialog").locator("video");
      await finished.evaluate(async (v: HTMLVideoElement) => {
        v.muted = true;
        await v.play();
      });
      await expectMoving(finished);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await card.getByRole("button", { name: "View in library" }).click();
      await expect(
        page.getByRole("button", { name: /TestChannel/ }).first(),
      ).toBeVisible();
      expect(wrongOrigins.size).toBe(0);
      expect({
        playlistSeen,
        segmentSeen,
        savedRangeSeen,
        mediaSentCredential,
      }).toEqual({
        playlistSeen: true,
        segmentSeen: true,
        savedRangeSeen: true,
        mediaSentCredential: false,
      });
    } finally {
      db.close();
    }
  } finally {
    await engine.stop();
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
    await rm(folder, { recursive: true, force: true });
  }
});
