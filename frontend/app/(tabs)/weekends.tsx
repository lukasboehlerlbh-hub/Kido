import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../../context/UserContext';
import { api } from '../../services/api';
import { buildICS, addDays, exportICS } from '../../utils/icsExport';

const CELL_W = 46;
const CELL_H = 44;

function CalendarGrid({ members, schedule, proposedSchedule, weekends, planType }: any) {
  const showProposal = planType !== 'clean' || JSON.stringify(schedule) !== JSON.stringify(proposedSchedule);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
      <View>
        {/* Header Row */}
        <View style={cg.headerRow}>
          <View style={cg.nameCol} />
          {weekends.map((w: any) => (
            <View key={w.week_index} style={cg.headerCell}>
              <Text style={cg.headerWeek}>{w.label}</Text>
              <Text style={cg.headerDate}>{new Date(w.date + 'T00:00:00').toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}</Text>
            </View>
          ))}
        </View>

        {/* Legend */}
        {showProposal && (
          <View style={cg.legend}>
            <View style={cg.legendItem}><View style={[cg.legendDot, { backgroundColor: '#E1F5EE' }]} /><Text style={cg.legendText}>Aktuell</Text></View>
            <View style={cg.legendItem}><View style={[cg.legendDot, { backgroundColor: '#CECBF6' }]} /><Text style={cg.legendText}>Kido-Vorschlag</Text></View>
          </View>
        )}

        {/* Member Rows */}
        {members.map((m: any) => {
          const mid = m.id;
          const cur = schedule?.[mid] || Array(8).fill(false);
          const prop = proposedSchedule?.[mid] || cur;
          return (
            <View key={mid} style={cg.memberRow}>
              <View style={cg.nameCol}>
                <View style={[cg.avatar, { backgroundColor: m.avatar_color || '#1D9E75' }]}>
                  <Text style={cg.avatarText}>{m.user_name?.[0]?.toUpperCase()}</Text>
                </View>
                <Text style={cg.memberName} numberOfLines={1}>{m.user_name?.split(' ')[0]}</Text>
              </View>
              {cur.map((hasKids: boolean, wi: number) => {
                const proposedKids = prop[wi];
                const isChanged = hasKids !== proposedKids;
                const cellColor = isChanged
                  ? '#CECBF6'
                  : hasKids ? '#E1F5EE' : '#F0F2F1';
                const textColor = isChanged
                  ? '#5B3FD4'
                  : hasKids ? '#1D9E75' : '#aaa';
                return (
                  <View key={wi} style={[cg.cell, { backgroundColor: cellColor }]}>
                    <Text style={[cg.cellText, { color: textColor }]}>
                      {isChanged ? (proposedKids ? '↑' : '↓') : (hasKids ? '✓' : '·')}
                    </Text>
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export default function WeekendsScreen() {
  const { user } = useUser();
  const [plan, setPlan] = useState<any>(null);
  const [chain, setChain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [voting, setVoting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.chainId) return;
    try {
      const [chainData, planData] = await Promise.all([
        api.getChain(user.chainId),
        api.getWeekendPlan(user.chainId).catch(() => null),
      ]);
      setChain(chainData);
      setPlan(planData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.chainId]);

  useEffect(() => { load(); }, [load]);

  const handleCalculate = async () => {
    if (!user?.chainId) return;
    setCalculating(true);
    try {
      const newPlan = await api.calculatePlan(user.chainId);
      setPlan(newPlan);
    } catch (e: any) {
      Alert.alert('Fehler', e.message || 'Plan konnte nicht berechnet werden.');
    } finally {
      setCalculating(false);
    }
  };

  const handleExportPlan = async () => {
    if (!plan?.weekends || !plan?.proposed_schedule || !members.length) {
      Alert.alert('Kein Plan', 'Bitte zuerst einen Plan berechnen.');
      return;
    }
    const events: any[] = [];
    for (const m of members) {
      const mid = m.id;
      const row = plan.proposed_schedule[mid] || [];
      row.forEach((hasKids: boolean, wi: number) => {
        if (!hasKids) return;
        const w = plan.weekends[wi];
        if (!w) return;
        // Saturday + Sunday = 2 days, DTEND exclusive → +2 from Sat = Mon
        events.push({
          uid: `kido-we-${mid}-${w.date}@kido.app`,
          start: w.date,
          end: addDays(w.date, 2),
          summary: `Kido: ${m.user_name} mit Kindern (${w.label})`,
          description: `Wochenende ${w.label} – KW ${w.week_num}`,
        });
      });
    }
    if (!events.length) {
      Alert.alert('Leer', 'Keine Wochenenden im Plan gefunden.');
      return;
    }
    const ics = buildICS(events, 'Kido Wochenendplan');
    await exportICS(ics, `kido-wochenendplan-${Date.now()}.ics`);
  };

  const handleVote = async (vote: 'accepted' | 'declined') => {
    if (!plan?.id || !user?.chainMemberId) return;
    setVoting(true);
    try {
      const updated = await api.votePlan(plan.id, user.chainMemberId, vote);
      setPlan(updated);
      if (vote === 'accepted') {
        Alert.alert('Danke!', updated.status === 'accepted' ? 'Alle haben zugestimmt! Plan ist akzeptiert.' : 'Deine Stimme wurde gezählt.');
      } else {
        Alert.alert('Abgelehnt', 'Deine Ablehnung wurde gespeichert.');
      }
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    } finally {
      setVoting(false);
    }
  };

  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;
  }

  const members = chain?.members || [];
  const myVote = plan?.votes?.find((v: any) => v.member_id === user?.chainMemberId);
  const canVote = plan && plan.status === 'proposed' && (!myVote || myVote.vote === 'pending');

  const statusColor = !plan ? '#F0F2F1' : plan.status === 'accepted' ? '#E1F5EE' : plan.proposal_type === 'blocked' ? '#FCEBEB' : '#FAEEDA';
  const statusTextColor = !plan ? '#6E7170' : plan.status === 'accepted' ? '#1D9E75' : plan.proposal_type === 'blocked' ? '#E24B4A' : '#BA7517';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#1D9E75" />}>

        <Text style={s.pageTitle}>Wochenendplan</Text>
        <Text style={s.pageSub}>Nächste 8 Wochenenden auf einen Blick</Text>

        {/* Action Row */}
        <View style={s.actionRow}>
          <TouchableOpacity
            testID="calculate-plan-btn"
            style={[s.calcBtn, calculating && { opacity: 0.7 }]}
            onPress={handleCalculate}
            disabled={calculating}
          >
            {calculating
              ? <ActivityIndicator color="#1D9E75" size="small" />
              : <Ionicons name="calculator-outline" size={18} color="#1D9E75" />
            }
            <Text style={s.calcBtnText}>{plan ? 'Plan neu berechnen' : 'Plan berechnen'}</Text>
          </TouchableOpacity>
          {plan && (
            <TouchableOpacity testID="export-plan-btn" style={s.exportPlanBtn} onPress={handleExportPlan}>
              <Ionicons name="calendar-outline" size={18} color="#1D9E75" />
              <Text style={s.calcBtnText}>Kalender</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Plan Status */}
        {plan && (
          <View style={[s.statusCard, { borderLeftColor: statusTextColor, backgroundColor: statusColor }]}>
            <View style={s.statusCardHeader}>
              <Text style={[s.statusLabel, { color: statusTextColor }]}>
                {plan.status === 'accepted' ? 'Akzeptiert' : plan.proposal_type === 'blocked' ? 'Konflikt' : plan.proposal_type === 'ungern' ? 'Lösung möglich' : 'Vorschlag'}
              </Text>
              {plan.proposal_type !== 'blocked' && plan.status !== 'accepted' && (
                <Text style={s.pivotNote}>
                  {plan.pivot_member_name && plan.proposal_type === 'ungern'
                    ? `${plan.pivot_member_name} könnte auf '${plan.pivot_new_logic === 'even' ? 'gerade' : 'ungerade'}' wechseln`
                    : 'Kein Wechsel nötig'}
                </Text>
              )}
            </View>
            <Text style={s.kidoMsg}>{plan.kido_message}</Text>
          </View>
        )}

        {/* Calendar */}
        {plan && members.length > 0 ? (
          <View style={s.calendarCard}>
            <CalendarGrid
              members={members}
              schedule={plan.schedule}
              proposedSchedule={plan.proposed_schedule}
              weekends={plan.weekends}
              planType={plan.proposal_type}
            />
          </View>
        ) : (
          <View style={s.emptyState}>
            <Ionicons name="calendar-outline" size={48} color="#E5E8E7" />
            <Text style={s.emptyTitle}>Noch kein Plan</Text>
            <Text style={s.emptyText}>Tippe auf "Plan berechnen" um einen Vorschlag zu erstellen.</Text>
          </View>
        )}

        {/* Votes */}
        {plan?.votes && plan.votes.length > 0 && (
          <View style={s.votesCard}>
            <Text style={s.votesTitle}>Abstimmung</Text>
            {plan.votes.map((v: any) => (
              <View key={v.id || v.member_id} style={s.voteRow}>
                <Text style={s.voterName}>{v.member_name}</Text>
                <View style={[s.voteBadge,
                  v.vote === 'accepted' ? s.voteBadgeAccepted :
                  v.vote === 'declined' ? s.voteBadgeDeclined : s.voteBadgePending
                ]}>
                  <Text style={[s.voteBadgeText,
                    v.vote === 'accepted' ? { color: '#1D9E75' } :
                    v.vote === 'declined' ? { color: '#E24B4A' } : { color: '#BA7517' }
                  ]}>
                    {v.vote === 'accepted' ? '✓ Angenommen' : v.vote === 'declined' ? '✗ Abgelehnt' : '⏳ Ausstehend'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Accept/Decline */}
        {canVote && (
          <View style={s.voteActions}>
            <Text style={s.votePrompt}>Nimmst du diesen Vorschlag an?</Text>
            <View style={s.voteBtns}>
              <TouchableOpacity testID="decline-plan-btn" style={s.declineBtn} onPress={() => handleVote('declined')} disabled={voting}>
                {voting ? <ActivityIndicator color="#E24B4A" size="small" /> : <>
                  <Ionicons name="close-circle-outline" size={20} color="#E24B4A" />
                  <Text style={s.declineBtnText}>Ablehnen</Text>
                </>}
              </TouchableOpacity>
              <TouchableOpacity testID="accept-plan-btn" style={s.acceptBtn} onPress={() => handleVote('accepted')} disabled={voting}>
                {voting ? <ActivityIndicator color="#fff" size="small" /> : <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                  <Text style={s.acceptBtnText}>Annehmen</Text>
                </>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Conflict link */}
        {plan?.proposal_type === 'blocked' && plan.status !== 'accepted' && (
          <TouchableOpacity testID="goto-conflict-btn" style={s.conflictBtn} onPress={() => router.push('/conflict')}>
            <Ionicons name="warning-outline" size={18} color="#E24B4A" />
            <Text style={s.conflictBtnText}>Konflikt lösen</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 20, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#1A1C1B', marginBottom: 4 },
  pageSub: { fontSize: 13, color: '#6E7170', marginBottom: 16 },
  calcBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E1F5EE', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16 },
  exportPlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F0FBF7', borderWidth: 1, borderColor: '#1D9E75', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  calcBtnText: { color: '#1D9E75', fontWeight: '600', fontSize: 14 },
  statusCard: { borderLeftWidth: 4, borderRadius: 12, padding: 14, marginBottom: 16 },
  statusCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusLabel: { fontSize: 14, fontWeight: '700' },
  pivotNote: { fontSize: 12, color: '#6E7170', flex: 1 },
  kidoMsg: { fontSize: 13, color: '#1A1C1B', lineHeight: 19 },
  calendarCard: { backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#6E7170' },
  emptyText: { fontSize: 13, color: '#aaa', textAlign: 'center', maxWidth: 260 },
  votesCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16 },
  votesTitle: { fontSize: 15, fontWeight: '600', color: '#1A1C1B', marginBottom: 12 },
  voteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0F2F1' },
  voterName: { fontSize: 14, color: '#1A1C1B' },
  voteBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  voteBadgeAccepted: { backgroundColor: '#E1F5EE' },
  voteBadgeDeclined: { backgroundColor: '#FCEBEB' },
  voteBadgePending: { backgroundColor: '#FAEEDA' },
  voteBadgeText: { fontSize: 12, fontWeight: '600' },
  voteActions: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16 },
  votePrompt: { fontSize: 15, color: '#1A1C1B', fontWeight: '600', marginBottom: 14, textAlign: 'center' },
  voteBtns: { flexDirection: 'row', gap: 12 },
  declineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: '#E24B4A', borderRadius: 10, paddingVertical: 13 },
  declineBtnText: { color: '#E24B4A', fontWeight: '600', fontSize: 15 },
  acceptBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 13 },
  acceptBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  conflictBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FCEBEB', borderRadius: 10, paddingVertical: 13 },
  conflictBtnText: { color: '#E24B4A', fontWeight: '600', fontSize: 15 },
});

const cg = StyleSheet.create({
  headerRow: { flexDirection: 'row', marginBottom: 4 },
  nameCol: { width: 80, paddingRight: 8, justifyContent: 'center' },
  headerCell: { width: CELL_W, alignItems: 'center', marginHorizontal: 2 },
  headerWeek: { fontSize: 11, fontWeight: '600', color: '#6E7170' },
  headerDate: { fontSize: 9, color: '#aaa' },
  legend: { flexDirection: 'row', gap: 16, marginBottom: 8, paddingLeft: 80 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 10, color: '#6E7170' },
  memberRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  memberName: { fontSize: 10, color: '#6E7170', maxWidth: 46, marginLeft: 4 },
  cell: { width: CELL_W, height: CELL_H, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
  cellText: { fontSize: 14, fontWeight: '600' },
});
