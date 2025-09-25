const { console, core, event, mpv } = iina;

// Variables
let checkInterval = null;
let pollInterval = null; // Para polling de respaldo
let currentSubEnd = 0;
let lastSubText = ""; // Para detectar cambios por polling
let pluginEnabled = true;

// Función para pausar antes del siguiente subtítulo
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval);

  const pauseMargin = 0.2; // Pausa 0.2s antes del fin
  console.log(`Configurando pausa para subtítulo que termina en ${currentSubEnd.toFixed(2)}s (margen: ${pauseMargin}s)`);

  checkInterval = setInterval(() => {
    const currentTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");

    console.log(`Chequeo: tiempo=${currentTime.toFixed(2)}s, pausa=${isPaused}, vis=${subVisibility}, sid=${sid}, fin_sub=${currentSubEnd.toFixed(2)}s`);

    if (!isPaused && subVisibility && sid > 0 && currentTime >= (currentSubEnd - pauseMargin)) {
      core.command("set pause yes");
      console.log(`*** PAUSADO AUTOMÁTICO a los ${currentTime.toFixed(2)}s (antes de fin: ${currentSubEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Presiona play para siguiente subtítulo", "info");
      clearInterval(checkInterval);
    }
  }, 100); // Cada 100ms
}

// Polling de respaldo: Chequea cambios en sub-text cada 500ms
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
  }, 500); // Bajo impacto en CPU
}

// Evento principal: Cambio en sub-start (inicio de nuevo subtítulo)
event.on("mpv.sub-start.changed", () => {
  const subStart = mpv.getNumber("sub-start");
  const subText = mpv.getString("sub-text");
  const sid = mpv.getNumber("sid");
  console.log(`*** EVENTO sub-start.changed detectado! Inicio: ${subStart.toFixed(2)}s, Texto: "${subText.substring(0, 50)}...", SID: ${sid} ***`);

  if (sid > 0 && subText && subText.trim() !== "") {
    currentSubEnd = mpv.getNumber("sub-end");
    console.log(`Nuevo subtítulo detectado via sub-start. Fin en: ${currentSubEnd.toFixed(2)}s`);
    if (pluginEnabled) {
      setupPauseBeforeNextSub();
    }
  } else {
    console.log("sub-start cambió pero subtítulo vacío o no activo.");
  }
});

// Log cuando se presiona play (reinicia chequeo y polling)
event.on("mpv.pause.changed", () => {
  const isPaused = mpv.getFlag("pause");
  if (!isPaused) {
    console.log("*** Play manual presionado. Reiniciando chequeo y polling. ***");
    const currentSub = mpv.getString("sub-text");
    console.log(`Sub-text actual al play: "${currentSub.substring(0, 50)}..."`); // Debug extra
    if (currentSub && currentSub.trim() !== "") {
      currentSubEnd = mpv.getNumber("sub-end");
      lastSubText = currentSub; // Actualiza para polling
      if (pluginEnabled) setupPauseBeforeNextSub();
    }
    startPolling(); // Inicia polling si no está
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
  core.osd("Plugin de pausa: Activo con sub-start y polling. Chequea logs.", "info");
  startPolling(); // Inicia polling desde el inicio
});

// Toggle con tecla 'P'
event.on("mpv.key-press", (event) => {
  if (event.key === "P") {
    pluginEnabled = !pluginEnabled;
    const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
    console.log(`Plugin ${status}`);
    core.osd(`Pausa antes de subs: ${status}`, "info");
  }
});

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});