import type { OpponentConfig } from "./config";
import type { Assets } from "./content";
import { objectiveText, isSupportedRace } from "./rules";
import {
  groupRaceChoices,
  selectionRaceTypeLabel,
  type RaceChoice,
  type TrackGroup,
} from "./selection-catalog";
import { SelectionPreviews } from "./selection-previews";
import { DIFFICULTIES, parseDifficultySkill } from "./difficulty";
import type { DifficultySkill } from "./difficulty";

export interface CarChoice {
  path: string;
  name: string;
  source: "data" | "adv_data";
  opponent?: OpponentConfig;
}

const sourceName = (source: string) =>
  source === "adv_data" ? "Advanced" : "Stock";
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Browsing changes selection only; loading still uses the normal race path. */
export class SelectionMenu {
  private readonly groups: TrackGroup[];
  private readonly previews: SelectionPreviews;
  private readonly observer: IntersectionObserver;
  private readonly jobs: Array<{
    image: HTMLImageElement;
    run: () => Promise<void>;
  }> = [];
  private busy = false;
  private loading = false;
  private source: string;
  private activeGroup: string;
  private readonly raceSearch: HTMLInputElement;
  private readonly carSearch: HTMLInputElement;
  private readonly tracks: HTMLElement;
  private readonly missions: HTMLElement;
  private readonly vehicles: HTMLElement;
  private readonly summary: HTMLElement;

  constructor(
    private readonly host: HTMLElement,
    assets: Assets,
    private readonly races: RaceChoice[],
    private readonly cars: CarChoice[],
    private readonly trackSelect: HTMLSelectElement,
    private readonly carSelect: HTMLSelectElement,
    private readonly canPreview: () => boolean,
    onDifficultyChange: (skill: DifficultySkill) => void = () => {},
  ) {
    this.groups = groupRaceChoices(races);
    this.previews = new SelectionPreviews(assets);
    const selected = this.groups.find((g) =>
      g.races.some((r) => r.path === trackSelect.value),
    );
    this.source = selected?.source ?? "data";
    this.activeGroup = selected?.id ?? this.groups[0]?.id ?? "";
    host.innerHTML = `
      <div class="selection-toolbar"><div class="source-tabs" role="group" aria-label="Content library"></div><label class="difficulty-choice">Difficulty<select id="difficulty-select" aria-label="Difficulty"></select></label><p>Choose a location, then its race or mission.</p></div>
      <div class="selection-columns">
        <section class="location-selection" aria-labelledby="location-heading">
          <div class="selection-heading"><h2 id="location-heading">1 · Location</h2><label class="search-label">Find a location or mission<input type="search" id="race-search" placeholder="Search locations & missions"></label></div>
          <div class="location-grid" aria-label="Locations"></div>
          <div class="selection-heading"><h2 id="mission-heading">2 · Race & mission</h2></div>
          <div class="mission-list" aria-labelledby="mission-heading"></div>
        </section>
        <section class="vehicle-selection" aria-labelledby="vehicle-heading">
          <div class="selection-heading"><h2 id="vehicle-heading">3 · Vehicle</h2><label class="search-label">Find a vehicle<input type="search" id="car-search" placeholder="Search vehicles"></label></div>
          <div class="vehicle-grid" aria-label="Vehicles"></div>
        </section>
      </div>
      <p class="selection-summary" aria-live="polite"></p>`;
    this.raceSearch = host.querySelector("#race-search")!;
    this.carSearch = host.querySelector("#car-search")!;
    this.tracks = host.querySelector(".location-grid")!;
    this.missions = host.querySelector(".mission-list")!;
    this.vehicles = host.querySelector(".vehicle-grid")!;
    this.summary = host.querySelector(".selection-summary")!;
    const difficultySelect =
      host.querySelector<HTMLSelectElement>("#difficulty-select")!;
    for (const difficulty of DIFFICULTIES) {
      const option = document.createElement("option");
      option.value = String(difficulty.skill);
      option.textContent = difficulty.label;
      difficultySelect.append(option);
    }
    const savedDifficulty = parseDifficultySkill(
      localStorage.getItem("c2-difficulty"),
    );
    difficultySelect.value = String(savedDifficulty);
    onDifficultyChange(savedDifficulty);
    difficultySelect.addEventListener("change", () => {
      const skill = parseDifficultySkill(difficultySelect.value);
      difficultySelect.value = String(skill);
      localStorage.setItem("c2-difficulty", String(skill));
      onDifficultyChange(skill);
    });
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const picture = entry.target as HTMLImageElement;
          const load = this.pictureJobs.get(picture);
          if (load) {
            this.jobs.push({ image: picture, run: load });
            this.pictureJobs.delete(picture);
          }
          this.observer.unobserve(picture);
        }
        void this.pump();
      },
      { root: document.getElementById("panel"), threshold: 0.01 },
    );
    const tabs = host.querySelector(".source-tabs")!;
    for (const [value, name] of [
      ["data", "Stock"],
      ["adv_data", "Advanced"],
      ["all", "All"],
    ]) {
      if (value !== "all" && !this.groups.some((g) => g.source === value))
        continue;
      const button = element("button", "source-tab", name);
      button.type = "button";
      button.dataset.source = value;
      button.onclick = () => {
        this.source = value;
        this.render();
      };
      tabs.append(button);
    }
    this.raceSearch.oninput = () => this.renderTracks();
    this.carSearch.oninput = () => this.renderCars();
    trackSelect.addEventListener("change", () => this.sync());
    carSelect.addEventListener("change", () => this.sync());
    // Hidden menus do no thumbnail work. A pending job resumes on menu reopen.
    new MutationObserver(() => void this.pump()).observe(
      document.getElementById("panel")!,
      { attributes: true, attributeFilter: ["hidden"] },
    );
    this.render();
    this.revealSelection();
  }

  private readonly pictureJobs = new WeakMap<
    HTMLImageElement,
    () => Promise<void>
  >();

  private picture(
    parent: HTMLElement,
    label: string,
    load: () => Promise<string>,
    car = false,
  ) {
    const frame = element(
      "div",
      `selection-picture${car ? " car-picture" : ""}`,
    );
    const image = element("img", "");
    image.alt = label;
    image.decoding = "async";
    image.width = car ? 64 : 400;
    image.height = car ? 64 : 220;
    const state = element("span", "preview-state", "Loading preview…");
    frame.append(image, state);
    parent.append(frame);
    this.pictureJobs.set(image, async () => {
      if (!image.isConnected) return;
      try {
        image.src = await load();
        await image.decode();
        frame.classList.add("preview-ready");
      } catch {
        state.textContent = "Preview unavailable";
        frame.classList.add("preview-unavailable");
      }
    });
    this.observer.observe(image);
  }

  private async pump() {
    if (this.busy || !this.canPreview() || !this.jobs.length) return;
    this.busy = true;
    try {
      while (this.jobs.length && this.canPreview()) {
        const job = this.jobs.shift()!;
        if (!job.image.isConnected) continue;
        await job.run();
        // Yield between pictures so the menu remains interactive.
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    } finally {
      this.busy = false;
    }
  }

  private matchesSource(source: string) {
    return this.source === "all" || source === this.source;
  }

  private clearPictures(container: HTMLElement) {
    for (const image of container.querySelectorAll("img"))
      this.observer.unobserve(image);
    container.replaceChildren();
  }

  private revealSelection() {
    for (const container of [this.tracks, this.vehicles]) {
      const tile = container.querySelector<HTMLElement>(
        '[aria-pressed="true"]',
      );
      if (!tile) continue;
      const bounds = tile.getBoundingClientRect();
      const viewport = container.getBoundingClientRect();
      if (bounds.top < viewport.top)
        container.scrollTop += bounds.top - viewport.top;
      else if (bounds.bottom > viewport.bottom)
        container.scrollTop += bounds.bottom - viewport.bottom;
    }
  }

  private render() {
    for (const button of this.host.querySelectorAll<HTMLButtonElement>(
      ".source-tab",
    ))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.source === this.source),
      );
    this.renderTracks();
    this.renderCars();
    this.updateSummary();
  }

  private renderTracks() {
    const query = this.raceSearch.value.trim().toLowerCase();
    const groups = this.groups.filter(
      (g) =>
        this.matchesSource(g.source) &&
        `${g.name} ${g.races.map((r) => `${r.name} ${r.definition?.description ?? ""}`).join(" ")}`
          .toLowerCase()
          .includes(query),
    );
    this.clearPictures(this.tracks);
    if (!groups.some((g) => g.id === this.activeGroup))
      this.activeGroup = groups[0]?.id ?? "";
    for (const group of groups) {
      const tile = element("button", "location-tile");
      tile.type = "button";
      tile.dataset.group = group.id;
      tile.setAttribute("aria-pressed", String(group.id === this.activeGroup));
      this.picture(tile, `${group.name} location preview`, () =>
        this.previews.track(group.previewRace.path, group.previewRace.config),
      );
      tile.append(
        element("strong", "tile-name", group.name),
        element(
          "span",
          "tile-meta",
          `${sourceName(group.source)} · ${group.races.length} ${group.races.length === 1 ? "event" : "events"}`,
        ),
      );
      if (
        group.races.every((race) => race.availability?.mode === "unavailable")
      )
        tile.append(element("span", "race-availability", "Unavailable"));
      tile.onclick = () => {
        this.activeGroup = group.id;
        if (!group.races.some((r) => r.path === this.trackSelect.value))
          this.trackSelect.value = (
            group.races.find(
              (race) => race.availability?.mode !== "unavailable",
            ) ?? group.previewRace
          ).path;
        for (const button of this.tracks.querySelectorAll<HTMLButtonElement>(
          "button",
        ))
          button.setAttribute("aria-pressed", String(button === tile));
        this.renderMissions(group);
        this.updateSummary();
      };
      this.tracks.append(tile);
    }
    if (!groups.length)
      this.tracks.append(
        element("p", "selection-empty", "No matching locations or missions."),
      );
    this.renderMissions(groups.find((g) => g.id === this.activeGroup));
  }

  private renderMissions(group?: TrackGroup) {
    this.missions.replaceChildren();
    if (!group) return;
    for (const race of group.races) {
      const button = element("button", "mission-tile");
      button.type = "button";
      button.dataset.race = race.path;
      button.disabled = race.availability?.mode === "unavailable";
      button.setAttribute(
        "aria-pressed",
        String(race.path === this.trackSelect.value),
      );
      const supported = isSupportedRace(race.definition);
      button.append(
        element(
          "span",
          "mission-type",
          supported
            ? `${race.definition?.mission ? "Mission · " : ""}${selectionRaceTypeLabel(race.definition) ?? "Free drive"}`
            : "Free drive · unsupported objective",
        ),
        element("strong", "", race.name),
        element("span", "mission-objective", this.description(race)),
      );
      const laps = race.definition?.laps;
      if (laps) button.append(element("span", "tile-meta", `${laps} laps`));
      if (race.availability && race.availability.mode !== "race") {
        button.append(
          element("span", "race-availability", race.availability.label),
        );
        button.append(
          element(
            "span",
            "availability-reason",
            race.availability.reasons.join(" "),
          ),
        );
      }
      button.onclick = () => {
        this.trackSelect.value = race.path;
        for (const other of this.missions.querySelectorAll<HTMLButtonElement>(
          "button",
        ))
          other.setAttribute("aria-pressed", String(other === button));
        this.updateSummary();
      };
      this.missions.append(button);
    }
  }

  private renderCars() {
    const query = this.carSearch.value.trim().toLowerCase();
    this.clearPictures(this.vehicles);
    const cars = this.cars.filter(
      (c) =>
        this.matchesSource(c.source) &&
        `${c.name} ${c.opponent?.driverName ?? ""} ${c.path.split("/").at(-1)}`
          .toLowerCase()
          .includes(query),
    );
    for (const car of cars) {
      const tile = element("button", "vehicle-tile");
      tile.type = "button";
      tile.dataset.car = car.path;
      tile.setAttribute(
        "aria-pressed",
        String(car.path === this.carSelect.value),
      );
      this.picture(
        tile,
        `${car.name} vehicle preview`,
        () => this.previews.car(car.path),
        true,
      );
      tile.append(element("strong", "tile-name", car.name));
      tile.append(element("span", "tile-meta", sourceName(car.source)));
      if (car.opponent?.driverName)
        tile.title = `${car.name} · ${car.opponent.driverName}`;
      tile.onclick = () => {
        this.carSelect.value = car.path;
        for (const other of this.vehicles.querySelectorAll<HTMLButtonElement>(
          "button",
        ))
          other.setAttribute("aria-pressed", String(other === tile));
        this.updateSummary();
      };
      this.vehicles.append(tile);
    }
    if (!cars.length)
      this.vehicles.append(
        element("p", "selection-empty", "No matching vehicles."),
      );
  }

  private description(race: RaceChoice) {
    if (!race.definition) return "Explore this location in free drive.";
    const description = race.definition?.description;
    if (!description || !race.definition?.mission)
      return isSupportedRace(race.definition)
        ? objectiveText(race.definition).replace(/ · \d+\/\d+$/, "")
        : "Explore this location in free drive.";
    return (
      description
        .split(/@R/i)
        .map((line) => line.trim())
        .filter(
          (line) => !/^(LOCATION|LAPS|CHECKPOINTS|OPPONENTS|INFO):/i.test(line),
        )
        .join(" ")
        .replace(/@L/g, String(race.definition.laps ?? ""))
        .replace(/@O/g, "mission opponents")
        .trim() ||
      selectionRaceTypeLabel(race.definition) ||
      "Explore this location."
    );
  }

  private updateSummary() {
    const race = this.races.find((r) => r.path === this.trackSelect.value);
    const car = this.cars.find((c) => c.path === this.carSelect.value);
    this.summary.textContent = `Selected: ${race?.name ?? "No race"} (${sourceName(race?.source ?? "data")}) · ${car?.name ?? "No vehicle"} (${sourceName(car?.source ?? "data")})`;
    const availability = race?.availability;
    if (availability && availability.mode !== "race")
      this.summary.textContent += ` · ${availability.label}: ${availability.reasons.join(" ")}`;
    const play = document.getElementById("play") as HTMLButtonElement;
    play.disabled =
      this.loading || !race || !car || availability?.mode === "unavailable";
    play.textContent =
      availability?.mode === "free-drive" ? "START FREE DRIVE" : "LOAD RACE";
  }

  sync() {
    const selected = this.groups.find((g) =>
      g.races.some((r) => r.path === this.trackSelect.value),
    );
    if (selected) this.activeGroup = selected.id;
    this.render();
    this.revealSelection();
  }

  resumePreviews() {
    void this.pump();
  }

  setLoading(value: boolean) {
    this.loading = value;
    this.host.inert = value;
    this.updateSummary();
  }
}
