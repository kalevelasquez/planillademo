import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { ReciboSueldoDatos } from '../../../utils/reciboSueldoUtils';

const COLOR = { primary: '#10B981', secondary: '#1E293B', muted: '#64748B', light: '#F8FAFC', border: '#E2E8F0', white: '#FFFFFF' };

const styles = StyleSheet.create({
    page: { padding: 32, fontFamily: 'Helvetica', fontSize: 9, color: COLOR.secondary, backgroundColor: COLOR.white },
    encabezado: { marginBottom: 12, borderBottomWidth: 1, borderBottomColor: COLOR.border, paddingBottom: 10 },
    empresa: { fontSize: 11, fontWeight: 'bold' },
    tituloRecibo: { fontSize: 10, fontWeight: 'bold', color: COLOR.primary, marginTop: 2 },
    quincena: { fontSize: 9, color: COLOR.muted, marginTop: 2 },
    reciboPorLabel: { fontSize: 8, color: COLOR.muted, marginTop: 6 },
    reciboPorMonto: { fontSize: 14, fontWeight: 'bold', color: COLOR.primary },
    infoGrid: { flexDirection: 'row', gap: 16, marginBottom: 10, backgroundColor: COLOR.light, padding: 8, borderRadius: 3 },
    infoItem: { flex: 1 },
    infoLabel: { fontSize: 7, color: COLOR.muted, textTransform: 'uppercase' },
    infoValor: { fontSize: 9, fontWeight: 'bold', marginTop: 1 },
    columnas: { flexDirection: 'row', gap: 12 },
    columna: { flex: 1 },
    columnaTitulo: { fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase', color: COLOR.muted, borderBottomWidth: 1, borderBottomColor: COLOR.border, paddingBottom: 3, marginBottom: 3 },
    fila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
    filaLabel: { fontSize: 8.5, flex: 1 },
    filaValor: { fontSize: 8.5, fontWeight: 'bold', textAlign: 'right' },
    filaTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginTop: 3, borderTopWidth: 1, borderTopColor: COLOR.secondary },
    filaTotalLabel: { fontSize: 9, fontWeight: 'bold', flex: 1 },
    filaTotalValor: { fontSize: 9, fontWeight: 'bold', textAlign: 'right' },
    totalARecibir: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, padding: 8, backgroundColor: '#F0FDF4', borderRadius: 3, borderTopWidth: 2, borderTopColor: COLOR.primary },
    totalARecibirLabel: { fontSize: 10, fontWeight: 'bold' },
    totalARecibirValor: { fontSize: 11, fontWeight: 'bold', color: COLOR.primary },
    firma: { marginTop: 20, fontSize: 8, color: COLOR.muted },
    original: { position: 'absolute', top: 32, right: 32, fontSize: 7, color: '#94A3B8', textTransform: 'uppercase' },
});

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FilaMonto: React.FC<{ label: string; monto: number }> = ({ label, monto }) => (
    <View style={styles.fila}>
        <Text style={styles.filaLabel}>{label}</Text>
        <Text style={styles.filaValor}>{fmt(monto)}</Text>
    </View>
);

const UnRecibo: React.FC<{ r: ReciboSueldoDatos }> = ({ r }) => (
    <View>
        <Text style={styles.original}>Original Empleado</Text>
        <View style={styles.encabezado}>
            <Text style={styles.empresa}>IMPORTADORA DE FRUTAS S.A. DE C.V.</Text>
            <Text style={styles.tituloRecibo}>RECIBO DE PAGO</Text>
            <Text style={styles.quincena}>{r.quincenaNombre.toUpperCase()}</Text>
            <Text style={styles.reciboPorLabel}>Recibo de pago por:</Text>
            <Text style={styles.reciboPorMonto}>{fmt(r.totalARecibir)}</Text>
        </View>

        <View style={styles.infoGrid}>
            <View style={styles.infoItem}><Text style={styles.infoLabel}>Código</Text><Text style={styles.infoValor}>{r.codigoEmpleado}</Text></View>
            <View style={{ flex: 2 }}><Text style={styles.infoLabel}>Nombre</Text><Text style={styles.infoValor}>{r.nombreEmpleado}</Text></View>
            <View style={{ flex: 2 }}><Text style={styles.infoLabel}>Cargo que desempeña</Text><Text style={styles.infoValor}>{r.cargo}</Text></View>
            <View style={styles.infoItem}><Text style={styles.infoLabel}>Días trabajados</Text><Text style={styles.infoValor}>{r.diasTrabajados}</Text></View>
        </View>

        <View style={styles.columnas}>
            <View style={styles.columna}>
                <Text style={styles.columnaTitulo}>Ingresos</Text>
                <FilaMonto label="Sueldo" monto={r.sueldo} />
                <FilaMonto label="Vacaciones" monto={r.vacaciones} />
                <FilaMonto label="Bono" monto={r.bono} />
                <FilaMonto label="Viáticos" monto={r.viaticos} />
                <FilaMonto label={`Horas extras N° (${r.horasExtrasCantidad})`} monto={r.horasExtrasMonto} />
                <FilaMonto label="Nocturnidad" monto={r.nocturnidad} />
                <FilaMonto label="Feriado" monto={r.feriado} />
                <FilaMonto label="HE Feriado" monto={r.heFeriado} />
                <View style={styles.filaTotal}>
                    <Text style={styles.filaTotalLabel}>Total Ingresos</Text>
                    <Text style={styles.filaTotalValor}>{fmt(r.totalIngresos)}</Text>
                </View>
            </View>

            <View style={styles.columna}>
                <Text style={styles.columnaTitulo}>Descuentos</Text>
                <FilaMonto label="Seguro Social (ISSS)" monto={r.isss} />
                <FilaMonto label="AFP Confía" monto={r.afpConfia} />
                <FilaMonto label="AFP Crecer" monto={r.afpCrecer} />
                <FilaMonto label="IPSFA" monto={r.ipsfa} />
                <FilaMonto label="UPIS" monto={r.upiss} />
                <FilaMonto label="ISR sobre bonificación" monto={r.isrBonificacion} />
                <FilaMonto label="ISR sobre salario" monto={r.isrSalario} />
                <FilaMonto label="Financieras (Banco)" monto={r.financieras} />
                <FilaMonto label="FSV" monto={r.fsv} />
                <FilaMonto label="Habitat" monto={r.habitat} />
                <FilaMonto label="Anticipo de salario" monto={r.anticipo} />
                <FilaMonto label="Lentes" monto={r.lentes} />
                <FilaMonto label="Factura de productos" monto={r.factura} />
                <FilaMonto label="Uniforme" monto={r.uniforme} />
                <View style={styles.filaTotal}>
                    <Text style={styles.filaTotalLabel}>Total Descuentos</Text>
                    <Text style={styles.filaTotalValor}>{fmt(r.totalDescuentos)}</Text>
                </View>
            </View>
        </View>

        <View style={styles.totalARecibir}>
            <Text style={styles.totalARecibirLabel}>TOTAL A RECIBIR</Text>
            <Text style={styles.totalARecibirValor}>{fmt(r.totalARecibir)}</Text>
        </View>

        <Text style={styles.firma}>Recibí conforme: _________________________________________________</Text>
    </View>
);

/**
 * Recibo de Sueldo (US-EXP-05, IMPL-158) — formato confirmado por Imporfrut
 * (`1_4_Recibo_de_pago.docx`). Un `<Page>` por recibo dentro de un solo `<Document>`: el mismo
 * componente sirve para generación individual (array de 1) y masiva (array de N), sin duplicar
 * plantilla ni forzar N descargas separadas.
 */
export const ReciboSueldoPDFTemplate: React.FC<{ recibos: ReciboSueldoDatos[] }> = ({ recibos }) => (
    <Document title="Recibo de Sueldo">
        {recibos.map((r, i) => (
            <Page key={i} size="A4" style={styles.page}>
                <UnRecibo r={r} />
            </Page>
        ))}
    </Document>
);
