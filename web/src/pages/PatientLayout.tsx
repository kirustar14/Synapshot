// Shared layout for the five patient routes. Loads the patient once and renders the header and
// tab strip, then the active tab through the outlet context.

import { Outlet, useOutletContext, useParams } from "react-router-dom";
import { usePatient } from "@/api/client";
import { PatientHeader } from "@/components/PatientHeader";
import { ErrorState, Loading } from "@/components/common";
import type { Patient } from "@/api/types";

interface PatientContext {
  patient: Patient;
}

/** The loaded patient, for any page nested under /patients/:id. */
export const usePatientContext = () => useOutletContext<PatientContext>();

export default function PatientLayout() {
  const { id = "" } = useParams();
  const { data, isLoading, error, refetch } = usePatient(id);

  if (isLoading) return <Loading label="Loading patient" />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <>
      <PatientHeader patient={data} />
      <Outlet context={{ patient: data } satisfies PatientContext} />
    </>
  );
}
