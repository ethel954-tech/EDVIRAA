import React from 'react';
import { Tabs } from 'expo-router';
import { usePathname } from 'expo-router';
import { colors } from '../../src/lib/theme';
import { Home, Map, MessageCircle, Users, Activity, FileText } from 'lucide-react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="roadmap" options={{ title: 'Roadmap' }} />
      <Tabs.Screen name="tutor" options={{ title: 'Tutor' }} />
      <Tabs.Screen name="rooms/index" options={{ title: 'Rooms' }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      <Tabs.Screen name="documents" options={{ title: 'Docs' }} />
    </Tabs>
  );
}
