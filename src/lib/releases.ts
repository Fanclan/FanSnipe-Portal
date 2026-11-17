import manifest from "../data/releases.json";

export type Artifact = { label: string; url: string; sha256: string };
export type Release = {
  version: string;
  date: string;
  /** This attests to the listed checksums and release evidence, not code signing. */
  verified: true;
  stage: "beta" | "stable";
  signingStatus?: "unsigned" | "signed" | "mixed";
  windowsEightHourSoak?: "deferred" | "passed" | "not-run";
  notes: string[];
  artifacts: Artifact[];
  releaseUrl?: string;
  verificationUrl?: string;
  checksumsUrl?: string;
  container?: { reference: string; digest: string };
};

/** Suppress incomplete releases and beta entries missing their signing or Windows test status. */
export function isPublishableRelease(value: unknown): value is Release {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (
    r.verified !== true ||
    typeof r.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(r.version) ||
    typeof r.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date) ||
    !["beta", "stable"].includes(String(r.stage))
  )
    return false;
  if (r.stage === "stable" && r.version.includes("-")) return false;
  if (
    r.stage === "beta" &&
    (!["unsigned", "signed", "mixed"].includes(String(r.signingStatus)) ||
      !["deferred", "passed", "not-run"].includes(
        String(r.windowsEightHourSoak),
      ))
  )
    return false;
  if (
    r.signingStatus !== undefined &&
    !["unsigned", "signed", "mixed"].includes(String(r.signingStatus))
  )
    return false;
  if (
    r.windowsEightHourSoak !== undefined &&
    !["deferred", "passed", "not-run"].includes(String(r.windowsEightHourSoak))
  )
    return false;
  for (const key of ["releaseUrl", "verificationUrl", "checksumsUrl"]) {
    if (r[key] !== undefined) {
      try {
        const url = new URL(String(r[key]));
        if (url.protocol !== "https:" || url.username || url.password)
          return false;
      } catch {
        return false;
      }
    }
  }
  if (r.container !== undefined) {
    if (!r.container || typeof r.container !== "object") return false;
    const container = r.container as Record<string, unknown>;
    if (
      typeof container.reference !== "string" ||
      !/^ghcr\.io\/[a-z0-9._/-]+:[a-zA-Z0-9._-]+$/.test(container.reference) ||
      typeof container.digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(container.digest)
    )
      return false;
  }
  if (
    !Array.isArray(r.notes) ||
    !r.notes.every((note) => typeof note === "string" && note.trim()) ||
    !Array.isArray(r.artifacts) ||
    r.artifacts.length === 0
  )
    return false;
  return r.artifacts.every((item: unknown) => {
    if (!item || typeof item !== "object") return false;
    const a = item as Record<string, unknown>;
    try {
      if (typeof a.url !== "string") return false;
      const url = new URL(a.url);
      return (
        typeof a.label === "string" &&
        !!a.label.trim() &&
        typeof a.sha256 === "string" &&
        /^[a-f0-9]{64}$/i.test(a.sha256) &&
        url.protocol === "https:" &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  });
}

export function releaseStatus(release: Release): string[] {
  const status: string[] = [];
  if (release.signingStatus === "unsigned")
    status.push("This release is unsigned.");
  if (release.signingStatus === "signed")
    status.push("This release is signed.");
  if (release.signingStatus === "mixed")
    status.push("Signing varies by artifact; see the release notes.");
  if (release.windowsEightHourSoak === "deferred")
    status.push("The eight-hour Windows test has been deferred.");
  if (release.windowsEightHourSoak === "not-run")
    status.push("The eight-hour Windows test has not been run.");
  if (release.windowsEightHourSoak === "passed")
    status.push("The eight-hour Windows test passed.");
  return status;
}

export const releases: Release[] = (manifest.releases as unknown[]).filter(
  isPublishableRelease,
);
