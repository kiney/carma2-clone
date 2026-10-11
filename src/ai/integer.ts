/** Installed575190 truncates with FISTP QWORD; callers consume signed EAX.
 * Invalid signed64 conversions produce integer-indefinite with low DWORD0. */
export function nativeIntegerLow32(value: number): number {
  const result = Math.trunc(value);
  return Number.isFinite(result) && result >= -(2 ** 63) && result < 2 ** 63
    ? result | 0
    : 0;
}
