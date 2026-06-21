import * as THREE from 'three';

// ─── CUBE WORLD MOVEMENT PARAMETERS ────────────────────────────────────────────
// From IDA analysis and known game feel:
//   Walk speed  ≈  6 world-units/s
//   Run speed   ≈ 12 world-units/s  (hold Shift in original, we default to run)
//   Gravity     ≈ 30 u/s²
//   Jump force  ≈ 14 u/s (gives ~3 block jump height)
//   Camera dist ≈  7 units behind player
// ────────────────────────────────────────────────────────────────────────────────

export class PlayerController {
  constructor(character, camera, getGroundHeight) {
    this.character = character;
    this.camera = camera;
    this.getGroundHeight = getGroundHeight;

    // World position — start well above ground so it falls naturally
    this.pos = new THREE.Vector3(16, 80, 16);
    this.vel = new THREE.Vector3(0, 0, 0);

    // Camera angles
    this.yaw   = 0;       // horizontal rotation (mouse X)
    this.pitch = 0.25;    // vertical   rotation (mouse Y) — slight look-down

    // State
    this.isGrounded = false;
    this.keys = {};

    // ── Movement params ──────────────────────────────────────────────────────
    this.WALK_SPEED  = 6.0;
    this.RUN_SPEED   = 12.0;
    this.GRAVITY     = 30.0;
    this.JUMP_FORCE  = 14.0;
    this.ACCEL       = 40.0;  // ground acceleration (snappy like Cube World)
    this.DECEL       = 30.0;  // ground deceleration
    this.AIR_CONTROL = 0.15;  // fraction of accel available in air

    // ── Camera params ────────────────────────────────────────────────────────
    this.CAM_DIST    = 8.0;
    this.CAM_DIST_MIN = 2.0;
    this.CAM_DIST_MAX = 30.0;
    this.CAM_HEIGHT  = 2.5;   // camera target height above player feet
    this.PITCH_MIN   = -0.4;  // look down limit (radians)
    this.PITCH_MAX   =  1.1;  // look up limit

    // ── Key bindings ─────────────────────────────────────────────────────────
    this._onKeyDown = (e) => {
      this.keys[e.code] = true;
      // Prevent browser from eating Space (page scroll) while playing
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup',   this._onKeyUp);

    // ── Mouse look & zoom ────────────────────────────────────────────────────
    this.onMouseMove = (dx, dy) => {
      this.yaw   -= dx * 0.002;
      this.pitch += dy * 0.002;
      this.pitch  = Math.max(this.PITCH_MIN, Math.min(this.PITCH_MAX, this.pitch));
    };

    this._onWheel = (e) => {
      // e.deltaY is positive when scrolling down (zoom out)
      this.CAM_DIST += e.deltaY * 0.01;
      this.CAM_DIST = Math.max(this.CAM_DIST_MIN, Math.min(this.CAM_DIST_MAX, this.CAM_DIST));
    };
    window.addEventListener('wheel', this._onWheel, { passive: true });
  }

  cleanup() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup',   this._onKeyUp);
    window.removeEventListener('wheel',   this._onWheel);
  }

  update(delta) {
    // ── 1. Desired movement direction ────────────────────────────────────────
    // In Three.js, positive Z comes toward the camera.
    // When yaw = 0, "forward" = -Z (away from camera = into the world).
    const fwd   = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    // The "right" vector (strafe right) is +90 degrees from forward.
    // If we look at -Z, right is +X.
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = new THREE.Vector3();
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    wish.add(fwd);
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  wish.sub(fwd);
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  wish.sub(right);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) wish.add(right);

    const isRunning = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const targetSpeed = isRunning ? this.RUN_SPEED : this.WALK_SPEED;

    const isMoving = wish.lengthSq() > 0;
    if (isMoving) wish.normalize();

    // ── 2. Apply acceleration / deceleration on XZ ───────────────────────────
    const accelFactor = this.isGrounded ? 1.0 : this.AIR_CONTROL;

    if (isMoving) {
      // Accelerate toward wish direction
      const accel = this.ACCEL * accelFactor * delta;
      const desired = wish.clone().multiplyScalar(targetSpeed);
      this.vel.x += (desired.x - this.vel.x) * Math.min(accel, 1.0);
      this.vel.z += (desired.z - this.vel.z) * Math.min(accel, 1.0);
    } else {
      // Decelerate to stop
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

    // ── 3. Gravity ───────────────────────────────────────────────────────────
    this.vel.y -= this.GRAVITY * delta;

    // ── 4. Integrate position ─────────────────────────────────────────────────
    this.pos.x += this.vel.x * delta;
    this.pos.y += this.vel.y * delta;
    this.pos.z += this.vel.z * delta;

    // ── 5. Ground collision ───────────────────────────────────────────────────
    const groundY = this.getGroundHeight(this.pos.x, this.pos.z);

    if (this.pos.y <= groundY) {
      this.pos.y = groundY;
      if (this.vel.y < 0) this.vel.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    // ── 6. Jump ───────────────────────────────────────────────────────────────
    if (this.isGrounded && this.keys['Space']) {
      this.vel.y = this.JUMP_FORCE;
      this.isGrounded = false;
    }

    // ── 7. Rotate character to face movement direction ────────────────────────
    const horizSpeed = Math.sqrt(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
    if (isMoving && horizSpeed > 0.5) {
      // The .cub model naturally faces -Z (North) in Three.js space.
      // Math.atan2(-vel.x, -vel.z) gives:
      // W (0, -1) -> 0 -> keeps -Z facing -Z (Forward)
      // D (1, 0)  -> -PI/2 -> rotates -Z to face +X (Right)
      // A (-1, 0) -> PI/2 -> rotates -Z to face -X (Left)
      // S (0, 1)  -> PI -> rotates -Z to face +Z (Back)
      const movAngle = Math.atan2(-this.vel.x, -this.vel.z);
      const diff = movAngle - this.character.group.rotation.y;
      // wrap diff to [-PI, PI]
      const wrappedDiff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.character.group.rotation.y += wrappedDiff * Math.min(delta * 14, 1.0);
    }

    // ── 8. Animate limbs ─────────────────────────────────────────────────────
    const normSpeed = Math.min(horizSpeed / this.RUN_SPEED, 1.0);
    this.character.updateAnimation(normSpeed, delta);

    // ── 9. Place character mesh in world ─────────────────────────────────────
    this.character.group.position.copy(this.pos);

    // ── 10. Third-person camera (orbits yaw + pitch around player) ───────────
    const camTarget = this.pos.clone();
    camTarget.y += this.CAM_HEIGHT;

    const sinYaw   = Math.sin(this.yaw);
    const cosYaw   = Math.cos(this.yaw);
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);

    // Camera sits BEHIND the player along the yaw direction.
    // "Behind" = opposite of forward = +yaw direction
    const camOffset = new THREE.Vector3(
       Math.sin(this.yaw) * cosPitch * this.CAM_DIST,
       sinPitch * this.CAM_DIST,
       Math.cos(this.yaw) * cosPitch * this.CAM_DIST
    );

    this.camera.position.copy(camTarget).add(camOffset);
    this.camera.lookAt(camTarget);
  }
}
