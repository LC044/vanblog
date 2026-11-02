import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlogServicesModule } from 'src/blog-services.module';
import { McpController } from './mcp.controller';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpToolsService } from './mcp-tools.service';
import { McpImageService } from './mcp-image.service';
import { McpOperationService } from './mcp-operation.service';
import { McpOperation, McpOperationSchema } from './mcp-operation.schema';

@Module({
  imports: [
    BlogServicesModule,
    MongooseModule.forFeature([{ name: McpOperation.name, schema: McpOperationSchema }]),
  ],
  controllers: [McpController],
  providers: [McpAuthGuard, McpToolsService, McpImageService, McpOperationService],
})
export class McpModule {}
