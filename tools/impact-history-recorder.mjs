/** Opt-in diagnostic for an existing playtest. No geometry/query wrappers,
 * simulation steps or GPU reads. Scalar records survive pauses and race loads.
 * Callback admission and final solver acceptance are recorded separately. */
export function installImpactHistoryRecorder(capacity = 128) {
  if (!Number.isInteger(capacity) || capacity < 8 || capacity > 512)
    throw new Error("Impact history capacity must be from 8 to 512");
  window.__carmaImpactRecorder?.stop();
  const contacts = [],
    changes = [];
  let owner,
    restore = () => {},
    generation = 0,
    stopped = false;
  const push = (ring, entry) => {
    ring.push(entry);
    if (ring.length > capacity) ring.shift();
  };
  const vector = (v) => v?.toArray?.() ?? null;
  const name = (b) => b?.group?.name ?? b?.actor?.name ?? "world";
  function attach() {
    const sim = window.carma?.simulation;
    if (stopped || sim === owner) return;
    restore();
    owner = sim;
    if (!sim) return;
    generation++;
    const original = sim.processImpactDamage,
      step = sim.step;
    if (typeof original !== "function" || typeof step !== "function") return;
    let pending = [];
    function measured(rows, ...args) {
      const player = window.carma?.player;
      if (!player?.damage) return original.call(this, rows, ...args);
      const before = Array.from(player.damage.componentLevels);
      const wasWasted = player.knackered;
      const relevant = rows.filter((r) => r.a === player || r.b === player);
      const hadPositiveImpulse = relevant.some((r) => r.normalImpulse > 0);
      const details = relevant.slice(0, 32).map((r) => ({
        a: name(r.a),
        b: name(r.b),
        surface: r.sourceSurface?.actor?.name ?? null,
        face: r.sourceSurface?.faceIndex ?? null,
        lambda: r.normalImpulse,
        closing: r.closingSpeed,
        point: vector(r.point),
        normal: vector(r.normal),
        sourceTypeBefore: r.sourceType ?? null,
        sourceTypeAfter: null,
        solverAccepted: null,
      }));
      const position = vector(player.state.position);
      const velocity = vector(player.state.velocity);
      const result = original.call(this, rows, ...args);
      const after = Array.from(player.damage.componentLevels);
      const changed =
        before.some((v, i) => v !== after[i]) || wasWasted !== player.knackered;
      if (changed || hadPositiveImpulse) {
        const entry = {
          generation,
          timeMs: performance.now(),
          physicsSeconds: sim.elapsed,
          player: name(player),
          position,
          velocity,
          before,
          after,
          wasWasted,
          wasted: player.knackered,
          callbackRejected: result === false,
          rows: details,
          omittedRows: Math.max(0, relevant.length - details.length),
        };
        push(contacts, entry);
        if (changed) push(changes, entry);
        // The solver sets solverAccepted only AFTER its beforeApply callback.
        // Keep row references only until this step returns, then discard them.
        pending.push({ entry, rows: relevant.slice(0, 32) });
        if (pending.length > capacity * 2) {
          // Retain the union: an older damage record may survive in changes
          // after ordinary floor contacts have displaced it from contacts.
          const retained = new Set([...contacts, ...changes]);
          pending = pending.filter((item) => retained.has(item.entry));
        }
      }
      return result;
    }
    function measuredStep(...args) {
      try {
        return step.apply(this, args);
      } finally {
        for (const { entry, rows } of pending)
          rows.forEach((row, i) => {
            entry.rows[i].sourceTypeAfter = row.sourceType ?? null;
            entry.rows[i].solverAccepted = row.solverAccepted === true;
          });
        pending.length = 0;
      }
    }
    const hadProcess = Object.hasOwn(sim, "processImpactDamage");
    const hadStep = Object.hasOwn(sim, "step");
    sim.processImpactDamage = measured;
    sim.step = measuredStep;
    restore = () => {
      if (sim.processImpactDamage === measured) {
        if (hadProcess) sim.processImpactDamage = original;
        else delete sim.processImpactDamage;
      }
      if (sim.step === measuredStep) {
        if (hadStep) sim.step = step;
        else delete sim.step;
      }
      pending.length = 0;
    };
  }
  attach();
  const timer = setInterval(attach, 250);
  const recorder = {
    version: 1,
    snapshot() {
      return structuredClone({
        generation,
        stopped,
        paused: window.carma?.paused,
        contacts,
        changes,
        note: "Diagnostic only; callback rejection is separate from final solver acceptance. Records retain scalar data only, never body or geometry owners.",
      });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      restore();
    },
  };
  window.__carmaImpactRecorder = recorder;
  return { version: 1, generation, capacity };
}
