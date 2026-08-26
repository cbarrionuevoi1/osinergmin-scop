// ============================
// DEPENDENCIAS
// ============================
const axios = require("axios");

// ============================
// CONFIG OSINERGMIN
// ============================
const OSINERGMIN_URL = process.env.OSINERGMIN_URL;
const TOKEN_TRAMA = process.env.OSINERGMIN_TOKEN;

// ⏱ intervalo de envío (1 minuto)
const INTERVAL_MS = 60 * 1000;

// ============================
// ESTADO GLOBAL (EN MEMORIA)
// ============================
// key: placa, value: { state: 'ACTIVA' | 'HISTORICO', mode: 'CONTINUO'|'HISTORICO_CONTINUO'|'HISTORICO', position: {latitude, longitude}, startTime: timestamp }
let placasProcesando = new Map();
let replicaTimer = null;

// ============================
// UTILIDADES
// ============================
function getFormattedGpsDate(dateObj = new Date()) {
    return dateObj.toISOString().split(".")[0] + ".000Z";
}

function buildPayload(placa, position, dateObj = new Date()) {
    return {
        event: "none",
        plate: placa,
        speed: 0,
        position: {
            latitude: Number(position.latitude),
            longitude: Number(position.longitude),
            altitude: 0
        },
        gpsDate: getFormattedGpsDate(dateObj),
        tokenTrama: TOKEN_TRAMA,
        odometer: "0"
    };
}

// ============================
// ENVÍO A OSINERGMIN
// ============================
async function sendTrama(placa, position, dateObj = new Date()) {
    const payload = buildPayload(placa, position, dateObj);

    try {
        const response = await axios.post(
            OSINERGMIN_URL,
            payload,
            {
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            }
        );

        if (response.status === 202) {
            console.log(
                `✅ Trama aceptada por PMGO [${placa}] - ${payload.gpsDate}`
            );
            return true;
        }

        if (response.status >= 200 && response.status < 300) {
            console.log(
                `✅ Trama enviada HTTP ${response.status} [${placa}] - Date: ${payload.gpsDate}`
            );
            return true;
        }

        return false;
    } catch (error) {
        if (error.response) {
            console.error(
                `❌ PMGO [${placa}] HTTP ${error.response.status}`,
                error.response.data
            );
        } else {
            console.error(
                `❌ Error conexión [${placa}]`,
                error.message
            );
        }
        return false;
    }
}

// ============================
// CICLO DE RÉPLICA CONTINUO
// ============================
function ejecutarReplicaContinua() {
    let activas = 0;
    placasProcesando.forEach((info, placa) => {
        if (info.state === 'ACTIVA') {
            activas++;
            sendTrama(placa, info.position, new Date());
        }
    });

    if (activas > 0) {
        console.log(`📡 Ejecutando réplica OSINERGMIN para ${activas} unidades activas`);
    }
}

// ============================
// CICLO HISTÓRICO
// ============================
async function runHistorical(placa, info, dateStr, timeFrom, timeTo) {
    // Parse the local time (Peru UTC-5)
    // Example: dateStr="2026-08-20", timeFrom="16:30", timeTo="17:32"
    // "2026-08-20T16:30:00-05:00"
    const startStr = `${dateStr}T${timeFrom}:00-05:00`;
    const endStr = `${dateStr}T${timeTo}:00-05:00`;

    let current = new Date(startStr);
    const end = new Date(endStr);

    if (isNaN(current) || isNaN(end) || current > end) {
        console.error(`❌ Fechas históricas inválidas para ${placa}`);
        placasProcesando.delete(placa);
        return;
    }

    console.log(`📡 Iniciando histórico para ${placa}: ${startStr} hasta ${endStr}`);

    while (current <= end) {
        // Verificar si se canceló
        if (!placasProcesando.has(placa) || placasProcesando.get(placa).state !== 'HISTORICO') {
            console.log(`🛑 Histórico cancelado para ${placa}`);
            return;
        }

        await sendTrama(placa, info.position, current);

        // Esperar ~1 segundo
        await new Promise(resolve => setTimeout(resolve, 1000));

        current = new Date(current.getTime() + 60 * 1000);
    }

    console.log(`🏁 Histórico finalizado para ${placa}`);

    // Cambiar estado según modo
    if (placasProcesando.has(placa)) {
        if (info.mode === 'HISTORICO_CONTINUO') {
            info.state = 'ACTIVA';
            info.startTime = Date.now();

            console.log(`🟢 Cambiando ${placa} a envío continuo`);

            // Enviar inmediatamente una trama actual
            await sendTrama(placa, info.position, new Date());
        } else {
            // Solo histórico
            placasProcesando.delete(placa);
        }
    }
}

// ============================
// API DEL SERVICIO
// ============================
function startReplica(payload) {
    const { data, mode, date, timeFrom, timeTo } = payload;

    const modeMap = {
        'CONTINUO': 'ACTIVA',
        'HISTORICO_CONTINUO': 'HISTORICO',
        'HISTORICO': 'HISTORICO'
    };

    const initialState = modeMap[mode] || 'ACTIVA';

    data.forEach(p => {
        if (placasProcesando.has(p.placa)) {
            console.log(`⚠️ Placa ${p.placa} ya se está procesando. Omitiendo.`);
            return;
        }

        const info = {
            state: initialState,
            mode: mode || 'CONTINUO',
            position: {
                latitude: Number(p.latitud),
                longitude: Number(p.longitud)
            },
            startTime: Date.now()
        };

        placasProcesando.set(p.placa, info);
        console.log(`🟢 Iniciada réplica [${p.placa}] en modo ${info.mode} (estado inicial: ${info.state})`);

        if (info.state === 'ACTIVA') {
            // Ejecutar la primera inmediatamente
            sendTrama(p.placa, info.position, new Date());
        } else if (info.state === 'HISTORICO') {
            // Iniciar ciclo histórico
            runHistorical(p.placa, info, date, timeFrom, timeTo);
        }
    });

    // Iniciar timer continuo global si hay placas
    if (!replicaTimer) {
        replicaTimer = setInterval(ejecutarReplicaContinua, INTERVAL_MS);
    }
}

function stopReplica() {
    placasProcesando.clear();
    if (replicaTimer) {
        clearInterval(replicaTimer);
        replicaTimer = null;
    }
    console.log("🟥 Réplica DESACTIVADA globalmente");
}

function stopReplicaPlacas(placasArray) {
    if (!Array.isArray(placasArray)) return 0;

    let stoppedCount = 0;
    placasArray.forEach(placa => {
        if (placasProcesando.has(placa)) {
            placasProcesando.delete(placa);
            stoppedCount++;
            console.log(`🛑 Réplica detenida para [${placa}]`);
        }
    });

    if (placasProcesando.size === 0 && replicaTimer) {
        clearInterval(replicaTimer);
        replicaTimer = null;
        console.log("⬛ Sin placas activas, timer continuo detenido temporalmente");
    }

    return stoppedCount;
}

function getReplicaStatus() {
    const list = [];
    placasProcesando.forEach((info, placa) => {
        const elapsedSec = Math.floor((Date.now() - info.startTime) / 1000);
        list.push({
            placa,
            state: info.state,
            mode: info.mode,
            elapsedSeconds: elapsedSec
        });
    });

    return {
        activa: list.length > 0,
        placas: list
    };
}

// ============================
// EXPORTS
// ============================
module.exports = {
    startReplica,
    stopReplica,
    stopReplicaPlacas,
    getReplicaStatus
};
