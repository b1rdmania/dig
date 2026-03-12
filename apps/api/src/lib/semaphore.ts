/**
 * Async semaphore for in-process concurrency caps.
 *
 * Use tryAcquire() for load shedding (fail fast when at capacity).
 * The returned release function MUST be called in a finally block.
 */
export class Semaphore {
  private permits: number;

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Attempt to acquire a permit without waiting.
   * Returns a release function on success, null when at capacity.
   */
  tryAcquire(): (() => void) | null {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }
    return null;
  }

  private release(): void {
    this.permits++;
  }

  get available(): number {
    return this.permits;
  }
}
