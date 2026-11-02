import { All, Controller, HttpException, Logger, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { McpAuthGuard } from './mcp-auth.guard';
import { McpToolsService } from './mcp-tools.service';
import { toolDescriptions, toolSchemas } from './mcp.schemas';

const imageShape = {
  source: z.enum(['url', 'base64']),
  url: z.string().url().optional(),
  filename: z.string().optional(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']).optional(),
  data: z.string().optional(),
  alt: z.string().optional(),
  withWaterMark: z.boolean().optional(),
};

@ApiExcludeController()
@Controller('/api/mcp')
@UseGuards(McpAuthGuard)
export class McpController {
  private readonly logger = new Logger(McpController.name);
  constructor(private readonly tools: McpToolsService) {}

  @All()
  async handle(@Req() req: Request & { mcpIdentity: string; user: any }, @Res() res: Response) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: '此无状态 MCP 端点仅支持 POST。' },
      });
      return;
    }
    const server = new McpServer({ name: 'vanblog', version: '1.0.0' });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    for (const name of Object.keys(toolSchemas)) {
      const readOnly = ['get_blog_info', 'search_posts', 'get_post'].includes(name);
      const shape = name === 'upload_image' ? imageShape : toolSchemas[name].shape;
      server.registerTool(
        name,
        {
          description: toolDescriptions[name],
          inputSchema: z.object(shape).strict(),
          annotations: {
            readOnlyHint: readOnly,
            destructiveHint: ['save_post', 'delete_post'].includes(name),
            idempotentHint: readOnly,
            openWorldHint: name === 'upload_image',
          },
        },
        async (input: any) => {
          const started = Date.now();
          try {
            const data = await this.tools.execute(name, input, req.mcpIdentity, req.user);
            this.logger.log({ tool: name, success: true, durationMs: Date.now() - started });
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(data) }],
              structuredContent: data,
            };
          } catch (error) {
            this.logger.warn({
              tool: name,
              success: false,
              durationMs: Date.now() - started,
              errorType: error?.name,
            });
            const detail: any =
              error instanceof ZodError
                ? {
                    code: 'VALIDATION_FAILED',
                    issues: error.issues.map((issue) => ({
                      path: issue.path,
                      message: issue.message,
                    })),
                  }
                : error instanceof HttpException
                  ? error.getResponse()
                  : { code: 'INTERNAL_ERROR', message: '操作失败，请检查服务端日志和内容状态。' };
            const message = typeof detail === 'string' ? detail : detail.message;
            const code =
              detail.code ||
              /^([A-Z_]+):/.exec(String(message || ''))?.[1] ||
              (error instanceof HttpException
                ? {
                    400: 'VALIDATION_FAILED',
                    403: 'FORBIDDEN',
                    404: 'NOT_FOUND',
                    409: 'VERSION_CONFLICT',
                  }[error.getStatus()] || 'OPERATION_FAILED'
                : 'INTERNAL_ERROR');
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    ...(typeof detail === 'object' ? detail : {}),
                    code,
                    ...(message ? { message } : {}),
                  }),
                },
              ],
            };
          }
        },
      );
    }
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'MCP 请求处理失败。' },
        });
    } finally {
      await server.close();
    }
  }
}
