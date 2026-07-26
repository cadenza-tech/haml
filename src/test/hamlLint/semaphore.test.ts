import * as assert from 'node:assert';
import { Semaphore } from '../../hamlLint/semaphore';

suite('hamlLint/semaphore Test Suite', () => {
  test('should let acquisitions through up to the limit without waiting', async () => {
    const semaphore = new Semaphore(2);
    await semaphore.acquire();
    await semaphore.acquire();
    let third = false;
    void semaphore.acquire().then(() => {
      third = true;
    });
    await Promise.resolve();
    assert.strictEqual(third, false, 'the third acquisition must wait');
  });

  test('should hand the slot to the next waiter on release', async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    const order: string[] = [];
    const second = semaphore.acquire().then(() => order.push('second'));
    release();
    await second;
    assert.deepStrictEqual(order, ['second']);
  });

  test('should wake waiters in the order they arrived', async () => {
    const semaphore = new Semaphore(1);
    let release = await semaphore.acquire();
    const order: number[] = [];
    const waiters = [1, 2, 3].map((n) =>
      semaphore.acquire().then((next) => {
        order.push(n);
        return next;
      })
    );
    for (const waiter of waiters) {
      release();
      release = await waiter;
    }
    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  test('should ignore a second release rather than freeing someone else the slot', async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    release();
    release();
    // Two acquisitions must not both be live: the second one has to wait for the first to release.
    await semaphore.acquire();
    let extra = false;
    void semaphore.acquire().then(() => {
      extra = true;
    });
    await Promise.resolve();
    assert.strictEqual(extra, false, 'a double release must not have raised the effective limit');
  });

  // The release hands its slot to the woken waiter without decrementing. A decrement-then-wake gap
  // would let this synchronous acquire see a free slot and barge in, and the woken waiter's own
  // increment would then push admission over the limit.
  test('should not let a synchronous acquire barge past a woken waiter', async () => {
    const semaphore = new Semaphore(1);
    const releaseFirst = await semaphore.acquire();
    const waiter = semaphore.acquire();

    releaseFirst();
    let bargerHolds = false;
    const barger = semaphore.acquire().then((release) => {
      bargerHolds = true;
      return release;
    });

    const releaseWaiter = await waiter;
    assert.strictEqual(bargerHolds, false, 'the barger must queue behind the woken waiter');
    releaseWaiter();
    (await barger)();
  });
});
