import { clamp } from "./settings";

/**
 * Время анимации и воспроизведение. Живёт вне React: курсор таймлайна и
 * сцена подписываются на него сами, а панель настроек обновляется, когда
 * время меняется не само по себе — при остановке, перемотке и переходе к ключу.
 */
export class Clock {
  private value = 0;
  private running = false;
  private frame = 0;
  private stamp = 0;
  private readonly listeners = new Set<() => void>();
  duration = 3;
  loop = true;

  get time() { return this.value; }
  get playing() { return this.running; }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Снимок для useSyncExternalStore: время и состояние в одной строке. */
  snapshot = () => `${this.running ? 1 : 0}:${this.value}`;

  private emit() { this.listeners.forEach((listener) => listener()); }

  seek(time: number) {
    const next = clamp(time, 0, this.duration);
    if (next === this.value) return;
    this.value = next;
    this.emit();
  }

  play() {
    if (this.running) return;
    // С конца ролика воспроизведение начинается заново.
    if (this.value >= this.duration - 1e-3) this.value = 0;
    this.running = true;
    this.stamp = performance.now();
    this.frame = requestAnimationFrame(this.step);
    this.emit();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.emit();
  }

  toggle() { if (this.running) this.pause(); else this.play(); }

  private step = (now: number) => {
    if (!this.running) return;
    // Шаг ограничен: после фоновой вкладки воспроизведение не перепрыгивает весь ролик.
    const elapsed = Math.min((now - this.stamp) / 1000, 0.1);
    this.stamp = now;
    let next = this.value + elapsed;
    if (next >= this.duration) {
      if (this.loop) next %= this.duration;
      else { next = this.duration; this.running = false; }
    }
    this.value = next;
    this.emit();
    if (this.running) this.frame = requestAnimationFrame(this.step);
  };

  dispose() { cancelAnimationFrame(this.frame); this.listeners.clear(); }
}
