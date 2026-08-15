#!/bin/sh
set -eu

expected_sha=${1:-}
if ! printf '%s\n' "$expected_sha" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Usage: scripts/deploy-live.sh <full-40-character-origin-main-sha>" >&2
  exit 2
fi

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

if [ "$(git branch --show-current)" != "main" ]; then
  echo "Refusing deployment: the canonical checkout must be on main." >&2
  exit 1
fi
if [ -n "$(git status --porcelain=v1)" ]; then
  echo "Refusing deployment: the canonical checkout is dirty." >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "Refusing deployment: the ignored live environment file is missing." >&2
  exit 1
fi

git fetch --quiet origin main
origin_sha=$(git rev-parse origin/main)
if [ "$expected_sha" != "$origin_sha" ]; then
  echo "Refusing deployment: requested SHA is not the current origin/main." >&2
  exit 1
fi
git merge --ff-only "$expected_sha"
if [ "$(git rev-parse HEAD)" != "$expected_sha" ] || [ -n "$(git status --porcelain=v1)" ]; then
  echo "Refusing deployment: checkout does not exactly match the requested SHA." >&2
  exit 1
fi

docker compose config --quiet
resolve_container() {
  docker compose ps -q family-box
}
container=$(resolve_container)
if [ -z "$container" ] || ! docker inspect "$container" >/dev/null 2>&1; then
  echo "Refusing deployment: the canonical live container was not found." >&2
  exit 1
fi

snapshot() {
  docker exec "$container" node -e '
    const Database=require("better-sqlite3");
    const db=new Database("/app/data/family-box.db",{readonly:true,fileMustExist:true});
    const scalar=(sql)=>db.prepare(sql).pluck().get();
    const settings=db.prepare("SELECT * FROM settings ORDER BY device_id").all();
    const result={
      integrity:scalar("PRAGMA integrity_check"),
      foreignKeys:db.prepare("PRAGMA foreign_key_check").all().length,
      devices:scalar("SELECT COUNT(*) FROM devices"),
      slots:scalar("SELECT COUNT(*) FROM button_slots"),
      assignedSlots:scalar("SELECT COUNT(*) FROM button_slots WHERE recipient_id IS NOT NULL"),
      recipients:scalar("SELECT COUNT(*) FROM recipients"),
      messages:scalar("SELECT COUNT(*) FROM messages"),
      settings
    };
    process.stdout.write(JSON.stringify(result));
  '
}

pre_file=$(mktemp "${TMPDIR:-/tmp}/message-box-pre.XXXXXX")
post_file=$(mktemp "${TMPDIR:-/tmp}/message-box-post.XXXXXX")
trap 'rm -f "$pre_file" "$post_file"' EXIT HUP INT TERM
snapshot >"$pre_file"
docker exec -i "$container" node -e '
  let body=""; process.stdin.on("data",chunk=>body+=chunk); process.stdin.on("end",()=>{
    const state=JSON.parse(body);
    if(state.integrity!=="ok"||state.foreignKeys!==0) process.exit(1);
  });
' <"$pre_file"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="/app/data/backups/pre-git-deploy-${stamp}.db"
docker exec -e BACKUP_PATH="$backup_path" "$container" node -e '
  const fs=require("fs"); const path=require("path"); const Database=require("better-sqlite3");
  fs.mkdirSync(path.dirname(process.env.BACKUP_PATH),{recursive:true});
  const db=new Database("/app/data/family-box.db",{fileMustExist:true});
  db.backup(process.env.BACKUP_PATH)
    .then(()=>process.stdout.write(process.env.BACKUP_PATH))
    .catch(error=>{console.error(error);process.exit(1)});
'
backup_sha=$(docker exec "$container" sha256sum "$backup_path" | cut -d ' ' -f 1)
echo "Live backup: ${backup_path} sha256=${backup_sha}"

previous_image=$(docker inspect --format '{{.Image}}' "$container")
rollback_tag="message-box-family-box:rollback-${stamp}"
docker image tag "$previous_image" "$rollback_tag"
echo "Rollback image: ${rollback_tag}"

GIT_REVISION="$expected_sha" docker compose build family-box
built_image="message-box-family-box:${expected_sha}"
built_revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$built_image")
if [ "$built_revision" != "$expected_sha" ]; then
  echo "Refusing deployment: built image revision label does not match Git." >&2
  exit 1
fi
GIT_REVISION="$expected_sha" docker compose up -d --no-build family-box
container=$(resolve_container)
if [ -z "$container" ] || ! docker inspect "$container" >/dev/null 2>&1; then
  echo "Deployment failed: the rebuilt container was not found." >&2
  exit 1
fi

attempt=0
until [ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")" = "healthy" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Deployment failed health verification. Rollback image: $rollback_tag" >&2
    exit 1
  fi
  sleep 3
done

health_url=${FAMILY_BOX_HEALTH_URL:-http://127.0.0.1:8787/api/health}
curl -fsS "$health_url" >/dev/null
snapshot >"$post_file"
{
  cat "$pre_file"
  printf '\n'
  cat "$post_file"
} | docker exec -i "$container" node -e '
  let body=""; process.stdin.on("data",chunk=>body+=chunk); process.stdin.on("end",()=>{
    const [beforeLine,afterLine]=body.trim().split("\n");
    const before=JSON.parse(beforeLine); const after=JSON.parse(afterLine);
    for(const key of ["devices","slots","assignedSlots","recipients"])
      if(after[key]!==before[key]) throw new Error(`${key} changed: ${before[key]} -> ${after[key]}`);
    if(after.messages<before.messages) throw new Error("message count decreased");
    if(JSON.stringify(after.settings)!==JSON.stringify(before.settings)) throw new Error("settings changed");
    if(after.integrity!=="ok"||after.foreignKeys!==0) throw new Error("database integrity failed");
  });
'

attempt=0
until docker exec "$container" curl -fsS http://127.0.0.1:8787/api/admin/dashboard \
  | docker exec -i "$container" node -e '
      let body=""; process.stdin.on("data",c=>body+=c); process.stdin.on("end",()=>{
        const d=JSON.parse(body); process.exit(d.device?.online && d.config?.buttons?.length===8 ? 0 : 1);
      });
    '; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 24 ]; then
    echo "Server deployed, but ESP32 did not verify online with eight buttons." >&2
    exit 1
  fi
  sleep 5
done

running_revision=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container")
test "$running_revision" = "$expected_sha"
echo "Deployment verified: ${expected_sha}"
