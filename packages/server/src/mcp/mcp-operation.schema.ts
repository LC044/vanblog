import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema } from 'mongoose';

@Schema({ collection: 'mcp_operations' })
export class McpOperation {
  @Prop({ required: true, unique: true })
  key: string;
  @Prop({ required: true })
  fingerprint: string;
  @Prop({ default: 'pending' })
  status: string;
  @Prop({ type: MongoSchema.Types.Mixed })
  result: Record<string, unknown>;
}
export const McpOperationSchema = SchemaFactory.createForClass(McpOperation);
