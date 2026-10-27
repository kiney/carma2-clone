import type { Object3D } from "three";

/** AddGroovidelics selects its ACT before reading the animation fields.
 * DRActorFindRecurse compares the complete identifier case-sensitively; parsed
 * ACT child arrays reverse BRender's head-inserted child traversal order. The
 * browser wrapper and direct MODEL meshes are not native ACT candidates. */
export function nativeCarGrooveActors(
  root: Object3D,
  config: string,
): Set<Object3D> {
  if (config.length > 4_000_000)
    throw new Error("Car GROOVE config exceeds size limit");
  const lines = config
    .split(/\r?\n/)
    .map((line) => line.split("//")[0].trim())
    .filter(Boolean);
  const start = lines.indexOf("START OF GROOVE");
  const result = new Set<Object3D>();
  if (start < 0) return result;
  const end = lines.indexOf("END OF GROOVE", start + 1);
  if (end < 0)
    throw new Error("Missing END OF GROOVE for default crush binding");
  const find = (actor: Object3D, name: string): Object3D | undefined => {
    if (typeof actor.userData.c2ActorType === "number" && actor.name === name)
      return actor;
    for (let i = actor.children.length - 1; i >= 0; i--) {
      const found = find(actor.children[i], name);
      if (found) return found;
    }
    return undefined;
  };
  let actorRow = true;
  let count = 0;
  for (const line of lines.slice(start + 1, end)) {
    if (line === "NEXT GROOVE") {
      actorRow = true;
      continue;
    }
    if (!actorRow) continue;
    actorRow = false;
    if (++count > 512) throw new Error("Too many car GROOVE entries");
    const name = line.split(/[\t ,/]+/)[0];
    const actor = find(root, name);
    if (actor) result.add(actor);
  }
  return result;
}
