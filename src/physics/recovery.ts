import { Quaternion, Vector3 } from "three";

export interface SafeCarPose {
  position: Vector3;
  orientation: Quaternion;
}
export interface SafeCarConditions {
  wheelLengths: readonly number[];
  suspensionLengths: readonly number[];
  roadFrictions: readonly number[];
  disabled?: boolean;
  split?: boolean;
  volumeGravity?: number;
  dynamicSupport?: boolean;
}
const copyPose = (pose: SafeCarPose): SafeCarPose => ({
  position: pose.position.clone(),
  orientation: pose.orientation.clone(),
});
export function allWheelsSuspended(conditions: SafeCarConditions) {
  return (
    conditions.wheelLengths.length === 4 &&
    conditions.wheelLengths.every(
      (length, i) => length < conditions.suspensionLengths[i >> 1],
    )
  );
}

/** Installed ControlOurCar's inlined RememberSafePosition, 0x4150ee, and
 * FlipUpCar 0x4428a0. Store complete source poses rather than a path projection.
 * The browser records its local human car; network/rival recovery is separate.
 */
export class SafeCarHistory {
  private poses: SafeCarPose[];
  private timeCount = 0;
  constructor(initial: SafeCarPose) {
    this.poses = Array.from({ length: 20 }, () => copyPose(initial));
  }
  get snapshots() {
    return this.poses.map(copyPose);
  }
  remember(deltaMs: number, pose: SafeCarPose, conditions: SafeCarConditions) {
    this.timeCount += deltaMs;
    if (this.timeCount < 5000) return false;
    this.timeCount = 4000;
    if (
      conditions.disabled ||
      conditions.split ||
      !allWheelsSuspended(conditions) ||
      (conditions.volumeGravity ?? 1) !== 1 ||
      conditions.dynamicSupport ||
      conditions.roadFrictions.length !== 4 ||
      conditions.roadFrictions.some(
        (friction) => Math.fround(friction) < Math.fround(0.1),
      ) ||
      Math.fround(new Vector3(0, 1, 0).applyQuaternion(pose.orientation).y) <
        Math.fround(0.8) ||
      this.poses
        .slice(0, 5)
        .some(
          (old) =>
            old.position.distanceToSquared(pose.position) <
            Math.fround(8.4015961),
        )
    )
      return false;
    this.poses.pop();
    this.poses.unshift(copyPose(pose));
    this.timeCount = 0;
    return true;
  }
  /** Called three times by FlipUpCar. Each attempt consumes its selected entries;
   * the original tail is retained, so even a fresh race has a usable fallback. */
  next(position: Vector3, allFourWheels: boolean) {
    const index =
      allFourWheels &&
      position.distanceToSquared(this.poses[0].position) <=
        Math.fround(8.3015966)
        ? 1
        : 0;
    const pose = copyPose(this.poses[index]);
    for (let j = 0; j <= index; j++) {
      this.poses.shift();
      this.poses.push(copyPose(this.poses[this.poses.length - 1]));
    }
    return { ...pose, selectedIndex: index };
  }
}
