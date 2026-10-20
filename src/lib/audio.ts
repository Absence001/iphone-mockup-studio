import { clamp } from "./settings";

export interface AudioClip {
  url: string; name: string; duration: number;
  /** Положение на таймлайне и границы исходного файла в секундах. */
  offset: number; start: number; end: number;
  volume: number; muted: boolean;
}

export const audioLength = (clip: AudioClip) => Math.max(0, clip.end - clip.start);

export function normalizeAudio(clip: AudioClip): AudioClip {
  const start = clamp(clip.start, 0, Math.max(0, clip.duration - 0.01));
  return { ...clip, start, end: clamp(clip.end, start + 0.01, clip.duration), offset: clamp(clip.offset, 0, 60), volume: clamp(clip.volume, 0, 100) };
}

/** Общие правила для предпросмотра и экспорта: без зацикливания исходника. */
export function audioWindow(clip: AudioClip, time: number, duration: number) {
  const elapsed = Math.max(0, time - clip.offset);
  const delay = Math.max(0, clip.offset - time);
  return { delay, offset: clip.start + elapsed, length: Math.max(0, Math.min(audioLength(clip) - elapsed, duration - time - delay)) };
}

export interface ExportAudio { stream: MediaStream; start: () => void; dispose: () => void }

/** Один источник музыки; часы сцены задают паузу, перемотку и повтор. */
export class TimelineAudio {
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private cache = new Map<string, Promise<AudioBuffer>>();
  private signature = "";
  private anchor = { context: 0, time: 0 };

  private engine() { return this.context ??= new AudioContext(); }
  async resume() { await this.engine().resume(); }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const context = this.engine();
    const promise = fetch(url).then((response) => {
      if (!response.ok) throw new Error("Не удалось прочитать аудиофайл.");
      return response.arrayBuffer();
    }).then((bytes) => context.decodeAudioData(bytes));
    this.cache.set(url, promise);
    try { return await promise; } catch (error) { this.cache.delete(url); throw error; }
  }

  stop() {
    this.source?.stop(); this.source?.disconnect(); this.gain?.disconnect();
    this.source = null; this.gain = null; this.signature = "";
  }

  sync(clip: AudioClip | null, buffer: AudioBuffer | null, time: number, playing: boolean, duration: number) {
    if (!clip || !buffer || !playing || clip.muted) { this.stop(); return; }
    const context = this.engine();
    const signature = `${clip.url}:${clip.offset}:${clip.start}:${clip.end}:${duration}`;
    const expected = this.anchor.time + context.currentTime - this.anchor.context;
    if (signature === this.signature && Math.abs(expected - time) < 0.2) {
      this.gain?.gain.setValueAtTime(clip.volume / 100, context.currentTime);
      return;
    }
    this.stop();
    this.signature = signature;
    this.anchor = { context: context.currentTime, time };
    const window = audioWindow(clip, time, duration);
    if (!window.length) return;
    const source = context.createBufferSource(); source.buffer = buffer;
    const gain = context.createGain(); gain.gain.value = clip.volume / 100;
    source.connect(gain).connect(context.destination);
    source.start(context.currentTime + window.delay, window.offset, window.length);
    this.source = source; this.gain = gain;
  }

  async forExport(clip: AudioClip, buffer: AudioBuffer, duration: number): Promise<ExportAudio> {
    const context = new AudioContext();
    try { await context.resume(); } catch (error) { void context.close(); throw error; }
    const destination = context.createMediaStreamDestination();
    const gain = context.createGain(); gain.gain.value = clip.muted ? 0 : clip.volume / 100;
    // Единый буфер включает тишину до и после клипа. Отложенный start()
    // оставляет начало MediaStream без аудиопакетов в части браузеров.
    const rendered = context.createBuffer(buffer.numberOfChannels, Math.ceil(duration * buffer.sampleRate), buffer.sampleRate);
    const window = audioWindow(clip, 0, duration);
    const from = Math.round(window.offset * buffer.sampleRate), at = Math.round(window.delay * buffer.sampleRate);
    const count = Math.min(Math.round(window.length * buffer.sampleRate), buffer.length - from, rendered.length - at);
    if (count > 0) for (let channel = 0; channel < buffer.numberOfChannels; channel++) rendered.copyToChannel(buffer.getChannelData(channel).subarray(from, from + count), channel, at);
    const source = context.createBufferSource(); source.buffer = rendered;
    source.connect(gain).connect(destination);
    let started = false;
    return {
      stream: destination.stream,
      start: () => {
        source.start(); started = true;
      },
      dispose: () => {
        if (started) source.stop(); source.disconnect(); gain.disconnect();
        destination.stream.getTracks().forEach((track) => track.stop());
        void context.close();
      },
    };
  }

  dispose() { this.stop(); this.cache.clear(); if (this.context) void this.context.close(); this.context = null; }
}
