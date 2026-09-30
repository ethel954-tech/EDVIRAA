/**
 * Web Speech API helpers (Task 17): microphone dictation + read-aloud.
 *
 * Both are progressive enhancements — every helper feature-detects and the
 * UI degrades gracefully (buttons simply don't appear) on unsupported
 * browsers. Dictation runs on the browser's built-in SpeechRecognition
 * (Chrome/Edge); read-aloud on the built-in speechSynthesis voices.
 */

/* ------------------------------------------------------------------ */
/* Minimal local types — SpeechRecognition isn't in TS's DOM lib yet.  */
/* ------------------------------------------------------------------ */

type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  isFinal: boolean;
  length: number;
  0: SpeechRecognitionAlternative;
};
type SpeechRecognitionResultList = { length: number; [i: number]: SpeechRecognitionResult };

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when the browser supports in-browser dictation. */
export function dictationSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/**
 * Starts a dictation session.
 *
 * @param onText receives the running transcript (final + interim) on every
 *               update — feed it straight into the input state.
 * @param onEnd  called when the session stops for any reason (user stop,
 *               error, or the browser cutting the stream).
 * @returns a stop() handle, or null when unsupported.
 */
export function startDictation({
  onText,
  onEnd,
  onError,
}: {
  onText: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
}): (() => void) | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let stopped = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    onText((finalText + interim).trimStart());
  };

  recognition.onerror = (ev) => {
    if (stopped) return;
    stopped = true;
    const code = ev.error ?? "unknown";
    const friendly =
      code === "not-allowed" || code === "service-not-allowed"
        ? "Microphone access was blocked — allow it in your browser settings."
        : code === "no-speech"
          ? "Didn't catch anything — try again."
          : "Voice input failed. Please type instead.";
    onError(friendly);
    onEnd();
  };

  recognition.onend = () => {
    if (!stopped) {
      stopped = true;
      onEnd();
    }
  };

  try {
    recognition.start();
  } catch {
    onError("Voice input could not start. Please type instead.");
    return null;
  }

  return () => {
    if (stopped) return;
    stopped = true;
    try {
      recognition.stop();
    } catch {
      // already stopped
    }
    onEnd();
  };
}

/* -------------------------------------------------------------------- */
/* Read-aloud (speechSynthesis)                                          */
/* -------------------------------------------------------------------- */

/** True when the browser supports speech synthesis. */
export function readAloudSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let speakingKey: string | null = null;

/**
 * Speaks the given text. Returns true when playback started.
 * Cancel any current playback first — one voice at a time.
 */
export function speak(text: string, onDone?: () => void): boolean {
  if (!readAloudSupported() || !text.trim()) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.onend = () => {
    speakingKey = null;
    onDone?.();
  };
  speakingKey = text.slice(0, 32);
  synth.speak(utterance);
  return true;
}

/** Stops any current read-aloud playback. */
export function stopSpeaking(): void {
  if (!readAloudSupported()) return;
  speakingKey = null;
  window.speechSynthesis.cancel();
}

/** Whether something is currently being spoken. */
export function isSpeaking(): boolean {
  if (!readAloudSupported()) return false;
  return speakingKey !== null || window.speechSynthesis.speaking;
}
