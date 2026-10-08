/** Small Chrome Web Store review prompt. No form, no telemetry. */
import {
  CHROME_WEB_STORE_LISTING,
  dismissFeedback,
  INSTALLED_AT_KEY,
  markFeedbackShown,
  shouldShowFeedback,
  submitFeedbackLocal,
  type UxLocalState,
} from "../shared/ux-local";
import { storageLocalGet } from "../shared/storage-local";

export interface FeedbackCardController {
  maybeShow: (state: UxLocalState) => void;
  destroy: () => void;
}

async function installedAt(): Promise<number | undefined> {
  const bag = await storageLocalGet(INSTALLED_AT_KEY);
  const value = bag[INSTALLED_AT_KEY];
  return typeof value === "number" && value > 0 ? value : undefined;
}

function openStore(): void {
  void chrome.runtime.sendMessage({ type: "CORTEX_OPEN_TAB", url: CHROME_WEB_STORE_LISTING });
}

export function installFeedbackCard(slot: HTMLElement): FeedbackCardController {
  let card: HTMLElement | null = null;
  let dead = false;
  const clear = (): void => {
    card?.remove();
    card = null;
    slot.replaceChildren();
    slot.hidden = true;
  };

  const render = (): void => {
    clear();
    const root = document.createElement("aside");
    root.className = "cortex-review";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Rate Cortex");

    const text = document.createElement("div");
    text.className = "cortex-review-text";
    const title = document.createElement("p");
    title.className = "cortex-review-title";
    title.textContent = "Enjoying Cortex?";
    const body = document.createElement("p");
    body.className = "cortex-review-body";
    body.textContent = "A short review on the Chrome Web Store helps others find it.";
    text.append(title, body);

    const actions = document.createElement("div");
    actions.className = "cortex-review-actions";
    const review = document.createElement("button");
    review.type = "button";
    review.className = "cortex-review-go";
    review.textContent = "Review";
    const later = document.createElement("button");
    later.type = "button";
    later.className = "cortex-review-later";
    later.textContent = "Not now";
    actions.append(review, later);
    root.append(text, actions);

    slot.hidden = false;
    slot.replaceChildren(root);
    card = root;

    review.addEventListener("click", () => {
      openStore();
      void submitFeedbackLocal({ thumb: "up", now: Date.now() }).then(clear);
    });
    later.addEventListener("click", () => {
      void dismissFeedback().then(clear);
    });
  };

  return {
    maybeShow: (state) => {
      if (dead || card) return;
      void installedAt().then((installed) => {
        if (dead || card || !shouldShowFeedback({ state, installedAt: installed })) return;
        void markFeedbackShown().then(() => {
          if (!dead) render();
        });
      });
    },
    destroy: () => {
      dead = true;
      clear();
    },
  };
}
