import { Schema as MongoSchema } from 'mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DraftDocument = Draft & Document;

@Schema()
export class Draft extends Document {
  @Prop()
  sourceArticleId?: number;
  @Prop()
  sourceArticleVersion?: number;
  @Prop()
  publishedArticleId?: number;
  @Prop({ default: false })
  publishing?: boolean;
  @Prop({ type: MongoSchema.Types.Mixed })
  articleOptions?: Record<string, any>;

  @Prop({ default: 0 })
  version: number;

  @Prop({ index: true, unique: true })
  id: number;

  @Prop({ index: true })
  title: string;

  @Prop({ default: '' })
  content: string;

  @Prop({ default: [], index: true })
  tags: string[];

  @Prop({ index: true })
  author: string;

  @Prop({ index: true })
  category: string;

  @Prop({ default: false, index: true })
  deleted: boolean;

  @Prop({
    index: true,
    default: () => {
      return new Date();
    },
  })
  createdAt: Date;

  @Prop({
    index: true,
    default: () => {
      return new Date();
    },
  })
  updatedAt: Date;
}

export const DraftSchema = SchemaFactory.createForClass(Draft);
