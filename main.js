const { console, core, event, mpv } = iina;

// Variable para el intervalo de chequeo
let checkInterval = null;
let currentSubEnd = 0; // Tiempo de fin del subtítulo actual (en segundos)

// Función para pausar antes del siguiente subtítulo
function setupPauseBeforeNextSub() {
  if (checkInterval) clearInterval(checkInterval); // Limpia intervalo anterior

  const playbackTime = mpv.getNumber("playback-time");
  const pauseMargin = 0.1; // Pausa 0.1s antes del fin (ajustable)

  checkInterval = setInterval(() => {
    const currentTime = mpv.getNumber("playback-time");
    const isPaused = mpv.getFlag("pause");

    // Solo chequea si está reproduciendo y hay subtítulos visibles
    if (!isPaused && mpv.getFlag("sub-visibility") && currentTime >= (currentSubEnd - pauseMargin)) {
      core.command("set pause yes");
      console.log(`Pausado antes del siguiente subtítulo a los ${currentTime.toFixed(2)}s`);
      core.osd("Pausa: Presiona play para siguiente subtítulo", "info");
      clearInterval(checkInterval); // Detiene el chequeo hasta el próximo subtítulo
    }
  }, 50); // Chequea cada 50ms (eficiente)
}

// Escucha cambios en el texto del subtítulo actual (nuevo subtítulo)
event.on("mpv.sub-text.changed", () => {
  const subText = mpv.getString("sub-text");
  if (subText && subText.trim() !== "") { // Nuevo subtítulo detectado
    currentSubEnd = mpv.getNumber("sub-end"); // Obtiene el tiempo de fin
    console.log(`Nuevo subtítulo hasta ${currentSubEnd.toFixed(2)}s`);
    setupPauseBeforeNextSub(); // Configura pausa para este subtítulo
  }
});

// Escucha cuando se carga un archivo (para reiniciar)
event.on("mpv.file-loaded", () => {
  currentSubEnd = 0;
  if (checkInterval) clearInterval(checkInterval);
  console.log("Plugin listo: Pausa antes de subtítulos activada");
  core.osd("Plugin de pausa antes de subtítulos cargado", "info");
});

// Limpia al cerrar el plugin
event.on("iina.will-unload", () => {
  if (checkInterval) clearInterval(checkInterval);
});