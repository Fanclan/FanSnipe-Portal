import { describe, expect, it } from "vitest";
import {
  isPublishableRelease,
  releaseStatus,
} from "../src/lib/releases";
const beta = {
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
};
describe("release publication gate", () => {
  it("keeps the empty manifest empty and rejects beta entries without explicit status", () => {
    const emptyFixture: unknown[] = [];
    expect(emptyFixture.filter(isPublishableRelease)).toEqual([]);
    expect(isPublishableRelease({ ...beta, signingStatus: undefined })).toBe(
      false,
    );
    expect(
      isPublishableRelease({ ...beta, windowsEightHourSoak: undefined }),
    ).toBe(false);
    expect(isPublishableRelease({ ...beta, stage: "stable" })).toBe(false);
  });
  it("keeps checksum verification separate from signing and test status", () => {
    expect(isPublishableRelease(beta)).toBe(true);
    if (isPublishableRelease(beta))
      expect(releaseStatus(beta)).toEqual([
        "This release is unsigned.",
        "The eight-hour Windows test has been deferred.",
      ]);
    expect(isPublishableRelease({ ...beta, verified: false })).toBe(false);
    expect(
      isPublishableRelease({
        ...beta,
        artifacts: [{ ...beta.artifacts[0], sha256: "bad" }],
      }),
    ).toBe(false);
    expect(
      isPublishableRelease({
        ...beta,
        artifacts: [
          {
            ...beta.artifacts[0],
            url: "https://user:secret@example.test/file",
          },
        ],
      }),
    ).toBe(false);
  });
});
