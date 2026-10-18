// iMessage sidecar. Reads one job as JSON on stdin, writes one result as JSON on stdout.
//
// Two transports, tried in order:
//   cloud  Spectrum Cloud, the hosted relay. Needs a project that owns an iMessage line.
//   local  @spectrum-ts/imessage-local, driving Messages on this Mac. Needs the terminal
//          to have Full Disk Access so it can read ~/Library/Messages/chat.db.
//
// The call shape below was checked against the installed packages and the Photon docs,
// not guessed, and the earlier version had it wrong in two places: it passed the raw
// phone string to `space.create` instead of resolving it to a user first, and it sent
// through `app.send(space, text(body))` instead of `space.send(body)`. Both of those
// reach the API and neither reaches a person.
//
// Accepted is not delivered. A send returns a provider message id; `--status` polls that
// id and reports `isDelivered`, which is the only thing that justifies telling somebody
// their message arrived.
//
// Credentials arrive in the environment, never in argv, because argv is visible to
// anything that can run ps. Nothing here prints a credential on any path.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const CHANNEL = "imessage";
const need = createRequire(import.meta.url);

function out(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

/** An error reduced to its shape, with anything token-shaped removed. */
function reason(err) {
  const kind = err && err.constructor ? err.constructor.name : "Error";
  const text = String((err && err.message) || err || "unknown");
  const safe = text.replace(/[A-Za-z0-9_\-]{24,}/g, "<redacted>").slice(0, 300);
  return `${kind}: ${safe}`;
}

async function load(name) {
  try {
    return await import(pathToFileURL(need.resolve(name)).href);
  } catch {
    return null;
  }
}

/** A plain sentence about why a failure happened, for the clinician's Details dropdown. */
function explain(how, text) {
  if (/not allowed|target|forbidden/i.test(text)) {
    return "The Photon project will not send to that number. It has no iMessage line attached.";
  }
  if (/chat\.db|database|EACCES|unable to open/i.test(text)) {
    return "This Mac will not let the app read Messages. The terminal needs Full Disk Access.";
  }
  if (/not installed/i.test(text)) {
    return `The ${how} iMessage package is not installed. Run make imessage.`;
  }
  if (/credential|authoriz|authent/i.test(text)) {
    return "The Photon credentials were rejected.";
  }
  return "";
}

/** Build a cloud app, or null with the reason. */
async function cloudApp() {
  const projectId = process.env.PHOTON_PROJECT_ID;
  const projectSecret = process.env.PHOTON_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    return { error: "no PHOTON_PROJECT_ID or PHOTON_PROJECT_SECRET" };
  }
  const core = await load("spectrum-ts");
  const provider = await load("spectrum-ts/providers/imessage");
  if (!core || !provider) return { error: "spectrum-ts is not installed" };
  const app = await core.Spectrum({
    projectId,
    projectSecret,
    providers: [provider.imessage.config()],
  });
  return { app, im: provider.imessage(app) };
}

/** Build a local app, or null with the reason. */
async function localApp() {
  if (process.platform !== "darwin") return { error: "the local path only runs on macOS" };
  const core = await load("spectrum-ts");
  const local = await load("@spectrum-ts/imessage-local");
  if (!core || !local || typeof local.localIMessage !== "function") {
    return { error: "@spectrum-ts/imessage-local is not installed" };
  }
  // No project id or secret: this talks to Messages on this machine, so it needs
  // neither a Photon project nor a line.
  const app = await core.Spectrum({ providers: [local.localIMessage.config()] });
  return { app, im: local.localIMessage(app) };
}

const PATHS = { cloud: cloudApp, local: localApp };

async function stop(app) {
  if (app && typeof app.stop === "function") {
    try {
      await app.stop();
    } catch {
      // The result is already decided; a failed shutdown changes nothing.
    }
  }
}

/** Send one message down one path. */
async function send(how, to, body) {
  let app = null;
  try {
    const built = await PATHS[how]();
    if (built.error) return { ok: false, how, error: built.error, why: explain(how, built.error) };
    app = built.app;

    const user = await built.im.user(to);
    const dm = await built.im.space.create(user);
    const sent = await dm.send(body);
    const id = sent && (sent.id || sent.messageId);
    return {
      ok: true,
      how,
      channel: CHANNEL,
      id: id ? String(id) : "",
      space: dm && dm.id ? String(dm.id) : "",
      // Accepted by the provider. Whether it reached a phone is a separate question,
      // answered by --status, and the UI must not say delivered until it does.
      status: "accepted",
    };
  } catch (err) {
    const text = reason(err);
    return { ok: false, how, error: text, why: explain(how, text) };
  } finally {
    await stop(app);
  }
}

/** Ask the provider whether a sent message was delivered. */
async function status(how, spaceId, messageId) {
  let app = null;
  try {
    const built = await PATHS[how]();
    if (built.error) return { ok: false, how, status: "unknown", error: built.error };
    app = built.app;

    const space = { id: spaceId, type: "dm", __platform: how === "cloud" ? "imessage" : "local_imessage" };
    const got = await built.im.getMessage(space, messageId);
    if (!got) return { ok: true, how, status: "accepted" };
    return {
      ok: true,
      how,
      status: got.isDelivered ? "delivered" : "accepted",
      delivered: Boolean(got.isDelivered),
    };
  } catch (err) {
    // Not knowing is not the same as not delivered, and the UI says so.
    return { ok: false, how, status: "unknown", error: reason(err) };
  } finally {
    await stop(app);
  }
}

/** What is installed and configured, for make check. */
async function probe() {
  const core = await load("spectrum-ts");
  const provider = await load("spectrum-ts/providers/imessage");
  const local = await load("@spectrum-ts/imessage-local");
  out({
    platform: process.platform,
    node: process.version,
    cloud: Boolean(core && provider && typeof core.Spectrum === "function"),
    local: Boolean(local && typeof local.localIMessage === "function"),
    credentials: Boolean(process.env.PHOTON_PROJECT_ID && process.env.PHOTON_PROJECT_SECRET),
  });
}

async function readStdin() {
  const parts = [];
  for await (const chunk of process.stdin) parts.push(chunk);
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

  if (process.argv.includes("--status")) {
    const how = String(job.how || "cloud");
    if (!PATHS[how]) {
      out({ ok: false, status: "unknown", error: `no such path ${how}` });
      return;
    }
    out(await status(how, String(job.space || ""), String(job.id || "")));
    return;
  }

  const to = String(job.to || "").trim();
  const body = String(job.body || "");
  if (!to || !body) {
    out({ ok: false, error: "a job needs both to and body" });
    return;
  }

  const tried = [];
  for (const how of ["cloud", "local"]) {
    const got = await send(how, to, body);
    if (got.ok) {
      out({ ...got, tried });
      return;
    }
    tried.push({ how: got.how, error: got.error, why: got.why });
  }
  // The last failure is the most useful one to show, because the local path is the one
  // a person can usually fix themselves.
  const last = tried[tried.length - 1] || {};
  out({
    ok: false,
    error: last.error || "no iMessage transport worked",
    why: last.why || "",
    tried,
  });
}

main().catch((err) => {
  out({ ok: false, error: reason(err) });
  process.exitCode = 1;
});
