/**
 * SheetModal — the shared bottom-sheet shell (dim backdrop + a sheet anchored to
 * the bottom of the screen).
 *
 * Why it exists: every sheet used to be `<Modal transparent animationType="slide">`
 * with its dim backdrop INSIDE the modal. «slide» moves the WHOLE modal window,
 * so the backdrop's top edge was seen travelling up the screen and the sheet (at
 * the bottom of that window) arrived last — the reverse on close. Here the Modal
 * itself never animates: the backdrop only FADES (opacity 0→1) while the sheet
 * only SLIDES (translateY from its own measured height → 0), in parallel, on the
 * native driver.
 *
 * - Mounts as soon as `visible` turns true. On `visible=false` it plays the close
 *   animation and only THEN unmounts the Modal. While closing it keeps rendering
 *   the last children it got while visible (a frozen frame), so a caller that
 *   clears its selection on close (`visible={!!selected}`) or resets a checkbox
 *   doesn't see the sheet empty out mid-slide; touches are ignored until it's gone.
 * - `children` is the sheet element itself, styled exactly as before. It is laid
 *   out in a full-screen, bottom-aligned (`justifyContent: 'flex-end'`) layer, so
 *   percentage sizes (`maxHeight: '80%'`) still resolve against the screen.
 * - Keyboard sheets keep their own KeyboardAvoidingView as the child — give it
 *   `style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}` and
 *   `pointerEvents="box-none"` (top-anchored, so `behavior="height"` still shrinks
 *   it from the bottom, and taps beside the sheet still reach the backdrop).
 * - Reduce motion (OS setting): no slide — backdrop and sheet just fade, quicker.
 * - Drag to dismiss (owner: the close must FEEL smooth): a downward drag that
 *   starts on the top of the sheet (grabber / title, DRAG_ZONE_PX) moves it with
 *   the finger while the dim lightens; released past a quarter of its height or
 *   flicked down, it continues down from where the finger left it (duration
 *   scaled to the distance left); otherwise it springs back. Only sheets that
 *   close from the dim (`dismissOnBackdrop`) can be dragged away, and only on
 *   native. A gesture-handler Pan on the sheet element (a PanResponder on the
 *   full-screen `box-none` layer never got the touch). Keyboard sheets, whose
 *   child is the full-screen KeyboardAvoidingView, don't drag (their top band
 *   is the dim).
 */
import {
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type PanGestureHandlerEventPayload,
} from 'react-native-gesture-handler';

/** The calm teal dim every sheet has always used. */
export const SHEET_BACKDROP_COLOR = 'rgba(22,53,47,0.35)';

/**
 * Open / close timings (ms). Open decelerates into place; close uses the
 * standard curve — it starts moving at once and eases out (the old ease-IN
 * close barely moved for most of its time, then vanished: «جاف»).
 */
export const SHEET_OPEN_MS = 300;
export const SHEET_CLOSE_MS = 280;
const OPEN_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const CLOSE_EASING = Easing.bezier(0.4, 0, 0.2, 1);
/** Drag-to-dismiss: the grab zone at the top of the sheet, and the release rules. */
const DRAG_ZONE_PX = 96;
const DRAG_DISMISS_RATIO = 0.25;
const DRAG_DISMISS_MAX_PX = 150;
/** px/s — a flick down closes even when it moved only a little. */
const DRAG_DISMISS_VELOCITY = 800;
/** The finger travels this far before the drag takes over (and the sheet moves). */
const DRAG_ACTIVATION_PX = 10;
const MIN_CLOSE_MS = 120;
const REDUCED_OPEN_MS = 160;
const REDUCED_CLOSE_MS = 140;
/**
 * A freshly opened sheet waits this long (at most) for its first layout so it
 * slides exactly its own height; past it, it slides in from the window height.
 */
const LAYOUT_WAIT_MS = 120;
/** react-native-web has no native animated module. */
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

type LayoutHandler = (e: LayoutChangeEvent) => void;
type DragHandlers = {
  start: () => void;
  update: (e: PanGestureHandlerEventPayload) => void;
  end: (e: PanGestureHandlerEventPayload, success: boolean) => void;
};

export type SheetModalProps = {
  visible: boolean;
  /** Backdrop tap (unless `dismissOnBackdrop={false}`) and, by default, Android back. */
  onClose: () => void;
  /** Android hardware back. Defaults to `onClose`. */
  onRequestClose?: () => void;
  /** Tapping the dim closes the sheet (default true). */
  dismissOnBackdrop?: boolean;
  /** Dragging the sheet down closes it (default: same as `dismissOnBackdrop`). */
  dismissOnDrag?: boolean;
  /** Dim colour; defaults to {@link SHEET_BACKDROP_COLOR}. */
  backdropColor?: string;
  /** Screen-reader label for the tappable dim (only when it dismisses). */
  backdropAccessibilityLabel?: string;
  /** Set on the Modal; the dim gets `${testID}-backdrop`, the drag gesture `${testID}-drag`. */
  testID?: string;
  /** The sheet element (one element, so its height can be measured). */
  children: ReactNode;
};

export function SheetModal({
  visible,
  onClose,
  onRequestClose,
  dismissOnBackdrop = true,
  dismissOnDrag,
  backdropColor = SHEET_BACKDROP_COLOR,
  backdropAccessibilityLabel,
  testID,
  children,
}: SheetModalProps) {
  const canDrag = dismissOnDrag ?? dismissOnBackdrop;
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReduceMotion();

  // Mount synchronously in the same render that flips `visible` on; unmounting
  // waits for the close animation (see the visibility effect below).
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetOffset = useRef(new Animated.Value(windowHeight)).current;

  // Latest props for callbacks that outlive the render that created them.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const windowHeightRef = useRef(windowHeight);
  windowHeightRef.current = windowHeight;
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  /** Last children rendered while visible — shown (frozen) during the close. */
  const frozenChildren = useRef<ReactNode>(children);
  if (visible) frozenChildren.current = children;

  const alive = useRef(true);
  /** The sheet's measured height for the current mount (null = not laid out yet). */
  const sheetHeight = useRef<number | null>(null);
  /** An open/close cycle has started drawing (values are live, not at rest). */
  const onScreen = useRef(false);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  /** Bumped by every new animation — a superseded one's end callback is ignored. */
  const animToken = useRef(0);
  const awaitingLayout = useRef(false);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measurable = useRef(false);

  const offscreen = () => sheetHeight.current ?? windowHeightRef.current;
  /** Where a drag released the sheet (px down), so the close continues from there. */
  const releasedAt = useRef(0);

  const cancelLayoutWait = () => {
    awaitingLayout.current = false;
    if (layoutTimer.current) {
      clearTimeout(layoutTimer.current);
      layoutTimer.current = null;
    }
  };

  const stopRunning = () => {
    animToken.current += 1; // before stop(): its end callback must see itself superseded
    running.current?.stop();
    running.current = null;
  };

  const animate = (open: boolean, onDone?: () => void) => {
    stopRunning();
    const token = animToken.current;
    const reduced = reduceMotionRef.current;
    // A close after a drag only has the rest of the way to go: keep its speed.
    const left = open ? 1 : Math.max(0, 1 - releasedAt.current / Math.max(1, offscreen()));
    releasedAt.current = 0;
    const config = {
      duration: open
        ? reduced
          ? REDUCED_OPEN_MS
          : SHEET_OPEN_MS
        : reduced
          ? REDUCED_CLOSE_MS
          : Math.max(MIN_CLOSE_MS, Math.round(SHEET_CLOSE_MS * left)),
      easing: open ? OPEN_EASING : CLOSE_EASING,
      useNativeDriver: USE_NATIVE_DRIVER,
    };
    const parts = [Animated.timing(backdropOpacity, { ...config, toValue: open ? 1 : 0 })];
    if (!reduced) {
      parts.push(Animated.timing(sheetOffset, { ...config, toValue: open ? 0 : offscreen() }));
    }
    const animation = Animated.parallel(parts);
    running.current = animation;
    animation.start(() => {
      if (token !== animToken.current) return; // interrupted by a newer open/close
      running.current = null;
      onDone?.();
    });
  };

  const startOpen = () => {
    cancelLayoutWait();
    if (!onScreen.current) {
      onScreen.current = true;
      backdropOpacity.setValue(0);
      sheetOffset.setValue(reduceMotionRef.current ? 0 : offscreen());
    }
    animate(true);
  };

  const onSheetLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) sheetHeight.current = h;
    if (awaitingLayout.current) startOpen();
  };

  // Unmount (incl. mid-animation): stop everything, never set state afterwards.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelLayoutWait();
      stopRunning();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible) {
      // Re-opened mid-close (or nothing to measure, or already laid out): go now,
      // from wherever the values are.
      if (onScreen.current || !measurable.current || sheetHeight.current != null) {
        startOpen();
        return undefined;
      }
      // Fresh open: wait (briefly) for the first layout to learn the sheet height.
      awaitingLayout.current = true;
      layoutTimer.current = setTimeout(startOpen, LAYOUT_WAIT_MS);
      return cancelLayoutWait;
    }

    if (!onScreen.current) {
      // Closed before it ever drew (or it was never open): nothing to animate.
      stopRunning();
      setMounted(false);
      return undefined;
    }
    animate(false, () => {
      if (!alive.current || visibleRef.current) return;
      onScreen.current = false;
      sheetHeight.current = null;
      backdropOpacity.setValue(0);
      sheetOffset.setValue(windowHeightRef.current);
      setMounted(false);
    });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag to dismiss — a gesture-handler Pan on the sheet element itself, which
  // only begins inside its top band (hitSlop: grabber / title), activates on a
  // clearly downward move and fails sideways — taps (the «×»), horizontal chips
  // and the sheet's own scrolling below the header keep working.
  // The worklets babel plugin auto-workletizes gesture callbacks and snapshots
  // their closure when the gesture is built (a later-declared helper was
  // captured as undefined → crash), so they reach the live handlers only
  // through this ref, read at call time (on JS: `runOnJS(true)`).
  const dragHandlers = useRef<DragHandlers | null>(null);
  const dragEnabled = canDrag && visible && !reduceMotion && Platform.OS !== 'web';
  const drag = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true) // drives the same Animated values as open / close
        .enabled(dragEnabled)
        .hitSlop({ top: 0, height: DRAG_ZONE_PX })
        .activeOffsetY(DRAG_ACTIVATION_PX)
        .failOffsetY(-DRAG_ACTIVATION_PX)
        .failOffsetX([-20, 20])
        .withTestId(testID ? `${testID}-drag` : 'sheet-modal-drag')
        .onStart(() => dragHandlers.current?.start())
        .onUpdate((e) => dragHandlers.current?.update(e))
        .onEnd((e, success) => dragHandlers.current?.end(e, success)),
    [dragEnabled, testID],
  );

  /** A drag that didn't go far enough: spring back into place. */
  const settleBack = () => {
    stopRunning();
    const token = animToken.current;
    const animation = Animated.parallel([
      Animated.spring(sheetOffset, { toValue: 0, useNativeDriver: USE_NATIVE_DRIVER, bounciness: 0, speed: 16 }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: USE_NATIVE_DRIVER }),
    ]);
    running.current = animation;
    animation.start(() => {
      if (token === animToken.current) running.current = null;
    });
  };

  dragHandlers.current = {
    start: () => {
      cancelLayoutWait();
      stopRunning();
    },
    update: (e) => {
      const d = Math.max(0, e.translationY - DRAG_ACTIVATION_PX);
      sheetOffset.setValue(d);
      backdropOpacity.setValue(Math.max(0, 1 - d / Math.max(1, offscreen())));
    },
    end: (e, success) => {
      const d = Math.max(0, e.translationY - DRAG_ACTIVATION_PX);
      const h = offscreen();
      if (success && (d > Math.min(DRAG_DISMISS_MAX_PX, h * DRAG_DISMISS_RATIO) || e.velocityY > DRAG_DISMISS_VELOCITY)) {
        releasedAt.current = d;
        onClose(); // the caller flips `visible` → the close runs from here
        // A caller that keeps the sheet open must not leave it hanging half-way.
        setTimeout(() => {
          if (alive.current && visibleRef.current) {
            releasedAt.current = 0;
            settleBack();
          }
        }, 80);
      } else {
        settleBack();
      }
    },
  };

  const handleBackdropPress = () => {
    if (visibleRef.current) onClose();
  };
  const handleRequestClose = () => {
    if (visibleRef.current) (onRequestClose ?? onClose)();
  };

  // Measure the sheet through its own onLayout (chained with the caller's), so
  // the slide distance is exactly its height and its layout is left untouched.
  const content = visible ? children : frozenChildren.current;
  let sheet: ReactNode = content;
  measurable.current = isValidElement(content) && content.type !== Fragment;
  if (measurable.current) {
    const element = content as ReactElement<{ onLayout?: LayoutHandler }>;
    const ownOnLayout = element.props.onLayout;
    sheet = (
      <GestureDetector gesture={drag}>
        {cloneElement(element, {
          onLayout: (e: LayoutChangeEvent) => {
            onSheetLayout(e);
            ownOnLayout?.(e);
          },
        })}
      </GestureDetector>
    );
  }

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleRequestClose}
      testID={testID}
    >
      {/* An Android Modal is its own window: gestures need their own root there. */}
      <GestureHandlerRootView style={styles.fill}>
        <View style={styles.fill} pointerEvents={visible ? 'box-none' : 'none'}>
          <Animated.View style={[styles.fill, { backgroundColor: backdropColor, opacity: backdropOpacity }]}>
            {dismissOnBackdrop ? (
              <Pressable
                style={styles.fill}
                onPress={handleBackdropPress}
                accessibilityRole={backdropAccessibilityLabel ? 'button' : undefined}
                accessibilityLabel={backdropAccessibilityLabel}
                testID={testID ? `${testID}-backdrop` : undefined}
              />
            ) : null}
          </Animated.View>
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.layer,
              reduceMotion ? { opacity: backdropOpacity } : { transform: [{ translateY: sheetOffset }] },
            ]}
          >
            {sheet}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** OS «reduce motion» setting, live. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => active && setReduce(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill },
  layer: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
});
