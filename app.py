"""
出册 · 中转服务
- 托管前端静态页面（static/）
- 代评委调用 Aholo Lux3D「图生 3D」：API Key 只存在服务器环境变量里，浏览器拿不到
- 限流：每个访客每天 N 次、全站每天总量上限、同时进行的任务数上限、图片大小上限

环境变量
  AHOLO_API_KEY     必填（模拟模式除外）。在 labs.aholo.cn/api-keys 申请
  AHOLO_API_BASE    默认 https://api.aholo.cn
  LUX3D_MODEL       默认 G1-Turbo（更快；要更高质量可改 G1）
  LIMIT_PER_IP      每个访客每天可生成次数，默认 3
  LIMIT_TOTAL       全站每天总次数，默认 80
  MAX_ACTIVE        同时进行的生成任务上限，默认 6
  LUX3D_MOCK        设为 1 时不调用 Aholo，几秒后返回示例模型（本地联调用）
  PUBLIC_BASE_URL   可选，本服务的公网地址；不填则按请求头推断（用于把用户照片的地址交给 Lux3D）
  PORT              默认 7860（魔搭创空间的约定端口）
"""
import asyncio, base64, os, time, uuid, datetime
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
STATIC = ROOT / "static"
CACHE = Path(os.environ.get("CACHE_DIR", "/tmp/chuce-cache")); CACHE.mkdir(parents=True, exist_ok=True)

API_KEY = os.environ.get("AHOLO_API_KEY", "").strip()
API_BASE = os.environ.get("AHOLO_API_BASE", "https://api.aholo.cn").rstrip("/")
MODEL = os.environ.get("LUX3D_MODEL", "G1-Turbo")
LIMIT_PER_IP = int(os.environ.get("LIMIT_PER_IP", 3))
LIMIT_TOTAL = int(os.environ.get("LIMIT_TOTAL", 80))
MAX_ACTIVE = int(os.environ.get("MAX_ACTIVE", 6))
MOCK = os.environ.get("LUX3D_MOCK") == "1"
MAX_IMAGE = 10 * 1024 * 1024
TASK_TIMEOUT = 15 * 60

app = FastAPI(title="出册 · 中转服务")

# ---------------------------------------------------------------- 限流（内存即可：比赛演示规模）
usage = {"day": "", "total": 0, "ip": {}}
tasks: dict[str, dict] = {}


def today():
    return datetime.date.today().isoformat()


def roll_day():
    if usage["day"] != today():
        usage.update(day=today(), total=0, ip={})


def client_ip(req: Request):
    fwd = req.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else (req.client.host if req.client else "?")) or "?"


def active_count():
    return sum(1 for t in tasks.values() if t["status"] in ("queued", "running"))


# ---------------------------------------------------------------- Lux3D 适配层
# 依据 Aholo OpenAPI：
#   POST /lux3d/v1/generate/img-to-3d/task/create   body: { img: <图片URL>, version: G1|G1-Turbo, outputFormat: [glb], enablePbr }
#   GET  /lux3d/v1/generate/task/get?taskid=<id>     返回 { c: "0", m, d: { taskId, status, outputs: [{ content: <url> }] } }
#   status：0 初始化 / 1 运行中 / 3 成功 / 4 失败 / 6 已取消；c="0" 只代表查询成功，任务状态看 d.status
#   结果 URL 有效期 2 小时 → 成功后立刻下载到本地缓存
HEADERS = lambda: {"Authorization": API_KEY}  # 无需 Bearer 前缀
PUBLIC_BASE = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")  # 可选：本服务的公网地址（不填则按请求头推断）
UPLOADS = CACHE / "uploads"; UPLOADS.mkdir(exist_ok=True)


class Lux3DError(Exception):
    def __init__(self, msg, busy=False):
        super().__init__(msg); self.busy = busy


class Lux3D:
    """把 Lux3D 的三个动作隔离在这里：提交任务、查询状态、解析结果"""

    @staticmethod
    async def create_task(img_url: str) -> str:
        body = {"img": img_url, "version": MODEL, "outputFormat": ["glb"], "enablePbr": True}
        if MOCK:
            j = {"f": None, "c": "0", "m": "", "d": {"taskId": int(time.time() * 1000) % 10_000_000}}
        else:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(f"{API_BASE}/lux3d/v1/generate/img-to-3d/task/create", json=body, headers=HEADERS())
            try:
                j = r.json()
            except Exception:
                raise Lux3DError(f"Lux3D 返回异常（HTTP {r.status_code}）")
        if str(j.get("c")) != "0":
            msg = str(j.get("m") or j)
            raise Lux3DError(msg, busy="CONCURRENCY" in msg.upper())
        task_id = (j.get("d") or {}).get("taskId")
        if task_id is None:
            raise Lux3DError(f"Lux3D 未返回 taskId：{str(j)[:200]}")
        return str(task_id)

    @staticmethod
    async def get_task_status(task_id: str, started: float) -> dict:
        if MOCK:
            el = time.time() - started
            st = 0 if el < 2 else 1 if el < 9 else 3
            return {"f": None, "c": "0", "m": "", "d": {"taskId": int(task_id), "status": st,
                    "outputs": [{"content": "mock://m6c.glb"}] if st == 3 else []}}
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{API_BASE}/lux3d/v1/generate/task/get", params={"taskid": task_id}, headers=HEADERS())
        return r.json()

    @staticmethod
    def parse(j: dict) -> dict:
        """→ {stage: queued|running|succeeded|failed, glb_url, error}"""
        if str(j.get("c")) != "0":
            return {"stage": "running", "glb_url": None, "error": None}  # 查询本身失败：下次再查
        d = j.get("d") or {}
        st = d.get("status")
        stage = {0: "queued", 1: "running", 3: "succeeded", 4: "failed", 6: "failed"}.get(st, "running")
        glb = None
        for o in d.get("outputs") or []:
            u = (o or {}).get("content") or ""
            if u and (glb is None or ".glb" in u.lower()):
                glb = u
        err = None if stage != "failed" else ("任务已取消" if st == 6 else (d.get("message") or j.get("m") or "生成失败"))
        return {"stage": stage, "glb_url": glb, "error": err}


def public_base(req: Request) -> str:
    if PUBLIC_BASE:
        return PUBLIC_BASE
    proto = req.headers.get("x-forwarded-proto") or req.url.scheme
    host = req.headers.get("x-forwarded-host") or req.headers.get("host")
    return f"{proto}://{host}"


async def fetch_glb(t: dict, tid: str):
    """成功后立刻把模型存到本地（结果 URL 2 小时后失效）"""
    f = CACHE / f"{tid}.glb"
    if f.exists():
        return f
    if t["glb_url"].startswith("mock://"):
        f.write_bytes((STATIC / "assets" / "m6c.glb").read_bytes()); return f
    async with httpx.AsyncClient(timeout=180, follow_redirects=True) as c:
        r = await c.get(t["glb_url"])
    if r.status_code >= 400:
        raise HTTPException(502, f"下载模型失败（{r.status_code}）")
    f.write_bytes(r.content)
    return f


# ---------------------------------------------------------------- 接口
@app.get("/api/health")
async def health(req: Request):
    roll_day()
    used = usage["ip"].get(client_ip(req), 0)
    ready = MOCK or bool(API_KEY)
    return {"ok": ready, "mode": "mock" if MOCK else "lux3d", "model": MODEL,
            "remaining": max(0, min(LIMIT_PER_IP - used, LIMIT_TOTAL - usage["total"])) if ready else 0}


@app.post("/api/gen")
async def create(req: Request, file: UploadFile = File(...)):
    roll_day()
    if not (MOCK or API_KEY):
        raise HTTPException(503, "服务器未配置 Lux3D API Key")
    ip = client_ip(req)
    if usage["ip"].get(ip, 0) >= LIMIT_PER_IP:
        raise HTTPException(429, f"今天的体验次数（{LIMIT_PER_IP} 次）已用完，明天再来，或先导入已生成的 GLB 模型。")
    if usage["total"] >= LIMIT_TOTAL:
        raise HTTPException(429, "今天的生成名额已经用完了，可以先体验书里的示例角色。")
    if active_count() >= MAX_ACTIVE:
        raise HTTPException(429, "同时生成的人有点多，请稍等一会儿再试。")
    ct = (file.content_type or "").lower()
    if ct not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(415, "请上传 JPG / PNG / WebP 照片。")
    img = await file.read()
    if len(img) > MAX_IMAGE:
        raise HTTPException(413, "照片太大了，请控制在 10 MB 以内。")
    # 照片先存在本服务上，生成一个公开地址交给 Lux3D（图生 3D 只接受图片 URL）
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[ct]
    name = f"{uuid.uuid4().hex}.{ext}"; (UPLOADS / name).write_bytes(img)
    img_url = f"{public_base(req)}/api/upload/{name}"
    up_id = None
    for attempt in range(3):  # 并发超限时稍等重试
        try:
            up_id = await Lux3D.create_task(img_url); break
        except Lux3DError as e:
            if e.busy and attempt < 2:
                await asyncio.sleep(4 * (attempt + 1)); continue
            raise HTTPException(429 if e.busy else 502, "现在生成的人太多，正在排队，请过一会儿再试。" if e.busy else f"Lux3D 提交失败：{e}")
    usage["ip"][ip] = usage["ip"].get(ip, 0) + 1; usage["total"] += 1
    tid = uuid.uuid4().hex
    tasks[tid] = {"up": up_id, "status": "queued", "started": time.time(), "glb_url": None, "error": None}
    return {"id": tid}


@app.get("/api/upload/{name}")
async def uploaded(name: str):
    f = UPLOADS / Path(name).name
    if not f.exists():
        raise HTTPException(404)
    return FileResponse(f)


@app.get("/api/gen/{tid}")
async def status(tid: str):
    t = tasks.get(tid)
    if not t:
        raise HTTPException(404, "没有这个任务")
    if t["status"] in ("queued", "running"):
        if time.time() - t["started"] > TASK_TIMEOUT:
            t.update(status="failed", error="生成超时")
        else:
            q = Lux3D.parse(await Lux3D.get_task_status(t["up"], t["started"]))
            t.update(status=q["stage"], glb_url=q["glb_url"] or t["glb_url"], error=q["error"])
            if t["status"] == "succeeded":
                if not t["glb_url"]:
                    t.update(status="failed", error="任务完成但没有找到模型地址")
                else:
                    await fetch_glb(t, tid)
    return {"status": t["status"], "elapsed": round(time.time() - t["started"]), "error": t["error"]}


@app.get("/api/gen/{tid}/model")
async def model(tid: str):
    t = tasks.get(tid)
    if not t or t["status"] != "succeeded":
        raise HTTPException(404, "模型还没好")
    return FileResponse(await fetch_glb(t, tid), media_type="model/gltf-binary", filename="lux3d.glb")


# ---------------------------------------------------------------- 静态页面
app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
