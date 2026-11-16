import { useAuthStore } from '../store/authStore';
import { checkPermissions } from '../utils/permissionUtils';

export const usePermissions = () => {
    const { profile } = useAuthStore();
    return checkPermissions(profile?.role);
};
