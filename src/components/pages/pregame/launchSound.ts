let audio: AudioContext | null = null;

export function unlockLaunchSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // The visual countdown still works on devices without Web Audio.
  }
}

export function playLaunchSound(step: number) {
  if (!audio || audio.state !== "running") return;
  const now = audio.currentTime;
  const notes = step === 0 ? [523, 659, 784] : [step === 1 ? 554 : 440];
  notes.forEach((frequency, index) => {
    const oscillator = audio!.createOscillator();
    const gain = audio!.createGain();
    const start = now + index * (step === 0 ? 0.075 : 0);
    oscillator.type = step === 0 ? "sine" : "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.075, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(gain);
    gain.connect(audio!.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.17);
  });
}
