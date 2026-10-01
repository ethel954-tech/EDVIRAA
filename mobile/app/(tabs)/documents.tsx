import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import { supabase } from '../../src/lib/supabase';
import { getActiveSubject, type Subject } from '../../src/lib/subjects';
import { uploadAndProcessPdf, pollDocumentStatus } from '../../src/lib/documentUpload';
import { colors, radius } from '../../src/lib/theme';
import { AppDrawer } from '../../src/components/Drawer';
import { Menu, UploadCloud, FileText } from 'lucide-react-native';

export default function MobileDocumentsScreen() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);

  useEffect(() => {
    fetchDocuments();
  }, []);

  async function fetchDocuments() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('documents')
        .select('id, title, status, storage_path, created_at')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (data && data.length > 0) setDocuments(data);
    } catch {
      // keep list empty on failure
    }
  }

  async function pickAndUploadDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const file = result.assets[0];
      setUploading(true);

      const activeSubject = await getActiveSubject();

      const outcome = await uploadAndProcessPdf({
        uri: file.uri,
        name: file.name || 'document.pdf',
        size: file.size ?? 0,
        mimeType: file.mimeType,
        resolveSubject: async () => activeSubject as Subject | null,
      });

      if (!outcome.ok) {
        Alert.alert('Upload Error', outcome.error);
        return;
      }

      fetchDocuments();
      Alert.alert('Upload Started', 'Your document is being processed by the AI pipeline.');

      // Flip the row's badge when processing finishes (best effort).
      void pollDocumentStatus(outcome.documentId, () => false).then((final) => {
        if (final === 'ready' || final === 'failed') fetchDocuments();
      });
    } catch (e: any) {
      Alert.alert('Upload Error', e.message || 'Could not upload PDF.');
    } finally {
      setUploading(false);
    }
  }

  async function openDocument(doc: any) {
    try {
      if (!doc.storage_path) {
        Alert.alert('Not available yet', 'This document has no uploaded file to open.');
        return;
      }
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.storage_path, 60 * 10);
      if (error || !data) {
        Alert.alert('Could not open', error?.message || 'No URL for this document.');
        return;
      }
      await Linking.openURL(data.signedUrl);
    } catch (e: any) {
      Alert.alert('Could not open', e?.message || 'Unexpected error opening document.');
    }
  }

  return (
    <View style={styles.outerContainer}>
      <AppDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.menuBtn} onPress={() => setDrawerOpen(true)}>
            <Menu size={24} color={colors.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Subjects &amp; Notes</Text>
            <Text style={styles.sub}>Upload PDFs to power your AI tutor &amp; study hub</Text>
          </View>
        </View>

        {/* Upload Zone Button */}
        <TouchableOpacity
          style={styles.uploadZone}
          onPress={pickAndUploadDocument}
          disabled={uploading}
        >
          <View style={styles.uploadIconBadge}>
            {uploading ? (
              <ActivityIndicator color={colors.teal} />
            ) : (
              <UploadCloud size={24} color={colors.teal} />
            )}
          </View>
          <Text style={styles.uploadTitle}>
            {uploading ? 'Uploading PDF...' : 'Tap to select PDF document'}
          </Text>
          <Text style={styles.uploadSub}>PDF files up to 50 MB</Text>
        </TouchableOpacity>

        {/* Document List */}
        <Text style={styles.sectionTitle}>Your documents</Text>
        <View style={styles.docList}>
          {documents.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={styles.docCard}
              onPress={() => openDocument(doc)}
            >
              <View style={styles.docIcon}>
                <FileText size={20} color={colors.teal} />
              </View>
              <View style={styles.docMain}>
                <Text style={styles.docTitle}>{doc.title}</Text>
                <Text style={styles.docSub}>
                  Status: {doc.status === 'ready' ? 'Ready' : 'Processing...'}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  doc.status === 'ready' ? styles.statusReady : styles.statusProc,
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    doc.status === 'ready' ? styles.statusTextReady : styles.statusTextProc,
                  ]}
                >
                  {doc.status === 'ready' ? 'Ready' : 'Processing'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  content: { padding: 18, paddingTop: 54, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
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
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
  uploadZone: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  uploadIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.tealPale,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  uploadTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  uploadSub: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  docList: { gap: 10 },
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    gap: 12,
  },
  docIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.tealPale,
    justifyContent: 'center',
    alignItems: 'center',
  },
  docMain: { flex: 1 },
  docTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  docSub: { fontSize: 11, color: colors.inkSoft, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  statusReady: { backgroundColor: colors.tealPale },
  statusProc: { backgroundColor: colors.violetPale },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusTextReady: { color: colors.tealDark },
  statusTextProc: { color: colors.violet },
});
