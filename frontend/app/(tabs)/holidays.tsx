import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, RefreshControl, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../../context/UserContext';
import { api } from '../../services/api';
import { buildICS, addDays, exportICS } from '../../utils/icsExport';

const KANTONS = ['ZH', 'BE', 'SG', 'AG', 'BS'];
const YEARS = [2026, 2027, 2028];
const WISH_LABELS: Record<string, string> = { ich: 'Ich', andere: 'Andere', flexibel: 'Flexibel' };
const WISH_COLORS: Record<string, string> = { ich: '#E1F5EE', andere: '#FAEEDA', flexibel: '#F0F2F1' };
const WISH_TEXT_COLORS: Record<string, string> = { ich: '#1D9E75', andere: '#BA7517', flexibel: '#6E7170' };
const STATUS_COLORS: Record<string, string> = { pending: '#FAEEDA', accepted: '#E1F5EE', declined: '#FCEBEB' };
const STATUS_TEXT: Record<string, string> = { pending: 'Offen', accepted: 'Geregelt', declined: 'Abgelehnt' };
const PERIOD_TYPES = ['fruehling', 'sommer', 'herbst', 'weihnachten', 'custom'];
const PERIOD_LABELS: Record<string, string> = { fruehling: 'Frühlingsferien', sommer: 'Sommerferien', herbst: 'Herbstferien', weihnachten: 'Weihnachtsferien', custom: 'Benutzerdefiniert' };

export default function HolidaysScreen() {
  const { user } = useUser();
  const [kanton, setKanton] = useState(user?.kanton || 'ZH');
  const [year, setYear] = useState(2026);
  const [swissHols, setSwissHols] = useState<any[]>([]);
  const [wishes, setWishes] = useState<any[]>([]);
  const [chain, setChain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [newWish, setNewWish] = useState<any>({
    title: '', period_type: 'sommer', period_label: 'Sommerferien',
    date_from: '', date_to: '', wish: 'flexibel', wish_target_member_id: null,
    is_shared: false, note: '', children_names: [] as string[],
  });
  const [childInput, setChildInput] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.chainId) return;
    try {
      const [hols, w, c] = await Promise.all([
        api.getSwissHolidays(kanton, year),
        api.getHolidayWishes(user.chainId, year, user.chainMemberId),
        api.getChain(user.chainId),
      ]);
      setSwissHols(hols);
      setWishes(w);
      setChain(c);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [kanton, year, user?.chainId, user?.chainMemberId]);

  useEffect(() => { setLoading(true); load(); }, [kanton, year, load]);

  const getWishForHol = (hol: any) =>
    wishes.find(w => w.member_id === user?.chainMemberId &&
      w.period_type === hol.type && w.year === year);

  const handleAddWish = async () => {
    if (!newWish.date_from || !newWish.date_to) {
      Alert.alert('Pflichtfelder', 'Bitte Datum von und bis eingeben (YYYY-MM-DD).');
      return;
    }
    if (newWish.wish === 'partner' && !newWish.wish_target_member_id) {
      Alert.alert('Pflichtfeld', 'Bitte Person auswählen mit der du die Ferien absprichst.');
      return;
    }
    setSaving(true);
    try {
      const w = await api.createHolidayWish({
        member_id: user?.chainMemberId,
        chain_id: user?.chainId,
        year,
        period_type: newWish.period_type,
        period_label: newWish.period_label,
        title: newWish.title || undefined,
        date_from: newWish.date_from,
        date_to: newWish.date_to,
        wish: newWish.wish,
        wish_target_member_id: newWish.wish === 'partner' ? newWish.wish_target_member_id : null,
        children_names: newWish.children_names,
        is_shared: newWish.is_shared,
        note: newWish.note || undefined,
      });
      setWishes(prev => [...prev, w]);
      setAddModal(false);
      setNewWish({ title: '', period_type: 'sommer', period_label: 'Sommerferien', date_from: '', date_to: '', wish: 'flexibel', wish_target_member_id: null, is_shared: false, note: '', children_names: [] });
      setChildInput('');
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    } finally { setSaving(false); }
  };

  const handleAddChild = () => {
    const v = childInput.trim();
    if (!v) return;
    setNewWish((p: any) => ({ ...p, children_names: [...(p.children_names || []), v] }));
    setChildInput('');
  };

  const handleRemoveChild = (name: string) => {
    setNewWish((p: any) => ({ ...p, children_names: (p.children_names || []).filter((c: string) => c !== name) }));
  };

  const handleRespondWish = async (wishId: string, field: 'status' | 'partner_status', value: 'accepted' | 'declined') => {
    try {
      const updated = await api.updateHolidayWish(wishId, { [field]: value });
      setWishes(prev => prev.map(w => w.id === wishId ? updated : w));
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    }
  };

  const handleExportICS = async () => {
    const events = swissHols.map(h => ({
      uid: `kido-hol-${kanton}-${h.date_from}@kido.app`,
      start: h.date_from,
      end: addDays(h.date_to, 1),
      summary: `Schulferien ${kanton}: ${h.label}`,
      description: `Kido – Schulferien ${kanton} ${year}`,
    }));
    const ics = buildICS(events, `Kido Ferien ${kanton} ${year}`);
    await exportICS(ics, `kido-ferien-${kanton}-${year}.ics`);
  };

  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;
  }

  const sharedWishes = wishes.filter(w => w.is_shared && w.member_id !== user?.chainMemberId);
  const privateToMe = wishes.filter(w => !w.is_shared && w.wish_target_member_id === user?.chainMemberId && w.member_id !== user?.chainMemberId);

  const otherMembers = (chain?.members || []).filter((m: any) => m.id !== user?.chainMemberId);
  const memberNameById = (mid: string) => (chain?.members || []).find((m: any) => m.id === mid)?.user_name || '?';

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#1D9E75" />}>

        <View style={s.titleRow}>
          <Text style={s.pageTitle}>Ferienplanung</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity testID="export-ics-btn" style={s.exportBtn} onPress={handleExportICS}>
              <Ionicons name="calendar-outline" size={20} color="#1D9E75" />
            </TouchableOpacity>
            <TouchableOpacity testID="add-wish-btn" style={s.addBtn} onPress={() => setAddModal(true)}>
              <Ionicons name="add" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Canton Selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.kantonRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {KANTONS.map(k => (
            <TouchableOpacity testID={`kanton-${k}`} key={k} style={[s.pill, kanton === k && s.pillActive]} onPress={() => setKanton(k)}>
              <Text style={[s.pillText, kanton === k && s.pillTextActive]}>{k}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Year Selector */}
        <View style={s.yearRow}>
          {YEARS.map(y => (
            <TouchableOpacity testID={`year-${y}`} key={y} style={[s.yearBtn, year === y && s.yearBtnActive]} onPress={() => setYear(y)}>
              <Text style={[s.yearText, year === y && s.yearTextActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Swiss Holidays */}
        <Text style={s.sectionTitle}>Schulferien {kanton} {year}</Text>
        {swissHols.map((hol, i) => {
          const myWish = getWishForHol(hol);
          return (
            <View key={i} style={s.holCard}>
              <View style={s.holHeader}>
                <View style={s.holIconBox}>
                  <Ionicons name={hol.type === 'sommer' ? 'sunny' : hol.type === 'weihnachten' ? 'snow' : 'leaf'} size={18} color="#BA7517" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.holLabel}>{hol.label}</Text>
                  <Text style={s.holDate}>
                    {new Date(hol.date_from + 'T00:00:00').toLocaleDateString('de-CH')} – {new Date(hol.date_to + 'T00:00:00').toLocaleDateString('de-CH')}
                  </Text>
                </View>
                {myWish && (
                  <View style={[s.wishBadge, { backgroundColor: WISH_COLORS[myWish.wish] }]}>
                    <Text style={[s.wishBadgeText, { color: WISH_TEXT_COLORS[myWish.wish] }]}>
                      {myWish.wish === 'partner' ? `mit ${memberNameById(myWish.wish_target_member_id)}` : WISH_LABELS[myWish.wish]}
                    </Text>
                  </View>
                )}
              </View>
              {myWish?.title && <Text style={s.wishTitle}>{myWish.title}</Text>}
              {myWish?.children_names && myWish.children_names.length > 0 && (
                <View style={s.childChips}>
                  {myWish.children_names.map((c: string) => (
                    <View key={c} style={s.childChip}><Text style={s.childChipText}>{c}</Text></View>
                  ))}
                </View>
              )}
              {myWish && (
                <View style={s.statusRow}>
                  <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[myWish.status] || '#F0F2F1' }]}>
                    <Text style={s.statusText}>{STATUS_TEXT[myWish.status] || myWish.status}</Text>
                  </View>
                  {myWish.wish === 'partner' && myWish.wish_target_member_id && (
                    <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[myWish.partner_status] || '#F0F2F1' }]}>
                      <Text style={s.statusText}>
                        {memberNameById(myWish.wish_target_member_id).split(' ')[0]}: {STATUS_TEXT[myWish.partner_status] || 'Ausstehend'}
                      </Text>
                    </View>
                  )}
                  {myWish.is_shared && (
                    <View style={[s.statusBadge, { backgroundColor: '#EEEDFE' }]}>
                      <Text style={[s.statusText, { color: '#5B3FD4' }]}>✓ Mit Kette geteilt</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}

        {/* Private invites to me */}
        {privateToMe.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Absprache-Anfragen an dich (privat)</Text>
            {privateToMe.map((w: any) => (
              <View key={w.id} style={[s.sharedCard, { borderLeftWidth: 3, borderLeftColor: '#5B3FD4' }]}>
                <View style={s.sharedHeader}>
                  <View style={[s.sharedAvatar, { backgroundColor: '#EEEDFE' }]}>
                    <Text style={s.sharedAvatarText}>{memberNameById(w.member_id)?.[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sharedLabel}>{w.title || w.period_label}</Text>
                    <Text style={s.sharedDate}>{memberNameById(w.member_id)} · {w.date_from} – {w.date_to}</Text>
                  </View>
                </View>
                {w.note && <Text style={s.sharedNote}>&quot;{w.note}&quot;</Text>}
                {w.partner_status === 'pending' && (
                  <View style={s.sharedActions}>
                    <TouchableOpacity testID={`decline-partner-wish-${w.id}`} style={s.declineWishBtn} onPress={() => handleRespondWish(w.id, 'partner_status', 'declined')}>
                      <Text style={s.declineWishText}>Ablehnen</Text>
                    </TouchableOpacity>
                    <TouchableOpacity testID={`accept-partner-wish-${w.id}`} style={s.acceptWishBtn} onPress={() => handleRespondWish(w.id, 'partner_status', 'accepted')}>
                      <Text style={s.acceptWishText}>Annehmen</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {w.partner_status !== 'pending' && (
                  <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[w.partner_status], marginTop: 8 }]}>
                    <Text style={s.statusText}>{STATUS_TEXT[w.partner_status]}</Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {/* Shared Wishes from Others */}
        {sharedWishes.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Wünsche der Kette</Text>
            {sharedWishes.map((w: any) => (
              <View key={w.id} style={s.sharedCard}>
                <View style={s.sharedHeader}>
                  <View style={s.sharedAvatar}>
                    <Text style={s.sharedAvatarText}>{memberNameById(w.member_id)?.[0]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sharedLabel}>{w.title || w.period_label}</Text>
                    <Text style={s.sharedDate}>{memberNameById(w.member_id)} · {w.date_from} – {w.date_to}</Text>
                  </View>
                  <View style={[s.wishBadge, { backgroundColor: WISH_COLORS[w.wish] }]}>
                    <Text style={[s.wishBadgeText, { color: WISH_TEXT_COLORS[w.wish] }]}>
                      {w.wish === 'partner' ? `mit ${memberNameById(w.wish_target_member_id)?.split(' ')[0]}` : WISH_LABELS[w.wish]}
                    </Text>
                  </View>
                </View>
                {w.children_names && w.children_names.length > 0 && (
                  <View style={s.childChips}>
                    {w.children_names.map((c: string) => (
                      <View key={c} style={s.childChip}><Text style={s.childChipText}>{c}</Text></View>
                    ))}
                  </View>
                )}
                {w.status === 'pending' && (
                  <View style={s.sharedActions}>
                    <TouchableOpacity testID={`decline-wish-${w.id}`} style={s.declineWishBtn} onPress={() => handleRespondWish(w.id, 'status', 'declined')}>
                      <Text style={s.declineWishText}>Ablehnen</Text>
                    </TouchableOpacity>
                    <TouchableOpacity testID={`accept-wish-${w.id}`} style={s.acceptWishBtn} onPress={() => handleRespondWish(w.id, 'status', 'accepted')}>
                      <Text style={s.acceptWishText}>Annehmen</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Add Wish Modal */}
      <Modal visible={addModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={s.overlay}>
            <View style={s.modalBox}>
              <Text style={s.modalTitle}>Ferienwunsch erfassen</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={s.modalLabel}>Titel (optional)</Text>
                <TextInput testID="wish-title-input" style={s.modalInput} value={newWish.title} onChangeText={v => setNewWish((p: any) => ({ ...p, title: v }))} placeholder="z.B. Familie Camping Tessin" placeholderTextColor="#aaa" />

                <Text style={s.modalLabel}>Ferientyp</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                  {PERIOD_TYPES.map(pt => (
                    <TouchableOpacity key={pt} testID={`period-type-${pt}`} style={[s.typePill, newWish.period_type === pt && s.typePillActive]}
                      onPress={() => setNewWish((p: any) => ({ ...p, period_type: pt, period_label: PERIOD_LABELS[pt] }))}>
                      <Text style={[s.typePillText, newWish.period_type === pt && s.typePillTextActive]}>{PERIOD_LABELS[pt]}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={s.modalLabel}>Von (YYYY-MM-DD)</Text>
                <TextInput testID="date-from-input" style={s.modalInput} value={newWish.date_from} onChangeText={v => setNewWish((p: any) => ({ ...p, date_from: v }))} placeholder={`${year}-07-07`} placeholderTextColor="#aaa" />
                <Text style={s.modalLabel}>Bis (YYYY-MM-DD)</Text>
                <TextInput testID="date-to-input" style={s.modalInput} value={newWish.date_to} onChangeText={v => setNewWish((p: any) => ({ ...p, date_to: v }))} placeholder={`${year}-08-10`} placeholderTextColor="#aaa" />

                <Text style={s.modalLabel}>Kinder</Text>
                <View style={s.childInputRow}>
                  <TextInput
                    testID="child-name-input"
                    style={[s.modalInput, { flex: 1, marginBottom: 0 }]}
                    value={childInput}
                    onChangeText={setChildInput}
                    placeholder="Name hinzufügen"
                    placeholderTextColor="#aaa"
                    onSubmitEditing={handleAddChild}
                  />
                  <TouchableOpacity testID="add-child-btn" style={s.addChildBtn} onPress={handleAddChild}>
                    <Ionicons name="add" size={20} color="#1D9E75" />
                  </TouchableOpacity>
                </View>
                {newWish.children_names && newWish.children_names.length > 0 && (
                  <View style={[s.childChips, { marginBottom: 14 }]}>
                    {newWish.children_names.map((c: string) => (
                      <TouchableOpacity key={c} style={s.childChipRemovable} onPress={() => handleRemoveChild(c)}>
                        <Text style={s.childChipText}>{c}</Text>
                        <Ionicons name="close" size={14} color="#6E7170" />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                <Text style={s.modalLabel}>Mein Wunsch</Text>
                <View style={s.wishRow}>
                  {['ich', 'partner', 'flexibel'].map(w => (
                    <TouchableOpacity key={w} testID={`wish-${w}`} style={[s.wishPill, newWish.wish === w && { backgroundColor: WISH_COLORS[w], borderColor: WISH_TEXT_COLORS[w] }]}
                      onPress={() => setNewWish((p: any) => ({ ...p, wish: w }))}>
                      <Text style={[s.wishPillText, newWish.wish === w && { color: WISH_TEXT_COLORS[w] }]}>{WISH_LABELS[w]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {newWish.wish === 'partner' && (
                  <>
                    <Text style={s.modalLabel}>Mit welcher Person?</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
                      {otherMembers.map((m: any) => (
                        <TouchableOpacity
                          key={m.id}
                          testID={`target-${m.user_name.replace(/\s/g, '')}`}
                          style={[s.memberPill, newWish.wish_target_member_id === m.id && { borderColor: m.avatar_color, backgroundColor: '#fff' }]}
                          onPress={() => setNewWish((p: any) => ({ ...p, wish_target_member_id: m.id }))}
                        >
                          <View style={[s.mAvatar, { backgroundColor: m.avatar_color }]}>
                            <Text style={s.mAvatarText}>{m.user_name[0]}</Text>
                          </View>
                          <Text style={s.memberPillText}>{m.user_name.split(' ')[0]}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </>
                )}

                <TouchableOpacity testID="share-toggle" style={s.shareRow} onPress={() => setNewWish((p: any) => ({ ...p, is_shared: !p.is_shared }))}>
                  <Ionicons name={newWish.is_shared ? 'checkbox' : 'square-outline'} size={22} color="#1D9E75" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.shareText}>Mit ganzer Kette teilen</Text>
                    <Text style={s.shareSub}>
                      {newWish.is_shared
                        ? 'Alle Kettenmitglieder sehen diesen Wunsch.'
                        : newWish.wish === 'partner' && newWish.wish_target_member_id
                          ? `Nur du und ${memberNameById(newWish.wish_target_member_id).split(' ')[0]} sehen das.`
                          : 'Nur du siehst diesen Wunsch.'}
                    </Text>
                  </View>
                </TouchableOpacity>

                <TextInput testID="wish-note-input" style={[s.modalInput, { height: 72, textAlignVertical: 'top' }]} value={newWish.note} onChangeText={v => setNewWish((p: any) => ({ ...p, note: v }))} placeholder="Bemerkung (optional)" multiline placeholderTextColor="#aaa" />
                <TouchableOpacity testID="save-wish-btn" style={[s.saveBtn, saving && { opacity: 0.7 }]} onPress={handleAddWish} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Speichern</Text>}
                </TouchableOpacity>
              </ScrollView>
              <TouchableOpacity testID="close-wish-modal" onPress={() => setAddModal(false)}>
                <Text style={s.cancelText}>Abbrechen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 20, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: '#1A1C1B' },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  exportBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1D9E75' },
  kantonRow: { marginBottom: 12 },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F0F2F1', borderWidth: 1, borderColor: 'transparent' },
  pillActive: { backgroundColor: '#E1F5EE', borderColor: '#1D9E75' },
  pillText: { fontSize: 13, fontWeight: '600', color: '#6E7170' },
  pillTextActive: { color: '#1D9E75' },
  yearRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  yearBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F0F2F1' },
  yearBtnActive: { backgroundColor: '#1D9E75' },
  yearText: { fontSize: 14, fontWeight: '600', color: '#6E7170' },
  yearTextActive: { color: '#fff' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#1A1C1B', marginBottom: 10, marginTop: 4 },
  holCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  holHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  holIconBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FAEEDA', alignItems: 'center', justifyContent: 'center' },
  holLabel: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  holDate: { fontSize: 12, color: '#6E7170', marginTop: 2 },
  wishBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  wishBadgeText: { fontSize: 11, fontWeight: '600' },
  statusBadge: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  statusText: { fontSize: 11, color: '#6E7170', fontWeight: '500' },
  sharedCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 },
  sharedHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sharedAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#CECBF6', alignItems: 'center', justifyContent: 'center' },
  sharedAvatarText: { fontSize: 14, fontWeight: '700', color: '#5B3FD4' },
  sharedLabel: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  sharedDate: { fontSize: 12, color: '#6E7170' },
  sharedActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  declineWishBtn: { flex: 1, borderWidth: 1, borderColor: '#E24B4A', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  declineWishText: { color: '#E24B4A', fontWeight: '600', fontSize: 13 },
  acceptWishBtn: { flex: 1, backgroundColor: '#1D9E75', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  acceptWishText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: '90%' },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#1A1C1B', marginBottom: 16 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#1A1C1B', marginBottom: 6 },
  modalInput: { borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 10, padding: 12, fontSize: 14, color: '#1A1C1B', marginBottom: 14 },
  typePill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F0F2F1', borderWidth: 1, borderColor: 'transparent' },
  typePillActive: { backgroundColor: '#E1F5EE', borderColor: '#1D9E75' },
  typePillText: { fontSize: 12, color: '#6E7170' },
  typePillTextActive: { color: '#1D9E75', fontWeight: '600' },
  wishRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  wishPill: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#F0F2F1', alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  wishPillText: { fontSize: 13, fontWeight: '600', color: '#6E7170' },
  shareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14, padding: 10, backgroundColor: '#F7F9F8', borderRadius: 8 },
  shareText: { fontSize: 14, color: '#1A1C1B', fontWeight: '600' },
  shareSub: { fontSize: 11, color: '#6E7170', marginTop: 2 },
  wishTitle: { fontSize: 13, fontWeight: '600', color: '#1A1C1B', marginTop: 8, fontStyle: 'italic' },
  childChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  childChip: { backgroundColor: '#E1F5EE', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  childChipRemovable: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E1F5EE', borderRadius: 12, paddingLeft: 10, paddingRight: 6, paddingVertical: 5 },
  childChipText: { fontSize: 11, fontWeight: '600', color: '#1D9E75' },
  childInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 },
  addChildBtn: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: '#1D9E75', backgroundColor: '#E1F5EE', alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  memberPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F0F2F1', paddingLeft: 4, paddingRight: 12, paddingVertical: 4, borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
  memberPillText: { fontSize: 13, fontWeight: '600', color: '#1A1C1B' },
  mAvatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  mAvatarText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  sharedNote: { fontSize: 12, color: '#6E7170', fontStyle: 'italic', marginTop: 6 },
  saveBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4, marginBottom: 8 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  cancelText: { textAlign: 'center', color: '#6E7170', fontSize: 15, paddingVertical: 8 },
});
