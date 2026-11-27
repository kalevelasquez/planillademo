import React, { useEffect, useRef, useState } from 'react';
import { X, PackagePlus, AlertTriangle, CheckCircle2, Plus, ImagePlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { InputField } from '../../../components/InputField';
import { useAuthStore } from '../../../../store/authStore';
import { validateProductImage } from '../../../../services/storageService';

interface AddProductForm {
    name: string;
    caliber: string;
    brand: string;
    quality: string;
    category: string;
    shipment_number: string;
    entry_date: string;
    available_quantity: string;
    price: string;
}

interface FormErrors {
    name?: string;
    caliber?: string;
    brand?: string;
    quality?: string;
    category?: string;
    shipment_number?: string;
    available_quantity?: string;
    price?: string;
}

interface CreatedProductSummary {
    name: string;
    caliber: string;
    brand: string;
    quality: string;
    category: string;
    shipment_number: string;
    available_quantity: number;
    price: number;
    status: 'active' | 'incomplete';
}

interface AddProductModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

const EMPTY_FORM: AddProductForm = {
    name: '',
    caliber: '',
    brand: '',
    quality: '',
    category: '',
    shipment_number: '',
    entry_date: '',
    available_quantity: '',
    price: '',
};

export const AddProductModal: React.FC<AddProductModalProps> = ({ onClose, onSuccess }) => {
    const { t } = useTranslation();
    const { profile, permissions } = useAuthStore();
    // Solo quien puede EDITAR inventario ve el control de imagen (las policies de storage/products
    // exigen inventario.edit para el UPDATE que aplica la imagen al grupo de lotes).
    const canUploadImage = permissions.find(p => p.resource === 'inventario')?.can_edit ?? false;
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageError, setImageError] = useState<string | null>(null);
    const [imageWarning, setImageWarning] = useState<string | null>(null);
    const [form, setForm] = useState<AddProductForm>(EMPTY_FORM);
    const [errors, setErrors] = useState<FormErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDuplicate, setIsDuplicate] = useState(false);
    const [successData, setSuccessData] = useState<CreatedProductSummary | null>(null);

    const upper = (s: string) => s.trim().toUpperCase();

    useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);

    const clearImage = () => {
        setImageFile(null);
        setImagePreview(null);
        setImageError(null);
        if (imageInputRef.current) imageInputRef.current.value = '';
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const invalid = validateProductImage(file);
        if (invalid) {
            clearImage();
            setImageError(t(invalid));
            return;
        }
        setImageError(null);
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
    };

    const validate = (): boolean => {
        const newErrors: FormErrors = {};
        if (!form.name.trim()) newErrors.name = 'Campo obligatorio';
        if (!form.caliber.trim()) newErrors.caliber = 'Campo obligatorio';
        if (!form.brand.trim()) newErrors.brand = 'Campo obligatorio';
        if (!form.quality.trim()) newErrors.quality = 'Campo obligatorio';
        if (!form.category.trim()) newErrors.category = 'Campo obligatorio';
        if (!form.shipment_number.trim()) newErrors.shipment_number = 'Campo obligatorio';

        const qty = Number(form.available_quantity);
        if (form.available_quantity === '' || isNaN(qty) || qty < 0 || !Number.isInteger(qty)) {
            newErrors.available_quantity = 'Debe ser un número entero ≥ 0';
        }

        const price = Number(form.price);
        if (form.price === '' || isNaN(price) || price <= 0) {
            newErrors.price = 'Debe ser un valor mayor a 0';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (field: keyof AddProductForm, value: string) => {
        setForm(prev => ({ ...prev, [field]: value }));
        if (errors[field as keyof FormErrors]) {
            setErrors(prev => ({ ...prev, [field]: undefined }));
        }
        if (isDuplicate) setIsDuplicate(false);
    };

    const handleSubmit = async () => {
        if (!validate() || !profile?.tenant_id) return;

        setIsSubmitting(true);
        setIsDuplicate(false);

        try {
            const { productService } = await import('../../../../services/productService');

            const result = await productService.createManualProduct({
                tenant_id: profile.tenant_id,
                name: form.name,
                caliber: form.caliber,
                brand: form.brand,
                quality: form.quality,
                category: form.category,
                shipment_number: form.shipment_number,
                entry_date: form.entry_date || null,
                available_quantity: Number(form.available_quantity),
                price: Number(form.price),
            });

            if (result.isDuplicate) {
                setIsDuplicate(true);
                return;
            }

            const qty = Number(form.available_quantity);
            setSuccessData({
                name: upper(form.name),
                caliber: upper(form.caliber),
                brand: upper(form.brand),
                quality: upper(form.quality),
                category: upper(form.category),
                shipment_number: upper(form.shipment_number),
                available_quantity: qty,
                price: Number(form.price),
                status: qty > 0 ? 'active' : 'incomplete',
            });

            // La imagen es opcional: si falla, el producto ya está creado (no se revierte).
            if (imageFile && canUploadImage && result.productId) {
                try {
                    await productService.setProductImage({
                        id: result.productId,
                        tenant_id: profile.tenant_id,
                        name: upper(form.name),
                        caliber: upper(form.caliber),
                        quality: upper(form.quality),
                    }, imageFile);
                } catch {
                    setImageWarning(t('inventory.image.uploadAfterCreate'));
                }
            }

            import('../../../../services/auditService').then(({ auditService }) => {
                auditService.logAction('CREATE', 'inventario', result.productId, {
                    name: upper(form.name),
                    brand: upper(form.brand),
                    shipment_number: upper(form.shipment_number),
                });
            });

            onSuccess();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Error al guardar el producto';
            setErrors({ name: msg });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleAddAnother = () => {
        setForm(EMPTY_FORM);
        setErrors({});
        setIsDuplicate(false);
        setSuccessData(null);
        setImageWarning(null);
        clearImage();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[640px] flex flex-col overflow-hidden animate-in zoom-in-95"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex justify-between items-center px-lg py-md border-b border-border bg-surface/50">
                    <div>
                        <h2 className="text-h2 text-heading flex items-center gap-2">
                            <PackagePlus size={20} className="text-primary" />
                            {successData ? 'Producto agregado' : 'Agregar producto'}
                        </h2>
                        {!successData && (
                            <p className="text-caption text-text-secondary mt-1">
                                Los campos marcados con * son obligatorios
                            </p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors self-start"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                {successData ? (
                    /* Pantalla de éxito (CA-4) */
                    <div className="p-lg flex flex-col items-center gap-md text-center">
                        <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                            <CheckCircle2 size={32} className="text-success" />
                        </div>
                        <div>
                            <p className="text-body font-semibold text-heading">
                                {successData.name}
                            </p>
                            <p className="text-caption text-text-secondary mt-0.5">
                                {successData.brand} · {successData.caliber} · Embarque {successData.shipment_number}
                            </p>
                        </div>

                        <div className="w-full grid grid-cols-2 gap-sm text-left bg-surface rounded-lg p-md border border-border">
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">Calidad</p>
                                <p className="text-body font-medium text-heading">{successData.quality}</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">Categoría</p>
                                <p className="text-body font-medium text-heading">{successData.category}</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">Cantidad</p>
                                <p className="text-body font-medium text-heading">{successData.available_quantity} unidades</p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">Precio</p>
                                <p className="text-body font-medium text-heading">${successData.price.toFixed(2)}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">Estado</p>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                                    successData.status === 'active'
                                        ? 'bg-success/10 text-success'
                                        : 'bg-warning/10 text-warning-dark'
                                }`}>
                                    {successData.status === 'active' ? 'Activo' : 'Incompleto'}
                                </span>
                            </div>
                        </div>

                        {imageWarning && (
                            <p role="alert" className="w-full text-caption text-warning-dark bg-warning/10 border border-warning/30 rounded-lg p-sm">
                                {imageWarning}
                            </p>
                        )}

                        <div className="flex gap-sm w-full">
                            <Button
                                variant="secondary"
                                className="flex-1 flex items-center justify-center gap-2"
                                onClick={handleAddAnother}
                            >
                                <Plus size={16} />
                                Agregar otro
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={onClose}
                            >
                                Ver en inventario
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* Formulario (CA-2) */
                    <>
                        <div className="p-lg overflow-y-auto max-h-[65vh]">
                            {/* Alerta de duplicado (CA-3) */}
                            {isDuplicate && (
                                <div className="mb-md flex items-start gap-sm p-sm bg-warning/10 border border-warning/30 rounded-lg">
                                    <AlertTriangle size={18} className="text-warning-dark shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-body font-semibold text-warning-dark">Producto duplicado</p>
                                        <p className="text-caption text-text-secondary">
                                            Ya existe un producto con la misma combinación de nombre, calibre, marca, calidad y embarque.
                                            Revisá los datos ingresados.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                                <div className="md:col-span-2">
                                    <InputField
                                        label="Nombre del producto *"
                                        value={form.name}
                                        onChange={e => handleChange('name', e.target.value)}
                                        error={errors.name}
                                        placeholder="Ej: Manzana Gala"
                                    />
                                </div>
                                <InputField
                                    label="Calibre *"
                                    value={form.caliber}
                                    onChange={e => handleChange('caliber', e.target.value)}
                                    error={errors.caliber}
                                    placeholder="Ej: 100s"
                                />
                                <InputField
                                    label="Marca *"
                                    value={form.brand}
                                    onChange={e => handleChange('brand', e.target.value)}
                                    error={errors.brand}
                                    placeholder="Ej: Washington"
                                />
                                <div className="flex flex-col gap-xs">
                                    <label className="text-caption font-medium text-heading">Calidad *</label>
                                    <select
                                        value={form.quality}
                                        onChange={e => handleChange('quality', e.target.value)}
                                        className={`w-full px-sm py-2 border rounded-md text-body bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow ${
                                            errors.quality ? 'border-error' : 'border-border'
                                        }`}
                                    >
                                        <option value="">Seleccionar calidad</option>
                                        <option value="PRIMERA">PRIMERA</option>
                                        <option value="SEGUNDA">SEGUNDA</option>
                                        <option value="TERCERA">TERCERA</option>
                                        <option value="ESPECIAL">ESPECIAL</option>
                                        <option value="PREMIUM">PREMIUM</option>
                                        <option value="CAT 1">CAT 1</option>
                                        <option value="CAT 2">CAT 2</option>
                                        <option value="EXTRA">EXTRA</option>
                                    </select>
                                    {errors.quality && (
                                        <p className="text-error text-caption">{errors.quality}</p>
                                    )}
                                </div>
                                <InputField
                                    label="Categoría *"
                                    value={form.category}
                                    onChange={e => handleChange('category', e.target.value)}
                                    error={errors.category}
                                    placeholder="Ej: Frutas"
                                />
                                <InputField
                                    label="N° de embarque *"
                                    value={form.shipment_number}
                                    onChange={e => handleChange('shipment_number', e.target.value)}
                                    error={errors.shipment_number}
                                    placeholder="Ej: EMB-001"
                                />
                                <InputField
                                    label="Fecha de ingreso"
                                    type="date"
                                    value={form.entry_date}
                                    onChange={e => handleChange('entry_date', e.target.value)}
                                />
                                <div />
                                {canUploadImage && (
                                    <div className="md:col-span-2 flex flex-col gap-xs">
                                        <span className="text-caption font-medium text-heading">{t('inventory.image.label')}</span>
                                        <div className="flex items-center gap-sm">
                                            {imagePreview ? (
                                                <img
                                                    data-testid="product-image-preview"
                                                    src={imagePreview}
                                                    alt={t('inventory.image.label')}
                                                    className="w-16 h-16 rounded-md object-cover border border-border"
                                                />
                                            ) : (
                                                <div className="w-16 h-16 rounded-md bg-surface border border-dashed border-border flex items-center justify-center text-text-secondary">
                                                    <ImagePlus size={20} aria-hidden="true" />
                                                </div>
                                            )}
                                            <input
                                                ref={imageInputRef}
                                                type="file"
                                                accept="image/jpeg,image/png,image/webp"
                                                className="hidden"
                                                data-testid="product-image-input"
                                                onChange={handleImageChange}
                                            />
                                            <Button
                                                variant="secondary"
                                                onClick={() => imageInputRef.current?.click()}
                                                disabled={isSubmitting}
                                            >
                                                {t('inventory.image.label')}
                                            </Button>
                                            {imageFile && (
                                                <button
                                                    type="button"
                                                    onClick={clearImage}
                                                    className="p-1.5 rounded-full text-text-secondary hover:text-error hover:bg-error/10 transition-colors"
                                                    title={t('inventory.image.remove')}
                                                    aria-label={t('inventory.image.remove')}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                        <p className="text-caption text-text-secondary">{t('inventory.image.hint')}</p>
                                        {imageError && <p role="alert" className="text-error text-caption">{imageError}</p>}
                                    </div>
                                )}
                                <InputField
                                    label="Cantidad (unidades) *"
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={form.available_quantity}
                                    onChange={e => handleChange('available_quantity', e.target.value)}
                                    error={errors.available_quantity}
                                    placeholder="0"
                                />
                                <InputField
                                    label="Precio ($) *"
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    value={form.price}
                                    onChange={e => handleChange('price', e.target.value)}
                                    error={errors.price}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="flex justify-end gap-sm px-lg py-md border-t border-border bg-surface/30">
                            <Button
                                variant="secondary"
                                onClick={onClose}
                                disabled={isSubmitting}
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                isLoading={isSubmitting}
                                disabled={isDuplicate}
                            >
                                Guardar producto
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
