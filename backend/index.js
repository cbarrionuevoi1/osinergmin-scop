// ============================
// CARGA DE VARIABLES DE ENTORNO
// ============================
require('dotenv').config({ path: '../.env' });

// ============================
// DEPENDENCIAS
// ============================
const express = require('express');
const axios = require('axios');
const XLSX = require('xlsx');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// ============================
// SERVICIO DE RÉPLICA
// ============================
const replicaService = require('./replica');

// ============================
// APP
// ============================
const app = express();
app.use(express.json());

// ============================
// CONFIG
// ============================
const PORT = process.env.PORT || 3001;
const API_BASE_URL = process.env.API_BASE_URL;
const OSINERGMIN_EXCEL_URL = process.env.OSINERGMIN_EXCEL_URL;

const CRON_INTERVAL_MINUTES = parseInt(
    process.env.CRON_INTERVAL_MINUTES || '240',
    10
);

// ============================
// VALIDACIONES
// ============================
if (!API_BASE_URL) {
    throw new Error('❌ API_BASE_URL no definido en .env');
}

if (!OSINERGMIN_EXCEL_URL) {
    throw new Error('❌ OSINERGMIN_EXCEL_URL no definido en .env');
}

if (isNaN(CRON_INTERVAL_MINUTES) || CRON_INTERVAL_MINUTES <= 0) {
    throw new Error('❌ CRON_INTERVAL_MINUTES inválido');
}

// ============================
// RUTAS DE ARCHIVOS
// ============================
const LAST_RESULT_FILE = path.join(__dirname, 'last-result.json');
const PLACAS_FILE = path.join(__dirname, 'placas.json');

// ============================
// SERVIR FRONTEND
// ============================
app.use(express.static(path.join(__dirname, '../frontend')));

// ============================
// CONFIG PARA FRONTEND
// ============================
app.get('/config', (req, res) => {
    res.json({ API_BASE_URL });
});

// ============================
// UTILIDADES
// ============================
function cargarPlacasPermitidas() {
    if (!fs.existsSync(PLACAS_FILE)) {
        console.warn('⚠️ placas.json no encontrado');
        return null;
    }

    const contenido = fs.readFileSync(PLACAS_FILE, 'utf-8');
    return JSON.parse(contenido).map(p =>
        String(p).toUpperCase().trim()
    );
}

async function descargarExcel() {
    const response = await axios.get(OSINERGMIN_EXCEL_URL, {
        responseType: 'arraybuffer',
        timeout: 60000
    });

    console.log(`📥 Excel descargado: ${response.data.byteLength} bytes`);
    return response.data;
}

function procesarExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const placasPermitidas = cargarPlacasPermitidas();

    let resultado = rows.map(row => ({
        razonSocial: String(row['RAZON SOCIAL'] || '').trim(),
        placa: String(row['PLACA'] || '').trim().toUpperCase(),
        estado: String(row['ESTADO'] || '').trim().toUpperCase()
    }))
    .filter(r => r.placa && r.razonSocial);

    if (Array.isArray(placasPermitidas)) {
        resultado = resultado.filter(r =>
            placasPermitidas.includes(r.placa)
        );
    }

    resultado.sort((a, b) =>
        a.razonSocial.localeCompare(b.razonSocial, 'es', {
            sensitivity: 'base'
        })
    );

    return resultado;
}

// ============================
// PROCESO PRINCIPAL
// ============================
async function ejecutarProceso(tipo = 'manual') {
    console.log(`🚀 Proceso ${tipo}`);
    const excelBuffer = await descargarExcel();
    const data = procesarExcel(excelBuffer);

    fs.writeFileSync(
        LAST_RESULT_FILE,
        JSON.stringify({
            executedAt: new Date().toISOString(),
            type: tipo,
            data
        }, null, 2),
        'utf-8'
    );

    return data;
}

// ============================
// ENDPOINTS – CONSULTAS
// ============================
app.get('/run-manual', async (req, res) => {
    try {
        const data = await ejecutarProceso('manual');
        res.json({
            executedAt: new Date().toISOString(),
            type: 'manual',
            data
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error en ejecución manual' });
    }
});

app.get('/last-result', (req, res) => {
    if (!fs.existsSync(LAST_RESULT_FILE)) {
        return res.json({ data: [] });
    }

    const content = fs.readFileSync(LAST_RESULT_FILE, 'utf-8');
    res.json(JSON.parse(content));
});

// ============================
// ENDPOINTS – RÉPLICA (FUNCIONAL)
// ============================

// Estado de réplica
app.get('/replica/status', (req, res) => {
    res.json(replicaService.getReplicaStatus());
});

// Activar réplica
app.post('/replica/start', (req, res) => {
    const { data } = req.body;

    if (!Array.isArray(data) || !data.length) {
        return res.status(400).json({
            error: 'Se esperaba un array de placas'
        });
    }

    console.log('▶️ Solicitud activar réplica:', data);

    replicaService.startReplica(data);

    res.json({
        ok: true,
        message: 'Réplica activada'
    });
});

// Desactivar réplica
app.post('/replica/stop', (req, res) => {
    replicaService.stopReplica();

    res.json({
        ok: true,
        message: 'Réplica desactivada'
    });
});

// ============================
// CRON AUTOMÁTICO (TABLA)
// ============================
const cronExpression = `*/${CRON_INTERVAL_MINUTES} * * * *`;

cron.schedule(cronExpression, async () => {
    try {
        console.log('⏱️ CRON tabla ejecutando');
        await ejecutarProceso('automatic');
    } catch (err) {
        console.error('❌ CRON error:', err.message);
    }
});

// ============================
// SERVER
// ============================
app.listen(PORT, () => {
    console.log(`🚀 Backend activo en ${API_BASE_URL}`);
});
