import React, { useState, useRef, useCallback, useEffect } from "react";
import * as THREE from "three";
import { WorldGenerator, CHUNK_WIDTH, CHUNK_DEPTH } from "./WorldGenerator";
import { buildChunkMeshGeometry } from "./Mesher";
import { Character } from "./Character";
import { PlayerController } from "./PlayerController";
import { parseCub, buildMeshGeometry as buildItemGeometry } from "./CubViewer";
import { CharacterCreator } from "./CharacterCreator";
import { i18n } from "./i18n";

function useThreeScene(containerRef) {
  const stateRef = useRef(null);
  const generatorRef = useRef(null); // Reference to the active WorldGenerator

  const init = useCallback(() => {
    const container = containerRef.current;
    if (!container || stateRef.current) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    // Cube World screenshot fog: matches the lighter horizon color
    scene.fog = new THREE.FogExp2(0x7ec8e3, 0.010);

    // ─── SKY DOME ─────────────────────────────────────────────────────────────
    // Values extracted EXACTLY from Cube.exe compiled HLSL shader bytecode (IDA Pro):
    //   c5  = (-0.6000, 2.5000, 0.6000, 3.0000)
    //   c9  = ( 0.8000, 0.2000, 0.7500, 0.0000)
    //
    //   c5.x = -0.6  → vertical offset (shifts gradient down so horizon is at eye level)
    //   c5.y =  2.5  → exponent (controls sharpness of the gradient)
    //   c9.x =  0.8  → sun contribution (also used as frontLight in terrain shader)
    //   c9.y =  0.2  → ambient term
    // ─────────────────────────────────────────────────────────────────────────
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `;
    const fragmentShader = `
      uniform vec3 topColor;     // skyColor2 — zenith blue
      uniform vec3 bottomColor;  // skyColor1 — horizon cyan (matches fog)
      uniform float offset;      // c5.x = -0.6
      uniform float exponent;    // c5.y =  2.5
      varying vec3 vWorldPosition;
      void main() {
        // Shift vWorldPosition.y by offset so horizon blend starts near eye level
        float h = normalize( vWorldPosition + vec3(0.0, offset, 0.0) ).y;
        // Power curve: exact match to game's sky gradient
        float t = max( pow( max( h, 0.0 ), exponent ), 0.0 );
        gl_FragColor = vec4( mix( bottomColor, topColor, t ), 1.0 );
      }
    `;
    const uniforms = {
      // Screenshot analysis: deep royal blue zenith (#1a72c8),
      // lighter sky-blue horizon (#7ec8e3) blending with fog
      topColor:    { value: new THREE.Color(0x1a72c8) }, // deep sky blue
      bottomColor: { value: new THREE.Color(0x7ec8e3) }, // light horizon (matches fog)
      offset:   { value: -0.6 },  // c5.x from Cube.exe
      exponent: { value: 2.5  },  // c5.y from Cube.exe
    };

    const skyGeo = new THREE.SphereGeometry(600, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 100, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // We use baked FACE_SHADE and Ambient Occlusion in the vertex colors (MeshBasicMaterial)
    // so we don't need dynamic Three.js lights (which would double-shade and darken everything).
    // const hemi = new THREE.HemisphereLight(0xb0d8f0, 0x3a5c1a, 0.5);
    // scene.add(hemi);
    // const dir = new THREE.DirectionalLight(0xfff8e8, 1.0); // slightly warm sun
    // dir.position.set(1, 2.5, 1).normalize();
    // scene.add(dir);

    const group = new THREE.Group();
    scene.add(group);

    // Initialize Player and Controller
    const character = new Character();
    scene.add(character.group);
    character.load(); // async load

    const getGroundHeight = (x, z) => {
        if (generatorRef.current) {
            return generatorRef.current.getTerrainHeight(x, z);
        }
        return 0;
    };

    const playerController = new PlayerController(character, camera, getGroundHeight);

    const dom = renderer.domElement;
    dom.addEventListener("click", () => {
        dom.requestPointerLock();
    });

    const onPointerMove = (e) => {
        if (document.pointerLockElement === dom) {
            playerController.onMouseMove(e.movementX, e.movementY);
        }
    };
    window.addEventListener("mousemove", onPointerMove);

    let rafId;
    let lastTime = performance.now();
    let frameCount = 0;
    let fpsTime = 0;
    
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // FPS counter
      frameCount++;
      fpsTime += delta;
      if (fpsTime >= 1.0) {
        if (stateRef.current?.onFpsUpdate) stateRef.current.onFpsUpdate(frameCount);
        frameCount = 0;
        fpsTime = 0;
      }

      if (document.pointerLockElement === dom) {
          playerController.update(delta);
      }
      
      // Keep sky dome centered on camera
      sky.position.copy(camera.position);

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
      chunkGroup: group,
      dom,
      playerController,
      character,
      cleanup: () => {
        cancelAnimationFrame(rafId);
        resizeObserver.disconnect();
        window.removeEventListener("mousemove", onPointerMove);
        playerController.cleanup();
        container.removeChild(dom);
        renderer.dispose();
      }
    };
  }, [containerRef]);

  return { init, stateRef, generatorRef };
}

export default function WorldViewer({ onBack, charConfig }) {
  const containerRef = useRef(null);
  const { init, stateRef, generatorRef } = useThreeScene(containerRef);
  const [status, setStatus] = useState(i18n.initializingScene);
  const [fps, setFps] = useState(0);
  const [stats, setStats] = useState({ chunks: 0, voxels: 0, decorations: 0 });

  // Initialize with charConfig once, and also update when it changes
  useEffect(() => {
    if (stateRef.current && stateRef.current.character && charConfig) {
      // If it's just appearance, we could call setAppearance.
      // But load() is safer to ensure it reconstructs correctly from config.
      stateRef.current.character.setAppearance(charConfig);
    }
  }, [charConfig, stateRef.current]);

  const [wireframe, setWireframe] = useState(false);
  
  const materialsRef = useRef(null);
  const decorationMeshRef = useRef(null); // Reference to the loaded .cub geometry and material

  const [seed, setSeed] = useState(Math.floor(Math.random() * 1000000).toString());

  useEffect(() => {
    // We use Basic material because Mesher.js bakes Cube World's distinct
    // directional shading and AO directly into the vertex colors!
    materialsRef.current = new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: wireframe
    });
  }, []);

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

  // P2 Fix: use useEffect to call generateWorld AFTER init() has run and stateRef is populated
  const hasGeneratedRef = useRef(false);
  useEffect(() => {
    if (stateRef.current && !hasGeneratedRef.current) {
      hasGeneratedRef.current = true;
      stateRef.current.onFpsUpdate = setFps;
      generateWorld(seed);
    }
  });

  const handleSeedChange = (e) => {
    setSeed(e.target.value);
  };

  const handleRegenerate = () => {
    generateWorld(seed);
  };

  const generateWorld = async (currentSeed) => {
    setStatus(i18n.generatingWorld);
    const state = stateRef.current;
    if (!state) return;

    const generator = new WorldGenerator(currentSeed || seed);
    generatorRef.current = generator;
    
    // Clear previous chunks
    while(state.chunkGroup.children.length > 0) { 
        const child = state.chunkGroup.children[0];
        if (child.geometry) child.geometry.dispose();
        state.chunkGroup.remove(child); 
    }

    const renderRadius = 4; // 8x8 chunks (128x128 voxels)
    let totalVoxels = 0;
    let chunksGenerated = 0;
    let decorationsPlaced = 0;

    const generateChunkAsync = (cx, cz) => new Promise(resolve => {
        setTimeout(() => {
            const chunkData = generator.generateChunk(cx, cz);
            const geometry = buildChunkMeshGeometry(
                chunkData.width, chunkData.height, chunkData.depth,
                chunkData.voxels, chunkData.colors
            );
            
            const mesh = new THREE.Mesh(geometry, materialsRef.current);
            mesh.position.set(cx * CHUNK_WIDTH, 0, cz * CHUNK_DEPTH);
            state.chunkGroup.add(mesh);
            
            let solidCount = 0;
            for(let i=0; i<chunkData.voxels.length; i++) if(chunkData.voxels[i]) solidCount++;
            
            // Stamp features if we have a decoration loaded
            if (decorationMeshRef.current && chunkData.features) {
                for (const feature of chunkData.features) {
                    const localY = chunkData.heightMap[feature.x + CHUNK_WIDTH * feature.z];
                    
                    const decoGroup = new THREE.Group();
                    const clone = decorationMeshRef.current.mesh.clone();
                    decoGroup.add(clone);
                    
                    // Scale down the .cub object
                    decoGroup.scale.set(0.1, 0.1, 0.1);
                    
                    // Position at world coordinates
                    decoGroup.position.set(
                        cx * CHUNK_WIDTH + feature.x + 0.5,
                        localY + 1, // Place exactly on top of the surface voxel
                        cz * CHUNK_DEPTH + feature.z + 0.5
                    );
                    
                    state.chunkGroup.add(decoGroup);
                    decorationsPlaced++;
                }
            }
            
            resolve({ solidCount, decorationsPlaced });
        }, 0);
    });

    let currentDecorations = 0;
    for (let cz = -renderRadius; cz < renderRadius; cz++) {
        for (let cx = -renderRadius; cx < renderRadius; cx++) {
            const result = await generateChunkAsync(cx, cz);
            totalVoxels += result.solidCount;
            chunksGenerated++;
            currentDecorations = result.decorationsPlaced;
            setStats({ chunks: chunksGenerated, voxels: totalVoxels, decorations: currentDecorations });
        }
    }

    setStatus(i18n.ready);
  };

  const toggleWireframe = useCallback(() => {
    setWireframe((w) => {
      const next = !w;
      if (materialsRef.current) {
        materialsRef.current.wireframe = next;
      }
      return next;
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100%", width: "100%", fontFamily: "Segoe UI, Tahoma, sans-serif" }}>
      <div style={{ width: "260px", padding: "8px", display: "flex", flexDirection: "column", gap: "12px", borderRight: "1px solid #dfdfdf", background: "#f0f0f0" }}>
        
        <button onClick={onBack} style={{ alignSelf: 'flex-start', padding: '4px 8px', cursor: 'pointer' }}>
          &larr; {i18n.backToMenu}
        </button>

        <fieldset>
          <legend>{i18n.worldControls}</legend>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label htmlFor="seed-input" style={{ fontSize: 12 }}>{i18n.worldSeed}:</label>
              <div style={{ display: "flex", gap: "4px" }}>
                <input 
                  id="seed-input" 
                  type="text" 
                  value={seed} 
                  onChange={handleSeedChange} 
                  style={{ flex: 1, padding: "4px" }}
                />
                <button onClick={handleRegenerate} style={{ padding: "4px 8px", cursor: "pointer" }}>{i18n.generate}</button>
              </div>
            </div>
            <div className="field-row">
              <input 
                id="wireframe-check" 
                type="checkbox" 
                checked={wireframe} 
                onChange={toggleWireframe} 
              />
              <label htmlFor="wireframe-check">{i18n.wireframeMode}</label>
            </div>
            <div style={{ fontSize: 12, color: "#555", marginTop: "12px" }}>
              <strong>{i18n.controls}:</strong><br/>
              {i18n.controlClick}<br/>
              W,A,S,D: {i18n.walk}<br/>
              Mouse: {i18n.camera}<br/>
              {i18n.space}: {i18n.jump}<br/>
              ESC: {i18n.exitMode}
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>{i18n.status}</legend>
          <div style={{ fontSize: 13 }}>
             {status}<br/>
             FPS: <strong>{fps}</strong>
          </div>
        </fieldset>

        <fieldset style={{ flex: 1, overflowY: "auto" }}>
          <legend>{i18n.properties}</legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dotted #ccc" }}>
                <strong>{i18n.chunksRendered}:</strong><span>{stats.chunks}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dotted #ccc" }}>
                <strong>{i18n.solidVoxels}:</strong><span>{stats.voxels.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dotted #ccc" }}>
                <strong>{i18n.objectsCub}:</strong><span>{stats.decorations}</span>
              </div>
            </div>
        </fieldset>
      </div>

      <div
        ref={onContainerReady}
        style={{ flex: 1, position: "relative", border: "1px inset #ccc", background: "#fff", margin: "8px", boxSizing: "border-box" }}
      >
      </div>
    </div>
  );
}
