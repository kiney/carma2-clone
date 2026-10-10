import type { ContactImpact, RigidBody } from "../physics/contact";

/** Native PrepareCars/APTCPostCollision: accumulate solver contact bits through
 * every physics step, retaining the preceding last-step bits only on overshoot.
 * Zero-impulse rows still count; invalidated solves and type9 do not. */
export class CameraContactFrame {
  private lastStep = new Set<RigidBody>();
  private previousOvershoot = false;
  readonly bodies = new Set<RigidBody>();

  begin() {
    this.bodies.clear();
    if (this.previousOvershoot)
      for (const body of this.lastStep) this.bodies.add(body);
  }
  step(impacts: readonly ContactImpact[]) {
    this.lastStep.clear();
    for (const impact of impacts) {
      if (!impact.solverAccepted || impact.sourceType === 9) continue;
      this.lastStep.add(impact.a);
      if (impact.b) this.lastStep.add(impact.b);
    }
    for (const body of this.lastStep) this.bodies.add(body);
  }
  finish(lastPhysicsTickMs: number, frameEndMs: number) {
    const overshoot = lastPhysicsTickMs - frameEndMs;
    this.previousOvershoot = overshoot > 0 && overshoot <= 40;
  }
}
