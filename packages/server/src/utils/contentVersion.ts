import { ConflictException } from '@nestjs/common';

export function versionFilter(id: number, expectedVersion?: number) {
  if (expectedVersion === undefined) return { id };
  return {
    id,
    ...(expectedVersion === 0
      ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
      : { version: expectedVersion }),
  };
}

export function assertVersionMatched(result: { matchedCount?: number }, expectedVersion?: number) {
  if (expectedVersion !== undefined && result.matchedCount !== 1) {
    throw new ConflictException('VERSION_CONFLICT: 内容已修改，请重新读取后再操作。');
  }
}
