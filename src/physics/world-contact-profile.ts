import type { RigidBody } from "./contact";

/** Opt-in, per-call wall timing. No per-feature timers or query wrappers. */
export interface WorldContactProfile {
  body: RigidBody;
  cpuMs: number;
  transformsMs: number;
  collectMs: number;
  recoveryMs: number;
  sweepMs: number;
  reduceMs: number;
  rawFaces: number;
  eligibleFaces: number;
  hulls: number;
  sweepTests: number;
  rejectedFaces: number;
  contacts: number;
}
