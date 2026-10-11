import { Vector3 } from "three";

export const CAR_CRUSH_QUEUE_CAR_CAPACITY = 8;
export const CAR_CRUSH_QUEUE_EVENT_CAPACITY = 4;
export const CAR_CRUSH_QUEUE_CONTACT_CAPACITY = 4;
export const CAR_CRUSH_QUEUE_MAX_FORCE = 10;
export const CAR_CRUSH_QUEUE_CONTACT_EPSILON = 0.005;

/** A detached native event snapshot. Context remains the caller-owned reference. */
export interface NativeCarCrushEvent<TContext = unknown> {
  contacts: Vector3[];
  meanContact: Vector3;
  force: number;
  direction: Vector3;
  context: TContext;
}

export interface NativeCarCrushRecord<TIdentity extends object, TContext> {
  identity: TIdentity;
  event: NativeCarCrushEvent<TContext>;
}

interface CarBucket<TIdentity extends object, TContext> {
  identity: TIdentity;
  events: NativeCarCrushEvent<TContext>[];
}

const copyVector = (value: Vector3, label: string): Vector3 => {
  if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error(`Invalid car crush ${label}`);
  const rounded = new Vector3(
    Math.fround(value.x),
    Math.fround(value.y),
    Math.fround(value.z),
  );
  if (!rounded.toArray().every(Number.isFinite))
    throw new Error(`Invalid car crush ${label}: outside Float32 range`);
  return rounded;
};

const cloneEvent = <TContext>(event: NativeCarCrushEvent<TContext>) => ({
  contacts: event.contacts.map((contact) => contact.clone()),
  meanContact: event.meanContact.clone(),
  force: event.force,
  direction: event.direction.clone(),
  context: event.context,
});

/** QueueCarCrush 0x42d350: eight car identity buckets and four events per car. */
export class NativeCarCrushQueue<
  TIdentity extends object = object,
  TContext = unknown,
> {
  private readonly buckets: CarBucket<TIdentity, TContext>[] = [];

  get count(): number {
    return this.buckets.reduce((sum, bucket) => sum + bucket.events.length, 0);
  }

  enqueue(
    identity: TIdentity,
    localContacts: readonly Vector3[],
    crushVector: Vector3,
    carSoftness: number,
    context: TContext,
    minimumForce = 0.06,
  ): boolean {
    if (!identity || typeof identity !== "object")
      throw new Error("Car crush identity must be an object");
    if (!Array.isArray(localContacts) || localContacts.length > 1_000_000)
      throw new Error("Invalid car crush contact list");
    if (!Number.isFinite(carSoftness) || carSoftness < 0)
      throw new Error("Invalid car crush softness");
    if (!Number.isFinite(minimumForce) || minimumForce < 0)
      throw new Error("Invalid car crush minimum force");
    const vector = copyVector(crushVector, "vector");
    // Installed x87 evaluation order42d3a1–3bf, with no intermediate F32
    // stores. JS doubles cannot reproduce every 80-bit register boundary.
    const magnitude = Math.sqrt(
      vector.y * vector.y + vector.z * vector.z + vector.x * vector.x,
    );
    const rawForce = magnitude * Math.fround(carSoftness);
    if (!Number.isFinite(rawForce)) throw new Error("Invalid car crush force");
    // FST42d3c5 retains register precision for the following FCOMP.
    if (rawForce <= Math.fround(minimumForce)) return false;
    const force = Math.fround(rawForce);

    if (!(magnitude > 0)) return false;
    const reciprocal = 1 / magnitude;
    const direction = new Vector3(
      Math.fround(vector.x * reciprocal),
      Math.fround(vector.y * reciprocal),
      Math.fround(vector.z * reciprocal),
    );
    const contacts = localContacts
      .slice(0, CAR_CRUSH_QUEUE_CONTACT_CAPACITY)
      .map((contact) => copyVector(contact, "contact"));
    const unique: Vector3[] = [];
    for (const contact of contacts) {
      if (
        !unique.some(
          (existing) =>
            Math.abs(contact.x - existing.x) <
              CAR_CRUSH_QUEUE_CONTACT_EPSILON &&
            Math.abs(contact.y - existing.y) <
              CAR_CRUSH_QUEUE_CONTACT_EPSILON &&
            Math.abs(contact.z - existing.z) < CAR_CRUSH_QUEUE_CONTACT_EPSILON,
        )
      )
        unique.push(contact);
    }
    if (!unique.length) return false;
    const meanContact = unique[0].clone();
    for (const contact of unique.slice(1))
      meanContact.set(
        Math.fround(meanContact.x + contact.x),
        Math.fround(meanContact.y + contact.y),
        Math.fround(meanContact.z + contact.z),
      );
    meanContact.set(
      Math.fround(meanContact.x / unique.length),
      Math.fround(meanContact.y / unique.length),
      Math.fround(meanContact.z / unique.length),
    );

    let bucket = this.buckets.find(
      (candidate) => candidate.identity === identity,
    );
    if (!bucket) {
      if (this.buckets.length >= CAR_CRUSH_QUEUE_CAR_CAPACITY) return false;
      bucket = { identity, events: [] };
      this.buckets.push(bucket);
    }
    const event: NativeCarCrushEvent<TContext> = {
      contacts: unique,
      meanContact,
      force: Math.min(force, CAR_CRUSH_QUEUE_MAX_FORCE),
      direction,
      context,
    };
    if (bucket.events.length < CAR_CRUSH_QUEUE_EVENT_CAPACITY) {
      bucket.events.push(event);
      return true;
    }
    let weakest = 0;
    for (let i = 1; i < bucket.events.length; i++)
      if (bucket.events[i].force < bucket.events[weakest].force) weakest = i;
    if (event.force <= bucket.events[weakest].force) return false;
    bucket.events[weakest] = event;
    return true;
  }

  /** Return deep copies of native values in car-bucket and slot insertion order. */
  drain(): NativeCarCrushRecord<TIdentity, TContext>[] {
    const records = this.buckets.flatMap((bucket) =>
      bucket.events.map((event) => ({
        identity: bucket.identity,
        event: cloneEvent(event),
      })),
    );
    this.buckets.length = 0;
    return records;
  }

  initialize(): void {
    this.buckets.length = 0;
  }

  snapshot(): NativeCarCrushRecord<TIdentity, TContext>[] {
    return this.buckets.flatMap((bucket) =>
      bucket.events.map((event) => ({
        identity: bucket.identity,
        event: cloneEvent(event),
      })),
    );
  }
}
