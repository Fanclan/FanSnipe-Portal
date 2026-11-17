import { useState } from "react";
import { ArrowRight, HardDrive, KeyRound, RefreshCw } from "lucide-react";
import type {
  CompanionInfo,
  PairingChallenge,
} from "@fanclan/fansnipe-protocol";
import { DEFAULT_BASE, base, bundled, docsUrl, request } from "./api";

function PasswordFile() {
  const [password, changePassword] = useState("");
  const [confirmation, changeConfirmation] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="unlock-form"
      onSubmit={(event) => {
        event.preventDefault();
        const n = new TextEncoder().encode(password).length;
        if (n < 8 || n > 1024 || /[\r\n\0]/.test(password)) {
          setMessage(
            "Choose a password between 8 and 1024 UTF-8 bytes on one line.",
          );
          return;
        }
        if (password !== confirmation) {
          setMessage("The passwords do not match.");
          return;
        }
        const href = URL.createObjectURL(
          new Blob([password, "\n"], { type: "application/octet-stream" }),
        );
        const a = document.createElement("a");
        a.href = href;
        a.download = "fansnipe_studio_password";
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 2000);
        changePassword("");
        changeConfirmation("");
        setMessage(
          "Move the downloaded file into the setup folder mounted in Docker, then select Check again.",
        );
      }}
    >
      <label>
        Choose a studio password
        <input
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => changePassword(e.target.value)}
        />
      </label>
      <label>
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirmation}
          onChange={(e) => changeConfirmation(e.target.value)}
        />
      </label>
      <button className="primary">Save setup password file</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}

export function StudioAccess({
  info,
  connect,
  pair,
  begin,
  probe,
  unlocked,
  action,
}: {
  info: CompanionInfo | null;
  connect: string;
  pair: PairingChallenge | null;
  begin: () => Promise<void>;
  probe: () => Promise<unknown>;
  unlocked: (token: string) => void;
  action: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [pending, setPending] = useState(false);
  const passwordMode =
    bundled &&
    info?.mode === "docker" &&
    info.protocolVersion === 1 &&
    info.capabilities?.studioPassword;
  const secure =
    location.protocol === "https:" ||
    (location.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname));
  const heading = !bundled
    ? "Open your studio"
    : passwordMode && !secure
      ? "Open the secure studio"
      : passwordMode
        ? info?.studioPasswordConfigured
          ? "Unlock your studio"
          : "Set a studio password"
        : "Connect your studio";
  const operatorPair = !!info?.mode && info.mode === "docker" && bundled;
  const description = !bundled
    ? "Your companion saves your recordings on its own device. Open its studio to start a recording."
    : passwordMode && !secure
      ? "Use your configured HTTPS studio address, or open the studio on the Docker host."
      : passwordMode
        ? info?.studioPasswordConfigured
          ? "Enter the password you chose for this companion. This browser will remember its session."
          : "Save your password file in the setup folder mounted in Docker. Only people who can read that file should have access to it."
        : "Authorize this browser to access the companion’s channels and recordings.";
  return (
    <section className="studio-access">
      <div className="access-identity">
        <span className="access-symbol">
          {passwordMode ? <KeyRound size={24} /> : <HardDrive size={24} />}
        </span>
        <h1>{heading}</h1>
        <p>{description}</p>
      </div>
      {!bundled && (
        <a className="primary launch-studio" href={DEFAULT_BASE + "/app/"}>
          Open local studio <ArrowRight size={17} />
        </a>
      )}
      {passwordMode && secure && info?.studioPasswordConfigured && (
        <form
          className="unlock-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pending) return;
            setPending(true);
            try {
              await action(async () => {
                const result = await request<{ token: string }>(
                  "/studio/unlock",
                  {
                    method: "POST",
                    body: JSON.stringify({ password, name: "Studio browser" }),
                  },
                  "",
                );
                setPassword("");
                unlocked(result.token);
              });
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            Studio password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={pending}>
            Unlock studio <ArrowRight size={16} />
          </button>
        </form>
      )}
      {passwordMode && secure && !info?.studioPasswordConfigured && (
        <>
          <PasswordFile />
          <p className="setup-hint">
            <a className="secondary" href={docsUrl + "#docker-setup"}>
              Password setup guide
            </a>
          </p>
        </>
      )}
      {passwordMode && !secure && (
        <a className="secondary" href={docsUrl}>
          Open setup guide
        </a>
      )}
      <div className="access-alternate">
        {!passwordMode && (
          <>
            <h2>{!bundled ? "Connect from this website" : connect}</h2>
            {!bundled && (
              <p>
                For desktop companions and Docker installations with hosted
                access enabled.
              </p>
            )}
            {connect ===
              "Companion offline or local network access blocked" && (
              <p role="status">
                Start the companion and allow local network access in your
                browser, then check again.
              </p>
            )}
            {info && info.protocolVersion !== 1 && (
              <p>
                This studio needs a compatible companion. Update the companion
                and check again.
              </p>
            )}
          </>
        )}
        {pair ? (
          <div className="pair-code">
            <small>MATCH THIS CODE IN YOUR COMPANION</small>
            <strong>{pair.code}</strong>
            <span>
              Waiting for approval until{" "}
              {new Date(pair.expiresAt).toLocaleTimeString()}.
            </span>
          </div>
        ) : (
          (!passwordMode || (secure && !info?.studioPasswordConfigured)) && (
            <button
              className="secondary"
              disabled={
                pending ||
                (bundled && !info) ||
                (!!info && info.protocolVersion !== 1)
              }
              onClick={async () => {
                setPending(true);
                try {
                  await begin();
                } finally {
                  setPending(false);
                }
              }}
            >
              {passwordMode
                ? "Pair this browser with the existing setup key"
                : "Pair this browser"}
            </button>
          )
        )}
        {pair && info?.mode === "docker" && !bundled && (
          <a
            className="secondary"
            href={base + "/app/#approve=" + encodeURIComponent(pair.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Approve in local dashboard ↗
          </a>
        )}
        {pair && operatorPair && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                try {
                  await request(
                    "/pairings/" + pair.id + "/approve",
                    { method: "POST", headers: { "X-Setup-Token": setupKey } },
                    "",
                  );
                } finally {
                  setSetupKey("");
                }
              });
            }}
          >
            <label>
              Docker setup token
              <input
                required
                type="password"
                value={setupKey}
                onChange={(e) => setSetupKey(e.target.value)}
              />
            </label>
            <button className="secondary">Approve pairing</button>
          </form>
        )}
        {(!info ||
          (passwordMode && !info.studioPasswordConfigured) ||
          info.protocolVersion !== 1) && (
          <button className="secondary" onClick={probe}>
            <RefreshCw size={14} /> Check again
          </button>
        )}
      </div>
      <a className="help" href={docsUrl}>
        Setup and troubleshooting ↗
      </a>
    </section>
  );
}
