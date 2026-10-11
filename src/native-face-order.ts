/** Independently reconstructed installed BRender face preparation permutation.
 * Only material pointer comparison participates; equal keys are NOT stable.
 * See docs/c2-prepared-face-order-re.md for captures and unresolved heap order. */

export type NativeFaceMaterialOrder =
  | {
      kind:
        | "native-pointers"
        | "verified-pointer-order"
        | "host-resource-addresses";
      /** One unsigned key per original model face; zero means NULL material.
       * Ordinals require independently verified native pointer ordering. Host
       * resource addresses must come from actual live owned arena allocations;
       * they do not claim a captured Windows heap's finite-prefix ordering. */
      keys: readonly number[];
      evidence: string;
    }
  | { kind: "unresolved"; reason: string };

export interface NativePreparedFaceGroup {
  groupIndex: number;
  materialKey: number;
  /** Half-open span in faceOrder, before collection clipping/capacity limits. */
  faceStart: number;
  faceCount: number;
}

export type NativePreparedFaceOrder =
  | {
      resolved: true;
      keySource:
        | "native-pointers"
        | "verified-pointer-order"
        | "host-resource-addresses";
      evidence: string;
      /** Original model indices, corresponding to prepared group.face_user. */
      faceOrder: readonly number[];
      groups: readonly NativePreparedFaceGroup[];
    }
  | {
      resolved: false;
      reason: string;
      faceOrder: null;
      groups: null;
    };

/** 51f599 → 527a50 → 575aa0 with FacesCompare51fe80.
 * The initial pointer list follows ORIGINAL MODEL face order. No material-name,
 * first-render-occurrence or original-index tie breaker is introduced here.
 * Missing pointer-order evidence is explicit; malformed supplied inputs throw.
 */
export function prepareNativeFaceOrder(
  faceCount: number,
  materialOrder: NativeFaceMaterialOrder,
): NativePreparedFaceOrder {
  if (!Number.isInteger(faceCount) || faceCount < 0 || faceCount > 65535)
    throw new Error("Native face order: uint16 model face count required");
  if (materialOrder.kind === "unresolved") {
    if (
      typeof materialOrder.reason !== "string" ||
      !materialOrder.reason.trim()
    )
      throw new Error("Native face order: unresolved reason required");
    return {
      resolved: false,
      reason: materialOrder.reason,
      faceOrder: null,
      groups: null,
    };
  }
  if (
    materialOrder.kind !== "native-pointers" &&
    materialOrder.kind !== "verified-pointer-order" &&
    materialOrder.kind !== "host-resource-addresses"
  )
    throw new Error(
      "Native face order: explicit pointer-order metadata required",
    );
  if (
    typeof materialOrder.evidence !== "string" ||
    !materialOrder.evidence.trim()
  )
    throw new Error("Native face order: pointer-order evidence required");
  if (materialOrder.keys.length !== faceCount)
    throw new Error(
      "Native face order: one material key per original face required",
    );
  const keys = Array.from(materialOrder.keys);
  if (keys.some((key) => !Number.isInteger(key) || key < 0 || key > 0xffffffff))
    throw new Error(
      "Native face order: unsigned 32-bit material keys required",
    );
  const order = Array.from({ length: faceCount }, (_, index) => index),
    pending: [number, number][] = [[0, faceCount - 1]],
    swap = (a: number, b: number) => {
      const saved = order[a];
      order[a] = order[b];
      order[b] = saved;
    };
  while (pending.length) {
    let [lo, hi] = pending.pop()!;
    while (hi > lo) {
      const count = hi - lo + 1;
      if (count <= 8) {
        // Installed shortsort selects the first STRICTLY greatest element,
        // swapping even equal keys with the final remaining position.
        for (let last = hi; last > lo; last--) {
          let greatest = lo;
          for (let scan = lo + 1; scan <= last; scan++)
            if (keys[order[scan]] > keys[order[greatest]]) greatest = scan;
          swap(greatest, last);
        }
        break;
      }
      swap(lo, lo + Math.floor(count / 2));
      let left = lo,
        right = hi + 1;
      const pivot = keys[order[lo]];
      for (;;) {
        do left++;
        while (left <= hi && keys[order[left]] <= pivot);
        do right--;
        while (right > lo && keys[order[right]] >= pivot);
        if (right < left) break;
        swap(left, right);
      }
      swap(lo, right);
      // Omit the equal-key middle. Push the larger partition; process smaller
      // immediately. Equal partition sizes process the right partition first.
      if (right - lo < hi - left + 1) {
        if (left < hi) pending.push([left, hi]);
        hi = right - 1;
      } else {
        if (lo < right - 1) pending.push([lo, right - 1]);
        lo = left;
      }
    }
  }
  const groups: NativePreparedFaceGroup[] = [];
  for (let start = 0; start < faceCount; ) {
    const materialKey = keys[order[start]];
    let end = start + 1;
    while (end < faceCount && keys[order[end]] === materialKey) end++;
    groups.push({
      groupIndex: groups.length,
      materialKey,
      faceStart: start,
      faceCount: end - start,
    });
    start = end;
  }
  return {
    resolved: true,
    keySource: materialOrder.kind,
    evidence: materialOrder.evidence,
    faceOrder: order,
    groups,
  };
}
