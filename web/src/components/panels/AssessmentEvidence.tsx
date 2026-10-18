// Evidence pieces shared by the assessment workspace and the older check-in log: capture
// health, and the target-against-gaze trace. Nothing here scores anything.

import type { Checkin } from "@/api/types";
import { CHART } from "@/components/charts/chartTheme";
import { LineTrace } from "@/components/charts/LineTrace";
import { cn } from "@/lib/utils";

export function ChannelHealth({ channel }: { channel: Checkin["channel"] }) {
  const items = [
    { label: "Frame rate", value: `${channel.fps} fps`, ok: channel.fps >= 20 },
    { label: "Calibration error", value: `${channel.calib_err_deg} deg`, ok: channel.calib_err_deg <= 1.5 },
    { label: "Face share", value: `${Math.round(channel.face_share * 100)}%`, ok: channel.face_share >= 0.7 },
    { label: "Flash test", value: channel.flash_ok ? "passed" : "failed", ok: channel.flash_ok },
  ];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <li
          key={i.label}
          className={cn(
            "rounded-[5px] border px-2 py-0.5 text-[10px]",
            i.ok
              ? "border-[#dfe7dc] bg-[#f2f6f0] text-[#3f6247]"
              : "border-[#ecdcbe] bg-[#f8f1e2] text-[#7d5b17]",
          )}
        >
          {i.label} {i.value}
          <span className="sr-only">, {i.ok ? "within limits" : "outside limits"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Target against gaze for one eye task. The axis follows whichever way the target moved. */
export function GazeTrace({ trace }: { trace: Checkin["gaze"][number] }) {
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  const vertical = spread(trace.ty) > spread(trace.tx);
  const target = vertical ? trace.ty : trace.tx;
  const gaze = vertical ? trace.y : trace.x;
  const data = trace.t.map((t, i) => ({ t: Number(t.toFixed(2)), target: target[i], gaze: gaze[i] }));

  return (
    <div>
      <h4 className="text-[12px] font-medium capitalize">
        {trace.task.replace(/_/g, " ")}{" "}
        <span className="font-normal text-[#8b8375]">{vertical ? "vertical" : "horizontal"}</span>
      </h4>
      <LineTrace
        data={data}
        x="t"
        xLabel="seconds"
        yLabel="degrees"
        series={[
          { key: "target", label: "Target", color: CHART.target, dashed: true },
          { key: "gaze", label: "Gaze", color: CHART.gaze },
        ]}
        height={170}
      />
    </div>
  );
}
