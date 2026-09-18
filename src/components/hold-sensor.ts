import type { Activators, SensorInstance, SensorProps } from "@dnd-kit/core";
import {
  distanceBetween,
  HOLD_DISTANCE_PX,
  HOLD_MS,
  HOLD_TOLERANCE_PX,
  skipsDrag,
} from "@/lib/hold-drag";

// The board's sensor (components/sortable.tsx): hold to drag (lib/hold-drag.ts).
// dnd-kit's own pointer sensor takes a hold or a distance, never both, so
// this one is written out: the pointer holds still for HOLD_MS and the card
// lifts, or a mouse moves HOLD_DISTANCE_PX and it lifts at once; a press
// that ends first is a click, and a finger that drifts first is a scroll.
// A press on an input, a text field, or a control marked data-no-drag never
// starts a drag.

type Point = { x: number; y: number };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type HoldSensorOptions = {};

function pointOf(event: Event): Point | null {
  if (event instanceof PointerEvent || event instanceof MouseEvent) {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

export class HoldSensor implements SensorInstance {
  static activators: Activators<HoldSensorOptions> = [
    {
      eventName: "onPointerDown",
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (!event.isPrimary || event.button !== 0) return false;
        if (skipsDrag(event.target)) return false;
        return true;
      },
    },
  ];

  autoScrollEnabled = true;

  private props: SensorProps<HoldSensorOptions>;
  private start: Point;
  private mouse: boolean;
  private activated = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private doc: Document;
  private removers: (() => void)[] = [];
  private lateRemovers: (() => void)[] = [];

  constructor(props: SensorProps<HoldSensorOptions>) {
    this.props = props;
    const event = props.event;
    this.start = pointOf(event) ?? { x: 0, y: 0 };
    this.mouse = !(event instanceof PointerEvent && event.pointerType === "touch");
    this.doc = event.target instanceof Node ? event.target.ownerDocument ?? document : document;
    const win = this.doc.defaultView ?? window;

    this.listen(this.doc, "pointermove", this.onMove, { passive: false });
    this.listen(this.doc, "pointerup", this.onUp);
    this.listen(this.doc, "pointercancel", this.onCancel);
    this.listen(this.doc, "keydown", this.onKey);
    // Once the card is lifted, a finger that moves must move the card, not
    // the list: the scroll is refused on the move event itself.
    this.listen(this.doc, "touchmove", this.onTouchMove, { passive: false });
    this.listen(win, "blur", this.onCancel);
    this.listen(win, "resize", this.onCancel);
    this.listen(win, "dragstart", preventDefault);
    this.listen(win, "contextmenu", preventDefault);

    this.timer = setTimeout(() => this.begin(), HOLD_MS);
    props.onPending(props.active, { delay: HOLD_MS, tolerance: HOLD_TOLERANCE_PX }, this.start);
  }

  private listen(
    target: EventTarget,
    name: string,
    handler: (e: Event) => void,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(name, handler, options);
    this.removers.push(() => target.removeEventListener(name, handler, options));
  }

  private begin() {
    if (this.activated) return;
    this.activated = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // The click the release would fire lands on the control the hold began
    // on: stopped, for the one click after the release (detach waits).
    const stopClick = (e: Event) => e.stopPropagation();
    this.doc.addEventListener("click", stopClick, { capture: true });
    this.lateRemovers.push(() => this.doc.removeEventListener("click", stopClick, { capture: true }));
    const clearSelection = () => this.doc.getSelection()?.removeAllRanges();
    clearSelection();
    this.doc.addEventListener("selectionchange", clearSelection);
    this.lateRemovers.push(() => this.doc.removeEventListener("selectionchange", clearSelection));
    this.props.onStart(this.start);
  }

  private detach() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    for (const remove of this.removers) remove();
    this.removers = [];
    // The click and the selection listeners outlive the release by a tick:
    // the click comes after the pointer is up.
    const late = this.lateRemovers;
    this.lateRemovers = [];
    setTimeout(() => late.forEach((remove) => remove()), 50);
  }

  private onMove = (event: Event) => {
    const at = pointOf(event);
    if (!at) return;
    if (!this.activated) {
      const moved = distanceBetween(this.start, at);
      if (this.mouse && moved >= HOLD_DISTANCE_PX) {
        this.begin();
        this.props.onMove(at);
        return;
      }
      if (moved > HOLD_TOLERANCE_PX) {
        this.onCancel();
        return;
      }
      this.props.onPending(
        this.props.active,
        { delay: HOLD_MS, tolerance: HOLD_TOLERANCE_PX },
        this.start,
        { x: at.x - this.start.x, y: at.y - this.start.y },
      );
      return;
    }
    if (event.cancelable) event.preventDefault();
    this.props.onMove(at);
  };

  private onTouchMove = (event: Event) => {
    if (this.activated && event.cancelable) event.preventDefault();
  };

  private onUp = () => {
    const activated = this.activated;
    this.detach();
    if (!activated) this.props.onAbort(this.props.active);
    this.props.onEnd();
  };

  private onCancel = () => {
    const activated = this.activated;
    this.detach();
    if (!activated) this.props.onAbort(this.props.active);
    this.props.onCancel();
  };

  private onKey = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key === "Escape") this.onCancel();
  };
}

function preventDefault(event: Event) {
  event.preventDefault();
}
