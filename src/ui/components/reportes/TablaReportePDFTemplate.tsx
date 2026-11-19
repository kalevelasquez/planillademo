import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import BrandLogo from '../../../assets/images/logo-teknergy.png';

// Mismos tokens de color que OrderPDFTemplate.tsx — mantiene consistencia visual entre PDFs.
const COLOR = {
    primary: '#10B981',
    primaryDark: '#065F46',
    secondary: '#1E293B',
    muted: '#64748B',
    light: '#F8FAFC',
    border: '#E2E8F0',
    white: '#FFFFFF',
};

const styles = StyleSheet.create({
    page: { padding: 40, fontFamily: 'Helvetica', fontSize: 9, color: COLOR.secondary, backgroundColor: COLOR.white },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20, borderBottomWidth: 1, borderBottomColor: COLOR.border, paddingBottom: 16,
    },
    logo: { width: 130 },
    headerRight: { alignItems: 'flex-end' },
    docLabel: { fontSize: 8, color: COLOR.muted, textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: 1 },
    titulo: { fontSize: 16, fontWeight: 'bold', color: COLOR.primary, marginTop: 2 },
    subtitulo: { fontSize: 9, color: COLOR.muted, marginTop: 4 },
    date: { fontSize: 8, color: COLOR.muted, marginTop: 2 },
    table: { marginTop: 6 },
    tableHeader: {
        flexDirection: 'row', backgroundColor: COLOR.light, paddingVertical: 6, paddingHorizontal: 8,
        borderTopWidth: 1, borderTopColor: COLOR.border, borderBottomWidth: 1, borderBottomColor: COLOR.border,
    },
    headerText: { fontSize: 7.5, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase', paddingRight: 6 },
    tableRow: {
        flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8,
        borderBottomWidth: 1, borderBottomColor: COLOR.light, alignItems: 'center',
    },
    tableRowAlt: { backgroundColor: '#FBFDFC' },
    // paddingRight: sin esto, dos celdas flex contiguas quedan pegadas cuando el texto llena la
    // caja (ej. "EMP-1998-001Rina Eleonora..." — hallazgo UAT, IMPL-159/166).
    cell: { fontSize: 8.5, color: COLOR.secondary, paddingRight: 6 },
    emptyState: { fontSize: 9, color: COLOR.muted, textAlign: 'center', marginTop: 30 },
    brandingFooter: {
        position: 'absolute', bottom: 24, left: 40, right: 40,
        borderTopWidth: 1, borderTopColor: COLOR.light, paddingTop: 8,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    brandingText: { fontSize: 7, color: '#94A3B8' },
});

export interface ColumnaReportePDF {
    header: string;
    /** Proporción relativa de ancho (flex), igual que las celdas de OrderPDFTemplate. */
    flex?: number;
    align?: 'left' | 'center' | 'right';
}

export interface TablaReportePDFProps {
    titulo: string;
    subtitulo?: string;
    columnas: ColumnaReportePDF[];
    filas: string[][];
    emptyLabel: string;
}

/**
 * Plantilla PDF genérica para reportes tabulares de consulta (US-EXP-06/US-EXP-10 — Vacaciones,
 * Permisos). Reusa los mismos tokens de marca que OrderPDFTemplate.tsx, pero es agnóstica del
 * contenido: recibe columnas y filas ya formateadas como texto, así se comparte entre reportes
 * distintos sin duplicar layout.
 */
export const TablaReportePDFTemplate: React.FC<TablaReportePDFProps> = ({ titulo, subtitulo, columnas, filas, emptyLabel }) => (
    <Document title={titulo}>
        <Page size="A4" style={styles.page}>
            <View style={styles.header}>
                <Image src={BrandLogo} style={styles.logo} />
                <View style={styles.headerRight}>
                    <Text style={styles.docLabel}>REPORTE</Text>
                    <Text style={styles.titulo}>{titulo}</Text>
                    {subtitulo && <Text style={styles.subtitulo}>{subtitulo}</Text>}
                    <Text style={styles.date}>Generado: {new Date().toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}</Text>
                </View>
            </View>

            {filas.length === 0 ? (
                <Text style={styles.emptyState}>{emptyLabel}</Text>
            ) : (
                <View style={styles.table}>
                    <View style={styles.tableHeader} fixed>
                        {columnas.map((col, i) => (
                            <Text key={i} style={[styles.headerText, { flex: col.flex ?? 1, textAlign: col.align ?? 'left' }]}>{col.header}</Text>
                        ))}
                    </View>
                    {filas.map((fila, rowIdx) => (
                        <View key={rowIdx} style={[styles.tableRow, ...(rowIdx % 2 === 1 ? [styles.tableRowAlt] : [])]} wrap={false}>
                            {fila.map((valor, colIdx) => (
                                <Text key={colIdx} style={[styles.cell, { flex: columnas[colIdx]?.flex ?? 1, textAlign: columnas[colIdx]?.align ?? 'left' }]}>{valor}</Text>
                            ))}
                        </View>
                    ))}
                </View>
            )}

            <View style={styles.brandingFooter} fixed>
                <Text style={styles.brandingText}>Importadora de Frutas S.A. de C.V. • El Salvador • {new Date().getFullYear()}</Text>
                <Text style={styles.brandingText} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
            </View>
        </Page>
    </Document>
);
