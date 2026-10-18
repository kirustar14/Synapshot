// The patient call page. Mobile first, portrait, one task per screen.
//
// Everything this page does is driven by GET /api/call/{token}/script. This file only loads
// that script and hands it to the runner, so there is one place that knows the running order
// and it is the backend.

import { useParams } from "react-router-dom";
import { useCallScript } from "@/api/client";
import { CallRunner } from "@/call/CallRunner";
import { ErrorState, Loading } from "@/components/common";
import { PatientShell } from "@/components/PatientShell";

export default function PatientCall() {
  const { token = "" } = useParams();
  const { data, isLoading, error, refetch } = useCallScript(token);

  if (isLoading) {
    return (
      <PatientShell title="Weekly check-in">
        <Loading label="Opening your check-in" />
      </PatientShell>
    );
  }

  if (error || !data) {
    return (
      <PatientShell title="Weekly check-in">
        <ErrorState error={error ?? new Error("This link did not open")} onRetry={() => refetch()} />
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Links last a day and work once. If this one has expired, reply to the text message that sent it and your
          clinic will send a fresh one.
        </p>
      </PatientShell>
    );
  }

  return <CallRunner token={token} script={data} />;
}
