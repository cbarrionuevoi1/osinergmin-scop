// ============================
// DEPENDENCIAS
// ============================
const axios = require("axios");

// ============================
// CONFIG OSINERGMIN
// ============================
const OSINERGMIN_URL = "https://prod.osinergmin-agent-2021.com/api/v1/trama";
const TOKEN_TRAMA = "0FE7C536-5A25-4994-A09F-6262BD58736";

// ⏱ intervalo de envío (1 minuto)
const INTERVAL_MS = 60 * 1000;

// ============================
// ESTADO GLOBAL (EN MEMORIA)
// ============================
let replicaActiva = false;
let replicaStartTime = null;
let replicaTimer = null;
let placasActivas = [];

// ============================
// UTILIDADES
// ============================
function getFormattedGpsDate() {
    const now = new Date();
    return now.toISOString().split(".")[0] + ".000Z";
}

function buildPayload(placa, position) {
    return {
        event: "none",
        plate: placa,
        speed: 0,
        position: {
            latitude: position.latitude,
            longitude: position.longitude,
            altitude: 0
        },
        gpsDate: getFormattedGpsDate(),
        tokenTrama: TOKEN_TRAMA,
        odometer: "0"
    };
}

// ============================
// ENVÍO A OSINERGMIN
// ============================
async function sendTrama(placaInfo) {
    const payload = buildPayload(
        placaInfo.placa,
        placaInfo.position
    );

    try {
        const response = await axios.post(
            OSINERGMIN_URL,
            payload,
            {
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            }
        );

        console.log(
            `✅ Trama enviada [${placaInfo.placa}]`,
            response.data
        );

    } catch (error) {
        if (error.response) {
            console.error(
                `❌ Error OSINERGMIN [${placaInfo.placa}]`,
                error.response.status,
                error.response.data
            );
        } else {
            console.error(
                `❌ Error conexión [${placaInfo.placa}]`,
                error.message
            );
        }
    }
}

// ============================
// CICLO DE RÉPLICA
// ============================
function ejecutarReplica() {
    if (!replicaActiva) return;

    console.log("📡 Ejecutando réplica OSINERGMIN");

    placasActivas.forEach(placaInfo => {
        sendTrama(placaInfo);
    });
}

// ============================
// API DEL SERVICIO
// ============================
function startReplica(placas) {
    if (replicaActiva) {
        console.log("⚠️ Réplica ya activa");
        return;
    }

    replicaActiva = true;
    replicaStartTime = Date.now();

    // Normalizamos estructura esperada
    placasActivas = placas.map(p => ({
        placa: p.placa,
        position: {
            latitude: Number(p.latitud),
            longitude: Number(p.longitud)
        }
    }));

    console.log("🟢 Réplica ACTIVADA:", placasActivas.map(p => p.placa));

    // Ejecuta inmediatamente
    ejecutarReplica();

    // Programa intervalo
    replicaTimer = setInterval(ejecutarReplica, INTERVAL_MS);
}

function stopReplica() {
    if (!replicaActiva) return;

    replicaActiva = false;
    replicaStartTime = null;
    placasActivas = [];

    if (replicaTimer) {
        clearInterval(replicaTimer);
        replicaTimer = null;
    }

    console.log("🟥 Réplica DESACTIVADA");
}

function getReplicaStatus() {
    if (!replicaActiva) {
        return {
            activa: false
        };
    }

    const elapsedSec = Math.floor(
        (Date.now() - replicaStartTime) / 1000
    );

    return {
        activa: true,
        placas: placasActivas.map(p => p.placa),
        elapsedSeconds: elapsedSec
    };
}

// ============================
// EXPORTS
// ============================
module.exports = {
    startReplica,
    stopReplica,
    getReplicaStatus
};
