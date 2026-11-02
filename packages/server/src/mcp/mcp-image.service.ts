import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'dns';
import { BlockList, isIP } from 'net';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import axios from 'axios';
import sharp from 'sharp';
import { StaticProvider } from 'src/provider/static/static.provider';
import { MetaProvider } from 'src/provider/meta/meta.provider';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as Array<[string, number]>)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as Array<[string, number]>) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

// Resolve and validate in the socket lookup itself, avoiding DNS check/use races.
export function publicLookup(host: string, options: any, callback: any) {
  lookup(host, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
      return callback(new Error('禁止下载内网或保留地址图片。'));
    }
    const family = typeof options === 'number' ? options : options?.family;
    const candidates = family ? addresses.filter((item) => item.family === family) : addresses;
    if (!candidates.length) return callback(new Error('没有可用的公开地址。'));
    if (options?.all) return callback(null, candidates);
    callback(null, candidates[0].address, candidates[0].family);
  });
}

@Injectable()
export class McpImageService {
  constructor(
    private readonly storage: StaticProvider,
    private readonly meta: MetaProvider,
  ) {}

  async download(input: string): Promise<Buffer> {
    let url = new URL(input);
    const httpAgent = new HttpAgent({ lookup: publicLookup as any });
    const httpsAgent = new HttpsAgent({ lookup: publicLookup as any });
    try {
      for (let redirect = 0; redirect <= 5; redirect++) {
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('仅允许无凭证的 HTTP(S) 图片 URL。');
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        if (isIP(hostname) && !isPublicAddress(hostname)) throw new Error('禁止下载内网图片。');
        const response = await axios.get(url.href, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxRedirects: 0,
          maxContentLength: MAX_IMAGE_BYTES,
          maxBodyLength: MAX_IMAGE_BYTES,
          proxy: false,
          httpAgent,
          httpsAgent,
          headers: { Accept: 'image/*' },
          validateStatus: (status) => status === 200 || [301, 302, 303, 307, 308].includes(status),
        });
        if (response.status === 200) return Buffer.from(response.data);
        if (!response.headers.location) throw new Error('图片重定向缺少地址。');
        url = new URL(response.headers.location, url);
      }
      throw new Error('图片重定向次数过多。');
    } finally {
      httpAgent.destroy();
      httpsAgent.destroy();
    }
  }

  async upload(input: any) {
    try {
      let buffer: Buffer;
      if (input.source === 'url') buffer = await this.download(input.url);
      else {
        if (input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))
          throw new Error('图片 Base64 格式错误。');
        buffer = Buffer.from(input.data, 'base64');
      }
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES)
        throw new Error('图片大小必须在 1 字节到 10 MiB 之间。');
      const metadata = await sharp(buffer, { limitInputPixels: 40000000 }).metadata();
      const formats = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        avif: 'image/avif',
        heif: 'image/avif',
      };
      const mime = formats[metadata.format];
      if (!mime || (metadata.format === 'heif' && metadata.compression !== 'av1'))
        throw new Error('只支持 PNG/JPEG/GIF/WebP/AVIF 图片。');
      if (input.source === 'base64' && input.mimeType !== mime)
        throw new Error('声明的 MIME 类型与图片实际格式不符。');
      // Verify actual raster decoding before the storage pipeline handles the image.
      await sharp(buffer, { limitInputPixels: 40000000 }).stats();
      const extension = mime.split('/')[1].replace('jpeg', 'jpg');
      const uploaded = await this.storage.upload(
        { buffer, originalname: `mcp-image.${extension}`, mimetype: mime },
        'img',
        false,
        undefined,
        { withWaterMark: input.withWaterMark },
      );
      const site = await this.meta.getSiteInfo();
      const url = site?.baseUrl ? new URL(uploaded.src, site.baseUrl).href : uploaded.src;
      const alt = (input.alt || '图片说明').replace(/[\[\]\\\r\n]/g, ' ');
      return {
        url,
        width: metadata.width,
        height: metadata.height,
        markdown: `![${alt}](<${url}>)`,
      };
    } catch {
      // Do not leak upstream credentials or axios request objects into tool errors.
      throw new BadRequestException(
        'IMAGE_UPLOAD_FAILED: 请检查图片格式、大小或远程地址；内网地址不允许转存。',
      );
    }
  }
}
