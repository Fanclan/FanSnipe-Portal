import React, { useEffect, useState } from "react";
import { request } from "./api";

type Pending = {
  id: string;
  name: string;
  code: string;
  origin: string | null;
  expiresAt: string;
};
export function OperatorApproval({ id }: { id: string }) {
  const [token, setToken] = useState(""),
    [pending, setPending] = useState<Pending | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const valid = /^[A-Za-z0-9_-]{1,128}$/.test(id);
  useEffect(() => {
    if (!pending) return;
    const delay = Date.parse(pending.expiresAt) - Date.now();
    const timer = setTimeout(
      () => {
        setPending(null);
        setToken("");
        setConfirmed(false);
        setMessage(
          "This pairing request has expired. Start a new request from the hosted studio.",
        );
      },
      Math.max(0, delay),
    );
    return () => clearTimeout(timer);
  }, [pending]);
  async function review(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !token || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const data = await request<Pending>(
        `/pairings/${encodeURIComponent(id)}/pending`,
        { headers: { "X-Setup-Token": token } },
        "",
      );
      if (
        data.id !== id ||
        typeof data.name !== "string" ||
        typeof data.code !== "string" ||
        (data.origin !== null && typeof data.origin !== "string") ||
        !Number.isFinite(Date.parse(data.expiresAt)) ||
        Date.parse(data.expiresAt) <= Date.now()
      )
        throw new Error(
          "This pairing request is invalid or expired. Start again.",
        );
      setPending(data);
      setConfirmed(false);
    } catch (e: any) {
      setToken("");
      setPending(null);
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!pending || !confirmed || busy) return;
    if (Date.parse(pending.expiresAt) <= Date.now()) {
      setPending(null);
      setToken("");
      setMessage("This pairing request has expired. Start again.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await request(
        `/pairings/${encodeURIComponent(id)}/approve`,
        { method: "POST", headers: { "X-Setup-Token": token } },
        "",
      );
      setToken("");
      setPending(null);
      setConfirmed(false);
      setDone(true);
    } catch (e: any) {
      setToken("");
      setPending(null);
      setConfirmed(false);
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="content">
      <div className="pair-page">
        <div className="eyebrow">LOCAL OPERATOR APPROVAL</div>
        <h1>Approve browser pairing.</h1>
        {done ? (
          <>
            <p role="status">
              Pairing approved. Return to the hosted studio to continue.
            </p>
            <a className="secondary" href="/app/">
              Open local studio
            </a>
          </>
        ) : (
          <>
            <p>
              Enter the setup token on this local dashboard to inspect the
              request. Compare its code with the hosted studio before approving.
            </p>
            {message && (
              <p className="alert" role="alert">
                {message}
              </p>
            )}
            {!valid ? (
              <p role="alert">
                Invalid pairing request. Start again from the hosted studio.
              </p>
            ) : pending ? (
              <div className="pair-card">
                <div>
                  <p>
                    Browser: <strong>{pending.name}</strong>
                  </p>
                  <p>
                    Requesting origin:{" "}
                    <strong>
                      {pending.origin ?? "No browser origin supplied"}
                    </strong>
                  </p>
                  <p>Expires: {new Date(pending.expiresAt).toLocaleString()}</p>
                  <div className="pair-code">
                    <small>COMPARE THIS CODE WITH THE HOSTED STUDIO</small>
                    <strong>{pending.code}</strong>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />{" "}
                    The codes match and I recognize this request
                  </label>
                  <button
                    className="primary"
                    disabled={!confirmed || busy}
                    onClick={approve}
                  >
                    Approve pairing
                  </button>
                </div>
              </div>
            ) : (
              <form className="pair-card" onSubmit={review}>
                <div>
                  <label>
                    Docker setup token
                    <input
                      type="password"
                      autoComplete="off"
                      required
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </label>
                  <p>
                    Find the token inside your Docker container at{" "}
                    <code>/data/setup-token</code>.
                  </p>
                  <button className="primary" disabled={busy}>
                    Review request
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
