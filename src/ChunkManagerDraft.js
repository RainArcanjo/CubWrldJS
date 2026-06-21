// --- Chunk Manager Draft Logic ---
  // To be inserted in WorldViewer.jsx inside the component

  // We need refs to hold the active chunks mapping
  const activeChunksRef = useRef(new Map());
  const generatingChunksRef = useRef(new Set());
  const lastChunkPosRef = useRef({ x: null, z: null });
  
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
        
        // P2 Fix: Feature decoration loading logic removed from WorldViewer since WorldGenerator natively draws tree voxels now!
        // We only return the mesh and stats.
        
        resolve({ mesh, solidCount });
    }, 0); // 0ms timeout ensures we yield to main thread so animation doesn't freeze entirely
  });

  const updateChunks = () => {
    if (!stateRef.current || !generatorRef.current) return;
    
    const state = stateRef.current;
    const camera = state.camera;
    
    // Determine player's current chunk
    const currentChunkX = Math.floor(camera.position.x / CHUNK_WIDTH);
    const currentChunkZ = Math.floor(camera.position.z / CHUNK_DEPTH);
    
    // Only recalculate if we changed chunks
    if (lastChunkPosRef.current.x === currentChunkX && lastChunkPosRef.current.z === currentChunkZ) {
        return;
    }
    lastChunkPosRef.current.x = currentChunkX;
    lastChunkPosRef.current.z = currentChunkZ;
    
    const radius = renderRadius;
    const desiredChunks = new Set();
    
    for (let cz = currentChunkZ - radius; cz <= currentChunkZ + radius; cz++) {
        for (let cx = currentChunkX - radius; cx <= currentChunkX + radius; cx++) {
            desiredChunks.add(`${cx},${cz}`);
        }
    }
    
    // Dispose out of bounds
    for (const [key, chunk] of activeChunksRef.current.entries()) {
        if (!desiredChunks.has(key)) {
            chunk.mesh.geometry.dispose();
            state.chunkGroup.remove(chunk.mesh);
            activeChunksRef.current.delete(key);
            
            // update stats
            setStats(prev => ({ ...prev, chunks: prev.chunks - 1, voxels: prev.voxels - chunk.solidCount }));
        }
    }
    
    // Sort desired chunks by distance to player so we generate nearest first
    const chunksToGenerate = Array.from(desiredChunks)
        .filter(key => !activeChunksRef.current.has(key) && !generatingChunksRef.current.has(key))
        .map(key => {
            const [cx, cz] = key.split(',').map(Number);
            const dist = Math.abs(cx - currentChunkX) + Math.abs(cz - currentChunkZ);
            return { key, cx, cz, dist };
        })
        .sort((a, b) => a.dist - b.dist);
        
    // Fire async generator for all needed chunks
    for (const item of chunksToGenerate) {
        generatingChunksRef.current.add(item.key);
        
        generateChunkAsync(item.cx, item.cz, state, generatorRef.current).then(chunkInfo => {
            // Check if we still want it (we might have moved away while it was generating)
            // But since lastChunkPos might have changed, we just check distance again
            const currentCX = lastChunkPosRef.current.x;
            const currentCZ = lastChunkPosRef.current.z;
            
            if (Math.abs(item.cx - currentCX) <= radius && Math.abs(item.cz - currentCZ) <= radius) {
                activeChunksRef.current.set(item.key, chunkInfo);
                setStats(prev => ({ ...prev, chunks: prev.chunks + 1, voxels: prev.voxels + chunkInfo.solidCount }));
            } else {
                // Instantly throw it away
                chunkInfo.mesh.geometry.dispose();
                state.chunkGroup.remove(chunkInfo.mesh);
            }
            generatingChunksRef.current.delete(item.key);
        });
    }
  };

  // The animate loop should call updateChunks
  // Wait, if updateChunks only fires when crossing boundaries, we can call it every frame.
