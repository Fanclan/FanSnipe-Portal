import { describe, it, expect, vi, afterEach } from "vitest";
import { bytes, request, setToken, events } from "../dashboard/src/api";
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe("local transport", () => {
  it("formats actual byte counts", () => {
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1024)).toBe("1.0 KB");
    expect(bytes(1073741824)).toBe("1.0 GB");
  });
  it("sends the pairing token as a bearer header, never in the URL", async () => {
    setToken("secret-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await request("/channels");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain("secret-token");
    expect(options.headers.get("Authorization")).toBe("Bearer secret-token");
  });
  it("reports companion errors to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "Disk full" }), { status: 507 }),
        ),
    );
    await expect(request("/recordings/start")).rejects.toThrow("Disk full");
  });
  it("sends websocket authentication first", () => {
    setToken("secret-token");
    const send = vi.fn();
    let socket: any;
    vi.stubGlobal(
      "WebSocket",
      class {
        onopen: any;
        onmessage: any;
        close = vi.fn();
        send = send;
        constructor() {
          socket = this;
        }
      },
    );
    events(() => {});
    socket.onopen();
    expect(send).toHaveBeenCalledWith(
      JSON.stringify({ type: "auth", token: "secret-token" }),
    );
  });
});

describe("transport safety and recovery", () => {
  it("rejects media ticket URLs outside the companion origin", async () => {
    const { mediaUrl, base } = await import("../dashboard/src/api");
    expect(new URL(mediaUrl("/api/v1/media/ticket")).origin).toBe(
      new URL(base).origin,
    );
    expect(() => mediaUrl("https://attacker.example/media")).toThrow(
      /outside its origin/,
    );
  });
  it("preserves token on offline failures and clears it on 401", async () => {
    const { getToken } = await import("../dashboard/src/api");
    setToken("secret");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "revoked" }), { status: 401 }),
        ),
    );
    await expect(request("/channels")).rejects.toThrow("offline");
    expect(getToken()).toBe("secret");
    const listener = vi.fn();
    window.addEventListener("fansnipe:unauthorized", listener, {
      once: true,
    });
    await expect(request("/channels")).rejects.toThrow("revoked");
    expect(getToken()).toBe("");
    expect(listener).toHaveBeenCalledOnce();
  });
  it("reconnects a dropped websocket and authenticates again", () => {
    vi.useFakeTimers();
    setToken("secret");
    const sockets: any[] = [];
    vi.stubGlobal(
      "WebSocket",
      class {
        onopen: any;
        onclose: any;
        onmessage: any;
        onerror: any;
        send = vi.fn();
        close = vi.fn();
        constructor() {
          sockets.push(this);
        }
      },
    );
    const close = events(() => {});
    sockets[0].onopen();
    sockets[0].onclose();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1].onopen();
    expect(sockets[1].send).toHaveBeenCalledWith(
      JSON.stringify({ type: "auth", token: "secret" }),
    );
    close();
    vi.useRealTimers();
  });
});
