import { useEffect, useRef, useState } from "react";
import type {
  Channel,
  Recording,
  SourceInspection,
} from "@fanclan/fansnipe-protocol";
import {
  ArrowDownLeft,
  ArrowRight,
  Check,
  Circle,
  Film,
  HardDrive,
  Link2,
  Pencil,
  Radio,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { bytes, request, send } from "./api";
import { LivePreview } from "./LivePreview";
import { recordingFailure } from "./recording";

const active = (r: Recording) =>
  ["queued", "starting", "recording", "stopping", "finalizing"].includes(
    r.status,
  );
const elapsed = (start: string, end: number) => {
  const seconds = Math.max(0, Math.floor((end - Date.parse(start)) / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
};
function CaptureCard({
  r,
  withPreview,
  resumePreview,
  stop,
  play,
  library,
  retry,
}: {
  r: Recording;
  withPreview: boolean;
  resumePreview: boolean;
  stop: () => Promise<void>;
  play: () => void;
  library: () => void;
  retry: () => void;
}) {
  const [now, tick] = useState(Date.now);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active(r)) return;
    const t = setInterval(() => tick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [r.status]);
  const finishing =
    r.status === "stopping" ||
    r.status === "finalizing" ||
    (stopping && active(r));
  const label = finishing
    ? "Finishing recording"
    : r.status === "completed"
      ? "Saved to library"
      : r.status === "failed"
        ? "Recording failed"
        : r.status === "interrupted"
          ? "Recording interrupted"
          : r.status === "recording"
            ? "Recording"
            : "Starting recording";
  return (
    <article className="capture-card" aria-label={"Capture: " + r.title}>
      <header>
        <span
          className={
            "capture-state " +
            (r.status === "recording" && !finishing ? "capturing" : "")
          }
          role="status"
        >
          {r.status === "completed" ? (
            <Check size={14} />
          ) : (
            <Circle size={11} />
          )}{" "}
          {label}
        </span>
        <small>{r.platform}</small>
      </header>
      <h2>{r.title}</h2>
      <div className="capture-readings">
        <span>
          {elapsed(
            r.startedAt,
            r.completedAt ? Date.parse(r.completedAt) : now,
          )}
        </span>
        <span>{bytes(r.fileSize)} saved</span>
      </div>
      {recordingFailure(r) && (
        <p className="source-message">{recordingFailure(r)}</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="capture-controls">
        {withPreview && r.status === "recording" && !finishing && (
          <LivePreview
            source={{ recordingId: r.id }}
            initiallyOpen={resumePreview}
          />
        )}
        {active(r) ? (
          <button
            className="secondary"
            disabled={finishing}
            onClick={async () => {
              setStopping(true);
              setError("");
              try {
                await stop();
              } catch (e) {
                setStopping(false);
                setError(
                  e instanceof Error ? e.message : "Could not stop recording.",
                );
              }
            }}
          >
            <Square size={14} />
            Stop recording
          </button>
        ) : (
          <>
            {!!r.fileSize && (
              <button className="primary" onClick={play}>
                <Film size={16} />
                Play recording
              </button>
            )}
            {(r.status === "failed" || r.status === "interrupted") && (
              <button className="secondary" onClick={retry}>
                Retry
              </button>
            )}
            <button className="link" onClick={library}>
              View in library <ArrowRight size={14} />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export function RecordingStudio({
  records,
  channels,
  canPreview,
  refresh,
  library,
  play,
  available,
}: {
  records: Recording[];
  channels: Channel[];
  canPreview: boolean;
  refresh: () => Promise<void>;
  library: () => void;
  play: (id: string) => void;
  available?: number;
}) {
  const [watching, setWatching] = useState(false);
  const [resumeId, setResumeId] = useState("");
  const [url, setUrl] = useState("");
  const [version, setVersion] = useState(0);
  const [source, setSource] = useState<SourceInspection | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const [pending, setPending] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [quality, setQuality] = useState("");
  const [format, setFormat] = useState("");
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [selectedId, setSelectedId] = useState(
    () => sessionStorage.getItem("fansnipe.capture") || "",
  );
  const input = useRef<HTMLInputElement>(null);
  const change = (value: string) => {
    setUrl(value);
    if (value.trim() === url.trim()) return;
    setVersion(0);
    setTitle(null);
    setSource(null);
    setInspectionError("");
    setMessage("");
    setSaved(false);
  };
  const link = url.trim();
  const valid =
    URL.canParse(link) && ["http:", "https:"].includes(new URL(link).protocol);
  useEffect(() => {
    if (!valid) {
      setPending(false);
      return;
    }
    const ctl = new AbortController();
    setPending(true);
    const timer = setTimeout(async () => {
      try {
        const s = await request<SourceInspection>("/sources/inspect", {
          method: "POST",
          body: JSON.stringify({
            url: link,
            ...(version ? { refresh: true } : {}),
          }),
          signal: ctl.signal,
        });
        if (!ctl.signal.aborted) setSource(s);
      } catch (e) {
        if (!ctl.signal.aborted)
          setInspectionError(
            e instanceof Error ? e.message : "Could not check this source.",
          );
      } finally {
        if (!ctl.signal.aborted) setPending(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [link, valid, version]);
  function inspectAgain() {
    setSource(null);
    setInspectionError("");
    setMessage("");
    setVersion((v) => v + 1);
  }
  const busy = useRef(false);
  async function act(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setActing(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      busy.current = false;
      setActing(false);
    }
  }
  const start = () =>
    act(async () => {
      const row = await send("/recordings/start", {
        url: link,
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(quality ? { quality } : {}),
        ...(format ? { format } : {}),
      });
      if (watching) setResumeId(row.id);
      sessionStorage.setItem("fansnipe.capture", row.id);
      setSelectedId(row.id);
      change("");
      await refresh();
    });
  const selected = records.find((r) => r.id === selectedId) ?? records[0];
  const cards = records.filter(active);
  if (selected && !active(selected)) cards.push(selected);
  const fallback = valid
    ? (source?.creator ||
        new URL(link).pathname.split("/").filter(Boolean).pop() ||
        new URL(link).hostname) +
      " · " +
      new Date().toLocaleDateString()
    : "";
  const displayTitle = source?.title || fallback;
  const playable = source && ["live", "available"].includes(source.status);
  const knownChannel =
    saved ||
    channels.some((c) => c.url.replace(/\/$/, "") === link.replace(/\/$/, ""));
  const stateText = source
    ? {
        live: "Live now",
        offline: "Offline",
        available: "Available",
        unknown: "Status unknown",
        restricted: "Restricted",
        unsupported: "Unsupported",
      }[source.status]
    : "";
  return (
    <section className="studio-journey">
      <header className="journey-header">
        <h1>Recording studio</h1>
        {available !== undefined && (
          <span>
            <HardDrive size={15} />
            {bytes(available)} free
          </span>
        )}
      </header>
      <div className="source-panel">
        <label className="source-label" htmlFor="stream-source">
          Paste a stream link
        </label>
        <div className="source-input">
          <Link2 size={19} />
          <input
            id="stream-source"
            ref={input}
            type="url"
            value={url}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…"
            onChange={(e) => change(e.target.value)}
            disabled={acting}
          />
        </div>
        {!url && (
          <p className="source-help">
            Check the stream, preview it, and record to this device.
          </p>
        )}
        {!!url && !valid && (
          <p className="source-help">Enter a complete stream or channel URL.</p>
        )}
        {pending && (
          <p className="source-help" role="status">
            Checking stream…
          </p>
        )}
        {inspectionError && (
          <div className="source-result">
            <p role="alert">{inspectionError}</p>
            <button className="secondary" onClick={inspectAgain}>
              Check again
            </button>
          </div>
        )}
        {source && (
          <div className="source-result">
            <div className="source-byline">
              <span
                className={
                  source.status === "live"
                    ? "source-status onair"
                    : "source-status"
                }
              >
                <Radio size={14} />
                {stateText}
              </span>
              <span>{source.platform}</span>
              {source.creator && <span>{source.creator}</span>}
            </div>
            {title !== null ? (
              <label>
                Recording title
                <input
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            ) : (
              <div className="source-title">
                <h2>{displayTitle}</h2>
                {playable && (
                  <button
                    className="iconbtn"
                    aria-label="Edit title"
                    onClick={() => setTitle(displayTitle)}
                  >
                    <Pencil size={15} />
                  </button>
                )}
              </div>
            )}
            {source.reason && <p className="source-message">{source.reason}</p>}
            {playable && (
              <>
                <details className="record-options">
                  <summary>
                    <SlidersHorizontal size={14} />
                    Recording options
                  </summary>
                  <div className="form-grid">
                    <label>
                      Quality
                      <select
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                      >
                        <option value="">Saved default</option>
                        {["best", "1080p", "720p", "480p", "360p"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Format
                      <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                      >
                        <option value="">Saved default</option>
                        {["mp4", "mkv", "ts"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </details>
                <div className="source-actions">
                  <button
                    className="primary record-button"
                    onClick={start}
                    disabled={acting}
                  >
                    <Circle size={14} fill="currentColor" />
                    {acting ? "Starting…" : "Record"}
                  </button>
                  {canPreview && (
                    <LivePreview
                      key={link}
                      source={{ url: link }}
                      onWatching={setWatching}
                    />
                  )}
                </div>
              </>
            )}
            {!playable && (
              <div className="source-actions">
                <button className="secondary" onClick={inspectAgain}>
                  Check again
                </button>
                {source.status === "offline" && (
                  <button
                    className="secondary"
                    disabled={knownChannel || acting}
                    onClick={() =>
                      act(async () => {
                        await send("/channels", {
                          url: link,
                          name: source.creator || source.title || fallback,
                          enabled: true,
                          autoRecord: false,
                        });
                        setSaved(true);
                        await refresh();
                      })
                    }
                  >
                    {knownChannel ? "Channel saved" : "Save channel"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {message && (
          <p className="source-message" role="alert">
            {message}
          </p>
        )}
      </div>
      {cards.map((r) => (
        <CaptureCard
          key={r.id}
          r={r}
          withPreview={canPreview}
          resumePreview={r.id === resumeId}
          stop={async () => {
            await send("/recordings/" + r.id + "/stop", {});
            await refresh();
          }}
          play={() => play(r.id)}
          library={library}
          retry={() => {
            change(r.url);
            setQuality(r.quality);
            setFormat(r.format);
            setVersion((v) => v + 1);
            input.current?.focus();
            input.current?.scrollIntoView({ block: "center" });
          }}
        />
      ))}
      {records.length > 0 && (
        <section className="journey-recent">
          <header>
            <h2>Recent recordings</h2>
            <button className="link" onClick={library}>
              View library <ArrowRight size={14} />
            </button>
          </header>
          {records.slice(0, 5).map((r) => (
            <button
              key={r.id}
              className="journey-row"
              onClick={() => play(r.id)}
            >
              <span className="row-icon">
                <Film size={19} />
              </span>
              <span>
                <strong>{r.title}</strong>
                <small>
                  {r.platform} · {new Date(r.startedAt).toLocaleDateString()}
                </small>
              </span>
              <span className="journey-status">{r.status}</span>
              <ArrowDownLeft size={16} />
            </button>
          ))}
        </section>
      )}
    </section>
  );
}
