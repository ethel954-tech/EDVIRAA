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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!roomId) return;
    void supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
    loadMessages();
    loadRoomInfo();

    // Supabase Realtime Subscription (Task 22). Our own sends are delivered
    // by both the realtime INSERT and nothing else (we no longer append
    // locally), so no dedupe would be needed for us — but other devices in
    // the same room could echo the same row via different channels, and
    // rapid double-sends can race, so dedupe by message id anyway.
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) =>
            prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg],
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  async function loadRoomInfo() {
    try {
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select('name')
        .eq('id', roomId)
        .single();
      if (roomError) throw roomError;
      if (room?.name) setRoomName(room.name);

      const { count, error: countError } = await supabase
        .from('room_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('room_id', roomId);
      if (countError) throw countError;
      if (count != null) setMemberCount(count);
    } catch (e) {
      // Header shows fallback values; the user still gets an explanation.
      console.error('[room] loadRoomInfo failed', e);
      setLoadError('Could not load room details. Reopen this room to retry.');
    }
  }

  async function loadMessages() {
    try {
      const { data, error } = await supabase
        .from('room_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (error) throw error;
      setMessages(data ?? []);
      setLoadError(null);
    } catch (e) {
      console.error('[room] loadMessages failed', e);
      setLoadError('Could not load the chat history. Check your connection and reopen this room.');
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        setSendError('You are signed out. Log in again to send messages.');
        return;
      }

      // Only clear the input after the insert succeeds, so a failure keeps
      // the typed text for retry. The message itself appears via realtime.
      const { error } = await supabase.from('room_messages').insert({
        room_id: roomId,
        user_id: user.id,
        content: text,
      });
      if (error) throw error;

      setInput('');
    } catch (e) {
      console.error('[room] message send failed', e);
      setSendError('Message not sent. Check your connection and try again.');
    } finally {
      setSending(false);
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
        {loadError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity onPress={() => { loadMessages(); loadRoomInfo(); }}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Realtime Chat Thread */}
        {messages.length === 0 ? (
          <View style={styles.emptyChat}>
            <Text style={styles.emptyChatText}>
              No messages yet — say hello to get the discussion going.
            </Text>
          </View>
        ) : null}
        {messages.map((m) => {
          const isMe = currentUserId != null && m.user_id === currentUserId;
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

      {sendError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{sendError}</Text>
        </View>
      ) : null}
      {/* Realtime Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Message room members..."
          placeholderTextColor={colors.inkSoft}
          value={input}
          onChangeText={setInput}
          editable={!sending}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, sending && styles.sendBtnBusy]}
          onPress={handleSend}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Send size={18} color="#fff" />
          )}
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
  emptyChat: { padding: 16, alignItems: 'center' },
  emptyChatText: { fontSize: 12.5, color: colors.inkSoft, textAlign: 'center' },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.dangerPale,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  errorText: { fontSize: 12.5, color: colors.danger, flex: 1 },
  retryText: { fontSize: 13, fontWeight: '700', color: colors.teal },
  sendBtnBusy: { opacity: 0.7 },
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
