const { console, core, event, mpv, preferences } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let nextSubStart = 0; // Start del SIGUIENTE sub
let lastSubText = "";
let pluginEnabled = true;

// Defaults
let pauseMargin = 0.5;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0;

// Cargar settings ASÍNCRONAMENTE
function loadSettings(callback) {
  let loaded = 0;
  const total = 4;

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

// Función para obtener el start del siguiente subtítulo (sin afectar playback)
function getNextSubStart() {
  const sid = mpv.getNumber("sid");
  if (sid <= 0) return 0;

  // FIX: Usa array para argumentos
  mpv.command("sub_step", [1]);
  const nextStart = mpv.getNumber("sub-start");
  mpv.command("sub_step", [-1]); // Vuelve
  return nextStart;
}

// Función para configurar pausa antes del inicio del siguiente sub
function setupPauseBeforeNextSubStart() {
  if (checkInterval) clearInterval(checkInterval);

  const currentTime = mpv.getNumber("playback-time");
  const adjustedStart = nextSubStart + timeOffset;
  
  if (currentTime >= adjustedStart) {
    console.log(`Ya pasamos el inicio del sub (tiempo=${currentTime.toFixed(2)}s >= start=${adjustedStart.toFixed(2)}s). Configurando para el próximo.`);
    nextSubStart = getNextSubStart();
    return setupPauseBeforeNextSubStart(); // Recursivo para actualizar
  }

  console.log(`Configurando pausa antes de sub: Start ajustado=${adjustedStart.toFixed(2)}s (desde ${currentTime.toFixed(2)}s, margen=${pauseMargin}s, offset=${timeOffset}s)`);

  checkInterval = setInterval(() => {
    const nowTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");

    if (Math.floor(nowTime * 10) % 5 === 0) {
      console.log(`Chequeo: t=${nowTime.toFixed(2)}s, p=${isPaused}, start_prox=${adjustedStart.toFixed(2)}s`);
    }

    if (!isPaused && subVisibility && sid > 0 && nowTime >= (adjustedStart - pauseMargin) && nowTime < adjustedStart + 0.5) {
      core.pause();
      console.log(`*** PAUSADO ANTES DE SUB a ${nowTime.toFixed(2)}s (start: ${adjustedStart.toFixed(2)}s) ***`);
      core.osd("⏸️ Pausa: Play para revelar subtítulo");
      clearInterval(checkInterval);
    }
  }, checkIntervalMs);
}

// Polling de respaldo para detectar fin de sub (sub-text vacío)
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    setTimeout(() => {
      const subText = mpv.getString("sub-text");
      if (subText.trim() === "" && lastSubText !== "") { // Fin de sub detectado
        lastSubText = "";
        console.log("*** Fin de sub detectado por POLLING. Preparando pausa para próximo. ***");
        nextSubStart = getNextSubStart();
        if (pluginEnabled && nextSubStart > 0) {
          setupPauseBeforeNextSubStart();
        }
      } else if (subText && subText.trim() !== "" && subText !== lastSubText) {
        lastSubText = subText; // Actualiza para próximo fin
      }
    }, 50);
  }, pollIntervalMs);
}

// Evento principal: Fin de subtítulo actual
event.on("mpv.sub-end.changed", () => {
  const subEnd = mpv.getNumber("sub-end");
  const sid = mpv.getNumber("sid");
  console.log(`*** EVENTO sub-end.changed: Fin en ${subEnd.toFixed(2)}s, SID: ${sid} ***`);
  
  if (sid > 0 && pluginEnabled) {
    nextSubStart = getNextSubStart();
    console.log(`Próximo sub inicia en: ${nextSubStart.toFixed(2)}s`);
    setupPauseBeforeNextSubStart();
  }
});

// Evento: Inicio de nuevo subtítulo (actualiza lastSubText)
event.on("mpv.sub-start.changed", () => {
  const subStart = mpv.getNumber("sub-start");
  const subText = mpv.getString("sub-text");
  if (mpv.getNumber("sid") > 0 && subText && subText.trim() !== "") {
    lastSubText = subText;
    console.log(`*** Nuevo sub iniciado en ${subStart.toFixed(2)}s ***`);
  }
});

// Evento: Play manual (reinicia polling)
event.on("mpv.pause.changed", () => {
  const isPaused = mpv.getFlag("pause");
  if (!isPaused) {
    console.log("*** Play manual: Reiniciando polling. ***");
    startPolling();
  }
});

// Evento: Teclas (C/N/Y) - FIX en seek
event.on("mpv.key-press", (event) => {
  console.log(`Tecla presionada: "${event.key}"`);

  const sid = mpv.getNumber("sid");
  if (sid <= 0) {
    core.osd("No hay subtítulos activos para navegar.", "warning");
    return;
  }

  switch (event.key) {
    case "P":
      pluginEnabled = !pluginEnabled;
      const status = pluginEnabled ? "ACTIVADO" : "DESACTIVADO";
      console.log(`Plugin: ${status}`);
      core.osd(`Pausa-subs: ${status}`);
      if (!pluginEnabled && checkInterval) clearInterval(checkInterval);
      break;
    case "Y": // Siguiente
      mpv.command("sub_step", [1]);
      console.log("*** Avanzar: Siguiente subtítulo (Y) ***");
      core.osd("⏭️ Siguiente subtítulo");
      break;
    case "N": // Repetir - FIX: array para seek
      const subStart = mpv.getNumber("sub-start");
      mpv.command("seek", [subStart, "absolute"]);
      console.log(`*** Repetir: Seek a ${subStart.toFixed(2)}s (N) ***`);
      core.osd("🔄 Repitiendo subtítulo actual");
      break;
    case "C": // Anterior
      mpv.command("sub_step", [-1]);
      console.log("*** Retroceder: Subtítulo anterior (C) ***");
      core.osd("⏮️ Subtítulo anterior");
      break;
  }
});

// Al cargar archivo
event.on("mpv.file-loaded", () => {
  nextSubStart = 0;
  lastSubText = "";
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Vis: ${subVis ? 'yes' : 'no'}`);
  
  loadSettings(() => {
    console.log(`Settings: Margen=${pauseMargin}s, Chequeo=${checkIntervalMs}ms, Polling=${pollIntervalMs}ms, Offset=${timeOffset}s`);
    core.osd("Plugin activo: Pausa ANTES de subtítulos + Navegación (C: ant, N: rep, Y: sig).");
    if (sid > 0) {
      nextSubStart = getNextSubStart();
      console.log(`Primer sub inicia en: ${nextSubStart.toFixed(2)}s`);
      startPolling();
      if (pluginEnabled) setupPauseBeforeNextSubStart();
    }
  });
});

// Inicializar
loadSettings(() => {
  console.log("Plugin iniciado: Modo pausa antes de inicio de subs.");
});

// Limpieza
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  console.log("Plugin descargado.");
});