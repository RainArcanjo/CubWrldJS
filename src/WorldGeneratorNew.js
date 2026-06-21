import { createNoise2D, createNoise3D } from 'simplex-noise';
import alea from 'alea';

// Constants
export const CHUNK_WIDTH = 32;
export const CHUNK_DEPTH = 32;
export const CHUNK_HEIGHT = 64; // Max height
export const WATER_LEVEL = 12;

const VORONOI_CELL_SIZE = 256;
const BLEND_RADIUS = 64.0; // Distance to blend between biomes

// Biome definitions
const BIOMES = {
  DESERT:   { id: 'desert',   color: [230, 190, 120] },
  PLAINS:   { id: 'plains',   color: [157, 212,  32] }, 
  FOREST:   { id: 'forest',   color: [ 80, 160,  20] }, 
  SNOW:     { id: 'snow',     color: [220, 235, 255] }, 
  MOUNTAIN: { id: 'mountain', color: [130, 125, 140] }, 
};

// Shapers dictionary
const SHAPERS = {
  plains: (x, z, noise2D) => {
    let e = 1 * noise2D(x * 0.005, z * 0.005) + 0.25 * noise2D(x * 0.02, z * 0.02);
    return e * 8 + 15; // Suave, 15-23
  },
  forest: (x, z, noise2D) => {
    let e = 1 * noise2D(x * 0.01, z * 0.01) + 0.5 * noise2D(x * 0.03, z * 0.03);
    return e * 12 + 16; // Médio, 16-28
  },
  desert: (x, z, noise2D) => {
    // Dunas senoidais
    let e = Math.sin(x * 0.02 + noise2D(x * 0.01, z * 0.01) * 2) * Math.cos(z * 0.02);
    return Math.abs(e) * 10 + 14; 
  },
  mountain: (x, z, noise2D) => {
    // Ridged noise: picos afiados
    let n1 = 1.0 - Math.abs(noise2D(x * 0.008, z * 0.008) * 2 - 1);
    let n2 = 1.0 - Math.abs(noise2D(x * 0.02, z * 0.02) * 2 - 1);
    let e = n1 * n1 + 0.5 * (n2 * n2);
    return e * 35 + 15; 
  },
  snow: (x, z, noise2D) => {
    let e = 1 * noise2D(x * 0.006, z * 0.006) + 0.5 * noise2D(x * 0.015, z * 0.015);
    return e * 20 + 25; // Alto e rolling
  }
};

export class WorldGenerator {
  static leafTemplate = null;

  static setLeafTemplate(parsedCub) {
    WorldGenerator.leafTemplate = parsedCub;
  }

  constructor(seed = "cubeworld-seed") {
    this.seed = seed;
    this.prng = alea(seed);
    this.noise2DRaw = createNoise2D(alea(seed + "_height"));
    this.voronoiCache = new Map();
  }

  // Normalized noise [0, 1]
  noise2D(x, z) {
    return (this.noise2DRaw(x, z) + 1) / 2;
  }

  // Determine a cell's biome based on global noise to keep macro-climates contiguous
  getMacroBiome(globalX, globalZ) {
    const temp = this.noise2D(globalX * 0.001, globalZ * 0.001);
    const moisture = this.noise2D(globalX * 0.001 + 1000, globalZ * 0.001 + 1000);
    const heightHint = this.noise2D(globalX * 0.001 + 2000, globalZ * 0.001 + 2000);

    if (heightHint > 0.7) return BIOMES.MOUNTAIN;
    if (heightHint > 0.6 && temp < 0.4) return BIOMES.SNOW;
    if (temp > 0.6) {
      if (moisture < 0.4) return BIOMES.DESERT;
      return BIOMES.PLAINS;
    } else {
      if (moisture > 0.5) return BIOMES.FOREST;
      return BIOMES.PLAINS;
    }
  }

  getVoronoiPoint(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.voronoiCache.has(key)) return this.voronoiCache.get(key);

    const cellPrng = alea(this.seed + key);
    
    // Ponto central da célula + offset aleatório
    const px = cx * VORONOI_CELL_SIZE + cellPrng() * VORONOI_CELL_SIZE;
    const pz = cz * VORONOI_CELL_SIZE + cellPrng() * VORONOI_CELL_SIZE;
    
    // Bioma
    const biome = this.getMacroBiome(px, pz);
    
    const point = { x: px, z: pz, biome };
    this.voronoiCache.set(key, point);
    return point;
  }

  getVoronoiData(globalX, globalZ) {
    const cx = Math.floor(globalX / VORONOI_CELL_SIZE);
    const cz = Math.floor(globalZ / VORONOI_CELL_SIZE);

    let closest = null;
    let secondClosest = null;
    let minDist1 = Infinity;
    let minDist2 = Infinity;

    // Checar as 9 células ao redor
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const point = this.getVoronoiPoint(cx + dx, cz + dz);
        const dist = Math.sqrt(Math.pow(globalX - point.x, 2) + Math.pow(globalZ - point.z, 2));

        if (dist < minDist1) {
          minDist2 = minDist1;
          secondClosest = closest;
          
          minDist1 = dist;
          closest = point;
        } else if (dist < minDist2) {
          minDist2 = dist;
          secondClosest = point;
        }
      }
    }

    let diff = minDist2 - minDist1;
    let factor = Math.min(diff / BLEND_RADIUS, 1.0);
    // Smoothstep: factor = 0 (borda), factor = 1 (centro)
    factor = factor * factor * (3 - 2 * factor);
    
    // Weight of closest biome goes from 0.5 (borda) to 1.0 (centro)
    let w1 = 0.5 + 0.5 * factor;

    return {
      w1,
      b1: closest.biome,
      b2: secondClosest.biome
    };
  }

  getTerrainData(globalX, globalZ) {
    const vd = this.getVoronoiData(globalX, globalZ);
    
    const h1 = SHAPERS[vd.b1.id](globalX, globalZ, this.noise2D.bind(this));
    let finalHeight = h1;
    let finalColor = vd.b1.color;

    if (vd.w1 < 1.0) {
      const h2 = SHAPERS[vd.b2.id](globalX, globalZ, this.noise2D.bind(this));
      finalHeight = h1 * vd.w1 + h2 * (1.0 - vd.w1);
      
      finalColor = [
        Math.floor(vd.b1.color[0] * vd.w1 + vd.b2.color[0] * (1.0 - vd.w1)),
        Math.floor(vd.b1.color[1] * vd.w1 + vd.b2.color[1] * (1.0 - vd.w1)),
        Math.floor(vd.b1.color[2] * vd.w1 + vd.b2.color[2] * (1.0 - vd.w1))
      ];
    }

    let yMax = Math.floor(finalHeight);
    if (yMax < 1) yMax = 1;
    if (yMax >= CHUNK_HEIGHT) yMax = CHUNK_HEIGHT - 1;

    return {
      height: Math.max(yMax, WATER_LEVEL) + 1,
      yMax: yMax,
      color: finalColor,
      primaryBiome: vd.b1
    };
  }

  applyColor(colorsArray, index, baseColor) {
      colorsArray[index * 3] = baseColor[0];
      colorsArray[index * 3 + 1] = baseColor[1];
      colorsArray[index * 3 + 2] = baseColor[2];
  }

  generateChunk(chunkX, chunkZ) {
    const expectedVoxels = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_DEPTH;
    const voxels = new Uint8Array(expectedVoxels);
    const colors = new Uint8Array(expectedVoxels * 3);
    
    // We store the primary biome of the center of the chunk for feature generation
    const centerData = this.getTerrainData(chunkX * CHUNK_WIDTH + CHUNK_WIDTH/2, chunkZ * CHUNK_DEPTH + CHUNK_DEPTH/2);
    const chunkBiome = centerData.primaryBiome;

    const waterColor = [40, 100, 200];
    const dirtColor = [139, 69, 19];
    const stoneColor = [128, 128, 128];
    const sandColor = [238, 214, 175];

    const heightMap = new Int32Array(CHUNK_WIDTH * CHUNK_DEPTH);

    for (let z = 0; z < CHUNK_DEPTH; z++) {
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        const globalX = chunkX * CHUNK_WIDTH + x;
        const globalZ = chunkZ * CHUNK_DEPTH + z;
        
        const data = this.getTerrainData(globalX, globalZ);
        const yMax = data.yMax;
        
        let surfaceColor = data.color;
        
        // Create beaches near water level
        if (yMax >= WATER_LEVEL && yMax <= WATER_LEVEL + 2 && data.primaryBiome !== BIOMES.SNOW) {
            surfaceColor = sandColor;
        }

        heightMap[x + CHUNK_WIDTH * z] = Math.max(yMax, WATER_LEVEL);

        for (let y = 0; y <= Math.max(yMax, WATER_LEVEL); y++) {
          const idx = x + CHUNK_WIDTH * (y + CHUNK_HEIGHT * z);
          
          let rawColor = null;
          if (y <= yMax) {
              // Terrain
              voxels[idx] = 1;
              rawColor = surfaceColor;
              if (y < yMax - 1) rawColor = dirtColor;
              if (y < yMax - 4) rawColor = stoneColor;
          } else if (y <= WATER_LEVEL) {
              // Water
              voxels[idx] = 1;
              rawColor = waterColor;
          }
          
          if (rawColor) {
              this.applyColor(colors, idx, rawColor);
          }
        }
      }
    }

    // Generate features (trees)
    const features = [];
    if (chunkBiome === BIOMES.FOREST || chunkBiome === BIOMES.PLAINS || chunkBiome === BIOMES.SNOW) {
      const featureCount = chunkBiome === BIOMES.FOREST ? 16 : 4;
      const cellPrng = alea(`${this.seed}_features_${chunkX}_${chunkZ}`);
      
      for (let i = 0; i < featureCount; i++) {
        const lx = Math.floor(cellPrng() * CHUNK_WIDTH);
        const lz = Math.floor(cellPrng() * CHUNK_DEPTH);
        const localY = heightMap[lx + CHUNK_WIDTH * lz];
        
        // Do not spawn trees underwater or on beaches
        if (localY > WATER_LEVEL + 2) {
            features.push({ x: lx, z: lz, type: 'tree' });
            this.generateProceduralTree(
                lx, localY, lz, 
                voxels, colors, cellPrng, 
                chunkX, chunkZ, chunkBiome
            );
        }
      }
    }

    return {
      chunkX, chunkZ,
      width: CHUNK_WIDTH, height: CHUNK_HEIGHT, depth: CHUNK_DEPTH,
      voxels, colors, heightMap, biome: chunkBiome, features
    };
  }

  generateProceduralTree(startX, startY, startZ, voxels, colors, prng, chunkX, chunkZ, biome) {
    const trunkColor = [101, 67, 33];
    const leafColorModifier = biome === BIOMES.SNOW ? 0.7 : 1.0; 
    const treeHeight = Math.floor(prng() * 5) + 5; 
    
    let currentX = startX;
    let currentY = startY + 1;
    let currentZ = startZ;
    
    for (let i = 0; i < treeHeight; i++) {
        if (currentY >= CHUNK_HEIGHT) break;
        
        if (currentX >= 0 && currentX < CHUNK_WIDTH && currentZ >= 0 && currentZ < CHUNK_DEPTH) {
            const idx = currentX + CHUNK_WIDTH * (currentY + CHUNK_HEIGHT * currentZ);
            voxels[idx] = 1;
            this.applyColor(colors, idx, trunkColor);
        }
        
        if (i > 2 && prng() > 0.7) {
            currentX += (prng() > 0.5 ? 1 : -1);
            currentZ += (prng() > 0.5 ? 1 : -1);
        }
        currentY++;
    }

    if (WorldGenerator.leafTemplate) {
        const { width: lW, depth: lD, height: lH, voxels: lVoxels, colors: lColors } = WorldGenerator.leafTemplate;
        
        const offsetX = currentX - Math.floor(lW / 2);
        const offsetY = currentY - Math.floor(lH / 4);
        const offsetZ = currentZ - Math.floor(lD / 2);

        for (let lz = 0; lz < lH; lz++) {
            for (let ly = 0; ly < lD; ly++) {
                for (let lx = 0; lx < lW; lx++) {
                    const lIdx = lx + lW * (ly + lD * lz);
                    if (lVoxels[lIdx] === 1) { 
                        const worldX = offsetX + lx;
                        const worldY = offsetY + lz; 
                        const worldZ = offsetZ + ly; 
                        
                        if (worldX >= 0 && worldX < CHUNK_WIDTH && worldZ >= 0 && worldZ < CHUNK_DEPTH && worldY < CHUNK_HEIGHT && worldY >= 0) {
                            const mapIdx = worldX + CHUNK_WIDTH * (worldY + CHUNK_HEIGHT * worldZ);
                            if (voxels[mapIdx] === 0) {
                                voxels[mapIdx] = 1;
                                
                                const origR = lColors[lIdx * 3];
                                const origG = lColors[lIdx * 3 + 1];
                                const origB = lColors[lIdx * 3 + 2];
                                
                                const finalColor = [
                                    Math.min(255, origR + (biome === BIOMES.SNOW ? 100 : 0)),
                                    Math.min(255, origG + (biome === BIOMES.SNOW ? 100 : 0)),
                                    Math.min(255, origB + (biome === BIOMES.SNOW ? 100 : 0))
                                ];

                                this.applyColor(colors, mapIdx, finalColor);
                            }
                        }
                    }
                }
            }
        }
    }
  }
}
