// Existing record bookmarks open the consolidated patient workspace.
import { Navigate } from "react-router-dom";
import { usePatientContext } from "./PatientLayout";

export default function PatientRecovery() {
  const { patient } = usePatientContext();
  return <Navigate to={`/patients/${patient.id}`} replace />;
}
