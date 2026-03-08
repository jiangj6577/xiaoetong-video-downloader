# xiaoetong-video-downloader

English | [中文](#中文说明)

A desktop tool to batch download and merge Xiaoetong HLS videos you are authorized to access. It fetches the m3u8, downloads/decrypts segments, and merges to MP4 via ffmpeg.

## Features
- **Batch download** — add multiple videos in a table, download them one by one
- **Custom naming** — name each video; the folder and MP4 file use the same name
- **Table-based UI** — clean table input with per-row status tracking
- AES-128 / XOR key handling
- Auto merge with ffmpeg
- Auto cleanup of temp folders
- Error tolerance — a failed video won't stop the rest of the batch
- Cancel support — stop the current and all queued downloads

## Requirements
- Node.js 18+ and npm
- ffmpeg available in PATH

## Install
Option A (simple, uses npx to fetch Electron on first run):
```bash
npm start
```

Option B (faster startup, install Electron once):
```bash
npm i -D electron
npm start
```

## Usage
1. Open the video page in your browser.
2. Get `userId` in DevTools Console (type `pushData` and read `payload.userId`).
3. In DevTools > Network, copy the full `m3u8` request URL.
4. Copy the page URL as `referer`.
5. (Optional) If the m3u8 segment lines do not include query parameters, copy any `.ts` request URL as `tsUrlDemo`.
6. In the Download List table, fill in:
   - **Name** — course name (used as folder name and MP4 filename)
   - **m3u8 URL** — the full URL
   - Click **+ Add Row** to add more videos
7. Click **Start**. Each video is saved as `<name>/<name>.mp4` in the output folder.

## Input notes
- `tsUrlDemo` is only required when the m3u8 lists bare `xxx.ts` paths without query params.
- If a name is left blank, it is derived from the m3u8 filename.
- After a successful merge, temp folders are cleaned automatically.

## Legal
Use this tool only for content you own or are authorized to access.

## Acknowledgements
Thanks to https://github.com/li1055107552/xiaoe-tech-decodeDemo for the original project that inspired this optimized version.

## 中文说明

这是一个桌面工具，用于批量下载并合并你已授权访问的小鹅通 HLS 视频。它会抓取 m3u8，下载/解密分片，并通过 ffmpeg 合并成 MP4。

## 功能
- **批量下载** — 在表格中添加多个视频，逐个下载
- **自定义命名** — 为每个视频命名，文件夹和 MP4 文件使用相同名称
- **表格式输入** — 清晰的表格界面，每行实时显示下载状态
- AES-128 / XOR 密钥处理
- 自动用 ffmpeg 合并
- 自动清理临时目录
- 容错机制 — 某个视频失败不影响后续下载
- 取消支持 — 一键取消当前及所有排队任务

## 环境要求
- Node.js 18+ 和 npm
- ffmpeg 已加入 PATH

## 安装
方案 A（最简单，首次会用 npx 拉取 Electron）：
```bash
npm start
```

方案 B（启动更快，先安装 Electron）：
```bash
npm i -D electron
npm start
```

## 使用步骤
1. 打开视频播放页。
2. 在 DevTools Console 输入 `pushData`，从 `payload.userId` 获取用户 id。
3. 在 DevTools > Network 中找到 `.m3u8` 请求，复制完整 URL。
4. 将页面地址作为 `referer`。
5. （可选）如果 m3u8 的 ts 行没有参数，复制任意 `.ts` 请求 URL 作为 `tsUrlDemo`。
6. 在 Download List 表格中填写：
   - **Name** — 课程名（作为文件夹名和 MP4 文件名）
   - **m3u8 URL** — 完整地址
   - 点击 **+ Add Row** 添加更多视频
7. 点击 **Start**，每个视频保存为 `<课程名>/<课程名>.mp4`。

## 输入说明
- `tsUrlDemo` 仅在 m3u8 的 ts 行缺少 query 参数时需要。
- 如果不填课程名，会自动从 m3u8 文件名生成。
- 合并成功后会自动清理临时目录。

## 合规提示
仅用于已授权访问的内容。

## 致谢
感谢 https://github.com/li1055107552/xiaoe-tech-decodeDemo 本项目基于该仓库的思路进行优化。
