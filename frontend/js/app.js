// =====================
// CONFIG (desde backend)
// =====================
let API_BASE_URL = "";

// =====================
// ESTADO GLOBAL
// =====================
let dataOriginal = [];

// =====================
// INIT
// =====================
document.addEventListener("DOMContentLoaded", async () => {
    try {
        await cargarConfig();           // 🔑 primero config
        aplicarTemaGuardado();
        calcularProximaEjecucion();
        await cargarUltimoResultado();  // 🔑 luego data
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
});

// =====================
// CONFIG BACKEND
// =====================
async function cargarConfig() {
    const res = await fetch("/config");
    if (!res.ok) {
        throw new Error("No se pudo cargar configuración");
    }

    const config = await res.json();

    if (!config.API_BASE_URL) {
        throw new Error("API_BASE_URL no recibido");
    }

    API_BASE_URL = config.API_BASE_URL;
    console.log("🔧 API_BASE_URL:", API_BASE_URL);
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

        actualizarInfoEjecucion(result.executedAt, "Manual");
        aplicarFiltros();

    } catch (e) {
        console.error("❌ Error manual:", e);
        mostrarError("No se pudo obtener la información");
    }
}

async function cargarUltimoResultado() {
    const res = await fetch(`${API_BASE_URL}/last-result`);
    if (!res.ok) return;

    const result = await res.json();
    dataOriginal = result.data || [];

    actualizarInfoEjecucion(
        result.executedAt,
        result.type === "automatic" ? "Automática" : "Manual"
    );

    aplicarFiltros();
}

// =====================
// FILTROS
// =====================
function aplicarFiltros() {
    let data = [...dataOriginal];

    const texto = document.getElementById("plateFilter")
        ?.value.toUpperCase().trim();

    if (texto) {
        const criterios = texto
            .split(",")
            .map(v => v.trim())
            .filter(Boolean);

        data = data.filter(i =>
            criterios.some(c =>
                i.placa.includes(c) ||
                i.razonSocial.includes(c)
            )
        );
    }

    const estado = document.getElementById("statusFilter")?.value;
    if (estado !== "ALL") {
        data = data.filter(i => i.estado === estado);
    }

    renderTabla(data);
}

// =====================
// RENDER
// =====================
function renderTabla(data) {
    const tbody = document.getElementById("platesTable");
    const cards = document.getElementById("cardsContainer");

    if (!tbody || !cards) return;

    tbody.innerHTML = "";
    cards.innerHTML = "";

    if (!data || data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="3" class="empty">No hay resultados</td>
            </tr>`;
        cards.innerHTML = `<div class="empty">No hay resultados</div>`;
        return;
    }

    data.forEach(item => {
        const estadoClass =
            item.estado === "ACTIVO" ? "estado activo" : "estado inactivo";

        /* TABLA (DESKTOP) */
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${item.razonSocial}</td>
            <td>${item.placa}</td>
            <td><span class="${estadoClass}">${item.estado}</span></td>
        `;
        tbody.appendChild(tr);

        /* CARDS (MOBILE) */
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <strong>Razón Social:</strong> ${item.razonSocial}<br>
            <strong>Placa:</strong> ${item.placa}<br>
            <strong>Estado:</strong>
            <span class="${estadoClass}">${item.estado}</span>
        `;
        cards.appendChild(card);
    });
}

// =====================
// UI HELPERS
// =====================
function mostrarCargando() {
    document.getElementById("platesTable").innerHTML = `
        <tr>
            <td colspan="3" class="empty">
                Consultando información...
            </td>
        </tr>`;
}

function mostrarError(msg) {
    document.getElementById("platesTable").innerHTML = `
        <tr>
            <td colspan="3" class="empty" style="color:red">
                ${msg}
            </td>
        </tr>`;
}

function actualizarInfoEjecucion(fecha, tipo) {
    document.getElementById("lastExecution").innerText =
        fecha ? new Date(fecha).toLocaleString() : "--";
}

// =====================
// TEMA OSCURO
// =====================
function toggleTheme() {
    const dark = document.body.classList.toggle("dark");
    localStorage.setItem("theme", dark ? "dark" : "light");
}

function aplicarTemaGuardado() {
    if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark");
    }
}

// =====================
// PRÓXIMA EJECUCIÓN
// =====================
function calcularProximaEjecucion() {
    const el = document.getElementById("nextExecution");
    if (!el) return;

    const horas = [0, 4, 8, 12, 16, 20];
    const now = new Date();

    let next = horas
        .map(h => {
            const d = new Date();
            d.setHours(h, 0, 0, 0);
            return d;
        })
        .find(d => d > now);

    if (!next) {
        next = new Date();
        next.setDate(next.getDate() + 1);
        next.setHours(0, 0, 0, 0);
    }

    el.innerText = next.toLocaleString();
}
