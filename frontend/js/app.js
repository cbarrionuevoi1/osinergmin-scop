// =====================
// CONFIG (desde backend)
// =====================
let API_BASE_URL = "";

// =====================
// ESTADO GLOBAL
// =====================
let dataOriginal = [];
let lastExecutedAt = null;
let lastDataSignature = null;

// Selección
let placasSeleccionadas = new Set();

// =====================
// RÉPLICA (ESTADO)
// =====================
let replicaActiva = false;
let replicaStartTime = null;
let replicaTimer = null;

// =====================
// AUTO REFRESH
// =====================
const AUTO_REFRESH_INTERVAL = 60000; // 1 minuto

// =====================
// INIT
// =====================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        await cargarConfig();
        aplicarTemaGuardado();
        await cargarUltimoResultado();
        actualizarDashboard();
        await sincronizarEstadoReplica();
    } catch (e) {
        console.error("❌ Error inicializando app:", e);
        mostrarError("No se pudo inicializar la aplicación");
    }

    document.getElementById("themeToggle")
        ?.addEventListener("click", toggleTheme);

    document.getElementById("runManualBtn")
        ?.addEventListener("click", ejecutarConsultaManual);

    document.getElementById("plateFilter")
        ?.addEventListener("input", aplicarFiltros);

    document.getElementById("statusFilter")
        ?.addEventListener("change", aplicarFiltros);

    document.getElementById("replicaToggleBtn")
        ?.addEventListener("click", onClickReplica);

    document.getElementById("selectAllTable")
        ?.addEventListener("change", toggleSeleccionarTodo);

    document.getElementById("cancelReplica")
        ?.addEventListener("click", cerrarModalReplica);

    document.getElementById("confirmReplica")
        ?.addEventListener("click", confirmarReplica);

    // =====================
    // 🔽 FILTRO SVG (EMBUDO)
    // =====================
    const filterToggle   = document.getElementById("filterToggle");
    const filterDropdown = document.getElementById("filterDropdown");
    const statusFilter   = document.getElementById("statusFilter");

    if (filterToggle && filterDropdown && statusFilter) {

        filterToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            filterDropdown.classList.toggle("hidden");
        });

        filterDropdown.querySelectorAll("div").forEach(option => {
            option.addEventListener("click", () => {
                statusFilter.value = option.dataset.value;
                aplicarFiltros();
                filterDropdown.classList.add("hidden");
            });
        });

        document.addEventListener("click", () => {
            filterDropdown.classList.add("hidden");
        });
    }

    // 🔄 AUTO-REFRESH
    setInterval(async () => {
        try {
            await cargarUltimoResultado();
            await sincronizarEstadoReplica();
        } catch (e) {
            console.warn("⚠️ Error en auto-refresh", e);
        }
    }, AUTO_REFRESH_INTERVAL);
});

// =====================
// CONFIG BACKEND
// =====================
async function cargarConfig() {
    const res = await fetch("/config");
    if (!res.ok) throw new Error("No se pudo cargar configuración");

    const config = await res.json();
    API_BASE_URL = config.API_BASE_URL;
}

// =====================
// BACKEND
// =====================
async function ejecutarConsultaManual() {
    try {
        mostrarCargando();

        const res = await fetch(`${API_BASE_URL}/run-manual`);
        if (!res.ok) throw new Error("Error HTTP");

        const result = await res.json();

        dataOriginal = result.data || [];
        lastExecutedAt = result.executedAt;
        lastDataSignature = generarFirmaDatos(dataOriginal);

        placasSeleccionadas.clear();
        actualizarInfoEjecucion(result.executedAt);
        aplicarFiltros();
        actualizarDashboard();

    } catch (e) {
        console.error("❌ Error manual:", e);
        mostrarError("No se pudo obtener la información");
    }
}

async function cargarUltimoResultado() {
    const res = await fetch(`${API_BASE_URL}/last-result`);
    if (!res.ok) return;

    const result = await res.json();
    const firmaNueva = generarFirmaDatos(result.data || []);

    if (firmaNueva !== lastDataSignature) {
        dataOriginal = result.data || [];
        lastDataSignature = firmaNueva;
        placasSeleccionadas.clear();
        aplicarFiltros();
        actualizarDashboard();
    }

    actualizarInfoEjecucion(result.executedAt);
}

// =====================
// FIRMA DE DATOS
// =====================
function generarFirmaDatos(data) {
    return JSON.stringify(data.map(i => `${i.placa}|${i.estado}`));
}

// =====================
// FILTROS
// =====================
function aplicarFiltros() {
    let data = [...dataOriginal];

    const texto = document.getElementById("plateFilter")
        ?.value.toUpperCase().trim();

    if (texto) {
        data = data.filter(i =>
            i.placa.includes(texto) ||
            i.razonSocial.includes(texto)
        );
    }

    const estado = document.getElementById("statusFilter")?.value;
    if (estado !== "ALL") {
        data = data.filter(i => i.estado === estado);
    }

    renderTabla(data);
    renderCards(data);
}

// =====================
// RENDER TABLA
// =====================
function renderTabla(data) {
    const tbody = document.getElementById("platesTable");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty">No hay resultados</td></tr>`;
        return;
    }

    data.forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><input type="checkbox" data-placa="${item.placa}"></td>
            <td>${item.razonSocial}</td>
            <td>${item.placa}</td>
            <td><span class="estado ${item.estado === "ACTIVO" ? "activo" : "inactivo"}">${item.estado}</span></td>
        `;

        const cb = tr.querySelector("input");
        cb.checked = placasSeleccionadas.has(item.placa);
        cb.addEventListener("change", () => actualizarSeleccion(item.placa, cb.checked));

        tbody.appendChild(tr);
    });

    sincronizarSelectAll(data);
}

// =====================
// RENDER CARDS
// =====================
function renderCards(data) {
    const container = document.getElementById("cardsContainer");
    if (!container) return;

    container.innerHTML = "";

    if (!data.length) {
        container.innerHTML = `<div class="empty">No hay resultados</div>`;
        return;
    }

    data.forEach(item => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <input type="checkbox" data-placa="${item.placa}">
            <div class="card-content">
                <div><span class="label">Razón Social:</span> ${item.razonSocial}</div>
                <div>
                    <span class="label">Placa:</span> ${item.placa} ·
                    <span class="estado ${item.estado === "ACTIVO" ? "activo" : "inactivo"}">${item.estado}</span>
                </div>
            </div>
        `;

        const cb = card.querySelector("input");
        cb.checked = placasSeleccionadas.has(item.placa);
        cb.addEventListener("change", () => {
            actualizarSeleccion(item.placa, cb.checked);
            renderTabla(data);
        });

        container.appendChild(card);
    });
}

// =====================
// SELECCIÓN
// =====================
function actualizarSeleccion(placa, checked) {
    checked ? placasSeleccionadas.add(placa) : placasSeleccionadas.delete(placa);
    sincronizarCheckboxes();
}

function sincronizarCheckboxes() {
    document.querySelectorAll('input[data-placa]').forEach(cb => {
        cb.checked = placasSeleccionadas.has(cb.dataset.placa);
    });
}

function toggleSeleccionarTodo(e) {
    document.querySelectorAll('input[data-placa]').forEach(cb => {
        actualizarSeleccion(cb.dataset.placa, e.target.checked);
    });
}

function sincronizarSelectAll(data) {
    const all = document.getElementById("selectAllTable");
    if (all) {
        all.checked = data.every(d => placasSeleccionadas.has(d.placa));
    }
}

// =====================
// DASHBOARD
// =====================
function actualizarDashboard() {
    document.getElementById("countTotal").innerText = dataOriginal.length;
    document.getElementById("countActive").innerText =
        dataOriginal.filter(i => i.estado === "ACTIVO").length;
    document.getElementById("countInactive").innerText =
        dataOriginal.filter(i => i.estado === "INACTIVO").length;
}

// =====================
// RÉPLICA (TOGGLE)
// =====================
function onClickReplica() {
    if (replicaActiva) {
        desactivarReplica();
        return;
    }

    if (!placasSeleccionadas.size) {
        alert("Seleccione al menos una placa");
        return;
    }

    abrirModalReplica();
}

function abrirModalReplica() {
    const form = document.getElementById("replicaForm");
    form.innerHTML = "";

    placasSeleccionadas.forEach(p => {
        form.innerHTML += `
            <div class="replica-row">
                <strong>${p}</strong>
                <input placeholder="Latitud ejm:-12.28810">
                <input placeholder="Longitud ejm:-76.84334">
            </div>`;
    });

    document.getElementById("replicaModal").classList.remove("hidden");
}

function cerrarModalReplica() {
    document.getElementById("replicaModal").classList.add("hidden");
}

async function confirmarReplica() {
    const payload = [];

    document.querySelectorAll(".replica-row").forEach(row => {
        payload.push({
            placa: row.querySelector("strong").innerText,
            latitud: row.querySelectorAll("input")[0].value,
            longitud: row.querySelectorAll("input")[1].value
        });
    });

    await fetch("/replica/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: payload })
    });

    cerrarModalReplica();
    await sincronizarEstadoReplica();
}

// =====================
// ESTADO DE RÉPLICA (BACKEND)
// =====================
async function sincronizarEstadoReplica() {
    const res = await fetch("/replica/status");
    if (!res.ok) return;

    const info = await res.json();

    replicaActiva = info.activa;
    replicaStartTime = info.startTime ? new Date(info.startTime).getTime() : null;

    actualizarUIReplica();
}

async function desactivarReplica() {
    await fetch("/replica/stop", { method: "POST" });
    await sincronizarEstadoReplica();
}

function actualizarUIReplica() {
    const status = document.getElementById("replicaStatus");
    const btn = document.getElementById("replicaToggleBtn");

    if (!replicaActiva) {
        if (status) status.innerText = "🟥 Réplica desactivada";
        if (btn) btn.innerText = "Activar réplica";
        if (replicaTimer) clearInterval(replicaTimer);
        return;
    }

    if (btn) btn.innerText = "Desactivar réplica";

    if (replicaTimer) clearInterval(replicaTimer);

    replicaTimer = setInterval(() => {
        const diff = Math.floor((Date.now() - replicaStartTime) / 1000);
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        if (status) {
            status.innerText = `🟢 Réplica activa · ${m ? m + " min " : ""}${s} s`;
        }
    }, 1000);
}

// =====================
// UI HELPERS
// =====================
function mostrarCargando() {
    document.getElementById("platesTable").innerHTML =
        `<tr><td colspan="4" class="empty">Consultando información...</td></tr>`;
}

function mostrarError(msg) {
    document.getElementById("platesTable").innerHTML =
        `<tr><td colspan="4" class="empty" style="color:red">${msg}</td></tr>`;
}

function actualizarInfoEjecucion(fecha) {
    document.getElementById("lastExecution").innerText =
        fecha ? new Date(fecha).toLocaleString() : "--";
}

// =====================
// TEMA OSCURO
// =====================
function toggleTheme() {
    document.body.classList.toggle("dark");
    localStorage.setItem(
        "theme",
        document.body.classList.contains("dark") ? "dark" : "light"
    );
}

function aplicarTemaGuardado() {
    if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark");
    }
}
