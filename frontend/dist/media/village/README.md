# 富贵村场景素材

来源为项目所有者提供的 Seedance 视频：`mp4/0048c891-4c74-43e9-86a1-5cb830b68826.mp4`。原文件保持不变；本目录的 MP4 与 WebP 为正式网页资源，无音轨。

- `village-v1.mp4`：1600 × 900、H.264 / yuv420p、约 0.72 MB，faststart。
- `village-v1.webp`：0.5 秒处封面、1600 × 900、约 0.25 MB。

安装 FFmpeg 后，在仓库根目录运行：

```powershell
ffmpeg -i mp4/0048c891-4c74-43e9-86a1-5cb830b68826.mp4 -an -vf scale=1600:900 -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart frontend/public/media/village/village-v1.mp4
ffmpeg -ss 0.5 -i mp4/0048c891-4c74-43e9-86a1-5cb830b68826.mp4 -frames:v 1 -vf scale=1600:900 -quality 86 frontend/public/media/village/village-v1.webp
```

修改素材时使用新版本文件名，并同步 `VillageScene.tsx` 与 `App.tsx`，避免 Nginx 一年 immutable 缓存复用旧资源。建筑坐标定义于 `VillageContext.tsx`，使用 1920 × 1080 的统一坐标系，SVG、标签和视频共用 cover 变换。

本地预览沿用项目启动方式，注册或登录后打开 `/overview`。空账本保持真实空态；无需模型密钥即可查看 Story、账房和场景。AI 解释使用账号现有 DeepSeek 连接，未配置时保留本地规则简报。
