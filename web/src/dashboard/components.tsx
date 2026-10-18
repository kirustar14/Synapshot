// Small shared pieces for the clinician workspace. Everything is a hairline surface, a label
// and a value; there are no decorative illustrations and no colour without a meaning.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Review, ReviewTone } from "./derive";

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("dash-card", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-[#ece6dc] px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-[#1c1a17]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[12px] leading-relaxed text-[#6d675e]">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

const TONE: Record<ReviewTone, string> = {
  urgent: "bg-[#f8e6e2] text-[#96311f]",
  attention: "bg-[#f6e9dd] text-[#8a4a26]",
  caution: "bg-[#f7efdb] text-[#7d5b17]",
  info: "bg-[#f1ece3] text-[#6b5a45]",
  calm: "bg-[#eaf0e8] text-[#3f6247]",
  neutral: "bg-[#f1ece4] text-[#6d675e]",
};

const DOT: Record<ReviewTone, string> = {
  urgent: "#a83327",
  attention: "#b4552f",
  caution: "#a9762b",
  info: "#8a7a66",
  calm: "#4f7a56",
  neutral: "#a49c8f",
};

export function StatusPill({ review, className }: { review: Review; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[11px] font-medium",
        TONE[review.tone],
        className,
      )}
      title={review.reason}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[review.tone] }} aria-hidden />
      {review.label}
    </span>
  );
}

export function ReviewReason({ review }: { review: Review }) {
  return <span className="text-[11px] leading-snug text-[#6d675e]">{review.reason}</span>;
}

/** A small observed-only trace. The forecast band belongs on the patient chart, not here. */
export function TrendSpark({
  points,
  label,
  width = 96,
  height = 26,
  tone = "calm",
}: {
  points: { week: number; value: number }[];
  label: string;
  width?: number;
  height?: number;
  tone?: "calm" | "attention" | "neutral";
}) {
  if (points.length === 0)
    return (
      <span className="text-[11px] text-[#9b9488]" aria-label={label}>
        no reads
      </span>
    );
  const xs = points.map((p) => p.week);
  const ys = points.map((p) => p.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const spanX = Math.max(1, xMax - xMin);
  const spanY = Math.max(1e-6, yMax - yMin);
  const x = (w: number) => 2 + ((w - xMin) / spanX) * (width - 4);
  const y = (v: number) => height - 3 - ((v - yMin) / spanY) * (height - 6);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.week).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const stroke = tone === "attention" ? "#a83327" : tone === "neutral" ? "#a49c8f" : "#1c1a17";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="overflow-visible"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.week)} cy={y(last.value)} r={2.2} fill="#b4552f" />
    </svg>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8b8375]", className)}>
      {children}
    </p>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[#8b8375]">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-[#1c1a17]">{children}</dd>
    </div>
  );
}

export function InlineEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[8px] border border-dashed border-[#e2dbd0] bg-[#fbf8f2] px-3 py-4 text-center text-[12px] leading-relaxed text-[#6d675e]">
      {children}
    </div>
  );
}
