import { type CSSProperties, type ReactNode } from "react";
import BrainTrace from "./BrainTrace";
import Environment from "./Environment";
import { BRAIN, ROOM } from "./geometry";
import "./scene.css";

/** The photograph and overlays share one proportional camera transform. */
export default function LayeredScene({
  variant,
  children,
}: {
  variant: "landing" | "login";
  children: ReactNode;
}) {
  const brainStyle: CSSProperties = {
    left: `${(BRAIN.x / ROOM.width) * 100}%`,
    top: `${(BRAIN.y / ROOM.height) * 100}%`,
    width: `${(BRAIN.width / ROOM.width) * 100}%`,
  };
  return (
    <div className={`scene scene--${variant}`}>
      <div className="scene__art" aria-hidden="true">
        <img
          className="scene__base"
          src="/scene/v6/room-og-extended.webp"
          width={ROOM.width}
          height={ROOM.height}
          alt=""
          fetchPriority="high"
        />
        <Environment />
        {variant === "landing" && (
          <img className="scene__clock" src="/landing/gold-wall-clock.png" alt="" />
        )}
        <BrainTrace className="scene__brain" style={brainStyle} />
      </div>
      <div className="scene__content">{children}</div>
    </div>
  );
}
