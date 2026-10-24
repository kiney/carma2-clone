export interface WheelControlBody {
  state: { wheelLengths: readonly number[]; curvature: number };
  poseEpoch?: number;
  damage?: { repairRevision: number };
}
export interface WheelControlPose {
  wheelLengths: number[];
  curvature: number;
}
interface ControlSnapshot extends WheelControlPose {
  epoch?: number;
  repairRevision?: number;
}

/** Presentation history captured beside body poses before each physics tick.
 * It owns scalar copies only; sampled controls never become simulation state. */
export class RenderWheelControls {
  private previous = new Map<WheelControlBody, ControlSnapshot>();

  capture(bodies: readonly WheelControlBody[]): void {
    const live = new Set(bodies);
    for (const body of this.previous.keys())
      if (!live.has(body)) this.previous.delete(body);
    for (const body of bodies) {
      const snapshot = this.previous.get(body) ?? {
        wheelLengths: [],
        curvature: 0,
      };
      snapshot.wheelLengths.length = body.state.wheelLengths.length;
      for (let i = 0; i < body.state.wheelLengths.length; i++)
        snapshot.wheelLengths[i] = body.state.wheelLengths[i];
      snapshot.curvature = body.state.curvature;
      snapshot.epoch = body.poseEpoch;
      snapshot.repairRevision = body.damage?.repairRevision;
      this.previous.set(body, snapshot);
    }
  }

  sample(
    body: WheelControlBody,
    alpha: number,
    target: WheelControlPose = { wheelLengths: [], curvature: 0 },
  ): WheelControlPose {
    const old = this.previous.get(body);
    const fraction =
      !old ||
      old.epoch !== body.poseEpoch ||
      old.repairRevision !== body.damage?.repairRevision
        ? 1
        : Math.max(0, Math.min(1, alpha));
    target.wheelLengths.length = body.state.wheelLengths.length;
    for (let i = 0; i < body.state.wheelLengths.length; i++) {
      const current = body.state.wheelLengths[i];
      const previous = old?.wheelLengths[i] ?? current;
      target.wheelLengths[i] =
        fraction === 1 ? current : previous + (current - previous) * fraction;
    }
    target.curvature =
      fraction === 1
        ? body.state.curvature
        : old!.curvature + (body.state.curvature - old!.curvature) * fraction;
    return target;
  }

  clear(): void {
    this.previous.clear();
  }
}
