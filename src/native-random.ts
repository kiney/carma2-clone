/** Installed MSVC CRT srand575f70/rand575f80. This is the shared game stream,
 * not a portable PRNG selected for appearance. Native state671ff0 starts at1. */
export class NativeRandom {
  private value = 1;

  constructor(seed = 1) {
    this.seed(seed);
  }

  readonly seed = (seed: number): void => {
    if (!Number.isSafeInteger(seed)) throw new Error("Invalid native RNG seed");
    this.value = seed >>> 0;
  };

  nextInteger(): number {
    this.value = (Math.imul(this.value, 214013) + 2531011) >>> 0;
    return (this.value >>> 16) & 0x7fff;
  }

  readonly random = (): number => this.nextInteger() / 32768;

  get state(): number {
    return this.value;
  }
}

/** Source CRT state survives ordinary race/car reloads. */
export const sharedNativeRandom = new NativeRandom();
