import * as THREE from "three";

// ─── SOLID CHECK ──────────────────────────────────────────────────────────────
export function isSolid(voxels, W, H, D, x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return false;
  return voxels[x + W * (y + H * z)] === 1;
}

// ─── CUBE WORLD FACE SHADING ──────────────────────────────────────────────────
// Exact values from Cube.exe shader bytecode (IDA Pro):
//   c9 = (frontLight=0.80, ambient=0.20, sideLight=0.75, 0.0)
const FACE_SHADE = {
  "0,1,0":   1.00,  // top    — full sun
  "0,0,1":   0.80,  // front
  "0,0,-1":  0.65,  // back
  "1,0,0":   0.75,  // right
  "-1,0,0":  0.75,  // left
  "0,-1,0":  0.20,  // bottom — darkness
};

// ─── VERTEX AMBIENT OCCLUSION ─────────────────────────────────────────────────
// Classic voxel AO by Mikola Lysenko (0ao.html / 2012 technique).
// For each vertex of a face, sample 2 edge-adjacent and 1 corner-adjacent block.
// More solid neighbors → darker vertex → smooth contact shadows.
//
// AO value (0 = fully occluded, 3 = fully lit)
//  both edges solid                 → 0
//  1 edge + corner solid            → 1
//  1 edge solid (no corner)         → 2
//  no solids                        → 3
function vertexAO(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 ? 1 : 0) - (side2 ? 1 : 0) - (corner ? 1 : 0);
}

// Maps AO level (0..3) → brightness multiplier
const AO_CURVE = [0.55, 0.70, 0.85, 1.00]; // softer ambient occlusion curve

// Cube vertices (unit cube 0..1)
const CV = [
  [0,0,0],[1,0,0],[1,1,0],[0,1,0],
  [0,0,1],[1,0,1],[1,1,1],[0,1,1],
];

// Face definitions per normal (4 vertex indices, CCW from outside)
const FACES = {
  "1,0,0":  { vi: [2,6,5,1], u: [0,0,1], v: [0,1,0] },
  "-1,0,0": { vi: [7,3,0,4], u: [0,0,-1], v: [0,1,0] },
  "0,1,0":  { vi: [7,6,2,3], u: [1,0,0], v: [0,0,1] },
  "0,-1,0": { vi: [0,1,5,4], u: [1,0,0], v: [0,0,1] },
  "0,0,1":  { vi: [6,7,4,5], u: [1,0,0], v: [0,1,0] },
  "0,0,-1": { vi: [3,2,1,0], u: [-1,0,0], v: [0,1,0] },
};

const DIRS = [
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]
];

// ─── MAIN MESHER ──────────────────────────────────────────────────────────────
export function buildChunkMeshGeometry(W, H, D, voxels, colors) {
  const positions    = [];
  const normals      = [];
  const vertexColors = [];
  const indices      = [];
  let vc = 0;

  for (let z = 0; z < D; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = x + W * (y + H * z);
        if (voxels[idx] !== 1) continue;

        const rB = colors[idx * 3]     / 255;
        const gB = colors[idx * 3 + 1] / 255;
        const bB = colors[idx * 3 + 2] / 255;

        for (const [nx, ny, nz] of DIRS) {
          const ax = x + nx, ay = y + ny, az = z + nz;
          if (isSolid(voxels, W, H, D, ax, ay, az)) continue; // hidden face

          const key   = `${nx},${ny},${nz}`;
          const shade = FACE_SHADE[key];
          const face  = FACES[key];
          const [ux,uy,uz] = face.u;
          const [vx,vy,vz] = face.v;

          // Compute per-vertex AO
          const aoVals = [0,1,2,3].map(i => {
            const [px,py,pz] = CV[face.vi[i]];
            
            // Derive neighbor checking directions based on the corner position
            const dx = nx !== 0 ? 0 : (px > 0 ? 1 : -1);
            const dy = ny !== 0 ? 0 : (py > 0 ? 1 : -1);
            const dz = nz !== 0 ? 0 : (pz > 0 ? 1 : -1);

            let d1x = 0, d1y = 0, d1z = 0;
            let d2x = 0, d2y = 0, d2z = 0;

            if (nx !== 0) {
                d1y = dy; d2z = dz;
            } else if (ny !== 0) {
                d1x = dx; d2z = dz;
            } else {
                d1x = dx; d2y = dy;
            }

            const side1  = isSolid(voxels, W, H, D, x + nx + d1x, y + ny + d1y, z + nz + d1z);
            const side2  = isSolid(voxels, W, H, D, x + nx + d2x, y + ny + d2y, z + nz + d2z);
            const corner = isSolid(voxels, W, H, D, x + nx + dx, y + ny + dy, z + nz + dz);
            return vertexAO(side1, side2, corner);
          });

          // Combine face shade + AO for each vertex color
          const fr = [0,1,2,3].map(i => rB * shade * AO_CURVE[aoVals[i]]);
          const fg = [0,1,2,3].map(i => gB * shade * AO_CURVE[aoVals[i]]);
          const fb = [0,1,2,3].map(i => bB * shade * AO_CURVE[aoVals[i]]);

          // Flip quad orientation if AO creates a "concave" artifact
          const flip = (aoVals[0] + aoVals[2]) < (aoVals[1] + aoVals[3]);

          for (let i = 0; i < 4; i++) {
            const [px,py,pz] = CV[face.vi[i]];
            positions.push(x+px, y+py, z+pz);
            normals.push(nx, ny, nz);
            vertexColors.push(fr[i], fg[i], fb[i]);
          }

          if (flip) {
            // Must preserve CCW winding order! 
            indices.push(vc, vc+1, vc+3,  vc+1, vc+2, vc+3);
          } else {
            indices.push(vc, vc+1, vc+2,  vc,   vc+2, vc+3);
          }
          vc += 4;
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal",   new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color",    new THREE.Float32BufferAttribute(vertexColors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
