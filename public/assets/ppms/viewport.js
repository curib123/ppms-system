import { el, button, iconButton } from "./ui.js";

/** Native controls retain one-finger interaction. Only an explicit two-pointer gesture zooms. */
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
      "aria-label":
        "Scrollable form. Use the zoom controls or pinch with two fingers.",
    });
    this.spacer = el("div", { class: "document-spacer" });
    this.stage = el("div", { class: "document-stage" }, content);
    this.spacer.append(this.stage);
    this.viewport.append(this.spacer);
    this.toolbar = el(
      "div",
      { class: "document-toolbar" },
      el("span", { class: "document-toolbar-label" }, "Interactive form"),
      el(
        "div",
        { class: "actions" },
        iconButton("Zoom out", "minus", () => this.zoom(this.scale - 0.1)),
        this.percent,
        iconButton("Zoom in", "plus", () => this.zoom(this.scale + 0.1)),
        button("Fit", () => this.fit(), { small: true }),
        iconButton("Fullscreen form", "expand", () => this.fullscreen()),
      ),
    );
    this.root.append(this.toolbar, this.viewport);
    const options = { signal: this.controller.signal };
    this.viewport.addEventListener(
      "wheel",
      (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.zoom(
            this.scale * Math.exp(-e.deltaY * 0.004),
            e.clientX,
            e.clientY,
          );
        }
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
        const [a, b] = e.touches,
          box = this.viewport.getBoundingClientRect();
        const x = (a.clientX + b.clientX) / 2 - box.left,
          y = (a.clientY + b.clientY) / 2 - box.top;
        this.touchGesture = {
          distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          scale: this.scale,
          docX: (this.viewport.scrollLeft + x) / this.scale,
          docY: (this.viewport.scrollTop + y) / this.scale,
        };
      },
      { ...options, passive: false },
    );
    this.viewport.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 2 || !this.touchGesture) return;
        if (e.cancelable) e.preventDefault();
        const [a, b] = e.touches,
          box = this.viewport.getBoundingClientRect();
        const x = (a.clientX + b.clientX) / 2,
          y = (a.clientY + b.clientY) / 2;
        this.zoom(
          (this.touchGesture.scale *
            Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) /
            this.touchGesture.distance,
          x,
          y,
        );
        this.viewport.scrollLeft =
          this.touchGesture.docX * this.scale - (x - box.left);
        this.viewport.scrollTop =
          this.touchGesture.docY * this.scale - (y - box.top);
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
          this.drag = null;
          this.viewport.classList.remove("dragging");
        },
        options,
      );
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
      if (this.focused && document.activeElement === this.focused)
        setTimeout(() => this.reveal(this.focused), 80);
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
      () => {
        this.root.classList.toggle(
          "is-fullscreen",
          document.fullscreenElement === this.root,
        );
        this.measure();
      },
      options,
    );
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(this.stage);
    requestAnimationFrame(() => {
      this.measure();
      if (this.viewport.clientWidth < 600) {
        const box = this.viewport.getBoundingClientRect();
        this.zoom(1, box.left, box.top);
      } else this.fit(false);
    });
  }
  measure() {
    this.spacer.style.width = `${this.stage.offsetWidth * this.scale}px`;
    this.spacer.style.height = `${this.stage.offsetHeight * this.scale}px`;
  }
  zoom(value, x, y) {
    const next = Math.max(0.35, Math.min(2.5, value));
    const box = this.viewport.getBoundingClientRect();
    const anchorX = x === undefined ? box.width / 2 : x - box.left;
    const anchorY =
      y === undefined ? Math.min(box.height / 2, 200) : y - box.top;
    const docX = (this.viewport.scrollLeft + anchorX) / this.scale;
    const docY = (this.viewport.scrollTop + anchorY) / this.scale;
    this.scale = next;
    this.stage.style.transform = `scale(${next})`;
    this.measure();
    this.viewport.scrollLeft = docX * next - anchorX;
    this.viewport.scrollTop = docY * next - anchorY;
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
  }
  pointerDown(e) {
    if (e.pointerType === "touch") {
      if ("ontouchstart" in window) return;
      this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.points.size === 2) {
        const [a, b] = [...this.points.values()];
        this.gesture = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          scale: this.scale,
        };
      }
      return;
    }
    if (
      e.button === 0 &&
      (e.target === this.viewport ||
        e.target === this.spacer ||
        (e.altKey && !e.target.closest("input,textarea,select,button,a")))
    ) {
      this.drag = {
        x: e.clientX,
        y: e.clientY,
        left: this.viewport.scrollLeft,
        top: this.viewport.scrollTop,
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
      }
    }
    if (this.drag && e.pointerType !== "touch") {
      this.viewport.scrollLeft = this.drag.left + this.drag.x - e.clientX;
      this.viewport.scrollTop = this.drag.top + this.drag.y - e.clientY;
    }
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
  async fullscreen() {
    try {
      if (document.fullscreenElement === this.root)
        await document.exitFullscreen();
      else if (this.root.requestFullscreen) await this.root.requestFullscreen();
      else {
        this.root.classList.toggle("fallback-fullscreen");
        this.measure();
      }
    } catch {
      this.root.classList.toggle("fallback-fullscreen");
      this.measure();
    }
  }
  destroy() {
    this.controller.abort();
    this.observer.disconnect();
    if (document.fullscreenElement === this.root) document.exitFullscreen();
    this.root.remove();
  }
}
