import { create } from 'zustand';
import type { UserProfile } from '../services/authService';
import type { Permission } from '../services/permissionService';

interface AuthState {
    profile: UserProfile | null;
    permissions: Permission[];
    serverTime: string | null;
    isLoading: boolean;
    setAuth: (profile: UserProfile | null, permissions?: Permission[], serverTime?: string | null) => void;
    logout: () => void;
    stopLoading: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    profile: null,
    permissions: [],
    serverTime: null,
    isLoading: true,
    setAuth: (profile, permissions = [], serverTime = null) =>
        set({ profile, permissions, serverTime, isLoading: false }),
    logout: () => set({ profile: null, permissions: [], serverTime: null, isLoading: false }),
    stopLoading: () => set({ isLoading: false }),
}));
