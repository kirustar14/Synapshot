// P1 Consent. The standalone consent page, sent as its own link before the first check-in,
// so nobody has to agree to anything in the middle of a measurement.
//
// Three required boxes and one optional genetic box, off by default and explained in its own
// words. Accept posts the four choices and shows a plain thank you.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useConsent, useConsentDoc } from "@/api/client";
import type { ConsentChoices } from "@/api/client";
import { ConsentForm, EMPTY_CONSENT, consentReady } from "@/call/stages";
import { Big } from "@/call/ui";
import { PatientShell } from "@/components/PatientShell";
import { ErrorState, Loading, Panel } from "@/components/common";

export default function Consent() {
  const { token = "" } = useParams();
  const { data, isLoading, error, refetch } = useConsentDoc(token);
  const submit = useConsent();
  const [choices, setChoices] = useState<ConsentChoices>(EMPTY_CONSENT);
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <PatientShell title="Weekly check-in consent">
        <Panel title="Thank you">
          <p className="text-sm leading-relaxed">
            That is saved. Your clinic will text you a link when your first check-in is due. It takes about fourteen
            minutes and you can stop any one of them at any point.
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            {choices.genetic
              ? "You said yes to the optional genetic markers. You can change your mind by replying to any text from the clinic."
              : "You left the optional genetic markers off, so none of them will be read."}
          </p>
          <p className="mt-3 text-sm leading-relaxed">
            To withdraw completely, reply STOP to any text message from the clinic.
          </p>
        </Panel>
      </PatientShell>
    );
  }

  return (
    <PatientShell title="Weekly check-in consent">
      {isLoading && <Loading label="Loading" />}
      {error && <ErrorState error={error} onRetry={() => refetch()} />}
      {data && (
        <>
          <h1 className="mb-1 text-xl font-extrabold">Hello {data.patient_name}</h1>
          <p className="mb-5 text-xs text-muted-foreground">
            Please read this, then choose what you agree to. This assistant is software, not a person.
          </p>
          <ConsentForm text={data.text} choices={choices} onChange={setChoices} />
          {submit.isError && (
            <p className="mt-4 text-sm text-destructive">That did not save. Check your signal and try again.</p>
          )}
          <div className="mt-6 space-y-3">
            <Big
              onClick={() =>
                submit.mutate({ token, choices }, { onSuccess: () => setSent(true) })
              }
              disabled={!consentReady(choices) || submit.isPending}
            >
              {submit.isPending ? "Saving" : "I agree"}
            </Big>
            {!consentReady(choices) && (
              <p className="text-center text-xs text-muted-foreground">
                The first three are needed before the check-ins can start. The fourth is yours to decide.
              </p>
            )}
          </div>
        </>
      )}
    </PatientShell>
  );
}
