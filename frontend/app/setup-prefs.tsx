import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { useUser } from '../context/UserContext';

const COURT_OPTIONS = [
  { value: 'court_flex', label: 'Flexibel', desc: 'Urteil erlaubt Anpassungen' },
  { value: 'court_reluctant', label: 'Ungern', desc: 'Urteil eher starr, Änderungen möglich' },
  { value: 'court_strict', label: 'Strikt', desc: 'Urteil ist bindend' },
  { value: 'no_court', label: 'Kein Urteil', desc: 'Keine gerichtliche Regelung' },
];

const LOGIC_OPTIONS = [
  { value: 'even', label: 'Gerade Wochen', desc: 'KW 2, 4, 6 ...' },
  { value: 'odd', label: 'Ungerade Wochen', desc: 'KW 1, 3, 5 ...' },
  { value: 'custom', label: 'Individuell', desc: 'Eigene Vereinbarung' },
];

const FLEX_OPTIONS = [
  { value: 'yes', label: 'Sehr flexibel', desc: 'Kann jederzeit wechseln', score: 5 },
  { value: 'rel', label: 'Relativ flexibel', desc: 'Wechsel möglich, ungern', score: 3 },
  { value: 'disc', label: 'Diskutierbar', desc: 'Kommt auf den Fall an', score: 2 },
  { value: 'temp', label: 'Temporär', desc: 'Nur für begrenzte Zeit', score: 2 },
  { value: 'no', label: 'Unflexibel', desc: 'Wechsel nicht möglich', score: 1 },
  { value: 'ext', label: 'Externe Einschränkung', desc: 'Arbeit / Gesundheit / Pflege', score: 0 },
];

export default function SetupPrefsScreen() {
  const { user, updateUser } = useUser();
  const [court, setCourt] = useState('no_court');
  const [logic, setLogic] = useState('even');
  const [flex, setFlex] = useState('disc');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!user?.chainMemberId) {
      Alert.alert('Fehler', 'Kein Mitglied gefunden.');
      return;
    }
    setLoading(true);
    try {
      await api.updatePreferences(user.chainMemberId, {
        court_ruling: court,
        current_logic: logic,
        flex_level: flex,
      });
      await updateUser({ prefsSet: true });
      router.replace('/(tabs)/home');
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Präferenzen konnten nicht gespeichert werden.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <View style={s.headerRow}>
            <View style={s.logoSmall}>
              <Text style={s.logoLetter}>K</Text>
            </View>
            <View>
              <Text style={s.title}>Deine Präferenzen</Text>
              <Text style={s.sub}>Nur du siehst diese Angaben – nicht die anderen.</Text>
            </View>
          </View>

          <View style={s.privacyBanner}>
            <Ionicons name="lock-closed-outline" size={16} color="#1D9E75" />
            <Text style={s.privacyText}>Diese Informationen sind privat. Kido nutzt sie nur für die Berechnung.</Text>
          </View>

          {/* Court Ruling */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Gerichtsurteil</Text>
            <Text style={s.sectionSub}>Gibt es eine gerichtliche Regelung für die Betreuungszeiten?</Text>
            {COURT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                testID={`court-${opt.value}`}
                style={[s.optionRow, court === opt.value && s.optionRowActive]}
                onPress={() => setCourt(opt.value)}
              >
                <View style={[s.radio, court === opt.value && s.radioActive]}>
                  {court === opt.value && <View style={s.radioInner} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optionLabel, court === opt.value && { color: '#1D9E75' }]}>{opt.label}</Text>
                  <Text style={s.optionDesc}>{opt.desc}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Logic */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Aktuelle Wochenendlogik</Text>
            <Text style={s.sectionSub}>Nach welchem Rhythmus bist du aktuell mit den Kindern?</Text>
            {LOGIC_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                testID={`logic-${opt.value}`}
                style={[s.optionRow, logic === opt.value && s.optionRowActive]}
                onPress={() => setLogic(opt.value)}
              >
                <View style={[s.radio, logic === opt.value && s.radioActive]}>
                  {logic === opt.value && <View style={s.radioInner} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optionLabel, logic === opt.value && { color: '#1D9E75' }]}>{opt.label}</Text>
                  <Text style={s.optionDesc}>{opt.desc}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Flex Level */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Bereitschaft zur Änderung</Text>
            <Text style={s.sectionSub}>Wie flexibel bist du, wenn Kido eine Änderung vorschlägt?</Text>
            {FLEX_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                testID={`flex-${opt.value}`}
                style={[s.optionRow, flex === opt.value && s.optionRowActive]}
                onPress={() => setFlex(opt.value)}
              >
                <View style={[s.radio, flex === opt.value && s.radioActive]}>
                  {flex === opt.value && <View style={s.radioInner} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optionLabel, flex === opt.value && { color: '#1D9E75' }]}>{opt.label}</Text>
                  <Text style={s.optionDesc}>{opt.desc}</Text>
                </View>
                <View style={[s.scoreChip, { backgroundColor: opt.score >= 3 ? '#E1F5EE' : opt.score >= 1 ? '#FAEEDA' : '#FCEBEB' }]}>
                  <Text style={[s.scoreText, { color: opt.score >= 3 ? '#1D9E75' : opt.score >= 1 ? '#BA7517' : '#E24B4A' }]}>{opt.score}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            testID="save-prefs-btn"
            style={[s.primaryBtn, loading && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                <Text style={s.primaryBtnText}>Weiter zur Übersicht</Text>
                <Ionicons name="arrow-forward" size={20} color="#fff" />
              </>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 24, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  logoSmall: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  logoLetter: { fontSize: 24, fontWeight: '800', color: '#fff' },
  title: { fontSize: 20, fontWeight: '700', color: '#1A1C1B' },
  sub: { fontSize: 13, color: '#6E7170' },
  privacyBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E1F5EE', borderRadius: 10, padding: 12, marginBottom: 24 },
  privacyText: { flex: 1, fontSize: 13, color: '#1D9E75', lineHeight: 18 },
  section: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1A1C1B', marginBottom: 4 },
  sectionSub: { fontSize: 13, color: '#6E7170', marginBottom: 14, lineHeight: 18 },
  optionRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E5E8E7', gap: 12 },
  optionRowActive: { borderColor: '#1D9E75', backgroundColor: '#F0FBF7' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#E5E8E7', alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: '#1D9E75' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1D9E75' },
  optionLabel: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  optionDesc: { fontSize: 12, color: '#6E7170', marginTop: 1 },
  scoreChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  scoreText: { fontSize: 12, fontWeight: '600' },
  primaryBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 17 },
});
