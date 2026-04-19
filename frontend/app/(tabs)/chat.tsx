import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity,
  ActivityIndicator, Modal, TextInput, Alert, RefreshControl,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../../context/UserContext';
import { api } from '../../services/api';

export default function ChatOverviewScreen() {
  const { user } = useUser();
  const params = useLocalSearchParams<{ channel?: string }>();
  const [channels, setChannels] = useState<any[]>([]);
  const [chain, setChain] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeChannel, setActiveChannel] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [kidoText, setKidoText] = useState('');
  const [kidoMsgs, setKidoMsgs] = useState<any[]>([]);
  const [newSubModal, setNewSubModal] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [newSubMembers, setNewSubMembers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!user?.chainId || !user?.chainMemberId) return;
    try {
      const [c, chs, km] = await Promise.all([
        api.getChain(user.chainId),
        api.listChannels(user.chainId, user.chainMemberId).catch(() => []),
        api.getKidoMessages(user.userId!).catch(() => []),
      ]);
      setChain(c);
      // Auto-create default channels if missing - wrap in try so errors don't block UI
      try { await ensureDefaultChannels(c, chs); } catch (err) { console.error('ensureDefaultChannels error', err); }
      const updated = await api.listChannels(user.chainId, user.chainMemberId).catch(() => chs);
      setChannels(updated);
      setKidoMsgs(km);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [user?.chainId, user?.chainMemberId, user?.userId]);

  const ensureDefaultChannels = async (c: any, existing: any[]) => {
    if (!c || !c.members || !user?.chainMemberId) return;
    const existingTypes = new Set(existing.map((ch: any) => ch.type));
    const hasKido = existingTypes.has('kido');
    const hasChain = existingTypes.has('chain');
    const allMemberIds = c.members.map((m: any) => m.id);
    try {
      if (!hasKido) {
        await api.createChannel({ chain_id: c.id, name: 'Kido', type: 'kido', member_ids: allMemberIds, icon: 'sparkles', color: '#1D9E75' });
      }
      if (!hasChain) {
        await api.createChannel({ chain_id: c.id, name: 'Ganze Kette', type: 'chain', member_ids: allMemberIds, icon: 'people', color: '#5B3FD4' });
      }
      for (const m of c.members) {
        if (m.id === user.chainMemberId) continue;
        const pairKey = [user.chainMemberId, m.id].sort().join('|');
        const exists = existing.find((ch: any) => ch.type === 'direct' && [...(ch.member_ids || [])].sort().join('|') === pairKey);
        if (!exists) {
          try {
            await api.createChannel({ chain_id: c.id, name: m.user_name, type: 'direct', member_ids: [user.chainMemberId, m.id], icon: 'person', color: m.avatar_color });
          } catch (e) { console.error('Failed to create direct', e); }
        }
      }
    } catch (e) { console.error('ensureDefaultChannels', e); }
  };

  useEffect(() => { load(); }, [load]);

  const openChannel = async (ch: any) => {
    setActiveChannel(ch);
    if (ch.type === 'kido') return;  // handled separately
    const msgs = await api.listChannelMessages(ch.id);
    setMessages(msgs);
  };

  const sendChannelMsg = async () => {
    if (!text.trim() || !activeChannel) return;
    setSending(true);
    try {
      await api.sendChannelMessage({ channel_id: activeChannel.id, sender_id: user!.chainMemberId, sender_name: user!.userName, text: text.trim() });
      const msgs = await api.listChannelMessages(activeChannel.id);
      setMessages(msgs);
      setText('');
    } catch (e: any) { Alert.alert('Fehler', e.message); } finally { setSending(false); }
  };

  const sendKido = async () => {
    if (!kidoText.trim() || !user?.userId) return;
    setSending(true);
    try {
      await api.sendMessage({ sender_id: user.userId, receiver_type: 'kido', receiver_id: user.userId, text: kidoText.trim() });
      const km = await api.getKidoMessages(user.userId);
      setKidoMsgs(km); setKidoText('');
    } catch (e: any) { Alert.alert('Fehler', e.message); } finally { setSending(false); }
  };

  const createSubgroup = async () => {
    if (!newSubName.trim() || newSubMembers.length < 2) {
      Alert.alert('Pflicht', 'Bitte Namen und mindestens 2 Mitglieder wählen.');
      return;
    }
    try {
      await api.createChannel({
        chain_id: user!.chainId, name: newSubName.trim(),
        type: 'subgroup_manual', member_ids: newSubMembers,
        created_by: user!.chainMemberId, icon: 'people-circle', color: '#F472B6'
      });
      setNewSubModal(false); setNewSubName(''); setNewSubMembers([]); load();
    } catch (e: any) { Alert.alert('Fehler', e.message); }
  };

  if (loading) return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color="#1D9E75" size="large" /></View></SafeAreaView>;

  const kidoCh = channels.find((c: any) => c.type === 'kido');
  const directChs = channels.filter((c: any) => c.type === 'direct');
  const chainCh = channels.find((c: any) => c.type === 'chain');
  const subgroups = channels.filter((c: any) => c.type === 'subgroup_manual' || c.type === 'subgroup_auto');

  // Chat detail view
  if (activeChannel) {
    const isKido = activeChannel.type === 'kido';
    const msgs = isKido ? kidoMsgs : messages;
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.chatHeader}>
          <TouchableOpacity onPress={() => { setActiveChannel(null); setMessages([]); }}>
            <Ionicons name="arrow-back" size={24} color="#1A1C1B" />
          </TouchableOpacity>
          <View style={[s.chanAvatar, { backgroundColor: activeChannel.color || '#1D9E75' }]}>
            <Ionicons name={(activeChannel.icon || 'chatbubble') as any} size={18} color="#fff" />
          </View>
          <Text style={s.chatHeaderTitle} numberOfLines={1}>{activeChannel.name}</Text>
        </View>
        <ScrollView contentContainerStyle={s.msgScroll}>
          {msgs.length === 0 && <Text style={s.emptyMsg}>Noch keine Nachrichten.</Text>}
          {msgs.map((m: any) => {
            const mine = isKido ? m.sender_id === user?.userId : m.sender_id === user?.chainMemberId;
            const isKidoMsg = isKido && m.sender_id !== user?.userId;
            return (
              <View key={m.id} style={[s.msgRow, mine && { alignSelf: 'flex-end' }]}>
                {!mine && !isKido && <Text style={s.senderName}>{m.sender_name}</Text>}
                <View style={[s.msgBubble, mine ? s.msgBubbleMine : (isKidoMsg ? s.msgBubbleKido : s.msgBubbleOther)]}>
                  <Text style={mine ? s.msgTextMine : s.msgTextOther}>{m.text}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
        <View style={s.inputRow}>
          <TextInput testID="chat-input" style={s.chatInput}
            value={isKido ? kidoText : text}
            onChangeText={isKido ? setKidoText : setText}
            placeholder="Nachricht..." placeholderTextColor="#aaa" />
          <TouchableOpacity testID="chat-send-btn" style={s.sendBtn} onPress={isKido ? sendKido : sendChannelMsg} disabled={sending}>
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        <View style={s.titleRow}>
          <Text style={s.pageTitle}>Nachrichten</Text>
          <View style={s.kidoTag}><Text style={s.kidoTagText}>Kido</Text></View>
        </View>

        {/* Kido Channel */}
        {kidoCh && (
          <>
            <Text style={s.section}>KIDO</Text>
            <TouchableOpacity testID="channel-kido" style={s.chanRow} onPress={() => openChannel(kidoCh)}>
              <View style={[s.chanAvatarLg, { backgroundColor: '#E1F5EE' }]}>
                <Ionicons name="sparkles" size={22} color="#1D9E75" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.chanName}>Kido</Text>
                <Text style={s.chanPreview}>Dein persönlicher Begleiter</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#6E7170" />
            </TouchableOpacity>
          </>
        )}

        {/* Direct Messages */}
        {directChs.length > 0 && (
          <>
            <Text style={s.section}>DIREKTNACHRICHTEN</Text>
            {directChs.map((ch: any) => {
              const otherMemberId = ch.member_ids.find((id: string) => id !== user?.chainMemberId);
              const other = chain?.members?.find((m: any) => m.id === otherMemberId);
              return (
                <TouchableOpacity key={ch.id} testID={`channel-direct-${ch.id}`} style={s.chanRow} onPress={() => openChannel(ch)}>
                  <View style={[s.chanAvatarLg, { backgroundColor: other?.avatar_color || '#8B5CF6' }]}>
                    <Text style={s.chanAvatarText}>{other?.user_name?.[0] || '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.chanName}>{other?.user_name || ch.name}</Text>
                    <Text style={s.chanPreview}>1:1 Privatchat</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#6E7170" />
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* Group Channels */}
        <View style={s.sectionHeaderRow}>
          <Text style={s.section}>GRUPPENKANAL</Text>
          <TouchableOpacity testID="new-subgroup-btn" style={s.newSubBtn} onPress={() => setNewSubModal(true)}>
            <Ionicons name="add-circle" size={18} color="#1D9E75" />
            <Text style={s.newSubBtnText}>Neue Subgruppe</Text>
          </TouchableOpacity>
        </View>
        {chainCh && (
          <TouchableOpacity testID="channel-chain" style={s.chanRow} onPress={() => openChannel(chainCh)}>
            <View style={[s.chanAvatarLg, { backgroundColor: '#EEEDFE' }]}>
              <Ionicons name="people" size={22} color="#5B3FD4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.chanName}>Ganze Kette</Text>
              <Text style={s.chanPreview}>{chain?.members?.length || 0} Mitglieder</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6E7170" />
          </TouchableOpacity>
        )}
        {subgroups.map((ch: any) => (
          <TouchableOpacity key={ch.id} testID={`channel-sub-${ch.id}`} style={s.chanRow} onPress={() => openChannel(ch)}>
            <View style={[s.chanAvatarLg, { backgroundColor: ch.color || '#F472B6' }]}>
              <Ionicons name="people-circle" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={s.chanName}>{ch.name}</Text>
                <View style={[s.tag, { backgroundColor: ch.type === 'subgroup_auto' ? '#FAEEDA' : '#E1F5EE' }]}>
                  <Text style={[s.tagText, { color: ch.type === 'subgroup_auto' ? '#BA7517' : '#1D9E75' }]}>
                    {ch.type === 'subgroup_auto' ? 'Auto' : 'Eigene'}
                  </Text>
                </View>
              </View>
              <Text style={s.chanPreview}>{ch.member_ids.length} Mitglieder</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#6E7170" />
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* New Subgroup Modal */}
      <Modal visible={newSubModal} animationType="slide" transparent onRequestClose={() => setNewSubModal(false)}>
        <View style={s.overlay}>
          <View style={s.modalBox}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Neue Subgruppe</Text>
              <TouchableOpacity onPress={() => setNewSubModal(false)} testID="close-subgroup-modal">
                <Ionicons name="close" size={24} color="#6E7170" />
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={s.modalLabel}>Name</Text>
              <TextInput testID="subgroup-name-input" style={s.modalInput} value={newSubName} onChangeText={setNewSubName} placeholder="z.B. Mama & Papa direkt" placeholderTextColor="#aaa" />
              <Text style={s.modalLabel}>Mitglieder auswählen</Text>
              {chain?.members?.map((m: any) => {
                const selected = newSubMembers.includes(m.id);
                return (
                  <TouchableOpacity key={m.id} testID={`sub-member-${m.user_name.replace(/\s/g,'')}`}
                    style={[s.memberChoice, selected && { borderColor: '#1D9E75', backgroundColor: '#F0FBF7' }]}
                    onPress={() => setNewSubMembers(prev => selected ? prev.filter(x => x !== m.id) : [...prev, m.id])}>
                    <View style={[s.memberAvatar, { backgroundColor: m.avatar_color }]}>
                      <Text style={s.memberAvatarText}>{m.user_name[0]}</Text>
                    </View>
                    <Text style={s.memberName}>{m.user_name}</Text>
                    <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? '#1D9E75' : '#ccc'} style={{ marginLeft: 'auto' }} />
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity testID="save-subgroup-btn" style={s.saveBtn} onPress={createSubgroup}>
                <Text style={s.saveBtnText}>Subgruppe erstellen</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  scroll: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  pageTitle: { flex: 1, fontSize: 22, fontWeight: '700', color: '#1A1C1B' },
  kidoTag: { backgroundColor: '#E1F5EE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  kidoTagText: { color: '#1D9E75', fontWeight: '600', fontSize: 12 },
  section: { fontSize: 11, fontWeight: '700', color: '#6E7170', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  newSubBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#E1F5EE', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  newSubBtnText: { color: '#1D9E75', fontSize: 12, fontWeight: '600' },
  chanRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 6 },
  chanAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  chanAvatarLg: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  chanAvatarText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  chanName: { fontSize: 15, fontWeight: '600', color: '#1A1C1B' },
  chanPreview: { fontSize: 12, color: '#6E7170', marginTop: 2 },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  tagText: { fontSize: 9, fontWeight: '700' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: '#E5E8E7', backgroundColor: '#fff' },
  chatHeaderTitle: { fontSize: 17, fontWeight: '700', color: '#1A1C1B', flex: 1 },
  msgScroll: { padding: 16, gap: 8 },
  emptyMsg: { textAlign: 'center', color: '#999', marginTop: 30 },
  msgRow: { maxWidth: '80%', alignSelf: 'flex-start' },
  senderName: { fontSize: 10, color: '#6E7170', marginBottom: 2, marginLeft: 10 },
  msgBubble: { padding: 10, borderRadius: 14 },
  msgBubbleMine: { backgroundColor: '#1D9E75', borderBottomRightRadius: 4 },
  msgBubbleKido: { backgroundColor: '#EEEDFE', borderBottomLeftRadius: 4 },
  msgBubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 4 },
  msgTextMine: { color: '#fff', fontSize: 14 },
  msgTextOther: { color: '#1A1C1B', fontSize: 14 },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: '#E5E8E7', backgroundColor: '#fff' },
  chatInput: { flex: 1, borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#F7F9F8', color: '#1A1C1B' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1A1C1B' },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#1A1C1B', marginTop: 8, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 8, padding: 12, marginBottom: 10, color: '#1A1C1B' },
  memberChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, marginBottom: 6, borderWidth: 1.5, borderColor: '#E5E8E7' },
  memberAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  memberAvatarText: { color: '#fff', fontWeight: '700' },
  memberName: { fontSize: 14, fontWeight: '600', color: '#1A1C1B' },
  saveBtn: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
