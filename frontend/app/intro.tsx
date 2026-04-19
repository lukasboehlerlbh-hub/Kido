import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function IntroScreen() {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#1A1C1B" />
        </TouchableOpacity>
        <View style={s.iconCircle}>
          <Ionicons name="people-outline" size={36} color="#1D9E75" />
        </View>
        <Text style={s.title}>Gemeinsam für die Kinder</Text>
        <Text style={s.intro}>
          Eine Trennung verändert vieles. Wie ihr als Eltern zusammenarbeitet, prägt das Leben eurer Kinder mehr als fast alles andere.
        </Text>
        <View style={s.quoteBox}>
          <Text style={s.quoteText}>
            „Glückliche Eltern schaffen das beste Umfeld für Kinder. Nicht perfekte – ausgeglichene. Kinder spüren, wenn es den Menschen um sie herum gut geht."
          </Text>
        </View>
        <Text style={s.body}>
          Wir wissen, dass Zusammenarbeit nach einer Trennung nicht selbstverständlich ist. Diese App urteilt nicht – sie hilft, einen Weg zu finden, der für alle funktioniert.
        </Text>
        <Text style={s.body}>
          Ihr müsst euch nicht mögen. Es reicht, wenn ihr beide das Beste für eure Kinder wollt.
        </Text>
        <TouchableOpacity testID="intro-continue-btn" style={s.btn} onPress={() => router.push('/onboarding')}>
          <Text style={s.btnText}>Weiter</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 24, paddingBottom: 32 },
  back: { marginBottom: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 12, marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#1A1C1B', textAlign: 'center', marginBottom: 16, lineHeight: 34 },
  intro: { fontSize: 16, color: '#1A1C1B', textAlign: 'center', lineHeight: 23, marginBottom: 24 },
  quoteBox: { backgroundColor: '#E1F5EE', borderLeftWidth: 4, borderLeftColor: '#1D9E75', borderRadius: 10, padding: 18, marginBottom: 24 },
  quoteText: { fontSize: 15, color: '#176C50', lineHeight: 22, fontStyle: 'italic', fontWeight: '500' },
  body: { fontSize: 15, color: '#1A1C1B', lineHeight: 22, marginBottom: 16 },
  btn: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 16, shadowColor: '#1D9E75', shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
