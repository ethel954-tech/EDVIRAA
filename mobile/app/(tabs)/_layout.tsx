import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { FocusMusic } from '../../src/components/FocusMusic';

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
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
      {/* App-wide focus music control, above the tab screens. */}
      <FocusMusic />
    </View>
  );
}
