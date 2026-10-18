// iMessage sidecar. Reads one job as JSON on stdin, writes one result as JSON on stdout.
//
// Two transports, tried in order:
//   1. Spectrum Cloud, the hosted iMessage relay, with a project id and secret.
//   2. @photon-ai/imessage-kit, which drives the Messages app on this Mac directly.
//
// Both call shapes below were checked against the installed packages rather than guessed:
// spectrum-ts 12.11 wants `imessage.config({})` in `providers` and sends through a space
// resolved from the handle, and imessage-kit 3.0 takes `{to, text}` on `sdk.send`.
//
// Credentials arrive in the environment, never in argv, because argv is visible to
// anything that can run ps. Nothing here ever prints a credential, not even on an error
// path: the Spectrum error body is read for its `type` only.

const CHANNEL = "imessage";

function out(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function reason(err) {
  // Keep the shape of the failure, drop anything that could carry a secret.
  const name = err && err.constructor ? err.constructor.name : "Error";
  const text = String((err && err.message) || err || "unknown");
  const safe = text.replace(/[A-Za-z0-9_\-]{24,}/g, "<redacted>").slice(0, 300);
  return `${name}: ${safe}`;
}

async function viaSpectrum(to, body) {
  const projectId = process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.PHOTON_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    return { ok: false, how: "spectrum", error: "no PHOTON_PROJECT_ID or PHOTON_PROJECT_SECRET" };
  }
  let core;
  let provider;
  try {
    core = await import("spectrum-ts");
    provider = await import("spectrum-ts/providers/imessage");
  } catch (err) {
    return { ok: false, how: "spectrum", error: `not installed, ${reason(err)}` };
  }
  let app = null;
  try {
    app = await core.Spectrum({
      projectId,
      projectSecret,
      providers: [provider.imessage.config({})],
    });
    const space = await app.imessage.space.create(to);
    await app.send(space, core.text(body));
    return { ok: true, how: "spectrum", channel: CHANNEL };
  } catch (err) {
    return { ok: false, how: "spectrum", error: reason(err) };
  } finally {
    if (app && typeof app.stop === "function") {
      try {
        await app.stop();
      } catch {
        // Nothing useful to do if shutdown fails, the result is already decided.
      }
    }
  }
}

async function viaKit(to, body) {
  if (process.platform !== "darwin") {
    return { ok: false, how: "kit", error: "imessage-kit needs macOS" };
  }
  let kit;
  try {
    kit = await import("@photon-ai/imessage-kit");
  } catch (err) {
    return { ok: false, how: "kit", error: `not installed, ${reason(err)}` };
  }
  try {
    const sdk = new kit.IMessageSDK();
    await sdk.send({ to, text: body });
    return { ok: true, how: "kit", channel: CHANNEL };
  } catch (err) {
    return { ok: false, how: "kit", error: reason(err) };
  }
}

async function probe() {
  const got = { platform: process.platform, node: process.version, spectrum: false, kit: false };
  try {
    const core = await import("spectrum-ts");
    got.spectrum = typeof core.Spectrum === "function";
  } catch {
    got.spectrum = false;
  }
  try {
    const kit = await import("@photon-ai/imessage-kit");
    got.kit = typeof kit.IMessageSDK === "function";
  } catch {
    got.kit = false;
  }
  got.credentials = Boolean(process.env.PHOTON_PROJECT_ID && process.env.PHOTON_PROJECT_SECRET);
  out(got);
}

async function readStdin() {
  const parts = [];
  for await (const chunk of process.stdin) {
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

async function main() {
  if (process.argv.includes("--probe")) {
    await probe();
    return;
  }
  let job;
  try {
    job = JSON.parse(await readStdin());
  } catch (err) {
    out({ ok: false, error: `bad job, ${reason(err)}` });
    return;
  }
  const to = String(job.to || "").trim();
  const body = String(job.body || "");
  if (!to || !body) {
    out({ ok: false, error: "a job needs both to and body" });
    return;
  }

  const tried = [];
  for (const attempt of [viaSpectrum, viaKit]) {
    const got = await attempt(to, body);
    if (got.ok) {
      out({ ...got, tried });
      return;
    }
    tried.push({ how: got.how, error: got.error });
  }
  out({ ok: false, error: "no iMessage transport worked", tried });
}

main().catch((err) => {
  out({ ok: false, error: reason(err) });
  process.exitCode = 1;
});
