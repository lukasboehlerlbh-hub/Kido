import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { useUser } from '../context/UserContext';

const AVATAR_COLORS = ['#1D9E75','#8B5CF6','#FB7185','#F59E0B','#60A5FA','#F472B6'];

type Mode = 'select' | 'create' | 'join';

export default function OnboardingScreen() {
  const { token: urlToken } = useLocalSearchParams<{ token?: string }>();
  const { setUser } = useUser();

  const [mode, setMode] = useState<Mode>(urlToken ? 'join' : 'select');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [chainName, setChainName] = useState('');
  const [token, setToken] = useState(urlToken || '');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [invInfo, setInvInfo] = useState<any>(null);

  const lookupToken = async () => {
    if (!token.trim()) return;
    try {
      const inv = await api.getInvitation(token.trim().toUpperCase());
      setInvInfo(inv);
    } catch {
      Alert.alert('Fehler', 'Einladung nicht gefunden. Bitte Token prüfen.');
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Pflichtfelder', 'Bitte Name und Telefonnummer eingeben.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.createChain({
        user_name: name.trim(),
        user_phone: phone.trim(),
        avatar_color: selectedColor,
        chain_name: chainName.trim() || undefined,
      });
      await setUser({
        userId: result.user_id,
        userName: result.user_name,
        userPhone: phone.trim(),
        avatarColor: selectedColor,
        chainId: result.chain_id,
        chainMemberId: result.member_id,
        chainName: result.chain_name,
        kanton: 'ZH',
        prefsSet: false,
      });
      router.replace('/setup-prefs');
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Kette konnte nicht erstellt werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!name.trim() || !phone.trim() || !token.trim()) {
      Alert.alert('Pflichtfelder', 'Bitte alle Felder ausfüllen.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.acceptInvitation(token.trim().toUpperCase(), {
        user_name: name.trim(),
        user_phone: phone.trim(),
        avatar_color: selectedColor,
      });
      await setUser({
        userId: result.user_id,
        userName: result.user_name,
        userPhone: phone.trim(),
        avatarColor: selectedColor,
        chainId: result.chain_id,
        chainMemberId: result.member_id,
        chainName: result.chain_name,
        kanton: 'ZH',
        prefsSet: false,
      });
      router.replace('/setup-prefs');
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Einladung konnte nicht angenommen werden.');
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'select') {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.selectContainer}>
          <TouchableOpacity testID="back-btn" style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#1A1C1B" />
          </TouchableOpacity>
          <View style={s.logoSmall}>
            <Text style={s.logoLetter}>K</Text>
          </View>
          <Text style={s.selectTitle}>Wie möchtest du starten?</Text>
          <Text style={s.selectSub}>Starte eine neue Elternkette oder tritt einer bestehenden bei.</Text>

          <TouchableOpacity testID="create-chain-btn" style={s.optionCard} onPress={() => setMode('create')}>
            <View style={[s.optionIcon, { backgroundColor: '#E1F5EE' }]}>
              <Ionicons name="add-circle-outline" size={28} color="#1D9E75" />
            </View>
            <View style={s.optionText}>
              <Text style={s.optionTitle}>Neue Kette gründen</Text>
              <Text style={s.optionDesc}>Du bist Host und lädst andere ein.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6E7170" />
          </TouchableOpacity>

          <TouchableOpacity testID="join-chain-btn" style={s.optionCard} onPress={() => setMode('join')}>
            <View style={[s.optionIcon, { backgroundColor: '#F0ECFF' }]}>
              <Ionicons name="link-outline" size={28} color="#8B5CF6" />
            </View>
            <View style={s.optionText}>
              <Text style={s.optionTitle}>Einladung annehmen</Text>
              <Text style={s.optionDesc}>Du hast einen Token erhalten.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6E7170" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity testID="back-mode-btn" style={s.backBtn} onPress={() => setMode('select')}>
            <Ionicons name="arrow-back" size={24} color="#1A1C1B" />
          </TouchableOpacity>

          <Text style={s.formTitle}>
            {mode === 'create' ? 'Neue Kette gründen' : 'Einladung annehmen'}
          </Text>
          <Text style={s.formSub}>
            {mode === 'create'
              ? 'Gib deine Daten ein. Du kannst danach Kettenglieder einladen.'
              : 'Gib deinen Einladungs-Token und deine Daten ein.'}
          </Text>

          {mode === 'join' && (
            <View style={s.section}>
              <Text style={s.label}>Einladungs-Token</Text>
              <View style={s.tokenRow}>
                <TextInput
                  testID="token-input"
                  style={[s.input, { flex: 1 }]}
                  placeholder="Z.B. AB3K7XQW"
                  value={token}
                  onChangeText={t => { setToken(t.toUpperCase()); setInvInfo(null); }}
                  autoCapitalize="characters"
                  placeholderTextColor="#aaa"
                />
                <TouchableOpacity testID="lookup-token-btn" style={s.lookupBtn} onPress={lookupToken}>
                  <Ionicons name="search" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              {invInfo && (
                <View style={s.invInfoCard}>
                  <Ionicons name="checkmark-circle" size={18} color="#1D9E75" />
                  <Text style={s.invInfoText}>Kette gefunden: <Text style={{ fontWeight: '600' }}>{invInfo.chain_name}</Text></Text>
                </View>
              )}
            </View>
          )}

          {mode === 'create' && (
            <View style={s.section}>
              <Text style={s.label}>Kettenname (optional)</Text>
              <TextInput
                testID="chain-name-input"
                style={s.input}
                placeholder="Z.B. Familie Müller"
                value={chainName}
                onChangeText={setChainName}
                placeholderTextColor="#aaa"
              />
            </View>
          )}

          <View style={s.section}>
            <Text style={s.label}>Dein Name</Text>
            <TextInput
              testID="name-input"
              style={s.input}
              placeholder="Vorname"
              value={name}
              onChangeText={setName}
              placeholderTextColor="#aaa"
            />
          </View>

          <View style={s.section}>
            <Text style={s.label}>Telefonnummer</Text>
            <TextInput
              testID="phone-input"
              style={s.input}
              placeholder="+41 79 123 45 67"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholderTextColor="#aaa"
            />
          </View>

          <View style={s.section}>
            <Text style={s.label}>Avatar-Farbe</Text>
            <View style={s.colorRow}>
              {AVATAR_COLORS.map(c => (
                <TouchableOpacity
                  key={c}
                  testID={`color-${c}`}
                  style={[s.colorDot, { backgroundColor: c }, selectedColor === c && s.colorDotSelected]}
                  onPress={() => setSelectedColor(c)}
                >
                  {selectedColor === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.previewRow}>
              <View style={[s.avatarPreview, { backgroundColor: selectedColor }]}>
                <Text style={s.avatarPreviewText}>{name ? name[0].toUpperCase() : '?'}</Text>
              </View>
              <Text style={s.previewLabel}>Vorschau</Text>
            </View>
          </View>

          <TouchableOpacity
            testID="submit-btn"
            style={[s.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={mode === 'create' ? handleCreate : handleJoin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.primaryBtnText}>{mode === 'create' ? 'Kette starten' : 'Beitreten'}</Text>
            }
          </TouchableOpacity>

          <View style={s.privacyNote}>
            <Ionicons name="lock-closed-outline" size={14} color="#6E7170" />
            <Text style={s.privacyText}>Niemand sieht die Angaben der anderen – nur das Ergebnis.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 24, paddingBottom: 48 },
  selectContainer: { flex: 1, padding: 24 },
  backBtn: { marginBottom: 16, width: 40, height: 40, justifyContent: 'center' },
  logoSmall: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoLetter: { fontSize: 26, fontWeight: '800', color: '#fff' },
  selectTitle: { fontSize: 24, fontWeight: '700', color: '#1A1C1B', marginBottom: 8 },
  selectSub: { fontSize: 14, color: '#6E7170', marginBottom: 32, lineHeight: 20 },
  optionCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  optionIcon: { width: 52, height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  optionText: { flex: 1 },
  optionTitle: { fontSize: 16, fontWeight: '600', color: '#1A1C1B', marginBottom: 3 },
  optionDesc: { fontSize: 13, color: '#6E7170' },
  formTitle: { fontSize: 22, fontWeight: '700', color: '#1A1C1B', marginBottom: 8 },
  formSub: { fontSize: 14, color: '#6E7170', marginBottom: 24, lineHeight: 20 },
  section: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#1A1C1B', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 12, padding: 14, backgroundColor: '#fff', fontSize: 15, color: '#1A1C1B' },
  tokenRow: { flexDirection: 'row', gap: 8 },
  lookupBtn: { backgroundColor: '#1D9E75', borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  invInfoCard: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: '#E1F5EE', borderRadius: 8, padding: 10 },
  invInfoText: { fontSize: 13, color: '#1A1C1B' },
  colorRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  colorDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  colorDotSelected: { borderColor: '#1A1C1B', borderWidth: 3 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarPreview: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarPreviewText: { fontSize: 18, fontWeight: '700', color: '#fff' },
  previewLabel: { fontSize: 13, color: '#6E7170' },
  primaryBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 8, marginBottom: 16 },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 17 },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  privacyText: { fontSize: 12, color: '#6E7170' },
});
