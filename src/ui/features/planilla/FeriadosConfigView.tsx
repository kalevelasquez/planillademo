import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ShieldOff, Copy } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { feriadosService, type Feriado, type DiaExentoPenalizacion } from '../../../services/feriadosService';
import { Button } from '../../components/Button';
import { CatalogoFechasSection } from './components/CatalogoFechasSection';
import { Logger } from '../../../utils/logger';

export const FeriadosConfigView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();

    const [feriados, setFeriados] = useState<Feriado[]>([]);
    const [diasExentos, setDiasExentos] = useState<DiaExentoPenalizacion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCopiando, setIsCopiando] = useState(false);
    const [mensajeCopia, setMensajeCopia] = useState<string | null>(null);
    // IMPL-15 (revisión historia por historia) — antes copiaba siempre desde el año máximo ya
    // cargado, sin opción de elegir; ahora el usuario puede seleccionar explícitamente el año
    // origen (por defecto sigue siendo el máximo, mismo comportamiento previo si no se cambia).
    const [anioOrigen, setAnioOrigen] = useState<number | null>(null);

    const aniosDisponibles = [...new Set(feriados.map((f) => Number(f.fecha.slice(0, 4))))].sort((a, b) => b - a);

    const cargarTodo = async () => {
        setIsLoading(true);
        try {
            const [f, d] = await Promise.all([feriadosService.getFeriados(), feriadosService.getDiasExentos()]);
            setFeriados(f);
            setDiasExentos(d);
            if (f.length > 0) setAnioOrigen((prev) => prev ?? Math.max(...f.map((x) => Number(x.fecha.slice(0, 4)))));
        } catch (err: unknown) {
            Logger.error('Error al cargar catálogos de feriados', {}, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { cargarTodo(); }, []);

    const handleCopiarAnioAnterior = async () => {
        if (!profile?.tenant_id || !anioOrigen) return;
        setIsCopiando(true);
        setMensajeCopia(null);
        try {
            const copiados = await feriadosService.copiarFeriadosDelAnioAnterior(profile.tenant_id, anioOrigen);
            setMensajeCopia(t('quincenas.feriados_copia_resultado', { count: copiados.length, anio: anioOrigen + 1 }));
            await cargarTodo();
        } catch (err: unknown) {
            Logger.error('Error al copiar feriados del año anterior', {}, err);
            setMensajeCopia(t('quincenas.feriados_copia_error'));
        } finally {
            setIsCopiando(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300">
            <CatalogoFechasSection
                titulo={t('quincenas.feriados_nacionales_title')}
                icono={CalendarDays}
                items={feriados.map((f) => ({ id: f.id, fecha: f.fecha, texto: f.nombre }))}
                isLoading={isLoading}
                campoTextoLabel={t('quincenas.feriados_nombre_label')}
                campoTextoPlaceholder={t('quincenas.feriados_nombre_placeholder')}
                emptyLabel={t('quincenas.feriados_empty')}
                onAdd={async (fecha, texto) => {
                    if (!profile?.tenant_id) return;
                    const nuevo = await feriadosService.createFeriado(profile.tenant_id, fecha, texto || null);
                    setFeriados((prev) => [...prev, nuevo].sort((a, b) => a.fecha.localeCompare(b.fecha)));
                }}
                onEdit={async (id, fecha, texto) => {
                    const actualizado = await feriadosService.updateFeriado(id, fecha, texto || null);
                    setFeriados((prev) => prev.map((f) => (f.id === id ? actualizado : f)).sort((a, b) => a.fecha.localeCompare(b.fecha)));
                }}
                onDelete={async (id) => {
                    await feriadosService.deleteFeriado(id);
                    setFeriados((prev) => prev.filter((f) => f.id !== id));
                }}
                headerAction={
                    aniosDisponibles.length > 0 && (
                        <div className="flex items-center gap-1.5">
                            <select
                                value={anioOrigen ?? ''}
                                onChange={(e) => setAnioOrigen(Number(e.target.value))}
                                aria-label={t('quincenas.feriados_copiar_desde_label')}
                                className="rounded-md border border-border bg-white px-2 py-1 text-caption font-medium text-heading"
                            >
                                {aniosDisponibles.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                            <Button variant="ghost" size="sm" isLoading={isCopiando} onClick={handleCopiarAnioAnterior} className="flex items-center gap-1.5">
                                <Copy size={14} /> {t('quincenas.feriados_copiar_anio')}
                            </Button>
                        </div>
                    )
                }
            />
            {mensajeCopia && <p className="text-caption text-text-secondary -mt-2 ml-1">{mensajeCopia}</p>}

            <CatalogoFechasSection
                titulo={t('quincenas.dias_exentos_title')}
                icono={ShieldOff}
                items={diasExentos.map((d) => ({ id: d.id, fecha: d.fecha, texto: d.nota }))}
                isLoading={isLoading}
                campoTextoLabel={t('quincenas.dias_exentos_nota_label')}
                campoTextoPlaceholder={t('quincenas.dias_exentos_nota_placeholder')}
                emptyLabel={t('quincenas.dias_exentos_empty')}
                onAdd={async (fecha, texto) => {
                    if (!profile?.tenant_id) return;
                    const nuevo = await feriadosService.createDiaExento(profile.tenant_id, fecha, texto || null);
                    setDiasExentos((prev) => [...prev, nuevo].sort((a, b) => a.fecha.localeCompare(b.fecha)));
                }}
                onEdit={async (id, fecha, texto) => {
                    const actualizado = await feriadosService.updateDiaExento(id, fecha, texto || null);
                    setDiasExentos((prev) => prev.map((d) => (d.id === id ? actualizado : d)).sort((a, b) => a.fecha.localeCompare(b.fecha)));
                }}
                onDelete={async (id) => {
                    await feriadosService.deleteDiaExento(id);
                    setDiasExentos((prev) => prev.filter((d) => d.id !== id));
                }}
            />
            <p className="text-[11px] text-text-secondary italic -mt-2">{t('quincenas.dias_exentos_disclaimer')}</p>
        </div>
    );
};
