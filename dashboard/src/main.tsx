import type {
  Channel,
  CompanionInfo,
  Recording,
  Settings,
  SystemStatus,
  PairingChallenge,
  Session,
} from "@fanclan/fansnipe-protocol";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Archive,
  AudioLines,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  X,
  Grid2X2,
  HardDrive,
  LayoutDashboard,
  List,
  Plus,
  Radio,
  Settings as SettingsIcon,
  SunMoon,
} from "lucide-react";
import {
  ApiError,
  bundled,
  bytes,
  client,
  docsUrl,
  events,
  getToken,
  request,
  send,
  setToken,
} from "./api";
import { StudioAccess } from "./StudioAccess";
import { RecordingStudio } from "./RecordingStudio";
import { Player } from "./Player";
import { OperatorApproval } from "./OperatorApproval";
import {
  PageTitle,
  Stat,
  Empty,
  RecordRow,
  CaptureIssue,
  Modal,
  RecordForm,
  ChannelForm,
  ChannelDetail,
  Thumbnail,
  SettingsPanel,
} from "./components";
import "./style.css";
type Any = Record<string, any>;
const date = (s?: string) => (s ? new Date(s).toLocaleString() : "—");
function App() {
  const [theme, themeSet] = useState(
      localStorage.getItem("ss-theme") || "dark",
    ),
    [token, tokenState] = useState(getToken()),
    [info, infoSet] = useState<CompanionInfo | null>(null),
    [connect, connectSet] = useState(
      bundled ? "Checking companion…" : "Local studio",
    ),
    [pair, pairSet] = useState<PairingChallenge | null>(null),
    [error, errorSet] = useState(""),
    [page, pageSet] = useState("Overview"),
    [channels, channelsSet] = useState<Channel[]>([]),
    [recordings, recordingsSet] = useState<Recording[]>([]),
    [status, statusSet] = useState<SystemStatus | null>(null),
    [settings, settingsSet] = useState<Settings | null>(null),
    [sessions, sessionsSet] = useState<Session[]>([]),
    [diag, diagSet] = useState<Any | null>(null),
    [selected, selectedSet] = useState<Any | null>(null),
    [playerId, playerIdSet] = useState<string | null>(null),
    [modal, modalSet] = useState(""),
    [search, searchSet] = useState(""),
    [filter, filterSet] = useState("all"),
    [view, viewSet] = useState("grid"),
    [platform, platformSet] = useState("all"),
    [channelFilter, channelFilterSet] = useState("all"),
    [dateFrom, dateFromSet] = useState(""),
    [dateTo, dateToSet] = useState(""),
    [sort, sortSet] = useState("newest");
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const epoch = useRef(0);
  const clearSession = useCallback(() => {
    epoch.current++;
    setToken("");
    tokenState("");
    channelsSet([]);
    recordingsSet([]);
    statusSet(null);
    settingsSet(null);
    sessionsSet([]);
    diagSet(null);
    selectedSet(null);
    playerIdSet(null);
    pendingRefresh.current = null;
    refreshAgain.current = false;
    modalSet("");
    pairSet(null);
    pageSet("Overview");
  }, []);
  useEffect(() => {
    const handler = () => {
      clearSession();
      errorSet(
        "Your browser session expired or was revoked. Please pair again.",
      );
    };
    const storageHandler = (event: StorageEvent) => {
      if (event.key === "streamsnipe.token.v1" && !event.newValue) handler();
    };
    window.addEventListener("fansnipe:unauthorized", handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("fansnipe:unauthorized", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [clearSession]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ss-theme", theme);
  }, [theme]);
  const probe = useCallback(async () => {
    try {
      const i = await client.info();
      infoSet(i);
      connectSet(
        i.protocolVersion === 1 ? "Companion found" : "Version mismatch",
      );
      return i;
    } catch {
      infoSet(null);
      statusSet(null);
      connectSet("Companion offline or local network access blocked");
    }
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (!token || !getToken()) return Promise.resolve();
    if (pendingRefresh.current) {
      refreshAgain.current = true;
      return pendingRefresh.current;
    }
    const currentEpoch = epoch.current;
    const pending = (async () => {
      do {
        refreshAgain.current = false;
        try {
          const [c, r, s] = await Promise.all([
            client.channels(),
            client.recordings(),
            client.status(),
          ]);
          if (epoch.current !== currentEpoch) return;
          channelsSet(c);
          recordingsSet(r);
          statusSet(s);
        } catch (e: any) {
          if (
            epoch.current === currentEpoch &&
            !(e instanceof ApiError && e.status === 401)
          ) {
            statusSet(null);
            errorSet(e.message);
          }
        }
      } while (
        refreshAgain.current &&
        epoch.current === currentEpoch &&
        !!getToken()
      );
    })();
    pendingRefresh.current = pending;
    void pending.finally(() => {
      if (pendingRefresh.current === pending) pendingRefresh.current = null;
    });
    return pending;
  }, [token]);
  useEffect(() => {
    if (!bundled && !token) return;
    probe();
    const t = setInterval(probe, 15000);
    return () => clearInterval(t);
  }, [probe, token]);
  useEffect(() => {
    if (!token) return;
    refresh();
    const t = setInterval(refresh, 15000);
    let close = () => {};
    try {
      close = events(refresh);
    } catch {
      errorSet("Live updates unavailable; refreshing periodically.");
    }
    return () => {
      clearInterval(t);
      close();
    };
  }, [token, refresh]);
  useEffect(() => {
    if (page === "Settings" && token) {
      Promise.all([client.settings(), client.sessions()])
        .then(([s, ss]) => {
          settingsSet(s);
          sessionsSet(ss);
        })
        .catch((e) => errorSet(e.message));
    }
  }, [page, token]);
  useEffect(() => {
    if (!pair) return;
    let stop = false;
    const timer = setInterval(async () => {
      try {
        if (Date.now() >= Date.parse(pair.expiresAt)) {
          pairSet(null);
          errorSet("Pairing expired. Please try again.");
          return;
        }
        const p = await request(
          "/pairings/" + pair.id,
          { headers: { "X-Pairing-Token": pair.pollToken } },
          "",
        );
        if (p.status === "approved" && p.token) {
          setToken(p.token);
          tokenState(p.token);
          pairSet(null);
        } else if (p.status === "expired") {
          pairSet(null);
          errorSet("Pairing expired. Please try again.");
        }
      } catch (e: any) {
        if (!stop) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            pairSet(null);
            errorSet(
              "The pairing request is no longer available. Please pair again.",
            );
          } else errorSet(e.message);
        }
      }
    }, 1800);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [pair]);
  async function action(fn: () => Promise<any>) {
    try {
      errorSet("");
      await fn();
      if (getToken()) await refresh();
    } catch (e: any) {
      errorSet(e.message);
    }
  }
  const beginPair = () =>
    action(async () => {
      const found = info || (await probe());
      if (!found || found.protocolVersion !== 1) return;
      pairSet(
        await send("/pairings", {
          name: navigator.userAgent.includes("Chrome")
            ? "Chrome browser"
            : "Browser",
        }),
      );
    });
  const filtered = recordings
    .filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (platform === "all" || r.platform === platform) &&
        (channelFilter === "all" || r.channelId === channelFilter) &&
        (!dateFrom || r.startedAt?.slice(0, 10) >= dateFrom) &&
        (!dateTo || r.startedAt?.slice(0, 10) <= dateTo) &&
        `${r.title} ${r.platform} ${r.url}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "size"
        ? b.fileSize - a.fileSize
        : sort === "oldest"
          ? Date.parse(a.startedAt) - Date.parse(b.startedAt)
          : Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
  return (
    <div className={token ? "app" : "app locked"}>
      <aside className="sidebar">
        <a
          className="brand"
          aria-label="FanSnipe Recording Studio home"
          href={bundled ? "/app/" : "/"}
        >
          <span className="logo">
            <AudioLines size={20} />
          </span>
          <span>
            FanSnipe<small>RECORDING STUDIO</small>
          </span>
        </a>
        {token && (
          <>
            <div className="side-label">WORKSPACE</div>
            <nav>
              {[
                [LayoutDashboard, "Overview"],
                [Radio, "Channels"],
                [Archive, "Library"],
                [SettingsIcon, "Settings"],
              ].map(([Icon, label]: any) => (
                <button
                  key={label}
                  aria-label={label}
                  aria-current={page === label ? "page" : undefined}
                  onClick={() => {
                    pageSet(label);
                    selectedSet(null);
                  }}
                  className={page === label ? "selected" : ""}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  <ChevronRight size={14} className="arrow" />
                </button>
              ))}
            </nav>
          </>
        )}
        <div className="sidebottom">
          <div className="side-label">YOUR COMPANION</div>
          <div className="connection">
            <span
              className={
                "dot " + (info && info.protocolVersion === 1 ? "online" : "")
              }
            />
            <div>
              <b>
                {info && status
                  ? "Connected"
                  : info
                    ? "Companion detected"
                    : "Not connected"}
              </b>
              <small>
                {info
                  ? `v${info.version} · ${info.mode}`
                  : "Waiting on this device"}
              </small>
            </div>
          </div>
          <a
            href={docsUrl}
            target={bundled ? "_blank" : undefined}
            rel={bundled ? "noopener noreferrer" : undefined}
          >
            <CircleHelp size={16} /> Help & documentation ↗
          </a>
        </div>
      </aside>
      <main className="main">
        <header className="top">
          <div>
            <span className="crumb">STUDIO / </span>
            <span>{page.toUpperCase()}</span>
          </div>
          <div className="topright">
            <span className="topstatus">
              <span
                className={
                  "dot " + (info && info.protocolVersion === 1 ? "online" : "")
                }
              />
              {info && status && token ? "Connected" : connect}
            </span>
            <button
              className="iconbtn"
              aria-label="Toggle theme"
              onClick={() => themeSet(theme === "dark" ? "light" : "dark")}
            >
              <SunMoon size={18} />
            </button>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => errorSet("")} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}
          {!token ? (
            <StudioAccess
              info={info}
              connect={connect}
              pair={pair}
              begin={beginPair}
              probe={() => {
                errorSet("");
                return probe();
              }}
              unlocked={(value) => {
                setToken(value);
                tokenState(value);
              }}
              action={action}
            />
          ) : (
            <>
              {page === "Overview" && info?.capabilities?.sourceInspection && (
                <RecordingStudio
                  records={recordings}
                  channels={channels}
                  canPreview={!!info.capabilities.livePreview}
                  refresh={refresh}
                  library={() => pageSet("Library")}
                  play={(id) => {
                    playerIdSet(id);
                    modalSet("player");
                  }}
                  available={status?.disk?.available}
                />
              )}
              {page === "Overview" && !info && <p role="status">{connect}</p>}
              {page === "Overview" &&
                info &&
                !info.capabilities?.sourceInspection && (
                  <>
                    <PageTitle
                      eyebrow="YOUR STUDIO AT A GLANCE"
                      title="Good to see you."
                      desc="Everything happening in your recording studio."
                      action={
                        <button
                          className="primary"
                          onClick={() =>
                            info?.capabilities?.sourceInspection
                              ? pageSet("Overview")
                              : modalSet("record")
                          }
                        >
                          <Plus size={16} /> New recording
                        </button>
                      }
                    />
                    {info && (
                      <p className="compatibility-note">
                        Update your companion for automatic stream titles and
                        live previews. <a href={docsUrl}>Setup guide ↗</a>
                      </p>
                    )}
                    <div className="stats">
                      <Stat
                        icon={<Activity />}
                        label="ACTIVE RECORDINGS"
                        value={status?.activeRecordings ?? "—"}
                        note="Currently capturing"
                      />
                      <Stat
                        icon={<Archive />}
                        label="TOTAL RECORDINGS"
                        value={status?.totalRecordings ?? "—"}
                        note="In your library"
                      />
                      <Stat
                        icon={<Radio />}
                        label="CHANNELS"
                        value={status?.totalChannels ?? "—"}
                        note="Saved to your studio"
                      />
                      <Stat
                        icon={<HardDrive />}
                        label="DISK AVAILABLE"
                        value={
                          status?.disk ? bytes(status.disk.available) : "—"
                        }
                        note={
                          status?.disk
                            ? `${status.disk.usedPercent.toFixed(0)}% used`
                            : "On this device"
                        }
                      />
                    </div>
                    <div className="sectionhead">
                      <div>
                        <div className="eyebrow">RECENT ACTIVITY</div>
                        <h2>Your recordings</h2>
                      </div>
                      <button
                        className="link"
                        onClick={() => pageSet("Library")}
                      >
                        View library →
                      </button>
                    </div>
                    {recordings.length ? (
                      <div className="record-list">
                        {recordings.slice(0, 5).map((r) => (
                          <RecordRow
                            key={r.id}
                            r={r}
                            open={() => {
                              playerIdSet(r.id);
                              modalSet("player");
                            }}
                            stop={() =>
                              action(() => send(`/recordings/${r.id}/stop`, {}))
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Clapperboard />}
                        title="Your first recording starts here"
                        text="Start a recording from a stream URL, or add a channel to capture it automatically."
                        button={
                          <button
                            className="secondary"
                            onClick={() =>
                              info?.capabilities?.sourceInspection
                                ? pageSet("Overview")
                                : modalSet("record")
                            }
                          >
                            Start a recording →
                          </button>
                        }
                      />
                    )}
                  </>
                )}
              {page === "Channels" && (
                <>
                  <PageTitle
                    eyebrow="MONITOR YOUR FAVORITES"
                    title={selected ? "Channel details" : "Your channels"}
                    desc={
                      selected
                        ? "Review and manage this channel."
                        : "Keep the streams you care about close."
                    }
                    action={
                      <button
                        className="primary"
                        onClick={() => {
                          selectedSet(null);
                          modalSet("channel");
                        }}
                      >
                        <Plus size={16} /> Add channel
                      </button>
                    }
                  />
                  {selected ? (
                    <ChannelDetail
                      channel={
                        channels.find((c) => c.id === selected.id) || selected
                      }
                      back={() => selectedSet(null)}
                      edit={() => modalSet("channel")}
                      action={action}
                      recordings={recordings.filter(
                        (r) => r.channelId === selected.id,
                      )}
                      openRecording={(r: Any) => {
                        playerIdSet(r.id);
                        modalSet("player");
                      }}
                      startRecording={() =>
                        action(() =>
                          send("/recordings/start", {
                            url: selected.url,
                            channelId: selected.id,
                          }),
                        )
                      }
                    />
                  ) : channels.length ? (
                    <div className="channel-grid">
                      {channels.map((c) => (
                        <button
                          className="channel"
                          key={c.id}
                          onClick={() => selectedSet(c)}
                        >
                          <div className="channel-avatar">
                            {c.name?.slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <b>{c.name}</b>
                            <small>
                              {c.platform || "Channel"} ·{" "}
                              {c.autoRecord
                                ? "Auto-record on"
                                : "Manual recording"}
                            </small>
                          </div>
                          <span className={"pill " + (c.isLive ? "live" : "")}>
                            {c.isLive ? "LIVE" : "OFFLINE"}
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      icon={<Radio />}
                      title="No channels yet"
                      text="Add a channel to check when it goes live and optionally record automatically."
                      button={
                        <button
                          className="secondary"
                          onClick={() => modalSet("channel")}
                        >
                          Add your first channel →
                        </button>
                      }
                    />
                  )}
                </>
              )}
              {page === "Library" && (
                <>
                  <PageTitle
                    eyebrow="YOUR MOMENTS, KEPT"
                    title="The library."
                    desc="Find and revisit everything you’ve recorded."
                    action={
                      <button
                        className="primary"
                        onClick={() =>
                          info?.capabilities?.sourceInspection
                            ? pageSet("Overview")
                            : modalSet("record")
                        }
                      >
                        <Plus size={16} /> New recording
                      </button>
                    }
                  />
                  <div className="toolbar">
                    <input
                      aria-label="Search recordings"
                      placeholder="Search recordings..."
                      value={search}
                      onChange={(e) => searchSet(e.target.value)}
                    />
                    <select
                      aria-label="Filter by status"
                      value={filter}
                      onChange={(e) => filterSet(e.target.value)}
                    >
                      <option value="all">All statuses</option>
                      {[
                        "queued",
                        "starting",
                        "recording",
                        "stopping",
                        "finalizing",
                        "completed",
                        "interrupted",
                        "failed",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter by platform"
                      value={platform}
                      onChange={(e) => platformSet(e.target.value)}
                    >
                      <option value="all">All platforms</option>
                      {[
                        ...new Set(
                          recordings.map((r) => r.platform).filter(Boolean),
                        ),
                      ].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Filter by channel"
                      value={channelFilter}
                      onChange={(e) => channelFilterSet(e.target.value)}
                    >
                      <option value="all">All channels</option>
                      {channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label="From date"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => dateFromSet(e.target.value)}
                    />
                    <input
                      aria-label="To date"
                      type="date"
                      value={dateTo}
                      onChange={(e) => dateToSet(e.target.value)}
                    />
                    <select
                      aria-label="Sort recordings"
                      value={sort}
                      onChange={(e) => sortSet(e.target.value)}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="size">Largest first</option>
                    </select>
                    <button
                      className="secondary"
                      onClick={() => {
                        searchSet("");
                        filterSet("all");
                        platformSet("all");
                        channelFilterSet("all");
                        dateFromSet("");
                        dateToSet("");
                        sortSet("newest");
                      }}
                    >
                      Reset filters
                    </button>
                    <div className="viewtoggle">
                      <button
                        aria-label="Grid view"
                        onClick={() => viewSet("grid")}
                        className={view === "grid" ? "on" : ""}
                      >
                        <Grid2X2 size={17} />
                      </button>
                      <button
                        aria-label="List view"
                        onClick={() => viewSet("list")}
                        className={view === "list" ? "on" : ""}
                      >
                        <List size={17} />
                      </button>
                    </div>
                  </div>
                  {filtered.length ? (
                    <div
                      className={
                        view === "grid" ? "record-grid" : "record-list"
                      }
                    >
                      {filtered.map((r) =>
                        view === "grid" ? (
                          <button
                            className="record-card"
                            key={r.id}
                            onClick={() => {
                              playerIdSet(r.id);
                              modalSet("player");
                            }}
                          >
                            <Thumbnail r={r} />
                            <div className="record-body">
                              <span
                                className={
                                  "pill " +
                                  (r.status === "recording" ? "live" : "")
                                }
                              >
                                {r.status}
                              </span>
                              <h3>{r.title || "Untitled recording"}</h3>
                              <small>
                                {r.platform} · {date(r.startedAt)}
                              </small>
                              <CaptureIssue recording={r} />
                            </div>
                          </button>
                        ) : (
                          <RecordRow
                            key={r.id}
                            r={r}
                            open={() => {
                              playerIdSet(r.id);
                              modalSet("player");
                            }}
                            stop={() =>
                              action(() => send(`/recordings/${r.id}/stop`, {}))
                            }
                          />
                        ),
                      )}
                    </div>
                  ) : (
                    <Empty
                      icon={<Archive />}
                      title={
                        recordings.length
                          ? "No recordings match"
                          : "Your library is waiting"
                      }
                      text={
                        recordings.length
                          ? "Try a different search or status."
                          : "Completed recordings will appear here, ready to revisit."
                      }
                    />
                  )}
                </>
              )}
              {page === "Settings" && (
                <>
                  <PageTitle
                    eyebrow="MAKE IT YOURS"
                    title="Studio settings."
                    desc="Recording preferences, storage and connected browsers."
                  />
                  {settings ? (
                    <SettingsPanel
                      mode={info?.mode}
                      settings={settings}
                      set={settingsSet}
                      sessions={sessions}
                      reload={() => request("/sessions").then(sessionsSet)}
                      action={action}
                      diag={diag}
                      setDiag={diagSet}
                      disconnect={() => {
                        clearSession();
                      }}
                    />
                  ) : (
                    <p>Loading settings…</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
      {modal === "record" && (
        <Modal
          title="New recording"
          error={error}
          close={() => {
            modalSet("");
            errorSet("");
          }}
        >
          <RecordForm
            submit={(data: Any) =>
              action(async () => {
                await send("/recordings/start", data);
                modalSet("");
              })
            }
          />
        </Modal>
      )}
      {modal === "channel" && (
        <Modal
          title={selected ? "Edit channel" : "Add a channel"}
          error={error}
          close={() => {
            modalSet("");
            errorSet("");
          }}
        >
          <ChannelForm
            initial={selected}
            submit={(data: Any) =>
              action(async () => {
                const c = selected
                  ? await send("/channels/" + selected.id, data, "PATCH")
                  : await send("/channels", data);
                if (selected) selectedSet(c);
                modalSet("");
              })
            }
          />
        </Modal>
      )}
      {modal === "player" &&
        playerId &&
        recordings.find((r) => r.id === playerId) && (
          <Modal
            title={
              recordings.find((r) => r.id === playerId)?.title || "Recording"
            }
            error={error}
            close={() => {
              modalSet("");
              errorSet("");
            }}
          >
            <Player
              livePreview={!!info?.capabilities?.livePreview}
              recording={recordings.find((r) => r.id === playerId)!}
              action={action}
              close={() => modalSet("")}
            />
          </Modal>
        )}
    </div>
  );
}
const fragment = new URLSearchParams(location.hash.slice(1));
const approvalId =
  bundled && fragment.has("approve") ? (fragment.get("approve") ?? "") : null;
if (approvalId !== null)
  history.replaceState(null, "", location.pathname + location.search);
createRoot(document.getElementById("root")!).render(
  approvalId !== null ? <OperatorApproval id={approvalId} /> : <App />,
);
