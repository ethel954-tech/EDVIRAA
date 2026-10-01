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
import * as FileSystem from 'expo-file-system';
import * as Linking from 'expo-linking';
import { supabase } from '../../src/lib/supabase';
import { getActiveSubject } from '../../src/lib/subjects';
import { colors, radius } from '../../src/lib/theme';
import { AppDrawer } from '../../src/components/Drawer';
import { Menu, UploadCloud, FileText, Trash2 } from 'lucide-react-native';

export default function MobileDocumentsScreen() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [documents, setDocuments] = useState<any[]>([]);

  const failedCount = documents.filter((doc) => doc.status === 'failed').length;

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
      if (data) setDocuments(data);
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

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Session expired', 'Please log in again.');
        return;
      }

      const base64Data = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const activeSubject = await getActiveSubject();
      if (!activeSubject) {
        Alert.alert('No subject selected', 'Pick a subject first so this PDF lands where the tutor can find it.');
        return;
      }

      const documentId = Date.now().toString();
      const storagePath = `${user.id}/${documentId}.pdf`;

      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(storagePath, decodeBase64(base64Data), {
          contentType: 'application/pdf',
          upsert: true,
        });
      if (uploadErr) throw new Error(uploadErr.message);

      const { error: insertErr } = await supabase.from('documents').insert({
        student_id: user.id,
        subject_id: activeSubject.id,
        title: file.name.replace(/\.pdf$/i, ''),
        storage_path: storagePath,
        status: 'processing',
      });
      if (insertErr) throw new Error(insertErr.message);

      setDocuments((prev) => [
        { id: documentId, title: file.name, status: 'processing', created_at: new Date().toISOString() },
        ...prev,
      ]);

      fetchDocuments();
      Alert.alert('Upload Started', 'Your document is being processed by the AI pipeline.');
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

  function deleteDocument(doc: any) {
    const stillProcessing = doc.status === 'processing';
    Alert.alert(
      'Delete document?',
      stillProcessing
        ? `"${doc.title}" is still processing. Deleting now stops ingestion and removes partial data.`
        : `"${doc.title}" and its embeddings, flashcards, and quizzes will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => performDelete([doc]),
        },
      ],
    );
  }

  function deleteAllFailed() {
    if (failedCount === 0 || bulkDeleting) return;
    Alert.alert(
      'Delete all failed documents?',
      `${failedCount} failed document${failedCount === 1 ? '' : 's'} will be permanently deleted, along with any partial data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Delete ${failedCount}`,
          style: 'destructive',
          onPress: () => performDelete(documents.filter((doc) => doc.status === 'failed')),
        },
      ],
    );
  }

  async function performDelete(docs: any[]) {
    const single = docs.length === 1;
    if (single) setDeletingId(docs[0].id);
    else setBulkDeleting(true);
    try {
      // Storage first: a failure here leaves the rows visible and retryable
      // instead of orphaning the files. RLS limits removal to the user's own
      // folder; a missing object is not an error.
      const paths = docs.map((d) => d.storage_path).filter(Boolean);
      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove(paths);
        if (storageError) throw new Error(storageError.message);
      }
      // Chunks, flashcards and quizzes go with the rows via ON DELETE CASCADE.
      const ids = docs.map((d) => d.id);
      const { error: rowError, count } = await supabase
        .from('documents')
        .delete({ count: 'exact' })
        .in('id', ids);
      if (rowError) throw new Error(rowError.message);
      if (count === 0) {
        throw new Error('Documents not found - they may already have been deleted.');
      }
      setDocuments((prev) => prev.filter((d) => !ids.includes(d.id)));
    } catch (e: any) {
      const label = single
        ? `Could not delete "${docs[0].title}"`
        : 'Could not delete failed documents';
      Alert.alert('Delete Error', e.message || label);
    } finally {
      if (single) setDeletingId(null);
      else setBulkDeleting(false);
    }
  }

  function decodeBase64(base64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    const str = base64.replace(/=+$/, '');
    const bytes = new Uint8Array(Math.floor((str.length * 3) / 4));
    let u = 0;
    for (let i = 0; i < str.length; i += 4) {
      const e1 = chars.indexOf(str.charAt(i));
      const e2 = chars.indexOf(str.charAt(i + 1));
      const e3 = chars.indexOf(str.charAt(i + 2));
      const e4 = chars.indexOf(str.charAt(i + 3));
      const c1 = (e1 << 2) | (e2 >> 4);
      const c2 = ((e2 & 15) << 4) | (e3 >> 2);
      const c3 = ((e3 & 3) << 6) | e4;
      bytes[u++] = c1;
      if (e3 !== 64 && e3 !== -1) bytes[u++] = c2;
      if (e4 !== 64 && e4 !== -1) bytes[u++] = c3;
    }
    return bytes.subarray(0, u);
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

        {/* Bulk cleanup for failed ingestions */}
        {failedCount > 0 ? (
          <TouchableOpacity
            style={[styles.bulkDeleteBtn, bulkDeleting && styles.bulkDeleteBtnBusy]}
            onPress={deleteAllFailed}
            disabled={bulkDeleting}
          >
            {bulkDeleting ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Trash2 size={16} color={colors.danger} />
            )}
            <Text style={styles.bulkDeleteText}>
              Delete all failed ({failedCount})
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* Document List */}
        <Text style={styles.sectionTitle}>Your documents</Text>
        <View style={styles.docList}>
          {documents.map((doc) => (
            <View key={doc.id} style={styles.docCard}>
              <TouchableOpacity
                style={styles.docTouchable}
                onPress={() => openDocument(doc)}
                disabled={deletingId === doc.id}
              >
                <View style={styles.docIcon}>
                  <FileText size={20} color={colors.teal} />
                </View>
                <View style={styles.docMain}>
                  <Text style={styles.docTitle} numberOfLines={1}>{doc.title}</Text>
                  <Text style={styles.docSub}>
                    Status: {doc.status === 'ready' ? 'Ready' : doc.status === 'failed' ? 'Failed' : 'Processing...'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    doc.status === 'ready'
                      ? styles.statusReady
                      : doc.status === 'failed'
                        ? styles.statusFailed
                        : styles.statusProc,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      doc.status === 'ready'
                        ? styles.statusTextReady
                        : doc.status === 'failed'
                          ? styles.statusTextFailed
                          : styles.statusTextProc,
                    ]}
                  >
                    {doc.status === 'ready' ? 'Ready' : doc.status === 'failed' ? 'Failed' : 'Processing'}
                  </Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.deleteBtn, deletingId === doc.id && styles.deleteBtnBusy]}
                onPress={() => deleteDocument(doc)}
                disabled={deletingId === doc.id || bulkDeleting}
                accessibilityLabel={`Delete ${doc.title}`}
              >
                {deletingId === doc.id ? (
                  <ActivityIndicator size="small" color={colors.danger} />
                ) : (
                  <Trash2 size={18} color={colors.danger} />
                )}
              </TouchableOpacity>
            </View>
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
  bulkDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.dangerPale,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 10,
    marginBottom: 20,
  },
  bulkDeleteBtnBusy: { opacity: 0.7 },
  bulkDeleteText: { fontSize: 13, fontWeight: '700', color: colors.danger },
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
    gap: 8,
  },
  docTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnBusy: { opacity: 0.6 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  statusReady: { backgroundColor: colors.tealPale },
  statusProc: { backgroundColor: colors.violetPale },
  statusFailed: { backgroundColor: colors.dangerPale },
  statusText: { fontSize: 11, fontWeight: '700' },
  statusTextReady: { color: colors.tealDark },
  statusTextProc: { color: colors.violet },
  statusTextFailed: { color: colors.danger },
});
