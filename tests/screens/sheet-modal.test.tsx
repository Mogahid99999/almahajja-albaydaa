/**
 * src/components/ui/SheetModal.tsx — the shared bottom-sheet shell that replaced
 * 14 copies of `<Modal transparent animationType="slide">` with the dim INSIDE
 * the modal (the whole window slid, so the backdrop's top edge travelled up the
 * screen before the sheet arrived). Now the Modal doesn't animate; the backdrop
 * fades and the sheet slides, and the Modal only unmounts once the close
 * animation has finished.
 *
 * Pins: children render only while open · the dim dismisses (unless told not to)
 * · Android back → onRequestClose (falling back to onClose) · on close the sheet
 * stays mounted — frozen, not emptied — until the close animation ends, then
 * unmounts · a quick close→reopen interrupts cleanly (no stuck, untappable sheet)
 * · drag to dismiss (owner: «المودل اصبح جاف … اريد ان يحس المستخدم انه smoothly»):
 * a long drag or a flick closes, a short one springs back. (The release-only
 * crash on a short drag — the worklets plugin's snapshotted closure held an
 * undefined helper — doesn't reproduce under Jest's dev transform; it was
 * verified on a device.)
 */
import { NativeModules, Pressable, Text, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { State, type PanGesture } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { SHEET_CLOSE_MS, SHEET_OPEN_MS, SheetModal } from '@/components/ui/SheetModal';

type EndCallback = (result: { finished: boolean }) => void;

const SHEET_COPY = 'تأكيد الدعوة';

type Api = Awaited<ReturnType<typeof render>>;

function sheet(copy = SHEET_COPY, onPress?: () => void) {
  return (
    <View testID="sheet">
      <Text>{copy}</Text>
      {onPress ? (
        <Pressable onPress={onPress} accessibilityRole="button">
          <Text>إرسال</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

/** The sheet reports its height (as on a device) → the open slide starts. */
const layoutSheet = async (api: Api, height = 320) => {
  await fireEvent(api.getByTestId('sheet'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-29T09:00:00Z'));
  // SheetModal animates on the native driver. The preset's native-animated mock
  // ends EVERY animation after 16 ms; make it honour the configured length (the
  // 60 fps frame list the timing animation sends) so these tests see the real
  // open/close timing.
  (NativeModules.NativeAnimatedModule.startAnimatingNode as jest.Mock).mockImplementation(
    (_id: number, _tag: number, config: { frames?: unknown[] }, endCallback: EndCallback) => {
      const ms = Math.max(1, ((config.frames?.length ?? 2) - 1) * (1000 / 60));
      setTimeout(() => endCallback({ finished: true }), ms);
    },
  );
});

afterEach(() => {
  jest.useRealTimers();
});

test('renders the sheet only while visible', async () => {
  const api = await render(
    <SheetModal visible={false} onClose={jest.fn()}>
      {sheet()}
    </SheetModal>,
  );
  expect(api.queryByText(SHEET_COPY)).toBeNull();

  await api.rerender(
    <SheetModal visible onClose={jest.fn()}>
      {sheet()}
    </SheetModal>,
  );
  expect(api.getByText(SHEET_COPY)).toBeTruthy();
});

test('tapping the dim calls onClose; tapping inside the sheet does not', async () => {
  const onClose = jest.fn();
  const onSend = jest.fn();
  const api = await render(
    <SheetModal visible onClose={onClose} backdropAccessibilityLabel="إغلاق">
      {sheet(SHEET_COPY, onSend)}
    </SheetModal>,
  );
  await layoutSheet(api);
  await advance(SHEET_OPEN_MS + 20);

  await fireEvent.press(api.getByText('إرسال'));
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  await fireEvent.press(api.getByLabelText('إغلاق'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('dismissOnBackdrop={false} renders no tappable dim (oath / gender prompts)', async () => {
  const api = await render(
    <SheetModal visible onClose={jest.fn()} dismissOnBackdrop={false} backdropAccessibilityLabel="إغلاق">
      {sheet()}
    </SheetModal>,
  );
  expect(api.getByText(SHEET_COPY)).toBeTruthy();
  expect(api.queryByLabelText('إغلاق')).toBeNull();
});

test('Android back calls onRequestClose, falling back to onClose', async () => {
  const onClose = jest.fn();
  const onRequestClose = jest.fn();
  const api = await render(
    <SheetModal visible onClose={onClose} onRequestClose={onRequestClose} testID="sheet-modal">
      {sheet()}
    </SheetModal>,
  );
  await fireEvent(api.getByTestId('sheet-modal'), 'requestClose');
  expect(onRequestClose).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  await api.rerender(
    <SheetModal visible onClose={onClose} testID="sheet-modal">
      {sheet()}
    </SheetModal>,
  );
  await fireEvent(api.getByTestId('sheet-modal'), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('on close the sheet stays (frozen) until the close animation ends, then unmounts', async () => {
  const api = await render(
    <SheetModal visible onClose={jest.fn()}>
      {sheet()}
    </SheetModal>,
  );
  await layoutSheet(api);
  await advance(SHEET_OPEN_MS + 20);

  // The caller clears its selection on close (`visible={!!selected}`), so the
  // children it now passes are different — the sliding-out sheet must not empty.
  await api.rerender(
    <SheetModal visible={false} onClose={jest.fn()}>
      {sheet('')}
    </SheetModal>,
  );
  expect(api.getByText(SHEET_COPY)).toBeTruthy();

  await advance(SHEET_CLOSE_MS - 60);
  expect(api.getByText(SHEET_COPY)).toBeTruthy();

  await advance(120);
  expect(api.queryByText(SHEET_COPY)).toBeNull();
});

test('while closing, the sheet ignores taps (no double-submit on the way out)', async () => {
  const onSend = jest.fn();
  const api = await render(
    <SheetModal visible onClose={jest.fn()}>
      {sheet(SHEET_COPY, onSend)}
    </SheetModal>,
  );
  await layoutSheet(api);
  await advance(SHEET_OPEN_MS + 20);

  await api.rerender(
    <SheetModal visible={false} onClose={jest.fn()}>
      {sheet(SHEET_COPY, onSend)}
    </SheetModal>,
  );
  await fireEvent.press(api.getByText('إرسال'));
  expect(onSend).not.toHaveBeenCalled();
});

test('a quick close → reopen interrupts the close: the sheet stays mounted and tappable', async () => {
  const onSend = jest.fn();
  const view = (visible: boolean) => (
    <SheetModal visible={visible} onClose={jest.fn()}>
      {sheet(SHEET_COPY, onSend)}
    </SheetModal>
  );
  const api = await render(view(true));
  await layoutSheet(api);
  await advance(SHEET_OPEN_MS / 2); // mid-open

  await api.rerender(view(false));
  await advance(SHEET_CLOSE_MS / 2); // mid-close
  await api.rerender(view(true));

  // Well past when the interrupted close would have unmounted it.
  await advance(SHEET_CLOSE_MS + SHEET_OPEN_MS);
  expect(api.getByText(SHEET_COPY)).toBeTruthy();
  await fireEvent.press(api.getByText('إرسال'));
  expect(onSend).toHaveBeenCalledTimes(1);
});

test('without a layout event (no measurement) it still opens and closes fully', async () => {
  const view = (visible: boolean) => (
    <SheetModal visible={visible} onClose={jest.fn()}>
      {sheet()}
    </SheetModal>
  );
  const api = await render(view(true));
  // Falls back to sliding from the window height after a short wait.
  await advance(1000);
  await api.rerender(view(false));
  expect(api.getByText(SHEET_COPY)).toBeTruthy();
  await advance(SHEET_CLOSE_MS + 60);
  expect(api.queryByText(SHEET_COPY)).toBeNull();
});

test('closed before it ever drew → unmounts at once (nothing to animate)', async () => {
  const view = (visible: boolean) => (
    <SheetModal visible={visible} onClose={jest.fn()}>
      {sheet()}
    </SheetModal>
  );
  const api = await render(view(true));
  await api.rerender(view(false)); // still waiting for the first layout
  expect(api.queryByText(SHEET_COPY)).toBeNull();
});

test('unmounting mid-animation is safe (no late state updates)', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  const api = await render(
    <SheetModal visible onClose={jest.fn()}>
      {sheet()}
    </SheetModal>,
  );
  await layoutSheet(api);
  await advance(SHEET_OPEN_MS / 2);
  await api.unmount();
  await advance(SHEET_OPEN_MS + SHEET_CLOSE_MS);
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

/** A pan on the sheet's top band: BEGAN → ACTIVE → moves → END at `dy`. */
const dragSheet = async (testID: string, dy: number, velocityY = 100) => {
  await act(async () => {
    fireGestureHandler<PanGesture>(getByGestureTestId(`${testID}-drag`), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 12 },
      { translationY: dy / 2 },
      { state: State.END, translationY: dy, velocityY },
    ]);
  });
};

test('a short drag down springs back and keeps the sheet open', async () => {
  const onClose = jest.fn();
  const api = await render(
    <SheetModal visible onClose={onClose} testID="sheet-modal">
      {sheet()}
    </SheetModal>,
  );
  await layoutSheet(api, 400);
  await advance(SHEET_OPEN_MS + 20);

  await dragSheet('sheet-modal', 60);
  await advance(400);
  expect(onClose).not.toHaveBeenCalled();
  expect(api.getByText(SHEET_COPY)).toBeTruthy();
});

test('dragging past a quarter of the sheet, or flicking it down, closes it', async () => {
  const onClose = jest.fn();
  const api = await render(
    <SheetModal visible onClose={onClose} testID="sheet-modal">
      {sheet()}
    </SheetModal>,
  );
  await layoutSheet(api, 400);
  await advance(SHEET_OPEN_MS + 20);

  await dragSheet('sheet-modal', 180);
  expect(onClose).toHaveBeenCalledTimes(1);

  // A caller that keeps it open (onClose didn't flip `visible`): it settles back.
  await advance(400);
  expect(api.getByText(SHEET_COPY)).toBeTruthy();

  await dragSheet('sheet-modal', 40, 1500);
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('the drag closes the sheet all the way (then unmounts)', async () => {
  let visible = true;
  const onClose = jest.fn(() => {
    visible = false;
  });
  const ui = () => (
    <SheetModal visible={visible} onClose={onClose} testID="sheet-modal">
      {sheet()}
    </SheetModal>
  );
  const api = await render(ui());
  await layoutSheet(api, 400);
  await advance(SHEET_OPEN_MS + 20);

  await dragSheet('sheet-modal', 200);
  await api.rerender(ui());
  expect(api.getByText(SHEET_COPY)).toBeTruthy(); // still sliding out from where the finger left it
  await advance(SHEET_CLOSE_MS + 50);
  expect(api.queryByText(SHEET_COPY)).toBeNull();
});
