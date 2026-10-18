import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, Line, OrbitControls } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Twin } from "@/api/types";

export type Layer = "damage" | "activity" | "ei" | "diff";

const lerp = (arr: number[], w: number) => {
  const i = Math.floor(w), f = w - i;
  return i >= arr.length - 1 ? arr[arr.length - 1] : arr[i] * (1 - f) + arr[i + 1] * f;
};

const C_LOW = new THREE.Color("#5eaaa3");
const C_MID = new THREE.Color("#e8b04a");
const C_HIGH = new THREE.Color("#e0533f");
const C_BLUE = new THREE.Color("#4f7fd9");
const C_NEU = new THREE.Color("#c9d4d6");

function heat(v: number, out: THREE.Color) {
  const t = Math.max(0, Math.min(1, v));
  return t < 0.5 ? out.copy(C_LOW).lerp(C_MID, t * 2) : out.copy(C_MID).lerp(C_HIGH, (t - 0.5) * 2);
}
function diverge(v: number, out: THREE.Color) {
  const t = Math.max(-1, Math.min(1, v));
  return t < 0 ? out.copy(C_NEU).lerp(C_BLUE, -t) : out.copy(C_NEU).lerp(C_HIGH, t);
}

function Regions({ twin, week, layer, selected, onSelect }: { twin: Twin; week: number; layer: Layer; selected: number | null; onSelect?: (id: number) => void }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    twin.regions.forEach((r, i) => {
      const d = lerp(r.damage, week);
      let s = 0.035;
      if (layer === "damage") { heat(d * 1.4, col); s = 0.03 + d * 0.035; }
      else if (layer === "activity") { const a = lerp(r.activity, week); heat(a, col); s = 0.025 + a * 0.03; }
      else if (layer === "ei") diverge((r.ei - 1) * 4, col);
      else diverge((r.ei - r.template_ei) * 8, col);
      if (selected === i) { col.set("#ffffff"); s *= 1.6; }
      tmp.position.set(r.x, r.y, r.z);
      tmp.scale.setScalar(s);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      m.setColorAt(i, col);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [twin, week, layer, selected, tmp, col]);

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, twin.regions.length]}
      onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.instanceId != null) onSelect?.(e.instanceId); }}
      onPointerOver={() => (document.body.style.cursor = onSelect ? "pointer" : "")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <sphereGeometry args={[1, 16, 12]} />
      <meshStandardMaterial roughness={0.35} metalness={0.05} />
    </instancedMesh>
  );
}

function Edges({ twin, week, layer }: { twin: Twin; week: number; layer: Layer }) {
  const { thin, thick } = useMemo(() => {
    const build = (pick: (d: number) => boolean) => {
      const pts: [number, number, number][] = [];
      const cols: [number, number, number][] = [];
      const c = new THREE.Color();
      twin.edges.forEach((e) => {
        const d = lerp(e.damage, week);
        if (!pick(d)) return;
        const a = twin.regions[e.a], b = twin.regions[e.b];
        if (layer === "diff") diverge((e.personal_w - e.template_w) * 4, c);
        else if (layer === "damage") heat(d * 1.4, c);
        else c.copy(C_NEU).lerp(C_LOW, e.personal_w);
        // fade low weight by mixing toward background-ish gray
        const fade = layer === "damage" ? 0.35 + d * 0.65 : 0.35 + e.personal_w * 0.5;
        c.multiplyScalar(fade + 0.25);
        pts.push([a.x, a.y, a.z], [b.x, b.y, b.z]);
        cols.push([c.r, c.g, c.b], [c.r, c.g, c.b]);
      });
      return { pts, cols };
    };
    const strong = (d: number) => layer === "damage" && d > 0.3;
    return { thin: build((d) => !strong(d)), thick: build(strong) };
  }, [twin, week, layer]);
  return (
    <>
      {thin.pts.length > 0 && <Line points={thin.pts} vertexColors={thin.cols} segments lineWidth={1} transparent opacity={0.55} />}
      {thick.pts.length > 0 && <Line points={thick.pts} vertexColors={thick.cols} segments lineWidth={3.2} transparent opacity={0.95} />}
    </>
  );
}

function Shell() {
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.36, 0, 0]} scale={[0.46, 0.68, 1.02]}>
          <sphereGeometry args={[1, 40, 28]} />
          <meshPhysicalMaterial color="#9fc9c4" transparent opacity={0.09} roughness={0.2} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

export function Brain3D({ twin, week, layer, selected = null, onSelect, compact }: { twin: Twin; week: number; layer: Layer; selected?: number | null; onSelect?: (id: number) => void; compact?: boolean }) {
  return (
    <Canvas camera={{ position: [1.6, 0.9, 2.2], fov: 42 }} dpr={[1, 2]} onPointerMissed={() => onSelect?.(-1)} aria-label="3D brain twin viewer">
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 2]} intensity={1.4} />
      <Environment resolution={64}>
        <Lightformer intensity={2} position={[0, 5, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={1} color="#8bb" position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 1, 1]} />
      </Environment>
      <group rotation={[0, 0, 0]}>
        <Shell />
        <Edges twin={twin} week={week} layer={layer} />
        <Regions twin={twin} week={week} layer={layer} selected={selected} onSelect={onSelect} />
      </group>
      <OrbitControls enableDamping dampingFactor={0.08} autoRotate={compact} autoRotateSpeed={0.8} enablePan={false} minDistance={1.4} maxDistance={5} />
    </Canvas>
  );
}
