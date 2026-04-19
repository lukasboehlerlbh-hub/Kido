import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface UserData {
  userId: string;
  userName: string;
  userPhone: string;
  avatarColor: string;
  chainId: string;
  chainMemberId: string;
  chainName: string;
  kanton: string;
  prefsSet: boolean;
}

interface UserContextType {
  user: UserData | null;
  loading: boolean;
  setUser: (u: UserData) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (partial: Partial<UserData>) => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null, loading: true,
  setUser: async () => {}, logout: async () => {}, updateUser: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('kido_user').then(s => {
      if (s) setUserState(JSON.parse(s));
    }).finally(() => setLoading(false));
  }, []);

  const setUser = async (u: UserData) => {
    await AsyncStorage.setItem('kido_user', JSON.stringify(u));
    setUserState(u);
  };

  const logout = async () => {
    await AsyncStorage.removeItem('kido_user');
    setUserState(null);
  };

  const updateUser = async (partial: Partial<UserData>) => {
    if (!user) return;
    const updated = { ...user, ...partial };
    await setUser(updated);
  };

  return (
    <UserContext.Provider value={{ user, loading, setUser, logout, updateUser }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);
