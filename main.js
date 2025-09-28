const { console, core, event, mpv, preferences, input } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0; // Fin del subtítulo ACTUAL
let lastSubText = "";
let pluginEnabled = true;

// Defaults
let pauseMargin = 0.0;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0;

// Nueva función: Auto-repeat
let autoRepeatEnabled = false;
let repeatCount = 2;

preferences.get("autoRepeatEnabled", (value) => {
  autoRepeatEnabled = value === true;
});

preferences.get("repeatCount", (value) => {
  repeatCount = parseInt(value) || 2;
});


// Cargar settings ASÍNCRONAMENTE
function loadSettings(callback) {
  let loaded = 0;
  const total = 4;

  function checkLoaded() {
    loaded++;
    if (loaded === total && callback) callback();
  }

  preferences.get("pauseMargin", (value) => {
    pauseMargin = parseFloat(value) || 0.0;
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

// Función para configurar pausa cerca del final del subtítulo actual
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval);

  const currentTime = mpv.getNumber("playback-time");
  const adjustedEnd = currentSubEnd + timeOffset;

  if (currentTime > adjustedEnd) {
    console.log(`Sub ya terminó (tiempo=${currentTime.toFixed(2)}s > fin=${adjustedEnd.toFixed(2)}s). Esperando nuevo.`);
    return;
  }

  console.log(`Configurando pausa: Fin ajustado=${adjustedEnd.toFixed(2)}s (desde ${currentTime.toFixed(2)}s, margen=${pauseMargin}s, offset=${timeOffset}s)`);

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
      console.log(`*** PAUSADO ANTES DEL SIGUIENTE a ${nowTime.toFixed(2)}s (fin: ${adjustedEnd.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Play para siguiente subtítulo");
      clearInterval(checkInterval);
    }
  }, checkIntervalMs);
}

// Polling de respaldo
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
        if (autoRepeatEnabled) {
          currentRepeat = 0;
          scheduleAutoRepeat();
        }
      }
    }, 50);
  }, pollIntervalMs);
}

// Repetición automática
function scheduleAutoRepeat() {
  if (!autoRepeatEnabled) return;

  const subStart = mpv.getNumber("sub-start");
  const subEnd = mpv.getNumber("sub-end");
  const duration = (subEnd - subStart) * 1000;

  if (currentRepeat < repeatCount) {
    setTimeout(() => {
      mpv.command("seek", [subStart.toString(), "absolute"]);
      console.log(`🔄 AutoRepeat (${currentRepeat + 1}/${repeatCount})`);
      core.osd(`🔄 AutoRepeat (${currentRepeat + 1}/${repeatCount})`);
      currentRepeat++;
      scheduleAutoRepeat();
    }, duration + 300);
  } else {
    console.log("➡️ Avanzar al siguiente subtítulo");
    mpv.command("sub_step", ["1"]);
  }
}

// Evento: nuevo subtítulo
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
    if (autoRepeatEnabled) {
      currentRepeat = 0;
      scheduleAutoRepeat();
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

// Evento: Teclas
input.on("keyDown", (ev) => {
  console.log(`Tecla presionada: "${ev.key}"`);

  const sid = mpv.getNumber("sid");
  if (sid <= 0) {
    core.osd("No hay subtítulos activos para navegar.", "warning");
    return;
  }

  switch (ev.key.toUpperCase()) {
    case "P":
      pluginEnabled = !pluginEnabled;
      const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
      console.log(`Plugin: ${status}`);
      core.osd(`Pausa-subs: ${status}`);
      if (!pluginEnabled && checkInterval) clearInterval(checkInterval);
      break;
    case "Y":
      mpv.command("sub_step", ["1"]);
      console.log("*** Avanzar: Siguiente subtítulo (Y) ***");
      core.osd("⏭️ Siguiente subtítulo");
      break;
    case "N":
      const subStart = mpv.getNumber("sub-start");
      mpv.command("seek", [subStart.toString(), "absolute"]);
      console.log(`*** Repetir: Seek a ${subStart.toFixed(2)}s (N) ***`);
      core.osd("🔄 Repitiendo subtítulo actual");
      break;
    case "C":
      mpv.command("sub_step", ["-1"]);
      console.log("*** Retroceder: Subtítulo anterior (C) ***");
      core.osd("⏮️ Subtítulo anterior");
      break;
    case "R":
      autoRepeatEnabled = !autoRepeatEnabled;
      core.osd(`Auto-repeat: ${autoRepeatEnabled ? "ON" : "OFF"} (${repeatCount}x)`);
      console.log(`Auto-repeat: ${autoRepeatEnabled}`);
      break;
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

  loadSettings(() => {
    console.log(`Settings: Margen=${pauseMargin}s, Chequeo=${checkIntervalMs}ms, Polling=${pollIntervalMs}ms, Offset=${timeOffset}s`);
    core.osd("Plugin activo: Pausa al final del sub + Navegación (C: ant, N: rep, Y: sig, R: auto-repeat)");
    if (sid > 0) startPolling();
  });
});

// Inicializar
loadSettings(() => {
  console.log("Plugin iniciado: Pausa estable al final del subtítulo (fix undefined).");
});

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});
