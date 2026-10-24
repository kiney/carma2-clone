import { DAMAGE_SYSTEMS, type DamageSystem } from "./damage-program";
import type { ActivePowerupStatus } from "./powerups";

export type { ActivePowerupStatus } from "./powerups";

export interface VehicleStatusComponent {
  system: DamageSystem;
  shortLabel: string;
  fullLabel: string;
}

const componentNames: Record<DamageSystem, [string, string]> = {
  engine: ["Engine", "Engine"],
  transmission: ["Trans", "Transmission"],
  driver: ["Driver", "Driver"],
  steering: ["Steering", "Steering"],
  lf_brake: ["LF brake", "Left front brake"],
  rf_brake: ["RF brake", "Right front brake"],
  lr_brake: ["LR brake", "Left rear brake"],
  rr_brake: ["RR brake", "Right rear brake"],
  lf_wheel: ["LF wheel", "Left front wheel"],
  rf_wheel: ["RF wheel", "Right front wheel"],
  lr_wheel: ["LR wheel", "Left rear wheel"],
  rr_wheel: ["RR wheel", "Right rear wheel"],
};

export const VEHICLE_STATUS_COMPONENTS: readonly VehicleStatusComponent[] =
  DAMAGE_SYSTEMS.map((system) => {
    const [shortLabel, fullLabel] = componentNames[system];
    return { system, shortLabel, fullLabel };
  });

export function formatDamageLevel(level: number): string {
  const raw = Number.isFinite(level)
    ? Math.max(0, Math.min(99, Math.round(level)))
    : 0;
  return `${raw} / 99`;
}

export function formatPowerupDuration(remainingSeconds: number | null): string {
  if (remainingSeconds === null) return "Race";
  const seconds = Number.isFinite(remainingSeconds)
    ? Math.max(0, Math.ceil(remainingSeconds))
    : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

interface ComponentRow {
  hud: HTMLElement;
  hudProgress: HTMLProgressElement;
  hudValue: HTMLElement;
  menu: HTMLElement;
  menuProgress: HTMLProgressElement;
  menuValue: HTMLElement;
  value: number | null;
}

interface EffectRow {
  hud: HTMLElement;
  hudName: HTMLElement;
  hudDuration: HTMLElement;
  menu: HTMLElement;
  menuName: HTMLElement;
  menuDuration: HTMLElement;
  name: string | null;
  duration: string | null;
  ariaLabel: string | null;
}

function setText(node: HTMLElement, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function progress(label: string): HTMLProgressElement {
  const node = document.createElement("progress");
  node.max = 99;
  node.value = 0;
  node.setAttribute("aria-label", `${label} damage`);
  return node;
}

function componentHudRow(component: VehicleStatusComponent) {
  const row = document.createElement("div");
  row.className = "vehicle-status__component vehicle-status__component--hud";
  row.setAttribute("aria-label", `${component.fullLabel} damage`);
  const label = document.createElement("span");
  label.className = "vehicle-status__label";
  label.textContent = component.shortLabel;
  const bar = progress(component.fullLabel);
  const value = document.createElement("span");
  value.className = "vehicle-status__value";
  row.append(label, bar, value);
  return { row, bar, value };
}

function componentMenuRow(component: VehicleStatusComponent) {
  const row = document.createElement("div");
  row.className = "vehicle-status__component vehicle-status__component--menu";
  row.setAttribute("aria-label", `${component.fullLabel} damage`);
  const label = document.createElement("span");
  label.className = "vehicle-status__label";
  label.textContent = component.fullLabel;
  const bar = progress(component.fullLabel);
  const value = document.createElement("span");
  value.className = "vehicle-status__value";
  row.append(label, bar, value);
  return { row, bar, value };
}

function effectRow(kind: "hud" | "menu") {
  const row = document.createElement("li");
  row.className = `vehicle-status__effect vehicle-status__effect--${kind}`;
  const name = document.createElement("span");
  name.className = "vehicle-status__effect-name";
  const duration = document.createElement("span");
  duration.className = "vehicle-status__effect-duration";
  row.append(name, duration);
  return { row, name, duration };
}

function addEffectLabel(parent: HTMLElement, label: string) {
  const heading = document.createElement("h3");
  heading.className = "vehicle-status__section-title";
  heading.textContent = label;
  parent.append(heading);
}

/**
 * Create a read-only vehicle damage and active powerup view in existing hosts.
 * Damage levels remain raw C2 values from 0 through 99; no health percentage
 * is inferred here. The caller supplies remaining powerup time from game state.
 */
export function createVehicleStatus(
  hudHost: HTMLElement,
  menuHost: HTMLDetailsElement,
): {
  update(
    levels: ArrayLike<number> | undefined,
    effects: readonly ActivePowerupStatus[],
  ): void;
} {
  const hud = document.createElement("section");
  hud.className = "vehicle-status vehicle-status--hud";
  hud.setAttribute("aria-label", "Vehicle component damage");
  hud.hidden = true;
  const hudTitle = document.createElement("h2");
  hudTitle.className = "vehicle-status__title";
  hudTitle.textContent = "DAMAGE · 0–99";
  const hudComponents = document.createElement("div");
  hudComponents.className =
    "vehicle-status__components vehicle-status__components--hud";
  hudComponents.hidden = true;
  hudTitle.hidden = true;
  const hudEffectSection = document.createElement("section");
  hudEffectSection.className =
    "vehicle-status__effects vehicle-status__effects--hud";
  addEffectLabel(hudEffectSection, "Powerups");
  const hudEffectList = document.createElement("ul");
  hudEffectList.className =
    "vehicle-status__effect-list vehicle-status__effect-list--hud";
  const hudMore = document.createElement("p");
  hudMore.className = "vehicle-status__more";
  hudEffectSection.hidden = true;
  hudEffectSection.append(hudEffectList, hudMore);
  hud.append(hudTitle, hudComponents, hudEffectSection);
  hudHost.append(hud);

  const summary = document.createElement("summary");
  summary.textContent = "Vehicle status";
  const menuContent = document.createElement("section");
  menuContent.className = "vehicle-status vehicle-status--menu";
  const unavailable = document.createElement("p");
  unavailable.className = "vehicle-status__unavailable";
  unavailable.textContent = "No vehicle loaded";
  const menuComponents = document.createElement("div");
  menuComponents.className =
    "vehicle-status__components vehicle-status__components--menu";
  menuComponents.hidden = true;
  const menuEffectSection = document.createElement("section");
  menuEffectSection.className =
    "vehicle-status__effects vehicle-status__effects--menu";
  addEffectLabel(menuEffectSection, "Active powerups");
  const menuEmpty = document.createElement("p");
  menuEmpty.className = "vehicle-status__empty";
  menuEmpty.textContent = "No active powerups";
  const menuEffectList = document.createElement("ul");
  menuEffectList.className =
    "vehicle-status__effect-list vehicle-status__effect-list--menu";
  menuEffectList.hidden = true;
  menuEffectSection.append(menuEmpty, menuEffectList);
  menuContent.append(unavailable, menuComponents, menuEffectSection);
  menuHost.append(summary, menuContent);

  const componentRows: ComponentRow[] = VEHICLE_STATUS_COMPONENTS.map(
    (component) => {
      const hudRow = componentHudRow(component);
      const menuRow = componentMenuRow(component);
      hudComponents.append(hudRow.row);
      menuComponents.append(menuRow.row);
      return {
        hud: hudRow.row,
        hudProgress: hudRow.bar,
        hudValue: hudRow.value,
        menu: menuRow.row,
        menuProgress: menuRow.bar,
        menuValue: menuRow.value,
        value: null,
      };
    },
  );
  const effectRows = new Map<number, EffectRow>();
  const createEffect = (index: number): EffectRow => {
    const hudRow = effectRow("hud");
    hudRow.row.dataset.powerupIndex = String(index);
    const menuRow = effectRow("menu");
    menuRow.row.dataset.powerupIndex = String(index);
    return {
      hud: hudRow.row,
      hudName: hudRow.name,
      hudDuration: hudRow.duration,
      menu: menuRow.row,
      menuName: menuRow.name,
      menuDuration: menuRow.duration,
      name: null,
      duration: null,
      ariaLabel: null,
    };
  };

  let loaded = false;
  let hudVisible = false;
  let moreCount = -1;
  let emptyEffects = true;
  let hudEffectsShown = false;
  let hudOrder = "";
  let menuOrder = "";
  return {
    update(levels, effects) {
      let validLevels = !!levels && levels.length === DAMAGE_SYSTEMS.length;
      if (validLevels && levels)
        for (let index = 0; index < DAMAGE_SYSTEMS.length; index++)
          if (!Number.isFinite(levels[index])) {
            validLevels = false;
            break;
          }
      const nowLoaded = validLevels;
      if (loaded !== nowLoaded) {
        hudComponents.hidden = !nowLoaded;
        hudTitle.hidden = !nowLoaded;
        unavailable.hidden = nowLoaded;
        menuComponents.hidden = !nowLoaded;
        loaded = nowLoaded;
      }
      if (validLevels && levels) {
        componentRows.forEach((row, index) => {
          const value = Math.max(0, Math.min(99, Math.round(levels[index])));
          if (row.value === value) return;
          const display = formatDamageLevel(value);
          row.hudProgress.value = value;
          row.menuProgress.value = value;
          setText(row.hudValue, display);
          setText(row.menuValue, `Damage ${display}`);
          row.value = value;
        });
      }

      const uniqueEffects: ActivePowerupStatus[] = [];
      const activeIndexes = new Set<number>();
      for (const effect of effects) {
        if (
          !Number.isSafeInteger(effect.index) ||
          activeIndexes.has(effect.index)
        )
          continue;
        activeIndexes.add(effect.index);
        uniqueEffects.push(effect);
      }
      for (const [index, row] of effectRows) {
        if (activeIndexes.has(index)) continue;
        row.hud.remove();
        row.menu.remove();
        effectRows.delete(index);
      }
      uniqueEffects.forEach((effect) => {
        let row = effectRows.get(effect.index);
        if (!row) {
          row = createEffect(effect.index);
          effectRows.set(effect.index, row);
        }
        const duration = formatPowerupDuration(effect.remainingSeconds);
        if (row.name !== effect.name) {
          setText(row.hudName, effect.name);
          setText(row.menuName, effect.name);
          row.hudName.title = effect.name;
          row.name = effect.name;
        }
        if (row.duration !== duration) {
          setText(row.hudDuration, duration);
          setText(row.menuDuration, duration);
          row.duration = duration;
        }
        const ariaLabel = `${effect.name}, ${duration} remaining`;
        if (row.ariaLabel !== ariaLabel) {
          row.hud.setAttribute("aria-label", ariaLabel);
          row.menu.setAttribute("aria-label", ariaLabel);
          row.ariaLabel = ariaLabel;
        }
      });
      const nextHudOrder = uniqueEffects
        .slice(0, 6)
        .map((effect) => effect.index)
        .join(",");
      if (hudOrder !== nextHudOrder) {
        const visibleHudIndexes = new Set(
          uniqueEffects.slice(0, 6).map((effect) => effect.index),
        );
        for (const [index, row] of effectRows)
          if (!visibleHudIndexes.has(index)) row.hud.remove();
        for (const effect of uniqueEffects.slice(0, 6))
          hudEffectList.append(effectRows.get(effect.index)!.hud);
        hudOrder = nextHudOrder;
      }
      const nextMenuOrder = uniqueEffects
        .map((effect) => effect.index)
        .join(",");
      if (menuOrder !== nextMenuOrder) {
        for (const effect of uniqueEffects)
          menuEffectList.append(effectRows.get(effect.index)!.menu);
        menuOrder = nextMenuOrder;
      }
      const more = Math.max(0, uniqueEffects.length - 6);
      if (moreCount !== more) {
        setText(hudMore, more ? `${more} more in menu` : "");
        moreCount = more;
      }
      const showHudEffects = uniqueEffects.length > 0;
      if (hudEffectsShown !== showHudEffects) {
        hudEffectSection.hidden = !showHudEffects;
        hudEffectsShown = showHudEffects;
      }
      if (emptyEffects !== (uniqueEffects.length === 0)) {
        menuEmpty.hidden = uniqueEffects.length > 0;
        menuEffectList.hidden = uniqueEffects.length === 0;
        emptyEffects = uniqueEffects.length === 0;
      }
      const showHud = nowLoaded || showHudEffects;
      if (hudVisible !== showHud) {
        hud.hidden = !showHud;
        hudVisible = showHud;
      }
    },
  };
}
