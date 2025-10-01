const { console, core, event, mpv, preferences, input, menu } = iina;

// Variables
let checkInterval = null;
let pollInterval = null;
let currentSubEnd = 0;
let currentSubStart = 0;
let lastSubText = "";
let pluginEnabled = true;
let remainingPlays = 1;
let isRepeating = false;

// Defaults
let pauseMargin = 0.0;
let checkIntervalMs = 100;
let pollIntervalMs = 200;
let timeOffset = 0;
let autoRepeatEnabled = false;
let repeatTimes = 5;

// Cargar settings ASÍNCRONAMENTE
function loadSettings(callback) {
  let loaded = 0;
  const total = 6;

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

  preferences.get("autoRepeat", (value) => {
    autoRepeatEnabled = value === true || value === "true";
    checkLoaded();
  });

  preferences.get("repeatTimes", (value) => {
    repeatTimes = parseInt(value) || 5;
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

  console.log(`Configurando pausa/repeat: Fin ajustado=${adjustedEnd.toFixed(2)}s (desde ${currentTime.toFixed(2)}s, margen=${pauseMargin}s, offset=${timeOffset}s, reps_quedan=${remainingPlays})`);

  checkInterval = setInterval(() => {
    const nowTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");
    const subVisibility = mpv.getFlag("sub-visibility");
    const sid = mpv.getNumber("sid");
    const currentSubText = mpv.getString("sub-text");

    if (Math.floor(nowTime * 10) % 5 === 0) {
      console.log(`Chequeo: t=${nowTime.toFixed(2)}s, p=${isPaused}, fin_ajustado=${adjustedEnd.toFixed(2)}s, reps_quedan=${remainingPlays}, sub_text_len=${currentSubText ? currentSubText.length : 0}`);
    }

    // Condición ajustada: Trigger preciso al umbral
    const triggerThreshold = adjustedEnd - pauseMargin;
    const willOvershoot = nowTime >= triggerThreshold && nowTime < adjustedEnd;
    const isSameSub = currentSubText === lastSubText && currentSubText.trim() !== "";

    if (!isPaused && subVisibility && sid > 0 && willOvershoot && isSameSub) {
      console.log(`*** Trigger detectado a ${nowTime.toFixed(2)}s (threshold=${triggerThreshold.toFixed(2)}s, willOvershoot=${willOvershoot}, mismo_sub=${isSameSub}, autoRepeatEnabled=${autoRepeatEnabled}, remainingPlays=${remainingPlays}) ***`);
      
      if (autoRepeatEnabled && remainingPlays > 1) {
        const thisRepeatNum = repeatTimes - remainingPlays + 1;
        console.log(`*** AUTO-REPEAT: Iniciando repetición ${thisRepeatNum}/${repeatTimes} a ${nowTime.toFixed(2)}s ***`);
        
        // Marcar que estamos en modo repetición
        isRepeating = true;
        
        // Usar sub-seek 0 para repeat
        mpv.command("sub-seek", ["0"]);
        
        remainingPlays--;
        core.resume();
        core.osd(`🔄 Rep ${thisRepeatNum}/${repeatTimes}`);
        
        clearInterval(checkInterval);
        
        // Delay más largo para asegurar que el seek se complete
        setTimeout(() => {
          // Reconfirmar sub-end post-seek
          currentSubEnd = mpv.getNumber("sub-end");
          currentSubStart = mpv.getNumber("sub-start");
          console.log(`Post-seek: Confirmado sub-start=${currentSubStart.toFixed(2)}s, sub-end=${currentSubEnd.toFixed(2)}s, reps restantes=${remainingPlays}`);
          setupPauseBeforeNextSub();
        }, 200); // Aumentado el delay
      } else if (autoRepeatEnabled && remainingPlays === 1) {
        console.log(`*** AUTO-REPEAT: Última rep completada a ${nowTime.toFixed(2)}s (${repeatTimes} totales). Avanzando al siguiente... ***`);
        core.osd(`✅ ${repeatTimes} reps - Siguiente sub`);
        isRepeating = false;
        clearInterval(checkInterval);
        // No pausar: continuar
      } else {
        // Modo sin auto-repeat: Pausar
        core.pause();
        console.log(`*** PAUSA NORMAL a ${nowTime.toFixed(2)}s (fin: ${adjustedEnd.toFixed(2)}s) ***`);
        core.osd("⏸️ Pausa: Play para siguiente subtítulo");
        clearInterval(checkInterval);
      }
    }
  }, checkIntervalMs);
}

// Polling de respaldo para detectar cambios en sub-text
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    setTimeout(() => {
      const subText = mpv.getString("sub-text");
      if (subText && subText.trim() !== "" && subText !== lastSubText) {
        lastSubText = subText;
        currentSubEnd = mpv.getNumber("sub-end");
        currentSubStart = mpv.getNumber("sub-start");
        console.log(`*** Nuevo sub por POLLING: inicio=${currentSubStart.toFixed(2)}s, fin=${currentSubEnd.toFixed(2)}s, texto="${subText.substring(0, 20)}..." ***`);
        if (pluginEnabled) {
          // Reiniciar contador de repeticiones solo si no estamos en modo repetición
          if (!isRepeating) {
            remainingPlays = autoRepeatEnabled ? repeatTimes : 1;
          }
          setupPauseBeforeNextSub();
        }
      }
    }, 50);
  }, pollIntervalMs);
}

// Función helper para navegar subtítulos
function handleSubtitleNavigation(command) {
  const sid = mpv.getNumber("sid");
  if (sid <= 0) {
    core.osd("❌ No hay subtítulos activos para navegar", "warning");
    return;
  }
  
  switch(command) {
    case "next":
      mpv.command("sub-seek", ["1"]);
      console.log("*** Avanzar: Siguiente subtítulo (sub-seek 1) ***");
      core.osd("⏭️ Siguiente subtítulo");
      core.resume();
      isRepeating = false; // Resetear el estado de repetición
      break;
    case "repeat":
      mpv.command("sub-seek", ["0"]);
      console.log("*** Repetir MANUAL: sub-seek 0 al inicio actual ***");
      core.osd("🔄 Repitiendo subtítulo actual");
      core.resume();
      break;
    case "previous":
      mpv.command("sub-seek", ["-1"]);
      console.log("*** Retroceder: Subtítulo anterior (sub-seek -1) ***");
      core.osd("⏮️ Subtítulo anterior");
      core.resume();
      isRepeating = false; // Resetear el estado de repetición
      break;
    case "toggle":
      pluginEnabled = !pluginEnabled;
      const status = pluginEnabled ? "ACTIVADO ✅" : "DESACTIVADO ❌";
      console.log(`Plugin: ${status}`);
      core.osd(`Pausa-subs: ${status}`);
      if (!pluginEnabled && checkInterval) clearInterval(checkInterval);
      break;
  }
}

// Evento: Inicio de nuevo subtítulo
event.on("mpv.sub-start.changed", () => {
  const subStart = mpv.getNumber("sub-start");
  const subText = mpv.getString("sub-text");
  const sid = mpv.getNumber("sid");
  
  if (sid > 0 && subText && subText.trim() !== "" && subText !== lastSubText) {
    currentSubEnd = mpv.getNumber("sub-end");
    currentSubStart = subStart;
    lastSubText = subText;
    console.log(`*** Nuevo sub por EVENTO: inicio=${subStart.toFixed(2)}s, fin=${currentSubEnd.toFixed(2)}s, texto="${subText.substring(0, 20)}..." ***`);
    if (pluginEnabled) {
      // Reiniciar contador de repeticiones solo si no estamos en modo repetición
      if (!isRepeating) {
        remainingPlays = autoRepeatEnabled ? repeatTimes : 1;
      }
      setupPauseBeforeNextSub();
    }
  } else if (subText === lastSubText) {
    console.log(`*** Sub-start evento ignorado: Mismo texto (repeat en curso), reps restantes=${remainingPlays} ***`);
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

// Registrar tecla P para toggle
input.onKeyDown("p", (data) => {
  console.log("Tecla P detectada - Toggle plugin");
  handleSubtitleNavigation("toggle");
  return true;
});

// Registrar teclas A, S, D
input.onKeyDown("a", (data) => {
  console.log("Tecla A detectada - Subtítulo anterior");
  handleSubtitleNavigation("previous");
  return true;
});

input.onKeyDown("s", (data) => {
  console.log("Tecla S detectada - Repetir subtítulo");
  handleSubtitleNavigation("repeat");
  return true;
});

input.onKeyDown("d", (data) => {
  console.log("Tecla D detectada - Siguiente subtítulo");
  handleSubtitleNavigation("next");
  return true;
});

// MÉTODO 2: Menú API
try {
  if (menu && menu.addItem) {
    console.log("Intentando registrar items de menú...");
    
    menu.addItem({
      title: "Plugin: Toggle On/Off",
      action: () => handleSubtitleNavigation("toggle"),
      key: "Ctrl+Shift+P",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "p"
    });
    
    menu.addItem({
      title: "Subtítulo Anterior",
      action: () => handleSubtitleNavigation("previous"),
      key: "Ctrl+Shift+A",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "a"
    });
    
    menu.addItem({
      title: "Repetir Subtítulo",
      action: () => handleSubtitleNavigation("repeat"),
      key: "Ctrl+Shift+S",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "s"
    });
    
    menu.addItem({
      title: "Siguiente Subtítulo",
      action: () => handleSubtitleNavigation("next"),
      key: "Ctrl+Shift+D",
      keyModifier: ["ctrl", "shift"],
      keyEquivalent: "d"
    });
    
    console.log("Items de menú registrados");
  }
} catch (e) {
  console.log("Error menú:", e.message);
}

// MÉTODO 3: Comandos MPV
try {
  mpv.registerScriptMessageHandler("subtitle-previous", () => handleSubtitleNavigation("previous"));
  mpv.registerScriptMessageHandler("subtitle-repeat", () => handleSubtitleNavigation("repeat"));
  mpv.registerScriptMessageHandler("subtitle-next", () => handleSubtitleNavigation("next"));
  mpv.registerScriptMessageHandler("subtitle-toggle", () => handleSubtitleNavigation("toggle"));
  
  console.log("Comandos MPV registrados:");
  console.log("- script-message subtitle-previous/ repeat/ next/ toggle");
} catch (e) {
  console.log("Error comandos MPV:", e.message);
}

// Al cargar archivo
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  currentSubStart = 0;
  lastSubText = "";
  remainingPlays = 1;
  isRepeating = false;
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  const sid = mpv.getNumber("sid");
  const subVis = mpv.getFlag("sub-visibility");
  console.log(`Archivo cargado. SID: ${sid}, Vis: ${subVis ? 'yes' : 'no'}`);
  
  loadSettings(() => {
    console.log(`Settings cargados: Margen=${pauseMargin}s, Chequeo=${checkIntervalMs}ms, AutoRepeat=${autoRepeatEnabled ? 'Sí (' + repeatTimes + ' veces)' : 'No'}`);
    
    // FIX PRUNING: Solo si auto-repeat
    if (autoRepeatEnabled) {
      try {
        mpv.setOption("sub-ass-prune-delay", "inf");
        console.log("*** PRUNING OFF: sub-ass-prune-delay=inf para auto-repeat ***");
      } catch (e) {
        console.log("Error prune-delay:", e.message);
      }
    }
    
    let instructions = `📺 Plugin Activo\nTeclas: P(toggle), A(prev), S(repeat), D(next)`;
    if (autoRepeatEnabled) {
      instructions += `\n🔄 Auto-repeat ON (${repeatTimes} reps/sub)`;
    }
    instructions += `\n💡 Prueba 'S' manual primero. Si pausa: chequeo=50ms`;
    core.osd(instructions);
    
    if (sid > 0) startPolling();
  });
});

// Debug teclas
setTimeout(() => {
  try {
    const bindings = input.getAllKeyBindings();
    console.log("=== TECLAS REGISTRADAS ===");
    Object.keys(bindings).forEach(key => {
      if (key.toLowerCase().includes('a') || key.toLowerCase().includes('s') || key.toLowerCase().includes('d') || key.toLowerCase().includes('p')) {
        console.log(`Tecla "${key}": ${JSON.stringify(bindings[key])}`);
      }
    });
    console.log("========================");
  } catch (e) {
    console.log("Error bindings:", e.message);
  }
}, 1000);

// Inicializar
loadSettings(() => {
  console.log("=================================");
  console.log("Plugin v1.2.0 (Fix: S manual + Auto-repeat con sub-seek)");
  console.log("=================================");
  console.log("Controles: P/A/S/D | Auto-repeat si activado");
  if (autoRepeatEnabled) {
    console.log(`🔄 ${repeatTimes} reps/sub (pruning off)`);
  }
  console.log("=================================");
});

// Limpieza
event.on("iina.plugin-will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
  if (pollInterval) clearInterval(pollInterval);
  try {
    input.onKeyDown("p", null);
    input.onKeyDown("a", null);
    input.onKeyDown("s", null);
    input.onKeyDown("d", null);
  } catch (e) {
    console.log("Error limpieza:", e.message);
  }
  console.log("Plugin unload.");
});