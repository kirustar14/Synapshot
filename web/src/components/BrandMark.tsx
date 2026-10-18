// The Synapshot mark, cut from the brand artwork as a silhouette on transparency.
//
// It is painted with the current text colour through a mask rather than placed as an image:
// one asset then reads correctly on the cream rail, on the landing scene and anywhere the
// surrounding colour changes, without a second file per background.
//
// Size comes from the caller, so the mark lines up with whatever it sits next to.

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-[17px] w-[17px] shrink-0 bg-current", className)}
      style={{
        maskImage: "url(/synapshot-mark.png)",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        maskSize: "contain",
        WebkitMaskImage: "url(/synapshot-mark.png)",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        WebkitMaskSize: "contain",
      }}
    />
  );
}
