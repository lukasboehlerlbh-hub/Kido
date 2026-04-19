import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView,
  Modal, ActivityIndicator, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../context/UserContext';
import { api } from '../services/api';

const FEATURES = [
  { icon: 'shield-checkmark-outline', title: 'Privat', desc: 'Niemand sieht die Antworten der anderen – nur das Ergebnis.' },
  { icon: 'people-outline', title: 'Einladung', desc: 'Kettenglieder per Link einladen.' },
  { icon: 'heart-outline', title: 'Kido', desc: 'Mediator, kein Richter. Warmherzig, nie urteilend.' },
  { icon: 'bulb-outline', title: 'Intelligent', desc: 'Automatische Konfliktlösung nach euren Vorgaben.' },
];

export default function WelcomeScreen() {
  const { user, loading, setUser } = useUser();
  const [testChainModal, setTestChainModal] = useState(false);
  const [seedData, setSeedData] = useState<any>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!loading && user?.prefsSet) {
      router.replace('/(tabs)/home');
    } else if (!loading && user && !user.prefsSet) {
      router.replace('/setup-prefs');
    }
  }, [user, loading]);

  const handleLoadTestChain = async () => {
    setSeeding(true);
    try {
      const data = await api.seedTestChain();
      setSeedData(data);
      setTestChainModal(true);
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Testkette konnte nicht geladen werden.');
    } finally {
      setSeeding(false);
    }
  };

  const handleSelectMember = async (m: any) => {
    await setUser({
      userId: m.user_id,
      userName: m.user_name,
      userPhone: m.phone,
      avatarColor: m.avatar_color,
      chainId: m.chain_id,
      chainMemberId: m.member_id,
      chainName: m.chain_name,
      kanton: m.kanton || 'ZH',
      prefsSet: true,
    });
    setTestChainModal(false);
    router.replace('/(tabs)/home');
  };

  if (loading) {
    return (
      <View style={s.loading}>
        <View style={s.logoCircle}>
          <Text style={s.logoLetter}>K</Text>
        </View>
        <Text style={s.loadingText}>Kido</Text>
      </View>
    );
  }

  if (user) return null;

  const COURT_LABELS: Record<string, string> = {
    no_court: 'Kein Urteil',
    court_willing: 'Urteil – flexibel',
    court_no_logic: 'Urteil – keine Logik',
    court_strict: 'Urteil – strikt',
  };
  const FLEX_LABELS: Record<string, string> = {
    yes: 'Sehr flexibel', rel: 'Relativ flexibel', disc: 'Diskutierbar',
    temp: 'Temporär', no: 'Unflexibel', ext: 'Extern',
  };

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={s.logoCircle}>
            <Text style={s.logoLetter}>K</Text>
          </View>
          <Text style={s.appName}>Kido</Text>
          <Text style={s.tagline}>Co-Parenting. Einfach. Menschlich.</Text>
        </View>

        <View style={s.quoteCard}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#1D9E75" style={{ marginBottom: 8 }} />
          <Text style={s.quoteText}>
            &quot;Kinder profitieren am meisten, wenn ihre Eltern genug Raum haben, um Energie zu tanken – und danach mit voller Kraft wieder für sie da zu sein.&quot;
          </Text>
        </View>

        <View style={s.featuresGrid}>
          {FEATURES.map((f, i) => (
            <View key={i} style={s.featureCard}>
              <View style={s.featureIcon}>
                <Ionicons name={f.icon as any} size={22} color="#1D9E75" />
              </View>
              <Text style={s.featureTitle}>{f.title}</Text>
              <Text style={s.featureDesc}>{f.desc}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity testID="get-started-btn" style={s.primaryBtn} onPress={() => router.push('/intro')}>
          <Text style={s.primaryBtnText}>Loslegen</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>

        {/* Test Chain Loader */}
        <TouchableOpacity
          testID="load-test-chain-btn"
          style={s.testBtn}
          onPress={handleLoadTestChain}
          disabled={seeding}
        >
          {seeding
            ? <ActivityIndicator color="#1D9E75" size="small" />
            : <Ionicons name="flask-outline" size={18} color="#1D9E75" />
          }
          <Text style={s.testBtnText}>Test-Kette (6 Personen) laden</Text>
        </TouchableOpacity>
        <Text style={s.testHint}>Für Demo/Test: 6 Mitglieder, vordefinierter lösbarer Konflikt.</Text>

        <Text style={s.disclaimer}>Kido ersetzt keine rechtliche Beratung.</Text>
      </ScrollView>

      {/* Member Picker Modal */}
      <Modal visible={testChainModal} animationType="slide" transparent onRequestClose={() => setTestChainModal(false)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Als welche Person einloggen?</Text>
              <TouchableOpacity onPress={() => setTestChainModal(false)} testID="close-member-picker">
                <Ionicons name="close" size={24} color="#6E7170" />
              </TouchableOpacity>
            </View>

            {seedData && (
              <>
                <View style={s.scenarioCard}>
                  <Ionicons name="information-circle-outline" size={18} color="#1D9E75" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.scenarioTitle}>Szenario: {seedData.conflict_scenario === 'ungern' ? 'Lösbar (ungern)' : seedData.conflict_scenario}</Text>
                    <Text style={s.scenarioDesc}>
                      Kido schlägt vor, dass <Text style={{ fontWeight: '700' }}>{seedData.pivot_member_name}</Text> die Logik wechselt. Alle müssen abstimmen.
                    </Text>
                  </View>
                </View>

                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  {seedData.members.map((m: any) => (
                    <TouchableOpacity
                      key={m.user_id}
                      testID={`select-member-${m.phone_suffix || m.user_name.replace(/\s/g,'')}`}
                      style={s.memberRow}
                      onPress={() => handleSelectMember(m)}
                    >
                      <View style={[s.memberAvatar, { backgroundColor: m.avatar_color }]}>
                        <Text style={s.memberAvatarText}>{m.user_name[0]}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={s.memberName}>{m.user_name}</Text>
                          {m.is_host && (
                            <View style={s.hostBadge}><Text style={s.hostBadgeText}>Host</Text></View>
                          )}
                          {seedData.pivot_member_name === m.user_name && (
                            <View style={s.pivotBadge}><Text style={s.pivotBadgeText}>Pivot</Text></View>
                          )}
                        </View>
                        <Text style={s.memberMeta}>
                          {m.logic === 'even' ? 'Gerade' : 'Ungerade'} Wochen · {FLEX_LABELS[m.flex] || m.flex} · {COURT_LABELS[m.court] || m.court}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#6E7170" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  loading: { flex: 1, backgroundColor: '#F7F9F8', alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 24, fontWeight: '600', color: '#1D9E75' },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { alignItems: 'center', paddingTop: 24, paddingBottom: 28 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center', marginBottom: 14, shadowColor: '#1D9E75', shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 },
  logoLetter: { fontSize: 40, fontWeight: '800', color: '#fff' },
  appName: { fontSize: 30, fontWeight: '700', color: '#1A1C1B', marginBottom: 6 },
  tagline: { fontSize: 15, color: '#6E7170' },
  quoteCard: { backgroundColor: '#E1F5EE', borderRadius: 14, padding: 18, marginBottom: 24, alignItems: 'center' },
  quoteText: { fontSize: 14, color: '#1D9E75', lineHeight: 22, fontStyle: 'italic', textAlign: 'center' },
  featuresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 32 },
  featureCard: { backgroundColor: '#fff', borderRadius: 14, padding: 14, width: '47%', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  featureIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  featureTitle: { fontSize: 14, fontWeight: '600', color: '#1A1C1B', marginBottom: 4 },
  featureDesc: { fontSize: 12, color: '#6E7170', lineHeight: 17 },
  primaryBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginBottom: 14, shadowColor: '#1D9E75', shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 17 },
  testBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#E1F5EE', borderRadius: 10, paddingVertical: 13, marginTop: 4, marginBottom: 6, borderWidth: 1, borderColor: '#1D9E75', borderStyle: 'dashed' },
  testBtnText: { color: '#1D9E75', fontWeight: '600', fontSize: 14 },
  testHint: { textAlign: 'center', fontSize: 11, color: '#6E7170', marginBottom: 18, fontStyle: 'italic' },
  disclaimer: { textAlign: 'center', fontSize: 11, color: '#bbb' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 19, fontWeight: '700', color: '#1A1C1B' },
  scenarioCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#F0FBF7', borderRadius: 10, padding: 12, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#1D9E75' },
  scenarioTitle: { fontSize: 13, fontWeight: '700', color: '#1D9E75', marginBottom: 3 },
  scenarioDesc: { fontSize: 12, color: '#1A1C1B', lineHeight: 17 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E5E8E7' },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 17, fontWeight: '700', color: '#fff' },
  memberName: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  memberMeta: { fontSize: 11, color: '#6E7170', marginTop: 2 },
  hostBadge: { backgroundColor: '#1D9E75', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  hostBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  pivotBadge: { backgroundColor: '#CECBF6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pivotBadgeText: { color: '#5B3FD4', fontSize: 9, fontWeight: '700' },
});
