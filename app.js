const keyMap = {
  a: { midi: 60, type: 'white' },
  s: { midi: 62, type: 'white' },
  d: { midi: 64, type: 'white' },
  f: { midi: 65, type: 'white' },
  g: { midi: 67, type: 'white' },
  h: { midi: 69, type: 'white' },
  j: { midi: 71, type: 'white' },
  k: { midi: 72, type: 'white' },
  l: { midi: 74, type: 'white' },
  q: { midi: 61, type: 'black' },
  w: { midi: 63, type: 'black' },
  e: { midi: 66, type: 'black' },
  r: { midi: 68, type: 'black' },
  t: { midi: 70, type: 'black' },
  y: { midi: 73, type: 'black' },
  u: { midi: 75, type: 'black' },
  i: { midi: 78, type: 'black' },
  o: { midi: 80, type: 'black' },
  p: { midi: 82, type: 'black' },
};

const instruments = {
  piano: { oscillator: 'triangle', attack: 0.005, release: 1.2, decay: 0.65 },
  guitar: { oscillator: 'sawtooth', attack: 0.005, release: 0.8, decay: 0.55 },
  synth: { oscillator: 'square', attack: 0.02, release: 1.5, decay: 0.75 },
  bass: { oscillator: 'sine', attack: 0.01, release: 0.7, decay: 0.6 },
  drums: { oscillator: 'triangle', attack: 0.001, release: 0.22, decay: 0.35 },
};

const instrumentToProgram = {
  piano: 0,
  guitar: 24,
  synth: 80,
  bass: 33,
  drums: 0,
};

const instrumentSelect = document.getElementById('instrument');
const recordButton = document.getElementById('record-toggle');
const exportMidiButton = document.getElementById('export-midi');
const exportWavButton = document.getElementById('export-wav');

let audioCtx;
let recording = false;
let recordStartTime = 0;
let recordedNotes = [];
const activeNotes = new Map();

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function playNote(midi, instrumentName) {
  ensureAudio();
  const now = audioCtx.currentTime;
  const profile = instruments[instrumentName] ?? instruments.piano;
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = profile.oscillator;
  oscillator.frequency.value = instrumentName === 'drums' ? 120 : midiToFrequency(midi);

  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.35, now + profile.attack);
  gainNode.gain.exponentialRampToValueAtTime(0.35 * profile.decay, now + profile.attack + 0.05);

  if (instrumentName === 'drums') {
    oscillator.frequency.exponentialRampToValueAtTime(45, now + 0.1);
  }

  oscillator.connect(gainNode).connect(audioCtx.destination);
  oscillator.start(now);

  activeNotes.set(midi, {
    oscillator,
    gainNode,
    startTime: performance.now(),
    instrument: instrumentName,
  });
}

function stopNote(midi) {
  if (!activeNotes.has(midi) || !audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;
  const note = activeNotes.get(midi);
  const profile = instruments[note.instrument] ?? instruments.piano;

  note.gainNode.gain.cancelScheduledValues(now);
  note.gainNode.gain.setValueAtTime(Math.max(note.gainNode.gain.value, 0.001), now);
  note.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + profile.release);
  note.oscillator.stop(now + profile.release + 0.01);

  if (recording) {
    const endOffsetMs = performance.now() - recordStartTime;
    const durationMs = Math.max(60, endOffsetMs - (note.startTime - recordStartTime));
    recordedNotes.push({
      midi,
      startMs: note.startTime - recordStartTime,
      durationMs,
      instrument: note.instrument,
      velocity: 90,
    });
    updateExportButtons();
  }

  activeNotes.delete(midi);
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  if (!keyMap[key] || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const { midi } = keyMap[key];
  if (activeNotes.has(midi)) {
    return;
  }

  playNote(midi, instrumentSelect.value);
}

function handleKeyUp(event) {
  const key = event.key.toLowerCase();
  if (!keyMap[key]) {
    return;
  }

  stopNote(keyMap[key].midi);
}

function updateExportButtons() {
  const hasNotes = recordedNotes.length > 0;
  exportMidiButton.disabled = !hasNotes;
  exportWavButton.disabled = !hasNotes;
}

function toggleRecording() {
  recording = !recording;
  if (recording) {
    recordedNotes = [];
    recordStartTime = performance.now();
    recordButton.textContent = 'Arrêter l’enregistrement';
    updateExportButtons();
    return;
  }

  for (const midi of activeNotes.keys()) {
    stopNote(midi);
  }

  recordButton.textContent = 'Démarrer l’enregistrement';
  updateExportButtons();
}

function writeVarLength(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return bytes;
}

function createMidiBlob(notes) {
  const ticksPerBeat = 480;
  const msPerBeat = 500;

  const events = [];
  const sortedNotes = [...notes].sort((a, b) => a.startMs - b.startMs);

  events.push({
    timeTicks: 0,
    bytes: [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20],
  });

  sortedNotes.forEach((note) => {
    const channel = note.instrument === 'drums' ? 9 : 0;
    const startTicks = Math.round((note.startMs / msPerBeat) * ticksPerBeat);
    const durationTicks = Math.max(60, Math.round((note.durationMs / msPerBeat) * ticksPerBeat));
    const offTicks = startTicks + durationTicks;

    if (channel !== 9) {
      events.push({
        timeTicks: Math.max(0, startTicks - 1),
        bytes: [0xc0 | channel, instrumentToProgram[note.instrument] ?? 0],
      });
    }

    events.push({
      timeTicks: startTicks,
      bytes: [0x90 | channel, note.midi, note.velocity ?? 90],
    });
    events.push({
      timeTicks: offTicks,
      bytes: [0x80 | channel, note.midi, 0],
    });
  });

  events.sort((a, b) => a.timeTicks - b.timeTicks);

  let previousTick = 0;
  const trackData = [];

  events.forEach((evt) => {
    const delta = Math.max(0, evt.timeTicks - previousTick);
    trackData.push(...writeVarLength(delta));
    trackData.push(...evt.bytes);
    previousTick = evt.timeTicks;
  });

  trackData.push(0x00, 0xff, 0x2f, 0x00);

  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (ticksPerBeat >> 8) & 0xff,
    ticksPerBeat & 0xff,
  ];

  const trackLength = trackData.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    (trackLength >> 24) & 0xff,
    (trackLength >> 16) & 0xff,
    (trackLength >> 8) & 0xff,
    trackLength & 0xff,
  ];

  return new Blob([new Uint8Array([...header, ...trackHeader, ...trackData])], {
    type: 'audio/midi',
  });
}

function renderWavBlob(notes) {
  const sampleRate = 44100;
  const maxEndMs = Math.max(...notes.map((n) => n.startMs + n.durationMs), 1000);
  const length = Math.ceil((maxEndMs / 1000) * sampleRate) + sampleRate;
  const channelData = new Float32Array(length);

  notes.forEach((note) => {
    const start = Math.floor((note.startMs / 1000) * sampleRate);
    const durationSamples = Math.max(1, Math.floor((note.durationMs / 1000) * sampleRate));
    const frequency = note.instrument === 'drums' ? 95 : midiToFrequency(note.midi);
    const profile = instruments[note.instrument] ?? instruments.piano;

    for (let i = 0; i < durationSamples && start + i < channelData.length; i += 1) {
      const t = i / sampleRate;
      const progress = i / durationSamples;
      const envelope = Math.exp(-progress * (profile.release * 4));
      let sample;
      if (profile.oscillator === 'square') {
        sample = Math.sign(Math.sin(2 * Math.PI * frequency * t));
      } else if (profile.oscillator === 'sawtooth') {
        sample = 2 * ((frequency * t) % 1) - 1;
      } else if (profile.oscillator === 'triangle') {
        sample = 2 * Math.abs(2 * ((frequency * t) % 1) - 1) - 1;
      } else {
        sample = Math.sin(2 * Math.PI * frequency * t);
      }
      channelData[start + i] += sample * envelope * 0.22;
    }
  });

  for (let i = 0; i < channelData.length; i += 1) {
    channelData[i] = Math.max(-1, Math.min(1, channelData[i]));
  }

  const wavBytes = new ArrayBuffer(44 + channelData.length * 2);
  const view = new DataView(wavBytes);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + channelData.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, channelData.length * 2, true);

  let offset = 44;
  for (let i = 0; i < channelData.length; i += 1) {
    const sample = channelData[i] < 0 ? channelData[i] * 0x8000 : channelData[i] * 0x7fff;
    view.setInt16(offset, sample, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

recordButton.addEventListener('click', toggleRecording);
exportMidiButton.addEventListener('click', () => {
  downloadBlob(createMidiBlob(recordedNotes), 'session.mid');
});
exportWavButton.addEventListener('click', () => {
  downloadBlob(renderWavBlob(recordedNotes), 'session.wav');
});
document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);
