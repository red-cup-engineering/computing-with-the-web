/** Pure collection-size operations shared by Web pagination and taxonomy. */
export function normaliseSize(size: number): number {
  if (!Number.isSafeInteger(size) || size <= 0) throw new RangeError("size must be a positive integer");
  return size;
}

export function pageCount(total: number, size: number): number {
  normaliseSize(size);
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError("total must be a non-negative integer");
  return total === 0 ? 1 : Math.ceil(total / size);
}

