import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../context/UserContext';
import { api } from '../services/api';

const AVATAR_COLORS = ['#1D9E75','#8B5CF6','#FB7185','#F59E0B','#60A5FA','#F472B6'];
const KANTONS = ['ZH', 'BE', 'SG', 'AG', 'BS'];

export default function SettingsScreen() {
  const { user, updateUser, logout } = useUser();
  const [name, setName] = useState(user?.userName || '');
  const [phone, setPhone] = useState(user?.userPhone || '');
  const [color, setColor] = useState(user?.avatarColor || AVATAR_COLORS[0]);
  const [kanton, setKanton] = useState(user?.kanton || 'ZH');
  const [saving, setSaving] = useState(false);

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
            <TextInput testID="name-input" style={s.input} value={name} onChangeText={setName} placeholder="Dein Name" placeholderTextColor="#aaa" />
            <Text style={s.label}>Telefonnummer</Text>
            <TextInput testID="phone-input" style={s.input} value={phone} onChangeText={setPhone} placeholder="+41 79 123 45 67" keyboardType="phone-pad" placeholderTextColor="#aaa" />
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

          {/* Logout */}
          <TouchableOpacity testID="logout-btn" style={s.logoutBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#E24B4A" />
            <Text style={s.logoutText}>Abmelden</Text>
          </TouchableOpacity>

          <Text style={s.versionText}>Kido v1.0 · Kido ersetzt keine rechtliche Beratung</Text>
        </ScrollView>
      </KeyboardAvoidingView>
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
  versionText: { textAlign: 'center', fontSize: 11, color: '#bbb' },
});
