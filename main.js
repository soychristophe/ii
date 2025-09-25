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

  const pauseMargin = 0.5; // Margen más amplio para evitar dobles pausas
  const currentTime = mpv.getNumber("playback-time");
  
  // Seguridad: Si ya pasamos el fin, no chequeamos (espera nuevo sub via polling/evento)
  if (currentTime > currentSubEnd) {
    console.log(`Sub ya terminó (tiempo=${currentTime.toFixed(2)}s > fin=${currentSubEnd.toFixed(2)}s). Esperando nuevo subtítulo.`);
    return;
  }

  console.log(`Configurando pausa: Sub termina en ${currentSubEnd.toFixed(2)}s (desde ${currentTime.toFixed(2)}s, margen=${pauseMargin}s)`);

  checkInterval = setInterval(() => {
    const nowTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");

    // Log solo cada 5 chequeos para reducir spam (opcional: comenta para más detalles)
    if (Math.floor(nowTime * 10) % 5 === 0) {
      console.log(`Chequeo: t=${nowTime.toFixed(2)}s, p=${isPaused}, v=${subVisibility}, s=${sid}, fin=${currentSubEnd.toFixed(2)}s`);
    }

    if (!isPaused && subVisibility && sid > 0 && nowTime >= (currentSubEnd - pauseMargin) && nowTime < currentSubEnd + 1) {
      core.pause();
      console.log(`*** PAUSADO AUTO a ${nowTime.toFixed(2)}s (fin: ${currentSubEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Play para siguiente subtítulo");
      clearInterval(checkInterval);
    }
  }, 100);
}

// Polling: Detecta cambios en sub-text (con pequeño delay para updates de mpv)
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    setTimeout(() => { // Delay mínimo para sync con mpv
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
  }, 200);
}

// Evento: Inicio de nuevo subtítulo (principal)
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

// Evento: Play manual (solo reinicia polling, NO setup para evitar doble pausa)
event.on("mpv.pause.changed", () => {
  const isPaused = mpv.getFlag("pause");
  if (!isPaused) {
    console.log("*** Play manual: Reiniciando polling para detectar nuevo sub. ***");
    startPolling(); // Solo polling; eventos/polling manejan el resto
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
  core.osd("Plugin pausa-subs: Pulido y activo.");
  if (sid > 0) startPolling(); // Solo si hay subs
});

// Toggle con 'P'
event.on("mpv.key-press", (event) => {
  if (event.key === "P") {
    pluginEnabled = !pluginEnabled;
    const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
    console.log(`Plugin: ${status}`);
    core.osd(`Pausa-subs: ${status}`);
    if (!pluginEnabled && checkInterval) {
      clearInterval(checkInterval); // Limpia si desactivas
    }
  }
});

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});