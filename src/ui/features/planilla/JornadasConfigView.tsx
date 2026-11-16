import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Plus, Pencil, Info } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useCargosStore } from '../../../store/cargosStore';
import { useDepartamentosStore } from '../../../store/departamentosStore';
import { cargosService } from '../../../services/cargosService';
import { departamentosService } from '../../../services/departamentosService';
import { jornadasService, type JornadaCargo } from '../../../services/jornadasService';
import { JORNADA_ORDINARIA_DEFAULT, DIAS_SEMANA, type DiaSemana, type HorasPorDia } from '../../../utils/jornadaUtils';
import { InputField } from '../../components/InputField';
import { PageLoader } from '../../components/PageLoader';
import { ConfigCrudModal } from './components/ConfigCrudModal';
import { CatalogSelectQuickAdd } from './components/CatalogSelectQuickAdd';
import { Logger } from '../../../utils/logger';
import { useToast } from '../../../context/ToastContext';

function resumenHoras(horas: HorasPorDia): string {
    return DIAS_SEMANA.map((d) => `${d.slice(0, 3)} ${horas[d]}h`).join(' · ');
}

/**
 * Configuración > Jornadas por Cargo/Departamento (US-HEX-01 CA2). Fidelidad al DEMO: tabla
 * desktop + cards mobile, alta vía modal, contador. Sin concepto de activo/inactivo (no
 * existía antes) — solo alta y baja, así que el contador muestra el total configurado.
 */
export const JornadasConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { cargos, fetchCargos, upsertCargo } = useCargosStore();
    const { departamentos, fetchDepartamentos, upsertDepartamento } = useDepartamentosStore();

    const [jornadas, setJornadas] = useState<JornadaCargo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);

    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<JornadaCargo | null>(null);
    const [aplicaA, setAplicaA] = useState<'cargo' | 'departamento'>('cargo');
    const [valor, setValor] = useState('');
    const [horas, setHoras] = useState<HorasPorDia>({ ...JORNADA_ORDINARIA_DEFAULT });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cargar = async () => {
        setIsLoading(true);
        try {
            const data = await jornadasService.getJornadas();
            setJornadas(data);
        } catch (err: unknown) {
            Logger.error('Error al cargar jornadas por cargo', {}, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { cargar(); }, []);
    useEffect(() => { fetchCargos(); }, [fetchCargos]);
    useEffect(() => { fetchDepartamentos(); }, [fetchDepartamentos]);

    const cerrarModal = () => {
        setMostrarModal(false);
        setEditTarget(null);
        setAplicaA('cargo');
        setValor('');
        setHoras({ ...JORNADA_ORDINARIA_DEFAULT });
        setError(null);
    };

    const abrirAlta = () => {
        setEditTarget(null);
        setAplicaA('cargo');
        setValor('');
        setHoras({ ...JORNADA_ORDINARIA_DEFAULT });
        setError(null);
        setMostrarModal(true);
    };

    const abrirEdicion = (jornada: JornadaCargo) => {
        setEditTarget(jornada);
        setAplicaA(jornada.aplica_a);
        setValor(jornada.valor);
        setHoras({ ...jornada.horas_por_dia });
        setError(null);
        setMostrarModal(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;
        if (!valor.trim()) { setError(t('horasExtras.error_valor_required')); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizada = await jornadasService.updateJornada(editTarget.id, { aplica_a: aplicaA, valor: valor.trim(), horas_por_dia: horas });
                setJornadas((prev) => prev.map((j) => (j.id === editTarget.id ? actualizada : j)).sort((a, b) => a.valor.localeCompare(b.valor)));
            } else {
                const nueva = await jornadasService.createJornada(profile.tenant_id, aplicaA, valor.trim(), horas);
                setJornadas((prev) => [...prev, nueva].sort((a, b) => a.valor.localeCompare(b.valor)));
            }
            cerrarModal();
        } catch (err: unknown) {
            Logger.error('Error al guardar jornada por cargo', { editandoId: editTarget?.id }, err);
            // Bugfix (auditoría, minor #1): antes se mostraba siempre el mensaje genérico —
            // un duplicado (UNIQUE tenant_id+aplica_a+valor) no decía qué había pasado.
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('horasExtras.error_jornada_duplicada') : t('horasExtras.error_crear_jornada'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        setEliminandoId(id);
        try {
            await jornadasService.deleteJornada(id);
            setJornadas((prev) => prev.filter((j) => j.id !== id));
        } catch (err: unknown) {
            Logger.error('Error al eliminar jornada por cargo', { id }, err);
            showToast(t('horasExtras.error_eliminar_jornada'), 'error');
        } finally {
            setEliminandoId(null);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300">
            <div className="bg-primary-light/30 border border-primary/20 rounded-lg p-md flex items-start gap-3">
                <Info size={16} className="text-primary shrink-0 mt-0.5" />
                <div>
                    <p className="text-caption font-semibold text-heading">{t('horasExtras.jornada_legal_title')}</p>
                    <p className="text-caption text-text-secondary">{t('horasExtras.jornada_legal_desc')}</p>
                </div>
            </div>

            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
                <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                        {t('configuracion.contador_registros', { count: jornadas.length })}
                    </p>
                    <button
                        type="button"
                        onClick={abrirAlta}
                        className="flex items-center gap-1.5 px-md py-sm bg-primary text-white rounded-xl font-semibold text-[13px] hover:bg-primary-dark transition-colors shadow-cards"
                    >
                        <Plus size={15} /> {t('horasExtras.action_agregar_jornada')}
                    </button>
                </div>

                {isLoading ? (
                    <PageLoader label={t('common.loading')} />
                ) : jornadas.length === 0 ? (
                    <p className="text-caption text-text-secondary italic">{t('horasExtras.jornadas_empty')}</p>
                ) : (
                    <div className="bg-white rounded-xl border border-border overflow-hidden">
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('horasExtras.field_valor')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">Horas</th>
                                        <th className="w-20 px-lg py-sm" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {jornadas.map((j) => (
                                        <tr key={j.id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                                            <td className="px-lg py-sm font-semibold text-heading text-[13px]">
                                                {j.aplica_a === 'cargo' ? t('horasExtras.aplica_a_cargo') : t('horasExtras.aplica_a_departamento')}: {j.valor}
                                            </td>
                                            <td className="px-lg py-sm text-[12px] text-text-secondary">{resumenHoras(j.horas_por_dia)}</td>
                                            <td className="px-lg py-sm">
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => abrirEdicion(j)}
                                                        title={t('horasExtras.action_editar_jornada')}
                                                        className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                    >
                                                        <Pencil size={14} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(j.id)}
                                                        disabled={eliminandoId === j.id}
                                                        className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10 disabled:opacity-50"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="sm:hidden flex flex-col divide-y divide-border">
                            {jornadas.map((j) => (
                                <div key={j.id} className="flex items-center gap-md px-md py-sm">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-heading text-[13px]">
                                            {j.aplica_a === 'cargo' ? t('horasExtras.aplica_a_cargo') : t('horasExtras.aplica_a_departamento')}: {j.valor}
                                        </p>
                                        <p className="text-[11px] text-text-secondary truncate">{resumenHoras(j.horas_por_dia)}</p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => abrirEdicion(j)}
                                            title={t('horasExtras.action_editar_jornada')}
                                            className="p-1.5 text-text-secondary hover:text-primary rounded-lg"
                                        >
                                            <Pencil size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(j.id)}
                                            disabled={eliminandoId === j.id}
                                            className="p-1.5 text-text-secondary hover:text-error rounded-lg disabled:opacity-50"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? t('horasExtras.form_title_editar_jornada') : t('horasExtras.action_agregar_jornada')} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <div className="inline-flex bg-surface border border-border rounded-lg p-0.5 gap-0.5 self-start">
                        {(['cargo', 'departamento'] as const).map((opcion) => (
                            <button
                                key={opcion}
                                type="button"
                                onClick={() => { setAplicaA(opcion); setValor(''); }}
                                className={`px-sm py-xs rounded-md text-[12px] font-semibold transition-colors ${aplicaA === opcion ? 'bg-white text-primary shadow-sm border border-border/50' : 'text-text-secondary hover:text-heading'}`}
                            >
                                {opcion === 'cargo' ? t('horasExtras.aplica_a_cargo') : t('horasExtras.aplica_a_departamento')}
                            </button>
                        ))}
                    </div>
                    {aplicaA === 'cargo' ? (
                        <CatalogSelectQuickAdd
                            label={t('horasExtras.field_valor')}
                            value={valor}
                            onChange={setValor}
                            items={cargos}
                            onCrear={(nombre) => {
                                if (!profile?.tenant_id) return Promise.reject(new Error('Sin tenant'));
                                return cargosService.createCargo(profile.tenant_id, nombre).then((c) => { upsertCargo(c); return c; });
                            }}
                            emptyOptionLabel={t('empleados.cargo_seleccionar')}
                            required
                            quickAddTitle={t('empleados.action_agregar_cargo')}
                            quickAddFieldLabel={t('empleados.field_nombre_cargo')}
                            duplicadoErrorMessage={t('empleados.error_cargo_duplicado')}
                            genericErrorMessage={t('empleados.error_crear_cargo')}
                        />
                    ) : (
                        <CatalogSelectQuickAdd
                            label={t('horasExtras.field_valor')}
                            value={valor}
                            onChange={setValor}
                            items={departamentos}
                            onCrear={(nombre) => {
                                if (!profile?.tenant_id) return Promise.reject(new Error('Sin tenant'));
                                return departamentosService.createDepartamento(profile.tenant_id, nombre, 'blue').then((d) => { upsertDepartamento(d); return d; });
                            }}
                            emptyOptionLabel={t('empleados.departamento_seleccionar')}
                            required
                            quickAddTitle={t('empleados.action_agregar_departamento')}
                            quickAddFieldLabel={t('empleados.field_nombre_departamento')}
                            duplicadoErrorMessage={t('empleados.error_departamento_duplicado')}
                            genericErrorMessage={t('empleados.error_crear_departamento')}
                        />
                    )}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {DIAS_SEMANA.map((dia: DiaSemana) => (
                            <InputField
                                key={dia}
                                label={t(`horasExtras.dia_${dia}`)}
                                type="number"
                                min={0}
                                max={24}
                                step={0.5}
                                value={horas[dia]}
                                onChange={(e) => setHoras((prev) => ({ ...prev, [dia]: Number(e.target.value) }))}
                            />
                        ))}
                    </div>
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
