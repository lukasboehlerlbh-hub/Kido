import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../context/UserContext';
import { api } from '../services/api';

export default function RelationshipsScreen() {
  const { user } = useUser();
  const [chain, setChain] = useState<any>(null);
  const [coparents, setCoparents] = useState<any[]>([]);
  const [couples, setCouples] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Coparent modal
  const [cpModal, setCpModal] = useState(false);
  const [cpPartner, setCpPartner] = useState('');
  const [cpChildren, setCpChildren] = useState<string[]>([]);
  const [cpChildInput, setCpChildInput] = useState('');
  // Couple modal
  const [coupleModal, setCoupleModal] = useState(false);
  const [couplePartner, setCouplePartner] = useState('');
  const [coupleSync, setCoupleSync] = useState('none');

  const load = useCallback(async () => {
    if (!user?.chainId) return;
    try {
      const [c, cp, cu, chk] = await Promise.all([
        api.getChain(user.chainId),
        api.listCoparents(user.chainId),
        api.listCouples(user.chainId),
        api.consistencyCheck(user.chainId),
      ]);
      setChain(c); setCoparents(cp); setCouples(cu); setIssues(chk.issues || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [user?.chainId]);

  useEffect(() => { load(); }, [load]);

  const otherMembers = (chain?.members || []).filter((m: any) => m.id !== user?.chainMemberId);
  const memberName = (id: string) => (chain?.members || []).find((m: any) => m.id === id)?.user_name || '?';
  const memberColor = (id: string) => (chain?.members || []).find((m: any) => m.id === id)?.avatar_color || '#999';

  const addCpChild = () => {
    const v = cpChildInput.trim();
    if (!v) return;
    setCpChildren(prev => [...prev, v]); setCpChildInput('');
  };
  const saveCoparent = async () => {
    if (!cpPartner) { Alert.alert('Fehler', 'Bitte Co-Elternteil wählen.'); return; }
    try {
      await api.createCoparent({
        chain_id: user?.chainId, parent1_id: user?.chainMemberId, parent2_id: cpPartner,
        children: cpChildren.map(n => ({ name: n })),
      });
      setCpModal(false); setCpPartner(''); setCpChildren([]); setCpChildInput(''); load();
    } catch (e: any) { Alert.alert('Fehler', e.message); }
  };
  const delCoparent = async (id: string) => {
    await api.deleteCoparent(id); load();
  };

  const saveCouple = async () => {
    if (!couplePartner) { Alert.alert('Fehler', 'Bitte Partner*in wählen.'); return; }
    try {
      await api.createCouple({
        chain_id: user?.chainId, partner1_id: user?.chainMemberId, partner2_id: couplePartner,
        sync_pref: coupleSync,
      });
      setCoupleModal(false); setCouplePartner(''); setCoupleSync('none'); load();
    } catch (e: any) { Alert.alert('Fehler', e.message); }
  };
  const confirmCouple = async (id: string) => { await api.confirmCouple(id); load(); };
  const delCouple = async (id: string) => { await api.deleteCouple(id); load(); };

  if (loading) return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color="#1A1C1B" /></TouchableOpacity>
        <Text style={s.headerTitle}>Beziehungen</Text>
      </View>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Consistency Issues */}
        {issues.length > 0 && (
          <View style={s.issuesCard}>
            <View style={s.issuesHeader}>
              <Ionicons name="warning-outline" size={22} color="#BA7517" />
              <Text style={s.issuesTitle}>Konsistenz-Hinweise ({issues.length})</Text>
            </View>
            {issues.map((iss, i) => (
              <View key={i} style={s.issueRow}>
                <View style={[s.issueDot, { backgroundColor: iss.severity === 'warning' ? '#E24B4A' : '#BA7517' }]} />
                <Text style={s.issueText}>{iss.message}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Co-Parents */}
        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionTitle}>Mit wem hast du Kinder?</Text>
          <TouchableOpacity testID="add-coparent-btn" style={s.addBtn} onPress={() => setCpModal(true)}>
            <Ionicons name="add" size={18} color="#1D9E75" />
            <Text style={s.addBtnText}>Co-Eltern</Text>
          </TouchableOpacity>
        </View>
        {coparents.filter((cp: any) => cp.parent1_id === user?.chainMemberId || cp.parent2_id === user?.chainMemberId).map((cp: any) => {
          const otherId = cp.parent1_id === user?.chainMemberId ? cp.parent2_id : cp.parent1_id;
          return (
            <View key={cp.id} style={s.relCard}>
              <View style={[s.relAvatar, { backgroundColor: memberColor(otherId) }]}>
                <Text style={s.relAvatarText}>{memberName(otherId)[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.relName}>{memberName(otherId)}</Text>
                {cp.children?.length > 0 && (
                  <View style={s.childRow}>
                    {cp.children.map((ch: any, i: number) => (
                      <View key={i} style={s.childChip}><Text style={s.childChipText}>{ch.name}</Text></View>
                    ))}
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => delCoparent(cp.id)}>
                <Ionicons name="trash-outline" size={20} color="#E24B4A" />
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Couple */}
        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionTitle}>Aktuelle Partnerschaft</Text>
          <TouchableOpacity testID="add-couple-btn" style={s.addBtn} onPress={() => setCoupleModal(true)}>
            <Ionicons name="add" size={18} color="#5B3FD4" />
            <Text style={[s.addBtnText, { color: '#5B3FD4' }]}>Partner*in</Text>
          </TouchableOpacity>
        </View>
        {couples.filter((c: any) => c.partner1_id === user?.chainMemberId || c.partner2_id === user?.chainMemberId).map((c: any) => {
          const otherId = c.partner1_id === user?.chainMemberId ? c.partner2_id : c.partner1_id;
          const syncLabel = { same: 'Gleichzeitig Kinder', opposite: 'Abwechselnd Kinder', none: 'Keine Präferenz' }[c.sync_pref as string] || c.sync_pref;
          return (
            <View key={c.id} style={[s.relCard, { borderLeftWidth: 3, borderLeftColor: '#5B3FD4' }]}>
              <View style={[s.relAvatar, { backgroundColor: memberColor(otherId) }]}>
                <Ionicons name="heart" size={16} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.relName}>{memberName(otherId)}</Text>
                <Text style={s.relSub}>{syncLabel} · {c.confirmed_by_both ? '✓ Bestätigt' : '⏳ Nicht bestätigt'}</Text>
              </View>
              {!c.confirmed_by_both && (
                <TouchableOpacity onPress={() => confirmCouple(c.id)} style={s.confirmBtn}>
                  <Text style={s.confirmBtnText}>Bestätigen</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => delCouple(c.id)}>
                <Ionicons name="trash-outline" size={20} color="#E24B4A" />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Coparent Modal */}
      <Modal visible={cpModal} animationType="slide" transparent onRequestClose={() => setCpModal(false)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Co-Eltern hinzufügen</Text>
              <TouchableOpacity onPress={() => setCpModal(false)}><Ionicons name="close" size={24} color="#6E7170" /></TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={s.modalLabel}>Co-Elternteil</Text>
              {otherMembers.map((m: any) => (
                <TouchableOpacity key={m.id} testID={`cp-${m.user_name.replace(/\s/g,'')}`}
                  style={[s.memberChoice, cpPartner === m.id && { borderColor: '#1D9E75', backgroundColor: '#F0FBF7' }]}
                  onPress={() => setCpPartner(m.id)}>
                  <View style={[s.memberAvatar, { backgroundColor: m.avatar_color }]}><Text style={s.memberAvatarText}>{m.user_name[0]}</Text></View>
                  <Text style={s.memberName}>{m.user_name}</Text>
                  {cpPartner === m.id && <Ionicons name="checkmark-circle" size={22} color="#1D9E75" style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              ))}
              <Text style={s.modalLabel}>Gemeinsame Kinder</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput testID="cp-child-input" style={[s.modalInput, { flex: 1 }]} value={cpChildInput} onChangeText={setCpChildInput} placeholder="Name" placeholderTextColor="#aaa" onSubmitEditing={addCpChild} />
                <TouchableOpacity testID="add-cp-child" style={s.plusBtn} onPress={addCpChild}><Ionicons name="add" size={20} color="#1D9E75" /></TouchableOpacity>
              </View>
              {cpChildren.length > 0 && (
                <View style={s.childRow}>
                  {cpChildren.map((ch, i) => (
                    <TouchableOpacity key={i} style={s.childChip} onPress={() => setCpChildren(prev => prev.filter((_, j) => j !== i))}>
                      <Text style={s.childChipText}>{ch} ✕</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity testID="save-coparent-btn" style={s.saveBtn} onPress={saveCoparent}><Text style={s.saveBtnText}>Speichern</Text></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Couple Modal */}
      <Modal visible={coupleModal} animationType="slide" transparent onRequestClose={() => setCoupleModal(false)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Partnerschaft hinzufügen</Text>
              <TouchableOpacity onPress={() => setCoupleModal(false)}><Ionicons name="close" size={24} color="#6E7170" /></TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={s.modalLabel}>Partner*in</Text>
              {otherMembers.map((m: any) => (
                <TouchableOpacity key={m.id} testID={`couple-${m.user_name.replace(/\s/g,'')}`}
                  style={[s.memberChoice, couplePartner === m.id && { borderColor: '#5B3FD4', backgroundColor: '#F3F1FE' }]}
                  onPress={() => setCouplePartner(m.id)}>
                  <View style={[s.memberAvatar, { backgroundColor: m.avatar_color }]}><Text style={s.memberAvatarText}>{m.user_name[0]}</Text></View>
                  <Text style={s.memberName}>{m.user_name}</Text>
                  {couplePartner === m.id && <Ionicons name="heart" size={22} color="#5B3FD4" style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              ))}
              <Text style={s.modalLabel}>Kinder-Timing mit Partner*in</Text>
              {[
                { val: 'same', label: 'Gleichzeitig – wir wollen beide an den gleichen Wochenenden Kinder haben', color: '#1D9E75' },
                { val: 'opposite', label: 'Abwechselnd – wir wollen nie gleichzeitig Kinder haben', color: '#E24B4A' },
                { val: 'none', label: 'Keine Präferenz', color: '#6E7170' },
              ].map(opt => (
                <TouchableOpacity key={opt.val} testID={`sync-${opt.val}`}
                  style={[s.syncChoice, coupleSync === opt.val && { borderColor: opt.color, backgroundColor: '#fff' }]}
                  onPress={() => setCoupleSync(opt.val)}>
                  <Ionicons name={coupleSync === opt.val ? 'radio-button-on' : 'radio-button-off'} size={22} color={opt.color} />
                  <Text style={s.syncText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity testID="save-couple-btn" style={[s.saveBtn, { backgroundColor: '#5B3FD4' }]} onPress={saveCouple}><Text style={s.saveBtnText}>Speichern</Text></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: '#E5E8E7', backgroundColor: '#fff' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1A1C1B' },
  scroll: { padding: 16, paddingBottom: 32 },
  issuesCard: { backgroundColor: '#FFF8EC', borderWidth: 1.5, borderColor: '#F4C27A', borderRadius: 10, padding: 14, marginBottom: 18 },
  issuesHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  issuesTitle: { fontSize: 14, fontWeight: '700', color: '#BA7517' },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  issueDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  issueText: { flex: 1, fontSize: 13, color: '#1A1C1B', lineHeight: 18 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1A1C1B' },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 10 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E1F5EE', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  addBtnText: { color: '#1D9E75', fontSize: 12, fontWeight: '600' },
  relCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 6 },
  relAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  relAvatarText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  relName: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  relSub: { fontSize: 11, color: '#6E7170', marginTop: 2 },
  childRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  childChip: { backgroundColor: '#E1F5EE', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  childChipText: { fontSize: 11, fontWeight: '600', color: '#1D9E75' },
  confirmBtn: { backgroundColor: '#5B3FD4', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1A1C1B' },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#1A1C1B', marginTop: 10, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 8, padding: 12, marginBottom: 8, color: '#1A1C1B' },
  plusBtn: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#1D9E75', backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center' },
  memberChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, marginBottom: 6, borderWidth: 1.5, borderColor: '#E5E8E7' },
  memberAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { color: '#fff', fontWeight: '700' },
  memberName: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  syncChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1.5, borderColor: '#E5E8E7', backgroundColor: '#F7F9F8' },
  syncText: { flex: 1, fontSize: 13, color: '#1A1C1B', lineHeight: 18 },
  saveBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16, marginBottom: 8 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
