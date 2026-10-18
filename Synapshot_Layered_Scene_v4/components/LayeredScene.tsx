import React from "react";
import BrainTrace from "./BrainTrace";
import "../styles/scene-motion.css";

type LayeredSceneProps = {
  variant?: "landing" | "login";
  children?: React.ReactNode;
  className?: string;
};

export default function LayeredScene({ variant = "landing", children, className = "" }: LayeredSceneProps) {
  return (
    <div className={`syn-scene syn-scene--${variant} ${className}`.trim()}>
      <img src="/assets/room-base.png" alt="" className="syn-scene__base" />
      <img src="/assets/curtain-overlay.png" alt="" className="syn-scene__layer syn-scene__curtain" />
      <img src="/assets/light-shadow-overlay.png" alt="" className="syn-scene__layer syn-scene__light" />
      <img src="/assets/plant-overlay.png" alt="" className="syn-scene__layer syn-scene__plant" />
      <BrainTrace className="syn-scene__brain" />

      <div className="syn-scene__leaf-field" aria-hidden="true">
        <img src="/assets/drifting-leaves.png" alt="" className="syn-scene__leaf syn-scene__leaf--a" />
        <img src="/assets/drifting-leaves.png" alt="" className="syn-scene__leaf syn-scene__leaf--b" />
        <img src="/assets/drifting-leaves.png" alt="" className="syn-scene__leaf syn-scene__leaf--c" />
      </div>

      <div className="syn-scene__content">{children}</div>
    </div>
  );
}
