import type {
  Channel,
  Recording,
  Settings,
  SystemStatus,
  Session,
  CompanionInfo,
  PairingChallenge,
  MediaTicket,
  MediaKind,
} from "@fanclan/fansnipe-protocol";
export const DEFAULT_BASE = "http://127.0.0.1:47821";
export const bundled =
  document
    .querySelector("meta[name=fansnipe-transport]")
    ?.getAttribute("content") === "local";
export const base = bundled ? location.origin : DEFAULT_BASE;
export const root = base + "/api/v1";
const tokenKey = "streamsnipe.token.v1";
export const getToken = () => localStorage.getItem(tokenKey) || "";
export const setToken = (token: string) =>
  token
    ? localStorage.setItem(tokenKey, token)
    : localStorage.removeItem(tokenKey);
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T = any>(
  path: string,
  options: RequestInit = {},
  token = getToken(),
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(root + path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token && token === getToken()) {
      setToken("");
      window.dispatchEvent(new Event("fansnipe:unauthorized"));
    }
    throw new ApiError(
      data.error || `Request failed (${response.status})`,
      response.status,
    );
  }
  return data;
}
export const send = (path: string, data: unknown, method = "POST") =>
  request(path, { method, body: JSON.stringify(data) });
/** Media must remain on the paired companion, including when the engine returns a relative Docker URL. */
export function mediaUrl(value: string) {
  const url = new URL(value, base);
  if (
    url.origin !== new URL(base).origin ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Companion returned a media URL outside its origin.");
  return url.href;
}
export function events(onUpdate: () => void) {
  let stopped = false,
    ws: WebSocket | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    attempt = 0;
  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(root.replace(/^http/, "ws") + "/events");
      ws.onopen = () => {
        attempt = 0;
        ws?.send(JSON.stringify({ type: "auth", token: getToken() }));
        onUpdate();
      };
      ws.onmessage = () => onUpdate();
      ws.onclose = () => {
        if (!stopped)
          timer = setTimeout(
            connect,
            Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)),
          );
      };
      ws.onerror = () => ws?.close();
    } catch {
      if (!stopped)
        timer = setTimeout(
          connect,
          Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)),
        );
    }
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}
export const bytes = (n: number) =>
  !n
    ? "0 B"
    : `${(n / 1024 ** Math.min(4, Math.floor(Math.log(n) / Math.log(1024)))).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][Math.min(4, Math.floor(Math.log(n) / Math.log(1024)))]}`;

export const client = {
  info: () => request<CompanionInfo>("/info", {}, ""),
  channels: () => request<Channel[]>("/channels"),
  recordings: () => request<Recording[]>("/recordings"),
  status: () => request<SystemStatus>("/status"),
  settings: () => request<Settings>("/settings"),
  sessions: () => request<Session[]>("/sessions"),
  pair: (name: string) =>
    request<PairingChallenge>(
      "/pairings",
      { method: "POST", body: JSON.stringify({ name }) },
      "",
    ),
  media: (id: string, kind: MediaKind) =>
    request<MediaTicket>(`/recordings/${id}/media-ticket`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    }),
};

declare const __PUBLIC_SITE_URL__: string;
export const docsUrl = bundled
  ? __PUBLIC_SITE_URL__
    ? new URL("/docs/", __PUBLIC_SITE_URL__).href
    : "https://github.com/Fanclan/FanSnipe-Companion#readme"
  : "/docs/";
export const downloadsUrl = bundled
  ? __PUBLIC_SITE_URL__
    ? new URL("/downloads/", __PUBLIC_SITE_URL__).href
    : "https://github.com/Fanclan/FanSnipe-Companion/releases"
  : "/downloads/";
