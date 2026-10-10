import { Quaternion, Vector3 } from "three";

/** FinishCars (installed 0x416520): vehicle travel is independent of view mode. */
export class CameraVehicleTravel {
  private speed = 0;
  private speedometer = 0;
  private direction = new Vector3(0, 0, -1);

  reset(orientation: Quaternion): void {
    this.speed = 0;
    this.speedometer = 0;
    this.direction.set(0, 0, -1).applyQuaternion(orientation);
  }

  update(velocity: Vector3, orientation: Quaternion) {
    const forward = new Vector3(0, 0, -1).applyQuaternion(orientation);
    let speed = Math.hypot(velocity.x, velocity.z) / 1000;
    if (this.speed < 0.0001 && speed > 0.0001) speed = 0.0001;
    this.speed = speed;
    if (speed > 0.0001) {
      this.direction.copy(velocity).normalize();
      this.speedometer = forward.dot(velocity) / 1000;
    } else {
      const sign = this.direction.dot(forward) < 0 ? -1 : 1;
      this.direction.copy(forward).multiplyScalar(sign);
      // Installed 0x4166ca–0x416741 reuses the untransformed local +/-Z
      // temporary for speedometer on this branch, not world forward.
      this.speedometer = (-sign * velocity.z) / 1000;
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      speed: this.speed,
      speedometer: this.speedometer,
      direction: this.direction.clone(),
    };
  }
}
