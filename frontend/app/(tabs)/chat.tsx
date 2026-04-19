import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '../../context/UserContext';
import { api } from '../../services/api';

type Channel = 'kido' | 'direkt' | 'gruppe';

const SHARP_WORDS = ['nie ', 'immer ', 'unmöglich', 'absurd', 'lächerlich', 'stur', 'egoist', 'egoistisch', 'idiot', 'blöd', 'lügen', 'manipulier'];

const ALT_SUGGESTIONS = [
  'Ich würde mir wünschen, dass wir das gemeinsam anders regeln könnten.',
  'Ich habe Bedenken zu diesem Thema. Können wir darüber sprechen?',
  'Das beschäftigt mich. Ich möchte es gerne gemeinsam lösen.',
];

function containsSharpWords(text: string): boolean {
  const lower = text.toLowerCase();
  return SHARP_WORDS.some(w => lower.includes(w));
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

export default function ChatScreen() {
  const { user } = useUser();
  const [channel, setChannel] = useState<Channel>('kido');
  const [members, setMembers] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedDirect, setSelectedDirect] = useState<any>(null);
  const [showModerationModal, setShowModerationModal] = useState(false);
  const [originalText, setOriginalText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const loadMembers = useCallback(async () => {
    if (!user?.chainId) return;
    try {
      const chain = await api.getChain(user.chainId);
      const others = (chain.members || []).filter((m: any) => m.user_id !== user.userId);
      setMembers(others);
    } catch (e) { console.error(e); }
  }, [user?.chainId, user?.userId]);

  const loadMessages = useCallback(async () => {
    if (!user) return;
    try {
      let msgs: any[] = [];
      if (channel === 'kido') {
        msgs = await api.getKidoMessages(user.userId).catch(() => []);
      } else if (channel === 'gruppe' && user.chainId) {
        msgs = await api.getChainMessages(user.chainId).catch(() => []);
      } else if (channel === 'direkt' && selectedDirect) {
        msgs = await api.getDirectMessages(user.userId, selectedDirect.user_id).catch(() => []);
      }
      setMessages(msgs);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [channel, user, selectedDirect]);

  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { setLoading(true); loadMessages(); }, [loadMessages]);

  // Poll every 5 seconds
  useEffect(() => {
    const timer = setInterval(loadMessages, 5000);
    return () => clearInterval(timer);
  }, [loadMessages]);

  const sendMessage = async (text: string, wasModerated = false, origText?: string) => {
    if (!text.trim() || !user) return;
    setSending(true);
    try {
      const payload: any = {
        sender_id: user.userId,
        text: text.trim(),
        was_moderated: wasModerated,
        original_text: origText,
      };
      if (channel === 'kido') payload.recipient_id = 'kido';
      else if (channel === 'gruppe') payload.chain_id = user.chainId;
      else if (channel === 'direkt' && selectedDirect) payload.recipient_id = selectedDirect.user_id;

      const result = await api.sendMessage(payload);
      const newMessages = [result.message];
      if (result.kido_response) newMessages.push(result.kido_response);
      setMessages(prev => [...prev, ...newMessages]);
      setInputText('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e: any) {
      console.error(e);
    } finally { setSending(false); }
  };

  const handleSend = () => {
    if (!inputText.trim()) return;
    if (containsSharpWords(inputText)) {
      setOriginalText(inputText);
      setShowModerationModal(true);
    } else {
      sendMessage(inputText);
    }
  };

  const isMyMessage = (msg: any) =>
    msg.sender_id === user?.userId || (channel === 'kido' && msg.sender_id !== 'kido' && msg.recipient_id === 'kido');

  return (
    <SafeAreaView style={s.safe}>
      {/* Channel Tabs */}
      <View style={s.tabBar}>
        {(['kido', 'direkt', 'gruppe'] as Channel[]).map(ch => (
          <TouchableOpacity
            key={ch}
            testID={`channel-tab-${ch}`}
            style={[s.tab, channel === ch && s.tabActive]}
            onPress={() => { setChannel(ch); setLoading(true); }}
          >
            <Ionicons
              name={ch === 'kido' ? 'sparkles' : ch === 'direkt' ? 'person' : 'people'}
              size={16}
              color={channel === ch ? '#1D9E75' : '#6E7170'}
            />
            <Text style={[s.tabText, channel === ch && s.tabTextActive]}>
              {ch === 'kido' ? 'Kido' : ch === 'direkt' ? 'Direkt' : 'Gruppe'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Direkt: member selector */}
      {channel === 'direkt' && (
        <View style={s.directSelector}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
            {members.map(m => (
              <TouchableOpacity
                key={m.id}
                testID={`direct-member-${m.id}`}
                style={[s.directPill, selectedDirect?.id === m.id && s.directPillActive]}
                onPress={() => setSelectedDirect(m)}
              >
                <View style={[s.directAvatar, { backgroundColor: m.avatar_color || '#1D9E75' }]}>
                  <Text style={s.directAvatarText}>{m.user_name?.[0]?.toUpperCase()}</Text>
                </View>
                <Text style={[s.directName, selectedDirect?.id === m.id && { color: '#1D9E75' }]}>
                  {m.user_name?.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            ))}
            {members.length === 0 && <Text style={s.noMembersText}>Keine anderen Mitglieder</Text>}
          </ScrollView>
        </View>
      )}

      {/* Kido intro */}
      {channel === 'kido' && messages.length === 0 && !loading && (
        <View style={s.kidoIntro}>
          <View style={s.kidoAvatar}>
            <Text style={s.kidoAvatarText}>K</Text>
          </View>
          <Text style={s.kidoIntroText}>
            Hallo! Ich bin Kido. Ich bin hier, um zu helfen – nicht zu urteilen. Was beschäftigt dich?
          </Text>
        </View>
      )}

      {/* Messages */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.msgList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {loading
            ? <ActivityIndicator color="#1D9E75" style={{ marginTop: 40 }} />
            : messages.length === 0
              ? <Text style={s.emptyMsg}>{channel === 'direkt' && !selectedDirect ? 'Person auswählen' : 'Noch keine Nachrichten'}</Text>
              : messages.map((msg: any, i: number) => {
                const isKido = msg.sender_id === 'kido' || msg.is_kido_message;
                const isMe = !isKido && isMyMessage(msg);
                return (
                  <View key={msg.id || i} style={[s.msgRow, isMe && s.msgRowRight, isKido && s.msgRowKido]}>
                    {isKido && (
                      <View style={s.kidoMsgAvatar}><Text style={s.kidoMsgAvatarText}>K</Text></View>
                    )}
                    <View style={[s.bubble, isMe ? s.bubbleMe : isKido ? s.bubbleKido : s.bubbleOther]}>
                      {msg.was_moderated && (
                        <View style={s.moderatedBadge}>
                          <Ionicons name="shield-checkmark" size={11} color="#1D9E75" />
                          <Text style={s.moderatedText}>Moderiert</Text>
                        </View>
                      )}
                      <Text style={[s.msgText, isMe && s.msgTextMe]}>{msg.text}</Text>
                      <Text style={[s.msgTime, isMe && s.msgTimeMe]}>{msg.created_date ? formatTime(msg.created_date) : ''}</Text>
                    </View>
                  </View>
                );
              })
          }
        </ScrollView>

        {/* Input */}
        <View style={s.inputRow}>
          {channel === 'gruppe' && (
            <View style={s.groupHint}>
              <Ionicons name="information-circle-outline" size={14} color="#6E7170" />
              <Text style={s.groupHintText}>Alle {members.length + 1} Personen sehen diese Nachricht</Text>
            </View>
          )}
          <View style={s.inputBox}>
            <TextInput
              testID="chat-input"
              style={s.textInput}
              placeholder="Nachricht schreiben..."
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={500}
              placeholderTextColor="#aaa"
            />
            <TouchableOpacity
              testID="send-msg-btn"
              style={[s.sendBtn, (!inputText.trim() || sending) && { opacity: 0.5 }]}
              onPress={handleSend}
              disabled={!inputText.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="send" size={18} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Tone Moderation Modal */}
      <Modal visible={showModerationModal} animationType="slide" transparent>
        <View style={s.modOverlay}>
          <View style={s.modBox}>
            <View style={s.modHeader}>
              <Ionicons name="shield-outline" size={24} color="#BA7517" />
              <Text style={s.modTitle}>Kido schlägt eine sanftere Formulierung vor</Text>
            </View>
            <Text style={s.modSub}>Deine Nachricht enthält möglicherweise scharfe Worte.</Text>

            {ALT_SUGGESTIONS.map((alt, i) => (
              <TouchableOpacity
                key={i}
                testID={`alt-suggestion-${i}`}
                style={s.altCard}
                onPress={() => { setShowModerationModal(false); sendMessage(alt, true, originalText); }}
              >
                <Text style={s.altText}>{alt}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              testID="send-original-btn"
              style={s.sendOriginalBtn}
              onPress={() => { setShowModerationModal(false); sendMessage(originalText, true, originalText); }}
            >
              <Text style={s.sendOriginalText}>Original senden</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="cancel-moderation-btn"
              onPress={() => setShowModerationModal(false)}
            >
              <Text style={s.modCancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F7F9F8' },
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E8E7' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#1D9E75' },
  tabText: { fontSize: 14, color: '#6E7170', fontWeight: '500' },
  tabTextActive: { color: '#1D9E75', fontWeight: '600' },
  directSelector: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E8E7' },
  directPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F0F2F1' },
  directPillActive: { backgroundColor: '#E1F5EE' },
  directAvatar: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  directAvatarText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  directName: { fontSize: 13, color: '#6E7170', fontWeight: '500' },
  noMembersText: { fontSize: 13, color: '#aaa', paddingVertical: 12 },
  kidoIntro: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 12, backgroundColor: '#F0ECFF', margin: 12, borderRadius: 14 },
  kidoAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#CECBF6', alignItems: 'center', justifyContent: 'center' },
  kidoAvatarText: { fontSize: 18, fontWeight: '800', color: '#5B3FD4' },
  kidoIntroText: { flex: 1, fontSize: 14, color: '#1A1C1B', lineHeight: 20, fontStyle: 'italic' },
  msgList: { padding: 16, paddingBottom: 8, gap: 8 },
  emptyMsg: { textAlign: 'center', color: '#aaa', fontSize: 14, marginTop: 40 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowRight: { flexDirection: 'row-reverse' },
  msgRowKido: { flexDirection: 'row' },
  kidoMsgAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#CECBF6', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  kidoMsgAvatarText: { fontSize: 14, fontWeight: '700', color: '#5B3FD4' },
  bubble: { maxWidth: '75%', borderRadius: 16, padding: 12, paddingBottom: 8 },
  bubbleMe: { backgroundColor: '#1D9E75', borderBottomRightRadius: 4 },
  bubbleKido: { backgroundColor: '#CECBF6', borderBottomLeftRadius: 4 },
  bubbleOther: { backgroundColor: '#fff', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  moderatedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 },
  moderatedText: { fontSize: 10, color: '#1D9E75' },
  msgText: { fontSize: 14, color: '#1A1C1B', lineHeight: 20 },
  msgTextMe: { color: '#fff' },
  msgTime: { fontSize: 10, color: '#aaa', marginTop: 4, alignSelf: 'flex-end' },
  msgTimeMe: { color: 'rgba(255,255,255,0.7)' },
  inputRow: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E5E8E7', paddingHorizontal: 16, paddingVertical: 8 },
  groupHint: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  groupHintText: { fontSize: 11, color: '#6E7170' },
  inputBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  textInput: { flex: 1, borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#1A1C1B', maxHeight: 100, backgroundColor: '#F7F9F8' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1D9E75', alignItems: 'center', justifyContent: 'center' },
  modOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  modTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#BA7517' },
  modSub: { fontSize: 13, color: '#6E7170', marginBottom: 16, lineHeight: 18 },
  altCard: { backgroundColor: '#F7F9F8', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#E5E8E7' },
  altText: { fontSize: 14, color: '#1A1C1B', lineHeight: 20 },
  sendOriginalBtn: { borderWidth: 1, borderColor: '#E5E8E7', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4, marginBottom: 8 },
  sendOriginalText: { color: '#6E7170', fontWeight: '600' },
  modCancelText: { textAlign: 'center', color: '#6E7170', fontSize: 15, paddingVertical: 8 },
});
