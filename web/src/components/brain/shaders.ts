// Every GLSL string the viewer uses. The colormaps are generated from layers.ts so a legend
// swatch and a lit region can never drift apart. Written for GLSL ES 1.00, which is what a
// plain ShaderMaterial compiles to, so no derivative functions and no matrix downcasts.

import { LAYERS, type Stop } from "./layers";

const f = (v: number) => v.toFixed(4);
const vec3 = (c: [number, number, number]) => `vec3(${f(c[0])}, ${f(c[1])}, ${f(c[2])})`;

/** One ramp as a chain of smoothstep mixes, which is what sampleRamp does in TypeScript. */
function rampFn(name: string, stops: Stop[]): string {
  const body = [`vec3 ${name}(float t) {`, `  vec3 c = ${vec3(stops[0].rgb)};`];
  for (let i = 1; i < stops.length; i++) {
    body.push(`  c = mix(c, ${vec3(stops[i].rgb)}, smoothstep(${f(stops[i - 1].at)}, ${f(stops[i].at)}, t));`);
  }
  body.push("  return c;", "}");
  return body.join("\n");
}

const RAMPS = [
  ...LAYERS.map((l, i) => rampFn(`ramp${i}`, l.stops)),
  "vec3 ramp(int layer, float t) {",
  ...LAYERS.map((_, i) => `  if (layer == ${i}) return ramp${i}(t);`),
  "  return ramp0(t);",
  "}",
  "float sq(float x) { return x * x; }",
].join("\n");

export const CORTEX_VERT = `
attribute vec3 aInflated;
attribute float aRegion;
attribute float aImpactDist;
attribute float aBorder;
attribute float aTemplateDiff;
attribute vec3 aLobeCol;

uniform float uInflate;
uniform float uAtrophy;
uniform float uPersonal;
uniform float uBump;
uniform float uRadius;
uniform float uHemi;
uniform float uSplit;
uniform float uThickGain;
uniform vec3 uScale;
uniform sampler2D uThick;
uniform sampler2D uVals;
uniform sampler2D uVals0;

varying vec4 vVal;
varying vec4 vVal0;
varying vec3 vLobe;
varying float vBorder;
varying float vDiff;
varying float vSulc;
varying float vImpact;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vWorld;

void main() {
  float u = (max(aRegion, 0.0) + 0.5) / 100.0;
  float thick = texture2D(uThick, vec2(u, 0.5)).r;
  vec4 val = texture2D(uVals, vec2(u, 0.5));
  vec4 val0 = texture2D(uVals0, vec2(u, 0.5));
  if (aRegion < 0.0) {
    val = vec4(0.0);
    val0 = vec4(0.0);
  }

  vec3 pos = mix(position, aInflated, clamp(uInflate + uAtrophy * uPersonal, 0.0, 1.0));
  pos = pos * mix(vec3(1.0), uScale, uPersonal);
  pos += normal * (thick * 0.4 * uPersonal * uThickGain);
  pos += normal * (uBump * exp(-(aImpactDist * aImpactDist) / (2.0 * uRadius * uRadius)) * uPersonal);
  pos.x += sign(position.x) * uSplit;

  vVal = val;
  vVal0 = val0;
  vLobe = aLobeCol;
  vBorder = aBorder;
  vDiff = aTemplateDiff;
  vSulc = length(aInflated - position);
  vImpact = aImpactDist;

  vec4 world = modelMatrix * vec4(pos, 1.0);
  vec4 mv = viewMatrix * world;
  vWorld = world.xyz;
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;

  bool dropLeft = uHemi > 0.5 && position.x < 0.0;
  bool dropRight = uHemi < -0.5 && position.x > 0.0;
  if (dropLeft || dropRight) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const CORTEX_FRAG = `
${RAMPS}

uniform float uTime;
uniform float uGlow;
uniform float uHolo;
uniform float uAlpha;
uniform float uMotion;
uniform float uWave;
uniform float uWaveOn;
uniform float uImpactGlow;
uniform float uRadius;
uniform float uBorderOn;
uniform float uGhostOn;
uniform float uScanY;
uniform float uScanOn;
uniform float uDim;
uniform float uSulcLo;
uniform float uSulcHi;
uniform vec3 uRim;
uniform int uLayer;

varying vec4 vVal;
varying vec4 vVal0;
varying vec3 vLobe;
varying float vBorder;
varying float vDiff;
varying float vSulc;
varying float vImpact;
varying vec3 vNormalV;
varying vec3 vViewV;
varying vec3 vWorld;

void main() {
  // Back faces point away from the camera, so flip them or the rim term saturates the inside.
  vec3 n = normalize(vNormalV) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(vViewV);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float lam = clamp(dot(n, normalize(vec3(0.35, 0.55, 0.75))) * 0.5 + 0.55, 0.0, 1.0);
  float fres = pow(1.0 - ndv, 4.0);
  float sulc = smoothstep(uSulcLo, uSulcHi, vSulc);
  // Each lobe has its own blue-family colour, lit and darkened in the folds.
  vec3 base = vLobe * 1.2 * (0.55 + 0.45 * lam) * (1.0 - 0.7 * sulc);

  float pos = vVal.r;
  float glow = vVal.g;
  float shim = vVal.b;
  float hi = vVal.a;
  vec3 lit = ramp(uLayer, pos);

  float pulse = 1.0 + uMotion * 0.22 * sin(uTime * 1.6 + pos * 8.0);
  float jitter = 1.0 + uMotion * 0.05 * sin(uTime * 11.0 + vDiff * 6.0);
  float shimmer = shim * uMotion * (0.45 + 0.55 * sin(uTime * 5.5 + vWorld.x * 0.5 + vWorld.z * 0.4));

  // In hologram mode the grey base is dimmed and the region colour takes over, so regions
  // read as different colours instead of one pale wash.
  vec3 col = mix(base, lit, smoothstep(0.1, 0.6, glow) * 0.92);
  vec3 emis = lit * smoothstep(0.1, 0.7, glow) * 0.5 * uGlow * pulse * jitter;
  // A slow bioluminescent pulse in the lobe's own colour.
  emis += vLobe * (0.03 + 0.04 * uMotion * sin(uTime * 1.2 + vWorld.y * 0.08 + vWorld.x * 0.05)) * (1.0 - 0.5 * sulc);
  emis += lit * shimmer * 0.55;
  emis += ramp(uLayer, vVal0.r) * vVal0.g * uGhostOn * 0.04;
  emis += uRim * fres * (0.1 + 0.3 * uHolo);

  float line = pow(clamp(vBorder, 0.0, 1.0), 12.0);
  emis += uRim * line * uBorderOn * (0.1 + 0.8 * hi);

  float cont = smoothstep(0.9, 1.0, abs(sin(vDiff * 4.0)));
  emis += uRim * cont * 0.06 * uHolo;

  float scan = exp(-sq((vWorld.y - uScanY) / 4.5)) * uScanOn * uMotion;
  emis += uRim * scan * 0.18;

  float wave = exp(-sq((vImpact - uWave) / 10.0)) * uWaveOn;
  emis += vec3(1.0, 0.55, 0.25) * wave * 1.1;

  // The hovered or selected region has to be unmistakable: its own colour pushed hard, plus a
  // white lift, while the rest of the cortex stays as it was.
  // Severity of the impact, graded by distance from the point of impact. Four soft bands so
  // the levels read: faint crimson at the edge, then red, then bright red, then a
  // light red core. The bands are blended, not hard rings.
  float hit = exp(-sq(vImpact) / (2.0 * uRadius * uRadius * 0.55)) * uImpactGlow;
  vec3 sev = mix(vec3(0.4, 0.0, 0.05), vec3(0.8, 0.02, 0.06), smoothstep(0.08, 0.35, hit));
  sev = mix(sev, vec3(1.0, 0.05, 0.1), smoothstep(0.35, 0.65, hit));
  sev = mix(sev, vec3(1.0, 0.25, 0.3), smoothstep(0.7, 0.95, hit));
  col = mix(col, sev, smoothstep(0.04, 0.5, hit) * 0.6);
  emis += sev * hit * 0.45;

  col += hi * 0.25;
  emis += lit * hi * 1.1 + vec3(1.0) * hi * 0.35;

  // Hologram blending is additive with a source factor of one, so the alpha channel plays no
  // part and every bit of brightness is spelled out here. body is how solid this fragment
  // reads: thin facing the camera, thick at the silhouette, thick again where a region is lit.
  float body = clamp(uAlpha + fres * 0.45 + glow * 0.45, 0.0, 1.2);
  // Unlit cortex goes cool and dim in hologram mode so a lit region keeps its own colour.
  vec3 cool = vec3(1.0);
  vec3 holo = col * cool * body * 0.9 + emis;
  vec3 solid = col * (0.95 + 0.5 * glow) + emis * 0.45;
  // A soft knee on the hologram branch. Without it a layer that lights the whole cortex, the
  // activity map for instance, clips to white and every region looks the same.
  holo = holo / (1.0 + holo * 0.45);
  vec3 rgb = mix(solid, holo, uHolo * 0.15) * uDim;
  // A touch of gamma deepens the blues so the surface reads as dark water lit from within.
  rgb = pow(max(rgb, vec3(0.0)), vec3(1.0));
#ifdef BACK_PASS
  rgb *= 0.55;
  gl_FragColor = vec4(rgb, 1.0);
#else
  // Slightly translucent, so the far side of the folds shows faintly through.
  gl_FragColor = vec4(rgb, 0.9);
#endif
}
`;

export const TRACT_VERT = `
attribute float aT;
attribute float aTract;

uniform sampler2D uTracts;
uniform float uWidth;

varying float vT;
varying float vDam;
varying float vSel;
varying float vTract;
varying vec3 vNormalV;
varying vec3 vViewV;

void main() {
  vec4 t = texture2D(uTracts, vec2((aTract + 0.5) / 256.0, 0.5));
  vDam = t.r;
  vSel = t.b;
  vT = aT;
  vTract = aTract;
  vec3 pos = position + normal * uWidth * (0.7 + 0.9 * t.r + 0.8 * t.b);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const TRACT_FRAG = `
${RAMPS}

uniform float uTime;
uniform float uMotion;
uniform float uFade;

varying float vT;
varying float vDam;
varying float vSel;
varying float vTract;
varying vec3 vNormalV;
varying vec3 vViewV;

void main() {
  float flow = fract(vT * 1.6 - uTime * 0.22 * uMotion + fract(vTract * 0.117) * 3.0);
  float pulse = exp(-sq((flow - 0.5) / 0.11));

  float seg = floor(vT * 12.0);
  float noise = fract(sin(vTract * 12.9898 + seg * 78.233) * 43758.5453);
  float broken = step(vDam * 0.8, noise);
  float flick = 1.0 - vDam * 0.45 * uMotion * (0.5 + 0.5 * sin(uTime * 9.0 + vTract));

  float fres = pow(1.0 - clamp(dot(normalize(vNormalV), normalize(vViewV)), 0.0, 1.0), 1.6);
  vec3 c = ramp0(vDam);
  vec3 cool = vec3(0.25, 0.72, 0.85);

  // Two hundred tubes stack up in the middle of the bundle and the blending is additive, so a
  // healthy tract has to be nearly invisible for a damaged one to read as bright.
  float a = (0.02 + 0.10 * pulse + 0.05 * fres) * broken * flick * (0.15 + 1.1 * vDam);
  a = clamp(a * uFade + vSel * 0.3, 0.0, 1.0);
  vec3 rgb = mix(cool, c, clamp(vDam * 1.6, 0.0, 1.0)) * (0.35 + 1.0 * pulse);
  rgb += cool * fres * 0.25;
  rgb += vec3(0.85, 0.95, 1.0) * vSel * 0.6;
  gl_FragColor = vec4(rgb, a);
}
`;

export const PARTICLE_VERT = `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec3 aCtrl;
attribute float aPhase;
attribute float aTract;

uniform sampler2D uTracts;
uniform float uTime;
uniform float uMotion;
uniform float uSize;

varying float vDam;

void main() {
  float t = fract(aPhase + uTime * 0.07 * uMotion);
  float s = 1.0 - t;
  vec3 p = s * s * aFrom + 2.0 * s * t * aCtrl + t * t * aTo;
  vDam = texture2D(uTracts, vec2((aTract + 0.5) / 256.0, 0.5)).r;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (260.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FRAG = `
${RAMPS}

uniform float uFade;

varying float vDam;

void main() {
  vec2 q = gl_PointCoord - vec2(0.5);
  float r = length(q);
  if (r > 0.5) discard;
  float soft = exp(-sq(r / 0.22));
  vec3 cool = vec3(0.45, 0.85, 0.95);
  vec3 rgb = mix(cool, ramp0(vDam), clamp(vDam * 1.5, 0.0, 1.0));
  gl_FragColor = vec4(rgb, soft * 0.3 * uFade);
}
`;
