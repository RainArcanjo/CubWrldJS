import * as THREE from 'three';

export class NPCController {
  constructor(character, getVoxel, startPos) {
    this.character = character;
    this.getVoxel = getVoxel;

    this.pos = new THREE.Vector3(startPos.x, startPos.y, startPos.z);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.isGrounded = false;
    
    // AI State
    this.state = 'IDLE';
    this.stateTimer = 0;
    this.targetDir = new THREE.Vector3();
    
    // Combat Stats
    this.hp = 100;
    this.maxHp = 100;
    this.isDead = false;

    // Movement params
    this.WALK_SPEED  = 4.0;
    this.GRAVITY     = 30.0;
    this.ACCEL       = 20.0; 
    this.DECEL       = 30.0; 

    this.character.group.position.copy(this.pos);
  }

  takeDamage(amount) {
      if (this.isDead) return;
      
      this.hp -= amount;
      if (this.hp <= 0) {
          this.hp = 0;
          this.isDead = true;
          this.state = 'DEAD';
          this.character.group.rotation.x = -Math.PI / 2; // Fall flat (Ragdoll)
          this.character.group.position.y += 0.5; // Offset to not clip entirely
      } else {
          this.state = 'HURT';
          this.stateTimer = 0.5; // Stagger duration
          this.vel.set(0, 5, 0); // Mini knockback/jump
          
          // Flash red
          this.character.group.traverse((child) => {
              if (child.material && child.material.uniforms) {
                  const originalHex = child.userData.originalColor; // Need to save original color, but for now we just tint
                  // Since materials are stylized, we can just manipulate the color
                  // In a real ECS we'd attach a status effect
              }
          });
      }
  }

  update(delta) {
    if (this.isDead) return; // Don't process AI or physics if dead (or process physics only)
    // Actually, let physics process so they fall to the ground if killed mid-air
    
    this.updateAI(delta);

    // AI Drive
    let targetSpeed = 0;
    const wish = new THREE.Vector3();

    if (this.state === 'WANDER') {
        wish.copy(this.targetDir);
        targetSpeed = this.WALK_SPEED;
    }

    if (wish.lengthSq() > 0) {
      wish.normalize();
      // Face the direction of movement (-Z is forward in Three.js, so we negate wish)
      const targetYaw = Math.atan2(-wish.x, -wish.z);
      
      // Smooth rotation
      let currentYaw = this.character.group.rotation.y;
      
      const diff = targetYaw - currentYaw;
      const wrappedDiff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.character.group.rotation.y += wrappedDiff * 10.0 * delta;
    }

    const isMoving = targetSpeed > 0;
    const accelFactor = this.isGrounded ? 1.0 : 0.15; // less control in air

    if (isMoving) {
      const accel = this.ACCEL * accelFactor * delta;
      const desired = wish.clone().multiplyScalar(targetSpeed);
      this.vel.x += (desired.x - this.vel.x) * Math.min(accel, 1.0);
      this.vel.z += (desired.z - this.vel.z) * Math.min(accel, 1.0);
    } else {
      const decel = this.DECEL * accelFactor * delta;
      const xz = new THREE.Vector2(this.vel.x, this.vel.z);
      if (xz.length() > 0.05) {
        xz.multiplyScalar(Math.max(0, 1.0 - decel));
        this.vel.x = xz.x;
        this.vel.z = xz.y;
      } else {
        this.vel.x = 0;
        this.vel.z = 0;
      }
    }

    // Gravity
    this.vel.y -= this.GRAVITY * delta;

    // AABB Collision
    const checkCollision = (x, y, z) => {
      if (!this.getVoxel) return false;
      const w = 0.35; 
      const h = 1.6;  // slightly smaller than player
      const minX = Math.floor(x - w);
      const maxX = Math.floor(x + w);
      const minY = Math.floor(y);
      const maxY = Math.floor(y + h);
      const minZ = Math.floor(z - w);
      const maxZ = Math.floor(z + w);
      
      for (let bx = minX; bx <= maxX; bx++) {
        for (let by = minY; by <= maxY; by++) {
          for (let bz = minZ; bz <= maxZ; bz++) {
            if (this.getVoxel(bx, by, bz) > 0) return true;
          }
        }
      }
      return false;
    };

    // Step X
    if (this.vel.x !== 0) {
      const nextX = this.pos.x + this.vel.x * delta;
      if (checkCollision(nextX, this.pos.y, this.pos.z)) {
        if (!checkCollision(nextX, this.pos.y + 1.1, this.pos.z)) {
          this.pos.x = nextX;
          this.pos.y += 1.1; 
        } else {
          this.vel.x = 0; 
          this.targetDir.x *= -1; // Bounce AI
        }
      } else {
        this.pos.x = nextX;
      }
    }

    // Step Z
    if (this.vel.z !== 0) {
      const nextZ = this.pos.z + this.vel.z * delta;
      if (checkCollision(this.pos.x, this.pos.y, nextZ)) {
         if (!checkCollision(this.pos.x, this.pos.y + 1.1, nextZ)) {
           this.pos.z = nextZ;
           this.pos.y += 1.1;
         } else {
           this.vel.z = 0; 
           this.targetDir.z *= -1; // Bounce AI
         }
      } else {
        this.pos.z = nextZ;
      }
    }

    // Step Y
    if (this.vel.y !== 0) {
      const nextY = this.pos.y + this.vel.y * delta;
      if (checkCollision(this.pos.x, nextY, this.pos.z)) {
        if (this.vel.y < 0) {
          this.pos.y = Math.floor(nextY) + 1.0; 
          this.vel.y = 0;
          this.isGrounded = true;
        } else {
          this.vel.y = 0;
        }
      } else {
        this.pos.y = nextY;
        this.isGrounded = false;
      }
    } else {
       if (!checkCollision(this.pos.x, this.pos.y - 0.1, this.pos.z)) {
           this.isGrounded = false;
       } else {
           this.isGrounded = true;
       }
    }

    // Update Model Position
    this.character.group.position.copy(this.pos);

    // Animations
    const speed = new THREE.Vector2(this.vel.x, this.vel.z).length();
    const normSpeed = Math.min(speed / this.WALK_SPEED, 1.0);
    if (this.character.updateAnimation) {
        this.character.updateAnimation({
          speed: normSpeed,
          isGrounded: this.isGrounded,
          isDashing: false,
          dashProgress: 0,
          fallSpeed: this.vel.y
        }, delta);
    }
  }

  updateAI(delta) {
      if (this.isDead) return;
      
      this.stateTimer -= delta;

      if (this.stateTimer <= 0) {
          if (this.state === 'HURT') {
              this.state = 'IDLE';
              this.stateTimer = 1.0;
          } else if (this.state === 'IDLE') {
              // 30% chance to WANDER, 70% chance to IDLE again
              if (Math.random() < 0.3) {
                  this.state = 'WANDER';
                  this.stateTimer = 1.0 + Math.random() * 3.0; // Wander for 1 to 4 seconds
                  
                  // Pick random direction
                  const angle = Math.random() * Math.PI * 2;
                  this.targetDir.set(Math.cos(angle), 0, Math.sin(angle)).normalize();
              } else {
                  this.stateTimer = 1.0 + Math.random() * 2.0; // Idle for 1 to 3 seconds
              }
          } else if (this.state === 'WANDER') {
              this.state = 'IDLE';
              this.stateTimer = 1.0 + Math.random() * 4.0;
              this.targetDir.set(0,0,0);
          }
      }
  }
}
