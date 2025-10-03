// main.js (versión auto-repeat 3x con logs de DevTools)
// Reemplaza tu main.js por este para que solo haga: repetir 3 veces -> siguiente subtítulo -> repetir 3 veces -> ...
const { console, core, event, mpv } = iina;

const LOG_PREFIX = "[pausa-subs-auto]";
function log(...args) { try { console.log(LOG_PREFIX, ...args); } catch (e) {} }

let lastSubStart = null;
let lastSubText = "";
let repeatCount = 0;
const maxRepeats = 3;
let cycleTimer = null;
let cycleActive = false;

// Tolerancia para comparar tiempos de inicio de subtítulo (evita bucles debido a redondos)
const START_TOLERANCE = 0.05; // segundos

function clearCycle() {
  if (cycleTimer) {
    clearTimeout(cycleTimer);
    cycleTimer = null;
    log("clearCycle: Timer limpiado.");
  }
  cycleActive = false;
  repeatCount = 0;
}

function startCycleFor(subStart, subEnd) {
  clearCycle();
  repeatCount = 0;
  cycleActive = true;

  // Duración estimada del subtítulo (fallback si está mal)
  let duration = (isFinite(subEnd) && isFinite(subStart) && subEnd > subStart) ? (subEnd - subStart) : 1.0;
  if (!isFinite(duration) || duration <= 0) duration = 1.0;

  // Calculamos cuánto falta hasta el fin actual del subtítulo
  const now = mpv.getNumber("playback-time");
  let delayMs = Math.max(0, (subEnd - now + 0.02)) * 1000; // +20ms de margen
  log("startCycleFor:", { subStart, subEnd, now, duration, delayMs });

  core.osd(`🔁 Auto-repeat: iniciando (${maxRepeats}x)`);
  // Primer paso: cuando llegue el fin, repetir
  cycleTimer = setTimeout(() => cycleStep(duration), delayMs);
}

function cycleStep(duration) {
  if (!cycleActive) {
    log("cycleStep: cycle no activo, saliendo.");
    return;
  }

  try {
    if (repeatCount < maxRepeats) {
      repeatCount++;
      log(`cycleStep: Repetición ${repeatCount}/${maxRepeats} -> sub-seek 0 (reiniciar subtítulo)`);
      // Reiniciamos al inicio del subtítulo
      mpv.command("sub-seek", ["0"]);
      core.osd(`🔁 Repetición ${repeatCount}/${maxRepeats}`);
      // Asegurarnos de que el vídeo siga reproduciéndose
      try { core.resume(); } catch (e) { /* no crítico */ }

      // Volvemos a programar la siguiente repetición tras la duración del subtítulo
      const nextDelay = Math.max(50, duration * 1000 + 40); // +40ms margen
      log(`cycleStep: programando próxima repetición en ${nextDelay} ms`);
      cycleTimer = setTimeout(() => cycleStep(duration), nextDelay);
    } else {
      log(`cycleStep: Repeticiones completadas (${maxRepeats}). Avanzando al siguiente subtítulo (sub-seek 1).`);
      mpv.command("sub-seek", ["1"]);
      core.osd("⏭️ Siguiente subtítulo");
      try { core.resume(); } catch (e) {}
      // Dejamos que el evento mpv.sub-start.changed arranque el siguiente ciclo
      cycleActive = false;
      repeatCount = 0;
      cycleTimer = null;
    }
  } catch (err) {
    log("cycleStep ERROR:", err && err.message ? err.message : err);
    clearCycle();
  }
}

// Handler: nuevo subtítulo
event.on("mpv.sub-start.changed", () => {
  try {
    const sid = mpv.getNumber("sid");
    const subStart = mpv.getNumber("sub-start");
    const subEnd = mpv.getNumber("sub-end");
    const subTextRaw = mpv.getString("sub-text");
    const subText = subTextRaw ? String(subTextRaw).trim() : "";

    log("EVENT mpv.sub-start.changed", { sid, subStart, subEnd, textPreview: subText ? subText.slice(0,60) : "(vacío)" });

    if (!(sid > 0)) {
      log("No hay stream de subtítulos activo. Ignorando evento.");
      return;
    }
    if (!subText) {
      log("Sub-text vacío. Ignorando evento.");
      return;
    }

    // Si el start es prácticamente el mismo que el último tratado y el texto igual,
    // estamos viendo el mismo subtítulo (probablemente por nuestro sub-seek 0) => ignorar.
    if (lastSubStart !== null &&
        Math.abs(subStart - lastSubStart) <= START_TOLERANCE &&
        subText === lastSubText) {
      log("Mismo subtítulo que el último tratado (probable repeat interno). Ignorando para evitar bucle.");
      return;
    }

    // Nuevo subtítulo: guardamos y arrancamos ciclo
    lastSubStart = subStart;
    lastSubText = subText;
    log("Nuevo subtítulo detectado -> iniciando ciclo de repeticiones.");
    startCycleFor(subStart, subEnd);

  } catch (e) {
    log("Error en mpv.sub-start.changed:", e && e.message ? e.message : e);
  }
});

// Al cargar archivo, limpiar estado
event.on("mpv.file-loaded", () => {
  log("mpv.file-loaded -> reseteando estado interno.");
  clearCycle();
  lastSubStart = null;
  lastSubText = "";
});

// Limpieza al descargar plugin
event.on("iina.plugin-will-unload", () => {
  log("iina.plugin-will-unload -> limpiando timers y estado.");
  clearCycle();
});
