// The recovery model tab is a layout wrapper. The brain viewer, its layers, camera, region
// definitions, highlighting, controls and model calculations are the existing implementation
// and are rendered untouched. Only the surrounding context strip and links are new.

import { ArrowUpRight, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { useForecast } from "@/api/client";
import PatientTwin from "./PatientTwin";
import { usePatientContext } from "./PatientLayout";

export default function PatientRecovery() {
  const { patient } = usePatientContext();
  const forecast = useForecast(patient.id);

  const observed = (forecast.data?.signals ?? []).reduce(
    (n, s) => n + s.obs.length,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="dash-card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <p className="text-[11px] text-[#6d675e]">
          <span className="font-medium text-[#1c1a17]">Experimental model output.</span> The brain surface and its
          layers are model-derived, not a scan. Region colours keep the viewer's existing scale.
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#8b8375]">
          <span>
            Week <span className="text-[#1c1a17]">{patient.week}</span> of 12
          </span>
          <span>
            Observed measures <span className="text-[#1c1a17]">{observed}</span>
          </span>
          <span>
            Band coverage <span className="text-[#1c1a17]">{Math.round(patient.coverage * 100)}%</span>
          </span>
          <Link to={`/app/patients/${patient.id}/compare`} className="inline-flex items-center gap-1 text-[#8a4222] hover:underline">
            Scenario comparison <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
          <Link to={`/app/patients/${patient.id}/upload`} className="inline-flex items-center gap-1 text-[#8a4222] hover:underline">
            <Upload className="h-3 w-3" aria-hidden /> Model inputs
          </Link>
        </div>
      </div>

      <PatientTwin />
    </div>
  );
}
