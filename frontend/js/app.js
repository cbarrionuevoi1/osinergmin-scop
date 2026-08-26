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
let replicaPlacasData = []; // [{placa, state, mode, elapsedSeconds}]
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

    // replicaToggleBtn logic is now assigned dynamically in actualizarSelectionInfoBar()

    document.getElementById("selectAllTable")
        ?.addEventListener("change", toggleSeleccionarTodo);

    document.getElementById("cancelReplica")
        ?.addEventListener("click", cerrarModalReplica);

    document.getElementById("confirmReplica")
        ?.addEventListener("click", confirmarReplica);

    // Modal Events
    document.querySelectorAll('input[name="replicaMode"]').forEach(radio => {
        radio.addEventListener("change", toggleHistoricalSection);
    });

    ['histDate', 'histFrom', 'histTo'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', calculateHistoricalFrames);
    });

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
        actualizarSelectionInfoBar();

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
        actualizarSelectionInfoBar();
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
        const tokens = texto.split(',').map(t => t.trim()).filter(t => t);
        data = data.filter(i => 
            tokens.some(token => 
                i.placa.includes(token) || 
                i.razonSocial.includes(token)
            )
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
        tbody.innerHTML = `<tr><td colspan="5" class="empty">No hay resultados</td></tr>`;
        return;
    }

    data.forEach(item => {
        const replicaInfo = getReplicaInfo(item.placa);
        const replicaBadge = buildReplicaBadge(replicaInfo);

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><input type="checkbox" data-placa="${item.placa}"></td>
            <td>${item.razonSocial}</td>
            <td>${item.placa}</td>
            <td><span class="estado ${item.estado === "ACTIVO" ? "activo" : "inactivo"}">${item.estado}</span></td>
            <td>${replicaBadge}</td>
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
        const replicaInfo = getReplicaInfo(item.placa);
        const replicaBadge = buildReplicaBadge(replicaInfo);

        const card = document.createElement("div");
        card.className = "card" + (placasSeleccionadas.has(item.placa) ? " selected" : "");
        card.innerHTML = `
            <input type="checkbox" data-placa="${item.placa}">
            <div class="card-content">
                <div><span class="label">Razón Social:</span> ${item.razonSocial}</div>
                <div class="card-meta">
                    <div><span class="label">Placa:</span> ${item.placa}</div>
                    <span class="estado ${item.estado === "ACTIVO" ? "activo" : "inactivo"}">${item.estado}</span>
                </div>
                <div><span class="label">Réplica:</span> ${replicaBadge}</div>
            </div>
        `;

        const cb = card.querySelector("input");
        cb.checked = placasSeleccionadas.has(item.placa);
        cb.addEventListener("change", () => {
            actualizarSeleccion(item.placa, cb.checked);
            card.classList.toggle("selected", cb.checked);
        });

        container.appendChild(card);
    });
}

function getReplicaInfo(placa) {
    return replicaPlacasData.find(p => p.placa === placa);
}

function buildReplicaBadge(info) {
    if (!info) return `<span class="replica-badge inactiva">INACTIVA</span>`;
    if (info.state === "ACTIVA") return `<span class="replica-badge activa">ACTIVA</span>`;
    if (info.state === "HISTORICO") return `<span class="replica-badge historico">HISTÓRICO</span>`;
    return `<span class="replica-badge inactiva">INACTIVA</span>`;
}

// =====================
// SELECCIÓN
// =====================
function actualizarSeleccion(placa, checked) {
    checked ? placasSeleccionadas.add(placa) : placasSeleccionadas.delete(placa);
    sincronizarCheckboxes();
    actualizarSelectionInfoBar();
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

function actualizarSelectionInfoBar() {
    const bar = document.getElementById("selectionInfoBar");
    const text = document.getElementById("selectionText");
    const btn = document.getElementById("replicaToggleBtn");

    if (!bar || !text || !btn) return;

    if (placasSeleccionadas.size === 0) {
        bar.classList.add("hidden");
        btn.disabled = true;
        btn.style.opacity = 0.5;
        btn.style.cursor = "not-allowed";
        btn.innerText = "Activar réplica";
        btn.onclick = null;
        return;
    }

    let activas = 0;
    let historico = 0;
    let inactivas = 0;

    placasSeleccionadas.forEach(p => {
        const info = getReplicaInfo(p);
        if (info) {
            if (info.state === 'ACTIVA') activas++;
            else if (info.state === 'HISTORICO') historico++;
        } else {
            inactivas++;
        }
    });

    text.innerText = `${placasSeleccionadas.size} unidades seleccionadas · ${activas} activa(s) · ${historico} en histórico · ${inactivas} inactiva(s)`;
    bar.classList.remove("hidden");
    
    // Determine button action based on selection
    if (historico > 0 || (activas > 0 && inactivas > 0)) {
        // Mixed state or historical processing: disable button
        btn.disabled = true;
        btn.style.opacity = 0.5;
        btn.style.cursor = "not-allowed";
        
        if (historico > 0) {
            btn.innerText = "Histórico en proceso";
            btn.title = "No se pueden realizar acciones mientras hay un histórico procesándose.";
        } else {
            btn.innerText = "Acción inválida";
            btn.title = "Selección mixta. Seleccione solo unidades activas o solo unidades inactivas.";
        }
        btn.onclick = null;
    } else if (activas > 0 && inactivas === 0) {
        // All active: Show Deactivate
        btn.disabled = false;
        btn.style.opacity = 1;
        btn.style.cursor = "pointer";
        btn.innerText = "Desactivar réplica";
        btn.title = "Detener réplica de las unidades seleccionadas";
        btn.onclick = desactivarReplicaSeleccion;
    } else if (inactivas > 0 && activas === 0) {
        // All inactive: Show Activate
        btn.disabled = false;
        btn.style.opacity = 1;
        btn.style.cursor = "pointer";
        btn.innerText = "Activar réplica";
        btn.title = "Iniciar réplica para las unidades seleccionadas";
        btn.onclick = onClickReplica;
    }
}

async function desactivarReplicaSeleccion() {
    const placas = Array.from(placasSeleccionadas);
    
    try {
        await fetch("/replica/stop-some", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ placas })
        });
        
        placasSeleccionadas.clear();
        sincronizarCheckboxes();
        await sincronizarEstadoReplica();
    } catch (error) {
        console.error("Error desactivando réplica", error);
        alert("Ocurrió un error al intentar detener las réplicas.");
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
// RÉPLICA (MODAL Y LOGICA)
// =====================
function onClickReplica() {
    if (document.getElementById("replicaToggleBtn").disabled) return;
    if (!placasSeleccionadas.size) {
        alert("Seleccione al menos una placa");
        return;
    }
    abrirModalReplica();
}

function abrirModalReplica() {
    const form = document.getElementById("replicaForm");
    form.innerHTML = "";
    
    let validPlates = 0;
    let processingPlates = 0;

    placasSeleccionadas.forEach(p => {
        const info = getReplicaInfo(p);
        if (info) {
            processingPlates++;
            return; // Skip plates already processing
        }
        validPlates++;
        form.innerHTML += `
            <div class="replica-row" data-placa="${p}">
                <strong>${p}</strong>
                <input type="text" inputmode="decimal" placeholder="Latitud ejm: -12.28810" class="lat-input">
                <input type="text" inputmode="decimal" placeholder="Longitud ejm: -76.84334" class="lon-input">
            </div>`;
    });

    if (processingPlates > 0) {
        alert(`${placasSeleccionadas.size} unidades seleccionadas.\n${processingPlates} ya están en proceso y serán omitidas.\nSe procesarán únicamente ${validPlates} unidades.`);
    }

    if (validPlates === 0) {
        return; // Nothing to process
    }

    // Reset modal state
    document.querySelector('input[name="replicaMode"][value="CONTINUO"]').checked = true;
    toggleHistoricalSection();
    document.getElementById("histDate").value = "";
    document.getElementById("histFrom").value = "";
    document.getElementById("histTo").value = "";
    calculateHistoricalFrames();

    document.getElementById("replicaModal").classList.remove("hidden");
}

function cerrarModalReplica() {
    document.getElementById("replicaModal").classList.add("hidden");
}

function toggleHistoricalSection() {
    const mode = document.querySelector('input[name="replicaMode"]:checked').value;
    const histSection = document.getElementById("historicalSection");
    
    if (mode === 'HISTORICO' || mode === 'HISTORICO_CONTINUO') {
        histSection.classList.remove("hidden");
        histSection.style.display = "block";
    } else {
        histSection.classList.add("hidden");
        histSection.style.display = "none";
        document.getElementById("histDate").value = "";
        document.getElementById("histFrom").value = "";
        document.getElementById("histTo").value = "";
        document.getElementById("historicalCalc").innerHTML = "-- tramas históricas";
    }
}

function calculateHistoricalFrames() {
    const date = document.getElementById("histDate").value;
    const from = document.getElementById("histFrom").value;
    const to = document.getElementById("histTo").value;
    const calcDiv = document.getElementById("historicalCalc");
    
    if (!date || !from || !to) {
        calcDiv.innerHTML = "-- tramas históricas";
        return;
    }
    
    const dFrom = new Date(`${date}T${from}:00`);
    const dTo = new Date(`${date}T${to}:00`);
    
    if (dTo < dFrom) {
        calcDiv.innerHTML = "Hora 'Hasta' debe ser mayor a 'Desde'";
        calcDiv.style.color = "red";
        return;
    }
    
    calcDiv.style.color = ""; // reset color
    
    const diffMs = dTo - dFrom;
    const diffMins = Math.floor(diffMs / 60000);
    const totalFrames = diffMins + 1; // Inclusive
    
    const isCont = document.querySelector('input[name="replicaMode"]:checked').value === 'HISTORICO_CONTINUO';
    
    let html = `<strong>${totalFrames} tramas históricas</strong><br>`;
    html += `${date} · ${from} &rarr; ${to}`;
    if (isCont) {
        html += `<br><small style="margin-top:5px;display:inline-block;">Luego continuará enviando una trama cada minuto.</small>`;
    }
    
    calcDiv.innerHTML = html;
}

async function confirmarReplica() {
    const mode = document.querySelector('input[name="replicaMode"]:checked').value;
    
    const date = document.getElementById("histDate").value;
    const from = document.getElementById("histFrom").value;
    const to = document.getElementById("histTo").value;
    
    // Validation
    if (mode !== 'CONTINUO') {
        if (!date || !from || !to) {
            alert("Debe completar Fecha, Desde y Hasta para el modo histórico.");
            return;
        }
        if (new Date(`${date}T${to}:00`) < new Date(`${date}T${from}:00`)) {
            alert("La hora final no puede ser menor a la hora inicial.");
            return;
        }
    }
    
    const payload = [];
    let hasError = false;

    document.querySelectorAll(".replica-row").forEach(row => {
        const lat = row.querySelector(".lat-input").value;
        const lon = row.querySelector(".lon-input").value;
        
        const numLat = Number(lat);
        const numLon = Number(lon);
        
        if (!lat || !lon || isNaN(numLat) || isNaN(numLon)) hasError = true;
        else if (numLat < -90 || numLat > 90) hasError = true;
        else if (numLon < -180 || numLon > 180) hasError = true;
        
        payload.push({
            placa: row.dataset.placa,
            latitud: lat,
            longitud: lon
        });
    });
    
    if (hasError) {
        alert("Coordenadas inválidas. Complete latitud (-90 a 90) y longitud (-180 a 180) para todas las unidades.");
        return;
    }

    const requestBody = {
        data: payload,
        mode: mode,
        date: date,
        timeFrom: from,
        timeTo: to
    };

    await fetch("/replica/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
    });

    cerrarModalReplica();
    
    // Refresh to show changes
    await sincronizarEstadoReplica();
}

// =====================
// ESTADO DE RÉPLICA (BACKEND)
// =====================
async function sincronizarEstadoReplica() {
    const res = await fetch("/replica/status");
    if (!res.ok) return;

    const info = await res.json();
    replicaPlacasData = info.placas || [];

    // Count states
    let activasCount = 0;
    let historicoCount = 0;
    replicaPlacasData.forEach(p => {
        if (p.state === 'ACTIVA') activasCount++;
        if (p.state === 'HISTORICO') historicoCount++;
    });

    document.getElementById("countReplicaActiva").innerText = activasCount;
    document.getElementById("countReplicaHistorico").innerText = historicoCount;

    // Refresh UI
    aplicarFiltros();
    actualizarSelectionInfoBar();
}

function mostrarCargando() {
    document.getElementById("platesTable").innerHTML =
        `<tr><td colspan="5" class="empty">Consultando información...</td></tr>`;
}

function mostrarError(msg) {
    document.getElementById("platesTable").innerHTML =
        `<tr><td colspan="5" class="empty" style="color:red">${msg}</td></tr>`;
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
