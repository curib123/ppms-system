import { el, button, iconButton } from "./ui.js";

const interactiveSelector =
  "input,select,textarea,button,a,label,summary,[contenteditable]:not([contenteditable='false']),[role='button'],[role='combobox']";

/** Shared document navigation; ordinary field and one-finger input stay native. */
export class DocumentViewport {
  constructor(content, { title = "Form", onExit } = {}) {
    this.scale = 1;
    this.points = new Map();
    this.controller = new AbortController();
    this.onExit = onExit;
    this.root = el("section", {
      class: "document-viewer",
      "aria-label": title,
    });
    this.percent = el(
      "output",
      { "aria-live": "polite", class: "zoom-label" },
      "100%",
    );
    this.viewport = el("div", {
      class: "document-viewport",
      tabIndex: 0,
      role: "region",
    });
    this.spacer = el("div", { class: "document-spacer" });
    this.stage = el("div", { class: "document-stage" }, content);
    this.spacer.append(this.stage);
    this.viewport.append(this.spacer);
    this.toolbarLabel = el(
      "span",
      { class: "document-toolbar-label" },
      "Interactive form",
    );
    this.fullscreenButton = iconButton(
      "Fullscreen form", "expand", () => this.fullscreen(),
      { "aria-pressed": "false" },
    );
    this.toolbar = el(
      "div",
      { class: "document-toolbar" },
      this.toolbarLabel,
      el(
        "div",
        { class: "actions" },
        iconButton("Zoom out", "minus", () => this.zoom(this.scale - 0.1)),
        this.percent,
        iconButton("Zoom in", "plus", () => this.zoom(this.scale + 0.1)),
        button("Fit", () => this.fit(), { small: true }),
        this.fullscreenButton,
      ),
    );
    this.root.append(this.toolbar, this.viewport);
    const options = { signal: this.controller.signal };
    this.viewport.addEventListener(
      "wheel",
      (e) => {
        const explicitZoom = e.ctrlKey || e.metaKey;
        const fullscreenZoom = this.isFullscreen() && !e.shiftKey &&
          e.deltaX === 0 && !e.target.closest(interactiveSelector);
        if (!e.deltaY || (!explicitZoom && !fullscreenZoom)) return;
        e.preventDefault();
        // Normalize line/page wheels as well as pixel-based mice and trackpads.
        const unit = e.deltaMode === 1 ? 16 :
          e.deltaMode === 2 ? this.viewport.clientHeight : 1;
        const delta = Math.max(-160, Math.min(160, e.deltaY * unit));
        this.zoom(this.scale * Math.exp(-delta * 0.0025), e.clientX, e.clientY);
      },
      { ...options, passive: false },
    );
    // A non-passive touch listener cancels only an explicit two-finger gesture
    // before native scrolling takes ownership. One-finger controls stay native.
    this.viewport.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 2) return;
        if (e.cancelable) e.preventDefault();
        const [a, b] = e.touches;
        const anchor = this.documentPoint(
          (a.clientX + b.clientX) / 2,
          (a.clientY + b.clientY) / 2,
        );
        this.touchGesture = {
          distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
          scale: this.scale,
          ...anchor,
        };
      },
      { ...options, passive: false },
    );
    this.viewport.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 2 || !this.touchGesture) return;
        if (e.cancelable) e.preventDefault();
        const [a, b] = e.touches;
        const x = (a.clientX + b.clientX) / 2,
          y = (a.clientY + b.clientY) / 2;
        this.zoom(
          (this.touchGesture.scale *
            Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) /
            this.touchGesture.distance,
          x,
          y,
        );
        this.placeDocumentPoint(this.touchGesture, x, y);
      },
      { ...options, passive: false },
    );
    for (const event of ["touchend", "touchcancel"])
      this.viewport.addEventListener(
        event,
        (e) => {
          if (e.touches.length < 2) this.touchGesture = null;
        },
        options,
      );
    this.viewport.addEventListener(
      "pointerdown",
      (e) => this.pointerDown(e),
      options,
    );
    this.viewport.addEventListener("pointermove", (e) => this.pointerMove(e), {
      ...options,
      passive: false,
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      this.viewport.addEventListener(
        event,
        (e) => {
          this.points.delete(e.pointerId);
          if (this.points.size < 2) this.gesture = null;
          if (this.drag?.pointerId === e.pointerId)
            this.endDrag(e.type === "pointerup");
        },
        options,
      );
    // Pointer capture keeps a pan intact outside the document. Only its release
    // click is suppressed; the next genuine input/button click remains native.
    for (const type of ["click", "auxclick"])
      this.viewport.addEventListener(type, (e) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
      }, { ...options, capture: true });
    // Middle-button navigation must not trigger Linux primary-selection paste,
    // browser autoscroll or link opening. Those defaults can precede auxclick
    // and are not consistently canceled by preventDefault on pointerdown alone.
    for (const type of ["mousedown", "mouseup", "auxclick"])
      this.viewport.addEventListener(type, (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        this.guardMiddlePaste();
      }, { ...options, capture: true });
    for (const type of ["paste", "beforeinput"])
      this.viewport.addEventListener(type, (e) => {
        if (this.drag?.button !== 1 && !this.middlePasteGuard) return;
        if (type === "paste" || e.inputType?.startsWith("insertFromPaste"))
          e.preventDefault();
      }, { ...options, capture: true });
    window.addEventListener("blur", () => {
      this.endDrag();
      this.points.clear();
      this.gesture = this.touchGesture = null;
    }, options);
    this.viewport.addEventListener(
      "focusin",
      (e) => {
        if (e.target.matches("input,select,textarea,button")) {
          this.focused = e.target;
          requestAnimationFrame(() => this.reveal(e.target));
        }
      },
      options,
    );
    this.viewport.addEventListener(
      "keydown",
      (e) => {
        if (e.target !== this.viewport) return;
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          this.zoom(this.scale + 0.1);
        }
        if (e.key === "-") {
          e.preventDefault();
          this.zoom(this.scale - 0.1);
        }
        if (e.key === "0") {
          e.preventDefault();
          this.fit();
        }
      },
      options,
    );
    this.visualResize = () => {
      clearTimeout(this.revealTimer);
      if (this.focused && document.activeElement === this.focused)
        this.revealTimer = setTimeout(() => this.reveal(this.focused), 80);
    };
    window.visualViewport?.addEventListener(
      "resize",
      this.visualResize,
      options,
    );
    window.visualViewport?.addEventListener(
      "scroll",
      this.visualResize,
      options,
    );
    document.addEventListener(
      "fullscreenchange",
      () => this.updateFullscreen(),
      options,
    );
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.defaultPrevented ||
        !this.root.classList.contains("fallback-fullscreen")) return;
      // Let open dialogs, custom choices and native choice pickers consume Escape.
      if ([...document.querySelectorAll("dialog[open]")].some((dialog) => !dialog.contains(this.root)) ||
        e.target.closest("select,[role='combobox'][aria-expanded='true'],input[type='date'],input[type='time'],input[type='datetime-local'],input[type='color']")) return;
      e.preventDefault();
      this.root.classList.remove("fallback-fullscreen");
      this.updateFullscreen();
      this.fullscreenButton.focus({ preventScroll: true });
    }, options);
    document.addEventListener("cancel", (e) => {
      // A viewer can belong to a history/conflict dialog. When its native picker
      // has consumed Escape, the next dialog cancellation exits this view first.
      if (!this.root.classList.contains("fallback-fullscreen") ||
        e.target !== this.root.closest("dialog[open]")) return;
      e.preventDefault();
      this.root.classList.remove("fallback-fullscreen");
      this.updateFullscreen();
      this.fullscreenButton.focus({ preventScroll: true });
    }, { ...options, capture: true });
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(this.stage);
    this.updateFullscreen();
    requestAnimationFrame(() => {
      if (!this.root.isConnected) return;
      this.measure();
      if (this.viewport.clientWidth < 600) {
        const box = this.viewport.getBoundingClientRect();
        this.zoom(1, box.left, box.top);
      } else this.fit(false);
    });
  }
  documentPoint(x, y) {
    const box = this.viewport.getBoundingClientRect();
    return {
      docX: (this.viewport.scrollLeft + x - box.left -
        this.spacer.offsetLeft - this.viewport.clientLeft) / this.scale,
      docY: (this.viewport.scrollTop + y - box.top -
        this.spacer.offsetTop - this.viewport.clientTop) / this.scale,
    };
  }
  placeDocumentPoint(point, x, y) {
    const box = this.viewport.getBoundingClientRect();
    this.viewport.scrollLeft = point.docX * this.scale - (x - box.left) +
      this.spacer.offsetLeft + this.viewport.clientLeft;
    this.viewport.scrollTop = point.docY * this.scale - (y - box.top) +
      this.spacer.offsetTop + this.viewport.clientTop;
  }
  measure() {
    this.spacer.style.width = `${this.stage.offsetWidth * this.scale}px`;
    this.spacer.style.height = `${this.stage.offsetHeight * this.scale}px`;
  }
  zoom(value, x, y) {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0.35, Math.min(2.5, value));
    const box = this.viewport.getBoundingClientRect();
    const anchorX = x === undefined ? box.left + box.width / 2 : x;
    const anchorY = y === undefined ? box.top + Math.min(box.height / 2, 200) : y;
    const point = this.documentPoint(anchorX, anchorY);
    this.scale = next;
    this.stage.style.transform = `scale(${next})`;
    this.measure();
    this.placeDocumentPoint(point, anchorX, anchorY);
    this.percent.value = `${Math.round(next * 100)}%`;
  }
  fit(keepAnchor = true) {
    const next = Math.min(
      1,
      Math.max(0.35, (this.viewport.clientWidth - 32) / this.stage.offsetWidth),
    );
    this.zoom(
      next,
      keepAnchor ? undefined : this.viewport.getBoundingClientRect().left,
      keepAnchor ? undefined : this.viewport.getBoundingClientRect().top,
    );
    if (!keepAnchor) {
      this.viewport.scrollLeft = 0;
      this.viewport.scrollTop = 0;
    }
  }
  pointerDown(e) {
    if (e.pointerType === "touch") {
      if ("ontouchstart" in window) return;
      this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.points.size === 2) {
        const [a, b] = [...this.points.values()];
        this.gesture = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          scale: this.scale,
          ...this.documentPoint((a.x + b.x) / 2, (a.y + b.y) / 2),
        };
      }
      return;
    }
    if (this.drag || e.pointerType !== "mouse") return;
    const paperDrag = e.button === 0 && !e.shiftKey &&
      !e.target.closest(interactiveSelector);
    if (e.button === 1 || paperDrag) {
      clearTimeout(this.clickTimer);
      this.suppressClick = false;
      this.drag = {
        pointerId: e.pointerId,
        button: e.button,
        x: e.clientX,
        y: e.clientY,
        left: this.viewport.scrollLeft,
        top: this.viewport.scrollTop,
        moved: false,
      };
      this.viewport.setPointerCapture(e.pointerId);
      this.viewport.classList.add("dragging");
      e.preventDefault();
    }
  }
  pointerMove(e) {
    if (this.points.has(e.pointerId)) {
      this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.points.size === 2 && this.gesture) {
        e.preventDefault();
        const [a, b] = [...this.points.values()];
        this.zoom(
          (this.gesture.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
            this.gesture.distance,
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
        );
        this.placeDocumentPoint(this.gesture, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    }
    if (this.drag?.pointerId === e.pointerId && e.pointerType === "mouse") {
      const pressed = this.drag.button === 1 ? 4 : 1;
      if (!(e.buttons & pressed)) { this.endDrag(); return; }
      if (!this.drag.moved && Math.hypot(this.drag.x - e.clientX, this.drag.y - e.clientY) < 3) return;
      this.drag.moved = true;
      e.preventDefault();
      this.viewport.scrollLeft = this.drag.left + this.drag.x - e.clientX;
      this.viewport.scrollTop = this.drag.top + this.drag.y - e.clientY;
    }
  }
  endDrag(released = false) {
    const drag = this.drag;
    if (released && drag?.button === 1) this.guardMiddlePaste();
    this.drag = null;
    this.viewport.classList.remove("dragging");
    if (drag && this.viewport.hasPointerCapture(drag.pointerId))
      this.viewport.releasePointerCapture(drag.pointerId);
    if (released && drag?.moved) {
      this.suppressClick = true;
      clearTimeout(this.clickTimer);
      this.clickTimer = setTimeout(() => { this.suppressClick = false; }, 0);
    }
  }
  guardMiddlePaste() {
    this.middlePasteGuard = true;
    clearTimeout(this.middlePasteTimer);
    this.middlePasteTimer = setTimeout(() => { this.middlePasteGuard = false; }, 0);
  }
  reveal(input) {
    if (!input?.isConnected) return;
    const area = this.viewport.getBoundingClientRect(),
      box = input.getBoundingClientRect();
    const visibleBottom =
      Math.min(
        area.bottom,
        window.visualViewport
          ? window.visualViewport.offsetTop + window.visualViewport.height
          : window.innerHeight,
      ) - 28;
    const top = Math.max(area.top + 16, window.visualViewport?.offsetTop || 0);
    if (box.bottom > visibleBottom)
      this.viewport.scrollTop += box.bottom - visibleBottom;
    if (box.top < top) this.viewport.scrollTop -= top - box.top;
    if (box.width > area.width - 32)
      this.viewport.scrollLeft += box.left - area.left - 16;
    else if (box.right > area.right - 16)
      this.viewport.scrollLeft += box.right - area.right + 16;
    else if (box.left < area.left + 16)
      this.viewport.scrollLeft -= area.left + 16 - box.left;
  }
  isFullscreen() {
    return document.fullscreenElement === this.root ||
      this.root.classList.contains("fallback-fullscreen");
  }
  updateFullscreen() {
    const active = this.isFullscreen();
    this.root.classList.toggle("is-fullscreen", document.fullscreenElement === this.root);
    const label = active ? "Exit fullscreen" : "Fullscreen form";
    this.fullscreenButton.setAttribute("aria-label", label);
    this.fullscreenButton.setAttribute("aria-pressed", String(active));
    this.fullscreenButton.title = label;
    const help = "Drag the paper or middle-drag to pan. " +
      (active ? "Scroll to zoom; Escape exits fullscreen." : "Ctrl or Command + scroll to zoom.") +
      " Pinch with two fingers on touch screens. Shift + drag selects text.";
    this.toolbarLabel.title = help;
    this.viewport.setAttribute("aria-label", "Scrollable form. " + help);
    this.measure();
    if (this.fullscreenActive && !active) this.onExit?.();
    this.fullscreenActive = active;
  }
  async fullscreen() {
    if (this.fullscreenChanging) return;
    this.fullscreenChanging = true;
    this.endDrag();
    try {
      if (this.root.classList.contains("fallback-fullscreen")) {
        this.root.classList.remove("fallback-fullscreen");
      } else if (document.fullscreenElement === this.root) {
        try { await document.exitFullscreen(); } catch { /* Browser Escape remains available. */ }
      } else {
        try {
          if (!this.root.requestFullscreen) throw new Error("Fullscreen API unavailable");
          await this.root.requestFullscreen();
        } catch {
          if (this.root.isConnected) this.root.classList.add("fallback-fullscreen");
        }
      }
    } finally {
      this.fullscreenChanging = false;
      this.updateFullscreen();
    }
  }
  destroy() {
    this.endDrag();
    clearTimeout(this.revealTimer);
    clearTimeout(this.clickTimer);
    clearTimeout(this.middlePasteTimer);
    this.controller.abort();
    this.observer.disconnect();
    if (document.fullscreenElement === this.root) document.exitFullscreen().catch(() => {});
    this.root.remove();
  }
}
