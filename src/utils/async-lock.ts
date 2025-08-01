/**
 * Simple async lock implementation for protecting critical sections
 */

interface QueueItem {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class AsyncLock {
  private locked = false;
  private queue: QueueItem[] = [];

  /**
   * Acquire the lock
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push({ resolve, reject });
      }
    });
  }

  /**
   * Release the lock
   */
  release(): void {
    if (!this.locked) {
      throw new Error('Cannot release a lock that is not acquired');
    }

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next.resolve();
    } else {
      this.locked = false;
    }
  }

  /**
   * Execute a function with the lock acquired
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if the lock is currently held
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get the number of pending operations waiting for the lock
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clear all pending operations (useful for cleanup)
   */
  clear(): void {
    const error = new Error('AsyncLock cleared');
    this.queue.forEach(item => item.reject(error));
    this.queue = [];
    this.locked = false;
  }
}