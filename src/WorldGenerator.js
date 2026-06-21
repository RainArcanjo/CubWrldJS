import { createNoise2D, createNoise3D } from 'simplex-noise';
import alea from 'alea';

// Constants
export const CHUNK_WIDTH = 32;
export const CHUNK_DEPTH = 32;
export const CHUNK_HEIGHT = 64; // Max height

// Biome definitions
const BIOMES = {
  // Colors extracted from Cube World screenshot analysis:
  // Grass: vivid lime-green (#9DD420 approx)
  // Forest: deep emerald (darker than plains)
  // Desert: warm sandy yellow
  // Snow: pale blue-white
  // Mountain: cool slate grey
  DESERT:   { id: 'desert',   color: [230, 190, 120] },
  PLAINS:   { id: 'plains',   color: [157, 212,  32] }, // vivid lime green
  FOREST:   { id: 'forest',   color: [ 80, 160,  20] }, // deep emerald
  SNOW:     { id: 'snow',     color: [220, 235, 255] }, // blue-white
  MOUNTAIN: { id: 'mountain', color: [130, 125, 140] }, // cool slate
};

export const WATER_LEVEL = 12;

function getBiome(temp, moisture, heightHint) {
  if (heightHint > 50) return BIOMES.SNOW;
  if (heightHint > 40) return BIOMES.MOUNTAIN;
  
  if (temp > 0.5) {
    if (moisture < 0.4) return BIOMES.DESERT;
    return BIOMES.PLAINS;
  } else {
    if (moisture > 0.5) return BIOMES.FOREST;
    return BIOMES.PLAINS;
  }
}

export class WorldGenerator {
  constructor(seed = "cubeworld-seed") {
    this.seed = seed;
    this.prng = alea(seed);
    this.noise2D_temp = createNoise2D(alea(seed + "_temp"));
    this.noise2D_moisture = createNoise2D(alea(seed + "_moisture"));
    this.noise2D_height = createNoise2D(alea(seed + "_height"));
    this.noise3D_color = createNoise3D(alea(seed + "_color"));
    this.regions = new Map();
  }

  getRegionCell(chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    if (this.regions.has(key)) {
      return this.regions.get(key);
    }

    const scale = 0.05;
    const temp = (this.noise2D_temp(chunkX * scale, chunkZ * scale) + 1) / 2;
    const moisture = (this.noise2D_moisture(chunkX * scale, chunkZ * scale) + 1) / 2;
    
    let heightHint = (this.noise2D_height(chunkX * scale, chunkZ * scale) + 1) / 2;
    // Lower base height to allow deep lakes
    heightHint = Math.floor(heightHint * 35) + 5;

    const biome = getBiome(temp, moisture, heightHint);

    const cell = { chunkX, chunkZ, temp, moisture, heightHint, biome };
    this.regions.set(key, cell);
    return cell;
  }
  
  applyColor(colorsArray, index, baseColor, gx, gy, gz) {
      // 1:1 Cube World procedural color variation technique
      // Uses a high-frequency 3D noise field to "dirty" the voxel colors
      const noiseVal = this.noise3D_color(gx * 0.15, gy * 0.15, gz * 0.15);
      // variation from 0.85 to 1.15
      const variation = 1.0 + noiseVal * 0.15;
      
      colorsArray[index * 3] = Math.min(255, Math.max(0, baseColor[0] * variation));
      colorsArray[index * 3 + 1] = Math.min(255, Math.max(0, baseColor[1] * variation));
      colorsArray[index * 3 + 2] = Math.min(255, Math.max(0, baseColor[2] * variation));
  }

  getTerrainHeight(globalX, globalZ) {
    let e = 1 * ((this.noise2D_height(globalX * 0.01, globalZ * 0.01) + 1)/2)
          + 0.5 * ((this.noise2D_height(globalX * 0.02, globalZ * 0.02) + 1)/2)
          + 0.25 * ((this.noise2D_height(globalX * 0.04, globalZ * 0.04) + 1)/2);
    e = e / (1 + 0.5 + 0.25);
    
    let yMax = Math.floor(e * 35 + 2);
    if (yMax < 1) yMax = 1;
    if (yMax >= CHUNK_HEIGHT) yMax = CHUNK_HEIGHT - 1;
    
    return Math.max(yMax, WATER_LEVEL) + 1; // +1 to stand ON the voxel
  }

  generateChunk(chunkX, chunkZ) {
    const expectedVoxels = CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_DEPTH;
    const voxels = new Uint8Array(expectedVoxels);
    const colors = new Uint8Array(expectedVoxels * 3);
    const heightMap = new Uint8Array(CHUNK_WIDTH * CHUNK_DEPTH);

    const cell = this.getRegionCell(chunkX, chunkZ);
    // Palette matched to Cube World screenshot:
    const dirtColor  = [132, 88,  42];  // warm mid-brown
    const stoneColor = [115, 110, 120]; // cool grey-purple (like the screenshot mountains)
    const sandColor  = [220, 195, 120]; // warm tan beach
    const waterColor = [ 50, 150, 220]; // clear blue water

    for (let z = 0; z < CHUNK_DEPTH; z++) {
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        const globalX = chunkX * CHUNK_WIDTH + x;
        const globalZ = chunkZ * CHUNK_DEPTH + z;
        
        let e = 1 * ((this.noise2D_height(globalX * 0.01, globalZ * 0.01) + 1)/2)
              + 0.5 * ((this.noise2D_height(globalX * 0.02, globalZ * 0.02) + 1)/2)
              + 0.25 * ((this.noise2D_height(globalX * 0.04, globalZ * 0.04) + 1)/2);
        e = e / (1 + 0.5 + 0.25);
        
        // Multiplier for more dramatic peaks and valleys
        let yMax = Math.floor(e * 35 + 2);
        
        if (yMax < 1) yMax = 1;
        if (yMax >= CHUNK_HEIGHT) yMax = CHUNK_HEIGHT - 1;
        
        // Surface color logic
        let surfaceColor = cell.biome.color;
        
        // Create beaches near water level
        if (yMax >= WATER_LEVEL && yMax <= WATER_LEVEL + 2) {
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
              this.applyColor(colors, idx, rawColor, globalX, y, globalZ);
          }
        }
      }
    }

    // Generate features (trees/rocks) using the calculated heightMap
    const features = [];
    if (cell.biome === BIOMES.FOREST || cell.biome === BIOMES.PLAINS || cell.biome === BIOMES.SNOW) {
      // Chunk is now 32x32, so we can spawn more trees (e.g., 4x the area)
      const featureCount = cell.biome === BIOMES.FOREST ? 16 : 4;
      const cellPrng = alea(`${this.seed}_features_${chunkX}_${chunkZ}`);
      
      for (let i = 0; i < featureCount; i++) {
        const lx = Math.floor(cellPrng() * CHUNK_WIDTH);
        const lz = Math.floor(cellPrng() * CHUNK_DEPTH);
        
        const localY = heightMap[lx + CHUNK_WIDTH * lz];
        
        // Do not spawn trees underwater or on beaches
        if (localY > WATER_LEVEL + 2) {
            features.push({ x: lx, z: lz, type: 'tree' });

            // Draw tree voxels directly so they show up without a .cub file
            // Make trees much larger to match the new chunk size
            const treeHeight = Math.floor(cellPrng() * 6) + 6; // 6 to 11
            const trunkColor = [101, 67, 33];
            const leafColor = cell.biome === BIOMES.SNOW ? [240, 255, 255] : [34, 139, 34];
            
            // Trunk
            for (let ty = 1; ty <= treeHeight; ty++) {
                const y = localY + ty;
                if (y >= CHUNK_HEIGHT) break;
                const idx = lx + CHUNK_WIDTH * (y + CHUNK_HEIGHT * lz);
                voxels[idx] = 1;
                this.applyColor(colors, idx, trunkColor, chunkX * CHUNK_WIDTH + lx, y, chunkZ * CHUNK_DEPTH + lz);
            }
            
            // Leaves (Sphere-ish)
            const crownY = localY + treeHeight;
            const radius = Math.floor(cellPrng() * 2) + 3; // 3 to 4
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dz = -radius; dz <= radius; dz++) {
                        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > radius * 1.5) continue;
                        const nx = lx + dx;
                        const ny = crownY + dy;
                        const nz = lz + dz;
                        
                        if (nx >= 0 && nx < CHUNK_WIDTH && nz >= 0 && nz < CHUNK_DEPTH && ny > localY && ny < CHUNK_HEIGHT) {
                            const idx = nx + CHUNK_WIDTH * (ny + CHUNK_HEIGHT * nz);
                            if (voxels[idx] === 0) {
                                voxels[idx] = 1;
                                this.applyColor(colors, idx, leafColor, chunkX * CHUNK_WIDTH + nx, ny, chunkZ * CHUNK_DEPTH + nz);
                            }
                        }
                    }
                }
            }
        }
      }
    }

    return {
      chunkX, chunkZ,
      width: CHUNK_WIDTH, height: CHUNK_HEIGHT, depth: CHUNK_DEPTH,
      voxels, colors, heightMap, biome: cell.biome, features
    };
  }
}
