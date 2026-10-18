// Starting a check-in from the clinician workspace. One button and one dialog, and the link
// only goes to the patient's phone when a clinician asks for that in as many words: creating a
// link is local, sending one is not.
//
// No new data is invented here. The session comes from POST /api/calls, the text from
// POST /api/calls/{token}/send, and the dialog reports whichever channel actually carried it.

import { Check, Copy, ExternalLink, PhoneCall, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateCall, useSendCall } from "@/api/client";
import type { CallStart, Patient } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The origin the patient link is opened from. Not the backend's idea of its own address. */
function appLinkFor(token: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/call/${token}`;
}

/** Whether the address a text would carry can open at all on a phone. */
function phoneReachable(url: string) {
  return url.startsWith("https://");
}

/** The host of the address a text would carry, for the explanation when it cannot be used. */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url || "no PUBLIC_URL";
  }
}

export function StartCall({ patient }: { patient: Patient }) {
  const [open, setOpen] = useState(false);
  const [made, setMade] = useState<CallStart | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useCreateCall();
  const send = useSendCall();

  const week = patient.week + 1;
  const link = made ? appLinkFor(made.token) : "";
  const texted = made?.url ?? "";
  const textable = phoneReachable(texted);
  const offOrigin = Boolean(texted) && hostOf(texted) !== (typeof window === "undefined" ? "" : window.location.host);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // The session stays; only the dialog resets, so reopening does not strand a live link.
      setCopied(false);
      create.reset();
      send.reset();
    }
  };
  const start = () =>
    create.mutate(
      { patientId: patient.id, send: false },
      {
        onSuccess: (result) => setMade(result),
        onError: (err) => toast.error(err.message),
      },
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Check-in link copied");
    } catch {
      toast.error("This browser would not let the page copy. Select the link and copy it.");
    }
  };

  const text = () =>
    made &&
    send.mutate(made.token, {
      onSuccess: (result) => {
        if (!result.ok) {
          // "none" means no transport would carry it. The record's own sentence is the honest
          // explanation, so it is shown rather than a generic failure line.
          toast.error(result.error || "Nothing was sent");
          return;
        }
        if (result.channel === "mock") toast.warning("No transport was configured, so the message was only recorded");
        else toast.success(`Link sent over ${result.channel}`);
      },
      onError: (err) => toast.error(err.message),
    });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setMade(null);
          setOpen(true);
        }}
        className="h-8 gap-1.5 rounded-[7px] border-[#e6e0d6] bg-[#fffdfa] px-3 text-[12px] font-medium text-[#55504a] hover:bg-[#fbf8f2] hover:text-[#1c1a17]"
      >
        <PhoneCall className="h-3.5 w-3.5" aria-hidden /> Start check-in
      </Button>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="border-[#e3ddd2] bg-[#fffdfa] sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-[17px]">Start the week {week} check-in</DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed text-[#6d675e]">
              Creates a one-time link for {patient.name}. The patient opens it on their phone: consent
              first, then the safety screen, then about ten minutes of tasks. Nothing is sent until you
              send it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {!made ? (
              <p className="rounded-[8px] border border-[#ece6da] bg-[#fbf8f2] px-3 py-2.5 text-[12px] leading-relaxed text-[#6d675e]">
                The link uses this check-in&rsquo;s token and expires on its own. Creating one does not
                message anyone.
              </p>
            ) : (
              <>
                <div className="rounded-[8px] border border-[#e6e0d6] bg-[#fbf9f4] p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b8375]">
                    Check-in link
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-[#3f3a34]">{link}</p>
                  <p className="mt-1.5 text-[11px] text-[#8b8375]">
                    Open by {new Date(made.expires).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copy()}
                    className="h-8 gap-1.5 rounded-[7px] border-[#e6e0d6] bg-[#fffdfa] text-[12px]"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[#e6e0d6] bg-[#fffdfa] px-3 text-[12px] font-medium text-[#55504a] hover:bg-[#fbf8f2]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open it here
                  </a>
                </div>

                <div className="space-y-1.5 border-t border-[#efeadf] pt-3">
                  {/* The address a text carries is the backend's own idea of its public address,
                      which is not necessarily the one on screen. Saying it out loud is the only
                      way a dead tunnel is visible before somebody's phone buzzes. */}
                  <p className="text-[11px] leading-relaxed text-[#8b8375]">
                    {textable ? (
                      offOrigin ? (
                        <>
                          A text would carry <span className="font-mono text-[#6d675e]">{hostOf(texted)}</span>,
                          not the address you are on now. If that tunnel is not live, the patient gets a
                          link that does not open.
                        </>
                      ) : (
                        <>A text carries this link: <span className="font-mono text-[#6d675e]">{texted}</span>.</>
                      )
                    ) : (
                      <>
                        There is no https address to send (&ldquo;{hostOf(texted)}&rdquo;), and a phone will
                        not open a camera over plain http. Copy the link instead, or point PUBLIC_URL at a
                        tunnel.
                      </>
                    )}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => void text()}
                    disabled={!textable || send.isPending}
                    className="h-8 gap-1.5 rounded-[7px] bg-[#b4552f] px-3 text-[12px] font-medium text-[#fff8f3] hover:bg-[#a04a27] disabled:bg-[#e7ded2] disabled:text-[#9b9488]"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden />
                    {send.isPending ? "Sending" : "Text it to the patient"}
                  </Button>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Close
            </Button>
            {!made && (
              <Button
                onClick={() => void start()}
                disabled={create.isPending}
                className="bg-[#b4552f] text-[#fff8f3] hover:bg-[#a04a27]"
              >
                {create.isPending ? "Creating" : "Create the link"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
