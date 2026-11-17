import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("hosted Docker pairing delegates local approval without leaking tokens into the link", async ({
  page,
  context,
}) => {
  let approved = false;
  await context.addInitScript(() => {
    if (location.origin === "http://127.0.0.1:47821")
      localStorage.setItem("streamsnipe.token.v1", "unrelated-local-session");
  });
  const leaked: string[] = [];
  context.on("request", (req) => {
    if (
      req.headers()["x-setup-token"] &&
      new URL(req.url()).origin !== "http://127.0.0.1:47821"
    )
      leaked.push(req.url());
  });
  const calls: {
    url: string;
    token: string | null;
    poll: string | null;
    authorization: string | null;
  }[] = [];
  await context.route("http://127.0.0.1:47821/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    calls.push({
      url: req.url(),
      token: req.headers()["x-setup-token"] || null,
      poll: req.headers()["x-pairing-token"] || null,
      authorization: req.headers()["authorization"] || null,
    });
    if (u.pathname === "/app/" || u.pathname.startsWith("/app/assets/")) {
      const file =
        u.pathname === "/app/"
          ? "index.html"
          : u.pathname.slice("/app/".length);
      const content = await readFile(path.resolve("dist-dashboard", file));
      return route.fulfill({
        body: content,
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    }
    if (req.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    let data: unknown = {};
    if (u.pathname.endsWith("/info"))
      data = {
        name: "FanSnipe",
        version: "0.1.2",
        protocolVersion: 1,
        mode: "docker",
      };
    else if (u.pathname.endsWith("/pairings") && req.method() === "POST")
      data = {
        id: "challenge-id",
        code: "123456",
        pollToken: "poll-secret",
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      };
    else if (u.pathname.endsWith("/pairings/challenge-id/pending")) {
      expect(req.headers()["x-setup-token"]).toBe("operator-secret");
      data = {
        id: "challenge-id",
        name: "Chrome browser",
        code: "123456",
        origin: "https://fansnipe.com",
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      };
    } else if (u.pathname.endsWith("/pairings/challenge-id/approve")) {
      expect(req.headers()["x-setup-token"]).toBe("operator-secret");
      approved = true;
      data = { status: "approved" };
    } else if (u.pathname.endsWith("/pairings/challenge-id"))
      data = approved
        ? { status: "approved", token: "session-secret" }
        : { status: "pending" };
    else if (
      u.pathname.endsWith("/channels") ||
      u.pathname.endsWith("/recordings")
    )
      data = [];
    else if (u.pathname.endsWith("/settings"))
      data = {
        recordingsPath: "/recordings",
        defaultQuality: "best",
        defaultFormat: "mp4",
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
      };
    else if (u.pathname.endsWith("/sessions")) data = [];
    else if (u.pathname.endsWith("/status"))
      data = {
        activeRecordings: 0,
        totalRecordings: 0,
        totalChannels: 0,
        disk: { total: 100, used: 0, available: 100, usedPercent: 0 },
      };
    return route.fulfill({
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
  const link = page.getByRole("link", { name: /approve.*local/i });
  const href = await link.getAttribute("href");
  expect(href).toBe("http://127.0.0.1:47821/app/#approve=challenge-id");
  expect(href).not.toMatch(/poll-secret|operator-secret|session-secret/);
  const [local] = await Promise.all([
    context.waitForEvent("page"),
    link.click(),
  ]);
  await local.waitForLoadState();
  await expect(local).toHaveURL("http://127.0.0.1:47821/app/");
  await expect(
    local.getByRole("heading", { name: /approve.*pairing/i }),
  ).toBeVisible();
  await local.getByLabel("Docker setup token").fill("operator-secret");
  await local.getByRole("button", { name: /review request/i }).click();
  await expect(local.getByText("https://fansnipe.com")).toBeVisible();
  await expect(local.getByText("123456")).toBeVisible();
  expect(approved).toBe(false);
  await expect(
    local.getByRole("button", { name: "Approve pairing" }),
  ).toBeDisabled();
  await local.getByRole("checkbox", { name: /codes match/i }).check();
  await local.getByRole("button", { name: "Approve pairing" }).click();
  await expect(local.getByText(/pairing approved/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText(/Configure Docker storage in the/)).toBeVisible();
  await expect(page.getByLabel("Enable S3 uploads")).toBeDisabled();
  expect(calls.some((c) => c.url.includes("/settings/s3-approvals"))).toBe(
    false,
  );
  expect(leaked).toEqual([]);
  const secretCalls = calls.filter((c) => c.token);
  expect(secretCalls.map((c) => new URL(c.url).pathname)).toEqual([
    "/api/v1/pairings/challenge-id/pending",
    "/api/v1/pairings/challenge-id/approve",
  ]);
  expect(
    calls
      .filter((c) => c.url.includes("/pending") || c.url.includes("/approve"))
      .every((c) => !c.poll && !c.authorization),
  ).toBe(true);
});

test("local approval rejects malformed, wrong-token and expired requests safely", async ({
  page,
  context,
}) => {
  let approved = 0;
  await context.route("http://127.0.0.1:47821/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.pathname === "/app/" || u.pathname.startsWith("/app/assets/")) {
      const file =
        u.pathname === "/app/"
          ? "index.html"
          : u.pathname.slice("/app/".length);
      return route.fulfill({
        body: await readFile(path.resolve("dist-dashboard", file)),
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    }
    if (u.pathname.endsWith("/approve")) {
      approved++;
      return route.fulfill({ json: { status: "approved" } });
    }
    if (u.pathname.endsWith("/pending")) {
      if (req.headers()["x-setup-token"] !== "right")
        return route.fulfill({
          status: 403,
          json: { error: "Invalid setup token" },
        });
      return route.fulfill({
        json: {
          id: "expired",
          name: "Chrome browser",
          code: "111111",
          origin: "https://fansnipe.com",
          expiresAt: new Date(Date.now() + 1200).toISOString(),
        },
      });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto("http://127.0.0.1:47821/app/#approve=bad%2Fid");
  await expect(page.getByText(/Invalid pairing request/)).toBeVisible();
  expect(approved).toBe(0);
  await page.goto("about:blank");
  await page.goto("http://127.0.0.1:47821/app/#approve=expired");
  const input = page.getByLabel("Docker setup token");
  await input.fill("wrong");
  await page.getByRole("button", { name: "Review request" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid setup token");
  await expect(input).toHaveValue("");
  await input.fill("right");
  await page.getByRole("button", { name: "Review request" }).click();
  await expect(page.getByText("111111")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve pairing" }),
  ).toBeDisabled();
  await expect(page.getByText(/pairing request has expired/)).toBeVisible({
    timeout: 4000,
  });
  expect(approved).toBe(0);
});

test("hung companion discovery becomes retryable and explains Docker fallback", async ({
  page,
}) => {
  test.setTimeout(18000);
  await page.route("http://127.0.0.1:47821/api/v1/info", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    await route.abort().catch(() => {});
  });
  await page.goto("/app/");
  await expect(
    page.getByRole("heading", {
      name: "Companion offline or local network access blocked",
    }),
  ).toBeVisible({ timeout: 13000 });
  await expect(
    page.getByRole("link", { name: /local Docker dashboard/i }),
  ).toHaveAttribute("href", "http://127.0.0.1:47821/app/");
  await expect(page.getByText(/FANSNIPE_HOSTED_DASHBOARD=true/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();
});
