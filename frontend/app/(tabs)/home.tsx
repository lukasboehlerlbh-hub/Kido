import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../../context/UserContext';
import { api } from '../../services/api';

export default function HomeScreen() {
  const { user } = useUser();
  const [chain, setChain] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [nextHoliday, setNextHoliday] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inviteModal, setInviteModal] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.chainId) return;
    try {
      const [chainData, planData, holidays] = await Promise.all([
        api.getChain(user.chainId),
        api.getWeekendPlan(user.chainId).catch(() => null),
        api.getSwissHolidays(user.kanton || 'ZH', new Date().getFullYear()),
      ]);
      setChain(chainData);
      setPlan(planData);
      const today = new Date().toISOString().split('T')[0];
      setNextHoliday(holidays.find((h: any) => h.date_from >= today) || null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.chainId, user?.kanton]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async () => {
    if (!invitePhone.trim()) return;
    setInviteLoading(true);
    try {
      const r = await api.createInvitation({ chain_id: user?.chainId, invited_by_id: user?.userId, phone_number: invitePhone.trim() });
      setInviteToken(r.token);
      setInvitePhone('');
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const planColor = !plan ? '#F0F2F1' : plan.status === 'accepted' ? '#E1F5EE' : plan.proposal_type === 'blocked' ? '#FCEBEB' : '#FAEEDA';
  const planText = !plan ? 'Noch kein Plan berechnet' : plan.status === 'accepted' ? '✓ Plan akzeptiert' : plan.proposal_type === 'blocked' ? 'Konflikt – keine Lösung' : plan.proposal_type === 'ungern' ? 'Lösung möglich – Zustimmung fehlt' : 'Kido-Vorschlag wartet auf Antwort';
  const planTextColor = !plan ? '#6E7170' : plan.status === 'accepted' ? '#1D9E75' : plan.proposal_type === 'blocked' ? '#E24B4A' : '#BA7517';

  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;
  }

  const members = chain?.members || [];
  const isHost = members.find((m: any) => m.user_id === user?.userId)?.is_host;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#1D9E75" />}>

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Hallo, {user?.userName?.split(' ')[0]} 👋</Text>
            <Text style={s.chainNameText}>{user?.chainName}</Text>
          </View>
          <TouchableOpacity testID="settings-btn" style={s.settingsBtn} onPress={() => router.push('/settings')}>
            <Ionicons name="settings-outline" size={24} color="#1A1C1B" />
          </TouchableOpacity>
        </View>

        {/* Quote */}
        <View style={s.quoteCard}>
          <Text style={s.quoteText}>"Ein ausgeglichenes Wochenende ist kein Luxus – es ist das Fundament."</Text>
        </View>

        {/* Chain Members */}
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Elternkette ({members.length})</Text>
          {isHost && <TouchableOpacity testID="invite-btn" onPress={() => setInviteModal(true)}><Text style={s.linkText}>+ Einladen</Text></TouchableOpacity>}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.membersRow} contentContainerStyle={{ gap: 12, paddingHorizontal: 4 }}>
          {members.length === 0
            ? <Text style={s.emptyText}>Noch keine Mitglieder</Text>
            : members.map((m: any) => (
              <View key={m.id} style={s.memberPill}>
                <View style={[s.memberAvatar, { backgroundColor: m.avatar_color || '#1D9E75' }]}>
                  <Text style={s.memberAvatarText}>{m.user_name?.[0]?.toUpperCase() || '?'}</Text>
                </View>
                <Text style={s.memberName} numberOfLines={1}>{m.user_name?.split(' ')[0]}</Text>
                {m.is_host && <Ionicons name="star" size={10} color="#1D9E75" />}
              </View>
            ))
          }
        </ScrollView>

        {/* Weekend Plan Card */}
        <TouchableOpacity testID="weekend-plan-card" style={s.card} onPress={() => router.push('/(tabs)/weekends')}>
          <View style={s.cardHeader}>
            <Ionicons name="calendar-outline" size={20} color="#1D9E75" />
            <Text style={s.cardTitle}>Wochenendplan</Text>
            <Ionicons name="chevron-forward" size={18} color="#6E7170" />
          </View>
          <View style={[s.statusBadge, { backgroundColor: planColor }]}>
            <Text style={[s.statusText, { color: planTextColor }]}>{planText}</Text>
          </View>
          {plan?.kido_message && <Text style={s.kidoMsg} numberOfLines={2}>{plan.kido_message}</Text>}
          <Text style={s.cardLink}>Plan ansehen →</Text>
        </TouchableOpacity>

        {/* Holidays Card */}
        <TouchableOpacity testID="holidays-card" style={s.card} onPress={() => router.push('/(tabs)/holidays')}>
          <View style={s.cardHeader}>
            <Ionicons name="sunny-outline" size={20} color="#BA7517" />
            <Text style={s.cardTitle}>Nächste Ferien</Text>
            <Ionicons name="chevron-forward" size={18} color="#6E7170" />
          </View>
          {nextHoliday ? (
            <View>
              <Text style={s.holidayLabel}>{nextHoliday.label}</Text>
              <Text style={s.holidayDate}>
                {new Date(nextHoliday.date_from + 'T00:00:00').toLocaleDateString('de-CH')} – {new Date(nextHoliday.date_to + 'T00:00:00').toLocaleDateString('de-CH')}
              </Text>
            </View>
          ) : <Text style={s.holidayLabel}>Alle Ferien geregelt 🎉</Text>}
          <Text style={s.cardLink}>Alle Ferien →</Text>
        </TouchableOpacity>

        {/* Open Items */}
        <View style={s.openCard}>
          <Text style={s.sectionTitle}>Offene Punkte</Text>
          {plan && plan.status === 'proposed' && (
            <TouchableOpacity testID="open-plan-item" style={s.openItem} onPress={() => router.push('/(tabs)/weekends')}>
              <Ionicons name="time-outline" size={18} color="#BA7517" />
              <Text style={[s.openItemText, { color: '#BA7517' }]}>Kido-Vorschlag wartet auf deine Antwort</Text>
            </TouchableOpacity>
          )}
          {plan && plan.proposal_type === 'blocked' && plan.status !== 'accepted' && (
            <TouchableOpacity testID="open-conflict-item" style={s.openItem} onPress={() => router.push('/conflict')}>
              <Ionicons name="warning-outline" size={18} color="#E24B4A" />
              <Text style={[s.openItemText, { color: '#E24B4A' }]}>Konflikt – Lösung erforderlich</Text>
            </TouchableOpacity>
          )}
          {(!plan || plan.status === 'accepted') && (
            <View style={s.openItem}>
              <Ionicons name="checkmark-circle" size={18} color="#1D9E75" />
              <Text style={[s.openItemText, { color: '#1D9E75' }]}>Alles geregelt – gut gemacht!</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Invite Modal */}
      <Modal visible={inviteModal} animationType="slide" transparent>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>Kettenglied einladen</Text>
            {!inviteToken ? (
              <>
                <Text style={s.modalSub}>Telefonnummer der Person eingeben</Text>
                <TextInput testID="invite-phone-input" style={s.modalInput} placeholder="+41 79 123 45 67" value={invitePhone} onChangeText={setInvitePhone} keyboardType="phone-pad" placeholderTextColor="#aaa" />
                <TouchableOpacity testID="send-invite-btn" style={[s.modalBtn, inviteLoading && { opacity: 0.7 }]} onPress={handleInvite} disabled={inviteLoading}>
                  {inviteLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.modalBtnText}>Einladung erstellen</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.modalSub}>Token erstellt! Bitte teile diesen Code:</Text>
                <View style={s.tokenBox}><Text style={s.tokenText} selectable>{inviteToken}</Text></View>
                <Text style={s.modalHint}>Die Person gibt diesen Token im Onboarding ein.</Text>
                <TouchableOpacity testID="done-invite-btn" style={s.modalBtn} onPress={() => { setInviteModal(false); setInviteToken(''); }}>
                  <Text style={s.modalBtnText}>Fertig</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity testID="close-invite-modal" onPress={() => { setInviteModal(false); setInviteToken(''); setInvitePhone(''); }}>
              <Text style={s.cancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 20, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  greeting: { fontSize: 20, fontWeight: '700', color: '#1A1C1B' },
  chainNameText: { fontSize: 13, color: '#6E7170', marginTop: 2 },
  settingsBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  quoteCard: { backgroundColor: '#E1F5EE', borderRadius: 12, padding: 14, marginBottom: 20 },
  quoteText: { fontSize: 13, color: '#1D9E75', fontStyle: 'italic', lineHeight: 20, textAlign: 'center' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1C1B' },
  linkText: { fontSize: 14, color: '#1D9E75', fontWeight: '600' },
  membersRow: { marginBottom: 20 },
  memberPill: { alignItems: 'center', gap: 4, minWidth: 56 },
  memberAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  memberName: { fontSize: 11, color: '#6E7170', maxWidth: 56, textAlign: 'center' },
  emptyText: { color: '#aaa', fontSize: 13, paddingVertical: 12 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: '#1A1C1B' },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 8 },
  statusText: { fontSize: 13, fontWeight: '500' },
  kidoMsg: { fontSize: 13, color: '#6E7170', lineHeight: 18, marginBottom: 8 },
  cardLink: { fontSize: 13, color: '#1D9E75', fontWeight: '500' },
  holidayLabel: { fontSize: 15, fontWeight: '600', color: '#1A1C1B', marginBottom: 2 },
  holidayDate: { fontSize: 13, color: '#6E7170', marginBottom: 8 },
  openCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  openItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  openItemText: { fontSize: 14, color: '#1A1C1B', flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1A1C1B', marginBottom: 8 },
  modalSub: { fontSize: 14, color: '#6E7170', marginBottom: 16 },
  modalInput: { borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 12, padding: 14, fontSize: 15, color: '#1A1C1B', marginBottom: 16 },
  modalBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  modalBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  tokenBox: { backgroundColor: '#E1F5EE', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 12 },
  tokenText: { fontSize: 28, fontWeight: '800', color: '#1D9E75', letterSpacing: 4 },
  modalHint: { fontSize: 13, color: '#6E7170', textAlign: 'center', marginBottom: 16 },
  cancelText: { textAlign: 'center', color: '#6E7170', fontSize: 15, paddingVertical: 8 },
});
