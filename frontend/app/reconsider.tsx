import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../context/UserContext';
import { api } from '../services/api';

export default function ReconsiderScreen() {
  const { user } = useUser();
  const params = useLocalSearchParams<{ planId: string; mode?: string }>();
  // mode: 'ungern' (stage 2) or 'blocker' (stage 3a); defaults to ungern
  const mode = params.mode === 'blocker' ? 'blocker' : 'ungern';
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!user?.chainId) return;
    api.getWeekendPlan(user.chainId).then((p: any) => { setPlan(p); setLoading(false); }).catch(() => setLoading(false));
  }, [user?.chainId]);

  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;
  }
  if (!plan) {
    return <SafeAreaView style={s.safe}><View style={s.center}><Text>Kein Plan gefunden.</Text></View></SafeAreaView>;
  }

  const myName = user?.userName?.split(' ')[0] || '';
  const myInitial = myName[0] || '?';
  const avatarColor = user?.avatarColor || '#CECBF6';

  const newLogicLabel = plan.pivot_new_logic === 'even' ? 'gerade' : 'ungerade';

  const handleAccept = async () => {
    if (!plan?.id || !user?.chainMemberId) return;
    setWorking(true);
    try {
      await api.votePlan(plan.id, user.chainMemberId, 'accepted');
      router.replace('/(tabs)/weekends');
    } catch (e: any) { Alert.alert('Fehler', e.message); } finally { setWorking(false); }
  };
  const handleDecline = async () => {
    if (!plan?.id || !user?.chainMemberId) return;
    setWorking(true);
    try {
      await api.votePlan(plan.id, user.chainMemberId, 'declined');
      router.replace('/(tabs)/weekends');
    } catch (e: any) { Alert.alert('Fehler', e.message); } finally { setWorking(false); }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Ionicons name="arrow-back" size={24} color="#1A1C1B" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Nur für dich</Text>
        <View style={s.kidoTag}><Text style={s.kidoTagText}>kido</Text></View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.infoBanner}>
          <Ionicons name="information-circle-outline" size={18} color="#BA7517" />
          <Text style={s.infoBannerText}>Diese Nachricht siehst nur du – niemand sonst in der Kette.</Text>
        </View>

        <View style={s.greeting}>
          <View style={[s.avatar, { backgroundColor: avatarColor }]}>
            <Text style={s.avatarText}>{myInitial}</Text>
          </View>
          <View>
            <Text style={s.greetingTitle}>Hallo {myName}</Text>
            <Text style={s.greetingSub}>Eine persönliche Nachricht von Kido</Text>
          </View>
        </View>

        <View style={s.quoteBox}>
          <Text style={s.quoteText}>
            {mode === 'blocker'
              ? '„Aktuell hältst du eine Lösung für die gesamte Kette zurück. Du hast die Möglichkeit, den Konflikt aufzulösen, wenn du deine Haltung überdenkst."'
              : '„Kido hat eine mögliche Lösung für die ganze Kette gefunden – aber sie hängt an dir. Du hast angegeben, dass du eine Änderung deiner Wochenendlogik ungern vornehmen würdest."'}
          </Text>
        </View>

        <Text style={s.body}>
          Wenn du bereit bist, auf <Text style={{ fontWeight: '700' }}>{newLogicLabel} Wochenenden</Text> zu wechseln, löst das den Konflikt für die gesamte Kette. Alle anderen Beteiligten sind innerhalb ihrer Vorgaben – du alleine hast es in der Hand.
        </Text>

        <View style={s.greenQuote}>
          <Text style={s.greenQuoteText}>
            „Kinder brauchen keine perfekte Lösung. Sie brauchen Eltern, die versuchen, eine zu finden."
          </Text>
        </View>

        <Text style={s.footnote}>
          Niemand ausser Kido weiss, dass du gefragt wurdest. Was auch immer du entscheidest – es wird respektiert.
        </Text>

        <TouchableOpacity testID="reconsider-accept-btn" style={[s.btnAccept, working && { opacity: 0.7 }]} onPress={handleAccept} disabled={working}>
          {working ? <ActivityIndicator color="#fff" /> : <Text style={s.btnAcceptText}>Ja, ich bin bereit</Text>}
        </TouchableOpacity>
        <TouchableOpacity testID="reconsider-decline-btn" style={s.btnDecline} onPress={handleDecline} disabled={working}>
          <Text style={s.btnDeclineText}>Nein, ich bleibe bei meiner Angabe</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E8E7' },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#1A1C1B' },
  kidoTag: { backgroundColor: '#E1F5EE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  kidoTagText: { color: '#1D9E75', fontSize: 12, fontWeight: '600' },
  scroll: { padding: 20, paddingBottom: 32 },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FAEEDA', borderWidth: 1, borderColor: '#F4C27A', borderRadius: 10, padding: 14, marginBottom: 18 },
  infoBannerText: { flex: 1, fontSize: 13, color: '#8A5709', lineHeight: 18 },
  greeting: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#EEEDFE', borderRadius: 12, padding: 14, marginBottom: 18 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  greetingTitle: { fontSize: 18, fontWeight: '700', color: '#1A1C1B' },
  greetingSub: { fontSize: 13, color: '#5B3FD4', marginTop: 2 },
  quoteBox: { backgroundColor: '#FAEEDA', borderLeftWidth: 4, borderLeftColor: '#BA7517', borderRadius: 10, padding: 16, marginBottom: 20 },
  quoteText: { fontSize: 15, fontStyle: 'italic', color: '#5E3F0A', lineHeight: 22, fontWeight: '500' },
  body: { fontSize: 15, color: '#1A1C1B', lineHeight: 22, marginBottom: 18 },
  greenQuote: { backgroundColor: '#E1F5EE', borderLeftWidth: 4, borderLeftColor: '#1D9E75', borderRadius: 10, padding: 16, marginBottom: 18 },
  greenQuoteText: { fontSize: 15, fontStyle: 'italic', color: '#176C50', lineHeight: 22, fontWeight: '500' },
  footnote: { fontSize: 13, color: '#6E7170', lineHeight: 19, marginBottom: 24 },
  btnAccept: { backgroundColor: '#1D9E75', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  btnAcceptText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDecline: { borderWidth: 1.5, borderColor: '#6E7170', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  btnDeclineText: { color: '#6E7170', fontWeight: '600', fontSize: 15 },
});
