import { Stack } from 'expo-router';
import { colors } from '../../src/lib/theme';

export default function EducatorLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}
