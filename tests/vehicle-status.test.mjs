import assert from "node:assert/strict";
import test from "node:test";
import { DAMAGE_SYSTEMS } from "../src/damage-program.ts";
import {
  VEHICLE_STATUS_COMPONENTS,
  createVehicleStatus,
  formatDamageLevel,
  formatPowerupDuration,
} from "../src/vehicle-status.ts";

class TestElement {
  children = [];
  attributes = new Map();
  dataset = {};
  hidden = false;
  className = "";
  max = 0;
  value = 0;
  mutationCount = 0;
  parent = null;
  #text = "";

  constructor(tagName) {
    this.tagName = tagName;
  }

  get textContent() {
    return this.#text;
  }

  set textContent(value) {
    if (this.#text === value) return;
    this.#text = value;
    this.children = [];
    this.mutationCount++;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parent) node.remove();
      node.parent = this;
      this.children.push(node);
      this.mutationCount++;
    }
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent.mutationCount++;
    this.parent = null;
  }

  setAttribute(name, value) {
    if (this.attributes.get(name) === value) return;
    this.attributes.set(name, value);
    this.mutationCount++;
  }

  queryAll(className) {
    return [
      ...(this.className.split(/\s+/).includes(className) ? [this] : []),
      ...this.children.flatMap((child) => child.queryAll(className)),
    ];
  }

  textTree() {
    return [this.#text, ...this.children.map((child) => child.textTree())]
      .flat()
      .filter(Boolean)
      .join(" ");
  }

  mutationTotal() {
    return (
      this.mutationCount +
      this.children.reduce((sum, child) => sum + child.mutationTotal(), 0)
    );
  }
}

test("vehicle status maps every native damage system in its source order", () => {
  assert.deepEqual(
    VEHICLE_STATUS_COMPONENTS.map((component) => component.system),
    DAMAGE_SYSTEMS,
  );
  assert.equal(VEHICLE_STATUS_COMPONENTS.length, 12);
  assert.deepEqual(
    VEHICLE_STATUS_COMPONENTS.slice(4).map((component) => component.fullLabel),
    [
      "Left front brake",
      "Right front brake",
      "Left rear brake",
      "Right rear brake",
      "Left front wheel",
      "Right front wheel",
      "Left rear wheel",
      "Right rear wheel",
    ],
  );
});

test("component values remain raw damage units on the native 0–99 scale", () => {
  assert.equal(formatDamageLevel(0), "0 / 99");
  assert.equal(formatDamageLevel(37), "37 / 99");
  assert.equal(formatDamageLevel(99), "99 / 99");
  assert.equal(formatDamageLevel(-12), "0 / 99");
  assert.equal(formatDamageLevel(125), "99 / 99");
});

test("active powerup durations use race lifetime or ceiling M:SS", () => {
  assert.equal(formatPowerupDuration(null), "Race");
  assert.equal(formatPowerupDuration(0), "0:00");
  assert.equal(formatPowerupDuration(1), "0:01");
  assert.equal(formatPowerupDuration(1.01), "0:02");
  assert.equal(formatPowerupDuration(59.2), "1:00");
  assert.equal(formatPowerupDuration(125), "2:05");
});

test("vehicle status keeps stable rows and caps the HUD effect list at six", () => {
  const priorDocument = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new TestElement(tagName),
  };
  try {
    const hudHost = new TestElement("div");
    const menuHost = new TestElement("details");
    const status = createVehicleStatus(hudHost, menuHost);
    const levels = Uint8Array.from({ length: 12 }, (_, index) => index * 8);
    const effects = Array.from({ length: 8 }, (_, offset) => ({
      index: offset + 10,
      name: `Effect ${offset + 10}`,
      remainingSeconds: offset === 0 ? null : 59.1,
    }));

    status.update(levels, effects);
    const hudRows = hudHost.queryAll("vehicle-status__component--hud");
    const menuRows = menuHost.queryAll("vehicle-status__component--menu");
    assert.equal(hudRows.length, 12);
    assert.equal(menuRows.length, 12);
    assert.equal(hudHost.queryAll("vehicle-status__effect--hud").length, 6);
    assert.equal(menuHost.queryAll("vehicle-status__effect--menu").length, 8);
    assert.match(hudHost.textTree(), /2 more in menu/);
    assert.match(menuHost.textTree(), /Race/);
    assert.match(menuHost.textTree(), /1:00/);
    assert.equal(menuRows[4].children[2].textContent, "Damage 32 / 99");
    assert.equal(
      menuRows[4].children[1].attributes.get("aria-label"),
      "Left front brake damage",
    );

    const mutations = hudHost.mutationTotal() + menuHost.mutationTotal();
    status.update(levels, effects);
    assert.equal(
      hudHost.mutationTotal() + menuHost.mutationTotal(),
      mutations,
      "unchanged displayed values should not mutate the DOM",
    );

    const reordered = [
      { index: 5, name: "New effect", remainingSeconds: 20 },
      ...effects.map((effect) =>
        effect.index === 10 ? { ...effect, name: "Renamed effect 10" } : effect,
      ),
    ];
    status.update(levels, reordered);
    const visibleEffects = hudHost.queryAll("vehicle-status__effect--hud");
    assert.deepEqual(
      visibleEffects.map((row) => Number(row.dataset.powerupIndex)),
      [5, 10, 11, 12, 13, 14],
    );
    assert.equal(menuHost.queryAll("vehicle-status__effect--menu").length, 9);
    assert.equal(
      visibleEffects[1].attributes.get("aria-label"),
      "Renamed effect 10, Race remaining",
      "the accessible label must refresh when only the authored name changes",
    );
    assert.equal(visibleEffects[1].children[0].title, "Renamed effect 10");
    assert.match(hudHost.textTree(), /3 more in menu/);

    status.update(undefined, []);
    assert.equal(
      hudHost.queryAll("vehicle-status__component--hud")[0].parent.hidden,
      true,
    );
    assert.match(menuHost.textTree(), /No vehicle loaded/);
    assert.match(menuHost.textTree(), /No active powerups/);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});
