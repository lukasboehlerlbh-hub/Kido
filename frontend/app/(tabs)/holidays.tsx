import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, RefreshControl, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../../context/UserContext';
import { api } from '../../services/api';

const KANTONS = ['ZH', 'BE', 'SG', 'AG', 'BS'];
const YEARS = [2025, 2026];
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
  const [year, setYear] = useState(new Date().getFullYear() < 2026 ? 2025 : 2026);
  const [swissHols, setSwissHols] = useState<any[]>([]);
  const [wishes, setWishes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [newWish, setNewWish] = useState({ period_type: 'sommer', period_label: 'Sommerferien', date_from: '', date_to: '', wish: 'flexibel', is_shared: false, note: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.chainId) return;
    try {
      const [hols, w] = await Promise.all([
        api.getSwissHolidays(kanton, year),
        api.getHolidayWishes(user.chainId, year),
      ]);
      setSwissHols(hols);
      setWishes(w);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [kanton, year, user?.chainId]);

  useEffect(() => { setLoading(true); load(); }, [kanton, year, load]);

  const getWishForHol = (hol: any) =>
    wishes.find(w => w.member_id === user?.chainMemberId &&
      w.period_type === hol.type && w.year === year);

  const handleAddWish = async () => {
    if (!newWish.date_from || !newWish.date_to) {
      Alert.alert('Pflichtfelder', 'Bitte Datum von und bis eingeben (YYYY-MM-DD).');
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
        date_from: newWish.date_from,
        date_to: newWish.date_to,
        wish: newWish.wish,
        is_shared: newWish.is_shared,
        note: newWish.note || undefined,
      });
      setWishes(prev => [...prev, w]);
      setAddModal(false);
      setNewWish({ period_type: 'sommer', period_label: 'Sommerferien', date_from: '', date_to: '', wish: 'flexibel', is_shared: false, note: '' });
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    } finally { setSaving(false); }
  };

  const handleRespondWish = async (wishId: string, status: 'accepted' | 'declined') => {
    try {
      const updated = await api.updateHolidayWish(wishId, { status });
      setWishes(prev => prev.map(w => w.id === wishId ? updated : w));
    } catch (e: any) {
      Alert.alert('Fehler', e.message);
    }
  };

  if (loading) {
    return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;
  }

  const sharedWishes = wishes.filter(w => w.is_shared && w.member_id !== user?.chainMemberId);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#1D9E75" />}>

        <View style={s.titleRow}>
          <Text style={s.pageTitle}>Ferienplanung</Text>
          <TouchableOpacity testID="add-wish-btn" style={s.addBtn} onPress={() => setAddModal(true)}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
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
                      {WISH_LABELS[myWish.wish]}
                    </Text>
                  </View>
                )}
              </View>
              {myWish && (
                <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[myWish.status] || '#F0F2F1' }]}>
                  <Text style={s.statusText}>{STATUS_TEXT[myWish.status] || myWish.status}</Text>
                </View>
              )}
            </View>
          );
        })}

        {/* Shared Wishes from Others */}
        {sharedWishes.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Wünsche der Kette</Text>
            {sharedWishes.map((w: any) => (
              <View key={w.id} style={s.sharedCard}>
                <View style={s.sharedHeader}>
                  <View style={s.sharedAvatar}>
                    <Text style={s.sharedAvatarText}>?</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sharedLabel}>{w.period_label}</Text>
                    <Text style={s.sharedDate}>{w.date_from} – {w.date_to}</Text>
                  </View>
                  <View style={[s.wishBadge, { backgroundColor: WISH_COLORS[w.wish] }]}>
                    <Text style={[s.wishBadgeText, { color: WISH_TEXT_COLORS[w.wish] }]}>{WISH_LABELS[w.wish]}</Text>
                  </View>
                </View>
                {w.status === 'pending' && (
                  <View style={s.sharedActions}>
                    <TouchableOpacity testID={`decline-wish-${w.id}`} style={s.declineWishBtn} onPress={() => handleRespondWish(w.id, 'declined')}>
                      <Text style={s.declineWishText}>Ablehnen</Text>
                    </TouchableOpacity>
                    <TouchableOpacity testID={`accept-wish-${w.id}`} style={s.acceptWishBtn} onPress={() => handleRespondWish(w.id, 'accepted')}>
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
                <Text style={s.modalLabel}>Ferientyp</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                  {PERIOD_TYPES.map(pt => (
                    <TouchableOpacity key={pt} testID={`period-type-${pt}`} style={[s.typePill, newWish.period_type === pt && s.typePillActive]}
                      onPress={() => setNewWish(p => ({ ...p, period_type: pt, period_label: PERIOD_LABELS[pt] }))}>
                      <Text style={[s.typePillText, newWish.period_type === pt && s.typePillTextActive]}>{PERIOD_LABELS[pt]}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={s.modalLabel}>Von (YYYY-MM-DD)</Text>
                <TextInput testID="date-from-input" style={s.modalInput} value={newWish.date_from} onChangeText={v => setNewWish(p => ({ ...p, date_from: v }))} placeholder={`${year}-07-07`} placeholderTextColor="#aaa" />
                <Text style={s.modalLabel}>Bis (YYYY-MM-DD)</Text>
                <TextInput testID="date-to-input" style={s.modalInput} value={newWish.date_to} onChangeText={v => setNewWish(p => ({ ...p, date_to: v }))} placeholder={`${year}-08-10`} placeholderTextColor="#aaa" />
                <Text style={s.modalLabel}>Mein Wunsch</Text>
                <View style={s.wishRow}>
                  {['ich', 'andere', 'flexibel'].map(w => (
                    <TouchableOpacity key={w} testID={`wish-${w}`} style={[s.wishPill, newWish.wish === w && { backgroundColor: WISH_COLORS[w], borderColor: WISH_TEXT_COLORS[w] }]}
                      onPress={() => setNewWish(p => ({ ...p, wish: w }))}>
                      <Text style={[s.wishPillText, newWish.wish === w && { color: WISH_TEXT_COLORS[w] }]}>{WISH_LABELS[w]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity testID="share-toggle" style={s.shareRow} onPress={() => setNewWish(p => ({ ...p, is_shared: !p.is_shared }))}>
                  <Ionicons name={newWish.is_shared ? 'checkbox' : 'square-outline'} size={22} color="#1D9E75" />
                  <Text style={s.shareText}>Mit Kette teilen</Text>
                </TouchableOpacity>
                <TextInput testID="wish-note-input" style={[s.modalInput, { height: 72, textAlignVertical: 'top' }]} value={newWish.note} onChangeText={v => setNewWish(p => ({ ...p, note: v }))} placeholder="Bemerkung (optional)" multiline placeholderTextColor="#aaa" />
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
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  shareText: { fontSize: 14, color: '#1A1C1B' },
  saveBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4, marginBottom: 8 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  cancelText: { textAlign: 'center', color: '#6E7170', fontSize: 15, paddingVertical: 8 },
});
