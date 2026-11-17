import React, { useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Clapperboard,
  ExternalLink,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import {
  base,
  bundled,
  bytes,
  downloadsUrl,
  mediaUrl,
  request,
  send,
} from "./api";
import { failedWithoutMedia, recordingFailure } from "./recording";
type Any = Record<string, any>;
const date = (s?: string) => (s ? new Date(s).toLocaleString() : "—");
const active = (s: string) =>
  ["queued", "starting", "recording", "stopping", "finalizing"].includes(s);
export function PageTitle({ eyebrow, title, desc, action }: any) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {action}
    </div>
  );
}
export function Stat({ icon, label, value, note }: any) {
  return (
    <div className="stat">
      <div className="stat-head">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function Empty({ icon, title, text, button }: any) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {button}
    </div>
  );
}
export function CaptureIssue({
  recording,
}: {
  recording: Parameters<typeof recordingFailure>[0];
}) {
  const failure = recordingFailure(recording);
  return failure ? <small className="failure-reason">{failure}</small> : null;
}
export function RecordRow({ r, open, stop }: any) {
  return (
    <div className="record-row">
      <button className="row-main" onClick={open}>
        <span className="row-icon">
          <Clapperboard size={19} />
        </span>
        <span>
          <b>{r.title || "Untitled recording"}</b>
          <small>
            {r.platform} · {date(r.startedAt)}
          </small>
          <CaptureIssue recording={r} />
        </span>
      </button>
      <span className={"pill " + (r.status === "recording" ? "live" : "")}>
        {r.status}
      </span>
      <span className="row-size">{bytes(r.fileSize)}</span>
      {active(r.status) && (
        <button className="secondary" onClick={stop}>
          Stop
        </button>
      )}
    </div>
  );
}
export function Modal({ title, close, children, error }: any) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.focus();
    function handle(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],video[controls],[tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === node)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
export function RecordForm({ submit }: any) {
  const [url, set] = useState(""),
    [title, t] = useState(""),
    [quality, q] = useState(""),
    [format, f] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit({
          url,
          title: title || undefined,
          ...(quality ? { quality } : {}),
          ...(format ? { format } : {}),
        });
      }}
    >
      <label>
        Stream URL
        <input
          required
          type="url"
          value={url}
          onChange={(e) => set(e.target.value)}
          placeholder="https://..."
        />
      </label>
      <label>
        Title <small>Optional</small>
        <input
          value={title}
          onChange={(e) => t(e.target.value)}
          placeholder="Give this recording a name"
        />
      </label>
      <div className="form-grid">
        <label>
          Quality
          <select value={quality} onChange={(e) => q(e.target.value)}>
            <option value="">Use saved default</option>
            {["best", "1080p", "720p", "480p", "360p"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Format
          <select value={format} onChange={(e) => f(e.target.value)}>
            <option value="">Use saved default</option>
            <option>mp4</option>
            <option>mkv</option>
            <option>ts</option>
          </select>
        </label>
      </div>
      <button className="primary" type="submit">
        Start recording
      </button>
    </form>
  );
}
export function ChannelForm({ initial, submit }: any) {
  const [data, set] = useState(
    initial
      ? {
          name: initial.name,
          url: initial.url,
          platform: initial.platform,
          quality: initial.quality,
          autoRecord: initial.autoRecord,
          enabled: initial.enabled,
        }
      : {
          name: "",
          url: "",
          quality: "best",
          autoRecord: false,
          enabled: true,
        },
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(data);
      }}
    >
      <label>
        Name
        <input
          required
          value={data.name}
          onChange={(e) => set({ ...data, name: e.target.value })}
        />
      </label>
      <label>
        Channel URL
        <input
          required
          type="url"
          value={data.url}
          onChange={(e) => set({ ...data, url: e.target.value })}
          placeholder="https://..."
        />
      </label>
      <label>
        Quality
        <select
          value={data.quality || "best"}
          onChange={(e) => set({ ...data, quality: e.target.value })}
        >
          {["best", "1080p", "720p", "480p", "360p"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={data.enabled}
          onChange={(e) => set({ ...data, enabled: e.target.checked })}
        />{" "}
        Monitor this channel
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={data.autoRecord}
          onChange={(e) => set({ ...data, autoRecord: e.target.checked })}
        />{" "}
        Automatically record when live
      </label>
      <button className="primary">Save channel</button>
    </form>
  );
}
export function ChannelDetail({
  channel: c,
  back,
  edit,
  action,
  recordings,
  openRecording,
  startRecording,
}: any) {
  const [stats, set] = useState<Any | null>(null),
    [failure, setFailure] = useState("");
  useEffect(() => {
    let cancelled = false;
    request(`/channels/${c.id}/stats`)
      .then((result) => {
        if (!cancelled) {
          set(result.stats);
          setFailure("");
        }
      })
      .catch((e) => {
        if (!cancelled) setFailure(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [c.id, recordings]);
  const safeLink = (() => {
    try {
      const u = new URL(c.url);
      return ["http:", "https:"].includes(u.protocol) ? u.href : "";
    } catch {
      return "";
    }
  })();
  return (
    <div className="detail">
      <button className="link" onClick={back}>
        ← All channels
      </button>
      <div className="detail-card">
        <div className="channel-avatar large">{c.name?.[0]}</div>
        <div>
          <h2>{c.name}</h2>
          <p>{c.url}</p>
          <span className={"pill " + (c.isLive ? "live" : "")}>
            {c.isLive ? "LIVE" : "OFFLINE"}
          </span>
        </div>
      </div>
      <div className="button-row">
        <button
          className="secondary"
          onClick={() => action(() => send(`/channels/${c.id}/check`, {}))}
        >
          <RefreshCw size={15} /> Check now
        </button>
        <button className="secondary" onClick={startRecording}>
          Record channel
        </button>
        {safeLink && (
          <a
            className="secondary"
            href={safeLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Watch on platform ↗
          </a>
        )}
        <button className="secondary" onClick={edit}>
          Edit channel
        </button>
        <button
          className="secondary"
          onClick={() =>
            action(() =>
              send(`/channels/${c.id}`, { autoRecord: !c.autoRecord }, "PATCH"),
            )
          }
        >
          Auto-record {c.autoRecord ? "on" : "off"}
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm("Delete this channel? Recordings are kept."))
              action(async () => {
                await request(`/channels/${c.id}`, { method: "DELETE" });
                back();
              });
          }}
        >
          <Trash2 size={15} /> Delete
        </button>
      </div>
      {failure && (
        <p className="alert" role="alert">
          Could not load channel statistics: {failure}
        </p>
      )}
      <div className="detail-info">
        <div>
          <small>MONITORING</small>
          <b>{c.enabled ? "Enabled" : "Paused"}</b>
        </div>
        <div>
          <small>LAST CHECKED</small>
          <b>{date(c.lastChecked)}</b>
        </div>
        <div>
          <small>RECORDINGS / COMPLETED</small>
          <b>
            {stats?.totalRecordings ?? "—"} /{" "}
            {recordings.filter((r: Any) => r.status === "completed").length}
          </b>
        </div>
        <div>
          <small>TOTAL SIZE</small>
          <b>{stats ? bytes(stats.totalSize) : "—"}</b>
        </div>
        <div>
          <small>TOTAL DURATION</small>
          <b>{stats ? `${Math.floor(stats.totalDuration / 60)} min` : "—"}</b>
        </div>
      </div>
      <div className="sectionhead">
        <h2>Recording history</h2>
      </div>
      {recordings.length ? (
        <div className="record-list">
          {recordings.map((r: Any) => (
            <RecordRow
              key={r.id}
              r={r}
              open={() => openRecording(r)}
              stop={() => action(() => send(`/recordings/${r.id}/stop`, {}))}
            />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Archive />}
          title="No recordings for this channel"
          text="Manual and automatic recordings will appear here."
        />
      )}
    </div>
  );
}
export function Thumbnail({ r }: any) {
  const [url, set] = useState("");
  useEffect(() => {
    if (r.hasThumbnail)
      send(`/recordings/${r.id}/media-ticket`, { kind: "thumbnail" })
        .then((t) => set(mediaUrl(t.url)))
        .catch(() => {});
  }, [r.id, r.hasThumbnail]);
  return (
    <div className="thumbnail">
      {url ? <img src={url} alt="" /> : <Clapperboard size={32} />}
      {!failedWithoutMedia(r) && <span aria-hidden="true">▶</span>}
    </div>
  );
}
export function SettingsPanel({
  mode,
  settings: s,
  set,
  sessions,
  reload,
  action,
  diag,
  setDiag,
  disconnect,
}: any) {
  const [key, keySet] = useState(""),
    [secret, secretSet] = useState(""),
    [touched, touchedSet] = useState<Set<string>>(new Set()),
    [saving, savingSet] = useState(false),
    [saveError, saveErrorSet] = useState(""),
    [approvalMessage, approvalMessageSet] = useState(""),
    [pendingApproval, pendingApprovalSet] = useState<Any | null>(null),
    [setupToken, setupTokenSet] = useState(""),
    [approving, approvingSet] = useState(false);
  const initial = useRef({ ...s });
  const hostedDocker = mode === "docker" && !bundled;
  const change = (k: string, v: any) => {
    touchedSet((previous) => new Set(previous).add(k));
    set({ ...s, [k]: v });
  };
  const locked = (k: string) => s.lockedFields?.includes(k);
  return (
    <>
      <form
        className="settings"
        onSubmit={(e) => {
          e.preventDefault();
          if (saving) return;
          savingSet(true);
          void (async () => {
            saveErrorSet("");
            approvalMessageSet("");
            try {
              const data: Any = Object.fromEntries(
                [...touched]
                  .filter(
                    (k) => !locked(k) && !(hostedDocker && k.startsWith("s3")),
                  )
                  .map((k) => [k, s[k]]),
              );
              const destinationKeys = [
                "s3Enabled",
                "s3Bucket",
                "s3Region",
                "s3Endpoint",
              ];
              const pureDisable =
                initial.current.s3Enabled === true &&
                s.s3Enabled === false &&
                ["s3Bucket", "s3Region", "s3Endpoint"].every(
                  (k) => s[k] === initial.current[k],
                );
              if (
                !pureDisable &&
                destinationKeys.some(
                  (k) => k in data && data[k] !== initial.current[k],
                )
              ) {
                const destination = Object.fromEntries(
                  destinationKeys.map((k) => [k, s[k]]),
                );
                const pending = await send(
                  "/settings/s3-approvals",
                  destination,
                );
                pendingApprovalSet({ ...pending, destination });
                approvalMessageSet(
                  mode === "docker"
                    ? "Approve this destination with your Docker setup token."
                    : "Approve this storage destination in the companion.",
                );
                let approved = "";
                while (Date.now() < Date.parse(pending.expiresAt)) {
                  await new Promise((resolve) => setTimeout(resolve, 1500));
                  const result = await request(
                    `/settings/s3-approvals/${pending.id}`,
                  );
                  if (result.status === "approved" && result.approvalToken) {
                    approved = result.approvalToken;
                    break;
                  }
                  if (
                    result.status === "rejected" ||
                    result.status === "expired"
                  )
                    throw new Error(
                      `Storage destination approval ${result.status}.`,
                    );
                }
                if (!approved)
                  throw new Error("Storage destination approval expired.");
                data.uploadDestinationApproval = approved;
              }
              const result = await send(
                "/settings",
                {
                  ...data,
                  ...(key && !hostedDocker && !locked("s3AccessKeyId")
                    ? { s3AccessKeyId: key }
                    : {}),
                  ...(secret && !hostedDocker && !locked("s3SecretAccessKey")
                    ? { s3SecretAccessKey: secret }
                    : {}),
                },
                "PUT",
              );
              set(result);
              initial.current = { ...result };
              keySet("");
              secretSet("");
              touchedSet(new Set());
              approvalMessageSet("Settings saved.");
              pendingApprovalSet(null);
              setupTokenSet("");
            } catch (e: any) {
              saveErrorSet(e.message);
              approvalMessageSet("");
              pendingApprovalSet(null);
              setupTokenSet("");
            } finally {
              savingSet(false);
            }
          })();
        }}
      >
        {saveError && (
          <p className="alert" role="alert">
            {saveError}
          </p>
        )}
        {approvalMessage && <p role="status">{approvalMessage}</p>}
        {mode === "docker" && pendingApproval && bundled && (
          <div className="approval-card">
            <p>
              Destination:{" "}
              <strong>{pendingApproval.destination.s3Bucket}</strong> ·{" "}
              {pendingApproval.destination.s3Region} ·{" "}
              {pendingApproval.destination.s3Endpoint || "default S3 endpoint"}
            </p>
            <label>
              Docker setup token
              <input
                type="password"
                autoComplete="off"
                value={setupToken}
                onChange={(e) => setupTokenSet(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={!setupToken || approving}
              onClick={async () => {
                approvingSet(true);
                try {
                  await request(
                    `/settings/s3-approvals/${pendingApproval.id}/approve`,
                    {
                      method: "POST",
                      headers: { "X-Setup-Token": setupToken },
                    },
                  );
                  setupTokenSet("");
                  approvalMessageSet("Destination approved. Saving settings…");
                } catch (e: any) {
                  saveErrorSet(e.message);
                } finally {
                  approvingSet(false);
                }
              }}
            >
              Approve destination
            </button>
          </div>
        )}
        <div className="settings-block">
          <div>
            <h2>Recording</h2>
            <p>Choose how new recordings are saved.</p>
          </div>
          <div className="fields">
            <label>
              Recording folder
              <input readOnly value={s.recordingsPath || ""} />
              <small>
                {mode === "desktop"
                  ? "Change this folder using the companion’s native recording folder picker. Changes apply to new recordings."
                  : "The recording folder is configured by the container or companion operator."}
              </small>
            </label>
            <div className="form-grid">
              <label>
                Default quality
                <select
                  disabled={locked("defaultQuality")}
                  value={s.defaultQuality}
                  onChange={(e) => change("defaultQuality", e.target.value)}
                >
                  {["best", "1080p", "720p", "480p", "360p"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                Format
                <select
                  disabled={locked("defaultFormat")}
                  value={s.defaultFormat}
                  onChange={(e) => change("defaultFormat", e.target.value)}
                >
                  <option>mp4</option>
                  <option>mkv</option>
                  <option>ts</option>
                </select>
              </label>
            </div>
            {[
              ["monitorIntervalSeconds", "Check interval (seconds)"],
              ["maxConcurrentRecordings", "Maximum concurrent recordings"],
              ["maxDiskUsagePercent", "Maximum disk usage (%)"],
              ["autoCleanupDays", "Keep recordings for (days)"],
            ].map(([k, l]) => (
              <label key={k}>
                {l}
                <input
                  type="number"
                  min="1"
                  disabled={locked(k)}
                  value={s[k] ?? ""}
                  onChange={(e) => change(k, Number(e.target.value))}
                />
              </label>
            ))}
            <label className="check">
              <input
                type="checkbox"
                disabled={locked("autoCleanupEnabled")}
                checked={s.autoCleanupEnabled}
                onChange={(e) => change("autoCleanupEnabled", e.target.checked)}
              />{" "}
              Enable automatic cleanup
            </label>
          </div>
        </div>
        <div className="settings-block">
          <div>
            <h2>Your storage</h2>
            <p>
              Optional direct uploads from your companion to your own
              S3-compatible storage.
            </p>
          </div>
          <div className="fields">
            {hostedDocker && (
              <p>
                Configure Docker storage in the{" "}
                <a
                  href={`${base}/app/`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  local dashboard ↗
                </a>
                .
              </p>
            )}
            <label className="check">
              <input
                type="checkbox"
                disabled={hostedDocker || locked("s3Enabled")}
                checked={s.s3Enabled}
                onChange={(e) => change("s3Enabled", e.target.checked)}
              />{" "}
              Enable S3 uploads
            </label>
            {s.s3Enabled && (
              <>
                {[
                  ["s3Bucket", "Bucket"],
                  ["s3Region", "Region"],
                  ["s3Endpoint", "Endpoint (optional)"],
                ].map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      disabled={hostedDocker || locked(k)}
                      value={s[k] || ""}
                      onChange={(e) => change(k, e.target.value)}
                    />
                  </label>
                ))}
                <label>
                  Access key ID
                  <input
                    autoComplete="off"
                    disabled={hostedDocker || locked("s3AccessKeyId")}
                    value={key}
                    onChange={(e) => keySet(e.target.value)}
                    placeholder={
                      s.hasS3Credentials
                        ? "Saved · leave blank to keep"
                        : "Access key ID"
                    }
                  />
                </label>
                <label>
                  Secret access key
                  <input
                    type="password"
                    autoComplete="new-password"
                    disabled={hostedDocker || locked("s3SecretAccessKey")}
                    value={secret}
                    onChange={(e) => secretSet(e.target.value)}
                    placeholder={
                      s.hasS3Credentials
                        ? "Saved · leave blank to keep"
                        : "Secret access key"
                    }
                  />
                </label>
              </>
            )}
          </div>
        </div>
        <div className="save-row">
          <button className="primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"} <Check size={16} />
          </button>
        </div>
      </form>
      <div className="settings-block">
        <div>
          <h2>Paired browsers</h2>
          <p>Revoke access to a browser you no longer use.</p>
        </div>
        <div className="fields">
          {sessions.length ? (
            sessions.map((session: Any) => (
              <div className="session" key={session.id}>
                <span>
                  <b>{session.name || "Browser"}</b>
                  <small>Created {date(session.createdAt)}</small>
                </span>
                <button
                  className="secondary"
                  onClick={() =>
                    action(async () => {
                      await request(`/sessions/${session.id}`, {
                        method: "DELETE",
                      });
                      await reload();
                    })
                  }
                >
                  Revoke
                </button>
              </div>
            ))
          ) : (
            <p>No paired sessions found.</p>
          )}
          <button
            className="secondary"
            onClick={() =>
              action(async () => {
                await send("/sessions/revoke", {});
                disconnect();
              })
            }
          >
            Disconnect this browser
          </button>
        </div>
      </div>
      <div className="settings-block">
        <div>
          <h2>Diagnostics & updates</h2>
          <p>Review local diagnostic information or check for a new release.</p>
        </div>
        <div className="fields">
          <div className="button-row">
            <button
              className="secondary"
              onClick={() =>
                action(async () => setDiag(await request("/diagnostics")))
              }
            >
              Show diagnostics
            </button>
            <a
              className="secondary"
              href={downloadsUrl}
              target={bundled ? "_blank" : undefined}
              rel={bundled ? "noopener noreferrer" : undefined}
            >
              Release downloads <ExternalLink size={14} />
            </a>
          </div>
          {diag && <pre>{JSON.stringify(diag, null, 2)}</pre>}
        </div>
      </div>
    </>
  );
}
