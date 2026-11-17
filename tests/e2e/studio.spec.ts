import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const api = "http://127.0.0.1:47821/api/v1/**";
const channel = {
  id: "c1",
  name: "A long channel name for a narrow view",
  url: "https://example.com/" + "long".repeat(25),
  platform: "test",
  quality: "360p",
  autoRecord: false,
  enabled: true,
  isLive: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const recording = {
  id: "r1",
  channelId: "c1",
  url: "https://example.com/live",
  platform: "test",
  title: "A saved recording",
  status: "interrupted",
  quality: "360p",
  format: "ts",
  fileSize: 1024,
  startedAt: "2026-01-01T00:00:00Z",
  hasPreview: true,
  hasThumbnail: true,
  uploadedToCloud: false,
};
const settings = {
  recordingsPath: "/original",
  defaultQuality: "360p",
  defaultFormat: "ts",
  monitorIntervalSeconds: 60,
  maxConcurrentRecordings: 2,
  maxDiskUsagePercent: 90,
  autoCleanupEnabled: false,
  autoCleanupDays: 30,
  s3Enabled: false,
  s3Bucket: "",
  s3Region: "us-east-1",
  s3Endpoint: "",
  hasS3Credentials: false,
  lockedFields: ["recordingsPath"],
};
async function fixture(
  page: Page,
  overrides: {
    revoked?: boolean;
    recordings?: (typeof recording & { error?: string })[];
  } = {},
) {
  const requests: { path: string; body: any; method: string }[] = [];
  await page.addInitScript(() =>
    localStorage.setItem("streamsnipe.token.v1", "saved-token"),
  );
  await page.route(api, async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method();
    let body: any;
    try {
      body = req.postDataJSON();
    } catch {
      body = undefined;
    }
    requests.push({ path, body, method });
    if (method === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
      return;
    }
    if (overrides.revoked && !path.endsWith("/info")) {
      await route.fulfill({
        status: 401,
        json: { error: "revoked" },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
      return;
    }
    let data: any = {};
    if (path.endsWith("/info"))
      data = {
        name: "StreamSnipe",
        version: "1",
        protocolVersion: 1,
        mode: "desktop",
      };
    else if (path.endsWith("/channels/c1/stats"))
      data = {
        channel,
        recordings: [recording],
        stats: { totalRecordings: 1, totalDuration: 60, totalSize: 1024 },
      };
    else if (path.endsWith("/channels")) data = [channel];
    else if (path.endsWith("/recordings"))
      data = overrides.recordings ?? [recording];
    else if (path.endsWith("/status"))
      data = {
        activeRecordings: 0,
        totalRecordings: 1,
        totalChannels: 1,
        disk: { total: 10240, used: 1024, available: 9216, usedPercent: 10 },
      };
    else if (path.endsWith("/settings/s3-approvals") && method === "POST")
      data = {
        id: "approval",
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      };
    else if (path.endsWith("/settings/s3-approvals/approval"))
      data = { status: "approved", approvalToken: "one-use" };
    else if (path.endsWith("/settings")) data = settings;
    else if (path.endsWith("/sessions")) data = [];
    else if (path.endsWith("/media-ticket"))
      data = {
        url: `http://127.0.0.1:47821/media/${body.kind}`,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    await route.fulfill({
      json: data,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    });
  });
  return requests;
}
test("failed empty captures explain what happened before opening the player", async ({
  page,
}) => {
  const reason = "This channel is offline. Try again when it is live.";
  const failed = {
    ...recording,
    channelId: "",
    id: "failed-room",
    title: "Public room",
    status: "failed",
    platform: "chaturbate",
    fileSize: 0,
    hasPreview: false,
    hasThumbnail: false,
    error: reason,
  };
  const requests = await fixture(page, {
    recordings: [
      failed,
      {
        ...failed,
        id: "old-record",
        title: "Older capture",
        error: "Recording produced no media",
      },
    ],
  });
  await page.goto("/app/");
  await expect(page.getByRole("button", { name: /Public room/ })).toContainText(
    reason,
  );
  await expect(
    page.getByRole("button", { name: /Older capture/ }),
  ).toContainText("Check that the stream is public and live");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const entry = page.getByRole("button", { name: /Public room/ });
  await expect(entry).toContainText(reason);
  await page.getByRole("button", { name: "List view" }).click();
  await expect(entry).toContainText(reason);
  await entry.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(reason);
  await expect(dialog.getByRole("button", { name: "Download" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /upload/i })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeVisible();
  expect(requests.some((r) => r.path.endsWith("/media-ticket"))).toBe(false);
});
test("revoked token returns to pairing and removes cached credential", async ({
  page,
}) => {
  await fixture(page, { revoked: true });
  await page.goto("/app/");
  await expect(page.getByText(/expired or was revoked/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /open your studio/i }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("streamsnipe.token.v1")),
  ).toBeNull();
});
test("partial recording probes stream and preview is an image; modal traps and restores focus", async ({
  page,
}) => {
  const requests = await fixture(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const card = page.getByRole("button", { name: /A saved recording/ });
  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeFocused();
  await expect
    .poll(() =>
      requests.some(
        (r) => r.path.endsWith("/media-ticket") && r.body?.kind === "stream",
      ),
    )
    .toBe(true);
  await dialog.getByRole("button", { name: "Preview frame" }).click();
  await expect(
    dialog.getByRole("img", { name: "Preview frame from this recording" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
});
test("settings sends only touched field and recording uses saved defaults", async ({
  page,
}) => {
  const requests = await fixture(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Settings", exact: false }).click();
  await page.getByLabel("Default quality").selectOption("720p");
  await page.getByRole("button", { name: /Save settings/ }).click();
  await expect
    .poll(
      () =>
        requests.find((r) => r.path.endsWith("/settings") && r.method === "PUT")
          ?.body,
    )
    .toEqual({ defaultQuality: "720p" });
  await page.getByRole("button", { name: "Overview", exact: false }).click();
  await page.getByRole("button", { name: "New recording" }).click();
  await page.getByLabel("Stream URL").fill("https://example.com/live");
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect
    .poll(
      () => requests.find((r) => r.path.endsWith("/recordings/start"))?.body,
    )
    .toEqual({ url: "https://example.com/live" });
});
test("authenticated studio fits narrow screens and passes serious accessibility checks in both themes", async ({
  page,
}) => {
  await fixture(page);
  for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript((t) => localStorage.setItem("ss-theme", t), theme);
    await page.goto("/app/");
    await page.getByRole("button", { name: "Library", exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      ),
    ).toEqual([]);
  }
});

test("storage destination change waits for local approval", async ({
  page,
}) => {
  const requests = await fixture(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Enable S3 uploads").check();
  await page.getByLabel("Bucket").fill("my-bucket");
  await page.getByRole("button", { name: /Save settings/ }).click();
  await expect(
    page.getByText("Approve this storage destination in the companion."),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        requests.find((r) => r.path.endsWith("/settings") && r.method === "PUT")
          ?.body,
      { timeout: 5000 },
    )
    .toEqual({
      s3Enabled: true,
      s3Bucket: "my-bucket",
      uploadDestinationApproval: "one-use",
    });
  expect(
    requests.find((r) => r.path.endsWith("/settings/s3-approvals"))?.body,
  ).toEqual({
    s3Enabled: true,
    s3Bucket: "my-bucket",
    s3Region: "us-east-1",
    s3Endpoint: "",
  });
});
test("lost pending pairing can be restarted", async ({ page }) => {
  let creates = 0;
  await page.route(api, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/info"))
      return route.fulfill({
        json: {
          name: "StreamSnipe",
          version: "1",
          protocolVersion: 1,
          mode: "desktop",
        },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (path.endsWith("/pairings")) {
      creates++;
      return route.fulfill({
        json: {
          id: "lost",
          code: "123456",
          pollToken: "poll",
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }
    return route.fulfill({
      status: 403,
      json: { error: "lost" },
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/app/");
  await page.getByRole("button", { name: "Pair this browser" }).click();
  await expect(
    page.getByText(/pairing request is no longer available/),
  ).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Pair this browser" }).click();
  expect(creates).toBe(2);
});
test("missing media is terminal until the user explicitly retries", async ({
  page,
}) => {
  await fixture(page);
  let streamRequests = 0;
  await page.route("**/api/v1/recordings/r1/media-ticket", async (route) => {
    if (route.request().postDataJSON()?.kind !== "stream")
      return route.fallback();
    streamRequests++;
    return route.fulfill({
      status: 404,
      json: { error: "Media not found" },
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.goto("/app/");
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: /A saved recording/ }).click();
  await expect(
    page.getByText("Media is unavailable for this recording."),
  ).toBeVisible();
  await page.waitForTimeout(5300);
  expect(streamRequests).toBe(1);
  await page.getByRole("button", { name: "Try playback again" }).click();
  await expect.poll(() => streamRequests).toBe(2);
});
test("desktop recording folder is read-only and explains the native picker", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Recording folder")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(page.getByText(/native recording folder picker/)).toBeVisible();
});
