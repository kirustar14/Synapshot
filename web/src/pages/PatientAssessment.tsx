import { useParams } from "react-router-dom";
import { AssessmentWorkspace } from "@/dashboard/AssessmentWorkspace";

export default function PatientAssessment() {
  const { cid } = useParams();
  return <AssessmentWorkspace cid={cid} />;
}
