// Everything inside the Canvas. One frame driver owns the clock, the tweens, the scan sweep,
// the injury replay and the camera, so no React render ever writes a uniform.

import { Grid, OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Mesh as MeshPayload, Shape, Twin } from "@/api/types";
import { Callouts } from "./Callouts";
import { CortexMesh } from "./CortexMesh";
import { ImpactMarker } from "./ImpactMarker";
import { Tracts } from "./Tracts";
import { TRACT_SLOTS, makeScalarTexture, makeTractTexture, makeValueTexture, type CortexBuild } from "./geometry";
import { atWeek, REGIONS, type LayerValues, type Ranked, type TractInfo } from "./regionData";
import { cortexUniforms, tractUniforms, type ViewerTextures } from "./uniforms";
import { REPLAY_SECONDS, WEEK_MAX, replayWeek, useViewer, type ViewPreset } from "./viewerStore";

export interface SceneProps {
  cortex: CortexBuild;
  mesh: MeshPayload;
  twin: Twin | undefined;
  shape: Shape | undefined;
  points: Float32Array | null;
  tracts: TractInfo[];
  values: LayerValues;
  ghost: LayerValues;
  layerIdx: number;
  week: number;
  ranked: Ranked[];
  compact: boolean;
  /** Set on the compare screen so two canvases share one camera. */
  syncId: string | null;
}

/** Rotates RAS millimetres so the superior direction is up in the scene. */
const UPRIGHT: [number, number, number] = [-Math.PI / 2, 0, 0];

function presetPosition(name: ViewPreset, d: number): [number, number, number] {
  if (name === "left") return [-d, 0, 0];
  if (name === "right") return [d, 0, 0];
  if (name === "top") return [0, d, 0.001];
  return [0, 0, -d];
}

export function Scene(props: SceneProps) {
  const { cortex, mesh, twin, shape, points, tracts, values, ghost, layerIdx, week, ranked, compact, syncId } = props;
  const v = useViewer();
  const { camera, invalidate } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);

  const textures = useMemo<ViewerTextures>(
    () => ({ vals: makeValueTexture(), vals0: makeValueTexture(), thick: makeScalarTexture(), tracts: makeTractTexture() }),
    [],
  );
  const cortexU = useMemo(() => cortexUniforms(textures), [textures]);
  const tractU = useMemo(() => tractUniforms(textures), [textures]);

  useEffect(
    () => () => {
      textures.vals.dispose();
      textures.vals0.dispose();
      textures.thick.dispose();
      textures.tracts.dispose();
    },
    [textures],
  );

  const tween = useRef({ from: new Float32Array(REGIONS * 4), to: new Float32Array(REGIONS * 4), t: 1 });
  const weekRef = useRef(week);
  const replayRef = useRef<number | null>(null);
  const waveRef = useRef(-1);
  const hintRef = useRef<{ key: string | null }>({ key: null });

  /** Target channels for the tween, packed the way the shader reads them. */
  useEffect(() => {
    const live = textures.vals.image.data as Float32Array;
    tween.current.from.set(live);
    const to = tween.current.to;
    for (let i = 0; i < REGIONS; i++) {
      to[i * 4] = values.pos[i];
      to[i * 4 + 1] = values.glow[i];
      to[i * 4 + 2] = values.shimmer[i];
      to[i * 4 + 3] = 0;
    }
    tween.current.t = 0;
  }, [values, textures]);

  /** The week 0 ghost, written straight in because nothing animates it. */
  useEffect(() => {
    const data = textures.vals0.image.data as Float32Array;
    for (let i = 0; i < REGIONS; i++) {
      data[i * 4] = ghost.pos[i];
      data[i * 4 + 1] = ghost.glow[i];
      data[i * 4 + 2] = 0;
      data[i * 4 + 3] = 0;
    }
    textures.vals0.needsUpdate = true;
  }, [ghost, textures]);

  useEffect(() => {
    const data = textures.thick.image.data as Float32Array;
    for (let i = 0; i < REGIONS; i++) data[i] = shape?.thick_z?.[i] ?? 0;
    textures.thick.needsUpdate = true;
  }, [shape, textures]);

  useEffect(() => {
    cortexU.uSulcLo.value = cortex.sulcLo;
    cortexU.uSulcHi.value = cortex.sulcHi;
  }, [cortex, cortexU]);

  useEffect(() => {
    cortexU.uRadius.value = shape?.impact?.radius ?? 25;
    cortexU.uAtrophy.value = shape?.atrophy ?? 0;
    const s = shape?.scale ?? [1, 1, 1];
    (cortexU.uScale.value as THREE.Vector3).set(s[0], s[1], s[2]);
  }, [shape, cortexU]);

  useEffect(() => {
    cortexU.uLayer.value = layerIdx;
  }, [layerIdx, cortexU]);

  useEffect(() => {
    hintRef.current = { key: v.highlight };
  }, [v.highlight]);

  useEffect(() => {
    if (v.replay === null) {
      replayRef.current = null;
      waveRef.current = -1;
      cortexU.uWaveOn.value = 0;
    } else if (replayRef.current === null) {
      replayRef.current = 0;
    }
  }, [v.replay, cortexU]);

  /** Frames the camera on the mesh once, then honours the preset buttons. */
  const dist = cortex.radius * 3.1;
  useEffect(() => {
    camera.position.set(-dist * 0.78, dist * 0.3, -dist * 0.52);
    camera.lookAt(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = Math.max(1, dist / 60);
      camera.far = dist * 8;
      camera.updateProjectionMatrix();
    }
  }, [camera, dist]);

  useEffect(() => {
    if (!v.preset) return;
    const p = presetPosition(v.preset.name, dist);
    camera.position.set(p[0], p[1], p[2]);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [v.preset, camera, dist, invalidate]);

  /* ---------------------------------------------------------------- the frame driver */

  useFrame(({ clock }, delta) => {
    const dt = Math.min(0.1, delta);
    const time = clock.elapsedTime;
    const motion = v.reduceMotion ? 0 : 1;

    cortexU.uTime.value = time;
    tractU.uTime.value = time;
    cortexU.uMotion.value = motion;
    tractU.uMotion.value = motion;
    cortexU.uHolo.value = v.hologram ? 1 : 0;
    cortexU.uGlow.value = v.hologram ? 0.85 : 0.5;
    cortexU.uAlpha.value = compact ? 0.2 : 0.16;
    cortexU.uBorderOn.value = v.borders ? 1 : 0;
    cortexU.uGhostOn.value = v.ghost && weekRef.current > 0.3 ? 1 : 0;
    cortexU.uScanOn.value = v.hologram && !v.reduceMotion ? 1 : 0;
    cortexU.uHemi.value = v.hemi === "L" ? -1 : v.hemi === "R" ? 1 : 0;
    cortexU.uSplit.value = v.hemi === "split" ? cortex.radius * 0.22 : 0;
    cortexU.uInflate.value = v.inflate;
    cortexU.uPersonal.value = v.personal;
    tractU.uFade.value = v.tracts ? 1 : 0;

    const span = cortex.radius * 1.25;
    cortexU.uScanY.value = Math.sin(time * 0.33) * span;

    // Injury replay. The first half lights the impact and the wave, the second half hands the
    // week over to the scrubber so the audience watches the damage fade.
    let replayT = replayRef.current;
    if (replayT !== null) {
      if (!v.replayPaused) replayT += dt * v.speed;
      replayRef.current = replayT;
      const waveR = replayT > 0.6 ? Math.min(230, (replayT - 0.6) * 95) : -1;
      waveRef.current = waveR;
      cortexU.uWave.value = waveR;
      cortexU.uWaveOn.value = waveR > 0 ? Math.max(0, 1 - waveR / 230) : 0;
      const target = replayWeek(replayT);
      weekRef.current = target;
      const whole = Math.min(WEEK_MAX, Math.round(target));
      if (whole !== v.week) v.setWeek(whole);
      if (replayT > REPLAY_SECONDS) {
        replayRef.current = null;
        waveRef.current = -1;
        cortexU.uWaveOn.value = 0;
        v.stopReplay();
        v.setWeek(WEEK_MAX);
      }
    } else {
      weekRef.current += (week - weekRef.current) * Math.min(1, dt * 6);
      waveRef.current = -1;
    }

    // Impact swelling, read at the fractional week so it swells and settles smoothly.
    const amp = shape?.impact?.amp;
    cortexU.uBump.value = amp ? atWeek(amp, weekRef.current) : 0;

    // Person panel hover. Each hint exaggerates the real parameter that input drives.
    const hint = hintRef.current;
    let atrophyGain = 1;
    let scaleGain = 1;
    let thickGain = 1;
    let bumpGain = 1;
    if (hint.key) {
      const wobble = 0.5 + 0.5 * Math.sin(time * 3.4);
      if (hint.key === "age") atrophyGain = 1 + 7 * wobble;
      if (hint.key === "sex") scaleGain = 1 + 3.5 * wobble;
      if (hint.key === "t1") thickGain = 1 + 3 * wobble;
      if (hint.key === "injury") {
        bumpGain = 1 + 1.1 * wobble;
        cortexU.uWave.value = shape?.impact?.radius ?? 25;
        cortexU.uWaveOn.value = 0.55 * wobble;
      }
    }
    cortexU.uAtrophy.value = (shape?.atrophy ?? 0) * atrophyGain;
    cortexU.uThickGain.value = thickGain;
    cortexU.uBump.value *= bumpGain;
    const s = shape?.scale ?? [1, 1, 1];
    (cortexU.uScale.value as THREE.Vector3).set(
      1 + (s[0] - 1) * scaleGain,
      1 + (s[1] - 1) * scaleGain,
      1 + (s[2] - 1) * scaleGain,
    );

    // Region value tween, then the highlight channel written straight over the top of it.
    const data = textures.vals.image.data as Float32Array;
    const tw = tween.current;
    if (tw.t < 1) {
      tw.t = Math.min(1, tw.t + dt / 0.4);
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      for (let i = 0; i < REGIONS * 4; i++) data[i] = tw.from[i] + (tw.to[i] - tw.from[i]) * k;
    }
    for (let i = 0; i < REGIONS; i++) {
      data[i * 4 + 3] = i === v.selected ? 1 : i === v.hovered ? 0.5 : 0;
    }
    textures.vals.needsUpdate = true;

    // Tract damage at the week being shown, plus which one is selected.
    const tdata = textures.tracts.image.data as Float32Array;
    const shown = Math.min(TRACT_SLOTS, tracts.length);
    for (let i = 0; i < shown; i++) {
      const t = tracts[i];
      tdata[i * 4] = atWeek(t.damage, weekRef.current);
      tdata[i * 4 + 1] = t.damageW0;
      tdata[i * 4 + 2] = t.index === v.selectedTract ? 1 : 0;
      tdata[i * 4 + 3] = 0;
    }
    textures.tracts.needsUpdate = true;

    // Shared camera for the compare screen. Whoever is being dragged leads.
    if (syncId) {
      if (v.camLeader === syncId) {
        const tgt = controls.current?.target ?? new THREE.Vector3();
        v.pushCamera({
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [tgt.x, tgt.y, tgt.z],
        });
      } else if (v.camLeader && v.camPose) {
        camera.position.set(...v.camPose.position);
        controls.current?.target.set(...v.camPose.target);
        controls.current?.update();
      }
    }
  });

  const showParticles = v.tracts && !v.reduceMotion && !compact;

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[120, 220, 160]} intensity={0.9} />
      <directionalLight position={[-180, -60, -120]} intensity={0.35} color="#7fe4ff" />

      <group rotation={UPRIGHT}>
        <CortexMesh
          geometry={cortex.geometry}
          uniforms={cortexU}
          hologram={v.hologram}
          labels={mesh.labels}
          onHover={v.setHovered}
          onPick={v.setSelected}
        />
        {points && v.tracts && tracts.length > 0 && (
          <Tracts tracts={tracts} points={points} uniforms={tractU} particles={showParticles} onPick={v.setSelectedTract} />
        )}
        {shape?.impact?.point && (
          <ImpactMarker point={shape.impact.point} radius={shape.impact.radius || 25} motion={!v.reduceMotion} wave={waveRef} />
        )}
        {points && v.callouts && !compact && (
          <Callouts
            mesh={mesh}
            twin={twin}
            points={points}
            ranked={ranked}
            values={values}
            layer={v.layer}
            hovered={v.hovered}
            selected={v.selected}
            onPick={v.setSelected}
          />
        )}
      </group>

      {!compact && (
        <Grid
          position={[0, -cortex.radius * 1.05, 0]}
          args={[cortex.radius * 7, cortex.radius * 7]}
          cellSize={cortex.radius / 5}
          sectionSize={cortex.radius}
          cellColor="#1d4350"
          sectionColor="#2f7c8c"
          fadeDistance={cortex.radius * 7}
          fadeStrength={1.6}
          infiniteGrid
          followCamera={false}
        />
      )}

      <OrbitControls
        ref={controls}
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.8}
        minDistance={cortex.radius * 1.1}
        maxDistance={cortex.radius * 7}
        makeDefault
        onStart={() => syncId && v.claimCamera(syncId)}
      />

      {v.hologram && (
        <EffectComposer enabled multisampling={compact ? 0 : 2}>
          <Bloom mipmapBlur intensity={compact ? 0.55 : 0.75} luminanceThreshold={0.72} luminanceSmoothing={0.2} radius={0.4} />
          <Vignette offset={0.26} darkness={compact ? 0.5 : 0.78} />
        </EffectComposer>
      )}
    </>
  );
}
