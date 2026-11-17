import { test, expect } from "@playwright/test";
import {
  mkdtemp,
  cp,
  symlink,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";

let temp: string, server: Server, origin: string;
test.beforeAll(async () => {
  const root = process.cwd();
  temp = await mkdtemp(path.join(tmpdir(), "fansnipe-release-layout-"));
  for (const dir of ["src", "public", "config"])
    await cp(path.join(root, dir), path.join(temp, dir), { recursive: true });
  for (const file of ["astro.config.mjs", "package.json"])
    await cp(path.join(root, file), path.join(temp, file));
  await symlink(
    path.join(root, "node_modules"),
    path.join(temp, "node_modules"),
    "dir",
  );
  await writeFile(
    path.join(temp, "src/data/releases.json"),
    JSON.stringify({
      releases: [
        {
          version: "0.1.2-beta.1",
          date: "2026-11-17",
          verified: true,
          stage: "beta",
          signingStatus: "unsigned",
          windowsEightHourSoak: "deferred",
          notes: [
            "Docker-only update; desktop installers remain at 0.1.1.",
            "Enable the bridge with FANSNIPE_HOSTED_DASHBOARD=true on the same device.",
          ],
          artifacts: [
            {
              label: "Docker release verification manifest (JSON)",
              url: "https://example.test/release-manifest.json",
              sha256: "c".repeat(64),
            },
          ],
          container: {
            reference: "ghcr.io/example/fansnipe:v0.1.2-beta.1",
            digest: `sha256:${"b".repeat(64)}`,
          },
        },
        {
          version: "0.1.1-beta.1",
          date: "2026-11-16",
          verified: true,
          stage: "beta",
          signingStatus: "unsigned",
          windowsEightHourSoak: "deferred",
          notes: ["Synthetic release note"],
          artifacts: [
            {
              label: "Synthetic fixture",
              url: "https://example.test/fixture",
              sha256: "a".repeat(64),
            },
          ],
        },
      ],
    }),
  );
  execFileSync(
    process.execPath,
    [path.join(root, "node_modules/astro/bin/astro.mjs"), "build"],
    {
      cwd: temp,
      env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" },
      stdio: "pipe",
    },
  );
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const file =
        url.pathname === "/"
          ? "/index.html"
          : url.pathname.endsWith("/")
            ? `${url.pathname}index.html`
            : url.pathname;
      const resolved = path.resolve(temp, "dist", `.${file}`);
      if (!resolved.startsWith(path.resolve(temp, "dist") + path.sep))
        throw new Error("invalid path");
      const data = await readFile(resolved);
      res.setHeader(
        "Content-Type",
        file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html",
      );
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  if (temp) await rm(temp, { recursive: true, force: true });
});
test("populated beta release remains readable at narrow widths", async ({
  page,
}) => {
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin + "/downloads/");
    const docker = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Version 0\.1\.2-beta\.1/ }),
    });
    const desktop = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Version 0\.1\.1-beta\.1/ }),
    });
    await expect(docker.getByText("This release is unsigned.")).toBeVisible();
    await expect(
      docker.getByText("The eight-hour Windows test has been deferred."),
    ).toBeVisible();
    await expect(
      docker.getByText(
        "Docker-only update; desktop installers remain at 0.1.1.",
      ),
    ).toBeVisible();
    await expect(
      docker.getByRole("link", {
        name: /Docker release verification manifest/,
      }),
    ).toBeVisible();
    await expect(
      docker.getByText("OCI image index digest:", { exact: false }),
    ).toContainText("sha256:" + "b".repeat(64));
    await expect(desktop.getByText("Synthetic release note")).toBeVisible();
    await expect(desktop.locator("code.checksum")).toHaveText("a".repeat(64));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.goto(origin + "/changelog/");
    const dockerNotes = page.locator("section").filter({
      has: page.getByRole("heading", { name: /Version 0\.1\.2-beta\.1/ }),
    });
    await expect(
      dockerNotes.getByText(
        "Docker-only update; desktop installers remain at 0.1.1.",
      ),
    ).toBeVisible();
    await expect(
      dockerNotes.getByText("The eight-hour Windows test has been deferred."),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});
