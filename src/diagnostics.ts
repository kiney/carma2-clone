export type DiagnosticScope = "session" | "current race";

export interface DiagnosticProvider {
  source: string;
  scope: DiagnosticScope;
  messages: readonly string[];
}

export interface BackgroundDiagnostic {
  source: string;
  message: string;
  race?: string;
  time?: string;
}

export interface DiagnosticInput {
  track?: string;
  race?: string;
  generatedAt?: string;
  providers: readonly DiagnosticProvider[];
  background?: readonly BackgroundDiagnostic[];
  populations?: {
    opponents?: { state: string; reason?: string };
    pedestrians?: { state: string; reason?: string };
  };
}

export interface DiagnosticItem {
  message: string;
  count: number;
  lastSeenAt?: string;
}

export interface DiagnosticGroup {
  source: string;
  scope: DiagnosticScope;
  items: DiagnosticItem[];
}

export interface DiagnosticReport {
  generatedAt: string;
  track?: string;
  race?: string;
  groups: DiagnosticGroup[];
  total: number;
}

export function collectDiagnosticReport(
  input: DiagnosticInput,
): DiagnosticReport {
  const groups = new Map<string, DiagnosticGroup>();
  const itemsByGroup = new Map<string, Map<string, DiagnosticItem>>();
  const add = (
    source: string,
    scope: DiagnosticScope,
    message: string,
    lastSeenAt?: string,
  ) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    const key = `${scope}\0${source}`;
    let group = groups.get(key);
    if (!group) {
      group = { source, scope, items: [] };
      groups.set(key, group);
      itemsByGroup.set(key, new Map());
    }
    const items = itemsByGroup.get(key)!;
    const item = items.get(cleanMessage);
    if (item) {
      item.count++;
      if (lastSeenAt) item.lastSeenAt = lastSeenAt;
    } else {
      const created = { message: cleanMessage, count: 1, lastSeenAt };
      group.items.push(created);
      items.set(cleanMessage, created);
    }
  };

  for (const provider of input.providers)
    for (const message of provider.messages)
      add(provider.source, provider.scope, message);

  for (const event of input.background ?? []) {
    const context = event.race ? ` (race when recorded: ${event.race})` : "";
    add(
      `${event.source} · session history`,
      "session",
      `${event.message}${context}`,
      event.time,
    );
  }

  for (const [name, population] of Object.entries(input.populations ?? {})) {
    if (!population || population.state === "ready") continue;
    const title =
      name === "opponents" ? "Opponent population" : "Pedestrian population";
    const detail =
      population.state === "failed"
        ? `${title} failed to load${population.reason ? `: ${population.reason}` : "."}`
        : `${title} is still loading.`;
    add("Race population loading", "current race", detail);
  }

  const resultGroups = [...groups.values()];
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    track: input.track,
    race: input.race,
    groups: resultGroups,
    total: resultGroups.reduce(
      (sum, group) =>
        sum + group.items.reduce((itemSum, item) => itemSum + item.count, 0),
      0,
    ),
  };
}

export function serializeDiagnosticReport(report: DiagnosticReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export interface DiagnosticsPanel {
  refresh(): DiagnosticReport;
  readonly report: DiagnosticReport;
}

export function createDiagnosticsPanel(
  root: HTMLElement,
  readInput: () => DiagnosticInput,
): DiagnosticsPanel {
  const document = root.ownerDocument;
  const detailsRoot = root as HTMLDetailsElement;
  root.classList.add("diagnostics-panel");
  root.innerHTML = `
    <summary>Diagnostics <span class="diagnostics-total"></span></summary>
    <p class="diagnostics-scope">Session history can include earlier races. Current-race sources describe the active or most recently loaded race. Background errors keep the most recent 100 records.</p>
    <div class="diagnostics-actions">
      <button type="button" data-diagnostic-refresh>Refresh</button>
      <button type="button" data-diagnostic-download>Download report</button>
    </div>
    <div class="diagnostics-content" aria-live="polite"></div>`;
  const total = root.querySelector<HTMLElement>(".diagnostics-total")!;
  const content = root.querySelector<HTMLElement>(".diagnostics-content")!;
  let report = collectDiagnosticReport(readInput());

  const render = () => {
    total.textContent = report.total
      ? `${report.total} finding${report.total === 1 ? "" : "s"}`
      : "No findings";
    content.replaceChildren();
    const context = document.createElement("p");
    context.className = "diagnostics-context";
    const details = [report.track, report.race].filter(Boolean);
    context.textContent = details.length
      ? `Last report · ${details.join(" · ")} · ${report.generatedAt}`
      : `Last report · ${report.generatedAt}`;
    content.append(context);

    if (!report.groups.length) {
      const empty = document.createElement("p");
      empty.className = "diagnostics-empty";
      empty.textContent = "No diagnostics have been reported.";
      content.append(empty);
      return;
    }
    for (const group of report.groups) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = `${group.source} · ${group.scope}`;
      const list = document.createElement("ul");
      for (const item of group.items) {
        const line = document.createElement("li");
        line.append(document.createTextNode(item.message));
        if (item.count > 1) {
          const count = document.createElement("span");
          count.className = "diagnostics-repeat-count";
          count.textContent = `Repeated ${item.count} times${item.lastSeenAt ? ` · last recorded ${item.lastSeenAt}` : ""}`;
          line.append(count);
        } else if (item.lastSeenAt) {
          const time = document.createElement("span");
          time.className = "diagnostics-repeat-count";
          time.textContent = `Recorded ${item.lastSeenAt}`;
          line.append(time);
        }
        list.append(line);
      }
      section.append(heading, list);
      content.append(section);
    }
  };
  const refresh = () => {
    report = collectDiagnosticReport(readInput());
    render();
    return report;
  };

  root
    .querySelector("[data-diagnostic-refresh]")!
    .addEventListener("click", refresh);
  root.addEventListener("toggle", () => {
    if (detailsRoot.open) refresh();
  });
  root
    .querySelector("[data-diagnostic-download]")!
    .addEventListener("click", () => {
      const current = serializeDiagnosticReport(refresh());
      const blob = new Blob([current], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "carma-diagnostics.json";
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  render();
  return {
    refresh,
    get report() {
      return report;
    },
  };
}
