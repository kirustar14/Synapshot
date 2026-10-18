// Time: the week scrubber, the global damage timeline under the stage, and the injury replay.
// Weeks with a real call are drawn solid as measured. Weeks after that are dashed as forecast.

import { Pause, Play, RotateCcw, Rewind, Square } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { Twin } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { globalDamage } from "./regionData";
import { REPLAY_SECONDS, WEEK_MAX, useViewer } from "./viewerStore";

const SPEEDS = [0.5, 1, 2];

/** Advances the week while the player is running. One interval, cleared on every change. */
export function useWeekPlayer() {
  const playing = useViewer((s) => s.playing);
  const speed = useViewer((s) => s.speed);
  const setWeek = useViewer((s) => s.setWeek);
  const setPlaying = useViewer((s) => s.setPlaying);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const next = useViewer.getState().week + 1;
      if (next > WEEK_MAX) {
        setPlaying(false);
        return;
      }
      setWeek(next);
    }, 560 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, setWeek, setPlaying]);
}

export function WeekScrubber({ measuredThrough }: { measuredThrough: number }) {
  const v = useViewer();
  useWeekPlayer();
  const replaying = v.replay !== null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant={v.playing ? "secondary" : "default"}
        onClick={() => {
          if (v.week >= WEEK_MAX) v.setWeek(0);
          v.setPlaying(!v.playing);
        }}
        disabled={replaying}
        aria-label={v.playing ? "Pause the week player" : "Play the weeks"}
      >
        {v.playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        {v.playing ? "Pause" : "Play"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => v.setWeek(0)} disabled={replaying} aria-label="Back to week 0">
        <Rewind aria-hidden /> Week 0
      </Button>

      <div className="flex min-w-[12rem] flex-1 items-center gap-3">
        <Slider
          value={[Math.round(v.week)]}
          min={0}
          max={WEEK_MAX}
          step={1}
          onValueChange={([w]) => {
            v.setPlaying(false);
            v.setWeek(w);
          }}
          aria-label={`Week ${Math.round(v.week)} of ${WEEK_MAX}`}
          className="flex-1"
        />
        <span className="w-20 shrink-0 font-mono text-xs tabular-nums">
          Week {Math.round(v.week)}
          <span className="text-muted-foreground">/{WEEK_MAX}</span>
        </span>
      </div>

      <div className="flex items-center gap-1 rounded-full border p-1" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={v.speed === s}
            onClick={() => v.setSpeed(s)}
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${v.speed === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {s}x
          </button>
        ))}
      </div>

      <span className="text-[11px] text-muted-foreground">
        {Math.round(v.week) <= measuredThrough ? "Measured week" : "Forecast week"}
      </span>
    </div>
  );
}

const W = 600;
const H = 74;

export function DamageTimeline({ twin, measuredThrough }: { twin: Twin | undefined; measuredThrough: number }) {
  const v = useViewer();
  const series = useMemo(
    () => Array.from({ length: WEEK_MAX + 1 }, (_, w) => ({ week: w, ...globalDamage(twin, w) })),
    [twin],
  );

  const top = Math.max(0.05, ...series.map((s) => s.hi));
  const x = (w: number) => 26 + (w / WEEK_MAX) * (W - 42);
  const y = (d: number) => H - 14 - (d / top) * (H - 26);
  const line = (key: "mean" | "lo" | "hi", from: number, to: number) =>
    series
      .filter((s) => s.week >= from && s.week <= to)
      .map((s, i) => `${i === 0 ? "M" : "L"}${x(s.week).toFixed(1)},${y(s[key]).toFixed(1)}`)
      .join(" ");

  const band = `${line("hi", 0, WEEK_MAX)} ${series
    .slice()
    .reverse()
    .map((s) => `L${x(s.week).toFixed(1)},${y(s.lo).toFixed(1)}`)
    .join(" ")} Z`;

  const solidTo = Math.min(WEEK_MAX, Math.max(0, measuredThrough));

  return (
    <figure className="m-0">
      <figcaption className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Mean damage across all tracts, with its 10 to 90 percent band</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 bg-[var(--chart-1)]" aria-hidden /> measured
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-4 border-t border-dashed border-[var(--chart-1)]" aria-hidden /> forecast
          </span>
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-pointer"
        role="img"
        aria-label={`Damage over ${WEEK_MAX} weeks. Week ${Math.round(v.week)} is showing.`}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - box.left) / box.width;
          const week = Math.round(((frac * W - 26) / (W - 42)) * WEEK_MAX);
          v.setPlaying(false);
          v.setWeek(Math.min(WEEK_MAX, Math.max(0, week)));
        }}
      >
        <path d={band} fill="var(--band)" stroke="none" />
        <path d={line("mean", 0, solidTo)} fill="none" stroke="var(--chart-1)" strokeWidth={2} />
        <path d={line("mean", solidTo, WEEK_MAX)} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="4 3" />
        <line x1={x(v.week)} x2={x(v.week)} y1={6} y2={H - 12} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="2 2" />
        <circle cx={x(v.week)} cy={y(series[Math.round(v.week)]?.mean ?? 0)} r={3.5} fill="var(--foreground)" />
        {series.map((s) => (
          <text key={s.week} x={x(s.week)} y={H - 2} fontSize={8} textAnchor="middle" fill="var(--muted-foreground)">
            {s.week}
          </text>
        ))}
        <text x={2} y={12} fontSize={8} fill="var(--muted-foreground)">
          {top.toFixed(2)}
        </text>
      </svg>
    </figure>
  );
}

export function ReplayControls() {
  const v = useViewer();
  const running = v.replay !== null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={v.startReplay} disabled={running}>
          <RotateCcw aria-hidden /> Replay injury
        </Button>
        {running && (
          <>
            <Button size="sm" variant="outline" onClick={() => v.setReplayPaused(!v.replayPaused)}>
              {v.replayPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {v.replayPaused ? "Resume" : "Pause"}
            </Button>
            <Button size="sm" variant="outline" onClick={v.stopReplay}>
              <Square aria-hidden /> Stop
            </Button>
          </>
        )}
        <div className="flex items-center gap-1 rounded-full border p-1" role="group" aria-label="Replay speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={v.speed === s}
              onClick={() => v.setSpeed(s)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${v.speed === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Illustrative animation. Lit regions come from the model. About {REPLAY_SECONDS} seconds: the impact rings, a wave
        crosses the surface, tracts light by their week 0 damage, the swelling rises, then the weeks play out and the
        damage fades.
      </p>
    </div>
  );
}
