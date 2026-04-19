import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../context/UserContext';
import { api } from '../services/api';

const AVATAR_COLORS = ['#1D9E75','#8B5CF6','#FB7185','#F59E0B','#60A5FA','#F472B6'];
const KANTONS = ['ZH', 'BE', 'SG', 'AG', 'BS'];

export default function SettingsScreen() {
  const { user, setUser, updateUser, logout } = useUser();
  const [name, setName] = useState(user?.userName || '');
  const [phone, setPhone] = useState(user?.userPhone || '');
  const [color, setColor] = useState(user?.avatarColor || AVATAR_COLORS[0]);
  const [kanton, setKanton] = useState(user?.kanton || 'ZH');
  const [saving, setSaving] = useState(false);
  const [switchModal, setSwitchModal] = useState(false);
  const [chainMembers, setChainMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const isTestChain = !!user?.userPhone?.startsWith('+41 79 001 00 ');

  const handleOpenSwitch = async () => {
    if (!user?.chainId) return;
    setSwitchModal(true);
    setLoadingMembers(true);
    try {
      const chain = await api.getChain(user.chainId);
      setChainMembers(chain.members || []);
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Mitglieder konnten nicht geladen werden.');
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleSwitchTo = async (m: any) => {
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/users/${m.user_id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const userDoc = await res.json();
      await setUser({
        userId: m.user_id,
        userName: m.user_name,
        userPhone: userDoc.phone || '',
        avatarColor: m.avatar_color,
        chainId: user!.chainId,
        chainMemberId: m.id,
        chainName: user!.chainName,
        kanton: userDoc.kanton || 'ZH',
        prefsSet: true,
      });
      setSwitchModal(false);
      router.replace('/(tabs)/home');
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Wechsel fehlgeschlagen.');
    }
  };

  const handleResetTestChain = () => {
    Alert.alert(
      'Test-Kette zurücksetzen?',
      'Alle Stimmen, Plan-Änderungen, Präferenzen, Ferienwünsche und Nachrichten der Test-Kette werden gelöscht und auf den Ursprungszustand zurückgesetzt. Du bleibst als dieselbe Person eingeloggt.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Zurücksetzen',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const data = await api.seedTestChain();
              // Find current user in new seed by matching name (phone also unique)
              const myNew = data.members.find((m: any) => m.phone === user?.userPhone);
              if (myNew) {
                await setUser({
                  userId: myNew.user_id,
                  userName: myNew.user_name,
                  userPhone: myNew.phone,
                  avatarColor: myNew.avatar_color,
                  chainId: myNew.chain_id,
                  chainMemberId: myNew.member_id,
                  chainName: myNew.chain_name,
                  kanton: myNew.kanton || 'ZH',
                  prefsSet: true,
                });
              }
              Alert.alert('Erledigt', 'Test-Kette wurde auf den Ursprungszustand zurückgesetzt.');
              router.replace('/(tabs)/home');
            } catch (e: any) {
              Alert.alert('Fehler', e.message || 'Zurücksetzen fehlgeschlagen.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Pflichtfeld', 'Bitte Namen eingeben.'); return; }
    setSaving(true);
    try {
      if (user?.userId) {
        await api.updateUser(user.userId, { name: name.trim(), phone: phone.trim(), avatar_color: color, kanton });
      }
      await updateUser({ userName: name.trim(), userPhone: phone.trim(), avatarColor: color, kanton });
      Alert.alert('Gespeichert', 'Deine Einstellungen wurden gespeichert.');
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Konnte nicht gespeichert werden.');
    } finally { setSaving(false); }
  };

  const handleLogout = () => {
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: async () => { await logout(); router.replace('/'); } },
    ]);
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity testID="back-btn" style={s.backBtn} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#1A1C1B" />
            </TouchableOpacity>
            <Text style={s.pageTitle}>Einstellungen</Text>
          </View>

          {/* Profile */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Profil</Text>
            <View style={s.avatarRow}>
              <View style={[s.bigAvatar, { backgroundColor: color }]}>
                <Text style={s.bigAvatarText}>{name ? name[0].toUpperCase() : '?'}</Text>
              </View>
              <View style={s.colorPicker}>
                {AVATAR_COLORS.map(c => (
                  <TouchableOpacity key={c} testID={`color-pick-${c}`} style={[s.colorDot, { backgroundColor: c }, color === c && s.colorDotActive]} onPress={() => setColor(c)}>
                    {color === c && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Text style={s.label}>Name</Text>
            <TextInput testID="settings-name-input" style={s.input} value={name} onChangeText={setName} placeholder="Dein Name" placeholderTextColor="#aaa" />
            <Text style={s.label}>Telefonnummer</Text>
            <TextInput testID="settings-phone-input" style={s.input} value={phone} onChangeText={setPhone} placeholder="+41 79 123 45 67" keyboardType="phone-pad" placeholderTextColor="#aaa" />
          </View>

          {/* Kanton */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Kanton</Text>
            <Text style={s.sectionSub}>Beeinflusst den Schulferienkalender</Text>
            <View style={s.kantonRow}>
              {KANTONS.map(k => (
                <TouchableOpacity key={k} testID={`kanton-${k}`} style={[s.kantonBtn, kanton === k && s.kantonBtnActive]} onPress={() => setKanton(k)}>
                  <Text style={[s.kantonText, kanton === k && s.kantonTextActive]}>{k}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Info */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Kette</Text>
            <View style={s.infoRow}>
              <Ionicons name="people-outline" size={18} color="#6E7170" />
              <Text style={s.infoText}>{user?.chainName}</Text>
            </View>
            <View style={s.infoRow}>
              <Ionicons name="phone-portrait-outline" size={18} color="#6E7170" />
              <Text style={s.infoText}>{user?.userPhone}</Text>
            </View>
          </View>

          {/* Save Button */}
          <TouchableOpacity testID="save-settings-btn" style={[s.saveBtn, saving && { opacity: 0.7 }]} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Speichern</Text>}
          </TouchableOpacity>

          {/* Test Chain – Switch Member */}
          {isTestChain && (
            <>
              <TouchableOpacity testID="switch-member-btn" style={s.switchBtn} onPress={handleOpenSwitch}>
                <Ionicons name="swap-horizontal-outline" size={20} color="#1D9E75" />
                <Text style={s.switchText}>Zu anderem Kettenmitglied wechseln (Test)</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="reset-test-chain-btn" style={s.resetBtn} onPress={handleResetTestChain} disabled={saving}>
                <Ionicons name="refresh-outline" size={20} color="#BA7517" />
                <Text style={s.resetText}>Test-Kette auf Ursprungszustand zurücksetzen</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Logout */}
          <TouchableOpacity testID="logout-btn" style={s.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#E24B4A" />
            <Text style={s.logoutText}>Abmelden</Text>
          </TouchableOpacity>

          <Text style={s.versionText}>Kido v1.0 · Kido ersetzt keine rechtliche Beratung</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Member Switcher Modal */}
      <Modal visible={switchModal} animationType="slide" transparent onRequestClose={() => setSwitchModal(false)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Mitglied wechseln</Text>
              <TouchableOpacity onPress={() => setSwitchModal(false)} testID="close-switch-modal">
                <Ionicons name="close" size={24} color="#6E7170" />
              </TouchableOpacity>
            </View>
            {loadingMembers ? (
              <View style={{ padding: 40, alignItems: 'center' }}>
                <ActivityIndicator color="#1D9E75" size="large" />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
                {chainMembers.map((m: any) => {
                  const isCurrent = m.id === user?.chainMemberId;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      testID={`switch-to-${m.user_name.replace(/\s/g, '')}`}
                      style={[s.memberRow, isCurrent && { backgroundColor: '#F0FBF7', borderColor: '#1D9E75' }]}
                      onPress={() => !isCurrent && handleSwitchTo(m)}
                      disabled={isCurrent}
                    >
                      <View style={[s.memberAvatar, { backgroundColor: m.avatar_color }]}>
                        <Text style={s.memberAvatarText}>{m.user_name[0]}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.memberName}>{m.user_name}</Text>
                        <Text style={s.memberMeta}>
                          {m.current_logic === 'even' ? 'Gerade' : 'Ungerade'} · {m.flex_level} · {m.court_ruling}
                        </Text>
                      </View>
                      {isCurrent
                        ? <Text style={s.currentTag}>aktuell</Text>
                        : <Ionicons name="chevron-forward" size={20} color="#6E7170" />
                      }
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#1A1C1B' },
  section: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1C1B', marginBottom: 4 },
  sectionSub: { fontSize: 12, color: '#6E7170', marginBottom: 12 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  bigAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  bigAvatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
  colorPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
  colorDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  colorDotActive: { borderColor: '#1A1C1B', borderWidth: 3 },
  label: { fontSize: 13, fontWeight: '600', color: '#1A1C1B', marginBottom: 6, marginTop: 4 },
  input: { borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 10, padding: 12, fontSize: 15, color: '#1A1C1B', marginBottom: 8 },
  kantonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kantonBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F0F2F1' },
  kantonBtnActive: { backgroundColor: '#1D9E75' },
  kantonText: { fontSize: 13, fontWeight: '600', color: '#6E7170' },
  kantonTextActive: { color: '#fff' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0F2F1' },
  infoText: { fontSize: 14, color: '#6E7170' },
  saveBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#FCEBEB', borderRadius: 10, paddingVertical: 14, marginBottom: 24, backgroundColor: '#FCEBEB' },
  logoutText: { color: '#E24B4A', fontWeight: '600', fontSize: 16 },
  switchBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#1D9E75', borderStyle: 'dashed', borderRadius: 10, paddingVertical: 12, marginBottom: 8, backgroundColor: '#F0FBF7' },
  switchText: { color: '#1D9E75', fontWeight: '600', fontSize: 14 },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#F4C27A', borderStyle: 'dashed', borderRadius: 10, paddingVertical: 12, marginBottom: 12, backgroundColor: '#FAEEDA' },
  resetText: { color: '#BA7517', fontWeight: '600', fontSize: 14 },
  versionText: { textAlign: 'center', fontSize: 11, color: '#bbb' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 19, fontWeight: '700', color: '#1A1C1B' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E5E8E7' },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  memberName: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  memberMeta: { fontSize: 11, color: '#6E7170', marginTop: 2 },
  currentTag: { fontSize: 11, fontWeight: '700', color: '#1D9E75', backgroundColor: '#E1F5EE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
});
