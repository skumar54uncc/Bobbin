/**
 * First-run tour. One spotlight at a time, walking the tabs in order.
 * Skip or finishing the last step marks the tour done.
 */
import {
  COACH_COPY,
  COACH_TIP_IDS,
  dismissCoachTip,
  dismissCoachTips,
  loadUxLocalState,
  TOUR_VERSION,
  type CoachTipId,
} from "../shared/ux-local";

export interface CoachMarkTarget {
  id: CoachTipId;
  anchor: HTMLElement;
}

export interface CoachMarksController {
  refresh: (targets: CoachMarkTarget[]) => void;
  destroy: () => void;
}

export interface CoachMarksOptions {
  /** Called when the tour moves to a step, so the panel can open that tab. */
  onVisit?: (id: CoachTipId) => void;
}

export function installCoachMarks(panel: HTMLElement, options: CoachMarksOptions = {}): CoachMarksController {
  let destroyed = false;
  let open = false;
  let targets: CoachMarkTarget[] = [];
  let steps: CoachMarkTarget[] = [];
  let index = 0;
  let layer: HTMLElement | null = null;
  let onResize: (() => void) | null = null;

  const clear = (): void => {
    layer?.remove();
    layer = null;
    open = false;
    if (onResize) {
      window.removeEventListener("resize", onResize);
      onResize = null;
    }
  };

  const place = (): void => {
    if (!layer) return;
    const step = steps[index];
    if (!step?.anchor.isConnected) return;
    const panelBox = panel.getBoundingClientRect();
    const box = step.anchor.getBoundingClientRect();
    const hole = layer.querySelector<HTMLElement>(".cortex-tour-hole");
    const shade = layer.querySelector<HTMLElement>(".cortex-tour-shade");
    const card = layer.querySelector<HTMLElement>(".cortex-tour-card");
    if (!hole || !card || !shade) return;
    const top = Math.max(8, box.top - panelBox.top - 6);
    const left = Math.max(8, box.left - panelBox.left - 6);
    const width = box.width + 12;
    const height = box.height + 12;
    hole.style.top = `${top}px`;
    hole.style.left = `${left}px`;
    hole.style.width = `${width}px`;
    hole.style.height = `${height}px`;
    const right = left + width;
    const bottom = top + height;
    shade.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
    const cardTop = Math.min(panelBox.height - 168, top + box.height + 18);
    const cardLeft = Math.min(Math.max(12, left), Math.max(12, panelBox.width - 340));
    card.style.top = `${Math.max(12, cardTop)}px`;
    card.style.left = `${cardLeft}px`;
  };

  const render = (): void => {
    const step = steps[index];
    if (!step) {
      clear();
      return;
    }
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "cortex-tour";
      layer.setAttribute("role", "dialog");
      layer.setAttribute("aria-modal", "true");
      const shade = document.createElement("div");
      shade.className = "cortex-tour-shade";
      const hole = document.createElement("div");
      hole.className = "cortex-tour-hole";
      hole.setAttribute("aria-hidden", "true");
      const card = document.createElement("div");
      card.className = "cortex-tour-card";
      layer.append(shade, hole, card);
      panel.appendChild(layer);
      onResize = () => place();
      window.addEventListener("resize", onResize);
    }
    const card = layer.querySelector<HTMLElement>(".cortex-tour-card");
    if (!card) return;
    const copy = COACH_COPY[step.id];
    layer.setAttribute("aria-label", copy.title);
    card.replaceChildren();

    const kicker = document.createElement("p");
    kicker.className = "cortex-tour-kicker";
    kicker.textContent = `${index + 1} of ${steps.length}`;

    const title = document.createElement("p");
    title.className = "cortex-tour-title";
    title.textContent = copy.title;

    const body = document.createElement("p");
    body.className = "cortex-tour-body";
    body.textContent = copy.body;

    const actions = document.createElement("div");
    actions.className = "cortex-tour-actions";

    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "cortex-tour-skip";
    skip.textContent = "Skip";
    skip.addEventListener("click", () => {
      void dismissCoachTips(COACH_TIP_IDS).then(() => {
        if (!destroyed) clear();
      });
    });

    const back = document.createElement("button");
    back.type = "button";
    back.className = "cortex-tour-back";
    back.textContent = "Back";
    back.disabled = index === 0;
    back.addEventListener("click", () => {
      if (index === 0) return;
      index -= 1;
      options.onVisit?.(steps[index]!.id);
      render();
    });

    const next = document.createElement("button");
    next.type = "button";
    next.className = "cortex-tour-next";
    const last = index >= steps.length - 1;
    next.textContent = last ? "Done" : "Next";
    next.addEventListener("click", () => {
      const id = steps[index]!.id;
      void dismissCoachTip(id).then(() => {
        if (destroyed) return;
        if (last) {
          clear();
          return;
        }
        index += 1;
        options.onVisit?.(steps[index]!.id);
        render();
      });
    });

    actions.append(skip, back, next);
    card.append(kicker, title, body, actions);
    place();
    next.focus();
  };

  const refresh = (nextTargets: CoachMarkTarget[]): void => {
    if (destroyed) return;
    targets = nextTargets.filter((t) => t.anchor.isConnected);
    if (open) {
      const current = steps[index];
      if (current) {
        const fresh = targets.find((t) => t.id === current.id);
        if (fresh) steps[index] = fresh;
      }
      place();
      return;
    }
    void loadUxLocalState().then((state) => {
      if (destroyed || open) return;
      const fresh = (state.tourSeen ?? 0) >= TOUR_VERSION;
      const pending = targets.filter((t) => !fresh || !state.coachDismissed[t.id]);
      if (!pending.length) return;
      steps = pending;
      index = 0;
      open = true;
      render();
    });
  };

  return {
    refresh,
    destroy: () => {
      destroyed = true;
      clear();
    },
  };
}
