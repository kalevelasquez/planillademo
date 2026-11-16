import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import BrandLogo from '../../../assets/images/logo-imporfrut.png';
import type { LiquidacionLaboralDatos, PartidaContableFila } from '../../../utils/liquidacionLaboralUtils';

const COLOR = {
    primary: '#10B981', secondary: '#1E293B', muted: '#64748B', light: '#F8FAFC', border: '#E2E8F0', white: '#FFFFFF',
    warningBg: '#FFFBEB', warningBorder: '#FDE68A', warningText: '#B45309',
};

const styles = StyleSheet.create({
    page: { padding: 40, paddingTop: 36, fontFamily: 'Helvetica', fontSize: 9, color: COLOR.secondary, backgroundColor: COLOR.white },
    logo: { width: 90, marginBottom: 14 },
    empresaLinea: { fontSize: 9, marginBottom: 1 },
    titulo: { fontSize: 13, fontWeight: 'bold', marginTop: 10, marginBottom: 10, textTransform: 'uppercase' },
    subtitulo: { fontSize: 9.5, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase', marginTop: 12, marginBottom: 4 },
    grid: { flexDirection: 'row', gap: 12, backgroundColor: COLOR.light, padding: 8, borderRadius: 3, marginBottom: 4 },
    gridItem: { flex: 1 },
    gridLabel: { fontSize: 7, color: COLOR.muted, textTransform: 'uppercase' },
    gridValor: { fontSize: 9, fontWeight: 'bold', marginTop: 1 },
    tablaHeader: { flexDirection: 'row', backgroundColor: COLOR.light, paddingVertical: 5, paddingHorizontal: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLOR.border },
    tablaHeaderTexto: { fontSize: 7.5, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase' },
    fila: { flexDirection: 'row', paddingVertical: 4.5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: COLOR.light, alignItems: 'center' },
    celdaConcepto: { flex: 3, fontSize: 8.5 },
    celdaDias: { flex: 1, fontSize: 8.5, textAlign: 'center' },
    celdaMonto: { flex: 1.3, fontSize: 8.5, textAlign: 'right' },
    badgePendiente: { fontSize: 7, fontWeight: 'bold', color: COLOR.warningText, backgroundColor: COLOR.warningBg, borderWidth: 1, borderColor: COLOR.warningBorder, borderRadius: 3, paddingVertical: 2, paddingHorizontal: 5, textAlign: 'right' as const },
    notaPendiente: { fontSize: 7.5, color: COLOR.warningText, backgroundColor: COLOR.warningBg, borderWidth: 1, borderColor: COLOR.warningBorder, borderRadius: 3, padding: 8, marginTop: 8, lineHeight: 1.4 },
    totalBox: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, padding: 8, backgroundColor: '#F0FDF4', borderRadius: 3, borderTopWidth: 2, borderTopColor: COLOR.primary, alignItems: 'center' },
    totalLabel: { fontSize: 9.5, fontWeight: 'bold' },
    totalValor: { fontSize: 12, fontWeight: 'bold', color: COLOR.primary },
    totalNota: { fontSize: 7, color: COLOR.muted, marginTop: 3 },
    parrafo: { fontSize: 8.5, lineHeight: 1.4, marginBottom: 8 },
    firmasFila: { flexDirection: 'row', marginTop: 42, gap: 16 },
    firmaBloque: { flex: 1, borderTopWidth: 1, borderTopColor: COLOR.secondary, paddingTop: 4 },
    firmaTexto: { fontSize: 7.5, color: COLOR.muted, textAlign: 'center' },
    campoLinea: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: COLOR.light },
    campoLabel: { fontSize: 8.5, color: COLOR.muted },
    campoValor: { fontSize: 8.5, fontWeight: 'bold' },
    campoValorVacio: { fontSize: 8.5, fontWeight: 'bold', color: '#CBD5E1' },
    brandingFooter: { position: 'absolute', bottom: 20, left: 40, right: 40, borderTopWidth: 1, borderTopColor: COLOR.light, paddingTop: 6 },
    brandingText: { fontSize: 6.5, color: '#94A3B8', textAlign: 'center' },
});

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
};

const TIPO_RETIRO_LABEL: Record<LiquidacionLaboralDatos['tipoRetiro'], string> = {
    despido: 'Despido',
    renuncia: 'Renuncia',
    mutuo_acuerdo: 'Mutuo Acuerdo',
};

const Encabezado: React.FC<{ razonSocial?: string; nit?: string }> = ({ razonSocial, nit }) => (
    <>
        <Image src={BrandLogo} style={styles.logo} />
        {razonSocial ? <Text style={styles.empresaLinea}>{razonSocial}</Text> : null}
        {nit ? <Text style={styles.empresaLinea}>{nit}</Text> : null}
    </>
);

/**
 * Fila de la tabla contable resumen (CA9/CA10) — la Indemnización se muestra con un badge de
 * "PENDIENTE" en vez de un monto en $0.00, para que sea imposible de confundir con "no le
 * corresponde indemnización".
 */
const FilaPartida: React.FC<{ fila: PartidaContableFila }> = ({ fila }) => (
    <View style={styles.fila}>
        <Text style={{ flex: 1.4, fontSize: 8 }}>{fila.cuenta}</Text>
        <Text style={{ flex: 2.4, fontSize: 8.5 }}>{fila.concepto}</Text>
        {fila.pendiente ? (
            <Text style={[styles.badgePendiente, { flex: 1.3 }]}>PENDIENTE</Text>
        ) : (
            <Text style={{ flex: 1.3, fontSize: 8.5, textAlign: 'right' }}>{fmt(fila.monto ?? 0)}</Text>
        )}
    </View>
);

/** Página 1 — Liquidación Laboral (CA2/CA3/CA4/CA11 + Indemnización CA1 como TODO explícito). */
const PaginaLiquidacion: React.FC<{ datos: LiquidacionLaboralDatos; razonSocial?: string; nit?: string }> = ({ datos, razonSocial, nit }) => (
    <Page size="A4" style={styles.page}>
        <Encabezado razonSocial={razonSocial} nit={nit} />
        <Text style={styles.titulo}>Liquidación Laboral</Text>

        <View style={styles.grid}>
            <View style={styles.gridItem}><Text style={styles.gridLabel}>Tipo de Retiro</Text><Text style={styles.gridValor}>{TIPO_RETIRO_LABEL[datos.tipoRetiro]}</Text></View>
            <View style={styles.gridItem}><Text style={styles.gridLabel}>% Indemnización</Text><Text style={styles.gridValor}>{datos.porcentajeIndemnizacion}%</Text></View>
            <View style={styles.gridItem}><Text style={styles.gridLabel}>Fecha de Retiro</Text><Text style={styles.gridValor}>{fmtFecha(datos.fechaRetiro)}</Text></View>
        </View>

        <Text style={styles.subtitulo}>Datos del Colaborador</Text>
        <View style={styles.grid}>
            <View style={{ flex: 2 }}><Text style={styles.gridLabel}>Nombre</Text><Text style={styles.gridValor}>{datos.nombreEmpleado}</Text></View>
            <View style={styles.gridItem}><Text style={styles.gridLabel}>Fecha de Ingreso</Text><Text style={styles.gridValor}>{fmtFecha(datos.fechaIngreso)}</Text></View>
            <View style={styles.gridItem}><Text style={styles.gridLabel}>Antigüedad</Text><Text style={styles.gridValor}>{datos.aniosAntiguedad} año(s)</Text></View>
        </View>

        <Text style={styles.subtitulo}>Detalle de Liquidación</Text>
        <View style={styles.tablaHeader}>
            <Text style={[styles.tablaHeaderTexto, { flex: 3 }]}>Concepto</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 1, textAlign: 'center' }]}>Días</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 1.3, textAlign: 'right' }]}>Valor (US$)</Text>
        </View>

        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>Indemnización (Art. 58 CT)</Text>
            <Text style={styles.celdaDias}>—</Text>
            {datos.indemnizacion.estado === 'confirmado' ? (
                <Text style={styles.celdaMonto}>{fmt(datos.indemnizacion.monto)}</Text>
            ) : (
                <Text style={styles.badgePendiente}>PENDIENTE DE DEFINIR</Text>
            )}
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>Vacación Proporcional</Text>
            <Text style={styles.celdaDias}>{datos.diasPeriodoVacacion}</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.vacacionProporcional)}</Text>
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>Aguinaldo Proporcional ({datos.diasAguinaldoSegunAntiguedad} días/año)</Text>
            <Text style={styles.celdaDias}>{datos.diasPeriodoAguinaldo}</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.aguinaldoProporcional)}</Text>
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>Quincena 25 Proporcional</Text>
            <Text style={styles.celdaDias}>{datos.quincena25Proporcional.dias}</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.quincena25Proporcional.monto)}</Text>
        </View>
        <View style={styles.fila}>
            {/* CA11 — SIEMPRE $0.00 (campo heredado, Imporfrut no maneja comisiones) — NO es un
                pendiente como Indemnización, por eso NO lleva badge, es un cero real. */}
            <Text style={styles.celdaConcepto}>Promedio Comisión Últimos 6 Meses</Text>
            <Text style={styles.celdaDias}>—</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.promedioComision6Meses)}</Text>
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>Salario pendiente (último período)</Text>
            <Text style={styles.celdaDias}>—</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.salariosPendientes)}</Text>
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>Horas Extras pendientes</Text>
            <Text style={styles.celdaDias}>—</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.horasExtrasPendientes)}</Text>
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>Viáticos pendientes</Text>
            <Text style={styles.celdaDias}>—</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.viaticosPendientes)}</Text>
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>(−) ISSS Retención Empleado</Text>
            <Text style={styles.celdaDias}>—</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.isssEmpleado)}</Text>
        </View>
        <View style={styles.fila}>
            <Text style={styles.celdaConcepto}>(−) {datos.afpLabel} Retención Empleado</Text>
            <Text style={styles.celdaDias}>—</Text>
            <Text style={styles.celdaMonto}>{fmt(datos.afpEmpleado)}</Text>
        </View>
        {datos.otrosDescuentos > 0 && (
            <View style={styles.fila}>
                <Text style={styles.celdaConcepto}>(−) Otros Descuentos</Text>
                <Text style={styles.celdaDias}>—</Text>
                <Text style={styles.celdaMonto}>{fmt(datos.otrosDescuentos)}</Text>
            </View>
        )}

        <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>{datos.indemnizacion.estado === 'confirmado' ? 'Total a Pagar' : 'Total Parcial a Pagar'}</Text>
            <Text style={styles.totalValor}>{fmt(datos.totalLiquidacionParcial)}</Text>
        </View>
        {datos.indemnizacion.estado !== 'confirmado' && (
            <Text style={styles.totalNota}>
                * Total PARCIAL — no incluye Indemnización (ver "PENDIENTE DE DEFINIR" arriba). Este monto va a cambiar cuando se configure el sector económico de la empresa.
            </Text>
        )}

        <View style={styles.brandingFooter} fixed>
            <Text style={styles.brandingText}>Importadora de Frutas S.A. de C.V. • El Salvador</Text>
        </View>
    </Page>
);

/** Página 2 — Solicitud de Transferencia o de Cheque (CA9). Se genera SOLO la sección que
 * corresponde al método de pago elegido al generar la liquidación (nunca las dos). Incluye la
 * misma tabla contable resumen que la Partida (CA10) — "comparten el mismo cálculo base", no se
 * recalcula nada acá, se reutiliza `datos.partidaContable` tal cual. */
const PaginaSolicitudPago: React.FC<{ datos: LiquidacionLaboralDatos; razonSocial?: string; nit?: string }> = ({ datos, razonSocial, nit }) => {
    const esTransferencia = datos.solicitudPago.metodoPago === 'transferencia';
    const titulo = esTransferencia ? 'Solicitud de Transferencia' : 'Solicitud de Cheque';
    const etiquetaMonto = esTransferencia ? 'Monto de Transferencia' : 'Monto del Cheque';
    const etiquetaNumero = esTransferencia ? 'Número de Transferencia Asignado' : 'Número de Cheque Asignado';

    return (
        <Page size="A4" style={styles.page}>
            {razonSocial ? <Text style={styles.empresaLinea}>{razonSocial}</Text> : null}
            {nit ? <Text style={styles.empresaLinea}>{nit}</Text> : null}
            <Text style={styles.titulo}>{titulo}</Text>

            <View style={styles.campoLinea}><Text style={styles.campoLabel}>Fecha de Solicitud</Text><Text style={styles.campoValor}>{fmtFecha(datos.solicitudPago.fechaSolicitud)}</Text></View>
            <View style={styles.campoLinea}><Text style={styles.campoLabel}>{esTransferencia ? 'Emitir Transferencia del Banco' : 'Emitir Cheque del Banco'}</Text><Text style={styles.campoValor}>{datos.solicitudPago.bancoEmisor || '—'}</Text></View>
            <View style={styles.campoLinea}><Text style={styles.campoLabel}>Beneficiario</Text><Text style={styles.campoValor}>{datos.solicitudPago.beneficiario}</Text></View>
            <View style={styles.campoLinea}><Text style={styles.campoLabel}>{etiquetaMonto}</Text><Text style={styles.campoValor}>{fmt(datos.solicitudPago.monto)}</Text></View>
            <View style={styles.campoLinea}><Text style={styles.campoLabel}>Observaciones</Text><Text style={styles.campoValor}>{datos.solicitudPago.observaciones || '—'}</Text></View>
            <View style={styles.campoLinea}><Text style={styles.campoLabel}>{etiquetaNumero}</Text><Text style={styles.campoValorVacio}>(se completa manualmente)</Text></View>

            {datos.indemnizacion.estado !== 'confirmado' && (
                <Text style={styles.totalNota}>
                    * El monto solicitado es PARCIAL — excluye Indemnización, todavía pendiente de definir (ver Liquidación Laboral).
                </Text>
            )}

            <Text style={styles.subtitulo}>Tabla Contable Resumen (mismas cuentas de la Partida Contable)</Text>
            <View style={styles.tablaHeader}>
                <Text style={[styles.tablaHeaderTexto, { flex: 1.4 }]}>Cuenta</Text>
                <Text style={[styles.tablaHeaderTexto, { flex: 2.4 }]}>Concepto</Text>
                <Text style={[styles.tablaHeaderTexto, { flex: 1.3, textAlign: 'right' }]}>Monto (US$)</Text>
            </View>
            {datos.partidaContable.debe.map((f, i) => <FilaPartida key={`d-${i}`} fila={f} />)}
            {datos.partidaContable.haber.map((f, i) => <FilaPartida key={`h-${i}`} fila={f} />)}

            <View style={styles.firmasFila}>
                <View style={styles.firmaBloque}><Text style={styles.firmaTexto}>Autorización Gerencia</Text></View>
                <View style={styles.firmaBloque}><Text style={styles.firmaTexto}>Revisión / Codificación Contabilidad</Text></View>
                <View style={styles.firmaBloque}><Text style={styles.firmaTexto}>Revisión Contraloría</Text></View>
            </View>

            <View style={styles.brandingFooter} fixed>
                <Text style={styles.brandingText}>Importadora de Frutas S.A. de C.V. • El Salvador</Text>
            </View>
        </Page>
    );
};

/** Página 3 — Partida Contable de Liquidación (CA10). La partida NO cuadra de forma definitiva
 * mientras la Indemnización esté pendiente — se documenta explícitamente como estado esperado,
 * no como un error, tal como exige el ticket. */
const PaginaPartidaContable: React.FC<{ datos: LiquidacionLaboralDatos; razonSocial?: string; nit?: string }> = ({ datos, razonSocial, nit }) => (
    <Page size="A4" style={styles.page}>
        {razonSocial ? <Text style={styles.empresaLinea}>{razonSocial}</Text> : null}
        {nit ? <Text style={styles.empresaLinea}>{nit}</Text> : null}
        <Text style={styles.titulo}>Partida Contable de Liquidación</Text>
        <Text style={styles.parrafo}>{datos.nombreEmpleado} — {fmtFecha(datos.solicitudPago.fechaSolicitud)}</Text>

        <Text style={styles.subtitulo}>Debe</Text>
        <View style={styles.tablaHeader}>
            <Text style={[styles.tablaHeaderTexto, { flex: 1.4 }]}>Cuenta</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 2.4 }]}>Concepto</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 1.3, textAlign: 'right' }]}>Monto (US$)</Text>
        </View>
        {datos.partidaContable.debe.map((f, i) => <FilaPartida key={`debe-${i}`} fila={f} />)}
        <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Total Debe (conocido)</Text>
            <Text style={styles.totalValor}>{fmt(datos.partidaContable.totalDebeConocido)}</Text>
        </View>

        <Text style={styles.subtitulo}>Haber</Text>
        <View style={styles.tablaHeader}>
            <Text style={[styles.tablaHeaderTexto, { flex: 1.4 }]}>Cuenta</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 2.4 }]}>Concepto</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 1.3, textAlign: 'right' }]}>Monto (US$)</Text>
        </View>
        {datos.partidaContable.haber.map((f, i) => <FilaPartida key={`haber-${i}`} fila={f} />)}
        <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>Total Haber</Text>
            <Text style={styles.totalValor}>{fmt(datos.partidaContable.totalHaberConocido + datos.partidaContable.liquidacionPorPagar)}</Text>
        </View>

        <Text style={styles.notaPendiente}>{datos.partidaContable.nota}</Text>

        <View style={styles.firmasFila}>
            <View style={styles.firmaBloque}><Text style={styles.firmaTexto}>Elaborado por Contabilidad</Text></View>
        </View>

        <View style={styles.brandingFooter} fixed>
            <Text style={styles.brandingText}>Importadora de Frutas S.A. de C.V. • El Salvador</Text>
        </View>
    </Page>
);

export interface LiquidacionLaboralPDFProps {
    datos: LiquidacionLaboralDatos;
    razonSocialEmpresa?: string;
    nitEmpresa?: string;
}

/**
 * Liquidación Laboral (US-EXP-08, IMPL-161) — un solo PDF de 3 páginas: (1) Liquidación Laboral,
 * (2) Solicitud de Transferencia o de Cheque (CA9, solo la que corresponda al método de pago
 * elegido), (3) Partida Contable de Liquidación (CA10). Decisión de diseño: CA9 dice que la
 * Solicitud "comparte el mismo cálculo base" que CA10 y "no se generan por separado" — se
 * interpretó como "un solo documento con 3 secciones", no 3 archivos descargables aparte, para
 * que Contabilidad/Gerencia reciban todo junto al firmar.
 */
export const LiquidacionLaboralPDFTemplate: React.FC<LiquidacionLaboralPDFProps> = ({ datos, razonSocialEmpresa, nitEmpresa }) => (
    <Document title={`Liquidación Laboral - ${datos.nombreEmpleado}`}>
        <PaginaLiquidacion datos={datos} razonSocial={razonSocialEmpresa} nit={nitEmpresa} />
        <PaginaSolicitudPago datos={datos} razonSocial={razonSocialEmpresa} nit={nitEmpresa} />
        <PaginaPartidaContable datos={datos} razonSocial={razonSocialEmpresa} nit={nitEmpresa} />
    </Document>
);
