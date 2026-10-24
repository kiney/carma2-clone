export type TerminalRaceStatus = "racing" | "failed" | "completed";

export interface TerminalRaceContext {
  status: TerminalRaceStatus;
  playerWasted: boolean;
  payoutActive: boolean;
}

/** Action text follows the terminal race state, not the transient message timer. */
export function terminalRaceMessage(
  context: TerminalRaceContext,
): string | undefined {
  if (context.status === "failed")
    return context.playerWasted
      ? "YOU ARE WASTED · ENTER TO RESTART"
      : "OUT OF TIME · ENTER TO RESTART";
  if (context.status === "completed")
    return context.payoutActive
      ? "RACE COMPLETED · ENTER TO SKIP"
      : "RACE COMPLETED · ENTER TO RESTART";
  if (context.playerWasted) return "CAR WASTED · RACE ENDING · PLEASE WAIT";
  return undefined;
}

/** Keeps terminal state beneath temporary notifications and pause feedback. */
export class RaceFeedback {
  private transient: { text: string; expiresAt: number } | undefined;

  notify(text: string, nowMs: number, durationSeconds: number): void {
    this.transient = {
      text,
      expiresAt: nowMs + Math.max(0, durationSeconds) * 1000,
    };
  }

  clear(): void {
    this.transient = undefined;
  }

  current(
    nowMs: number,
    paused: boolean,
    terminal: string | undefined,
  ): string {
    if (this.transient && nowMs <= this.transient.expiresAt)
      return this.transient.text;
    this.transient = undefined;
    return terminal ?? (paused ? "PAUSED" : "");
  }
}
