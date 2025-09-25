const { console, core, event, mpv, preferences } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;

// Defaults (fallback si no hay prefs)
let pauseMargin = 0.5;
let checkIntervalMs = 100;
let pollIntervalMs = 200;

// Cargar settings síncronamente
function loadSettings() {
  pauseMargin = preferences.get("pauseMargin") || 0.5;
  checkIntervalMs = parseInt(preferences.get("checkIntervalMs")) || 100;
  pollIntervalMs = parseInt(preferences.get("pollIntervalMs")) || 200;
  console.log(`Settings cargados: Margen=${pauseMargin}s, Chequeo=${checkIntervalMs}ms, Polling=${pollIntervalMs}ms`);
}

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

// Al cargar archivo (carga settings y reinicia)
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  lastSubText = "";
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Vis: ${subVis ? 'yes' : 'no'}`);
  
  loadSettings();
  core.osd("Plugin pausa-subs: Activo con settings. Reinicia video para cambios.");
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

// Inicializar al cargar plugin
loadSettings();
console.log("Plugin iniciado con settings.");

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});