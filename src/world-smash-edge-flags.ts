/** Independent HW4f2af5..4f2db6 /4f2f47..4f31ad edge-mask ownership.
 * References are live source MODEL faces, never array offsets into rewritten render triangles. */
export interface NativeSmashEdgeFace {
  flags: number;
}
export interface NativeSmashEdgeState<F extends NativeSmashEdgeFace> {
  faces: [F | null, F | null];
  masks: [number, number];
}
export function createNativeSmashEdgeState<
  F extends NativeSmashEdgeFace,
>(): NativeSmashEdgeState<F> {
  return { faces: [null, null], masks: [0, 0] };
}
/** Native selectors run left,bottom,right,top. The two entries are the source
 * face and its longest-edge partner retained at4f22b9/c0, before tile creation. */
export const NATIVE_SMASH_EDGE_SELECTORS = [
  { face: 1, mask: 4 },
  { face: 0, mask: 1 },
  { face: 0, mask: 2 },
  { face: 1, mask: 2 },
] as const;
export function restoreNativeSmashEdgeMasks<F extends NativeSmashEdgeFace>(
  state: NativeSmashEdgeState<F>,
): boolean {
  let changed = false;
  for (const i of [0, 1] as const) {
    const face = state.faces[i];
    if (face) {
      const next = face.flags | state.masks[i];
      changed ||= next !== face.flags;
      face.flags = next;
    }
  }
  return changed;
}
export function prepareNativeSmashEdge<F extends NativeSmashEdgeFace>(
  state: NativeSmashEdgeState<F>,
  face: F,
  mask: number,
  acceptedEdges: boolean,
  remember: boolean,
): boolean {
  if (acceptedEdges) {
    if (state.faces[0] || state.faces[1])
      return restoreNativeSmashEdgeMasks(state);
    const next = face.flags | mask;
    const changed = face.flags !== next;
    face.flags = next;
    return changed;
  }
  if (!remember) return false;
  // The installed code keeps two pointer slots. Even a matching first slot then
  // visits the ordinary insertion suffix; duplicate references are intentional.
  if (state.faces[0] === face) state.masks[0] |= mask;
  else if (state.faces[1] === face) state.masks[1] |= mask;
  const slot = state.faces[0] ? 1 : 0;
  state.faces[slot] = face;
  state.masks[slot] |= mask;
  return false;
}
