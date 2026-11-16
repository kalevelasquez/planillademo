import { useEffect, useState } from 'react';
import { calculoPlanillaService } from '../../../../services/calculoPlanillaService';
import { quincenasService, type Quincena } from '../../../../services/quincenasService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { empresaConfigService } from '../../../../services/empresaConfigService';
import {
    calcularLiquidacionLaboral,
    seleccionarUltimoCalculoAntesDe,
    type TipoRetiro,
    type SectorEconomico,
} from '../../../../utils/liquidacionLaboralUtils';
import { calcularFiniquitoDatos, type FiniquitoDatos } from '../../../../utils/finiquitoUtils';
import { Logger } from '../../../../utils/logger';

type EmpleadoReporte = Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>[number];

export interface GenerarFiniquitoParams {
    fechaRetiro: string;
    tipoRetiro: TipoRetiro;
    porcentajeMutuoAcuerdo?: number;
    fechaFirma?: string;
}

/**
 * Hook del Finiquito (US-EXP-09, IMPL-162). Reusa `calcularLiquidacionLaboral` (IMPL-161) como
 * única fuente de verdad (CA4) — el método de pago/banco emisor que pide ese motor no aplican
 * acá (el Finiquito no genera Solicitud de Transferencia/Cheque), así que se pasan valores
 * neutros que no afectan ningún campo que el Finiquito termine mostrando.
 */
export function useFiniquitoReporte() {
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
            .catch((err: unknown) => Logger.error('Error al cargar datos base del Finiquito', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const generarDatos = async (empleado: EmpleadoReporte, params: GenerarFiniquitoParams): Promise<FiniquitoDatos> => {
        const idsElegibles = quincenas.filter((q) => q.fecha_inicio <= params.fechaRetiro).map((q) => q.id);
        const calculos = await calculoPlanillaService.getPorQuincenas(idsElegibles);
        const calculosEmpleado = calculos.filter((c) => c.empleado_id === empleado.id);
        const ultimoCalculo = seleccionarUltimoCalculoAntesDe(quincenas, calculosEmpleado, params.fechaRetiro);

        const liquidacion = calcularLiquidacionLaboral({
            empleado,
            fechaRetiro: params.fechaRetiro,
            tipoRetiro: params.tipoRetiro,
            porcentajeMutuoAcuerdo: params.porcentajeMutuoAcuerdo,
            // El Finiquito no genera Solicitud de Transferencia/Cheque — estos 2 valores solo
            // alimentan esa sección de `LiquidacionLaboralDatos`, que este reporte ignora.
            metodoPago: 'transferencia',
            bancoEmisor: '',
            sectorEconomico,
            ultimoCalculo,
        });

        return calcularFiniquitoDatos({ empleado, liquidacion, ultimoCalculo, fechaFirma: params.fechaFirma });
    };

    return { empleados, isLoading, generarDatos, razonSocialEmpresa, nitEmpresa };
}
