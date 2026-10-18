// Find out whether Photon can actually deliver an iMessage, and say exactly why not.
//
// Run with `make send-test`. Two paths are probed:
//
//   cloud  Spectrum Cloud, the hosted relay. Needs PHOTON_PROJECT_ID and
//          PHOTON_PROJECT_SECRET, and needs the project to own an iMessage line.
//   local  @spectrum-ts/imessage-local, which drives Messages on this Mac. Needs the
//          terminal to have Full Disk Access.
//
// Nothing here prints a credential. Error text is scrubbed of anything long enough to
// be a token before it is shown, and the project id is shown as a prefix only.
//
// The packages live in backend/comms/node, not next to this file, so they are resolved
// through that package's own require rather than by bare specifier.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const SIDECAR = new URL("../backend/comms/node/package.json", import.meta.url);
const need = createRequire(SIDECAR);

const TO = process.argv.find((a) => a.startsWith("+")) || "+19259677432";
const BODY = "Synapshot test message. Nothing is wrong, this is a delivery check.";

/** Load a package out of the sidecar's node_modules, or null when it is not there. */
async function load(name) {
  try {
    return await import(pathToFileURL(need.resolve(name)).href);
  } catch {
    return null;
  }
}

/** An error reduced to its shape, with anything token-shaped removed. */
function reason(err) {
  const kind = err && err.constructor ? err.constructor.name : "Error";
  const text = String((err && err.message) || err || "unknown");
  const safe = text.replace(/[A-Za-z0-9_\-]{24,}/g, "<redacted>").slice(0, 400);
  return `${kind}: ${safe}`;
}

/** A credential shown as a prefix, so two runs can be compared without leaking one. */
function hint(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 6)}... (${text.length} chars)` : "not set";
}

function head(title) {
  console.log("");
  console.log(`  ${title}`);
  console.log(`  ${"-".repeat(70)}`);
}

function row(label, value) {
  console.log(`    ${label.padEnd(26)} ${value}`);
}

/**
 * The cloud path.
 *
 * Order matters: credentials, then whether iMessage is switched on for the project,
 * then whether the project owns a line, and only then a send. Each step says what it
 * found, so a failure lands on the step that caused it rather than at the end.
 */
async function cloudProbe() {
  head("Cloud: Spectrum Cloud relay");

  const projectId = process.env.PHOTON_PROJECT_ID || "";
  const projectSecret = process.env.PHOTON_PROJECT_SECRET || "";
  row("PHOTON_PROJECT_ID", hint(projectId));
  row("PHOTON_PROJECT_SECRET", projectSecret ? "set" : "not set");
  if (!projectId || !projectSecret) {
    return { ok: false, path: "cloud", why: "no credentials in the environment" };
  }

  const core = await load("spectrum-ts");
  const provider = await load("spectrum-ts/providers/imessage");
  row("spectrum-ts", core ? "installed" : "NOT INSTALLED, run make imessage");
  if (!core || !provider) {
    return { ok: false, path: "cloud", why: "spectrum-ts is not installed" };
  }

  let project;
  let synced = null;
  try {
    project = await core.cloud.getProject(projectId, projectSecret);
    row("project", project && project.name ? project.name : "found");
    // The one field that explains most failures here. A project with no iMessage
    // account attached can authenticate perfectly and still refuse every recipient.
    synced = project && project.profile ? Boolean(project.profile.imessageSynced) : null;
    if (synced !== null) row("imessage synced", synced ? "yes" : "NO");
  } catch (err) {
    row("project", reason(err));
    return { ok: false, path: "cloud", why: `the credentials were rejected. ${reason(err)}` };
  }

  try {
    const platforms = await core.cloud.getPlatforms(projectId);
    const on = platforms && platforms.imessage && platforms.imessage.enabled;
    row("imessage platform", on ? "enabled" : "DISABLED for this project");
    if (!on) {
      return {
        ok: false,
        path: "cloud",
        why: "iMessage is switched off for this project",
        fix: "In the Photon dashboard open your project, go to Platforms, and turn iMessage on.",
      };
    }
  } catch (err) {
    row("imessage platform", reason(err));
  }

  // The lines the project owns. A shared project borrows a pool line; a dedicated one
  // has its own numbers. Either way, zero numbers means nothing can be sent.
  let lines = [];
  let kind = "unknown";
  try {
    const info = await core.cloud.getImessageInfo(projectId);
    kind = (info && info.type) || "unknown";
    row("line type", kind);
  } catch (err) {
    row("line type", reason(err));
  }
  try {
    const tokens = await core.cloud.issueImessageTokens(projectId, projectSecret);
    kind = (tokens && tokens.type) || kind;
    if (tokens && tokens.numbers) {
      lines = Object.keys(tokens.numbers);
    }
    row("lines owned", lines.length ? lines.join(", ") : `0  (type ${kind})`);
  } catch (err) {
    row("lines owned", reason(err));
    return { ok: false, path: "cloud", why: `could not issue line tokens. ${reason(err)}` };
  }

  if (lines.length === 0 && synced === false) {
    return {
      ok: false,
      path: "cloud",
      why: "the project has no iMessage account attached, so it owns no line to send from",
      fix: [
        "Your Photon project owns no iMessage line and has no iMessage account synced.",
        "Open the Photon dashboard, select the project, go to the iMessage or Lines",
        "section, and connect an Apple ID or claim a number. If the booth runs the",
        "project, ask them to attach a line to it.",
      ].join(" "),
    };
  }
  if (kind === "dedicated" && lines.length === 0) {
    return {
      ok: false,
      path: "cloud",
      why: "your Photon project owns no iMessage line",
      fix: [
        "Your Photon project owns no iMessage line. Provision or claim one in the",
        "Photon dashboard (Lines or Numbers section), or ask the Photon booth to",
        "attach one to this project.",
      ].join(" "),
    };
  }

  let app = null;
  try {
    app = await core.Spectrum({
      projectId,
      projectSecret,
      providers: [provider.imessage.config()],
    });
    const im = provider.imessage(app);

    // The docs are explicit about this and the old sidecar had it wrong: resolve the
    // handle to a user first, create the space from the user, and send on the space.
    // Passing the raw phone string to space.create, or sending through app.send, is a
    // different call that does not reach a person.
    const user = await im.user(TO);
    row("recipient", TO);
    const dm = await im.space.create(user);
    row("space", dm && dm.id ? `${dm.type || "dm"} ${String(dm.id).slice(0, 12)}...` : "created");
    const sent = await dm.send(BODY);
    const id = sent && (sent.id || sent.messageId);
    row("send", id ? `accepted, id ${String(id).slice(0, 16)}` : "accepted");
    return { ok: true, path: "cloud", id: id ? String(id) : "", space: dm && dm.id };
  } catch (err) {
    row("send", reason(err));
    const text = String((err && err.message) || "");
    let fix = "";
    if (/not allowed|target|permission|forbidden/i.test(text)) {
      fix = synced === false
        ? "The project has no iMessage account synced, so it has no line to send from and refuses every target. Connect an Apple ID to the project in the Photon dashboard (iMessage or Lines section)."
        : "The project will not send to that number. Add it to the project's allowed targets in the Photon dashboard, or move the project out of test mode.";
    }
    return { ok: false, path: "cloud", why: reason(err), fix };
  } finally {
    if (app && typeof app.stop === "function") {
      try {
        await app.stop();
      } catch {
        // The result is already decided; a failed shutdown changes nothing.
      }
    }
  }
}

/**
 * The local path: Messages on this Mac, driven through @spectrum-ts/imessage-local.
 *
 * This one sends from whichever Apple ID the Mac is signed into, so it needs no project
 * line at all. The usual failure is macOS refusing to let the process read the Messages
 * database, which is a Full Disk Access permission and not something code can fix.
 */
async function localProbe() {
  head("Local: Messages on this Mac");

  if (process.platform !== "darwin") {
    row("platform", `${process.platform}, not macOS`);
    return { ok: false, path: "local", why: "the local path only runs on macOS" };
  }
  row("platform", `${process.platform} ${process.arch}`);

  const local = await load("@spectrum-ts/imessage-local");
  const core = await load("spectrum-ts");
  row("@spectrum-ts/imessage-local", local ? "installed" : "NOT INSTALLED, run make imessage");
  if (!local || !core) {
    return {
      ok: false,
      path: "local",
      why: "@spectrum-ts/imessage-local is not installed",
      fix: "cd backend/comms/node && npm install @spectrum-ts/imessage-local",
    };
  }

  const make = local.localIMessage;
  if (typeof make !== "function") {
    row("provider", `exports ${Object.keys(local).join(", ")}`);
    return { ok: false, path: "local", why: "the local provider does not export localIMessage" };
  }
  row("platform id", "local_imessage");

  let app = null;
  try {
    // No project id or secret: this path talks to the Messages app on this machine, so
    // it needs no Photon project and no line. That is the whole reason it is here.
    app = await core.Spectrum({ providers: [make.config()] });
    const im = make(app);
    const user = await im.user(TO);
    row("recipient", TO);
    const dm = await im.space.create(user);
    const sent = await dm.send(BODY);
    const id = sent && (sent.id || sent.messageId);
    row("send", id ? `accepted, id ${String(id).slice(0, 16)}` : "accepted");
    return { ok: true, path: "local", id: id ? String(id) : "" };
  } catch (err) {
    row("send", reason(err));
    const text = String((err && err.message) || "");
    const fix = /chat\.db|database|permission|EACCES|open/i.test(text)
      ? "Give your terminal Full Disk Access: System Settings, Privacy and Security, Full Disk Access, add Terminal (or iTerm), then restart it."
      : "";
    return { ok: false, path: "local", why: reason(err), fix };
  } finally {
    if (app && typeof app.stop === "function") {
      try {
        await app.stop();
      } catch {
        // Same as above.
      }
    }
  }
}

function allowed(to) {
  // The same allow list the backend enforces. A probe that can text anybody is a probe
  // that will eventually text somebody by accident.
  const raw = process.env.DEMO_PHONES || "";
  const digits = (s) => String(s).replace(/\D/g, "");
  const want = digits(to);
  return raw
    .split(/[,;]/)
    .map(digits)
    .filter(Boolean)
    .some((n) => n === want);
}

async function main() {
  console.log("");
  console.log("  Photon iMessage delivery probe");
  console.log("  " + "=".repeat(70));
  row("sending to", TO);

  if (!allowed(TO)) {
    console.log("");
    console.log(`    ${TO} is not in DEMO_PHONES, so nothing will be sent.`);
    console.log("    Put it there first. Only numbers on that list can ever be texted.");
    console.log("");
    process.exitCode = 1;
    return;
  }

  const want = process.argv.includes("--local")
    ? ["local"]
    : process.argv.includes("--cloud")
      ? ["cloud"]
      : ["cloud", "local"];

  const results = [];
  if (want.includes("cloud")) results.push(await cloudProbe());
  if (want.includes("local")) results.push(await localProbe());

  head("Result");
  for (const got of results) {
    console.log(`    ${got.ok ? "PASS" : "FAIL"}  ${got.path}`);
    if (!got.ok) console.log(`          ${got.why}`);
    if (got.fix) console.log(`          Fix: ${got.fix}`);
  }

  const won = results.find((r) => r.ok);
  console.log("");
  if (won) {
    console.log(`    ${won.path} accepted the message. Check the phone.`);
    console.log("    Accepted is not delivered. If nothing arrives, the line sent it");
    console.log("    but Apple did not deliver it, which the app reports honestly.");
  } else {
    console.log("    Neither path can send right now. The demo still works: the call");
    console.log("    modal shows a QR code and a copyable link to open on the phone.");
    process.exitCode = 1;
  }
  console.log("");
}

main().catch((err) => {
  console.log(`    probe crashed: ${reason(err)}`);
  process.exitCode = 1;
});
