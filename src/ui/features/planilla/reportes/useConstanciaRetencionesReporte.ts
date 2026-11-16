import { useEffect, useState } from 'react';
import { calculoPlanillaService } from '../../../../services/calculoPlanillaService';
import { quincenasService, type Quincena } from '../../../../services/quincenasService';
import { empresaConfigService, type ConfigEmpresa } from '../../../../services/empresaConfigService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import {
    calcularAnioFiscalAnterior,
    seleccionarQuincenasAnioFiscal,
    calcularConstanciaRetencionesDatos,
    type ConstanciaRetencionesDatos,
} from '../../../../utils/constanciaRetencionesUtils';
import { Logger } from '../../../../utils/logger';

type EmpleadoReporte = Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>[number];

/**
 * Hook de la Constancia de Retenciones / Impuesto sobre la Renta (US-EXP-13, IMPL-169). Carga
 * empleados + configuración de empresa (CA5) una sola vez; al generar para un empleado puntual,
 * arma las quincenas del año fiscal anterior completo (CA4) y consulta los snapshots ya
 * persistidos por `calculoPlanillaService` — no recalcula nada del motor de planilla. Mismo
 * patrón que `useConstanciaSalarioReporte.ts`.
 */
export function useConstanciaRetencionesReporte() {
    const [empleados, setEmpleados] = useState<EmpleadoReporte[]>([]);
    const [quincenasAnio, setQuincenasAnio] = useState<Quincena[]>([]);
    const [configEmpresa, setConfigEmpresa] = useState<ConfigEmpresa | null>(null);
    const [anioFiscal, setAnioFiscal] = useState<number>(() => calcularAnioFiscalAnterior());
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const anio = calcularAnioFiscalAnterior();
        Promise.all([
            planillaEmpleadosService.getEmpleadosParaReportes(),
            quincenasService.getQuincenas(),
            empresaConfigService.getConfig(),
        ])
            .then(([empleadosData, quincenas, config]) => {
                setEmpleados(empleadosData);
                setAnioFiscal(anio);
                setQuincenasAnio(seleccionarQuincenasAnioFiscal(quincenas, anio));
                setConfigEmpresa(config);
            })
            .catch((err: unknown) => Logger.error('Error al cargar datos base de Constancia de Retenciones', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const generarDatos = async (empleado: EmpleadoReporte): Promise<ConstanciaRetencionesDatos> => {
        const idsAnio = quincenasAnio.map((q) => q.id);
        const calculosAnio = await calculoPlanillaService.getPorQuincenas(idsAnio);
        const calculosEmpleado = calculosAnio.filter((c) => c.empleado_id === empleado.id);
        return calcularConstanciaRetencionesDatos(empleado, anioFiscal, calculosEmpleado, configEmpresa);
    };

    return { empleados, isLoading, anioFiscal, generarDatos };
}
