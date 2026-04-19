import { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../context/UserContext';

const FEATURES = [
  { icon: 'shield-checkmark-outline', title: 'Privat', desc: 'Niemand sieht die Antworten der anderen – nur das Ergebnis.' },
  { icon: 'people-outline', title: 'Einladung', desc: 'Kettenglieder per Link einladen.' },
  { icon: 'heart-outline', title: 'Kido', desc: 'Mediator, kein Richter. Warmherzig, nie urteilend.' },
  { icon: 'bulb-outline', title: 'Intelligent', desc: 'Automatische Konfliktlösung nach euren Vorgaben.' },
];

export default function WelcomeScreen() {
  const { user, loading } = useUser();

  useEffect(() => {
    if (!loading && user?.prefsSet) {
      router.replace('/(tabs)/home');
    } else if (!loading && user && !user.prefsSet) {
      router.replace('/setup-prefs');
    }
  }, [user, loading]);

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
            "Kinder profitieren am meisten, wenn ihre Eltern genug Raum haben, um Energie zu tanken – und danach mit voller Kraft wieder für sie da zu sein."
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

        <TouchableOpacity testID="get-started-btn" style={s.primaryBtn} onPress={() => router.push('/onboarding')}>
          <Text style={s.primaryBtnText}>Loslegen</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>

        <Text style={s.disclaimer}>Kido ersetzt keine rechtliche Beratung.</Text>
      </ScrollView>
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
  disclaimer: { textAlign: 'center', fontSize: 11, color: '#bbb' },
});
