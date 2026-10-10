import { isPowerupImplemented, type PowerupDefinition } from "./powerups";

interface DebugActions {
  ready(): boolean;
  running(): boolean;
  definitions(): readonly PowerupDefinition[];
  credits(amount: number): void;
  time(amount: number): void;
  grant(index: number): void;
  repair(): void;
  recover(): void;
  restart(): void;
  focusDriving(): void;
  clearInput(): void;
}

/** Session-only opt-in tools. Turning the mode off removes overrides, while
 * credits and real pickup effects already granted remain ordinary game state. */
export class DebugPanel {
  enabled = false;
  private frozen = true;
  private immune = false;
  private repairs = false;
  private definitions?: readonly PowerupDefinition[];
  private available = false;
  private running = false;
  private readonly panel: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly toggle: HTMLInputElement;
  private readonly menuToggle: HTMLInputElement;
  private readonly select: HTMLSelectElement;
  private readonly controls: HTMLFieldSetElement;

  get timerFrozen(): boolean {
    return this.enabled && this.frozen;
  }
  get invulnerable(): boolean {
    return this.enabled && this.immune;
  }
  get freeRepairs(): boolean {
    return this.enabled && this.repairs;
  }

  constructor(
    app: HTMLElement,
    private readonly actions: DebugActions,
  ) {
    app.insertAdjacentHTML(
      "beforeend",
      `
      <button id="debug-button" aria-controls="debug-panel" aria-expanded="false">DEBUG · OFF</button>
      <section id="debug-panel" aria-label="Debug mode" hidden>
        <div class="debug-header"><strong>DEBUG MODE</strong><button id="debug-close" aria-label="Close debug panel">×</button></div>
        <label class="debug-check"><input id="debug-enabled" type="checkbox"> Enable debug mode</label>
        <fieldset id="debug-controls" disabled>
          <label class="debug-check"><input id="debug-freeze" type="checkbox" checked> Freeze race timer</label>
          <label class="debug-check"><input id="debug-immune" type="checkbox"> Invulnerable</label>
          <label class="debug-check"><input id="debug-repairs" type="checkbox"> Free repairs (E)</label>
          <label>Credits to add<input id="debug-credit-amount" type="number" min="1" max="100000000" step="1" value="10000" required></label>
          <button id="debug-add-credits" type="button">Add credits</button>
          <button id="debug-add-time" type="button">+60 seconds</button>
          <label>Original powerup<select id="debug-powerup"></select></label>
          <button id="debug-grant" type="button">Grant powerup</button>
          <button id="debug-abilities" type="button">Grant weapons / oil charges</button>
          <div class="debug-row"><button id="debug-repair" type="button">Full repair</button><button id="debug-recover" type="button">Free recovery</button></div>
          <button id="debug-restart" type="button">Restart race</button>
        </fieldset>
        <p id="debug-status" role="status">Load a race to use the debug tools.</p>
        <small>Timer freezing only stops the race countdown. Powerups expire normally; F uses weapons/oil, Tab changes the selection. Granted credits and powerups remain when debug mode is turned off. Wasting persists until restart.</small>
      </section>`,
    );
    const get = <T extends HTMLElement>(id: string) =>
      document.getElementById(id) as T;
    this.panel = get("debug-panel");
    this.button = get("debug-button");
    this.toggle = get("debug-enabled");
    this.menuToggle = get("debug-menu-toggle");
    this.select = get("debug-powerup");
    this.controls = get("debug-controls");
    this.button.addEventListener("click", () => {
      if (!this.enabled) this.setEnabled(true);
      else this.show(this.panel.hidden);
    });
    get("debug-close").addEventListener("click", () => this.show(false));
    this.toggle.addEventListener("change", () =>
      this.setEnabled(this.toggle.checked),
    );
    this.menuToggle.addEventListener("change", () =>
      this.setEnabled(this.menuToggle.checked),
    );
    this.panel.addEventListener("focusin", () => actions.clearInput());
    get<HTMLInputElement>("debug-freeze").addEventListener(
      "change",
      (event) => {
        this.frozen = (event.target as HTMLInputElement).checked;
      },
    );
    get<HTMLInputElement>("debug-immune").addEventListener(
      "change",
      (event) => {
        this.immune = (event.target as HTMLInputElement).checked;
      },
    );
    get<HTMLInputElement>("debug-repairs").addEventListener(
      "change",
      (event) => {
        this.repairs = (event.target as HTMLInputElement).checked;
      },
    );
    const action = (
      id: string,
      callback: () => boolean | void,
      requiresRace = false,
    ) =>
      get(id).addEventListener("click", () => {
        if (!this.enabled || !actions.ready()) return;
        if (requiresRace && !actions.running()) return;
        if (callback() === false) return;
        actions.focusDriving();
      });
    action("debug-add-credits", () => {
      const input = get<HTMLInputElement>("debug-credit-amount");
      const amount = input.valueAsNumber;
      // Browser-default validation messages follow the browser locale, so supply
      // our own English message even when the browser is configured in German.
      const valid =
        Number.isSafeInteger(amount) && amount >= 1 && amount <= 100000000;
      input.setCustomValidity(
        valid
          ? ""
          : "Enter a whole number of credits between 1 and 100,000,000.",
      );
      if (!input.reportValidity()) return false;
      actions.credits(amount);
    });
    get<HTMLInputElement>("debug-credit-amount").addEventListener(
      "input",
      (event) => {
        (event.target as HTMLInputElement).setCustomValidity("");
      },
    );
    action("debug-add-time", () => actions.time(60), true);
    action("debug-grant", () => actions.grant(Number(this.select.value)), true);
    action(
      "debug-abilities",
      () => {
        for (const definition of actions.definitions())
          if (definition.action === 34 || definition.action === 35)
            actions.grant(definition.index);
      },
      true,
    );
    action("debug-repair", () => actions.repair());
    action("debug-recover", () => actions.recover());
    action("debug-restart", () => actions.restart());
    this.refresh();
  }

  private show(visible: boolean): void {
    this.panel.hidden = !visible;
    this.button.setAttribute("aria-expanded", String(visible));
    this.actions.clearInput();
    this.actions.focusDriving();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.toggle.checked = this.menuToggle.checked = enabled;
    this.button.textContent = enabled ? "DEBUG · ON" : "DEBUG · OFF";
    this.button.setAttribute("aria-pressed", String(enabled));
    this.refresh();
    this.show(enabled);
  }

  refresh(): void {
    const ready = this.actions.ready();
    const running = this.actions.running();
    if (
      ready !== this.available ||
      running !== this.running ||
      this.controls.disabled !== (!ready || !this.enabled)
    ) {
      this.available = ready;
      this.running = running;
      this.controls.disabled = !ready || !this.enabled;
      document.getElementById("debug-status")!.textContent = !ready
        ? "Load a race to use the debug tools."
        : this.enabled
          ? running
            ? "Active · Timer freezing keeps physics and AI running."
            : "Race finished · Restart to continue driving."
          : "Debug mode is off.";
      for (const id of ["debug-add-time", "debug-grant", "debug-abilities"])
        (document.getElementById(id) as HTMLButtonElement).disabled = !running;
    }
    const definitions = this.actions.definitions();
    if (definitions === this.definitions) return;
    this.definitions = definitions;
    this.select.replaceChildren();
    for (const definition of definitions) {
      const supported = isPowerupImplemented(definition);
      const option = new Option(
        `${definition.index}: ${definition.message} (${definition.action})${supported ? "" : " · not implemented"}`,
        String(definition.index),
      );
      option.disabled = !supported;
      this.select.add(option);
    }
    const first = definitions.find(isPowerupImplemented);
    if (first) this.select.value = String(first.index);
  }
}
