// This file was copied from the monorepo.
import { type EventEmitter } from 'events';

export async function* mergeAsyncIterables<T>(
  ...iterables: AsyncIterable<T>[]
): AsyncGenerator<T> {
  const iterators = iterables.map((it) => it[Symbol.asyncIterator]());

  const promises: (Promise<{
    result: IteratorResult<T>;
    index: number;
  }> | null)[] = iterators.map((it, idx) =>
    it.next().then((result) => ({ result, index: idx })),
  );

  while (promises.some((p) => p !== null)) {
    const { result, index } = await Promise.race(
      promises.filter((p) => p !== null),
    );

    if (result.done) {
      promises[index] = null;
    } else {
      yield result.value;
      promises[index] = iterators[index]!.next().then((result) => ({
        result,
        index,
      }));
    }
  }
}

export function eventToAsyncIterable<
  EventMap extends Record<string, any[]>,
  EventName extends keyof EventMap,
  Result = EventMap[EventName][0],
>(
  emitter: EventEmitter<EventMap>,
  eventName: EventName,
): AsyncIterable<Result> {
  const queue: Result[] = [];
  let pendingResolver:
    | ((
        value:
          | { value: Result; done: false }
          | { value: undefined; done: true },
      ) => void)
    | null = null;

  const listener = (value: Result) => {
    if (pendingResolver) {
      pendingResolver({ value, done: false });
      pendingResolver = null;
    } else {
      queue.push(value);
    }
  };

  // TODO: I can't figure out how to get this to type check
  emitter.on(eventName as any, listener as any);

  return {
    [Symbol.asyncIterator]: () => ({
      next() {
        return new Promise((resolve) => {
          if (queue.length > 0) {
            const value = queue.shift()!;
            resolve({ value, done: false });
          } else {
            pendingResolver = resolve;
          }
        });
      },
      return() {
        emitter.removeListener(eventName as any, listener as any);
        if (pendingResolver) {
          pendingResolver({
            done: true,
            value: undefined,
          });
        }
        return Promise.resolve({ done: true, value: undefined });
      },
      throw(error) {
        emitter.removeListener(eventName as any, listener as any);
        if (pendingResolver) {
          pendingResolver({
            done: true,
            value: undefined,
          });
        }
        return Promise.reject(error);
      },
    }),
  };
}

export async function* mapAsyncIterable<T, U>(
  iterable: AsyncIterable<T>,
  fn: (value: T) => U,
): AsyncGenerator<U> {
  for await (const value of iterable) {
    yield fn(value);
  }
}
