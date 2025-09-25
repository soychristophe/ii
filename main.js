const { console, core, event, mpv } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;

// Función para pausar antes del siguiente subtítulo
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval);

  const pauseMargin = 0.3; // Aumentado a 0.3s para más margen (ajusta si quieres)
  const currentTime = mpv.getNumber("playback-time"); // Tiempo al inicio del sub
  console.log(`*** Configurando pausa: Sub termina en ${currentSubEnd.toFixed(2)}s (desde tiempo=${currentTime.toFixed(2)}s, margen=${pauseMargin}s) ***`);

  checkInterval = setInterval(() => {
    const nowTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");

    console.log(`Chequeo: tiempo=${nowTime.toFixed(2)}s, pausa=${isPaused}, vis=${subVisibility}, sid=${sid}, fin_sub=${currentSubEnd.toFixed(2)}s`);

    // Pausa solo si no pausado, subs visibles, y cerca del fin (PERO no después del fin + margen para evitar tardío)
    if (!isPaused && subVisibility && sid > 0 && nowTime >= (currentSubEnd - pauseMargin) && nowTime < (currentSubEnd + 1)) {
      core.pause(); // ¡FIX: Usa core.pause() en lugar de command!
      console.log(`*** PAUSADO AUTOMÁTICO a los ${nowTime.toFixed(2)}s (antes de fin: ${currentSubEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Presiona play para siguiente subtítulo"); // FIX: Solo mensaje
      clearInterval(checkInterval); // Detiene inmediatamente
      return; // Sale del intervalo
    }
  }, 100); // Cada 100ms
}

// Polling de respaldo: Detecta cambios en sub-text cada 200ms (más frecuente para tempranía)
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    const subText = mpv.getString("sub-text");
    if (subText && subText.trim() !== "" && subText !== lastSubText) {
      lastSubText = subText;
      currentSubEnd = mpv.getNumber("sub-end");
      console.log(`*** Cambio de subtítulo detectado por POLLING. Texto: "${subText.substring(0, 50)}...", Fin en: ${currentSubEnd.toFixed(2)}s ***`);
      if (pluginEnabled) {
        setupPauseBeforeNextSub();
      }
    }
  }, 200); // Más frecuente para capturar antes
}

// Evento: Cambio en sub-start (inicio de nuevo subtítulo)
event.on("mpv.sub-start.changed", () => {
  const subStart = mpv.getNumber("sub-start");
  const subText = mpv.getString("sub-text");
  const sid = mpv.getNumber("sid");
  console.log(`*** EVENTO sub-start.changed! Inicio: ${subStart.toFixed(2)}s, Texto: "${subText.substring(0, 50)}...", SID: ${sid} ***`);

  if (sid > 0 && subText && subText.trim() !== "") {
    currentSubEnd = mpv.getNumber("sub-end");
    console.log(`Nuevo subtítulo via sub-start. Fin en: ${currentSubEnd.toFixed(2)}s`);
    if (pluginEnabled) {
      setupPauseBeforeNextSub();
    }
  }
});

// Cuando se presiona play (reinicia)
event.on("mpv.pause.changed", () => {
  const isPaused = mpv.getFlag("pause");
  if (!isPaused) {
    console.log("*** Play manual: Reiniciando chequeo y polling. ***");
    core.resume(); // Asegura resume si needed
    const currentSub = mpv.getString("sub-text");
    console.log(`Sub-text al play: "${currentSub.substring(0, 50)}..."`);
    if (currentSub && currentSub.trim() !== "") {
      currentSubEnd = mpv.getNumber("sub-end");
      lastSubText = currentSub;
      if (pluginEnabled) setupPauseBeforeNextSub();
    }
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
  const initialSubText = mpv.getString("sub-text");
  console.log(`Archivo cargado. SID: ${sid}, Sub vis: ${subVis}, Sub-text inicial: "${initialSubText.substring(0, 50)}..."`);
  core.osd("Plugin pausa-subs: Activo (con fixes). Chequea logs.");
  startPolling();
});

// Toggle con 'P'
event.on("mpv.key-press", (event) => {
  if (event.key === "P") {
    pluginEnabled = !pluginEnabled;
    const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
    console.log(`Plugin ${status}`);
    core.osd(`Pausa antes de subs: ${status}`);
  }
});

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});