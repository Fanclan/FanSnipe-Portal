import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { ApiError, bytes, mediaUrl, request, send } from "./api";
type Recording = {
  id: string;
  title: string;
  status: string;
  startedAt: string;
  fileSize: number;
  hasPreview: boolean;
  uploadedToCloud: boolean;
  uploadState?: "uploading" | "completed" | "failed" | "cancelled";
  uploadProgress?: number;
};
type Ticket = { url: string; expiresAt: string };
const active = (s: string) =>
  ["queued", "starting", "recording", "stopping", "finalizing"].includes(s);
export function Player({
  recording: r,
  action,
  close,
}: {
  recording: Recording;
  action: (fn: () => Promise<unknown>) => Promise<void>;
  close: () => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null),
    [preview, setPreview] = useState(""),
    [showPreview, setShowPreview] = useState(false),
    [message, setMessage] = useState(""),
    [uploading, setUploading] = useState(false),
    [uploaded, setUploaded] = useState(false),
    [storage, setStorage] = useState(false),
    [terminal, setTerminal] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    position = useRef({ time: 0, paused: true }),
    retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    inflight = useRef(false),
    mounted = useRef(true),
    failures = useRef(0);
  const snapshot = () => {
    if (video.current)
      position.current = {
        time: video.current.currentTime,
        paused: video.current.paused,
      };
  };
  const renew = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const t = await send(`/recordings/${r.id}/media-ticket`, {
        kind: "stream",
      });
      const url = mediaUrl(t.url);
      if (!mounted.current) return;
      snapshot();
      setTicket({ url, expiresAt: t.expiresAt });
      setMessage("");
    } catch (e: any) {
      if (mounted.current) {
        const permanent =
          e instanceof ApiError
            ? e.status >= 400 &&
              e.status < 500 &&
              e.status !== 408 &&
              e.status !== 429
            : !(e instanceof TypeError);
        failures.current++;
        if (permanent || failures.current >= 3) {
          setTerminal(true);
          setMessage(
            permanent && e instanceof ApiError && e.status === 404
              ? "Media is unavailable for this recording."
              : e.message,
          );
        } else {
          setMessage(e.message);
          retry.current = setTimeout(renew, 5000);
        }
      }
    } finally {
      inflight.current = false;
    }
  }, [r.id]);
  useEffect(() => {
    mounted.current = true;
    request("/settings")
      .then((s) =>
        setStorage(Boolean(s.s3Enabled && s.hasS3Credentials && s.s3Bucket)),
      )
      .catch(() => setStorage(false));
    return () => {
      mounted.current = false;
      clearTimeout(retry.current);
    };
  }, []);
  useEffect(() => {
    if (!active(r.status)) renew();
  }, [renew, r.status]);
  useEffect(() => {
    if (!ticket || terminal) return;
    const t = setTimeout(
      renew,
      Math.max(1000, Date.parse(ticket.expiresAt) - Date.now() - 30000),
    );
    return () => clearTimeout(t);
  }, [ticket, renew, terminal]);
  async function showImage() {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    try {
      const t = await send(`/recordings/${r.id}/media-ticket`, {
        kind: "preview",
      });
      const url = mediaUrl(t.url);
      snapshot();
      setPreview(url);
      setShowPreview(true);
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  async function download() {
    try {
      const t = await send(`/recordings/${r.id}/media-ticket`, {
        kind: "download",
      });
      const a = document.createElement("a");
      a.href = mediaUrl(t.url);
      a.download = "";
      a.click();
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  async function upload() {
    if (uploading) return;
    setUploading(true);
    try {
      await send(`/recordings/${r.id}/upload`, {});
      setUploaded(true);
      setMessage("Upload completed.");
      await action(async () => {});
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div>
      {message && (
        <p className="alert" role="status">
          {message}
        </p>
      )}
      {showPreview ? (
        <img
          className="preview-image"
          src={preview}
          alt="Preview frame from this recording"
          onError={() => setMessage("Preview could not be loaded. Try again.")}
        />
      ) : ticket ? (
        <video
          ref={video}
          key={ticket.url}
          controls
          src={ticket.url}
          onError={() => {
            const code = video.current?.error?.code;
            clearTimeout(retry.current);
            if (code === 3 || code === 4 || ++failures.current >= 3) {
              setTerminal(true);
              setMessage(
                "This recording cannot be played in this browser. You can try downloading it.",
              );
            } else {
              setMessage("Playback interrupted; renewing access…");
              retry.current = setTimeout(renew, 5000);
            }
          }}
          onLoadedMetadata={(e) => {
            failures.current = 0;
            e.currentTarget.currentTime = Math.min(
              position.current.time,
              e.currentTarget.duration || position.current.time,
            );
            if (!position.current.paused)
              e.currentTarget.play().catch(() => {});
          }}
        />
      ) : (
        <div className="player-empty">
          {active(r.status)
            ? "Recording in progress."
            : terminal
              ? "Playback unavailable."
              : "Checking for available media…"}
        </div>
      )}
      <div className="player-meta">
        <span className="pill">{r.status}</span>
        <span>
          {new Date(r.startedAt).toLocaleString()} · {bytes(r.fileSize)}
        </span>
      </div>
      <div className="button-row">
        {terminal && (
          <button
            className="secondary"
            onClick={() => {
              failures.current = 0;
              setTerminal(false);
              void renew();
            }}
          >
            Try playback again
          </button>
        )}
        {r.hasPreview && (
          <button className="secondary" onClick={showImage}>
            {showPreview ? "Full recording" : "Preview frame"}
          </button>
        )}
        {!active(r.status) && (
          <button className="secondary" onClick={download}>
            <Download size={15} /> Download
          </button>
        )}
        {active(r.status) && (
          <button
            className="secondary"
            onClick={() => action(() => send(`/recordings/${r.id}/stop`, {}))}
          >
            Stop recording
          </button>
        )}
        {!active(r.status) && (
          <button
            className="secondary"
            disabled={
              !storage ||
              uploading ||
              r.uploadState === "uploading" ||
              uploaded ||
              r.uploadedToCloud
            }
            onClick={upload}
          >
            {uploading || r.uploadState === "uploading"
              ? `Uploading${typeof r.uploadProgress === "number" ? ` ${Math.round(r.uploadProgress)}%` : "…"}`
              : uploaded || r.uploadedToCloud
                ? "Uploaded to your storage"
                : storage
                  ? "Upload to my storage"
                  : "Configure storage to upload"}
          </button>
        )}
        {r.uploadState === "failed" && (
          <span role="status">Previous upload failed. You can retry.</span>
        )}
        {!active(r.status) && (
          <button
            className="danger"
            onClick={() => {
              if (confirm("Delete this recording and its file?"))
                action(async () => {
                  await request(`/recordings/${r.id}`, { method: "DELETE" });
                  close();
                });
            }}
          >
            <Trash2 size={15} /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
