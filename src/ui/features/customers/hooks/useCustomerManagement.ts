import { useState, useEffect } from 'react';
import { useAuthStore } from '../../../../store/authStore';
import { useCustomerStore } from '../../../../store/customerStore';
import { customerService, type Customer } from '../../../../services/customerService';
import { tenantService, type Profile } from '../../../../services/tenantService';
import { formatPhoneForDB, formatPhoneForInput } from '../../../../utils/phoneUtils';
import { MESSAGES } from '../../../../config/constants';
import { useToast } from '../../../../context/ToastContext';
import { usePermissions } from '../../../../hooks/usePermissions';
import { Logger } from '../../../../utils/logger';

export interface CustomerFormData {
    id?: string;
    businessName: string;
    contactName: string;
    phone: string;
    address: string;
    department: string;
    municipality: string;
    identificationNumber: string;
    internalCode: string;
    notes: string;
    status: 'activo' | 'inactivo';
    price_type: 'empleado' | 'cliente' | 'mayoreo';
    assigned_seller_id: string;
}

export interface UseCustomerManagementReturn {
    // 1. Estado de Formulario y Modal
    formData: CustomerFormData;
    isModalOpen: boolean;
    isSubmitting: boolean;
    error: string | null;

    // 2. Controladores de Estado Ligero (UI)
    updateField: (field: keyof CustomerFormData, value: string) => void;
    openCreateModal: () => void;
    openEditModal: (customer: Customer) => void;
    closeModal: () => void;

    // 3. Operaciones Hacia el Servidor
    handleSaveCustomer: (e: React.SyntheticEvent) => Promise<void>;
    handleDeleteCustomer: (customerId: string) => Promise<void>; // Stub preparado para V2
    handleAssignSeller: (customerId: string, sellerId: string) => Promise<void>;

    // 4. Vendedores
    sellers: Profile[];
    isAssigningSeller: string | null;
}

/**
 * @hook useCustomerManagement
 * Envoltura lógica interactiva para el directorio de clientes.
 */
export const useCustomerManagement = (): UseCustomerManagementReturn => {
    const { profile } = useAuthStore();
    const { addCustomer, updateCustomer } = useCustomerStore();
    const { showToast } = useToast();
    const { canAssignSeller } = usePermissions();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [sellers, setSellers] = useState<Profile[]>([]);
    const [isAssigningSeller, setIsAssigningSeller] = useState<string | null>(null);

    const [formData, setFormData] = useState<CustomerFormData>({
        businessName: '',
        contactName: '',
        phone: '',
        address: '',
        department: '',
        municipality: '',
        identificationNumber: '',
        internalCode: '',
        notes: '',
        status: 'activo',
        price_type: 'cliente',
        assigned_seller_id: '',
    });

    // Cargar vendedores si el usuario tiene permisos
    useEffect(() => {
        if (profile?.tenant_id && canAssignSeller) {
            tenantService.getTenantEmployees(profile.tenant_id)
                .then(emps => setSellers(emps))
                .catch(err => console.error('Error fetching sellers', err));
        }
    }, [profile?.tenant_id, profile?.role]);

    const updateField = (field: keyof CustomerFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const clearInputs = () => {
        setFormData({
            businessName: '',
            contactName: '',
            phone: '',
            address: '',
            department: '',
            municipality: '',
            identificationNumber: '',
            internalCode: '',
            notes: '',
            status: 'activo',
            price_type: 'cliente',
            assigned_seller_id: ''
        });
    };

    const openCreateModal = () => {
        clearInputs();
        setError(null);
        setIsModalOpen(true);
    };

    const openEditModal = (customer: Customer) => {
        setFormData({
            id: customer.id,
            businessName: customer.business_name,
            contactName: customer.contact_name || '',
            phone: formatPhoneForInput(customer.phone),
            address: customer.address || '',
            department: customer.department || '',
            municipality: customer.municipality || '',
            identificationNumber: customer.identification_number || '',
            internalCode: customer.internal_code || '',
            notes: customer.notes || '',
            status: customer.status || 'activo',
            price_type: customer.price_type || 'cliente',
            assigned_seller_id: customer.assigned_seller_id || '',
        });
        setError(null);
        setIsModalOpen(true);
        console.log('[useCustomerManagement] Editar open:', customer.id);
    };

    const closeModal = () => {
        setIsModalOpen(false);
    };

    const handleSaveCustomer = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isSubmitting) return;

        if (!profile?.tenant_id) {
            setError(MESSAGES.ERROR.NO_TENANT);
            return;
        }

        const normalizedPhone = formatPhoneForDB(formData.phone);

        const dataToSubmit = {
            tenant_id: profile.tenant_id,
            business_name: formData.businessName,
            contact_name: formData.contactName || null,
            phone: normalizedPhone,
            address: formData.address || null,
            department: formData.department || null,
            municipality: formData.municipality || null,
            identification_number: formData.identificationNumber || null,
            internal_code: formData.internalCode || null,
            notes: formData.notes || null,
            status: formData.status,
            price_type: formData.price_type,
            assigned_seller_id: formData.assigned_seller_id || null,
        };

        setError(null);
        setIsSubmitting(true);

        try {
            if (formData.id) {
                const updated = await customerService.updateCustomer(formData.id, dataToSubmit);
                updateCustomer(formData.id, updated);
                showToast('Cliente actualizado correctamente.', 'success');
            } else {
                const newCustomer = await customerService.createCustomer(dataToSubmit);
                addCustomer(newCustomer);
                showToast('Cliente creado correctamente.', 'success');
            }
            setIsModalOpen(false);
            clearInputs();
        } catch (err: unknown) {
            Logger.error('Error al guardar/actualizar cliente', { action: formData.id ? 'updateCustomer' : 'createCustomer', customerId: formData.id }, err);
            const msg = err instanceof Error ? err.message : MESSAGES.ERROR.CUSTOMER_SAVE;
            setError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteCustomer = async (customerId: string) => {
        // TODO: Soft-delete con modal de confirmación
        console.log('[useCustomerManagement] Eliminar cliente:', customerId);
    };

    const handleAssignSeller = async (customerId: string, sellerId: string) => {
        if (isAssigningSeller) return;
        setIsAssigningSeller(customerId);
        try {
            const finalSellerId = sellerId === 'unassigned' ? null : sellerId;
            await customerService.updateCustomerSeller(customerId, finalSellerId);
            updateCustomer(customerId, { assigned_seller_id: finalSellerId });
            showToast('Asignación actualizada correctamente.', 'success');
        } catch (err: any) {
            Logger.error('Error al asignar vendedor a cliente', { customerId, sellerId }, err);
            showToast('No se pudo reasignar al vendedor. Intenta de nuevo.', 'error');
        } finally {
            setIsAssigningSeller(null);
        }
    };

    return {
        formData,
        isModalOpen,
        isSubmitting,
        error,
        updateField,
        openCreateModal,
        openEditModal,
        closeModal,
        handleSaveCustomer,
        handleDeleteCustomer,
        handleAssignSeller,
        sellers: sellers.map(s => ({
            ...s,
            // Normalizar role a string para la UI legado pero mantener roles como array internamente
            role: Array.isArray(s.role) ? s.role[0] : s.role
        })),
        isAssigningSeller,
    };
};
