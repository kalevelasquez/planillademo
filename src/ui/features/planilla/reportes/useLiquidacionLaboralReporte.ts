import { useEffect, useState } from 'react';
import { calculoPlanillaService } from '../../../../services/calculoPlanillaService';
import { quincenasService, type Quincena } from '../../../../services/quincenasService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { empresaConfigService } from '../../../../services/empresaConfigService';
import {
    calcularLiquidacionLaboral,
    seleccionarUltimoCalculoAntesDe,
    type LiquidacionLaboralDatos,
    type TipoRetiro,
    type MetodoPago,
    type SectorEconomico,
} from '../../../../utils/liquidacionLaboralUtils';
import { Logger } from '../../../../utils/logger';

type EmpleadoReporte = Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>[number];

export interface GenerarLiquidacionLaboralParams {
    fechaRetiro: string;
    tipoRetiro: TipoRetiro;
    porcentajeMutuoAcuerdo?: number;
    metodoPago: MetodoPago;
    bancoEmisor: string;
    observaciones?: string;
}

/**
 * Hook de la Liquidación Laboral (US-EXP-08, IMPL-161). Carga empleados una sola vez; al generar
 * para un empleado puntual, busca la última quincena calculada antes de la fecha de retiro
 * (`seleccionarUltimoCalculoAntesDe`) para alimentar Salarios/Horas Extras/Viáticos/ISSS/AFP/
 * cuotas patronales pendientes (CA10) — no recalcula nada del motor de planilla, mismo patrón que
 * `useConstanciaRetencionesReporte.ts`.
 */
export function useLiquidacionLaboralReporte() {
    const [empleados, setEmpleados] = useState<EmpleadoReporte[]>([]);
    const [quincenas, setQuincenas] = useState<Quincena[]>([]);
    const [sectorEconomico, setSectorEconomico] = useState<SectorEconomico | null>(null);
    const [razonSocialEmpresa, setRazonSocialEmpresa] = useState<string | undefined>(undefined);
    const [nitEmpresa, setNitEmpresa] = useState<string | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            planillaEmpleadosService.getEmpleadosParaReportes(),
            quincenasService.getQuincenas(),
            empresaConfigService.getConfig(),
        ])
            .then(([empleadosData, quincenasData, config]) => {
                setEmpleados(empleadosData);
                setQuincenas(quincenasData);
                setSectorEconomico(config?.sector_economico ?? null);
                setRazonSocialEmpresa(config?.razon_social ?? undefined);
                setNitEmpresa(config?.nit ?? undefined);
            })
            .catch((err: unknown) => Logger.error('Error al cargar datos base de Liquidación Laboral', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const generarDatos = async (empleado: EmpleadoReporte, params: GenerarLiquidacionLaboralParams): Promise<LiquidacionLaboralDatos> => {
        const idsElegibles = quincenas.filter((q) => q.fecha_inicio <= params.fechaRetiro).map((q) => q.id);
        const calculos = await calculoPlanillaService.getPorQuincenas(idsElegibles);
        const calculosEmpleado = calculos.filter((c) => c.empleado_id === empleado.id);
        const ultimoCalculo = seleccionarUltimoCalculoAntesDe(quincenas, calculosEmpleado, params.fechaRetiro);

        return calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: params.fechaRetiro,
            tipoRetiro: params.tipoRetiro,
            porcentajeMutuoAcuerdo: params.porcentajeMutuoAcuerdo,
            metodoPago: params.metodoPago,
            bancoEmisor: params.bancoEmisor,
            observaciones: params.observaciones,
            sectorEconomico,
            ultimoCalculo,
        });
    };

    return { empleados, isLoading, generarDatos, sectorEconomico, razonSocialEmpresa, nitEmpresa };
}
