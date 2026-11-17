import { useEffect, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { getToken, mediaUrl, request } from "./api";

import type {
  LivePreviewTicket,
  StartPreview,
} from "@fanclan/fansnipe-protocol";

export function LivePreview({
  source,
  initiallyOpen = false,
  onWatching,
}: {
  source: Exclude<StartPreview, { previewId: string }>;
  onWatching?: (value: boolean) => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    onWatching?.(open);
    return () => onWatching?.(false);
  }, [open, onWatching]);
  const sourceBody = JSON.stringify(source);
  useEffect(() => {
    const video = videoRef.current;
    if (!open || !video) return;
    let cancelled = false;
    let id = "";
    let timer: ReturnType<typeof setTimeout>;
    let player: import("hls.js").default | undefined;
    const token = getToken();
    const release = (previewId: string) =>
      request(
        "/previews/" + encodeURIComponent(previewId),
        { method: "DELETE", keepalive: true },
        token,
      ).catch(() => {});
    const stop = () => {
      cancelled = true;
      clearTimeout(timer);
      player?.destroy();
      player = undefined;
      video.removeAttribute("src");
      video.load();
      if (id) void release(id);
      id = "";
    };
    const fail = (error: unknown) => {
      if (cancelled) return;
      setMessage(
        error instanceof Error ? error.message : "Live preview is unavailable.",
      );
      setOpen(false);
    };
    async function load(renew = false) {
      try {
        const ticket = await request<LivePreviewTicket>(
          "/previews",
          {
            method: "POST",
            body: renew ? JSON.stringify({ previewId: id }) : sourceBody,
          },
          token,
        );
        if (cancelled) {
          void release(ticket.id);
          return;
        }
        id = ticket.id;
        const url = mediaUrl(ticket.url);
        const { default: Hls, FetchLoader } = await import("hls.js");
        if (cancelled) return;
        if (Hls.isSupported()) {
          if (!player) {
            player = new Hls({
              enableWorker: false,
              loader: FetchLoader,
              fetchSetup(context, init) {
                return new Request(mediaUrl(context.url), {
                  ...init,
                  redirect: "error",
                  referrerPolicy: "no-referrer",
                  credentials: "omit",
                });
              },
              backBufferLength: 6,
              maxBufferLength: 12,
            });
            player.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal)
                fail(
                  new Error(
                    "Live preview could not play this stream. You can still record it.",
                  ),
                );
            });
            player.attachMedia(video!);
          }
          player.loadSource(url);
        } else if (video!.canPlayType("application/vnd.apple.mpegurl")) {
          video!.src = url;
        } else
          throw Error(
            "This browser cannot play the live preview. Recording is still available.",
          );
        timer = setTimeout(
          () => void load(true),
          Math.max(1000, Date.parse(ticket.expiresAt) - Date.now() - 15000),
        );
      } catch (error) {
        fail(error);
      }
    }
    void load();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [open, sourceBody]);
  return (
    <div className="live-view">
      {open ? (
        <div className="live-monitor">
          <header>
            <span>
              <i className="live-led" /> Live preview
            </span>
            <button
              type="button"
              className="iconbtn"
              aria-label="Close preview"
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </button>
          </header>
          <video
            ref={videoRef}
            aria-label="Live stream preview"
            controls
            autoPlay
            muted
            playsInline
            onCanPlay={() => setReady(true)}
            onError={() => {
              if (videoRef.current?.error && videoRef.current.currentSrc) {
                setMessage(
                  "This stream cannot be previewed in this browser. You can still record it.",
                );
                setOpen(false);
              }
            }}
          />
          {!ready && <small role="status">Buffering live video…</small>}
        </div>
      ) : (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setMessage("");
            setReady(false);
            setOpen(true);
          }}
        >
          <Play size={15} />
          Play preview
        </button>
      )}
      {message && (
        <p role="status" className="source-message">
          {message}
        </p>
      )}
    </div>
  );
}
