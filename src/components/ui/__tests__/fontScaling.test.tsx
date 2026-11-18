/**
 * Fixed text size (owner, 2026-11-18 «اريده متسق»): the app's text and fields do
 * not follow the phone's font-size setting, so screens look the same on every
 * phone and nothing outgrows its field or pill.
 */
import { render, screen } from '@testing-library/react-native';

import { TextInput } from '../TextInput';
import { Txt } from '../Txt';

test('Txt ignores the phone font-size setting', async () => {
  await render(<Txt>المحجة البيضاء</Txt>);
  expect(screen.getByText('المحجة البيضاء').props.allowFontScaling).toBe(false);
});

test('the shared TextInput ignores it too', async () => {
  await render(<TextInput placeholder="اسمك" />);
  expect(screen.getByPlaceholderText('اسمك').props.allowFontScaling).toBe(false);
});
