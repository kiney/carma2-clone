import type { PlaytestCapture } from "./runtime";

/** A regular browser download; no MCP, server upload or filesystem permission. */
export function createBugCaptureControls(
  root: HTMLElement,
  capture: PlaytestCapture,
  metadata: () => Record<string, unknown>,
) {
  const document = root.ownerDocument;
  const button = document.createElement("button");
  button.id = "bug-capture-save";
  button.type = "button";
  button.textContent = "Save bug capture";
  button.setAttribute("aria-label", "Save bug capture");
  const feedback = document.createElement("span");
  feedback.id = "bug-capture-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  root.append(button, feedback);
  let busy = false;
  let url: string | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  function release() {
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    clearTimeout(expiry);
  }
  function refresh() {
    const s = capture.status;
    button.title = `${s.enabled ? "Recording" : "Recording stopped"} · ${Math.floor(s.retainedSeconds)} / 180 seconds · ${(s.ring.accountedBytes / 1048576).toFixed(1)} MiB retained · 512 MiB recorder budget. Download diagnostic states and events; not a full gameplay replay.`;
  }
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = "Saving capture…";
    feedback.textContent = "";
    try {
      // Let the button paint, then capture immutable ring payloads at one point.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      release();
      const blob = capture.exportBlob(metadata());
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `carma-bug-${new Date().toISOString().replace(/[:.]/g, "-")}.c2bug`;
      document.body.append(link);
      link.click();
      link.remove();
      feedback.textContent = `Capture downloaded · ${(blob.size / 1048576).toFixed(1)} MiB`;
      expiry = setTimeout(release, 60_000);
    } catch (error) {
      feedback.textContent = `Capture could not be saved: ${String(error).slice(0, 160)}`;
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = "Save bug capture";
      refresh();
    }
  });
  const timer = setInterval(refresh, 1000);
  refresh();
  return {
    refresh,
    dispose() {
      clearInterval(timer);
      release();
      button.remove();
      feedback.remove();
    },
  };
}
