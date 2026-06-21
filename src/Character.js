import * as THREE from 'three';
import { parseCub, buildMeshGeometry } from './CubViewer';

async function loadPart(url, colorHex = null, overrideColor = null, skinColorHex = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cannot load ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const parsed = parseCub(buf);

  // Remove RGB anchor/dummy voxels (Pure Red, Pure Green, Pure Blue)
  // These are used in Cube World .cub files to mark attachment points (e.g. dummy head in hair models)
  for (let i = 0; i < parsed.voxels.length; i++) {
    if (parsed.voxels[i] === 1) {
      const r = parsed.colors[i * 3];
      const g = parsed.colors[i * 3 + 1];
      const b = parsed.colors[i * 3 + 2];
      if ((r === 255 && g === 0 && b === 0) ||
          (r === 0 && g === 255 && b === 0) ||
          (r === 0 && g === 0 && b === 255)) {
        parsed.voxels[i] = 0; // Cull dummy voxel
      }
    }
  }

  const { geometry, baseColor } = buildMeshGeometry(parsed);
  
  if (colorHex && !overrideColor) {
    const c = new THREE.Color(colorHex);
    const skinC = skinColorHex ? new THREE.Color(skinColorHex) : null;
    const colors = geometry.attributes.color.array;
    for (let i = 0; i < colors.length; i += 3) {
      const r = colors[i];
      const g = colors[i + 1];
      const b = colors[i + 2];
      const max = Math.max(r, g, b);
      if (max === 0) continue;

      const rRatio = r / max;
      const gRatio = g / max;
      const bRatio = b / max;

      const isGrayscale = Math.abs(rRatio - gRatio) < 0.05 && Math.abs(gRatio - bRatio) < 0.05;
      const isSkin = rRatio > 0.95 && gRatio > 0.6 && gRatio < 0.95 && bRatio > 0.4 && bRatio < 0.85;

      if (isGrayscale) {
        colors[i]     = c.r * max;
        colors[i + 1] = c.g * max;
        colors[i + 2] = c.b * max;
      } else if (isSkin && skinC) {
        colors[i]     = skinC.r * max;
        colors[i + 1] = skinC.g * max;
        colors[i + 2] = skinC.b * max;
      }
    }
    geometry.attributes.color.needsUpdate = true;
  }

  if (overrideColor) {
    const c = new THREE.Color(overrideColor);
    const colors = geometry.attributes.color.array;
    for (let i = 0; i < colors.length; i += 3) {
      // For hands, original R was 1.0 (255) in hand.cub.
      // Since CUB_SHADE was already applied, colors[i] currently equals exactly the shade value!
      // So we can perfectly tint it by doing c * shade.
      const shade = colors[i];
      colors[i]     = c.r * shade;
      colors[i + 1] = c.g * shade;
      colors[i + 2] = c.b * shade;
    }
    geometry.attributes.color.needsUpdate = true;
  }

  const material = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);

  // Center mesh on its own origin
  mesh.position.set(-parsed.width / 2, -parsed.depth / 2, -parsed.height / 2);

  // Fix orientation: rotate so Z (cub-height) becomes Three.js Y (up)
  const g = new THREE.Group();
  g.rotation.x = -Math.PI / 2;
  g.add(mesh);

  return { node: g, W: parsed.width, D: parsed.depth, H: parsed.height, baseColor };
}

// Helper to try loading race-specific part, falling back to generic human part
async function loadPartFallback(urls, colorHex = null, overrideColor = null, skinColorHex = null) {
  for (let i = 0; i < urls.length; i++) {
    try {
      return await loadPart(urls[i], colorHex, overrideColor, skinColorHex);
    } catch (e) {
      if (i === urls.length - 1) {
        console.warn(`[Character] Failed to load all fallbacks for:`, urls);
        // Return an empty group as ultimate fallback to avoid crashing
        return { node: new THREE.Group(), W: 1, D: 1, H: 1 };
      }
    }
  }
}

function pad(n) {
  return n.toString().padStart(2, '0');
}

export class Character {
  constructor() {
    this.group = new THREE.Group();
    this.group.scale.setScalar(0.08);

    this.torsoG     = new THREE.Group();
    this.headG      = new THREE.Group();
    this.leftArmG   = new THREE.Group();
    this.rightArmG  = new THREE.Group();
    this.leftLegG   = new THREE.Group();
    this.rightLegG  = new THREE.Group();

    this.group.add(this.torsoG, this.headG,
                   this.leftArmG, this.rightArmG,
                   this.leftLegG, this.rightLegG);

    this.loaded = false;
    this.walkTime = 0;

    this._headBaseY = 0;
    this._armBaseX  = 0;
    this._armBaseY  = 0;
    this._legBaseY  = 0;

    // Default configuration
    this.config = {
      race: 'human',
      gender: 'm',
      face: 1,
      hair: 1,
      hairColor: '#ffaa00'
    };
  }

  // Allow live reloading of appearance
  async setAppearance(config) {
    this.config = { ...this.config, ...config };
    await this.load();
  }

  clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  async load() {
    this.loaded = false;
    const { race, gender, face, hair, hairColor } = this.config;
    const g = gender === 'm' ? 'm' : 'f'; // 'm' or 'f'
    
    // Clear old meshes
    this.clearGroup(this.torsoG);
    this.clearGroup(this.headG);
    this.clearGroup(this.leftArmG);
    this.clearGroup(this.rightArmG);
    this.clearGroup(this.leftLegG);
    this.clearGroup(this.rightLegG);

    try {
      // URLs resolution with fallbacks to default human components
      const bodyPaths = [
        `/sprites/${race}-body-${g}.cub`,
        `/sprites/${race}-body.cub`,
        `/sprites/body1.cub`
      ];
      
      const headPaths = [
        `/sprites/${race}-head-${g}${pad(face)}.cub`,
        `/sprites/${race}-head-${g}.cub`,
        `/sprites/human-head-m01.cub`
      ];

      const hairPaths = [
        `/sprites/${race}-hair-${g}${pad(hair)}.cub`,
        `/sprites/${race}-hair-base.cub`,
        `/sprites/human-hair-m01.cub`
      ];

      const armPaths = [
        `/sprites/${race}-hand.cub`,
        `/sprites/hand2.cub`
      ];

      const legPaths = [
        `/sprites/${race}-foot.cub`,
        `/sprites/foot.cub`
      ];

      // Load body, head first to get the skin color
      const [body, head] = await Promise.all([
        loadPartFallback(bodyPaths),
        loadPartFallback(headPaths)
      ]);

      const skinColorHex = head.baseColor ? head.baseColor.getHex() : null;

      // Now load hair, arms and legs, overriding skin voxels
      const [hairObj, armL, armR, legL, legR] = await Promise.all([
        loadPartFallback(hairPaths, hairColor, null, skinColorHex), // Apply hair tint and skin tint
        loadPartFallback(armPaths, null, skinColorHex),
        loadPartFallback(armPaths, null, skinColorHex),
        loadPartFallback(legPaths),
        loadPartFallback(legPaths)
      ]);

      // -- Torso
      // Body origin is centered. Bottom of torso should sit at leg.H
      const torsoY = legL.H + body.H * 0.5;
      this.torsoG.position.set(0, torsoY, 0);
      this.torsoG.add(body.node);

      // -- Head & Hair
      // Head origin is centered. It sits slightly sunken into the body
      const headY = legL.H + body.H + head.H * 0.5 - 2.0;
      this._headBaseY = headY;
      this.headG.position.set(0, headY, 0);
      this.headG.add(head.node);
      
      // Hair aligned to head center (they usually share the same 18x16x16 size)
      hairObj.node.position.y += (hairObj.H - head.H) * 0.5; 
      // Tiny scale to prevent Z-fighting with the head, particularly on female hairstyles
      hairObj.node.scale.set(1.005, 1.005, 1.005);
      this.headG.add(hairObj.node);

      // -- Arms (Floating fists)
      const armSideOffset = body.W * 0.55 + armL.H * 0.3;
      const armY = legL.H + body.H * 0.55;
      this._armBaseY = armY;
      this._armBaseX = armSideOffset;

      // Arm hangs DOWN from shoulder pivot
      armL.node.position.y = -armL.H * 0.5;
      this.leftArmG.position.set(armSideOffset, armY, 0);
      this.leftArmG.add(armL.node);

      armR.node.position.y = -armR.H * 0.5;
      this.rightArmG.position.set(-armSideOffset, armY, 0);
      this.rightArmG.add(armR.node);

      // -- Legs
      const legX = body.W * 0.22;
      this._legBaseY = legL.H; // Top of the foot is the pivot
      legL.node.position.y = -legL.H * 0.5; // Bottom of foot touches Y=0 locally
      this.leftLegG.position.set(legX, this._legBaseY, 0);
      this.leftLegG.add(legL.node);

      legR.node.position.y = -legR.H * 0.5;
      this.rightLegG.position.set(-legX, this._legBaseY, 0);
      this.rightLegG.add(legR.node);

      this.loaded = true;
    } catch (err) {
      console.error('[Character] load error:', err);
    }
  }

  updateAnimation(speed, delta) {
    if (!this.loaded) return;

    const FREQ = 2.4 * Math.PI * 2;
    const ARM_AMP = 0.65;
    const LEG_AMP = 0.55;
    const BOB_AMP = 0.8;

    if (speed > 0.05) {
      this.walkTime += delta * FREQ * speed;
    } else {
      this.walkTime *= 0.80;
    }

    const s = Math.sin(this.walkTime);

    this.leftArmG.rotation.x  =  s * ARM_AMP * speed;
    this.rightArmG.rotation.x = -s * ARM_AMP * speed;

    this.leftLegG.rotation.x  = -s * LEG_AMP * speed;
    this.rightLegG.rotation.x =  s * LEG_AMP * speed;

    const bob = Math.abs(Math.sin(this.walkTime * 2)) * BOB_AMP * speed;
    this.headG.position.y = this._headBaseY + bob;
  }
}
