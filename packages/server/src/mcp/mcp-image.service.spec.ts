import { isPublicAddress, McpImageService } from './mcp-image.service';
import sharp from 'sharp';
import axios from 'axios';

describe('MCP images', () => {
  it('blocks redirects to internal addresses before issuing a second request', async () => {
    const get = jest
      .spyOn(axios, 'get')
      .mockResolvedValue({ status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    try {
      const service = new McpImageService({} as any, {} as any);
      await expect(service.download('https://images.example.com/photo.png')).rejects.toThrow(
        '禁止下载内网图片',
      );
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      get.mockRestore();
    }
  });
  it('blocks local, metadata, mapped, multicast and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '172.16.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
      '2002:7f00:1::',
    ]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('checks redirects and actual raster data before invoking the existing storage', async () => {
    const storage = { upload: jest.fn().mockResolvedValue({ src: '/static/img/test.png' }) };
    const service = new McpImageService(
      storage as any,
      { getSiteInfo: async () => ({ baseUrl: 'https://blog.example.com' }) } as any,
    );
    await expect(
      service.upload({ source: 'url', url: 'http://127.0.0.1/private' }),
    ).rejects.toThrow('IMAGE_UPLOAD_FAILED');
    await expect(
      service.upload({
        source: 'base64',
        mimeType: 'image/png',
        data: Buffer.from('<svg/>').toString('base64'),
      }),
    ).rejects.toThrow('IMAGE_UPLOAD_FAILED');
    const buffer = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    await expect(
      service.upload({ source: 'base64', mimeType: 'image/jpeg', data: buffer.toString('base64') }),
    ).rejects.toThrow('IMAGE_UPLOAD_FAILED');
    expect(storage.upload).not.toHaveBeenCalled();
    const result = await service.upload({
      source: 'base64',
      mimeType: 'image/png',
      data: buffer.toString('base64'),
      withWaterMark: true,
    });
    expect(result).toMatchObject({
      url: 'https://blog.example.com/static/img/test.png',
      width: 4,
      height: 3,
    });
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ buffer }),
      'img',
      false,
      undefined,
      { withWaterMark: true },
    );
  });
});
