const { console, core, event, mpv, settings } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;

// Defaults (se sobrescriben con settings)
let pauseMargin = 0.5; // Segundos
let checkIntervalMs = 100; // ms
let pollIntervalMs = 200; // ms

// Registrar settings al cargar
function registerSettings() {
  settings.register({
    id: "pauseMargin",
    title: "Margen de pausa (segundos)",
    type: "number",
    default: 0.5,
    min: 0.1,
    max: 5.0,
    step: 0.1,
    description: "Cuántos segundos antes del fin del subtítulo pausar."
  });

  settings.register({
    id: "checkIntervalMs",
    title: "Intervalo de chequeo (ms)",
    type: "number",
    default: 100,
    min: 50,
    max: 500,
    step: 50,
    description: "Frecuencia de chequeo durante el subtítulo (menor = más preciso)."
  });

  settings.register({
    id: "pollIntervalMs",
    title: "Intervalo de polling (ms)",
    type: "number",
    default: 200,
    min: 100,
    max: 1000,
    step: 50,
    description: "Frecuencia para detectar nuevos subtítulos."
  });

  // Cargar valores iniciales
  loadSettings();
}

// Cargar y aplicar settings
function loadSettings() {
  pauseMargin = settings.get("pauseMargin") || 0.5;
  checkIntervalMs = settings.get("checkIntervalMs") || 100;
  pollIntervalMs = settings.get("pollIntervalMs") || 200;
  console.log(`Settings cargados: Margen=${pauseMargin}s, Chequeo=${checkIntervalMs}ms, Polling=${pollIntervalMs}ms`);
}

// Escucha cambios en settings y aplica
event.on("settings.changed", (event) => {
  if (event.id === "pauseMargin" || event.id === "checkIntervalMs" || event.id === "pollIntervalMs") {
    loadSettings();
    console.log(`Settings actualizados: ${event.id} cambiado a ${event.value}`);
    // Reinicia intervalos si activos
    if (checkInterval) {
      clearInterval(checkInterval);
      setupPauseBeforeNextSub(); // Reconfigura con nuevos valores
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      startPolling();
    }
  }
});

// Función para pausar antes del siguiente subtítulo (usa settings)
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval);

  const currentTime = mpv.getNumber("playback-time");
  
  if (currentTime > currentSubEnd) {
    console.log(`Sub ya terminó (tiempo=${currentTime.toFixed(2)}s > fin=${currentSubEnd.toFixed(2)}s). Esperando nuevo.`);
    return;
  }

  console.log(`Configurando pausa: Fin en ${currentSubEnd.toFixed(2)}s (desde ${currentTime.toFixed(2)}s, margen=${pauseMargin}s, intervalo=${checkIntervalMs}ms)`);

  checkInterval = setInterval(() => {
    const nowTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");

    if (Math.floor(nowTime * 10) % 5 === 0) {
      console.log(`Chequeo: t=${nowTime.toFixed(2)}s, p=${isPaused}, v=${subVisibility}, s=${sid}, fin=${currentSubEnd.toFixed(2)}s`);
    }

    if (!isPaused && subVisibility && sid > 0 && nowTime >= (currentSubEnd - pauseMargin) && nowTime < currentSubEnd + 1) {
      core.pause();
      console.log(`*** PAUSADO AUTO a ${nowTime.toFixed(2)}s (fin: ${currentSubEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Play para siguiente subtítulo");
      clearInterval(checkInterval);
    }
  }, checkIntervalMs);
}

// Polling (usa settings)
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    setTimeout(() => {
      const subText = mpv.getString("sub-text");
      if (subText && subText.trim() !== "" && subText !== lastSubText) {
        lastSubText = subText;
        currentSubEnd = mpv.getNumber("sub-end");
        console.log(`*** Nuevo sub por POLLING: "${subText.substring(0, 50)}...", fin=${currentSubEnd.toFixed(2)}s ***`);
        if (pluginEnabled) {
          setupPauseBeforeNextSub();
        }
      }
    }, 50);
  }, pollIntervalMs);
}

// Evento: Inicio de nuevo subtítulo
event.on("mpv.sub-start.changed", () => {
  const subStart = mpv.getNumber("sub-start");
  const subText = mpv.getString("sub-text");
  const sid = mpv.getNumber("sid");
  
  if (sid > 0 && subText && subText.trim() !== "") {
    currentSubEnd = mpv.getNumber("sub-end");
    lastSubText = subText;
    console.log(`*** Nuevo sub por EVENTO: inicio=${subStart.toFixed(2)}s, fin=${currentSubEnd.toFixed(2)}s ***`);
    if (pluginEnabled) {
      setupPauseBeforeNextSub();
    }
  }
});

// Evento: Play manual
event.on("mpv.pause.changed", () => {
  const isPaused = mpv.getFlag("pause");
  if (!isPaused) {
    console.log("*** Play manual: Reiniciando polling. ***");
    startPolling();
  }
});

// Al cargar archivo
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  lastSubText = "";
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Vis: ${subVis ? 'yes' : 'no'}`);
  core.osd("Plugin pausa-subs: Activo con settings configurables.");
  if (sid > 0) startPolling();
});

// Toggle con 'P'
event.on("mpv.key-press", (event) => {
  if (event.key === "P") {
    pluginEnabled = !pluginEnabled;
    const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
    console.log(`Plugin: ${status}`);
    core.osd(`Pausa-subs: ${status}`);
    if (!pluginEnabled && checkInterval) {
      clearInterval(checkInterval);
    }
  }
});

// Inicializar settings al cargar el plugin
registerSettings();

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});