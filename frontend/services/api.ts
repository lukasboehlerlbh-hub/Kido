const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

async function req(method: string, path: string, body?: any) {
  const url = `${BASE}/api${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  // Users
  getUserByPhone: (phone: string) => req('GET', `/users/phone/${encodeURIComponent(phone)}`),
  updateUser: (id: string, data: any) => req('PUT', `/users/${id}`, data),

  // Chains
  createChain: (d: any) => req('POST', '/chains', d),
  getChain: (id: string) => req('GET', `/chains/${id}`),

  // Invitations
  createInvitation: (d: any) => req('POST', '/invitations', d),
  getInvitation: (token: string) => req('GET', `/invitations/${token}`),
  acceptInvitation: (token: string, d: any) => req('POST', `/invitations/${token}/accept`, d),

  // Members
  updatePreferences: (memberId: string, d: any) => req('PUT', `/chain-members/${memberId}/preferences`, d),
  getMember: (memberId: string) => req('GET', `/chain-members/${memberId}`),

  // Weekend Plans
  getWeekendPlan: (chainId: string) => req('GET', `/chains/${chainId}/weekend-plan`),
  calculatePlan: (chainId: string) => req('POST', `/chains/${chainId}/calculate-plan`, {}),
  votePlan: (planId: string, memberId: string, vote: string) =>
    req('POST', `/weekend-plans/${planId}/vote`, { member_id: memberId, vote }),
  reconsiderPlan: (planId: string) => req('POST', `/weekend-plans/${planId}/reconsider`, {}),
  tryNextPivot: (planId: string) => req('POST', `/weekend-plans/${planId}/try-next-pivot`, {}),
  escalateTo3b: (planId: string) => req('POST', `/weekend-plans/${planId}/escalate-3b`, {}),

  // Holiday Wishes
  getHolidayWishes: (chainId: string, year?: number, viewerMemberId?: string) => {
    const params = new URLSearchParams();
    if (year) params.append('year', String(year));
    if (viewerMemberId) params.append('viewer_member_id', viewerMemberId);
    const q = params.toString();
    return req('GET', `/chains/${chainId}/holiday-wishes${q ? `?${q}` : ''}`);
  },
  createHolidayWish: (d: any) => req('POST', '/holiday-wishes', d),
  updateHolidayWish: (id: string, d: any) => req('PUT', `/holiday-wishes/${id}`, d),

  // Messages
  getChainMessages: (chainId: string) => req('GET', `/chains/${chainId}/messages`),
  getDirectMessages: (u1: string, u2: string) => req('GET', `/messages/direct/${u1}/${u2}`),
  getKidoMessages: (userId: string) => req('GET', `/messages/kido/${userId}`),
  sendMessage: (d: any) => req('POST', '/messages', d),

  // Swiss Holidays
  getSwissHolidays: (kanton: string, year: number) => req('GET', `/swiss-holidays/${kanton}/${year}`),

  // Dev seed
  seedTestChain: () => req('POST', '/dev/seed-test-chain', {}),
};
