/** Shared ordinary intact FORM pools. Evidence: docs/c2-ped-body-pool-re.md.
 * Hosts own real ACTs, authored objects, PHIL headers and animation callbacks.
 * This module neither allocates generic colliders nor implements boned/replay state. */
import type { PedForm, PedVector } from "./ped-form";

export const NATIVE_PED_FORM_LIMIT = 20;
export const NATIVE_PHIL_HEADER_CAPACITY = 100;
export interface NativePedPoolSettings {
  processDistance: number;
  popupDistance: number;
  innerProcessDistance: number;
  innerPopupDistance: number;
}
export interface NativePedPoolCharacter<Owner extends object> {
  owner: Owner;
  /** Exact shared FORM identity, not the personality/template name. */
  formKey: string;
  /** Source ped.pos: native root translation, not a feet/ground anchor. */
  position: PedVector;
  flags: number;
  physicsFlags: number;
  removedBoneMask?: number;
  /** NULL/zero means no cached recent event. */
  cacheEventTimeMs?: number | null;
}
export interface NativePedPoolFrame {
  cameraOrigin: PedVector;
  timeMs: number;
  settings: NativePedPoolSettings;
  /** Source one-frame global override; caller resets it at the outer tail. */
  pedNearness?: boolean;
  replay?: boolean;
}
export interface NativePedPoolAllocation<Owner extends object, Render, Body> {
  character: NativePedPoolCharacter<Owner>;
  formKey: string;
  renderSlot: number;
  simpleSlot: number;
  render: Render;
  body: Body;
  phase: "owned" | "release-pending";
}
export interface NativePedPoolHost<Owner extends object, Render, Body> {
  /** Called once per FORM slot, before characters acquire anything. */
  createRender(formKey: string, slot: number): Render;
  createSimple(formKey: string, slot: number): Body;
  prepareRender(
    character: NativePedPoolCharacter<Owner>,
    render: Render,
    slot: number,
  ): void;
  /** 4085f0 pre-registration: actor/pose, bounds/COM/I, owner, ec/ed and zero V. */
  prepareSimple(allocation: NativePedPoolAllocation<Owner, Render, Body>): void;
  registrar: {
    /** Real shared PHIL 4b6050 immediate wrapper:0 success,1 full,2 duplicate. */
    registerImmediate(body: Body): 0 | 1 | 2;
    /** Native removal0 or absent3. Deferred0 must be reported explicitly. */
    remove(body: Body): { code: 0 | 3; phase: "complete" | "deferred" };
  };
  /** Only after successful PHIL add: properties0/3/4/5/7/8, CBFill type2 filters. */
  finishSimple(allocation: NativePedPoolAllocation<Owner, Render, Body>): void;
  /** Source out-of-scope/halt/removed-part outlets, before removal. Missing actual
   * active/cache/boned providers return their names, retaining ownership. */
  beforeRelease(
    allocation: NativePedPoolAllocation<Owner, Render, Body>,
  ): readonly string[];
  /** Clear contact ring and character owner after PHIL removal completes. */
  clearSimple(allocation: NativePedPoolAllocation<Owner, Render, Body>): void;
  /** Store current root/removed poses and remove ACTs. Body is NULL on init failure. */
  releaseRender(
    character: NativePedPoolCharacter<Owner>,
    render: Render,
    slot: number,
  ): void;
  /** Optional real removed-part acquisition. Its failures never undo intact root
   * acquisition; absent provider is explicitly reported when removed mask exists. */
  acquireRemovedParts?(
    allocation: NativePedPoolAllocation<Owner, Render, Body>,
  ): readonly string[];
}
export interface NativePedPoolVisit<Owner extends object, Render, Body> {
  character: NativePedPoolCharacter<Owner>;
  status:
    | "processed"
    | "out-of-scope"
    | "exhausted"
    | "release-pending"
    | "provider-required";
  allocation: NativePedPoolAllocation<Owner, Render, Body> | null;
  /** Native MakeCharacterCollideworthy0/21/23; NULL when not attempted. */
  collideworthyReturn: 0 | 21 | 23 | null;
  registrationReturn: 0 | 1 | 2 | null;
  requiredProviders: readonly string[];
}
interface Slot<T, Owner extends object> {
  resource: T;
  owner: Owner | null;
}
interface FormPool<Owner extends object, Render, Body> {
  render: Slot<Render, Owner>[];
  simple: Slot<Body, Owner>[];
}
const f = Math.fround;
function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("Native pedestrian pool requires finite native scalars");
  return f(n);
}
function uint(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
    throw new Error("Native pedestrian pool requires uint32 flags/time");
  return n;
}
function vector(v: PedVector): void {
  if (v.length !== 3)
    throw new Error("Native pedestrian pool requires native vector3");
  v.forEach(scalar);
}
function capacity(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 255)
    throw new Error("Invalid source FORM pool capacity");
  return n;
}
export function createNativePedPoolSettings(
  processDistance: number,
  popupDistance: number,
): NativePedPoolSettings {
  const p = scalar(processDistance),
    q = scalar(popupDistance);
  if (p < 0 || q < 0)
    throw new Error("Negative native pedestrian camera extent");
  return {
    processDistance: p,
    popupDistance: q,
    innerProcessDistance: f(p * 0.6),
    innerPopupDistance: f(q * 0.6),
  };
}
function validateFrame(frame: NativePedPoolFrame): void {
  vector(frame.cameraOrigin);
  uint(frame.timeMs);
  const s = frame.settings;
  for (const n of [
    s.processDistance,
    s.popupDistance,
    s.innerProcessDistance,
    s.innerPopupDistance,
  ])
    if (scalar(n) < 0)
      throw new Error("Negative native pedestrian camera extent");
}
/** Installed 4d35e1..4d36ea; outer strict, popup inclusive, uint32 grace7500. */
export function nativePedCameraProcessedFlags<Owner extends object>(
  character: NativePedPoolCharacter<Owner>,
  frame: NativePedPoolFrame,
): number {
  validateFrame(frame);
  vector(character.position);
  uint(character.flags);
  const event = character.cacheEventTimeMs ?? 0;
  uint(event);
  const recent = event !== 0 && (frame.timeMs - event) >>> 0 < 7500;
  const d = character.position.map((n, i) =>
    Math.abs(scalar(n) - scalar(frame.cameraOrigin[i])),
  );
  const s = frame.settings;
  const outside =
    !!(character.flags & 0x80) ||
    d[0] >= s.processDistance ||
    d[1] >= s.innerProcessDistance ||
    d[2] >= s.processDistance;
  const popup =
    !(character.flags & 1) &&
    !frame.pedNearness &&
    f(d[0]) <= s.popupDistance &&
    f(d[1]) <= s.innerPopupDistance &&
    f(d[2]) <= s.popupDistance;
  return (
    ((outside && !recent) || popup
      ? character.flags & ~1
      : character.flags | 1) >>> 0
  );
}

export class NativePedBodyPool<Owner extends object, Render, Body> {
  private readonly forms = new Map<string, FormPool<Owner, Render, Body>>();
  private readonly allocations = new Map<
    Owner,
    NativePedPoolAllocation<Owner, Render, Body>
  >();
  private readonly pendingRemovedPartOwners = new Set<Owner>();
  constructor(private readonly host: NativePedPoolHost<Owner, Render, Body>) {
    for (const name of [
      "createRender",
      "createSimple",
      "prepareRender",
      "prepareSimple",
      "finishSimple",
      "beforeRelease",
      "clearSimple",
      "releaseRender",
    ] as const)
      if (typeof host[name] !== "function")
        throw new Error(`Missing native pedestrian pool provider: ${name}`);
    if (
      typeof host.registrar?.registerImmediate !== "function" ||
      typeof host.registrar?.remove !== "function"
    )
      throw new Error("Missing shared immediate PHIL registrar provider");
  }
  registerForm(
    key: string,
    form: Pick<PedForm, "maxRender" | "maxSimple">,
  ): void {
    if (!key || key.length > 255 || key.includes("\0"))
      throw new Error("Invalid native FORM identity");
    const renderCount = capacity(form.maxRender),
      simpleCount = capacity(form.maxSimple);
    const old = this.forms.get(key);
    if (old) {
      if (
        old.render.length !== renderCount ||
        old.simple.length !== simpleCount
      )
        throw new Error("Conflicting capacities for shared native FORM");
      return;
    }
    if (this.forms.size === NATIVE_PED_FORM_LIMIT)
      throw new Error("Native FORM registry exhausted (20)");
    const render = Array.from({ length: renderCount }, (_, i) => ({
      resource: this.host.createRender(key, i),
      owner: null as Owner | null,
    }));
    const simple = Array.from({ length: simpleCount }, (_, i) => ({
      resource: this.host.createSimple(key, i),
      owner: null as Owner | null,
    }));
    if ([...render, ...simple].some((s) => s.resource == null))
      throw new Error("Native FORM provider returned a missing resource");
    const renderResources = [...this.forms.values()].flatMap((p) =>
      p.render.map((s) => s.resource),
    );
    const simpleResources = [...this.forms.values()].flatMap((p) =>
      p.simple.map((s) => s.resource),
    );
    for (const [oldResources, newResources] of [
      [renderResources, render.map((s) => s.resource)],
      [simpleResources, simple.map((s) => s.resource)],
    ] as const) {
      const resources = new Set<unknown>(oldResources);
      for (const resource of newResources) {
        if (resources.has(resource))
          throw new Error(
            "Native FORM slots require distinct preallocated resources",
          );
        resources.add(resource);
      }
    }
    this.forms.set(key, { render, simple });
  }
  allocation(
    owner: Owner,
  ): NativePedPoolAllocation<Owner, Render, Body> | null {
    return this.allocations.get(owner) ?? null;
  }
  counts(formKey: string): {
    renderCapacity: number;
    simpleCapacity: number;
    renderOwned: number;
    simpleOwned: number;
  } {
    const p = this.form(formKey);
    return {
      renderCapacity: p.render.length,
      simpleCapacity: p.simple.length,
      renderOwned: p.render.filter((s) => s.owner !== null).length,
      simpleOwned: p.simple.filter((s) => s.owner !== null).length,
    };
  }
  /** Caller array is the source pedestrian order; no proximity sort/eviction. */
  visitFrame(
    characters: readonly NativePedPoolCharacter<Owner>[],
    frame: NativePedPoolFrame,
  ): NativePedPoolVisit<Owner, Render, Body>[] {
    validateFrame(frame);
    const seen = new Set<Owner>();
    for (const c of characters) {
      if (
        c.owner === null ||
        (typeof c.owner !== "object" && typeof c.owner !== "function")
      )
        throw new Error(
          "Native pool owner requires stable nonnull object identity",
        );
      if (seen.has(c.owner))
        throw new Error("Duplicate character in native pedestrian array");
      seen.add(c.owner);
      this.form(c.formKey);
      vector(c.position);
      uint(c.flags);
      uint(c.physicsFlags);
      uint(c.cacheEventTimeMs ?? 0);
      uint(c.removedBoneMask ?? 0);
      const a = this.allocation(c.owner);
      if (a && (a.character !== c || a.formKey !== c.formKey))
        throw new Error(
          "Native pool character/FORM identity changed during ownership",
        );
    }
    // Native camera flags are computed for the whole array before Munge visits
    // invoke allocation/release callbacks. Providers may inspect other records.
    if (!frame.replay)
      for (const c of characters)
        c.flags = nativePedCameraProcessedFlags(c, frame);
    return characters.map((c) => this.visit(c, frame));
  }
  /** Host calls only once deferred PHIL removal has actually completed. */
  completeRelease(owner: Owner): void {
    const a = this.allocation(owner);
    if (!a || a.phase !== "release-pending")
      throw new Error("No deferred native body release for owner");
    this.finishRelease(a);
  }
  private form(key: string): FormPool<Owner, Render, Body> {
    const p = this.forms.get(key);
    if (!p) throw new Error(`Native FORM is not registered: ${key}`);
    return p;
  }
  private finishRelease(a: NativePedPoolAllocation<Owner, Render, Body>): void {
    const p = this.form(a.formKey);
    this.host.clearSimple(a);
    p.simple[a.simpleSlot].owner = null;
    a.character.physicsFlags = 0;
    this.host.releaseRender(a.character, a.render, a.renderSlot);
    p.render[a.renderSlot].owner = null;
    this.allocations.delete(a.character.owner);
    this.pendingRemovedPartOwners.delete(a.character.owner);
  }
  private visit(
    c: NativePedPoolCharacter<Owner>,
    frame: NativePedPoolFrame,
  ): NativePedPoolVisit<Owner, Render, Body> {
    let a = this.allocation(c.owner);
    const output = (
      status: NativePedPoolVisit<Owner, Render, Body>["status"],
      collideworthyReturn: 0 | 21 | 23 | null = null,
      registrationReturn: 0 | 1 | 2 | null = null,
      requiredProviders: readonly string[] = [],
    ): NativePedPoolVisit<Owner, Render, Body> => ({
      character: c,
      status,
      allocation: this.allocation(c.owner),
      collideworthyReturn,
      registrationReturn,
      requiredProviders,
    });
    if (frame.replay)
      return output("provider-required", null, null, [
        "native replay pedestrian pool owner",
      ]);
    if (c.physicsFlags & 2)
      return output("provider-required", null, null, [
        "native boned character pool owner",
      ]);
    if (a?.phase === "release-pending") return output("release-pending");
    if (!(c.flags & 1)) {
      if (!a) return output("out-of-scope");
      const missing = this.host.beforeRelease(a);
      if (missing.length)
        return output("provider-required", null, null, missing);
      const removed = this.host.registrar.remove(a.body);
      if (
        (removed.code !== 0 && removed.code !== 3) ||
        (removed.phase !== "complete" && removed.phase !== "deferred") ||
        (removed.code === 3 && removed.phase === "deferred")
      )
        throw new Error("Invalid PHIL removal provider result");
      if (removed.phase === "deferred") {
        a.phase = "release-pending";
        return output("release-pending");
      }
      this.finishRelease(a);
      return output("out-of-scope");
    }
    let register: 0 | 1 | 2 | null = null;
    const existing = !!a;
    if (!a) {
      if (c.physicsFlags !== 0)
        return output("provider-required", null, null, [
          "existing native physics ownership adoption",
        ]);
      const p = this.form(c.formKey),
        ri = p.render.findIndex((s) => s.owner === null);
      if (ri < 0) {
        c.flags = (c.flags & ~1) >>> 0;
        return output("exhausted");
      }
      const render = p.render[ri].resource;
      this.host.prepareRender(c, render, ri);
      p.render[ri].owner = c.owner;
      const si = p.simple.findIndex((s) => s.owner === null);
      if (si < 0) {
        this.host.releaseRender(c, render, ri);
        p.render[ri].owner = null;
        c.flags = (c.flags & ~1) >>> 0;
        return output("exhausted", 21);
      }
      a = {
        character: c,
        formKey: c.formKey,
        renderSlot: ri,
        simpleSlot: si,
        render,
        body: p.simple[si].resource,
        phase: "owned",
      };
      this.host.prepareSimple(a);
      register = this.host.registrar.registerImmediate(a.body);
      if (register !== 0 && register !== 1 && register !== 2)
        throw new Error("Invalid PHIL registration return");
      if (register !== 0) {
        this.host.releaseRender(c, render, ri);
        p.render[ri].owner = null;
        c.flags = (c.flags & ~1) >>> 0;
        return output("exhausted", 21, register);
      }
      this.host.finishSimple(a);
      c.physicsFlags = 1;
      p.simple[si].owner = c.owner;
      this.allocations.set(c.owner, a);
    }
    // 408f46 follows new intact acquisition; native already-owned simple mode
    // returns23 before this outlet. Only an explicitly deferred missing provider
    // is retried. Newly severed in-scope parts belong to the contact/sever host.
    const acquireParts =
      !existing || this.pendingRemovedPartOwners.has(c.owner);
    const missing =
      acquireParts && c.removedBoneMask
        ? (this.host.acquireRemovedParts?.(a) ?? [
            "native removed-part boned pool owner",
          ])
        : [];
    if (missing.length) this.pendingRemovedPartOwners.add(c.owner);
    else this.pendingRemovedPartOwners.delete(c.owner);
    c.flags = (c.flags | (c.flags & 0x20 ? 0x40 : 0x20)) >>> 0;
    return output(
      missing.length ? "provider-required" : "processed",
      existing ? 23 : 0,
      register,
      missing,
    );
  }
}
