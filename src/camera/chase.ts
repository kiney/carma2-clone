import { Quaternion, Vector3 } from "three";

const TURN = 65536;
const angle = (value: number) => Math.trunc(value) & 0xffff;
const degrees = (value: number) => angle((value * TURN) / 360);
const radians = (value: number) => angle((value * TURN) / (2 * Math.PI));
const toRadians = (value: number) => value * ((2 * Math.PI) / TURN);
const Y = new Vector3(0, 1, 0);
// Native literal BR_ANGLE_DEG constants use 182, unlike conversions above.
const HALF = 180 * 182,
  QUARTER = 90 * 182;

export interface ChaseCameraInput {
  dtMs: number;
  worldCOM: Vector3;
  orientation: Quaternion;
  /** World velocity in model units/second. FinishCars divides its length by1000. */
  modelVelocity: Vector3;
  /** Native omega is local to the car, in radians/second. */
  angularVelocityLocal?: Vector3;
  rearWheelZ: number;
  steeringCurvature: number;
  fovBRenderAngle: number;
  frameCollision?: boolean;
  flying?: boolean;
  cameraReset?: boolean;
  /** Optional native camera yaw, unsigned BRender angle. */
  yawBRenderAngle?: number;
}

export interface ChaseCameraPose {
  cameraPosition: Vector3;
  aimDirection: Vector3;
  travelDirection: Vector3;
  viewDirection: Vector3;
  distance: number;
  pitchBRenderAngle: number;
}

function finiteVector(v: Vector3): boolean {
  return [v.x, v.y, v.z].every(Number.isFinite);
}
function horizontal(v: Vector3, fallback: Vector3): Vector3 {
  v.y = 0;
  // Finite browser extension for exactly vertical/zero travel directions.
  return v.lengthSq() > 0 ? v.normalize() : fallback.clone();
}
function rotate(v: Vector3, yaw: number): void {
  v.applyAxisAngle(Y, toRadians(yaw));
}

/** Independent live-camera equations mapped by rec2 and checked in installed C2:
 * external pose410c60, angular tracking411980, aim411fc0. World/own-shape
 * clearance and countdown/replay camera modes belong to the caller.
 */
export class NativeChaseCamera {
  private zoomValue = Math.fround(0.2);
  private height = 0;
  private view = new Vector3(0, 0, -1);
  private travel = new Vector3(0, 0, -1);
  private oldTravel = new Vector3();
  private position = new Vector3();
  private reverse = false;
  private reversalMs = -1;
  private rateAngle = 0;
  private fastSwing = false;
  private yaw = 0;
  private previousYaw = 0;
  private wheelTracking = true;
  private mode: -2 | -1 | 0 | 1 = -2;
  private initialized = false;
  private previousSpeed = 0;

  get zoom(): number {
    return this.zoomValue;
  }
  set zoom(value: number) {
    if (!Number.isFinite(value)) throw new Error("Invalid camera zoom");
    this.zoomValue = Math.fround(Math.max(0.1, Math.min(2, value)));
  }
  get state() {
    return {
      reverse: this.reverse,
      reversalMs: this.reversalMs,
      rateBRenderAngle: this.rateAngle,
      fastSwing: this.fastSwing,
      mode: this.mode,
      height: this.height,
      yawBRenderAngle: this.yaw,
    };
  }

  reset(
    worldCOM: Vector3,
    orientation: Quaternion,
    travelDirection?: Vector3,
  ): void {
    if (
      !finiteVector(worldCOM) ||
      ![orientation.x, orientation.y, orientation.z, orientation.w].every(
        Number.isFinite,
      ) ||
      (travelDirection && !finiteVector(travelDirection))
    )
      throw new Error("Invalid camera reset pose");
    const forward = new Vector3(0, 0, -1).applyQuaternion(orientation);
    this.travel.copy(travelDirection ?? forward).normalize();
    this.view.copy(
      horizontal(
        this.travel.clone(),
        horizontal(forward, new Vector3(0, 0, -1)),
      ),
    );
    this.reverse =
      this.view.dot(new Vector3(0, 0, 1).applyQuaternion(orientation)) > 0;
    this.height = worldCOM.y;
    this.mode = -2;
    this.position.copy(worldCOM).addScaledVector(this.view, -this.distance());
    this.position.y += this.zoomValue * this.zoomValue + 0.3;
    this.initialized = true;
    this.previousSpeed = 0;
    // Native InitialiseExternalCamera retains static SwingCamera history.
  }

  private distance(): number {
    return Math.sqrt(this.zoomValue) + 4 / 6.9;
  }

  /** Feed the final obstruction-resolved position back for collision mode1. */
  resolvePosition(position: Vector3): void {
    if (!finiteVector(position))
      throw new Error("Invalid resolved camera position");
    this.position.copy(position);
  }

  /** Recompute native aim after the caller resolves camera collisions. */
  aim(worldCOM: Vector3, cameraPosition: Vector3, fovBRenderAngle: number) {
    const toward = horizontal(worldCOM.clone().sub(cameraPosition), this.view);
    const distance = worldCOM.clone().sub(cameraPosition).dot(toward);
    const pitch = angle(
      Math.trunc(fovBRenderAngle / 5) -
        radians(Math.atan2(cameraPosition.y - worldCOM.y, distance)),
    );
    const elevation = toRadians(pitch);
    return {
      pitchBRenderAngle: pitch,
      aimDirection: toward
        .multiplyScalar(Math.cos(elevation))
        .addScaledVector(Y, Math.sin(elevation)),
    };
  }

  update(input: ChaseCameraInput): ChaseCameraPose {
    const { dtMs, worldCOM, orientation, modelVelocity } = input;
    if (
      !Number.isSafeInteger(dtMs) ||
      dtMs < 0 ||
      dtMs > 0xffff_ffff ||
      !finiteVector(worldCOM) ||
      !finiteVector(modelVelocity) ||
      ![
        orientation.x,
        orientation.y,
        orientation.z,
        orientation.w,
        input.rearWheelZ,
        input.steeringCurvature,
      ].every(Number.isFinite) ||
      (input.angularVelocityLocal &&
        !finiteVector(input.angularVelocityLocal)) ||
      !Number.isInteger(input.fovBRenderAngle) ||
      input.fovBRenderAngle < 0 ||
      input.fovBRenderAngle > 65535 ||
      (input.yawBRenderAngle !== undefined &&
        (!Number.isInteger(input.yawBRenderAngle) ||
          input.yawBRenderAngle < 0 ||
          input.yawBRenderAngle > 65535))
    )
      throw new Error("Invalid native chase camera input");
    if (!this.initialized) this.reset(worldCOM, orientation);
    const forward = new Vector3(0, 0, -1).applyQuaternion(orientation);
    let speed = Math.hypot(modelVelocity.x, modelVelocity.z) / 1000;
    if (this.previousSpeed < 0.0001 && speed > 0.0001) speed = 0.0001;
    this.previousSpeed = speed;
    const speedometer = forward.dot(modelVelocity) / 1000;
    // FinishCars retains forward/reverse direction when below its speed floor.
    if (speed > 0.0001) this.travel.copy(modelVelocity).normalize();
    else {
      const travelSign = this.travel.dot(forward) < 0 ? -1 : 1;
      this.travel.copy(forward).multiplyScalar(travelSign);
    }
    if (input.yawBRenderAngle !== undefined)
      this.yaw = angle(input.yawBRenderAngle);
    const manualSwing = this.yaw !== this.previousYaw;
    if (Math.abs(speedometer) > 0.0006 && this.mode > 0) {
      this.mode = -1;
      this.reverse = false; // Ordinary live camera has standard replay mode0.
    }
    if (input.frameCollision && this.mode !== -2) this.mode = 1;
    if (input.flying || input.cameraReset || this.mode === -2) this.mode = 0;
    const distance = this.distance();
    let direction: Vector3;
    if (this.mode === 0 || this.mode === -1) {
      direction = this.travel.clone();
      if (speed <= 0.0001 && this.mode === 0) {
        const steering = radians(
          Math.atan2(input.rearWheelZ * input.steeringCurvature, 1),
        );
        const folded = this.yaw > HALF ? this.yaw - HALF : this.yaw;
        if (manualSwing) {
          const sideView = folded > 45 * 182 && folded < 135 * 182;
          if (sideView === this.wheelTracking) {
            this.yaw = angle(
              this.yaw +
                (sideView ? 1 : -1) * (this.reverse ? -1 : 1) * steering,
            );
            this.wheelTracking = !sideView;
          }
        }
        if (this.wheelTracking && !input.flying) rotate(direction, steering);
      }
      direction = horizontal(direction, this.view);
      if (input.flying) this.reverse = false;
      this.swing(
        direction,
        forward,
        orientation,
        input.angularVelocityLocal ?? new Vector3(),
        dtMs,
        manualSwing,
        !!input.flying,
      );
      this.position.copy(worldCOM).addScaledVector(direction, -distance);
      this.view.copy(direction);
    } else {
      this.rateAngle = 0;
      this.fastSwing = false;
      const displacement = worldCOM.clone().sub(this.position);
      if (manualSwing) {
        rotate(
          displacement,
          angle((this.reverse ? -1 : 1) * (this.yaw - this.previousYaw)),
        );
        this.yaw = this.previousYaw;
      }
      direction = horizontal(displacement, this.view);
      const backwardBasis = forward.clone().negate();
      if (
        manualSwing ||
        backwardBasis.dot(direction) < backwardBasis.dot(this.view)
      )
        this.view.copy(direction);
      this.position.copy(worldCOM).addScaledVector(direction, -distance);
    }
    const seconds = dtMs / 1000;
    if (dtMs >= 5000) this.height = worldCOM.y;
    else
      this.height =
        (this.height + 5 * seconds * worldCOM.y) / (1 + 5 * seconds);
    const increment = this.zoomValue * this.zoomValue + 0.3;
    // Retain native positive slope guard, independent of yaw/swing direction.
    if (this.travel.y * distance > 0)
      this.height = Math.max(
        this.height,
        worldCOM.y - this.travel.y * distance - increment / 2,
      );
    this.position.y = this.height + increment;
    this.previousYaw = this.yaw;
    return {
      cameraPosition: this.position.clone(),
      ...this.aim(worldCOM, this.position, input.fovBRenderAngle),
      distance,
      travelDirection: this.travel.clone(),
      viewDirection: this.view.clone(),
    };
  }

  private swing(
    desired: Vector3,
    forward: Vector3,
    orientation: Quaternion,
    omega: Vector3,
    dtMs: number,
    manual: boolean,
    flying: boolean,
  ): void {
    if (this.reversalMs > 500) this.reversalMs = -1;
    if (this.reversalMs >= 0) this.reversalMs += dtMs;
    const sign = forward.dot(desired);
    if (sign < 0 === this.reverse) this.reversalMs = -1;
    else if (desired.dot(this.oldTravel) <= 0 || this.reversalMs >= 0) {
      if (this.reverse) {
        if (this.reversalMs < 0) this.reversalMs = 0;
        if (this.reversalMs < 500 && sign <= 0) desired.negate();
        else {
          this.reverse = !this.reverse;
          this.rateAngle = degrees(this.fastSwing ? 12 : 8);
          const folded = this.yaw > HALF ? this.yaw - HALF : this.yaw;
          if (
            this.yaw + QUARTER > HALF ||
            (folded > 45 * 182 && folded < 135 * 182)
          )
            this.yaw = angle(HALF - this.yaw);
        }
      }
    } else {
      this.reverse = !this.reverse;
      const folded = this.yaw > HALF ? this.yaw - HALF : this.yaw;
      if (folded > 45 * 182 && folded < 135 * 182) this.yaw = angle(-this.yaw);
    }
    this.oldTravel.copy(desired);
    if (!flying) rotate(desired, this.reverse ? angle(-this.yaw) : this.yaw);
    const dot = desired.x * this.view.x + desired.z * this.view.z;
    const cross = desired.x * this.view.z - desired.z * this.view.x;
    if (dot < 0.5 && this.yaw === 0) this.fastSwing = true;
    const yawRate = omega.clone().applyQuaternion(orientation).y;
    const minimum = radians((dtMs * (Math.abs(yawRate) + Math.PI / 36)) / 1000);
    const angularError = radians(Math.sqrt(Math.abs(cross)));
    const canSnap = this.rateAngle === 0 && dot > 0 && angularError < minimum;
    if (!canSnap && !flying && !manual) {
      if (this.rateAngle === 0)
        this.rateAngle = degrees(this.fastSwing ? 3 : 2);
      let step = angle(Math.trunc((dtMs * this.rateAngle) / 100));
      if (step < minimum) step = minimum;
      if (Math.cos(toRadians(step)) > dot) {
        if (dot < -0.7 && Math.abs(yawRate) > 0.8 && yawRate * cross > 0)
          step = angle(-step);
        const turn = cross > 0 ? step : angle(-step);
        desired.copy(this.view);
        rotate(desired, turn);
        this.rateAngle = Math.min(
          angle(
            this.rateAngle + degrees(dtMs * (this.fastSwing ? 0.06 : 0.04)),
          ),
          degrees(this.fastSwing ? 40 : 10),
        );
        return;
      }
    }
    this.rateAngle = 0;
    this.fastSwing = false;
    this.mode = 0;
  }
}
