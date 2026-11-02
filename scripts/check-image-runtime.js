const fs = require('fs');
const { spawnSync } = require('child_process');

async function check() {
  const sharp = require('/app/server/node_modules/sharp');
  await sharp({
    create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  console.log('sharp native runtime: OK');

  const configPath = '/tmp/vanblog-caddy-runtime-check.json';
  const config = fs.readFileSync('/app/caddyTemplate.json', 'utf8')
    .replace(/VAN_BLOG_EMAIL/g, 'runtime-check@example.com');
  fs.writeFileSync(configPath, config);
  try {
    const result = spawnSync('caddy', ['validate', '--config', configPath], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Caddy runtime configuration validation failed');
    console.log('Caddy runtime configuration: OK');
  } finally {
    fs.unlinkSync(configPath);
  }
}

check().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
