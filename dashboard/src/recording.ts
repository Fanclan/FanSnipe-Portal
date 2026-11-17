import type { Recording } from "@fanclan/fansnipe-protocol";

type Capture = Pick<Recording, "status" | "fileSize" | "error">;

export function failedWithoutMedia(recording: Capture) {
  return recording.status === "failed" && recording.fileSize === 0;
}

export function recordingFailure(recording: Capture) {
  if (recording.status !== "failed" && recording.status !== "interrupted")
    return;
  if (recording.error && recording.error !== "Recording produced no media")
    return recording.error;
  if (failedWithoutMedia(recording))
    return "No media was captured. Check that the stream is public and live, then start a new recording.";
}
