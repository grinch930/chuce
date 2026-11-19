# 出册 · 部署说明

这个文件夹 = 前端页面（static/）+ 中转服务（app.py）。中转服务替评委调用 Aholo Lux3D「图生 3D」，
API Key 只放在服务器的环境变量里，浏览器拿不到。

## 部署到魔搭创空间（推荐）
1. 新建创空间，类型选 **Docker**（端口 7860），把本文件夹里的全部文件上传到仓库根目录
   （包含 Dockerfile、app.py、requirements.txt、static/）
2. 在创空间「设置 → 环境变量」里添加（设为私密/Secret）：
   - `AHOLO_API_KEY` = 你在 labs.aholo.cn/api-keys 申请的 Key
   - 可选：`LIMIT_PER_IP`（每人每天次数，默认 3）、`LIMIT_TOTAL`（全站每天总数，默认 80）、`LUX3D_MODEL`（默认 G1-Turbo）
3. 空间设为**公开**。Lux3D 需要能访问到用户照片的地址（本服务的 /api/upload/...），如果访问不到，
   把 `PUBLIC_BASE_URL` 设为空间的公网地址（例如 https://xxx.modelscope.cn）
4. 打开空间链接，右上角没有报错、书案正常显示即部署成功

## 本地先试一试（不消耗额度）
    pip install -r requirements.txt
    LUX3D_MOCK=1 python app.py        # 模拟模式：几秒后返回示例模型
    # 浏览器打开 http://localhost:7860

## 真实调用
    AHOLO_API_KEY=你的Key python app.py

## 安全
- 不要把 Key 写进任何代码或提交到仓库
- 比赛结束后在 Aholo 后台删除并重建 Key
- 限流：每个访客每天 LIMIT_PER_IP 次、全站每天 LIMIT_TOTAL 次、同时最多 MAX_ACTIVE 个任务；用完后页面会提示，仍可体验书里的示例角色

## 只要静态页面（不需要照片生成）
static/ 文件夹本身就是完整的网站，可以放到任何静态托管上；没有中转服务时，照片入口会提示改用 GLB 导入。
