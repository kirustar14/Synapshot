// One step id in, one screen out. The only place that knows which component runs a task.

import { AntisaccadeTask, CalibTask, FixationTask, PursuitTask, QualityTask, SaccadeTask } from "./eyes";
import { EncodeTask, RedflagsTask, SymptomsTask } from "./forms";
import { AhTask, FluencyTask, NpcTask, PassageTask, PatakaTask, PictureTask, RecallTask } from "./speech";
import { WrapStage } from "./stages";
import type { TaskProps } from "./types";

/** The screen for one script step, or null when the step is a spoken line only. */
export function TaskView({ step, onDone }: TaskProps) {
  switch (step.task) {
    case "redflags":
      return <RedflagsTask step={step} onDone={onDone} />;
    case "quality":
      return <QualityTask step={step} onDone={onDone} />;
    case "calib":
      return <CalibTask step={step} onDone={onDone} />;
    case "symptoms":
      return <SymptomsTask step={step} onDone={onDone} />;
    case "encode":
      return <EncodeTask step={step} onDone={onDone} />;
    case "pursuit_h":
    case "pursuit_v":
      return <PursuitTask step={step} onDone={onDone} />;
    case "saccade":
      return <SaccadeTask step={step} onDone={onDone} />;
    case "antisaccade":
      return <AntisaccadeTask step={step} onDone={onDone} />;
    case "fixation":
      return <FixationTask step={step} onDone={onDone} />;
    case "npc":
      return <NpcTask step={step} onDone={onDone} />;
    case "speech_ah":
      return <AhTask step={step} onDone={onDone} />;
    case "speech_pataka":
      return <PatakaTask step={step} onDone={onDone} />;
    case "speech_passage":
      return <PassageTask step={step} onDone={onDone} />;
    case "picture":
      return <PictureTask step={step} onDone={onDone} />;
    case "fluency":
      return <FluencyTask step={step} onDone={onDone} />;
    case "recall":
      return <RecallTask step={step} onDone={onDone} />;
    case "wrap":
      return <WrapStage />;
    case "none":
    default:
      return null;
  }
}

/** Steps that have no screen of their own, so the spoken line is the whole step. */
export function spokenOnly(task: string): boolean {
  return task === "none";
}
