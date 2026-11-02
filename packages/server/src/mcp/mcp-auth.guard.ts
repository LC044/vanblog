import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenProvider } from 'src/provider/token/token.provider';
import { MetaProvider } from 'src/provider/meta/meta.provider';
import { createHash } from 'crypto';
import { applyNoStoreCacheHeaders } from 'src/utils/cacheControl';

@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly tokens: TokenProvider,
    private readonly meta: MetaProvider,
  ) {}

  async canActivate(context: ExecutionContext) {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    applyNoStoreCacheHeaders(res);
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '');
    if (!match) throw new UnauthorizedException('请通过 Authorization: Bearer 提供 API Token。');
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(match[1]);
      if (
        payload.sub !== 0 ||
        payload.role !== 'admin' ||
        !(await this.tokens.checkAPIToken(match[1]))
      ) {
        throw new Error('Invalid API token');
      }
    } catch {
      throw new UnauthorizedException('API Token 无效、已过期或已撤销。');
    }
    const site = await this.meta.getSiteInfo();
    if (req.headers.origin) {
      const allowed = new Set(
        (process.env.VANBLOG_MCP_ALLOWED_ORIGINS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      try {
        allowed.add(new URL(site?.baseUrl).origin);
      } catch {
        /* No configured public URL. */
      }
      if (!allowed.has(req.headers.origin)) throw new ForbiddenException('不允许的 MCP Origin。');
    }
    req.mcpIdentity = createHash('sha256').update(match[1]).digest('hex');
    req.user = { id: 0, nickname: site?.author, name: payload.username };
    return true;
  }
}
