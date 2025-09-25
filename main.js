const { console, core, event, mpv, preferences } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let lastSubText = "";
let pluginEnabled = true;

// Defaults
let pauseMargin = 0.5;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0; // Nuevo: Offset para calibrar pausa

// Cargar settings ASÍNCRONAMENTE
function loadSettings(callback) {
  let loaded = 0;
  const total = 4; // Aumentado por timeOffset

  function checkLoaded() {
    loaded++;
    if (loaded === total && callback) callback();
  }

  preferences.get("pauseMargin", (value) => {
    pauseMargin = parseFloat(value) || 0.5;
    checkLoaded();
  });

  preferences.get("checkIntervalMs", (value) => {
    checkIntervalMs = parseInt(value) || 100;
    checkLoaded();
  });

  preferences.get("pollIntervalMs", (value) => {
    pollIntervalMs = parseInt(value) || 200;
    checkLoaded();
  });

  preferences.get("timeOffset", (value) => {
    timeOffset = parseFloat(value) || 0;
    checkLoaded();
  });
}

// Función para pausar antes del siguiente subtítulo (con offset)
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval);

  const currentTime = mpv.getNumber("playback-time");
  
  if (currentTime > currentSubEnd) {
    console.log(`Sub ya terminó (tiempo=${currentTime.toFixed(2)}s > fin=${currentSubEnd.toFixed(2)}s). Esperando nuevo.`);
    return;
  }

  const adjustedEnd = currentSubEnd + timeOffset; // Aplicar offset
  console.log(`Configurando pausa: Fin ajustado=${adjustedEnd.toFixed(2)}s (margen=${pauseMargin}s, offset=${timeOffset}s, intervalo=${checkIntervalMs}ms)`);

  checkInterval = setInterval(() => {
    const nowTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");

    if (Math.floor(nowTime * 10) % 5 === 0) {
      console.log(`Chequeo: t=${nowTime.toFixed(2)}s, p=${isPaused}, fin_ajustado=${adjustedEnd.toFixed(2)}s`);
    }

    if (!isPaused && subVisibility && sid > 0 && nowTime >= (adjustedEnd - pauseMargin) && nowTime < adjustedEnd + 1) {
      core.pause();
      console.log(`*** PAUSADO AUTO a ${nowTime.toFixed(2)}s (fin ajustado: ${adjustedEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Play para siguiente subtítulo");
      clearInterval(checkInterval);
    }
  }, checkIntervalMs);
}

// Polling para detectar cambios
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    setTimeout(() => {
      const subText = mpv.getString("sub-text");
      if (subText && subText.trim() !== "" && subText !== lastSubText) {
        lastSubText = subText;
        currentSubEnd = mpv.getNumber("sub-end");
        console.log(`*** Nuevo sub por POLLING: fin=${currentSubEnd.toFixed(2)}s ***`);
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
    console.log(`*** Nuevo sub por EVENTO: fin=${currentSubEnd.toFixed(2)}s ***`);
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

// ... (todo el código anterior igual hasta el evento de teclas)

// Evento: Teclas personalizadas (toggle P + navegación Q/W/E)
event.on("mpv.key-press", (event) => {
  console.log(`Tecla presionada: "${event.key}"`); // Log para debug: confirma detección

  const sid = mpv.getNumber("sid");
  if (sid <= 0) {
    core.osd("No hay subtítulos activos para navegar.", "warning");
    return;
  }

  switch (event.key) {
    case "P": // Toggle plugin
      pluginEnabled = !pluginEnabled;
      const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
      console.log(`Plugin: ${status}`);
      core.osd(`Pausa-subs: ${status}`);
      if (!pluginEnabled && checkInterval) clearInterval(checkInterval);
      break;
    case "E": // Siguiente subtítulo (era D)
      mpv.command("sub_step", 1);
      console.log("*** Avanzar: Siguiente subtítulo (E) ***");
      core.osd("⏭️ Siguiente subtítulo");
      break;
    case "W": // Repetir actual (era S)
      const subStart = mpv.getNumber("sub-start");
      mpv.command("seek", subStart, "absolute");
      console.log(`*** Repetir: Seek a inicio sub (${subStart.toFixed(2)}s) (W) ***`);
      core.osd("🔄 Repitiendo subtítulo actual");
      break;
    case "Q": // Anterior subtítulo (era A)
      mpv.command("sub_step", -1);
      console.log("*** Retroceder: Subtítulo anterior (Q) ***");
      core.osd("⏮️ Subtítulo anterior");
      break;
    default:
      // No log para evitar spam
      break;
  }
});

// ... (resto del código igual)