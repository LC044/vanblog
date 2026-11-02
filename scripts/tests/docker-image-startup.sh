#!/usr/bin/env bash
# Start the real image with an isolated MongoDB before publishing multi-platform tags.
set -euo pipefail

image="${1:?Usage: docker-image-startup.sh IMAGE}"
network="vanblog-smoke-$$"
mongo="${network}-mongo"
app="${network}-app"

cleanup() {
  docker rm --force --volumes "$app" "$mongo" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run --detach --name "$mongo" --network "$network" mongo:6 >/dev/null
docker run --detach --name "$app" --network "$network" \
  --env "VAN_BLOG_DATABASE_URL=mongodb://${mongo}:27017/vanblog_smoke?authSource=admin" \
  --env EMAIL=runtime-check@example.com \
  "$image" >/dev/null

for attempt in $(seq 1 90); do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$app")" != true ]]; then
    break
  fi
  if docker exec "$app" node -e '
    (async () => {
      for (const port of [3000, 80]) {
        const response = await fetch(`http://127.0.0.1:${port}/api/public/meta`, {signal: AbortSignal.timeout(1500)});
        const data = await response.json();
        if (!response.ok || ![200, 233].includes(data.statusCode)) throw new Error(`API failed on port ${port}`);
      }
      for (const url of ["http://127.0.0.1:80/admin/", "http://127.0.0.1:3001/"]) {
        const response = await fetch(url, {signal: AbortSignal.timeout(1500)});
        if (!response.ok || !(await response.text()).toLowerCase().includes("<html")) throw new Error(`Page failed: ${url}`);
      }
    })().catch(() => process.exit(1));
  ' 2>/dev/null; then
    echo 'PASS: backend API, Caddy proxy, admin page and Next.js website started successfully'
    exit 0
  fi
  sleep 2
done

docker logs --tail 180 "$app" >&2 || true
echo 'FAIL: VanBlog image did not become ready' >&2
exit 1
