import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { McpOperation } from './mcp-operation.schema';

@Injectable()
export class McpOperationService {
  constructor(@InjectModel(McpOperation.name) private readonly model: Model<McpOperation>) {}

  async run(identity: string, key: string, input: unknown, action: () => Promise<any>) {
    const operationKey = createHash('sha256').update(`${identity}:${key}`).digest('hex');
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    // Explicitly wait for the unique index before accepting concurrent first requests.
    await this.model.init();
    try {
      await this.model.create({ key: operationKey, fingerprint, status: 'pending' });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const previous = await this.model.findOne({ key: operationKey }).lean();
      if (previous?.fingerprint !== fingerprint)
        throw new ConflictException('IDEMPOTENCY_CONFLICT: 同一个幂等键不能用于不同参数。');
      if (previous.status === 'completed') return previous.result;
      throw new ConflictException(
        'OPERATION_INCOMPLETE: 该请求正在执行或先前未完成；请检查内容状态，不要更换幂等键盲目重试。',
      );
    }
    // Keep incomplete operations on failure, including after a crash. Never replay uncertain writes.
    const result = await action();
    await this.model.updateOne({ key: operationKey }, { $set: { status: 'completed', result } });
    return result;
  }
}
