import React, { useState, useRef, useCallback, useMemo } from "react";
import * as THREE from "three";
import { i18n } from "./i18n";

/* ============================================================
   PARSER .cub (formato Cube World "Steam" / pós-2019)
   ------------------------------------------------------------
   Layout binário:
     bytes 0-3   : width  (uint32 LE)
     bytes 4-7   : depth  (uint32 LE)
     bytes 8-11  : height (uint32 LE)
     bytes 12+   : width*depth*height vezes [R,G,B] (1 byte cada)
   Ordem de iteração ao escrever: for z { for y { for x { RGB } } }
   Cor (0,0,0) = voxel vazio/transparente (não é desenhado).
   ============================================================ */
export function parseCub(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const width = view.getUint32(0, true);
  const depth = view.getUint32(4, true);
  const height = view.getUint32(8, true);

  const expectedVoxels = width * depth * height;
  const expectedBytes = 12 + expectedVoxels * 3;

  if (
    width === 0 ||
    depth === 0 ||
    height === 0 ||
    width > 2048 ||
    depth > 2048 ||
    height > 2048 ||
    expectedBytes !== arrayBuffer.byteLength
  ) {
    throw new Error(
      `Header inválido (${width}x${depth}x${height}). Esperava ${expectedBytes} bytes, arquivo tem ${arrayBuffer.byteLength}. ` +
        `Isso não é um .cub no formato Steam (header 12 bytes + RGB).`
    );
  }

  const bytes = new Uint8Array(arrayBuffer, 12);
  const voxels = new Uint8Array(expectedVoxels); // 0 = vazio, 1 = ocupado
  const colors = new Uint8Array(expectedVoxels * 3);

  let ptr = 0;
  let solidCount = 0;
  for (let z = 0; z < height; z++) {
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        const r = bytes[ptr++];
        const g = bytes[ptr++];
        const b = bytes[ptr++];
        const idx = x + width * (y + depth * z);
        if (r !== 0 || g !== 0 || b !== 0) {
          voxels[idx] = 1;
          colors[idx * 3] = r;
          colors[idx * 3 + 1] = g;
          colors[idx * 3 + 2] = b;
          solidCount++;
        }
      }
    }
  }

  return { width, depth, height, voxels, colors, solidCount };
}

export function isSolidItem(voxels, width, depth, height, x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x >= width || y >= depth || z >= height) return false;
  return voxels[x + width * (y + depth * z)] === 1;
}

export function buildMeshGeometry({ width, depth, height, voxels, colors }) {
  const positions = [];
  const normals = [];
  const vertexColors = [];
  const indices = [];

  let baseColor = null;

  // 6 direções: +x,-x,+y,-y,+z,-z
  const dirs = [
    { n: [1, 0, 0], d: [1, 0, 0] },
    { n: [-1, 0, 0], d: [-1, 0, 0] },
    { n: [0, 1, 0], d: [0, 1, 0] },
    { n: [0, -1, 0], d: [0, -1, 0] },
    { n: [0, 0, 1], d: [0, 0, 1] },
    { n: [0, 0, -1], d: [0, 0, -1] },
  ];

  // vértices do cubo unitário (0..1)^3
  const cubeVerts = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];

  // faces (4 índices de cubeVerts) por direção, winding CCW visto de fora
  const faceDefs = {
    "1,0,0": [2, 6, 5, 1],
    "-1,0,0": [7, 3, 0, 4],
    "0,1,0": [7, 6, 2, 3],
    "0,-1,0": [0, 1, 5, 4],
    "0,0,1": [6, 7, 4, 5],
    "0,0,-1": [3, 2, 1, 0],
  };

  let vertCount = 0;

  for (let z = 0; z < height; z++) {
    for (let y = 0; y < depth; y++) {
      for (let x = 0; x < width; x++) {
        const idx = x + width * (y + depth * z);
        if (voxels[idx] !== 1) continue;

        const r = colors[idx * 3] / 255;
        const g = colors[idx * 3 + 1] / 255;
        const b = colors[idx * 3 + 2] / 255;
        
        if (!baseColor) {
          baseColor = new THREE.Color(r, g, b);
        }

        // CUB models have Z=Height, Y=Depth. Our Character.js rotates them -90deg on X.
        // So Local Z+ (0,0,1) becomes World Y+ (Top).
        // Local Y+ (0,1,0) becomes World Z- (Front).
        const CUB_SHADE = {
          "0,0,1":   1.00,  // top
          "0,0,-1":  0.20,  // bottom
          "0,1,0":   0.80,  // front
          "0,-1,0":  0.65,  // back
          "1,0,0":   0.75,  // right
          "-1,0,0":  0.75,  // left
        };

        for (const { n, d } of dirs) {
          const nx = x + d[0];
          const ny = y + d[1];
          const nz = z + d[2];
          if (isSolidItem(voxels, width, depth, height, nx, ny, nz)) continue; // face oculta

          const key = `${n[0]},${n[1]},${n[2]}`;
          const faceIdx = faceDefs[key];
          const shade = CUB_SHADE[key] || 1.0;

          for (const vi of faceIdx) {
            const [vx, vy, vz] = cubeVerts[vi];
            positions.push(x + vx, y + vy, z + vz);
            normals.push(n[0], n[1], n[2]);
            vertexColors.push(r * shade, g * shade, b * shade);
          }

          indices.push(
            vertCount, vertCount + 1, vertCount + 2,
            vertCount, vertCount + 2, vertCount + 3
          );
          vertCount += 4;
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();

  return { geometry, baseColor, triCount: indices.length / 3, quadCount: indices.length / 6 };
}

/* ============================================================
   Three.js scene setup (vanilla, sem react-three-fiber, pra manter
   o artifact em um único arquivo sem deps extras de runtime)
   ============================================================ */
function useThreeScene(containerRef) {
  const stateRef = useRef(null);

  const init = useCallback(() => {
    const container = containerRef.current;
    if (!container || stateRef.current) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(40, 40, 60);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(1, 1.5, 1);
    scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-1, -0.5, -1);
    scene.add(dir2);

    const grid = new THREE.GridHelper(80, 16, 0xaaaaaa, 0xdddddd);
    scene.add(grid);

    const group = new THREE.Group();
    scene.add(group);

    // controles orbitais simples (drag para rotacionar, scroll para zoom)
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let rotX = -0.35;
    let rotY = 0.6;
    let dist = 80;

    const target = new THREE.Vector3(0, 0, 0);

    function updateCamera() {
      const x = target.x + dist * Math.sin(rotY) * Math.cos(rotX);
      const y = target.y + dist * Math.sin(rotX);
      const z = target.z + dist * Math.cos(rotY) * Math.cos(rotX);
      camera.position.set(x, y, z);
      camera.lookAt(target);
    }
    updateCamera();

    const dom = renderer.domElement;
    dom.style.cursor = "grab";

    const onPointerDown = (e) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
      dom.style.cursor = "grabbing";
    };
    const onPointerUp = () => {
      isDragging = false;
      dom.style.cursor = "grab";
    };
    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      rotY -= dx * 0.008;
      rotX += dy * 0.008;
      rotX = Math.max(-1.4, Math.min(1.4, rotX));
      updateCamera();
    };
    const onWheel = (e) => {
      e.preventDefault();
      dist *= 1 + e.deltaY * 0.001;
      dist = Math.max(10, Math.min(400, dist));
      updateCamera();
    };

    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("wheel", onWheel, { passive: false });

    let rafId;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    stateRef.current = {
      scene,
      camera,
      renderer,
      group,
      dom,
      cleanup: () => {
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        dom.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointermove", onPointerMove);
        dom.removeEventListener("wheel", onWheel);
        container.removeChild(dom);
        renderer.dispose();
      },
      recenter: (size) => {
        target.set(size.x / 2, size.y / 2, size.z / 2);
        dist = Math.max(size.x, size.y, size.z) * 2.2 + 10;
        updateCamera();
      },
    };
  }, [containerRef]);

  return { init, stateRef };
}

export default function CubViewer({ onBack }) {
  const containerRef = useRef(null);
  const { init, stateRef } = useThreeScene(containerRef);
  const [status, setStatus] = useState({ kind: "idle" });
  const [meta, setMeta] = useState(null);
  const [wireframe, setWireframe] = useState(false);
  const currentMeshRef = useRef(null);

  const onContainerReady = useCallback(
    (node) => {
      containerRef.current = node;
      if (node) {
        init();
      } else {
        if (stateRef.current) {
          stateRef.current.cleanup();
          stateRef.current = null;
        }
      }
    },
    [init, stateRef]
  );

  const loadFile = useCallback(
    async (file) => {
      setStatus({ kind: "loading" });
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseCub(buf);
        const { geometry, triCount, quadCount } = buildMeshGeometry(parsed);

        const state = stateRef.current;
        if (!state) throw new Error("Cena 3D ainda não inicializada.");

        if (currentMeshRef.current) {
          state.group.remove(currentMeshRef.current);
          currentMeshRef.current.geometry.dispose();
          currentMeshRef.current.material.dispose();
        }

        const material = new THREE.MeshLambertMaterial({
          vertexColors: true,
          wireframe,
        });
        const mesh = new THREE.Mesh(geometry, material);
        // centraliza geometria na origem do group, mas guardamos pivot real pro recenter
        state.group.position.set(
          -parsed.width / 2,
          0,
          -parsed.depth / 2
        );
        state.group.add(mesh);
        currentMeshRef.current = mesh;

        state.recenter({ x: parsed.width, y: parsed.height, z: parsed.depth });

        setMeta({
          name: file.name,
          width: parsed.width,
          depth: parsed.depth,
          height: parsed.height,
          solidCount: parsed.solidCount,
          totalCells: parsed.width * parsed.depth * parsed.height,
          triCount,
          quadCount,
          fileSize: buf.byteLength,
        });
        setStatus({ kind: "ready" });
      } catch (err) {
        setStatus({ kind: "error", message: err.message });
        setMeta(null);
      }
    },
    [stateRef, wireframe]
  );

  const onFileInput = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file) loadFile(file);
    },
    [loadFile]
  );

  const toggleWireframe = useCallback(() => {
    setWireframe((w) => {
      const next = !w;
      if (currentMeshRef.current) {
        currentMeshRef.current.material.wireframe = next;
      }
      return next;
    });
  }, []);

  const statusLabel = useMemo(() => {
    switch (status.kind) {
      case "loading":
        return i18n.cubStatusLoading;
      case "error":
        return `${i18n.cubStatusError}: ${status.message}`;
      case "ready":
        return i18n.cubStatusReady;
      default:
        return i18n.cubStatusWaiting;
    }
  }, [status]);

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100%", width: "100%", fontFamily: "Segoe UI, Tahoma, sans-serif" }}>
      {/* sidebar controls */}
      <div style={{ width: "260px", padding: "8px", display: "flex", flexDirection: "column", gap: "12px", borderRight: "1px solid #dfdfdf", background: "#f0f0f0" }}>
        
        <button onClick={onBack} style={{ alignSelf: 'flex-start', padding: '4px 8px', cursor: 'pointer' }}>
          &larr; {i18n.backToMenu}
        </button>

        <fieldset>
          <legend>{i18n.cubControls}</legend>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <button onClick={() => document.getElementById('cub-file-input').click()}>{i18n.openCubFile}</button>
              <input
                id="cub-file-input"
                type="file"
                accept=".cub"
                onChange={onFileInput}
                style={{ display: "none" }}
              />
            </div>
            <div className="field-row">
              <input 
                id="wireframe-check" 
                type="checkbox" 
                checked={wireframe} 
                onChange={toggleWireframe} 
                disabled={status.kind !== "ready"} 
              />
              <label htmlFor="wireframe-check">{i18n.wireframeMode}</label>
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>{i18n.status}</legend>
          <div className="field-row" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{
              width: 12, height: 12, borderRadius: "50%",
              background: status.kind === "ready" ? "lime" : status.kind === "error" ? "red" : status.kind === "loading" ? "gold" : "gray",
              border: "1px inset #ccc"
            }} />
            <span>{statusLabel}</span>
          </div>
        </fieldset>

        <fieldset style={{ flex: 1, overflowY: "auto" }}>
          <legend>{i18n.properties}</legend>
          {meta ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <Row label={i18n.file} value={meta.name} />
              <Row label={i18n.dimensions} value={`${meta.width} × ${meta.depth} × ${meta.height}`} />
              <Row label={i18n.solids} value={`${meta.solidCount.toLocaleString()} / ${meta.totalCells.toLocaleString()}`} />
              <Row label={i18n.quads} value={meta.quadCount.toLocaleString()} />
              <Row label={i18n.triangles} value={meta.triCount.toLocaleString()} />
              <Row label={i18n.fileSize} value={`${(meta.fileSize / 1024).toFixed(1)} KB`} />
            </div>
          ) : (
            <div style={{ color: "#888", fontSize: 12 }}>{i18n.noFileLoaded}</div>
          )}
        </fieldset>
      </div>

      {/* viewport */}
      <div
        ref={onContainerReady}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{ flex: 1, position: "relative", border: "1px inset #ccc", background: "#fff", margin: "8px", boxSizing: "border-box" }}
      >
        {status.kind !== "ready" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              textAlign: "center",
              padding: 24,
            }}
          >
            <div style={{ color: "#333", fontSize: 14 }}>
              {status.kind === "error" ? (
                <span style={{ color: "red" }}>{statusLabel}</span>
              ) : (
                <>
                  Arraste um arquivo .cub aqui<br />
                  ou use os botões ao lado
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 4, borderBottom: "1px dotted #ccc", paddingBottom: 2 }}>
      <strong>{label}:</strong>
      <span style={{ textAlign: "right", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}
