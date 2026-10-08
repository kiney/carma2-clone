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
      <button id="debug-button" aria-controls="debug-panel" aria-expanded="false">DEBUG · AUS</button>
      <section id="debug-panel" aria-label="Debugmodus" hidden>
        <div class="debug-header"><strong>DEBUGMODUS</strong><button id="debug-close" aria-label="Debugfenster schließen">×</button></div>
        <label class="debug-check"><input id="debug-enabled" type="checkbox"> Debugmodus aktiv</label>
        <fieldset id="debug-controls" disabled>
          <label class="debug-check"><input id="debug-freeze" type="checkbox" checked> Renntimer anhalten</label>
          <label class="debug-check"><input id="debug-immune" type="checkbox"> Unverwundbar</label>
          <label class="debug-check"><input id="debug-repairs" type="checkbox"> Kostenlose Reparaturen (E)</label>
          <label>Credits hinzufügen<input id="debug-credit-amount" type="number" min="1" max="100000000" step="1" value="10000" required></label>
          <button id="debug-add-credits" type="button">Credits vergeben</button>
          <button id="debug-add-time" type="button">+60 Sekunden</button>
          <label>Original-Powerup<select id="debug-powerup"></select></label>
          <button id="debug-grant" type="button">Powerup vergeben</button>
          <button id="debug-abilities" type="button">Alle Waffen / Öl laden</button>
          <div class="debug-row"><button id="debug-repair" type="button">Voll reparieren</button><button id="debug-recover" type="button">Gratis bergen</button></div>
          <button id="debug-restart" type="button">Rennen neu starten</button>
        </fieldset>
        <p id="debug-status" role="status">Lade ein Rennen, um die Debugwerkzeuge zu nutzen.</p>
        <small>Timerstopp hält nur die Rennzeit an. Powerups laufen normal ab; F benutzt Waffen/Öl, Tab wechselt die Auswahl. Vergebene Credits und Powerups bleiben beim Ausschalten bestehen. Wasted bleibt bis zum Neustart bestehen.</small>
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
      if (!input.reportValidity()) return false;
      const amount = input.valueAsNumber;
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000)
        return false;
      actions.credits(amount);
    });
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
    this.button.textContent = enabled ? "DEBUG · AN" : "DEBUG · AUS";
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
        ? "Lade ein Rennen, um die Debugwerkzeuge zu nutzen."
        : this.enabled
          ? running
            ? "Aktiv · Timerstopp pausiert weder Physik noch KI."
            : "Rennen beendet · Neustarten, um weiterzufahren."
          : "Debugmodus ist ausgeschaltet.";
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
        `${definition.index}: ${definition.message} (${definition.action})${supported ? "" : " · nicht implementiert"}`,
        String(definition.index),
      );
      option.disabled = !supported;
      this.select.add(option);
    }
    const first = definitions.find(isPowerupImplemented);
    if (first) this.select.value = String(first.index);
  }
}
