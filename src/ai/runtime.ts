import { Vector3 } from "three";
import type { OpponentConfig, TrackPathSection } from "../config";
import type { SimulatedCar } from "../physics/simulation";
import {
  NativeRegularDecision,
  type NativeDecisionObjective,
} from "./decision";
import {
  NativeObjectiveLifecycle,
  type NativeObjectiveCounts,
} from "./objective-lifecycle";
import {
  NativeFollowLifecycle,
  type NativeFollowLifecycleHooks,
} from "./follow-lifecycle";
import { NativeRaceRouteState } from "./race-route-state";
import { NativeCompleteRaceState } from "./complete-race-state";
import { NativeGetNearPlayerState } from "./get-near-state";
import { NativeRunAwayState } from "./run-away-state";
import { NativePursuitState } from "./pursuit-state";
import { NativePathView } from "./path-view";
import { NativeOpponentTrail } from "./trail";
import { NativeVisibilityState, nativeHeadOnChance } from "./visibility";
import { nativeOpponentCheating, nativeOpponentProximity } from "./proximity";
import {
  nativeOpponentNastiness,
  type NativeForcedPersonality,
} from "./personality";
import { nativeActorLookUp } from "./actor-look";
import { NativeOpponentRepairState } from "./repair";
import { NativeLevitateState, type NativeLevitateResult } from "./levitate";
import { nativeTeleportOpponentToNearestSafeLocation } from "./fallen-world";
import {
  applyNativeCrashReaction,
  nativeCrashBigBangThreshold,
  type NativeCrashReactionCar,
  type NativeCrashReactionFlags,
  type NativeCrashCatalogEntry,
} from "./crash-reactions";

export interface NativeOpponentFleetHooks {
  /** Publication clock after browser asset staging; no UPDATE is consumed. */
  initialTimeMs?: number;
  skill: number;
  raceIndex: number;
  raceCount: number;
  viewDistance: number;
  repairLimits: readonly [number, number];
  nastinessMultiplier?: number;
  bigBangMultiplier?: number;
  random?: () => number;
  rayFraction(origin: Vector3, direction: Vector3): number;
  isPhysicsActive(body: SimulatedCar): boolean;
  setPhysicsActive(body: SimulatedCar, active: boolean): void;
  /** Presentation observer after a committed nonphysical FOLLOW pose. */
  onCheatyPose?(body: SimulatedCar): void;
  /** Placement owns collision probes, fallback and physics-on effects. */
  rematerialize(
    body: SimulatedCar,
    view: NativePathView,
    sectionSlot: number,
    speed: number,
  ): 0 | 1;
  rematerializeNearest(body: SimulatedCar, speed: number): 0 | 1;
  hasFallenOffWorld(body: SimulatedCar): boolean;
  recoverFallen?(body: SimulatedCar): void;
  repair(body: SimulatedCar): void;
  /** Rising stolen cars remain rendered while physical activity is disabled. */
  showLevitating?(body: SimulatedCar): void;
  isStolen?(body: SimulatedCar): boolean;
  countdown?(): number;
  stopOpponentsMoving?(): boolean;
  mapView?(): number;
  showOpponents?(): boolean;
  /** Original empty-race branch reads an uninitialized raw return slot. */
  emptyRaceRouteStatus?(body: SimulatedCar): number | undefined;
  diagnostic?(message: string): void;
}

interface CrashFacts {
  flags: NativeCrashReactionFlags;
  lastHitter: string | null;
  lastWeHit: string | null;
  contactTimeMs: number;
}
interface Rival {
  body: SimulatedCar;
  catalogIndex: number;
  personality: NativeForcedPersonality;
  nastiness: number;
  selector: NativeRegularDecision;
  objective: NativeObjectiveLifecycle;
  follow: NativeFollowLifecycle;
  race: NativeRaceRouteState;
  complete: NativeCompleteRaceState;
  getNear: NativeGetNearPlayerState;
  runAway: NativeRunAwayState;
  pursuit: NativePursuitState;
  visibility: NativeVisibilityState;
  trail: NativeOpponentTrail;
  repair?: NativeOpponentRepairState;
  levitate: NativeLevitateState;
  lastInViewMs: number;
  visibilityInitialDeadlineMs: number;
  cheating: boolean;
  playerDistance: number;
  movedEver: boolean;
  initialized: boolean;
}

/** Live regular-driver chain. The caller invokes UPDATE once per game frame,
 * before physics, and attribution while the victim accumulator remains live. */
export class NativeOpponentFleet {
  private readonly rivals = new Map<string, Rival>();
  private readonly cars = new Map<string, SimulatedCar>();
  private readonly facts = new Map<string, CrashFacts>();
  private readonly catalogState: NativeCrashCatalogEntry[];
  private readonly counts: NativeObjectiveCounts = {
    completeRace: 0,
    pursuing: 0,
    getNear: 0,
  };
  private readonly playerTrail = new NativeOpponentTrail();
  private targetCache = { section: -1, refreshAtMs: 0 };
  private nowMs = 0;
  private dtMs = 0;
  private factor = 1;
  private initialized = false;
  private acknowledgedStart = false;
  private firstFrame = true;
  private nextGrudgeReductionMs = 0;
  private readonly diagnostics = new Set<string>();
  private readonly random: () => number;
  private readonly bigBangThreshold: number;

  constructor(
    private readonly nodes: readonly Vector3[],
    private readonly sections: readonly TrackPathSection[],
    catalog: readonly OpponentConfig[],
    private readonly raceNastiness: number,
    private readonly player: SimulatedCar,
    private readonly hooks: NativeOpponentFleetHooks,
  ) {
    if (!nodes.length || !sections.length)
      throw new Error("Native opponent fleet requires authored roads");
    const initialTimeMs =
      hooks.initialTimeMs === undefined ? 0 : hooks.initialTimeMs;
    if (
      !Number.isInteger(initialTimeMs) ||
      initialTimeMs < 0 ||
      initialTimeMs > 0xffffffff
    )
      throw new Error("Invalid native opponent initial timestamp");
    this.nowMs = initialTimeMs;
    this.random = hooks.random ?? Math.random;
    this.catalogState = catalog.map((entry) => ({
      strength: entry.strengthRating,
      grudge: 0,
    }));
    this.bigBangThreshold = nativeCrashBigBangThreshold(
      hooks.raceIndex,
      hooks.raceCount,
      hooks.skill,
      hooks.bigBangMultiplier ?? 1,
    );
    this.registerCar(player);
  }

  add(
    body: SimulatedCar,
    catalogIndex: number,
    forcedPersonality: NativeForcedPersonality,
  ): void {
    if (
      body.human ||
      this.rivals.has(body.group.uuid) ||
      !this.catalogState[catalogIndex] ||
      ![0, 1, 2, 3].includes(forcedPersonality)
    )
      throw new Error("Invalid native opponent registration");
    if (!this.initialized) {
      this.nextGrudgeReductionMs = (this.nowMs + 10000) >>> 0;
      this.initialized = true;
    }
    const race = new NativeRaceRouteState(
      this.nodes.length,
      this.sections,
      this.random,
    );
    const follow = new NativeFollowLifecycle();
    const objective = new NativeObjectiveLifecycle(
      { newRequired: true },
      this.counts,
      this.random,
    );
    const selector = new NativeRegularDecision({
      objective: "none",
      target: null,
      objectiveStartMs: 0,
      nextOutOfWorldCheckMs: 0,
      grudge: 10,
      knackeredDetected: false,
      pursuingBeforeFreeze: false,
      movedEver: false,
      pursueFromStart: false,
      acknowledgedSighting: false,
    });
    this.registerCar(body);
    this.catalogState[catalogIndex].grudge = 10;
    this.rivals.set(body.group.uuid, {
      body,
      catalogIndex,
      personality: forcedPersonality,
      nastiness: nativeOpponentNastiness(
        this.raceNastiness,
        this.hooks.skill,
        this.catalogState[catalogIndex].strength,
        this.hooks.nastinessMultiplier ?? 1,
      ),
      selector,
      objective,
      follow,
      race,
      complete: new NativeCompleteRaceState(
        this.nodes,
        this.sections,
        race,
        follow,
        this.random,
      ),
      getNear: new NativeGetNearPlayerState(
        this.nodes,
        this.sections,
        race.route,
        follow,
        this.random,
      ),
      runAway: new NativeRunAwayState(
        this.nodes,
        this.sections,
        race.route,
        follow,
        this.random,
      ),
      pursuit: new NativePursuitState(follow),
      visibility: new NativeVisibilityState(),
      trail: new NativeOpponentTrail(),
      levitate: new NativeLevitateState(),
      lastInViewMs: 0,
      visibilityInitialDeadlineMs: 0,
      cheating: false,
      playerDistance: 0,
      movedEver: false,
      initialized: false,
    });
    this.initializeRival(this.rivals.get(body.group.uuid)!);
  }

  get snapshot() {
    return {
      nowMs: this.nowMs,
      firstFrame: this.firstFrame,
      counts: { ...this.counts },
      catalogGrudges: this.catalogState.map((entry) => entry.grudge),
      playerTrail: this.playerTrail.snapshot,
      diagnostics: [...this.diagnostics],
      rivals: [...this.rivals.values()].map((r) => ({
        identity: r.body.group.uuid,
        catalogIndex: r.catalogIndex,
        personality: r.personality,
        nastiness: r.nastiness,
        cheating: r.cheating,
        physical: this.hooks.isPhysicsActive(r.body),
        playerDistance: r.playerDistance,
        lastInViewMs: r.lastInViewMs,
        movedEver: r.movedEver,
        objective: r.objective.snapshot(),
        selector: r.selector.snapshot(),
        follow: r.follow.snapshot,
        pursuit: r.pursuit.snapshot,
        visibility: r.visibility.snapshot,
        trail: r.trail.snapshot,
        repair: r.repair?.snapshot,
        levitate: r.levitate.snapshot,
        contact: {
          ...this.facts.get(r.body.group.uuid)!,
          flags: { ...this.facts.get(r.body.group.uuid)!.flags },
        },
        forces: {
          accForce: r.body.state.accForce ?? 0,
          brakeForce: r.body.state.brakeForce,
          curvature: r.body.state.curvature,
        },
      })),
    };
  }

  update(
    nowMs: number,
    dtMs: number,
    factor: number,
    raceFinished: boolean,
  ): void {
    if (
      ![nowMs, dtMs].every(
        (x) => Number.isInteger(x) && x >= 0 && x <= 0xffffffff,
      ) ||
      !Number.isFinite(Math.fround(factor))
    )
      throw new Error("Invalid native opponent game frame");
    this.nowMs = nowMs;
    this.dtMs = dtMs;
    this.factor = Math.fround(factor);
    if (!this.initialized) {
      this.nextGrudgeReductionMs = (nowMs + 10000) >>> 0;
      this.initialized = true;
    }
    const countdown = this.hooks.countdown?.() ?? 0;
    const unstun = !this.acknowledgedStart && countdown === 0;
    if (unstun) this.acknowledgedStart = true;
    this.recordTrail(this.playerTrail, this.player);
    NativeObjectiveLifecycle.recount(
      this.counts,
      [...this.rivals.values()].map((r) => r.objective.snapshot()),
    );
    for (const rival of this.rivals.values()) {
      this.initializeRival(rival);
      if (rival.objective.snapshot().finishedForRace) continue;
      if (unstun)
        rival.objective.synchronize({
          ...rival.objective.snapshot(),
          stunUntilMs: 0,
        });
      // Installed MungeOpponents starts/records only the player trail. Rival
      // targets retain empty trails; pursuit must take the native GetNear
      // fallback instead of inventing historical paths for other AI cars.
      const proximity = nativeOpponentProximity(
        rival.body.state.position,
        this.player.state.position,
        this.hooks.viewDistance,
        nowMs,
        rival.lastInViewMs,
      );
      rival.playerDistance = proximity.playerDistance;
      rival.lastInViewMs = proximity.lastInViewMs;
      if (nowMs > rival.visibilityInitialDeadlineMs)
        rival.visibility.run(
          {
            nowMs,
            playerDistance: rival.playerDistance,
            playerPosition: this.player.state.position,
            rivalPosition: rival.body.state.position,
          },
          this.hooks.rayFraction,
          this.random,
        );
      rival.objective.process(
        {
          nowMs,
          mass: rival.body.properties.mass,
          countdown,
          raceFinished,
          stopOpponentsMoving: this.hooks.stopOpponentsMoving?.() ?? false,
        },
        {
          changeCheatingMode: () => {
            rival.cheating = nativeOpponentCheating(
              nowMs,
              rival.lastInViewMs,
              this.hooks.mapView?.() ?? 0,
              this.hooks.showOpponents?.() ?? false,
            );
          },
          repair: () =>
            rival.repair!.run(
              {
                nowMs,
                cheating: rival.cheating,
                police: false,
                objective: rival.objective.snapshot().objective,
                knackered: rival.body.knackered,
                lastContactMs: this.facts.get(rival.body.group.uuid)!
                  .contactTimeMs,
              },
              () => this.hooks.repair(rival.body),
            ),
          chooseObjective: (force) => this.choose(rival, force),
          setBrakeForce: (force) => {
            rival.body.state.brakeForce = force;
          },
          run: (objective) => this.run(rival, objective),
          isCheating: () => rival.cheating,
          copyActorOriginToCarPosition: () => this.syncActor(rival.body),
        },
      );
      const facts = this.facts.get(rival.body.group.uuid)!;
      facts.flags.bigBang =
        facts.flags.scaryBang =
        facts.flags.grudgeRecent =
          false;
      facts.lastHitter = facts.lastWeHit = null;
    }
    // Installed4aa138–186 visits selected catalog IDs per active instance.
    // Duplicate instances therefore apply the byte reduction repeatedly.
    if (nowMs > this.nextGrudgeReductionMs) {
      this.nextGrudgeReductionMs = (nowMs + 5000) >>> 0;
      const reduction = (3 - this.hooks.skill) | 0;
      for (const r of this.rivals.values())
        if (!r.objective.snapshot().finishedForRace) {
          const entry = this.catalogState[r.catalogIndex];
          entry.grudge =
            (entry.grudge - Math.min(entry.grudge, reduction)) & 255;
        }
    }
    this.firstFrame = false;
  }

  onCrashAttribution(attacker: SimulatedCar, victim: SimulatedCar) {
    if (
      !this.cars.has(attacker.group.uuid) ||
      !this.cars.has(victim.group.uuid)
    )
      return null;
    return applyNativeCrashReaction(
      this.crashCar(attacker),
      this.crashCar(victim),
      this.nowMs,
      this.bigBangThreshold,
      (car) => {
        const r = this.rivals.get(String(car.identity));
        if (!r) return null;
        return {
          catalogIndex: r.catalogIndex,
          get objective() {
            return r.objective.snapshot().objective;
          },
          get target() {
            return r.objective.snapshot().target;
          },
          get stunUntilMs() {
            return r.objective.snapshot().stunUntilMs;
          },
          set stunUntilMs(value: number) {
            r.objective.synchronize({
              ...r.objective.snapshot(),
              stunUntilMs: value,
            });
          },
          notifyAttributedTargetHit: (at: number) =>
            r.pursuit.notifyTwatted(at),
        };
      },
      (index) => this.catalogState[index] ?? null,
    );
  }

  /** Native exhausted-rematerialization and fallen-world paths share the
   * rival's projected backing; retain its orientation and permanent damage.
   */
  teleportToSafeLocation(body: SimulatedCar) {
    const r = this.rivals.get(body.group.uuid);
    if (!r) throw new Error("Cannot relocate an unregistered opponent");
    const result = nativeTeleportOpponentToNearestSafeLocation(
      this.nodes,
      this.sections,
      r.race.route,
      {
        position: body.state.position,
        cachedDirection: body.crashRecord.cachedDirection,
        playerPosition: this.player.state.position,
        viewDistance: this.hooks.viewDistance,
        nowMs: this.nowMs,
        cheating: r.cheating,
      },
      this.random,
    );
    if (result.resetMotion) {
      this.freewheel(body);
      body.state.velocity.set(0, 0, 0);
      body.state.angularVelocity.set(0, 0, 0);
      body.state.rpm = body.state.gear = 0;
      this.hooks.setPhysicsActive(body, false);
      body.group.visible = false;
      body.state.position.copy(result.position);
      body.poseEpoch = (body.poseEpoch ?? 0) + 1;
      r.lastInViewMs = result.lastInViewMs!;
      r.playerDistance = result.playerDistance!;
      this.syncActor(body);
    }
    if (result.diagnostic) this.report(result.diagnostic);
    return result;
  }

  private initializeRival(r: Rival): void {
    if (r.initialized) return;
    r.repair = new NativeOpponentRepairState(
      this.nowMs,
      this.hooks.repairLimits[0],
      this.hooks.repairLimits[1],
      this.random,
    );
    this.facts.get(r.body.group.uuid)!.contactTimeMs = this.nowMs;
    const delay = Math.floor((Math.floor(this.random() * 32768) * 901) / 32768);
    r.visibilityInitialDeadlineMs = (this.nowMs + 2000 + delay) >>> 0;
    r.selector.synchronize({
      ...r.selector.snapshot(),
      objectiveStartMs: this.nowMs,
      nextOutOfWorldCheckMs: (this.nowMs + 500) >>> 0,
    });
    r.objective.synchronize({
      ...r.objective.snapshot(),
      startMs: this.nowMs,
      stunUntilMs: this.acknowledgedStart ? 0 : (this.nowMs + 0xfffffff) >>> 0,
    });
    r.initialized = true;
  }

  private choose(r: Rival, force: boolean): void {
    const current = r.objective.snapshot(),
      facts = this.facts.get(r.body.group.uuid)!;
    r.selector.synchronize({
      ...r.selector.snapshot(),
      objective: current.objective,
      target: current.target,
      objectiveStartMs: current.startMs,
      grudge: this.catalogState[r.catalogIndex].grudge,
      movedEver: r.movedEver,
      acknowledgedSighting: r.visibility.snapshot.acknowledged,
    });
    const result = r.selector.run(
      {
        nowMs: this.nowMs,
        factor: this.factor,
        nastiness: r.nastiness,
        strength: this.catalogState[r.catalogIndex].strength,
        firstFrame: this.firstFrame,
        mustChoose: force,
        forcedType: r.personality,
        player: this.player.group.uuid,
        playerDistance: r.playerDistance,
        knackered: r.body.knackered,
        stolen: this.hooks.isStolen?.(r.body) ?? false,
        scaryBang: facts.flags.scaryBang,
        bigBang: facts.flags.bigBang,
        grudgeRaisedRecently: facts.flags.grudgeRecent,
        lastHitter: this.decisionCar(facts.lastHitter),
        lastWeHit: this.decisionCar(facts.lastWeHit),
        inView: r.visibility.snapshot.inView,
        headOn: nativeHeadOnChance({
          playerPosition: this.player.state.position,
          rivalPosition: r.body.state.position,
          playerDirection: this.player.crashRecord.cachedDirection,
          rivalDirection: r.body.crashRecord.cachedDirection,
        }),
        pursuingPopulation: this.counts.pursuing,
        skill: this.hooks.skill,
        hasFallenOffWorld: () => this.hooks.hasFallenOffWorld(r.body),
      },
      this.random,
    );
    this.catalogState[r.catalogIndex].grudge = result.state.grudge;
    r.visibility.synchronize({
      inView: r.visibility.snapshot.inView,
      acknowledged: result.state.acknowledgedSighting,
    });
    if (result.transition) {
      if (result.transition.teleportToSafeLocation) {
        this.teleportToSafeLocation(r.body);
        this.hooks.recoverFallen?.(r.body);
      }
      this.transition(
        r,
        result.transition.objective,
        result.transition.target === null
          ? null
          : String(result.transition.target),
      );
    }
  }

  private transition(
    r: Rival,
    objective: NativeDecisionObjective,
    target: string | null = null,
  ): void {
    r.objective.newObjective(this.nowMs, objective, target, {
      die: (old) => {
        if (old === "run-away") r.runAway.die();
        if (old === "pursue") r.pursuit.die();
        if (old === "frozen") r.body.state.brakeForce = 0;
      },
      start: (next) => {
        const q = this.query(r);
        if (next === "complete-race") r.complete.start(q);
        else if (next === "get-near-player")
          this.targetCache = r.getNear.start(
            this.getNearQuery(r),
            this.targetCache,
          ).targetCache;
        else if (next === "run-away")
          r.runAway.start({
            ...q,
            actorDirection: r.body.crashRecord.cachedDirection,
          });
        else if (next === "pursue")
          r.pursuit.start(this.nowMs, 20000 + r.follow.snapshot.sectionSlot);
        else if (next === "frozen") {
          this.hooks.rematerializeNearest(r.body, 0);
          r.body.state.accForce = 0;
          r.body.state.brakeForce = Math.fround(
            15 * Math.fround(r.body.properties.mass),
          );
        } else if (next === "freewheel") this.freewheel(r.body);
        else if (next === "levitate")
          this.applyLevitation(
            r,
            r.levitate.start(this.nowMs, r.body.properties.mass),
          );
      },
    });
  }

  private run(r: Rival, objective: NativeDecisionObjective): void {
    const q = this.query(r);
    let follower;
    if (objective === "complete-race") {
      const result = r.complete.run(
        q,
        {
          newGetNearPlayer: () => this.transition(r, "get-near-player"),
          objectiveComplete: () => r.objective.objectiveComplete(),
        },
        this.hooks.emptyRaceRouteStatus?.(r.body),
      );
      follower = result.follower;
    } else if (objective === "get-near-player") {
      const result = r.getNear.run(this.getNearQuery(r), this.targetCache);
      this.targetCache = result.targetCache;
      follower = result.follower;
      if (result.transition === "pursue")
        this.transition(r, "pursue", this.player.group.uuid);
    } else if (objective === "run-away") {
      follower = r.runAway.run(
        { ...q, actorDirection: r.body.crashRecord.cachedDirection },
        { objectiveComplete: () => r.objective.objectiveComplete() },
      ).follower;
    } else if (objective === "pursue") {
      const target = this.cars.get(String(r.objective.snapshot().target));
      if (!target) throw new Error("Native pursuit target is unavailable");
      const trail =
        target === this.player
          ? this.playerTrail
          : this.rivals.get(target.group.uuid)!.trail;
      const result = r.pursuit.run(
        {
          ...q,
          targetPosition: target.state.position,
          targetVelocity: target.state.velocity,
          targetTrail: trail.snapshot.nodes,
          worldPathNodes: this.nodes,
          worldPathSections: this.sections,
          trailShifted: trail.snapshot.shiftedThisFrame,
          playerDistance: r.playerDistance,
          grudge: this.catalogState[r.catalogIndex].grudge,
          personality: r.personality,
          playerInView: r.visibility.snapshot.inView,
          pathEnded: false,
          followHooksForView: (view) => this.followHooks(r, view),
        },
        this.hooks.rayFraction,
        this.random,
      );
      follower = result.follower;
      if (result.forces) Object.assign(r.body.state, result.forces);
      if (result.kind === "get-near-player")
        this.transition(r, "get-near-player");
      else if (result.kind === "objective-complete")
        r.objective.objectiveComplete();
    } else if (objective === "frozen")
      r.body.state.brakeForce = Math.fround(
        15 * Math.fround(r.body.properties.mass),
      );
    else if (objective === "freewheel") this.freewheel(r.body);
    else if (objective === "levitate")
      this.applyLevitation(
        r,
        r.levitate.run({
          nowMs: this.nowMs,
          dtMs: this.dtMs,
          mass: r.body.properties.mass,
          velocity: r.body.state.velocity,
          angularVelocity: r.body.state.angularVelocity,
          actorY: r.body.state.position.y,
        }),
      );
    if (follower) {
      r.body.state.accForce = follower.accForce;
      r.body.state.brakeForce = follower.brakeForce;
      r.body.state.curvature = follower.curvature;
      r.movedEver ||= follower.movedOnTask;
    }
    r.body.input.throttle =
      (r.body.state.accForce ?? 0) > 0
        ? 1
        : (r.body.state.accForce ?? 0) < 0
          ? -1
          : 0;
    r.body.input.brake = r.body.state.brakeForce > 0 ? 1 : 0;
    r.body.input.steer =
      r.body.motion.maxCurve > 0
        ? r.body.state.curvature / r.body.motion.maxCurve
        : 0;
    r.body.input.handbrake = false;
  }

  private query(r: Rival) {
    return {
      position: r.body.state.position,
      velocity: r.body.state.velocity,
      dtMs: this.dtMs,
      nowMs: this.nowMs,
      maxCurve: r.body.motion.maxCurve,
      mass: r.body.properties.mass,
      factor: this.factor,
      engineDamage: r.body.damage.componentLevels[0],
      transmissionDamage: r.body.damage.componentLevels[1],
      currentCurvature: r.body.state.curvature,
      cheating: r.cheating,
      physical: this.hooks.isPhysicsActive(r.body),
      followHooks: this.followHooks(r),
    };
  }

  private getNearQuery(r: Rival) {
    const life = r.objective.snapshot(),
      state = r.selector.snapshot(),
      visible = r.visibility.snapshot;
    const flags =
      Number(life.newRequired) |
      (Number(life.finishedForRace) << 1) |
      (Number(state.knackeredDetected) << 2) |
      (Number(this.hooks.isPhysicsActive(r.body)) << 3) |
      (Number(state.pursueFromStart) << 4) |
      (Number(r.cheating) << 5) |
      (Number(r.follow.snapshot.cheating) << 6) |
      (Number(state.pursuingBeforeFreeze) << 7) |
      (Number(r.movedEver) << 8) |
      (Number(visible.inView) << 9) |
      (Number(visible.acknowledged) << 10);
    return {
      ...this.query(r),
      actorRow2: new Vector3(0, 0, 1).applyQuaternion(r.body.state.orientation),
      targetPosition: this.player.state.position,
      strength: this.catalogState[r.catalogIndex].strength,
      opponentFlags: flags,
    };
  }

  private followHooks(
    r: Rival,
    view?: NativePathView,
  ): NativeFollowLifecycleHooks {
    return {
      turnPhysicsOff: () => this.hooks.setPhysicsActive(r.body, false),
      clearCarForces: () => {
        r.body.state.accForce = r.body.state.brakeForce = 0;
      },
      applyCheatyPose: (result) => {
        r.body.state.position.copy(result.position);
        if (result.velocity) r.body.state.velocity.copy(result.velocity);
        if (result.lookVector)
          r.body.state.orientation.copy(
            nativeActorLookUp(result.lookVector, result.position).quaternion,
          );
        this.syncActor(r.body);
        this.hooks.onCheatyPose?.(r.body);
      },
      rematerializeOnSection: (slot, speed) =>
        this.hooks.rematerialize(
          r.body,
          view ??
            NativePathView.projected(
              this.nodes,
              this.sections,
              r.race.route.entries,
            ),
          slot,
          speed,
        ),
      rematerializeOnNearestSection: (speed) =>
        this.hooks.rematerializeNearest(r.body, speed),
    };
  }

  private recordTrail(trail: NativeOpponentTrail, body: SimulatedCar): void {
    if (trail.snapshot.recordingCount === 0)
      trail.start(
        body.state.position,
        body.crashRecord.cachedDirection,
        this.nowMs,
      );
    else
      trail.record(
        body.state.position,
        body.crashRecord.cachedDirection,
        this.nowMs,
        (from, to) => this.hooks.rayFraction(from, to.clone().sub(from)) > 1,
      );
  }

  private registerCar(body: SimulatedCar): void {
    this.cars.set(body.group.uuid, body);
    this.facts.set(body.group.uuid, {
      flags: { grudgeRecent: true, bigBang: false, scaryBang: false },
      lastHitter: null,
      lastWeHit: null,
      contactTimeMs: 0,
    });
  }

  private decisionCar(id: string | null) {
    const car = id === null ? undefined : this.cars.get(id);
    return car ? { identity: car.group.uuid, driver: car.human ? 8 : 6 } : null;
  }

  private crashCar(body: SimulatedCar): NativeCrashReactionCar {
    const facts = this.facts.get(body.group.uuid)!;
    return {
      identity: body.group.uuid,
      driver: body.human ? 8 : 6,
      get damageAccumulatorF32() {
        return body.crashRecord.accumulator;
      },
      flags: facts.flags,
      get lastHitter() {
        return facts.lastHitter;
      },
      set lastHitter(value) {
        facts.lastHitter = value === null ? null : String(value);
      },
      get lastWeHit() {
        return facts.lastWeHit;
      },
      set lastWeHit(value) {
        facts.lastWeHit = value === null ? null : String(value);
      },
      get contactTimeMs() {
        return facts.contactTimeMs;
      },
      set contactTimeMs(value) {
        facts.contactTimeMs = value;
      },
      get accForce() {
        return body.state.accForce ?? 0;
      },
      set accForce(value) {
        body.state.accForce = value;
      },
      get brakeForce() {
        return body.state.brakeForce;
      },
      set brakeForce(value) {
        body.state.brakeForce = value;
      },
      get curvature() {
        return body.state.curvature;
      },
      set curvature(value) {
        body.state.curvature = value;
      },
    };
  }

  private freewheel(body: SimulatedCar): void {
    body.state.accForce = body.state.brakeForce = body.state.curvature = 0;
    body.input.throttle = body.input.steer = body.input.brake = 0;
    body.input.handbrake = false;
  }

  private applyLevitation(r: Rival, result: NativeLevitateResult): void {
    const body = r.body;
    body.state.accForce = result.accForce;
    body.state.brakeForce = result.brakeForce;
    if (result.angularVelocity)
      body.state.angularVelocity.copy(result.angularVelocity);
    if (result.stopAndTurnPhysicsOff) {
      this.hooks.setPhysicsActive(body, false);
      body.state.velocity.set(0, 0, 0);
      body.state.angularVelocity.set(0, 0, 0);
      body.state.curvature = 0;
      body.state.rpm = 0;
      body.state.gear = 0;
    }
    if (result.actorY !== undefined) {
      body.state.position.y = result.actorY;
      this.hooks.showLevitating?.(body);
      if (!this.hooks.showLevitating) body.group.visible = true;
      this.syncActor(body);
    }
    if (result.finishedForRace)
      r.objective.synchronize({
        ...r.objective.snapshot(),
        finishedForRace: true,
      });
  }
  private syncActor(body: SimulatedCar): void {
    const forward = new Vector3(0, 0, -1).applyQuaternion(
      body.state.orientation,
    );
    body.state.heading = Math.atan2(-forward.x, -forward.z);
    body.group.position.copy(body.state.position);
    body.group.quaternion.copy(body.state.orientation);
    body.group.updateMatrixWorld(true);
  }
  private report(message: string): void {
    if (!this.diagnostics.has(message)) {
      this.diagnostics.add(message);
      this.hooks.diagnostic?.(message);
    }
  }
}
