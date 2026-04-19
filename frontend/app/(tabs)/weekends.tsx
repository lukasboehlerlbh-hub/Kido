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

const CELL_W = 38;
const CELL_H = 36;

function Grid({ members, schedule, weekends, pivotId, variant }: any) {
  const isProposal = variant === 'proposal';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={cg.headerRow}>
          <View style={cg.nameCol} />
          {weekends.map((w: any) => (
            <View key={w.week_index} style={cg.headerCell}>
              <Text style={cg.headerWeek}>W{w.week_index + 1}</Text>
            </View>
          ))}
        </View>
        {members.map((m: any) => {
          const mid = m.id;
          const row = schedule?.[mid] || Array(8).fill(false);
          const isPivotRow = isProposal && mid === pivotId;
          return (
            <View key={mid} style={cg.memberRow}>
              <View style={cg.nameCol}>
                <View style={[cg.avatar, { backgroundColor: m.avatar_color || '#1D9E75' }]}>
                  <Text style={cg.avatarText}>{m.user_name?.[0]?.toUpperCase()}</Text>
                </View>
                <Text style={cg.memberName} numberOfLines={1}>{m.user_name?.split(' ')[0]}</Text>
              </View>
              {row.map((hasKids: boolean, wi: number) => {
                const cellColor = isPivotRow
                  ? (hasKids ? '#CECBF6' : '#EEEDFE')
                  : (hasKids ? '#CDEFE0' : '#F4F6F5');
                const textColor = isPivotRow ? '#5B3FD4' : (hasKids ? '#1D9E75' : '#BBBDBC');
                return (
                  <View key={wi} style={[cg.cell, { backgroundColor: cellColor }]}>
                    <Text style={[cg.cellText, { color: textColor }]}>{hasKids ? 'K' : '–'}</Text>
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

const STAGE_INFO: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  '1_clean': { label: 'Stufe 1 · Lösung gefunden', color: '#1D9E75', bg: '#E1F5EE', icon: 'checkmark-circle' },
  '2_ungern': { label: 'Stufe 2 · Jemand muss ungern nachgeben', color: '#BA7517', bg: '#FAEEDA', icon: 'heart' },
  '3a_blockers': { label: 'Stufe 3a · Blockade – private Ansprache', color: '#D87E28', bg: '#FCE8D4', icon: 'warning' },
  '3b_subgroups': { label: 'Stufe 3b · Subgruppen', color: '#5B3FD4', bg: '#EEEDFE', icon: 'git-branch' },
};

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
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
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
    } finally { setCalculating(false); }
  };

  const handleVote = async (vote: 'accepted' | 'declined') => {
    if (!plan?.id || !user?.chainMemberId) return;
    setVoting(true);
    try {
      const updated = await api.votePlan(plan.id, user.chainMemberId, vote);
      setPlan(updated);
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    } finally { setVoting(false); }
  };

  const handleReconsider = async () => {
    if (!plan?.id) return;
    try { const u = await api.reconsiderPlan(plan.id); setPlan(u); }
    catch (e: any) { Alert.alert('Fehler', e.message); }
  };

  const handleTryNext = async () => {
    if (!plan?.id) return;
    setCalculating(true);
    try { const u = await api.tryNextPivot(plan.id); setPlan(u); }
    catch (e: any) { Alert.alert('Fehler', e.message); }
    finally { setCalculating(false); }
  };

  const handleEscalate3b = async () => {
    if (!plan?.id) return;
    try { const u = await api.escalateTo3b(plan.id); setPlan(u); }
    catch (e: any) { Alert.alert('Fehler', e.message); }
  };

  const handleExportPlan = async () => {
    if (!plan?.weekends || !plan?.proposed_schedule || !members.length) {
      Alert.alert('Kein Plan', 'Bitte zuerst einen Plan berechnen.');
      return;
    }
    const events: any[] = [];
    for (const m of members) {
      const row = plan.proposed_schedule[m.id] || [];
      row.forEach((hasKids: boolean, wi: number) => {
        if (!hasKids) return;
        const w = plan.weekends[wi]; if (!w) return;
        events.push({
          uid: `kido-we-${m.id}-${w.date}@kido.app`,
          start: w.date, end: addDays(w.date, 2),
          summary: `Kido: ${m.user_name} mit Kindern (${w.label})`,
          description: `Wochenende ${w.label} – KW ${w.week_num}`,
        });
      });
    }
    if (!events.length) { Alert.alert('Leer', 'Keine Wochenenden im Plan gefunden.'); return; }
    const ics = buildICS(events, 'Kido Wochenendplan');
    await exportICS(ics, `kido-wochenendplan-${Date.now()}.ics`);
  };

  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;
  }

  const members = chain?.members || [];
  const myVote = plan?.votes?.find((v: any) => v.member_id === user?.chainMemberId);
  const stage = plan?.escalation_stage || '1_clean';
  const stageInfo = STAGE_INFO[stage] || STAGE_INFO['1_clean'];
  const isPivot = user?.chainMemberId === plan?.pivot_member_id;
  const isBlocker = (plan?.blockers || []).includes(user?.chainMemberId);
  const amIActive = myVote?.is_active !== false;
  const canVote = plan && plan.status === 'proposed' && amIActive && (!myVote || myVote.vote === 'pending');
  const myDeclinedStage2 = stage === '2_ungern' && isPivot && myVote?.vote === 'declined';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#1D9E75" />}>

        <Text style={s.pageTitle}>Wochenendplan</Text>
        <Text style={s.pageSub}>Nächste 8 Wochenenden · Eskalationsmodell</Text>

        <View style={s.actionRow}>
          <TouchableOpacity testID="calculate-plan-btn" style={[s.calcBtn, calculating && { opacity: 0.7 }]} onPress={handleCalculate} disabled={calculating}>
            {calculating ? <ActivityIndicator color="#1D9E75" size="small" /> : <Ionicons name="calculator-outline" size={18} color="#1D9E75" />}
            <Text style={s.calcBtnText}>{plan ? 'Neu berechnen' : 'Plan berechnen'}</Text>
          </TouchableOpacity>
          {plan && (
            <TouchableOpacity testID="export-plan-btn" style={s.exportPlanBtn} onPress={handleExportPlan}>
              <Ionicons name="calendar-outline" size={18} color="#1D9E75" />
              <Text style={s.calcBtnText}>Kalender</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Stage Banner */}
        {plan && (
          <View style={[s.stageCard, { backgroundColor: stageInfo.bg, borderLeftColor: stageInfo.color }]}>
            <View style={s.stageHeader}>
              <Ionicons name={stageInfo.icon as any} size={20} color={stageInfo.color} />
              <Text style={[s.stageLabel, { color: stageInfo.color }]}>{stageInfo.label}</Text>
            </View>
            <Text style={s.kidoMsg}>{plan.kido_message}</Text>
          </View>
        )}

        {/* Stage 2 – Private Pivot Prompt */}
        {plan && stage === '2_ungern' && isPivot && plan.status === 'proposed' && (
          <View style={s.privateCard}>
            <View style={s.privateHeader}>
              <Ionicons name="person-circle" size={22} color="#BA7517" />
              <Text style={s.privateTitle}>Nur für dich</Text>
            </View>
            <Text style={s.privateMsg}>
              Die ganze Kette hofft gerade auf dich. Mit deinem Wechsel auf {plan.pivot_new_logic === 'even' ? 'gerade' : 'ungerade'} Wochenenden wäre der Konflikt für alle gelöst.
            </Text>
            {myDeclinedStage2 && (
              <TouchableOpacity testID="reconsider-btn" style={s.reconsiderBtn} onPress={handleReconsider}>
                <Ionicons name="refresh-outline" size={18} color="#1D9E75" />
                <Text style={s.reconsiderText}>Ich möchte es nochmal überdenken</Text>
              </TouchableOpacity>
            )}
            {myVote?.vote === 'declined' && (
              <TouchableOpacity testID="try-next-btn" style={s.tryNextBtn} onPress={handleTryNext}>
                <Ionicons name="swap-horizontal-outline" size={18} color="#5B3FD4" />
                <Text style={s.tryNextText}>Andere Lösung probieren (anderes Mitglied fragen)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Stage 2 – non-pivot waiting */}
        {plan && stage === '2_ungern' && !isPivot && plan.status === 'proposed' && (
          <View style={s.waitCard}>
            <Ionicons name="hourglass-outline" size={20} color="#6E7170" />
            <Text style={s.waitText}>Kido spricht gerade privat mit einem Kettenmitglied. Sobald eine Entscheidung da ist, erfährst du es.</Text>
          </View>
        )}

        {/* Stage 3a – Blocker private plea */}
        {plan && stage === '3a_blockers' && isBlocker && plan.status === 'proposed' && (
          <View style={s.privateCard}>
            <View style={s.privateHeader}>
              <Ionicons name="alert-circle" size={22} color="#D87E28" />
              <Text style={s.privateTitle}>Nur für dich · vertraulich</Text>
            </View>
            <Text style={s.privateMsg}>
              Du hältst gerade eine Lösung für alle zurück. Bitte denke im Sinne deiner Kinder darüber nach, ob du deine Haltung überdenken kannst.
            </Text>
            <TouchableOpacity testID="edit-prefs-from-3a" style={s.tryNextBtn} onPress={() => router.push('/setup-prefs?edit=1')}>
              <Ionicons name="options-outline" size={18} color="#5B3FD4" />
              <Text style={s.tryNextText}>Präferenzen bearbeiten</Text>
            </TouchableOpacity>
          </View>
        )}
        {plan && stage === '3a_blockers' && !isBlocker && plan.status === 'proposed' && (
          <View style={s.waitCard}>
            <Ionicons name="time-outline" size={20} color="#6E7170" />
            <Text style={s.waitText}>Kido hat blockierende Mitglieder privat angesprochen. Warte auf Rückmeldung.</Text>
          </View>
        )}
        {plan && stage === '3a_blockers' && plan.status === 'proposed' && (
          <TouchableOpacity testID="escalate-3b-btn" style={s.escalateBtn} onPress={handleEscalate3b}>
            <Ionicons name="git-branch-outline" size={18} color="#5B3FD4" />
            <Text style={s.escalateText}>Zu Stufe 3b (Subgruppen) eskalieren</Text>
          </TouchableOpacity>
        )}

        {/* Stage 3b – Subgroups */}
        {plan && stage === '3b_subgroups' && plan.subgroups && (
          <View style={s.subgroupsCard}>
            <Text style={s.subgroupsTitle}>Subgruppen-Vorschlag</Text>
            {plan.subgroups.map((grp: any[], i: number) => (
              <View key={i} style={s.subgroupRow}>
                <Text style={s.subgroupLabel}>Gruppe {i + 1} ({grp[0]?.logic === 'even' ? 'gerade' : 'ungerade'} Wochen)</Text>
                <View style={s.subgroupMembers}>
                  {grp.map((p: any) => (
                    <View key={p.id} style={[s.subAvatar, { backgroundColor: p.color || '#CECBF6' }]}>
                      <Text style={s.subAvatarText}>{p.name?.[0]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            <Text style={s.subgroupNote}>Hinweis: Einige Paare dabei sind suboptimal gestellt. Das ist die beste Lösung unter den aktuellen Umständen.</Text>
          </View>
        )}

        {/* AKTUELL GELEBT grid - always visible */}
        {plan && members.length > 0 && (
          <View style={s.gridCard}>
            <Text style={s.gridTitle}>AKTUELL GELEBT</Text>
            <Grid members={members} schedule={plan.schedule} weekends={plan.weekends} pivotId={null} variant="current" />
          </View>
        )}

        {/* KIDO-VORSCHLAG grid - only if different or stage>=2 */}
        {plan && members.length > 0 && stage !== '3a_blockers' && (
          <View style={[s.gridCard, s.proposalCard]}>
            <Text style={s.gridTitle}>KIDO-VORSCHLAG</Text>
            {plan.pivot_member_name && (
              <View style={s.proposalHint}>
                <Text style={s.proposalHintText}>
                  {plan.pivot_member_name} wechselt auf {plan.pivot_new_logic === 'even' ? 'gerade' : 'ungerade'} Wochenenden → Konflikt aufgelöst
                </Text>
              </View>
            )}
            <Grid members={members} schedule={plan.proposed_schedule} weekends={plan.weekends} pivotId={plan.pivot_member_id} variant="proposal" />
          </View>
        )}

        {/* Empty state */}
        {!plan && members.length > 0 && (
          <View style={s.emptyState}>
            <Ionicons name="calendar-outline" size={48} color="#E5E8E7" />
            <Text style={s.emptyTitle}>Noch kein Plan</Text>
            <Text style={s.emptyText}>Tippe auf &quot;Plan berechnen&quot; um einen Vorschlag zu erstellen.</Text>
          </View>
        )}

        {/* Votes */}
        {plan?.votes && plan.votes.length > 0 && (
          <View style={s.votesCard}>
            <Text style={s.votesTitle}>Abstimmung</Text>
            {plan.votes.filter((v: any) => v.is_active !== false).map((v: any) => (
              <View key={v.id || v.member_id} style={s.voteRow}>
                <Text style={s.voterName}>{v.member_name}</Text>
                <View style={[s.voteBadge,
                  v.vote === 'accepted' ? s.voteBadgeAccepted :
                  v.vote === 'declined' ? s.voteBadgeDeclined : s.voteBadgePending]}>
                  <Text style={[s.voteBadgeText,
                    v.vote === 'accepted' ? { color: '#1D9E75' } :
                    v.vote === 'declined' ? { color: '#E24B4A' } : { color: '#BA7517' }]}>
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
            <View style={s.voteBtns}>
              <TouchableOpacity testID="decline-plan-btn" style={s.declineBtn} onPress={() => handleVote('declined')} disabled={voting}>
                {voting ? <ActivityIndicator color="#E24B4A" size="small" /> : <><Ionicons name="close-circle-outline" size={20} color="#E24B4A" /><Text style={s.declineBtnText}>Ablehnen</Text></>}
              </TouchableOpacity>
              <TouchableOpacity testID="accept-plan-btn" style={s.acceptBtn} onPress={() => handleVote('accepted')} disabled={voting}>
                {voting ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="checkmark-circle-outline" size={20} color="#fff" /><Text style={s.acceptBtnText}>Annehmen</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {plan?.status === 'accepted' && (
          <View style={s.successCard}>
            <Ionicons name="checkmark-circle" size={22} color="#1D9E75" />
            <Text style={s.successText}>Plan ist akzeptiert! 🎉</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#1A1C1B', marginBottom: 2 },
  pageSub: { fontSize: 13, color: '#6E7170', marginBottom: 14 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  calcBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#E1F5EE', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14 },
  exportPlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F0FBF7', borderWidth: 1, borderColor: '#1D9E75', borderRadius: 10, paddingVertical: 11, paddingHorizontal: 14 },
  calcBtnText: { color: '#1D9E75', fontWeight: '600', fontSize: 13 },
  stageCard: { borderLeftWidth: 4, borderRadius: 10, padding: 12, marginBottom: 12 },
  stageHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  stageLabel: { fontSize: 13, fontWeight: '700' },
  kidoMsg: { fontSize: 13, color: '#1A1C1B', lineHeight: 18 },
  privateCard: { backgroundColor: '#FFF8EC', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1.5, borderColor: '#F4C27A' },
  privateHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  privateTitle: { fontSize: 13, fontWeight: '700', color: '#BA7517' },
  privateMsg: { fontSize: 13, color: '#1A1C1B', lineHeight: 19, marginBottom: 10 },
  reconsiderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#E1F5EE', borderRadius: 10, paddingVertical: 10, marginBottom: 6 },
  reconsiderText: { color: '#1D9E75', fontWeight: '600', fontSize: 13 },
  tryNextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EEEDFE', borderRadius: 10, paddingVertical: 10 },
  tryNextText: { color: '#5B3FD4', fontWeight: '600', fontSize: 13 },
  waitCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F0F2F1', borderRadius: 10, padding: 12, marginBottom: 12 },
  waitText: { flex: 1, fontSize: 12, color: '#6E7170', lineHeight: 17 },
  escalateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#EEEDFE', borderRadius: 10, paddingVertical: 11, marginBottom: 12 },
  escalateText: { color: '#5B3FD4', fontWeight: '600', fontSize: 13 },
  subgroupsCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  subgroupsTitle: { fontSize: 14, fontWeight: '700', color: '#5B3FD4', marginBottom: 10 },
  subgroupRow: { marginBottom: 10 },
  subgroupLabel: { fontSize: 12, color: '#6E7170', marginBottom: 4 },
  subgroupMembers: { flexDirection: 'row', gap: 4 },
  subAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  subAvatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  subgroupNote: { fontSize: 11, color: '#6E7170', fontStyle: 'italic', marginTop: 6 },
  gridCard: { backgroundColor: '#fff', borderRadius: 12, padding: 10, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  proposalCard: { backgroundColor: '#FBFAFF', borderWidth: 1, borderColor: '#EEEDFE' },
  gridTitle: { fontSize: 11, fontWeight: '700', color: '#6E7170', letterSpacing: 1, marginBottom: 8, paddingHorizontal: 4 },
  proposalHint: { backgroundColor: '#EEEDFE', borderRadius: 8, padding: 8, marginBottom: 8 },
  proposalHintText: { fontSize: 12, color: '#3C3489', textAlign: 'center', lineHeight: 17 },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#6E7170' },
  emptyText: { fontSize: 13, color: '#aaa', textAlign: 'center', maxWidth: 260 },
  votesCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  votesTitle: { fontSize: 14, fontWeight: '600', color: '#1A1C1B', marginBottom: 8 },
  voteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  voterName: { fontSize: 13, color: '#1A1C1B' },
  voteBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 14 },
  voteBadgeAccepted: { backgroundColor: '#E1F5EE' },
  voteBadgeDeclined: { backgroundColor: '#FCEBEB' },
  voteBadgePending: { backgroundColor: '#FAEEDA' },
  voteBadgeText: { fontSize: 11, fontWeight: '600' },
  voteActions: { marginBottom: 12 },
  voteBtns: { flexDirection: 'row', gap: 10 },
  declineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: '#E24B4A', borderRadius: 10, paddingVertical: 12 },
  declineBtnText: { color: '#E24B4A', fontWeight: '600', fontSize: 14 },
  acceptBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 12 },
  acceptBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  successCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E1F5EE', borderRadius: 10, padding: 14, marginBottom: 8 },
  successText: { color: '#1D9E75', fontWeight: '700', fontSize: 14 },
});

const cg = StyleSheet.create({
  headerRow: { flexDirection: 'row', marginBottom: 3 },
  nameCol: { width: 64, paddingRight: 4, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerCell: { width: CELL_W, alignItems: 'center', marginHorizontal: 1 },
  headerWeek: { fontSize: 10, fontWeight: '600', color: '#8E9190', letterSpacing: 0.5 },
  memberRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  avatar: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  memberName: { fontSize: 10, color: '#6E7170', flex: 1 },
  cell: { width: CELL_W, height: CELL_H, borderRadius: 6, alignItems: 'center', justifyContent: 'center', marginHorizontal: 1 },
  cellText: { fontSize: 12, fontWeight: '600' },
});
