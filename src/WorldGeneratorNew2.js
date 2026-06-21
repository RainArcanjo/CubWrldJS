import { createNoise2D, createNoise3D } from 'simplex-noise';
import alea from 'alea';

// Constants
export const CHUNK_WIDTH = 32;
export const CHUNK_DEPTH = 32;
export const CHUNK_HEIGHT = 128; // Increased for massive amplitude
export const WATER_LEVEL = 20;

const VORONOI_CELL_SIZE = 1024;
const BLEND_RADIUS = 256.0; // Distance to blend between biomes

// Biome definitions
const BIOMES = {
  DESERT:   { id: 'desert',   color: [240, 126, 24] },  // Sand Base #F07E18
  PLAINS:   { id: 'plains',   color: [46, 139, 34] },   // Grass Base #2E8B22
  FOREST:   { id: 'forest',   color: [23, 74, 16] },    // Forest Base #174A10
  SNOW:     { id: 'snow',     color: [242, 247, 255] }, // Snow Base #F2F7FF
  MOUNTAIN: { id: 'mountain', color: [125, 125, 125] }, // Rock Base #7D7D7D
};

// Tree Styles
const TREE_STYLES = {
  NORMAL: 'normal',
  SAKURA: 'sakura',
  MAGIC: 'magic',
  AUTUMN: 'autumn'
};

// Shapers dictionary
const SHAPERS = {
  plains: (x, z, noise2D) => {
    let e = 1 * noise2D(x * 0.001, z * 0.001) + 0.25 * noise2D(x * 0.004, z * 0.004);
    return e * 15 + 22; // Suave
  },
  forest: (x, z, noise2D) => {
    let e = 1 * noise2D(x * 0.002, z * 0.002) + 0.5 * noise2D(x * 0.006, z * 0.006);
    return e * 20 + 26; // Médio
  },
  desert: (x, z, noise2D) => {
    let e = Math.sin(x * 0.004 + noise2D(x * 0.002, z * 0.002) * 2) * Math.cos(z * 0.004);
    return Math.abs(e) * 25 + 22; 
  },
  mountain: (x, z, noise2D) => {
    let n1 = 1.0 - Math.abs(noise2D(x * 0.0016, z * 0.0016) * 2 - 1);
    let n2 = 1.0 - Math.abs(noise2D(x * 0.004, z * 0.004) * 2 - 1);
    let e = n1 * n1 + 0.5 * (n2 * n2);
    return e * 60 + 22; // Colossal peaks
  },
  snow: (x, z, noise2D) => {
    let e = 1 * noise2D(x * 0.0012, z * 0.0012) + 0.5 * noise2D(x * 0.003, z * 0.003);
    return e * 40 + 35; // Alto e rolling
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
    this.noise2DPath = createNoise2D(alea(seed + "_path")); // For roads
    this.voronoiCache = new Map();
  }

  noise2D(x, z) {
    return (this.noise2DRaw(x, z) + 1) / 2;
  }

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
    const px = cx * VORONOI_CELL_SIZE + cellPrng() * VORONOI_CELL_SIZE;
    const pz = cz * VORONOI_CELL_SIZE + cellPrng() * VORONOI_CELL_SIZE;
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
    factor = factor * factor * (3 - 2 * factor);
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

    // --- Path Generation (Worm Noise) ---
    // Use an independent noise for roads. We take the absolute value so it forms thin lines around 0.
    let pathNoise = this.noise2DPath(globalX * 0.005, globalZ * 0.005);
    let isPath = Math.abs(pathNoise) < 0.03; // the lower the threshold, the thinner the road
    
    // Smooth out terrain for paths so they look worn down
    if (isPath) {
        // Flat blend towards average local height or just push down
        finalHeight = finalHeight - 1.0; 
    }

    let yMax = Math.floor(finalHeight);
    if (yMax < 1) yMax = 1;
    if (yMax >= CHUNK_HEIGHT) yMax = CHUNK_HEIGHT - 1;

    return {
      height: Math.max(yMax, WATER_LEVEL) + 1,
      yMax: yMax,
      color: finalColor,
      primaryBiome: vd.b1,
      isPath: isPath
    };
  }

  getTerrainHeight(globalX, globalZ) {
    return this.getTerrainData(globalX, globalZ).height;
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
    
    const centerData = this.getTerrainData(chunkX * CHUNK_WIDTH + CHUNK_WIDTH/2, chunkZ * CHUNK_DEPTH + CHUNK_DEPTH/2);
    const chunkBiome = centerData.primaryBiome;

    const waterColor = [18, 97, 214]; // Water Base #1261D6
    const dirtColor = [110, 54, 17];  // Bark Base #6E3611 (as dirt)
    const stoneColor = [90, 90, 90];  // Rock Dark #5A5A5A
    const sandColor = [251, 206, 53]; // Sand Bright #FBCE35
    const pathColor = [214, 180, 138]; // Cloud Shadow #D6B48A used for Dirt Road

    const heightMap = new Int32Array(CHUNK_WIDTH * CHUNK_DEPTH);

    for (let z = 0; z < CHUNK_DEPTH; z++) {
      for (let x = 0; x < CHUNK_WIDTH; x++) {
        const globalX = chunkX * CHUNK_WIDTH + x;
        const globalZ = chunkZ * CHUNK_DEPTH + z;
        
        const data = this.getTerrainData(globalX, globalZ);
        const yMax = data.yMax;
        
        let surfaceColor = data.color;
        
        // Override color if it's a path, but only above water!
        if (data.isPath && yMax > WATER_LEVEL + 1) {
            surfaceColor = pathColor;
        } else if (yMax >= WATER_LEVEL && yMax <= WATER_LEVEL + 2 && data.primaryBiome !== BIOMES.SNOW && !data.isPath) {
            surfaceColor = sandColor;
        }

        heightMap[x + CHUNK_WIDTH * z] = Math.max(yMax, WATER_LEVEL);

        for (let y = 0; y <= Math.max(yMax, WATER_LEVEL); y++) {
          const idx = x + CHUNK_WIDTH * (y + CHUNK_HEIGHT * z);
          
          let rawColor = null;
          if (y <= yMax) {
              voxels[idx] = 1;
              rawColor = surfaceColor;
              if (y < yMax - 1) rawColor = dirtColor;
              if (y < yMax - 4) rawColor = stoneColor;
          } else if (y <= WATER_LEVEL) {
              voxels[idx] = 1;
              rawColor = waterColor;
          }
          
          if (rawColor) {
              this.applyColor(colors, idx, rawColor);
          }
        }
      }
    }

    const features = [];
    if (chunkBiome === BIOMES.FOREST || chunkBiome === BIOMES.PLAINS || chunkBiome === BIOMES.SNOW) {
      const featureCount = chunkBiome === BIOMES.FOREST ? 6 : 2;
      const cellPrng = alea(`${this.seed}_features_${chunkX}_${chunkZ}`);
      
      for (let i = 0; i < featureCount; i++) {
        let isColossalFeature = cellPrng() > 0.97;
        const lx = isColossalFeature ? Math.floor(cellPrng() * 16) + 8 : Math.floor(cellPrng() * CHUNK_WIDTH);
        const lz = isColossalFeature ? Math.floor(cellPrng() * 16) + 8 : Math.floor(cellPrng() * CHUNK_DEPTH);
        const localY = heightMap[lx + CHUNK_WIDTH * lz];
        
        const globalX = chunkX * CHUNK_WIDTH + lx;
        const globalZ = chunkZ * CHUNK_DEPTH + lz;
        const isPath = Math.abs(this.noise2DPath(globalX * 0.005, globalZ * 0.005)) < 0.03;

        // No trees underwater, on beaches, OR on paths!
        if (localY > WATER_LEVEL + 2 && !isPath) {
            features.push({ x: lx, z: lz, type: 'tree' });
            
            // Randomly select Tree Variant
            let variantRoll = cellPrng();
            let style = TREE_STYLES.NORMAL;
            if (chunkBiome === BIOMES.FOREST) {
                if (variantRoll > 0.90) style = TREE_STYLES.MAGIC; // 10% Magic
                else if (variantRoll > 0.70) style = TREE_STYLES.SAKURA; // 20% Sakura
                else if (variantRoll > 0.60) style = TREE_STYLES.AUTUMN; // 10% Autumn
            }
            
            this.generateProceduralTree(
                lx, localY, lz, 
                voxels, colors, cellPrng, 
                chunkX, chunkZ, chunkBiome, style
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

  generateProceduralTree(startX, startY, startZ, voxels, colors, prng, chunkX, chunkZ, biome, style) {
    const trunkColor = [71, 34, 11]; // Bark Dark #47220B
    
    let isColossal = prng() > 0.98;
    let isGiant = prng() > 0.90;
    let isLarge = prng() > 0.70;
    let scale = isColossal ? 5 : isGiant ? 3 : isLarge ? 2 : 1;
    
    const baseHeight = Math.floor(prng() * 6) + 6;
    const treeHeight = isColossal ? baseHeight * scale * 1.5 : baseHeight * scale; 
    
    let currentX = startX;
    let currentY = startY + 1;
    let currentZ = startZ;
    
    // Neon Magic variables
    const isMagic = style === TREE_STYLES.MAGIC;
    const neonColors = [
        [0, 229, 255], // Magic Cyan #00E5FF
        [183, 132, 255], // Magic Purple #B784FF
    ];
    const neonColor = neonColors[Math.floor(prng() * neonColors.length)];
    let neonAngle = prng() * Math.PI * 2;
    
    for (let i = 0; i < treeHeight; i += scale) {
        if (currentY >= CHUNK_HEIGHT) break;
        
        for (let dx = 0; dx < scale; dx++) {
          for (let dy = 0; dy < scale; dy++) {
            for (let dz = 0; dz < scale; dz++) {
                let px = currentX + dx;
                let py = currentY + dy;
                let pz = currentZ + dz;
                if (px >= 0 && px < CHUNK_WIDTH && pz >= 0 && pz < CHUNK_DEPTH && py < CHUNK_HEIGHT) {
                    const idx = px + CHUNK_WIDTH * (py + CHUNK_HEIGHT * pz);
                    voxels[idx] = 1;
                    
                    // Neon Vines Logic (Only on outer shell of trunk, winding upwards)
                    if (isMagic && scale >= 2) {
                        // Calculate center of trunk
                        let cx = scale / 2.0;
                        let cz = scale / 2.0;
                        // Find expected position of vine based on angle
                        let vx = cx + Math.cos(neonAngle) * (cx - 0.5);
                        let vz = cz + Math.sin(neonAngle) * (cz - 0.5);
                        
                        let distToVine = Math.sqrt(Math.pow(dx - vx, 2) + Math.pow(dz - vz, 2));
                        if (distToVine < 1.5) {
                            this.applyColor(colors, idx, neonColor);
                        } else {
                            this.applyColor(colors, idx, trunkColor);
                        }
                    } else {
                        this.applyColor(colors, idx, trunkColor);
                    }
                }
            }
          }
        }
        
        neonAngle += 0.2; // Vine winds around the trunk
        
        if (i > 2 * scale && prng() > 0.7) {
            currentX += (prng() > 0.5 ? scale : -scale);
            currentZ += (prng() > 0.5 ? scale : -scale);
        }
        currentY += scale;
    }

    // Branching for massive trees
    let branches = [{x: currentX, y: currentY, z: currentZ, scale: scale}];
    if (scale >= 3) { // Giant and Colossal
       branches.push({x: currentX + scale*2, y: currentY - scale*2, z: currentZ + scale*2, scale: Math.max(1, scale - 1)});
       branches.push({x: currentX - scale*2, y: currentY - scale*3, z: currentZ - scale*2, scale: Math.max(1, scale - 1)});
    }

    if (WorldGenerator.leafTemplate) {
        const { width: lW, depth: lD, height: lH, voxels: lVoxels, colors: lColors } = WorldGenerator.leafTemplate;
        
        for (let branch of branches) {
            const bScale = branch.scale;
            const offsetX = branch.x - Math.floor((lW * bScale) / 2);
            const offsetY = branch.y - Math.floor((lH * bScale) / 4);
            const offsetZ = branch.z - Math.floor((lD * bScale) / 2);

            for (let lz = 0; lz < lH; lz++) {
                for (let ly = 0; ly < lD; ly++) {
                    for (let lx = 0; lx < lW; lx++) {
                        const lIdx = lx + lW * (ly + lD * lz);
                        if (lVoxels[lIdx] === 1) { 
                            for (let dx = 0; dx < bScale; dx++) {
                              for (let dy = 0; dy < bScale; dy++) {
                                for (let dz = 0; dz < bScale; dz++) {
                                    const worldX = offsetX + lx * bScale + dx;
                                    const worldY = offsetY + lz * bScale + dy; 
                                    const worldZ = offsetZ + ly * bScale + dz; 
                                    
                                    if (worldX >= 0 && worldX < CHUNK_WIDTH && worldZ >= 0 && worldZ < CHUNK_DEPTH && worldY < CHUNK_HEIGHT && worldY >= 0) {
                                        const mapIdx = worldX + CHUNK_WIDTH * (worldY + CHUNK_HEIGHT * worldZ);
                                        // Apenas preenche ar vazio (folhas não substituem galhos)
                                        if (voxels[mapIdx] === 0) {
                                            voxels[mapIdx] = 1;
                                            
                                            // Apply base template color
                                            let finalColor = [lColors[lIdx * 3], lColors[lIdx * 3 + 1], lColors[lIdx * 3 + 2]];
                                            
                                            // Override color based on Style
                                            if (style === TREE_STYLES.SAKURA) {
                                                // Sakura pink range: #FFB7C5 (255, 183, 197) to #FF9EB1 (255, 158, 177)
                                                let noise = prng();
                                                finalColor = [255, 158 + noise * 25, 177 + noise * 20];
                                            } else if (style === TREE_STYLES.MAGIC) {
                                                // Magic purple range: #8A4DFF (138, 77, 255)
                                                let noise = prng();
                                                finalColor = [138 + noise * 20, 77 + noise * 40, 255];
                                            } else if (style === TREE_STYLES.AUTUMN) {
                                                // Autumn orange/gold: #F07E18 (240, 126, 24)
                                                let noise = prng();
                                                finalColor = [240, 100 + noise * 40, 24];
                                            } else {
                                                // Normal Green - apply snow if needed
                                                finalColor[0] = Math.min(255, finalColor[0] + (biome === BIOMES.SNOW ? 100 : 0));
                                                finalColor[1] = Math.min(255, finalColor[1] + (biome === BIOMES.SNOW ? 100 : 0));
                                                finalColor[2] = Math.min(255, finalColor[2] + (biome === BIOMES.SNOW ? 100 : 0));
                                            }

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
        }
    }
  }
}
