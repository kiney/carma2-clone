export type DifficultySkill = 0 | 1 | 2;

export const DIFFICULTIES = [
  { skill: 0, label: "Easy" },
  { skill: 1, label: "Medium" },
  { skill: 2, label: "Hard" },
] as const satisfies readonly { skill: DifficultySkill; label: string }[];

/** Invalid or absent persisted selections retain the game's Easy default. */
export function parseDifficultySkill(value: unknown): DifficultySkill {
  const parsed = typeof value === "number" ? value : Number(value);
  return parsed === 1 || parsed === 2 ? parsed : 0;
}
