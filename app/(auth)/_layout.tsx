import { Stack } from 'expo-router';

/** Authentication flow (sign in). Roles: student / admin. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
