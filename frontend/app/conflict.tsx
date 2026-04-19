import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../context/UserContext';
import { api } from '../services/api';

const STAGE_LABELS = ['Lösung gefunden', 'Jemand ist ungern dabei', 'Blockade'];
const STAGE_COLORS = ['#E1F5EE', '#FAEEDA', '#FCEBEB'];
const STAGE_TEXT_COLORS = ['#1D9E75', '#BA7517', '#E24B4A'];

export default function ConflictScreen() {
  const { user } = useUser();
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!user?.chainId) { setLoading(false); return; }
    api.getWeekendPlan(user.chainId)
      .then(p => { setPlan(p); setLoading(false); })
      .catch(() => setLoading(false));
  }, [user?.chainId]);

  const stage = !plan ? 0 : plan.proposal_type === 'blocked' ? 2 : plan.proposal_type === 'ungern' ? 1 : 0;

  const handleVote = async (vote: 'accepted' | 'declined') => {
    if (!plan?.id || !user?.chainMemberId) return;
    setVoting(true);
    try {
      const updated = await api.votePlan(plan.id, user.chainMemberId, vote);
      setPlan(updated);
    } catch (e) { console.error(e); }
    finally { setVoting(false); }
  };

  const myVote = plan?.votes?.find((v: any) => v.member_id === user?.chainMemberId);
  const canVote = plan && plan.status === 'proposed' && (!myVote || myVote.vote === 'pending');

  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity testID="back-btn" style={s.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#1A1C1B" />
          </TouchableOpacity>
          <Text style={s.pageTitle}>Konfliktlösung</Text>
        </View>

        {/* Stage Indicator */}
        <View style={s.stageRow}>
          {[0, 1, 2].map(i => (
            <View key={i} style={[s.stageItem, i === stage && { opacity: 1 }, i !== stage && { opacity: 0.4 }]}>
              <View style={[s.stageDot, { backgroundColor: STAGE_COLORS[i] }, i === stage && s.stageDotActive]}>
                <Text style={[s.stageDotText, { color: STAGE_TEXT_COLORS[i] }]}>{i + 1}</Text>
              </View>
              <Text style={[s.stageLabel, { color: STAGE_TEXT_COLORS[i] }]} numberOfLines={2}>
                {STAGE_LABELS[i]}
              </Text>
            </View>
          ))}
        </View>

        {!plan ? (
          <View style={s.noConflict}>
            <Ionicons name="checkmark-circle" size={56} color="#1D9E75" />
            <Text style={s.noConflictTitle}>Kein aktiver Konflikt</Text>
            <Text style={s.noConflictText}>Berechne zuerst einen Wochenendplan unter "Wochenenden".</Text>
            <TouchableOpacity testID="goto-weekends-btn" style={s.primaryBtn} onPress={() => router.push('/(tabs)/weekends')}>
              <Text style={s.primaryBtnText}>Zu Wochenenden</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Kido Message */}
            <View style={[s.kidoCard, { borderLeftColor: STAGE_TEXT_COLORS[stage] }]}>
              <View style={s.kidoHeader}>
                <View style={s.kidoAvatar}>
                  <Text style={s.kidoAvatarText}>K</Text>
                </View>
                <Text style={s.kidoName}>Kido</Text>
                <View style={[s.stageBadge, { backgroundColor: STAGE_COLORS[stage] }]}>
                  <Text style={[s.stageBadgeText, { color: STAGE_TEXT_COLORS[stage] }]}>Stufe {stage + 1}</Text>
                </View>
              </View>
              <Text style={s.kidoMsg}>{plan.kido_message}</Text>
            </View>

            {/* Plan Info */}
            <View style={s.infoCard}>
              <Text style={s.infoTitle}>Plandetails</Text>
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Typ:</Text>
                <Text style={s.infoValue}>{plan.proposal_type === 'clean' ? 'Konfliktfrei' : plan.proposal_type === 'ungern' ? 'Ungern-Person betroffen' : 'Blockade'}</Text>
              </View>
              {plan.pivot_member_name && (
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Betroffene Person:</Text>
                  <Text style={s.infoValue}>{plan.pivot_member_name}</Text>
                </View>
              )}
              {plan.pivot_new_logic && (
                <View style={s.infoRow}>
                  <Text style={s.infoLabel}>Vorgeschlagene Logik:</Text>
                  <Text style={s.infoValue}>{plan.pivot_new_logic === 'even' ? 'Gerade Wochen' : 'Ungerade Wochen'}</Text>
                </View>
              )}
              <View style={s.infoRow}>
                <Text style={s.infoLabel}>Status:</Text>
                <Text style={[s.infoValue, {
                  color: plan.status === 'accepted' ? '#1D9E75' :
                    plan.status === 'declined' ? '#E24B4A' : '#BA7517'
                }]}>
                  {plan.status === 'accepted' ? 'Akzeptiert' : plan.status === 'declined' ? 'Abgelehnt' : 'Ausstehend'}
                </Text>
              </View>
            </View>

            {/* Stage-specific messages */}
            {stage === 1 && plan.pivot_member_name && (
              <View style={s.ungernCard}>
                <Ionicons name="information-circle-outline" size={20} color="#BA7517" />
                <Text style={s.ungernText}>
                  {plan.pivot_member_name} wird anonym gefragt, ob ein Wechsel möglich ist. Diese Information bleibt vertraulich.
                </Text>
              </View>
            )}

            {stage === 2 && (
              <View style={s.blockedCard}>
                <Ionicons name="warning-outline" size={20} color="#E24B4A" />
                <Text style={s.blockedText}>
                  Kido hat alle Möglichkeiten ausgeschöpft. Eine externe Mediation könnte helfen, eine gemeinsame Lösung zu finden.
                </Text>
                <TouchableOpacity testID="mediation-link" style={s.mediationBtn}>
                  <Text style={s.mediationText}>Mediatoren in der Schweiz suchen</Text>
                  <Ionicons name="open-outline" size={16} color="#1D9E75" />
                </TouchableOpacity>
              </View>
            )}

            {/* Votes */}
            {plan.votes && plan.votes.length > 0 && (
              <View style={s.votesCard}>
                <Text style={s.votesTitle}>Stimmen</Text>
                {plan.votes.map((v: any, i: number) => (
                  <View key={v.id || i} style={s.voteRow}>
                    <Text style={s.voterName}>{v.member_name}</Text>
                    <Text style={[s.voteStatus,
                      v.vote === 'accepted' ? { color: '#1D9E75' } :
                        v.vote === 'declined' ? { color: '#E24B4A' } : { color: '#BA7517' }
                    ]}>
                      {v.vote === 'accepted' ? '✓' : v.vote === 'declined' ? '✗' : '⏳'}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Vote Buttons */}
            {canVote && (
              <View style={s.voteActions}>
                <TouchableOpacity testID="decline-btn" style={s.declineBtn} onPress={() => handleVote('declined')} disabled={voting}>
                  {voting ? <ActivityIndicator color="#E24B4A" size="small" /> : <Text style={s.declineBtnText}>Ablehnen</Text>}
                </TouchableOpacity>
                <TouchableOpacity testID="accept-btn" style={s.acceptBtn} onPress={() => handleVote('accepted')} disabled={voting}>
                  {voting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.acceptBtnText}>Annehmen</Text>}
                </TouchableOpacity>
              </View>
            )}

            {plan.status === 'accepted' && (
              <View style={s.acceptedBanner}>
                <Ionicons name="checkmark-circle" size={24} color="#1D9E75" />
                <Text style={s.acceptedText}>Alle haben zugestimmt! Der Plan ist akzeptiert.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#1A1C1B' },
  stageRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  stageItem: { flex: 1, alignItems: 'center', gap: 6 },
  stageDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stageDotActive: { borderWidth: 2, borderColor: '#1A1C1B' },
  stageDotText: { fontSize: 16, fontWeight: '700' },
  stageLabel: { fontSize: 10, textAlign: 'center', lineHeight: 14, fontWeight: '500' },
  noConflict: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  noConflictTitle: { fontSize: 18, fontWeight: '600', color: '#1A1C1B' },
  noConflictText: { fontSize: 14, color: '#6E7170', textAlign: 'center', maxWidth: 260 },
  primaryBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 24, marginTop: 8 },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  kidoCard: { backgroundColor: '#F0ECFF', borderRadius: 14, padding: 16, borderLeftWidth: 4, marginBottom: 14 },
  kidoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  kidoAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#CECBF6', alignItems: 'center', justifyContent: 'center' },
  kidoAvatarText: { fontSize: 16, fontWeight: '800', color: '#5B3FD4' },
  kidoName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  stageBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  stageBadgeText: { fontSize: 11, fontWeight: '600' },
  kidoMsg: { fontSize: 14, color: '#1A1C1B', lineHeight: 21 },
  infoCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  infoTitle: { fontSize: 15, fontWeight: '600', color: '#1A1C1B', marginBottom: 10 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0F2F1' },
  infoLabel: { fontSize: 13, color: '#6E7170' },
  infoValue: { fontSize: 13, fontWeight: '500', color: '#1A1C1B', maxWidth: '60%', textAlign: 'right' },
  ungernCard: { backgroundColor: '#FAEEDA', borderRadius: 12, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  ungernText: { flex: 1, fontSize: 13, color: '#BA7517', lineHeight: 19 },
  blockedCard: { backgroundColor: '#FCEBEB', borderRadius: 12, padding: 14, gap: 10, marginBottom: 14 },
  blockedText: { fontSize: 13, color: '#E24B4A', lineHeight: 19 },
  mediationBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mediationText: { fontSize: 13, color: '#1D9E75', fontWeight: '600' },
  votesCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14 },
  votesTitle: { fontSize: 15, fontWeight: '600', color: '#1A1C1B', marginBottom: 10 },
  voteRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0F2F1' },
  voterName: { fontSize: 14, color: '#1A1C1B' },
  voteStatus: { fontSize: 18, fontWeight: '700' },
  voteActions: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  declineBtn: { flex: 1, borderWidth: 1.5, borderColor: '#E24B4A', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  declineBtnText: { color: '#E24B4A', fontWeight: '600', fontSize: 15 },
  acceptBtn: { flex: 1, backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  acceptBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  acceptedBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E1F5EE', borderRadius: 12, padding: 14 },
  acceptedText: { flex: 1, fontSize: 14, color: '#1D9E75', fontWeight: '500' },
});
