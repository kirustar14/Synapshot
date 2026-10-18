// C6 Alerts. Red flags are pinned to the top with a red left border, then everything else by
// time. Acknowledging only records that a human has seen it.

import { Check, CheckCheck, ExternalLink, PhoneCall } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useAckAlert, useAlerts, useCallAlert, useNote, usePatients } from "@/api/client";
import type { Alert } from "@/api/types";
import { Empty, ErrorState, Loading, PageHeader, Panel } from "@/components/common";
import { AlertCard } from "@/components/panels/AlertCard";
import { Button } from "@/components/ui/button";

/** Red flags first, then anything not acknowledged, then newest first. */
function order(list: Alert[]): Alert[] {
  return [...list].sort(
    (a, b) =>
      Number(b.type === "red_flag") - Number(a.type === "red_flag") ||
      Number(a.acked) - Number(b.acked) ||
      b.time.localeCompare(a.time),
  );
}

export default function Alerts() {
  const { data, isLoading, error, refetch } = useAlerts();
  const { data: patients } = usePatients();
  const ack = useAckAlert();
  const callPatient = useCallAlert();
  const note = useNote();

  const names = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p.name])), [patients]);
  const open = useMemo(() => order((data ?? []).filter((a) => !a.acked)), [data]);
  const closed = useMemo(() => order((data ?? []).filter((a) => a.acked)), [data]);

  const resolve = (a: Alert) => {
    note.mutate({ id: a.patient_id, text: `Alert resolved by the clinician: ${a.trigger}` });
    ack.mutate(a.id, {
      onSuccess: () => toast.success("Alert resolved and noted on the record"),
      onError: (err) => toast.error(err.message),
    });
  };

  const actions = (a: Alert) => (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          ack.mutate(a.id, {
            onSuccess: () => toast.success("Alert acknowledged"),
            onError: (err) => toast.error(err.message),
          })
        }
        disabled={ack.isPending}
      >
        <Check aria-hidden /> Acknowledge
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          callPatient.mutate(a.id, {
            onSuccess: () => toast.success("Clinic call recorded, the patient has been told to expect it"),
            onError: (err) => toast.error(err.message),
          })
        }
        disabled={callPatient.isPending || a.called}
      >
        <PhoneCall aria-hidden /> {a.called ? "Patient called" : "Call patient"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => resolve(a)} disabled={ack.isPending}>
        <CheckCheck aria-hidden /> Resolve
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link to={`/app/patients/${a.patient_id}`}>
          <ExternalLink aria-hidden /> Open patient
        </Link>
      </Button>
    </>
  );

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="An alert opens when a check-in leaves the forecast band, a call is missed, the video is too poor to measure, or a safety question is answered yes. Acknowledge marks it read. Resolve also writes a note on the record."
      />
      <div className="space-y-5">
        <Panel title={`Needs attention (${open.length})`}>
          {isLoading && <Loading label="Loading alerts" />}
          {error && <ErrorState error={error} onRetry={() => refetch()} />}
          {data && open.length === 0 && <Empty>Nothing open. Every alert has been acknowledged.</Empty>}
          {open.length > 0 && (
            <div className="space-y-3">
              {open.map((a) => (
                <AlertCard key={a.id} alert={a} patientName={names.get(a.patient_id)} actions={actions(a)} />
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`Acknowledged (${closed.length})`} subtitle="Kept for the record.">
          {closed.length === 0 ? (
            <Empty>Nothing acknowledged yet.</Empty>
          ) : (
            <div className="space-y-3">
              {closed.map((a) => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  patientName={names.get(a.patient_id)}
                  actions={
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/app/patients/${a.patient_id}`}>
                        <ExternalLink aria-hidden /> Open patient
                      </Link>
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
