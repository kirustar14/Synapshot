// Geometry and texture builders. Everything three touches that is not a React component
// lives here, so disposal is one call and the component tree stays readable.

import * as THREE from "three";
import type { Mesh as MeshPayload, Shape } from "@/api/types";
import { REGIONS, type TractInfo } from "./regionData";

export const TRACT_SLOTS = 256;

export interface CortexBuild {
  geometry: THREE.BufferGeometry;
  /** Radius of the bounding sphere in mm, used to frame the camera. */
  radius: number;
  verts: number;
  /** Pial to inflated distance one standard deviation either side of the mean, in mm. The
   * fragment shader darkens between these two, which is what makes the sulci read. */
  sulcLo: number;
  sulcHi: number;
}

/** One BufferGeometry for the whole cortex, with every attribute the shader reads. */
export function buildCortex(mesh: MeshPayload, shape: Shape | undefined): CortexBuild {
  const pial = new Float32Array(mesh.pial);
  const inflated = new Float32Array(mesh.inflated.length === mesh.pial.length ? mesh.inflated : mesh.pial);
  const verts = pial.length / 3;

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.faces), 1));
  geometry.setAttribute("position", new THREE.BufferAttribute(pial, 3));
  geometry.setAttribute("aInflated", new THREE.BufferAttribute(inflated, 3));
  geometry.computeVertexNormals();

  const region = new Float32Array(verts);
  for (let i = 0; i < verts; i++) {
    const label = mesh.labels[i];
    region[i] = label === undefined || label < 0 || label >= REGIONS ? -1 : label;
  }
  geometry.setAttribute("aRegion", new THREE.BufferAttribute(region, 1));

  const point = shape?.impact?.point;
  const dist = new Float32Array(verts);
  if (point) {
    for (let i = 0; i < verts; i++) {
      const dx = pial[i * 3] - point[0];
      const dy = pial[i * 3 + 1] - point[1];
      const dz = pial[i * 3 + 2] - point[2];
      dist[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  } else {
    dist.fill(9999);
  }
  geometry.setAttribute("aImpactDist", new THREE.BufferAttribute(dist, 1));

  const border = new Float32Array(verts);
  if (mesh.border && mesh.border.length === verts) border.set(mesh.border);
  geometry.setAttribute("aBorder", new THREE.BufferAttribute(border, 1));

  const diff = new Float32Array(verts);
  if (shape?.template_diff && shape.template_diff.length === verts) diff.set(shape.template_diff);
  geometry.setAttribute("aTemplateDiff", new THREE.BufferAttribute(diff, 1));

  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius ?? 120;

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < verts; i++) {
    const dx = inflated[i * 3] - pial[i * 3];
    const dy = inflated[i * 3 + 1] - pial[i * 3 + 1];
    const dz = inflated[i * 3 + 2] - pial[i * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    sum += d;
    sumSq += d * d;
  }
  const mean = sum / Math.max(1, verts);
  const sd = Math.sqrt(Math.max(0, sumSq / Math.max(1, verts) - mean * mean));
  return { geometry, radius, verts, sulcLo: mean - sd, sulcHi: mean + sd * 1.2 };
}

/** A 100 by 1 RGBA float texture: colour position, glow, shimmer, highlight. */
export function makeValueTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(REGIONS * 4), REGIONS, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** A 100 by 1 single channel float texture, used for the per region thickness z scores. */
export function makeScalarTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(REGIONS), REGIONS, 1, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** A 256 by 1 RGBA float texture holding per tract damage now, damage at week 0 and selection. */
export function makeTractTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(TRACT_SLOTS * 4), TRACT_SLOTS, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const CTRL_PULL = 0.35;

/** The quadratic Bezier control point, pulled toward the brain centre so tracts arc inward. */
export function controlPoint(ax: number, ay: number, az: number, bx: number, by: number, bz: number): THREE.Vector3 {
  const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return mid.multiplyScalar(1 - CTRL_PULL);
}

const ALONG = 18;
const RADIAL = 4;
const BASE_RADIUS = 0.55;

export interface TractBuild {
  tubes: THREE.BufferGeometry;
  particles: THREE.BufferGeometry;
  /** Tract slot per edge index, so the texture row and the geometry agree. */
  slots: Map<number, number>;
}

/**
 * All tracts merged into one tube geometry plus one point cloud, so the whole bundle is two
 * draw calls. Positions carry the base tube radius, normals carry the ring direction so the
 * shader can widen a damaged tract without rebuilding anything.
 */
export function buildTracts(tracts: TractInfo[], points: Float32Array): TractBuild {
  const used = tracts.slice(0, TRACT_SLOTS);
  const slots = new Map<number, number>();
  const ring = used.length * (ALONG + 1) * RADIAL;

  const position = new Float32Array(ring * 3);
  const normal = new Float32Array(ring * 3);
  const aT = new Float32Array(ring);
  const aTract = new Float32Array(ring);
  const index = new Uint32Array(used.length * ALONG * RADIAL * 6);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const at = new THREE.Vector3();
  const next = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const guess = new THREE.Vector3(0, 0, 1);

  const perTract = 3;
  const pFrom = new Float32Array(used.length * perTract * 3);
  const pTo = new Float32Array(used.length * perTract * 3);
  const pCtrl = new Float32Array(used.length * perTract * 3);
  const pPos = new Float32Array(used.length * perTract * 3);
  const pPhase = new Float32Array(used.length * perTract);
  const pTract = new Float32Array(used.length * perTract);

  let v = 0;
  let f = 0;
  used.forEach((t, slot) => {
    slots.set(t.index, slot);
    a.set(points[t.a * 3], points[t.a * 3 + 1], points[t.a * 3 + 2]);
    b.set(points[t.b * 3], points[t.b * 3 + 1], points[t.b * 3 + 2]);
    c.copy(controlPoint(a.x, a.y, a.z, b.x, b.y, b.z));

    const first = v;
    for (let i = 0; i <= ALONG; i++) {
      const s = i / ALONG;
      bezier(at, a, c, b, s);
      bezier(next, a, c, b, Math.min(1, s + 1 / ALONG));
      tangent.copy(next).sub(at);
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
      tangent.normalize();
      side.copy(guess).cross(tangent);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(tangent);
      side.normalize();
      up.copy(tangent).cross(side).normalize();
      for (let r = 0; r < RADIAL; r++) {
        const ang = (r / RADIAL) * Math.PI * 2;
        const nx = side.x * Math.cos(ang) + up.x * Math.sin(ang);
        const ny = side.y * Math.cos(ang) + up.y * Math.sin(ang);
        const nz = side.z * Math.cos(ang) + up.z * Math.sin(ang);
        position[v * 3] = at.x + nx * BASE_RADIUS;
        position[v * 3 + 1] = at.y + ny * BASE_RADIUS;
        position[v * 3 + 2] = at.z + nz * BASE_RADIUS;
        normal[v * 3] = nx;
        normal[v * 3 + 1] = ny;
        normal[v * 3 + 2] = nz;
        aT[v] = s;
        aTract[v] = slot;
        v++;
      }
    }

    for (let i = 0; i < ALONG; i++) {
      for (let r = 0; r < RADIAL; r++) {
        const p0 = first + i * RADIAL + r;
        const p1 = first + i * RADIAL + ((r + 1) % RADIAL);
        const p2 = p0 + RADIAL;
        const p3 = p1 + RADIAL;
        index[f++] = p0;
        index[f++] = p2;
        index[f++] = p1;
        index[f++] = p1;
        index[f++] = p2;
        index[f++] = p3;
      }
    }

    for (let k = 0; k < perTract; k++) {
      const j = slot * perTract + k;
      pFrom[j * 3] = a.x;
      pFrom[j * 3 + 1] = a.y;
      pFrom[j * 3 + 2] = a.z;
      pTo[j * 3] = b.x;
      pTo[j * 3 + 1] = b.y;
      pTo[j * 3 + 2] = b.z;
      pCtrl[j * 3] = c.x;
      pCtrl[j * 3 + 1] = c.y;
      pCtrl[j * 3 + 2] = c.z;
      pPos[j * 3] = a.x;
      pPos[j * 3 + 1] = a.y;
      pPos[j * 3 + 2] = a.z;
      pPhase[j] = (k / perTract + slot * 0.137) % 1;
      pTract[j] = slot;
    }
  });

  const tubes = new THREE.BufferGeometry();
  tubes.setIndex(new THREE.BufferAttribute(index, 1));
  tubes.setAttribute("position", new THREE.BufferAttribute(position, 3));
  tubes.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  tubes.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
  tubes.setAttribute("aTract", new THREE.BufferAttribute(aTract, 1));
  tubes.computeBoundingSphere();

  const particles = new THREE.BufferGeometry();
  particles.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  particles.setAttribute("aFrom", new THREE.BufferAttribute(pFrom, 3));
  particles.setAttribute("aTo", new THREE.BufferAttribute(pTo, 3));
  particles.setAttribute("aCtrl", new THREE.BufferAttribute(pCtrl, 3));
  particles.setAttribute("aPhase", new THREE.BufferAttribute(pPhase, 1));
  particles.setAttribute("aTract", new THREE.BufferAttribute(pTract, 1));
  particles.computeBoundingSphere();

  return { tubes, particles, slots };
}

function bezier(out: THREE.Vector3, a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number) {
  const s = 1 - t;
  out.set(
    s * s * a.x + 2 * s * t * c.x + t * t * b.x,
    s * s * a.y + 2 * s * t * c.y + t * t * b.y,
    s * s * a.z + 2 * s * t * c.z + t * t * b.z,
  );
}

/** Point on a tract curve, for the leader lines and the tract picker. */
export function tractPoint(points: Float32Array, a: number, b: number, t: number): THREE.Vector3 {
  const pa = new THREE.Vector3(points[a * 3], points[a * 3 + 1], points[a * 3 + 2]);
  const pb = new THREE.Vector3(points[b * 3], points[b * 3 + 1], points[b * 3 + 2]);
  const pc = controlPoint(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
  const out = new THREE.Vector3();
  bezier(out, pa, pc, pb, t);
  return out;
}
