// The dashboard reads only what the existing contract already serves. These hooks fan the
// patient list out into the details and forecasts each row needs, reusing the same query keys
// as the patient screens so the cache is shared and nothing is fetched twice when a row opens.
//
// No synthetic values are invented here: every number on the worklist comes from /api/patients,
// /api/patients/{id} or /api/patients/{id}/forecast.

import { useQueries } from "@tanstack/react-query";
import { api, usePatients } from "@/api/client";
import type { Checkin, Forecast, Patient, PatientRow } from "@/api/types";

export interface Digest {
  row: PatientRow;
  patient?: Patient;
  forecast?: Forecast;
}

export interface Worklist {
  digests: Digest[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** The cohort plus one detail and one forecast request per patient, in parallel. */
export function useWorklist(): Worklist {
  const patients = usePatients();
  const rows = patients.data ?? [];

  const details = useQueries({
    queries: rows.map((r) => ({
      queryKey: ["patient", r.id],
      queryFn: () => api.patient(r.id),
      staleTime: 15000,
    })),
  });

  const forecasts = useQueries({
    queries: rows.map((r) => ({
      queryKey: ["forecast", r.id],
      queryFn: () => api.forecast(r.id),
      staleTime: 15000,
    })),
  });

  const digests: Digest[] = rows.map((row, i) => ({
    row,
    patient: details[i]?.data,
    forecast: forecasts[i]?.data,
  }));

  const detailError = details.find((q) => q.error)?.error ?? null;
  const forecastError = forecasts.find((q) => q.error)?.error ?? null;

  return {
    digests,
    isLoading:
      patients.isLoading ||
      (rows.length > 0 &&
        (details.some((q) => q.isLoading) || forecasts.some((q) => q.isLoading))),
    error: (patients.error as Error | null) ?? detailError ?? forecastError,
    refetch: () => {
      void patients.refetch();
      details.forEach((q) => void q.refetch());
      forecasts.forEach((q) => void q.refetch());
    },
  };
}

export interface CheckinFeed {
  byPatient: Map<string, Checkin[]>;
  /** Newest first, one entry per completed check-in. */
  recent: { patient: PatientRow; checkin: Checkin }[];
  isLoading: boolean;
  error: Error | null;
}

/** Every patient's check-in list. Used by the overview feed and the assessments index. */
export function useCheckinFeed(rows: PatientRow[]): CheckinFeed {
  const lists = useQueries({
    queries: rows.map((r) => ({
      queryKey: ["checkins", r.id],
      queryFn: () => api.checkins(r.id),
      staleTime: 15000,
    })),
  });

  const byPatient = new Map<string, Checkin[]>();
  const recent: CheckinFeed["recent"] = [];
  rows.forEach((patient, i) => {
    const list = lists[i]?.data ?? [];
    byPatient.set(patient.id, list);
    list.forEach((checkin) => recent.push({ patient, checkin }));
  });
  recent.sort((a, b) => b.checkin.date.localeCompare(a.checkin.date));

  return {
    byPatient,
    recent,
    isLoading: rows.length > 0 && lists.some((q) => q.isLoading),
    error: (lists.find((q) => q.error)?.error as Error | null) ?? null,
  };
}
