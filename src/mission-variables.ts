/** Installed runtime memory0x6b87e0: 1000 signed bytes. Native Get0x4e71b0
 * sign-extends; Add0x4e71d0 wraps; Toggle0x4e71f0 maps zero to1, else0.
 * Invalid native reads are undefined; the browser deliberately returns0. */
export class MissionVariables {
  private readonly values = new Int8Array(1000);
  private valid(address: number): boolean {
    return (
      Number.isSafeInteger(address) &&
      address >= 0 &&
      address < this.values.length
    );
  }
  get(address: number): number {
    return this.valid(address) ? this.values[address] : 0;
  }
  add(address: number, delta: number): void {
    if (!Number.isSafeInteger(delta))
      throw new Error("Invalid mission variable delta");
    if (this.valid(address)) this.values[address] += delta;
  }
  toggle(address: number): void {
    if (this.valid(address))
      this.values[address] = this.values[address] === 0 ? 1 : 0;
  }
  clear(): void {
    this.values.fill(0);
  }
  /** Text pairs are address,delta; original reader stores u16 address/i16
   * delta in the opposite structure order. Check completion after this list. */
  apply(changes: readonly (readonly [number, number])[]): void {
    for (const [address, authoredDelta] of changes) {
      if (
        !Number.isSafeInteger(address) ||
        !Number.isSafeInteger(authoredDelta)
      )
        throw new Error("Invalid mission variable change");
      const nativeAddress = address & 0xffff;
      const delta = (authoredDelta << 16) >> 16;
      if (delta === 9999) this.toggle(nativeAddress);
      else this.add(nativeAddress, delta);
    }
  }
}
