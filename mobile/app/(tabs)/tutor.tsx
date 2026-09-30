import React, { useState, useRef, useEffect } from 'react';
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
  Alert,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../../src/lib/supabase';
import { getActiveSubject, setActiveSubject, listSubjects, type Subject } from '../../src/lib/subjects';
import { colors, radius } from '../../src/lib/theme';
import { AppDrawer } from '../../src/components/Drawer';
import {
  Menu,
  Mic,
  Send,
  Volume2,
  Square,
  Sparkles,
  FileText,
  ChevronDown,
  Check,
} from 'lucide-react-native';

const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  Constants.expoConfig?.extra?.supabaseUrl ||
  'https://crblfsmdlawvwsrlrctm.supabase.co';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: { documentTitle: string }[];
  pending?: boolean;
};

const QUICK_ACTIONS = [
  { label: "Explain like I'm 5", msg: "Explain the main concepts in my documents like I'm 5, with a simple analogy." },
  { label: "Make a quiz", msg: "Generate a short numbered quiz based on my subject notes, answer key at bottom." },
  { label: "Debate mode", msg: "Let's debate the core hypotheses from my subject notes — challenge my arguments." },
  { label: "Key takeaways", msg: "Summarize the 3 most important takeaways from my uploaded study notes." },
];

export default function MobileTutorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I am your AI study companion. Ask me anything grounded in your uploaded subject notes.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // Server-side conversation id: sent back with every message so the tutor
  // resumes this conversation (history + grounding) instead of starting a
  // new one per message. Kept in a ref too so the send closure always sees
  // the latest value without re-creating handlers.
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);

  // Profile & Subjects
  const [profile, setProfile] = useState<any>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);

  // Load profile, subjects, and handle incoming query param from drawer/FAB
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single();
          setProfile(prof);
        }
        const [subs, active] = await Promise.all([listSubjects(), getActiveSubject()]);
        setSubjects(subs);
        setSubject(active);

        // Handle initial query from router params (e.g. recent chat or FAB)
        if (params.query && typeof params.query === 'string') {
          handleSend(params.query);
        }
      } catch {
        // screen still works without a subject
      }
    })();
  }, [params.query]);

  async function handleSwitchSubject(next: Subject) {
    setSubjectModalOpen(false);
    if (next.id === subject?.id) return;
    setSubject(next);
    // The conversation is scoped to one subject — starting a new subject
    // means a new conversation (subjectId can't smuggle a conversation out
    // of its grounding scope server-side either).
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    try {
      await setActiveSubject(next.id);
    } catch {
      // non-fatal
    }
  }

  async function handleSend(rawText: string) {
    const text = rawText.trim();
    if (!text || busy) return;

    const userMsgId = Date.now().toString();
    const assistantMsgId = (Date.now() + 1).toString();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text },
      { id: assistantMsgId, role: 'assistant', content: '', pending: true },
    ]);
    setInput('');
    setBusy(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/tutor-chat`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: text,
            subjectId: subject?.id ?? undefined,
            conversationId: activeConversationIdRef.current ?? undefined,
          }),
        }
      );

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || `Tutor request failed (${response.status})`);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: payload.reply || '(The tutor returned an empty reply.)',
                sources: payload.sources || [],
                pending: false,
              }
            : m
        )
      );

      // Remember the conversation so the next message resumes it. When the
      // subject changes, drop it — the new subject starts a fresh scope.
      if (typeof payload.conversationId === 'string' && payload.conversationId) {
        activeConversationIdRef.current = payload.conversationId;
        setActiveConversationId(payload.conversationId);
      }
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `Sorry — ${e?.message || 'something went wrong contacting the tutor'}. Please try again.`,
                pending: false,
              }
            : m
        )
      );
    } finally {
      setBusy(false);
    }
  }

  // Voice recording using expo-av
  async function toggleRecording() {
    try {
      if (isRecording && recording) {
        setIsRecording(false);
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        if (uri) {
          await transcribeAndSend(uri);
        }
      } else {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Microphone access needed',
            'Please allow microphone access in Settings to record voice notes.'
          );
          return;
        }

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const { recording: newRecording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        setRecording(newRecording);
        setIsRecording(true);
      }
    } catch (err: any) {
      setIsRecording(false);
      setRecording(null);
      Alert.alert('Recording error', err?.message || 'Could not record audio. Please try again.');
    }
  }

  async function transcribeAndSend(uri: string) {
    try {
      setBusy(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        Alert.alert('Not signed in', 'Please sign in to use voice notes.');
        return;
      }

      const audioBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const res = await fetch(`${SUPABASE_URL}/functions/v1/speech-transcribe`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audio_base64: audioBase64, mime_type: 'audio/mp4' }),
      });

      const payload = await res.json().catch(() => ({}));
      const transcript: string = payload.transcript || payload.text || '';
      if (!transcript.trim()) {
        Alert.alert(
          'No speech detected',
          payload.error || 'We could not hear anything in the recording. Try speaking closer to the mic.'
        );
        return;
      }
      await handleSend(transcript);
    } catch (e: any) {
      Alert.alert('Transcription failed', e?.message || 'Could not transcribe the recording.');
    } finally {
      setBusy(false);
    }
  }

  // Text to speech output using expo-speech
  function toggleSpeech(m: Message) {
    if (speakingId === m.id) {
      Speech.stop();
      setSpeakingId(null);
    } else {
      Speech.stop();
      setSpeakingId(m.id);
      Speech.speak(m.content, {
        onDone: () => setSpeakingId(null),
        onError: () => setSpeakingId(null),
      });
    }
  }

  const userFirstName = profile?.display_name ? profile.display_name.split(' ')[0] : 'Amara';
  const userInitial = profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : 'A';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Slide-out Navigation Drawer */}
      <AppDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        userProfile={profile}
        onSelectRecentChat={(topic) => handleSend(topic)}
      />

      {/* Top Header Bar matching mobile-chat-home.html */}
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => setDrawerOpen(true)}
          accessibilityLabel="Open Drawer Menu"
        >
          <Menu size={24} color={colors.ink} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.avatar} onPress={() => setDrawerOpen(true)}>
          <Text style={styles.avatarText}>{userInitial}</Text>
        </TouchableOpacity>
      </View>

      {/* Main Conversation Area */}
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
      >
        {/* Mid Hero Section matching mobile-chat-home.html */}
        <View style={styles.midHero}>
          <View style={styles.sparkIconContainer}>
            <Sparkles size={36} color={colors.amber} />
          </View>
          <Text style={styles.greetingTitle}>Hey, {userFirstName}</Text>

          <TouchableOpacity
            style={styles.subjectChip}
            onPress={() => setSubjectModalOpen(true)}
          >
            <Text style={styles.subjectChipIcon}>📘</Text>
            <Text style={styles.subjectChipText}>{subject ? subject.name : 'Biology 101'}</Text>
            <ChevronDown size={12} color={colors.inkSoft} />
          </TouchableOpacity>
        </View>

        {/* Chat Thread */}
        <View style={styles.thread}>
          {messages.map((m) =>
            m.role === 'user' ? (
              <View key={m.id} style={styles.userBubble}>
                <Text style={styles.userText}>{m.content}</Text>
              </View>
            ) : (
              <View key={m.id} style={styles.assistantBubble}>
                {m.pending ? (
                  <ActivityIndicator color={colors.teal} />
                ) : (
                  <>
                    <Text style={styles.assistantText}>{m.content}</Text>
                    {m.sources && m.sources.length > 0 ? (
                      <View style={styles.sourceRow}>
                        <FileText size={12} color={colors.teal} />
                        <Text style={styles.sourceText}>{m.sources[0].documentTitle}</Text>
                      </View>
                    ) : null}
                    <TouchableOpacity
                      style={styles.listenBtn}
                      onPress={() => toggleSpeech(m)}
                    >
                      {speakingId === m.id ? (
                        <Square size={12} color="#fff" fill="#fff" />
                      ) : (
                        <Volume2 size={12} color="#fff" />
                      )}
                      <Text style={styles.listenText}>
                        {speakingId === m.id ? 'Stop' : 'Listen'}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )
          )}
        </View>
      </ScrollView>

      {/* Integrated Composer Section matching mobile-chat-home.html */}
      <View style={styles.composerWrapper}>
        {/* Quick Action Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsRow}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {QUICK_ACTIONS.map((chip, i) => (
            <TouchableOpacity
              key={i}
              style={styles.chip}
              onPress={() => handleSend(chip.msg)}
            >
              <Text style={styles.chipText}>{chip.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Main Composer Box */}
        <View style={styles.composerBox}>
          <TextInput
            style={styles.composerInput}
            placeholder={isRecording ? 'Listening...' : 'Ask about your notes...'}
            placeholderTextColor={colors.inkSoft}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => handleSend(input)}
          />
          <View style={styles.crowRight}>
            {/* Mic temporarily hidden: the transcription backend is being
                migrated off DashScope and is not reachable right now. */}
            {false && (
              <TouchableOpacity
                style={[styles.iconBtnMic, isRecording && styles.iconBtnMicActive]}
                onPress={toggleRecording}
              >
                <Mic size={18} color={isRecording ? colors.danger : colors.violet} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.iconBtnSend, !input.trim() && styles.iconBtnSendDisabled]}
              onPress={() => handleSend(input)}
              disabled={!input.trim()}
            >
              <Send size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Subject Picker Modal */}
      <Modal visible={subjectModalOpen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSubjectModalOpen(false)}
        >
          <View style={styles.subjectModal}>
            <Text style={styles.modalTitle}>Switch Subject Context</Text>
            {subjects.length === 0 ? (
              <TouchableOpacity
                style={styles.subjectRowActive}
                onPress={() => setSubjectModalOpen(false)}
              >
                <Text style={styles.subjectRowText}>📘 Biology 101</Text>
                <Check size={16} color={colors.tealDark} />
              </TouchableOpacity>
            ) : (
              subjects.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.subjectRow, s.id === subject?.id && styles.subjectRowActive]}
                  onPress={() => handleSwitchSubject(s)}
                >
                  <Text style={styles.subjectRowText}>📘 {s.name}</Text>
                  {s.id === subject?.id && <Check size={16} color={colors.tealDark} />}
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity
              style={styles.addSubjectBtn}
              onPress={() => {
                setSubjectModalOpen(false);
                router.push('/(tabs)/documents');
              }}
            >
              <Text style={styles.addSubjectText}>+ Manage Subjects &amp; Notes</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 10,
    backgroundColor: colors.bg,
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.violet,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 20,
  },
  midHero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 10,
  },
  sparkIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.amberPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  greetingTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.4,
  },
  subjectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  subjectChipIcon: {
    fontSize: 13,
  },
  subjectChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  thread: {
    paddingHorizontal: 18,
    gap: 12,
    marginTop: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    backgroundColor: colors.violetPale,
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    padding: 14,
  },
  userText: {
    fontSize: 14.5,
    color: colors.ink,
    lineHeight: 20,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: colors.tealPale,
    borderRadius: radius.lg,
    borderBottomLeftRadius: 4,
    padding: 14,
  },
  assistantText: {
    fontSize: 14.5,
    color: colors.ink,
    lineHeight: 21,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  sourceText: {
    fontSize: 11,
    color: colors.inkSoft,
    fontWeight: '600',
  },
  listenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: colors.violet,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  listenText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  composerWrapper: {
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 12,
  },
  chipsRow: {
    marginBottom: 10,
  },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  composerBox: {
    marginHorizontal: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 4,
  },
  crowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtnMic: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.violetPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnMicActive: {
    backgroundColor: colors.dangerPale,
  },
  iconBtnSend: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.teal,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnSendDisabled: {
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  subjectModal: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 18,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 14,
  },
  subjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    marginBottom: 4,
  },
  subjectRowActive: {
    backgroundColor: colors.tealPale,
  },
  subjectRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  addSubjectBtn: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addSubjectText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.teal,
    textAlign: 'center',
  },
});
