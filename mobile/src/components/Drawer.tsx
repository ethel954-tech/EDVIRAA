import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
} from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { colors, radius } from '../lib/theme';
import { supabase } from '../lib/supabase';
import {
  Home,
  Sparkles,
  FileText,
  Users,
  Activity,
  LogOut,
  Settings,
  Plus,
  ChevronRight,
} from 'lucide-react-native';

const DRAWER_WIDTH = Math.min(320, Dimensions.get('window').width * 0.82);

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile?: any;
  /** Real recent chat topics from the tutor; omit for an empty state. */
  recentChats?: string[];
  onSelectRecentChat?: (topic: string) => void;
}

export function AppDrawer({
  isOpen,
  onClose,
  userProfile,
  recentChats = [],
  onSelectRecentChat,
}: DrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const animX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const animOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) {
      Animated.parallel([
        Animated.timing(animX, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(animOpacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(animX, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(animOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isOpen]);

  function navigateTo(route: string) {
    onClose();
    setTimeout(() => {
      router.push(route as any);
    }, 150);
  }

  async function handleSignOut() {
    onClose();
    await supabase.auth.signOut();
    router.replace('/(auth)/sign-in');
  }

  if (!isOpen) return null;

  const isCurrent = (route: string) => {
    if (route === '/(tabs)' && (pathname === '/(tabs)' || pathname === '/')) return true;
    if (route === '/(tabs)/tutor' && pathname.includes('/tutor')) return true;
    if (route === '/(tabs)/documents' && pathname.includes('/documents')) return true;
    if (route === '/(tabs)/rooms' && pathname.includes('/rooms')) return true;
    if (route === '/(tabs)/progress' && pathname.includes('/progress')) return true;
    return false;
  };

  const initialLetter = userProfile?.display_name
    ? userProfile.display_name.charAt(0).toUpperCase()
    : 'A';

  return (
    <Modal visible={isOpen} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Backdrop Overlay */}
        <Animated.View style={[styles.overlay, { opacity: animOpacity }]}>
          <Pressable style={styles.overlayTouch} onPress={onClose} />
        </Animated.View>

        {/* Drawer Panel */}
        <Animated.View style={[styles.drawer, { transform: [{ translateX: animX }] }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Study Assistant</Text>
            <Text style={styles.subtitle}>EDVIRAA Platform</Text>
          </View>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Primary Nav Links */}
            <TouchableOpacity
              style={[styles.dlink, isCurrent('/(tabs)') && styles.dlinkActive]}
              onPress={() => navigateTo('/(tabs)')}
            >
              <Home size={20} color={isCurrent('/(tabs)') ? colors.teal : colors.inkSoft} />
              <Text style={[styles.dlinkText, isCurrent('/(tabs)') && styles.dlinkTextActive]}>
                Home
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dlink, isCurrent('/(tabs)/tutor') && styles.dlinkActive]}
              onPress={() => navigateTo('/(tabs)/tutor')}
            >
              <Sparkles size={20} color={isCurrent('/(tabs)/tutor') ? colors.violet : colors.inkSoft} />
              <Text style={[styles.dlinkText, isCurrent('/(tabs)/tutor') && styles.dlinkTextActive]}>
                AI Tutor
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dlink, isCurrent('/(tabs)/documents') && styles.dlinkActive]}
              onPress={() => navigateTo('/(tabs)/documents')}
            >
              <FileText size={20} color={isCurrent('/(tabs)/documents') ? colors.teal : colors.inkSoft} />
              <Text style={[styles.dlinkText, isCurrent('/(tabs)/documents') && styles.dlinkTextActive]}>
                Subjects &amp; Notes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dlink, isCurrent('/(tabs)/rooms') && styles.dlinkActive]}
              onPress={() => navigateTo('/(tabs)/rooms')}
            >
              <Users size={20} color={isCurrent('/(tabs)/rooms') ? colors.teal : colors.inkSoft} />
              <Text style={[styles.dlinkText, isCurrent('/(tabs)/rooms') && styles.dlinkTextActive]}>
                Rooms &amp; Classes
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dlink, isCurrent('/(tabs)/progress') && styles.dlinkActive]}
              onPress={() => navigateTo('/(tabs)/progress')}
            >
              <Activity size={20} color={isCurrent('/(tabs)/progress') ? colors.teal : colors.inkSoft} />
              <Text style={[styles.dlinkText, isCurrent('/(tabs)/progress') && styles.dlinkTextActive]}>
                Progress
              </Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Recent Tutor Chats */}
            <Text style={styles.recentsLabel}>Recent tutor chats</Text>
            {recentChats.length === 0 ? (
              <Text style={styles.recentEmpty}>
                No recent chats yet — start one in AI Tutor.
              </Text>
            ) : (
              recentChats.map((topic, index) => (
              <TouchableOpacity
                key={index}
                style={styles.recentItem}
                onPress={() => {
                  onClose();
                  if (onSelectRecentChat) {
                    onSelectRecentChat(topic);
                  } else {
                    router.push({ pathname: '/(tabs)/tutor', params: { query: topic } } as any);
                  }
                }}
              >
                <View style={styles.rdot} />
                <Text style={styles.recentText} numberOfLines={1}>
                  {topic}
                </Text>
              </TouchableOpacity>
              ))
            )}
          </ScrollView>

          {/* Drawer Bottom Actions */}
          <View style={styles.dbottom}>
            <View style={styles.userRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialLetter}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName} numberOfLines={1}>
                  {userProfile?.display_name || 'Student'}
                </Text>
                <Text style={styles.userRole}>Student</Text>
              </View>
            </View>

            <View style={styles.btnGroup}>
              <TouchableOpacity
                style={styles.newchatBtn}
                onPress={() => navigateTo('/(tabs)/tutor')}
              >
                <Plus size={14} color={colors.ink} />
                <Text style={styles.newchatText}>New chat</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => navigateTo('/settings')}
              >
                <Settings size={18} color={colors.inkSoft} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.iconBtn} onPress={handleSignOut}>
                <LogOut size={18} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  overlayTouch: {
    flex: 1,
  },
  drawer: {
    width: DRAWER_WIDTH,
    height: '100%',
    backgroundColor: colors.bg,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 24,
    display: 'flex',
    flexDirection: 'column',
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    color: colors.inkSoft,
    marginTop: 2,
    fontWeight: '600',
  },
  scrollContent: {
    flex: 1,
  },
  dlink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    marginBottom: 4,
  },
  dlinkActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dlinkText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  dlinkTextActive: {
    color: colors.teal,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 14,
  },
  recentsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingLeft: 4,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
  },
  rdot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.inkSoft,
  },
  recentText: {
    fontSize: 13.5,
    color: colors.ink,
    flex: 1,
  },
  recentEmpty: {
    fontSize: 13,
    color: colors.inkSoft,
    paddingLeft: 4,
    marginBottom: 8,
  },
  dbottom: {
    marginTop: 'auto',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 14,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.violet,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  userRole: {
    fontSize: 11,
    color: colors.inkSoft,
  },
  btnGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  newchatBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  newchatText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
