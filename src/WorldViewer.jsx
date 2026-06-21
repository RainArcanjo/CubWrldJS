import React, { useState, useRef, useCallback, useEffect } from "react";
import * as THREE from "three";
import { WorldGenerator, CHUNK_WIDTH, CHUNK_DEPTH } from "./WorldGenerator";
import { buildChunkMeshGeometry } from "./Mesher";
import { Character } from "./Character";
import { PlayerController } from "./PlayerController";
import { LightingGUI } from "./LightingGUI";
import { parseCub, buildMeshGeometry as buildItemGeometry } from "./CubViewer";
import { CharacterCreator } from "./CharacterCreator";
import { i18n } from "./i18n";
import { createStylizedMaterial, globalLightingUniforms } from "./Shaders";
import { Sky } from 'three/examples/jsm/objects/Sky.js';

function useThreeScene(containerRef) {
  const stateRef = useRef(null);
  const generatorRef = useRef(null); // Reference to the active WorldGenerator

  useEffect(() => {
    if (!containerRef.current) return;
    
    LightingGUI.mount();

    return () => {
      LightingGUI.unmount();
    };
  }, [containerRef]);

  const init = useCallback(() => {
    const container = containerRef.current;
    if (!container || stateRef.current) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    // Fog is now handled by Height Volumetric Fog inside Shaders.js

    // ─── ATMOSPHERIC SCATTERING SKY ───────────────────────────────────────────
    const sky = new Sky();
    sky.scale.setScalar(10000);
    scene.add(sky);

    // INCREASE FAR PLANE so 5000-radius sky dome and distant clouds don't get culled!
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 6000);
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

    // ─── STARS ─────────────────────────────────────────────────────────────
    const starsGeo = new THREE.BufferGeometry();
    const starPos = [];
    for(let i = 0; i < 3000; i++) {
      const x = THREE.MathUtils.randFloatSpread(10000); // spread over 10km
      const y = THREE.MathUtils.randFloat(800, 4800);   // higher in the sky
      const z = THREE.MathUtils.randFloatSpread(10000);
      starPos.push(x, y, z);
    }
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    const starsMat = new THREE.PointsMaterial({ 
      color: 0xffffff, 
      size: 2.5, 
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.4 // make them faint
    });
    const stars = new THREE.Points(starsGeo, starsMat);
    // Don't cull stars if they get outside frustum occasionally
    stars.frustumCulled = false;
    scene.add(stars);

    // ─── SUN & MOON ─────────────────────────────────────────────────────────
    const createFlatTexture = (colorHex) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = colorHex;
      ctx.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      return tex;
    };

    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: createFlatTexture('#fff4d4') }));
    sunSprite.scale.set(400, 400, 1);
    scene.add(sunSprite);

    const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: createFlatTexture('#d4e5ff') }));
    moonSprite.scale.set(250, 250, 1);
    scene.add(moonSprite);

    // ─── CLOUDS (INSTANCED) ─────────────────────────────────────────────────
    let cloud1Instanced, cloud2Instanced;
    const cloudDummy = new THREE.Object3D();
    const cloudData = []; // Keeps track of positions and types

    async function loadClouds() {
      try {
        const c1Res = await fetch('/sprites/cloud01.cub');
        const c2Res = await fetch('/sprites/cloud02.cub');
        const c1Buf = await c1Res.arrayBuffer();
        const c2Buf = await c2Res.arrayBuffer();
        
        const g1 = buildItemGeometry(parseCub(c1Buf)).geometry;
        const g2 = buildItemGeometry(parseCub(c2Buf)).geometry;

        try {
          const leavesRes = await fetch('/sprites/tree-leaves.cub');
          if (leavesRes.ok) {
            const leavesBuf = await leavesRes.arrayBuffer();
            WorldGenerator.setLeafTemplate(parseCub(leavesBuf));
          } else {
            console.warn("tree-leaves.cub returned status", leavesRes.status);
          }
        } catch (leafErr) {
          console.warn("Failed to load tree-leaves.cub", leafErr);
        }
        
        const mat = createStylizedMaterial();
        
        cloud1Instanced = new THREE.InstancedMesh(g1, mat, 36);
        cloud2Instanced = new THREE.InstancedMesh(g2, mat, 36);
        
        // Critical: InstancedMesh doesn't compute bounding sphere across all instances automatically.
        // It will instantly vanish when the camera turns away from the origin if we don't disable culling!
        cloud1Instanced.frustumCulled = false;
        cloud2Instanced.frustumCulled = false;
        
        scene.add(cloud1Instanced);
        scene.add(cloud2Instanced);
        
        const gridSize = 6; 
        const spacing = 800; 
        const startOffset = - (gridSize * spacing) / 2;

        let idx1 = 0; let idx2 = 0;
        for (let ix = 0; ix < gridSize; ix++) {
          for (let iz = 0; iz < gridSize; iz++) {
            const isG1 = Math.random() > 0.5;
            
            const x = startOffset + ix * spacing + (Math.random() - 0.5) * 600;
            const y = 250 + Math.random() * 40;
            const z = startOffset + iz * spacing + (Math.random() - 0.5) * 600;
            const rotY = Math.floor(Math.random() * 4) * (Math.PI / 2);
            
            cloudData.push({ isG1, x, y, z, rotY });
            
            cloudDummy.position.set(x, y, z);
            cloudDummy.rotation.y = rotY;
            cloudDummy.scale.set(18, 18, 18);
            cloudDummy.updateMatrix();
            
            if (isG1) {
              cloud1Instanced.setMatrixAt(idx1++, cloudDummy.matrix);
            } else {
              cloud2Instanced.setMatrixAt(idx2++, cloudDummy.matrix);
            }
          }
        }
        cloud1Instanced.count = idx1;
        cloud2Instanced.count = idx2;
        cloud1Instanced.instanceMatrix.needsUpdate = true;
        cloud2Instanced.instanceMatrix.needsUpdate = true;
      } catch (err) {
        console.error("Failed to load clouds", err);
      }
    }
    loadClouds();
    // ─────────────────────────────────────────────────────────────────────────

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
    
    let timeOfDay = 0;
    
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
      
      // Dynamic Chunk Loading (DISABLED)
      // if (stateRef.current && stateRef.current.onUpdateChunks) {
      //    stateRef.current.onUpdateChunks();
      // }
      
      // Time of day animation
      timeOfDay += delta * 0.05;
      const sunDist = 4500; // pushed further away
      
      const sunPos = new THREE.Vector3(
        camera.position.x + Math.cos(timeOfDay) * sunDist,
        camera.position.y + Math.sin(timeOfDay) * sunDist,
        camera.position.z
      );
      
      sunSprite.position.copy(sunPos);
      
      moonSprite.position.set(
        camera.position.x + Math.cos(timeOfDay + Math.PI) * sunDist,
        camera.position.y + Math.sin(timeOfDay + Math.PI) * sunDist,
        camera.position.z
      );

      // Sincronizar parâmetros físicos do Céu com a GUI
      const skyUniforms = sky.material.uniforms;
      skyUniforms['turbidity'].value = globalLightingUniforms.uSkyTurbidity.value;
      skyUniforms['rayleigh'].value = globalLightingUniforms.uSkyRayleigh.value;
      skyUniforms['mieCoefficient'].value = globalLightingUniforms.uSkyMieCoefficient.value;
      skyUniforms['mieDirectionalG'].value = globalLightingUniforms.uSkyMieDirectionalG.value;
      
      // Passar posição relativa do Sol para o Shader do Céu calcular o Halo e Cores
      const relativeSunPos = sunPos.clone().sub(camera.position).normalize();
      skyUniforms['sunPosition'].value.copy(relativeSunPos);

      // Sincronizar a cor do Fog volumétrico com o horizonte do Céu
      let sunY = relativeSunPos.y;
      if (sunY < 0.2 && sunY > -0.2) {
          // Sunset/Sunrise: Orange to Dark Blue
          let t = (sunY + 0.2) / 0.4; // 0 (Night) to 1 (Day)
          const colorNight = new THREE.Color(0x050510);
          const colorDay = new THREE.Color(0x7ec8e3);
          const colorSunset = new THREE.Color(0xff8c00); // Laranja avermelhado
          
          if (t < 0.5) {
             let subT = t / 0.5;
             globalLightingUniforms.uFogColor.value.lerpColors(colorNight, colorSunset, subT);
          } else {
             let subT = (t - 0.5) / 0.5;
             globalLightingUniforms.uFogColor.value.lerpColors(colorSunset, colorDay, subT);
          }
      } else if (sunY <= -0.2) {
          globalLightingUniforms.uFogColor.value.setHex(0x050510); // Night
      } else {
          globalLightingUniforms.uFogColor.value.setHex(0x7ec8e3); // Day
      }

      // Keep stars centered on camera and rotate slowly
      stars.position.copy(camera.position);
      stars.rotation.y -= delta * 0.005;

      // Keep sky dome centered on camera
      sky.position.copy(camera.position);

      // Animate clouds via InstancedMesh
      if (cloud1Instanced && cloud2Instanced) {
        let idx1 = 0; let idx2 = 0;
        const wrapDist = 2400;
        
        for (let i = 0; i < cloudData.length; i++) {
          const c = cloudData[i];
          c.z -= delta * 2.5; 
          
          const dz = c.z - camera.position.z;
          if (dz < -wrapDist) {
            c.z += wrapDist * 2;
            c.x = camera.position.x + (Math.random() - 0.5) * (wrapDist * 2);
          } else if (dz > wrapDist) {
            c.z -= wrapDist * 2;
          }
          
          const dx = c.x - camera.position.x;
          if (dx < -wrapDist) c.x += wrapDist * 2;
          if (dx > wrapDist) c.x -= wrapDist * 2;
          
          cloudDummy.position.set(c.x, c.y, c.z);
          cloudDummy.rotation.y = c.rotY;
          cloudDummy.scale.set(18, 18, 18);
          cloudDummy.updateMatrix();
          
          if (c.isG1) {
            cloud1Instanced.setMatrixAt(idx1++, cloudDummy.matrix);
          } else {
            cloud2Instanced.setMatrixAt(idx2++, cloudDummy.matrix);
          }
        }
        cloud1Instanced.instanceMatrix.needsUpdate = true;
        cloud2Instanced.instanceMatrix.needsUpdate = true;
      }

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
      stateRef.current.character.setAppearance(charConfig);
    }
  }, [charConfig, stateRef.current]);

  const [wireframe, setWireframe] = useState(false);
  
  const materialsRef = useRef(null);
  const decorationMeshRef = useRef(null); // Reference to the loaded .cub geometry and material

  const [seed, setSeed] = useState(Math.floor(Math.random() * 1000000).toString());
  const [renderRadius, setRenderRadius] = useState(4); // Balanced for 64x64 chunks (huge draw distance)
  
  const activeChunksRef = useRef(new Map());
  const generatingChunksRef = useRef(new Set());
  const lastChunkPosRef = useRef({ x: null, z: null });

  useEffect(() => {
    materialsRef.current = createStylizedMaterial(wireframe);
  }, []);

  useEffect(() => {
    // Attempt to load a simple bush or tree to decorate the world
    fetch('/sprites/wood-tree-random1.cub')
      .then(res => {
        if (!res.ok) throw new Error();
        return res.arrayBuffer();
      })
      .then(buf => {
         const parsed = parseCub(buf);
         const { geometry } = buildItemGeometry(parsed);
         const material = new THREE.MeshBasicMaterial({ vertexColors: true });
         decorationMeshRef.current = { mesh: new THREE.Mesh(geometry, material), h: parsed.height };
         // Optionally regenerate world if we wanted trees immediately
      })
      .catch(err => console.log("Tree model not found for decoration"));
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

  const generateChunkAsync = (cx, cz, state, generator) => new Promise(resolve => {
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
        
        resolve({ mesh, solidCount });
    }, 0);
  });

  // DISABLED dynamic chunk manager loop, kept here for reference
  // const updateChunks = () => { ... }
  // useEffect(() => { ... }, []);

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

    let totalVoxels = 0;
    let chunksGenerated = 0;

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
            
            resolve({ solidCount });
        }, 0); // small delay to yield UI
    });

    // Determine the map boundaries based on renderRadius
    // This generates a static grid around the center (0,0) exactly like the old system!
    for (let cz = -renderRadius; cz < renderRadius; cz++) {
        for (let cx = -renderRadius; cx < renderRadius; cx++) {
            setStatus(`Loading Map (${chunksGenerated}/${(renderRadius*2)*(renderRadius*2)})...`);
            const result = await generateChunkAsync(cx, cz);
            totalVoxels += result.solidCount;
            chunksGenerated++;
            setStats({ chunks: chunksGenerated, voxels: totalVoxels, decorations: 0 });
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

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current) {
        containerRef.current.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "row", height: "100%", width: "100%", fontFamily: "Segoe UI, Tahoma, sans-serif" }}>
      <div style={{ width: "260px", padding: "8px", display: "flex", flexDirection: "column", gap: "12px", borderRight: "1px solid #dfdfdf", background: "#f0f0f0" }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={onBack} style={{ padding: '4px 8px', cursor: 'pointer' }}>
            &larr; {i18n.backToMenu}
          </button>
          <button onClick={toggleFullscreen} style={{ padding: '4px 8px', cursor: 'pointer' }}>
            ⛶ Fullscreen
          </button>
        </div>

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
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label htmlFor="radius-input" style={{ fontSize: 12 }}>{i18n.renderDistance || "Render Distance"} ({renderRadius}):</label>
              <input 
                id="radius-input" 
                type="range" 
                min="2" 
                max="10" 
                value={renderRadius} 
                onChange={(e) => setRenderRadius(parseInt(e.target.value))} 
              />
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
        style={{ flex: 1, position: "relative", border: "1px inset #ccc", background: "#fff", margin: "8px", boxSizing: "border-box", overflow: "hidden" }}
      >
      </div>
    </div>
  );
}
