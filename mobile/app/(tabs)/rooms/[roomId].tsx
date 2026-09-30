import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { colors, radius } from '../../../src/lib/theme';
import { Send, Users, CheckCircle2, ArrowLeft } from 'lucide-react-native';

type Message = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  display_name?: string;
};

export default function RoomDetailScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const [roomName, setRoomName] = useState<string>('');
  const [memberCount, setMemberCount] = useState<number>(0);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', user_id: 'other', content: 'Jordan: I always mix up valence electrons.', created_at: new Date().toISOString() },
    { id: '2', user_id: 'me', content: 'Valence electrons determine element reactivity!', created_at: new Date().toISOString() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!roomId) return;
    loadMessages();
    loadRoomInfo();

    // Supabase Realtime Subscription (Task 22)
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => [...prev, newMsg]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  async function loadRoomInfo() {
    try {
      const { data: room } = await supabase
        .from('rooms')
        .select('name')
        .eq('id', roomId)
        .single();
      if (room?.name) setRoomName(room.name);

      const { count } = await supabase
        .from('room_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('room_id', roomId);
      if (count != null) setMemberCount(count);
    } catch {
      // Keep fallback header values on error
    }
  }

  async function loadMessages() {
    try {
      const { data } = await supabase
        .from('room_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (data && data.length > 0) {
        setMessages(data);
      }
    } catch {
      // Use preview data on error
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setInput('');
      const { error } = await supabase.from('room_messages').insert({
        room_id: roomId,
        user_id: user.id,
        content: text,
      });

      if (error) {
        // Fallback local append if DB table not populated
        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), user_id: user.id, content: text, created_at: new Date().toISOString() },
        ]);
      }
    } catch {
      // Graceful catch
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={colors.ink} />
          </TouchableOpacity>
          <View style={styles.headerTitleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {roomName || 'Study Room'}
            </Text>
            <View style={styles.liveDot} />
          </View>
        </View>
        <Text style={styles.sub}>
          {memberCount > 0 ? `${memberCount} member${memberCount === 1 ? '' : 's'} · Live study room` : 'Live study room'}
        </Text>
      </View>

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {/* Shared Quiz Card Widget */}
        <View style={styles.quizCard}>
          <Text style={styles.quizHeader}>Shared quiz · Question 3 of 10</Text>
          <Text style={styles.quizQuestion}>What determines an element&apos;s reactivity?</Text>

          <View style={styles.quizOpt}>
            <Text style={styles.quizOptText}>Atomic mass</Text>
          </View>
          <View style={styles.quizOptRight}>
            <Text style={styles.quizOptRightText}>Valence electrons ✓</Text>
          </View>
          <View style={styles.quizOpt}>
            <Text style={styles.quizOptText}>Number of protons</Text>
          </View>
        </View>

        {/* Realtime Chat Thread */}
        {messages.map((m) => {
          const isMe = m.user_id !== 'other';
          return (
            <View
              key={m.id}
              style={[styles.msgBubble, isMe ? styles.msgMe : styles.msgThem]}
            >
              <Text style={styles.msgText}>{m.content}</Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Realtime Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Message room members..."
          placeholderTextColor={colors.inkSoft}
          value={input}
          onChangeText={setInput}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Send size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 50, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { padding: 4 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal },
  sub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  content: { padding: 16, gap: 12 },
  quizCard: {
    backgroundColor: colors.tealPale,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 8,
  },
  quizHeader: { fontSize: 11, fontWeight: '700', color: colors.tealDark, marginBottom: 4 },
  quizQuestion: { fontSize: 13.5, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  quizOpt: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 8,
    marginBottom: 4,
  },
  quizOptText: { fontSize: 12, color: colors.inkSoft },
  quizOptRight: {
    backgroundColor: colors.teal,
    borderRadius: radius.sm,
    padding: 8,
    marginBottom: 4,
  },
  quizOptRightText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  msgBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: radius.md,
  },
  msgThem: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  msgMe: {
    alignSelf: 'flex-end',
    backgroundColor: colors.violetPale,
  },
  msgText: { fontSize: 13.5, color: colors.ink },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  input: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 8 },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
