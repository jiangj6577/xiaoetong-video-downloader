const { app, BrowserWindow, dialog, ipcMain, session, screen } = require('electron');
const path = require('path');
const { DownloadJob, deriveVideoId } = require('./core/downloader');
const { CATALOG_SCRIPT, PLAY_URL_SCRIPT } = require('./core/xiaoe-parser');

let mainWindow = null;
let parseWindow = null;
let currentJob = null;
let batchRunning = false;
let batchCancelled = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#f6efe4',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.maximize();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

function inferMediaKind(item) {
  const type = String(item.type || '').trim();
  if (type === '视频' || type === '音频' || type === '直播') return type;

  const url = String(item.url || item.raw_url || '').toLowerCase();
  if (url.includes('/course/video/') || url.includes('.m3u8')) return '视频';
  if (url.includes('/course/audio/')) return '音频';
  if (url.includes('/course/alive/')) return '直播';

  const resourceId = String(item.resource_id || '').toLowerCase();
  if (resourceId.startsWith('v_')) return '视频';
  if (resourceId.startsWith('a_')) return '音频';
  if (resourceId.startsWith('l_')) return '直播';

  return '';
}

function describeCatalogItem(item) {
  return [
    `title=${item.title || '(untitled)'}`,
    `type=${item.type || '(empty)'}`,
    `rawType=${item.raw_type || '(empty)'}`,
    `resourceId=${item.resource_id || '(empty)'}`,
    `url=${item.url || '(empty)'}`,
    `rawUrl=${item.raw_url || '(empty)'}`,
  ].join(' | ');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCatalogItemKey(item) {
  return [
    item.resource_id || '',
    item.url || item.raw_url || '',
    item.title || '',
  ].join('|');
}

function isContainerItem(item) {
  const type = String(item.type || '').trim();
  const resourceId = String(item.resource_id || '').toLowerCase();
  return (
    type === '专栏'
    || type === '大专栏'
    || resourceId.startsWith('p_')
  );
}

ipcMain.handle('get-default-output-root', () => app.getPath('downloads'));

ipcMain.handle('select-output-root', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ─── XiaoE Login ───

let loginWindow = null;

async function getXiaoeLoginState() {
  const ses = session.fromPartition('persist:xiaoe');
  const cookies = await ses.cookies.get({});
  const hasLogin = cookies.some(
    (c) => c.name === 'ctx_user_id'
      || c.name === 'token'
      || c.name === 'sessionid'
      || c.name.includes('login')
      || c.name.includes('user_id')
  );

  return {
    ok: true,
    status: hasLogin ? 'ok' : 'none',
    cookieCount: cookies.length,
  };
}

ipcMain.handle('clear-xiaoe-login', async () => {
  const ses = session.fromPartition('persist:xiaoe');
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'sessionstorage', 'cachestorage'],
  });
  sendToRenderer('login-status', 'none');
  return { ok: true };
});

ipcMain.handle('get-xiaoe-login-status', async () => {
  try {
    return await getXiaoeLoginState();
  } catch (e) {
    return { ok: false, status: 'none', error: '检测登录状态失败。' };
  }
});

ipcMain.handle('xiaoe-login', async (_event, { courseUrl }) => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return { ok: false, error: 'Login window already open.' };
  }

  // Extract the base domain from the course URL to navigate to
  let loginUrl;
  try {
    const parsed = new URL(courseUrl);
    loginUrl = `${parsed.protocol}//${parsed.host}`;
  } catch (e) {
    return { ok: false, error: '无效的课程链接格式。' };
  }

  // Use the same persistent partition so cookies carry over to parsing
  const ses = session.fromPartition('persist:xiaoe');
  const loginWindowWidth = 1000;
  const loginWindowHeight = 700;
  const loginWorkArea = screen.getPrimaryDisplay().workArea;
  const loginWindowX = loginWorkArea.x;
  const loginWindowY = loginWorkArea.y + Math.max(0, Math.round((loginWorkArea.height - loginWindowHeight) / 2));

  loginWindow = new BrowserWindow({
    width: loginWindowWidth,
    height: loginWindowHeight,
    x: loginWindowX,
    y: loginWindowY,
    title: '小鹅通 — 请完成登录后关闭此窗口',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
    },
  });

  sendToRenderer('login-status', 'pending');

  try {
    await loginWindow.loadURL(loginUrl);
  } catch (err) {
    sendToRenderer('login-status', 'none');
    return { ok: false, error: `页面加载失败: ${err.message}` };
  }

  // Wait for the user to close the window (after logging in)
  return new Promise((resolve) => {
    loginWindow.on('closed', async () => {
      loginWindow = null;

      // Check if the user has logged in by checking for cookies
      try {
        const loginState = await getXiaoeLoginState();
        if (loginState.status === 'ok') {
          sendToRenderer('login-status', 'ok');
          resolve({ ok: true, message: '登录成功！' });
        } else {
          sendToRenderer('login-status', 'none');
          resolve({ ok: false, error: '未检测到登录状态，请重试。' });
        }
      } catch (e) {
        sendToRenderer('login-status', 'none');
        resolve({ ok: false, error: '检测登录状态失败。' });
      }
    });
  });
});

// ─── XiaoE Course Parser ───

ipcMain.handle('parse-course', async (_event, { courseUrl }) => {
  if (parseWindow && !parseWindow.isDestroyed()) {
    parseWindow.close();
  }

  sendToRenderer('parse-log', '正在打开课程页面...');

  // Use a persistent partition so the user stays logged in across sessions
  const ses = session.fromPartition('persist:xiaoe');
  const parseWindowWidth = 1100;
  const parseWindowHeight = 750;
  const workArea = screen.getPrimaryDisplay().workArea;
  const parseWindowX = workArea.x;
  const parseWindowY = workArea.y + Math.max(0, Math.round((workArea.height - parseWindowHeight) / 2));

  parseWindow = new BrowserWindow({
    width: parseWindowWidth,
    height: parseWindowHeight,
    x: parseWindowX,
    y: parseWindowY,
    title: '小鹅通 — 请先登录（如已登录请等待加载）',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
    },
  });

  parseWindow.on('closed', () => { parseWindow = null; });

  try {
    await parseWindow.loadURL(courseUrl);
  } catch (err) {
    sendToRenderer('parse-log', `页面加载失败: ${err.message}`);
    return { ok: false, error: err.message };
  }

  sendToRenderer('parse-log', '页面已加载，等待渲染完成...');

  // Wait for the page to fully render
  await wait(3000);

  // Auto-extract userId from cookie / Vue store / pushData
  let userId = '';
  try {
    userId = await parseWindow.webContents.executeJavaScript(`
      (function() {
        // 1. Try cookie
        var m = document.cookie.match(/ctx_user_id=([^;]+)/);
        if (m && m[1]) return m[1];
        // 2. Try Vue store
        var el = document.querySelector('#app');
        if (el && el.__vue__ && el.__vue__.$store) {
          var s = el.__vue__.$store.state;
          if (s.userInfo && s.userInfo.user_id) return s.userInfo.user_id;
          if (s.userId) return s.userId;
        }
        // 3. Try window globals
        if (window.__user_id) return window.__user_id;
        if (window.pushData && window.pushData.payload && window.pushData.payload.userId) return window.pushData.payload.userId;
        return '';
      })()
    `);
  } catch (e) { /* ignore */ }

  if (userId) {
    sendToRenderer('parse-log', `自动获取到 userId: ${userId}`);
    sendToRenderer('parse-userId', userId);
  } else {
    sendToRenderer('parse-log', '⚠ 未能自动获取 userId，请手动填写。');
  }

  sendToRenderer('parse-log', '正在解析课程目录（自动滚动加载中）...');

  let initialCatalog;
  try {
    initialCatalog = await parseWindow.webContents.executeJavaScript(CATALOG_SCRIPT);
  } catch (err) {
    sendToRenderer('parse-log', `目录解析失败: ${err.message}`);
    return { ok: false, error: err.message };
  }

  if (!initialCatalog || initialCatalog.length === 0) {
    sendToRenderer('parse-log', '未找到任何课程内容，请确认已登录并拥有该课程权限。');
    return { ok: false, error: 'No episodes found.' };
  }

  const catalog = [];
  const mediaItems = [];
  const skippedItems = [];
  const typeCount = {};
  const catalogSeen = new Set();
  const mediaSeen = new Set();
  const queue = [];
  const visitedContainerPages = new Set();
  let mediaDrilldownSkipped = 0;
  const containerDrilldownLimit = 3;
  let drilldownLimitHit = false;

  const enqueueCatalogItems = (items, depth, parentTitle) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => {
      const normalized = { ...item, depth, parent_title: parentTitle || '' };
      const key = getCatalogItemKey(normalized);
      if (catalogSeen.has(key)) return;
      catalogSeen.add(key);
      catalog.push(normalized);
      queue.push(normalized);
      const typeKey = normalized.type || `(raw:${normalized.raw_type || 'empty'})`;
      typeCount[typeKey] = (typeCount[typeKey] || 0) + 1;
    });
  };

  enqueueCatalogItems(initialCatalog, 0, '');

  while (queue.length > 0) {
    const item = queue.shift();
    const mediaKind = inferMediaKind(item);
    const itemKey = getCatalogItemKey(item);

    if (item.url && mediaKind && !mediaSeen.has(itemKey)) {
      mediaSeen.add(itemKey);
      mediaItems.push({ ...item, type: mediaKind });
      mediaDrilldownSkipped++;
      continue;
    }

    if (!item.url || !mediaKind) {
      skippedItems.push({
        ...item,
        debugReason: !item.url ? 'missing_url' : 'unrecognized_media_type',
      });
    }

    if (!item.url || !isContainerItem(item) || visitedContainerPages.has(item.url) || item.depth >= 4) {
      continue;
    }

    if (visitedContainerPages.size >= containerDrilldownLimit) {
      if (!drilldownLimitHit) {
        drilldownLimitHit = true;
        sendToRenderer('parse-log', `已命中调试限制：只下钻前 ${containerDrilldownLimit} 个目录容器，后续容器已跳过。`);
      }
      continue;
    }

    visitedContainerPages.add(item.url);
    sendToRenderer('parse-log', `下钻目录 [${item.depth + 1}] ${item.title}`);

    try {
      await parseWindow.loadURL(item.url);
      await wait(1200);
      const nestedCatalog = await parseWindow.webContents.executeJavaScript(CATALOG_SCRIPT);
      sendToRenderer('parse-log', `  子目录返回 ${nestedCatalog && nestedCatalog.length ? nestedCatalog.length : 0} 项`);
      if (nestedCatalog && nestedCatalog.length > 0) {
        enqueueCatalogItems(nestedCatalog, item.depth + 1, item.title);
      }
    } catch (err) {
      sendToRenderer('parse-log', `  子目录解析失败: ${err.message}`);
    }
  }

  sendToRenderer('parse-log', `目录解析完成！共发现 ${catalog.length} 节条目，其中 ${mediaItems.length} 节音视频。`);
  sendToRenderer('parse-log', `下钻容器页数量: ${visitedContainerPages.size}`);
  sendToRenderer('parse-log', `已识别媒体并跳过继续下钻: ${mediaDrilldownSkipped}`);
  sendToRenderer('parse-log', `目录类型统计: ${JSON.stringify(typeCount)}`);
  catalog.slice(0, 5).forEach((item, index) => {
    sendToRenderer('parse-log', `目录样本 ${index + 1}: ${describeCatalogItem(item)}`);
  });
  if (skippedItems.length > 0) {
    skippedItems.slice(0, 5).forEach((item, index) => {
      sendToRenderer('parse-log', `跳过样本 ${index + 1}: reason=${item.debugReason} | ${describeCatalogItem(item)}`);
    });
  }
  if (mediaItems.length === 0) {
    sendToRenderer('parse-log', '未识别到可下载的音视频条目，请根据上面的目录样本检查 type / url / resource_id。');
    return { ok: false, error: 'No media lessons recognized from catalog.' };
  }
  sendToRenderer('parse-log', `开始逐个提取 m3u8 播放地址...`);

  const results = [];

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    sendToRenderer('parse-log', `[${i + 1}/${mediaItems.length}] 正在提取: ${item.title}`);
    sendToRenderer('parse-progress', { current: i, total: mediaItems.length });

    try {
      await parseWindow.loadURL(item.url);
      // Wait for the video player to initialize and request the m3u8
      await new Promise((r) => setTimeout(r, 5000));

      const playInfo = await parseWindow.webContents.executeJavaScript(PLAY_URL_SCRIPT);

      if (playInfo && playInfo.m3u8_url) {
        results.push({
          title: playInfo.title || item.title,
          resource_id: playInfo.resource_id || item.resource_id,
          m3u8_url: playInfo.m3u8_url,
          duration_sec: playInfo.duration_sec || 0,
          method: playInfo.method,
        });
        sendToRenderer('parse-log', `  ✓ 成功 (${playInfo.method}, ${playInfo.duration_sec}s)`);
      } else {
        sendToRenderer('parse-log', `  ✗ 未获取到 m3u8 (可能为图文、权限不足或页面结构不同)`);
        sendToRenderer('parse-log', `  调试信息: ${JSON.stringify(playInfo || {})}`);
      }
    } catch (err) {
      sendToRenderer('parse-log', `  ✗ 提取失败: ${err.message}`);
    }
  }

  sendToRenderer('parse-progress', { current: mediaItems.length, total: mediaItems.length });
  sendToRenderer('parse-log', `\n全部完成！成功提取 ${results.length}/${mediaItems.length} 个 m3u8 地址。`);

  // Close the parse window when done
  if (parseWindow && !parseWindow.isDestroyed()) {
    parseWindow.close();
  }

  return { ok: true, results };
});

// ─── Existing Download Handlers ───

ipcMain.handle('start-download', async (_event, payload) => {
  if (currentJob || batchRunning) {
    return { ok: false, error: 'A download is already running.' };
  }

  currentJob = new DownloadJob({
    userId: payload.userId,
    m3u8Url: payload.m3u8Url,
    tsUrlDemo: payload.tsUrlDemo,
    referer: payload.referer,
    outputRoot: payload.outputRoot,
    outputFolder: payload.outputFolder,
    outputFileName: payload.outputFolder,
    cleanup: true,
  });

  currentJob.on('log', (msg) => sendToRenderer('log', msg));
  currentJob.on('stage', (stage) => sendToRenderer('stage', stage));
  currentJob.on('progress', (progress) => sendToRenderer('progress', progress));

  currentJob
    .start()
    .then((result) => {
      sendToRenderer('done', result);
    })
    .catch((err) => {
      if (err && err.code === 'CANCELLED') {
        sendToRenderer('cancelled', {});
      } else {
        sendToRenderer('error', err.message || String(err));
      }
    })
    .finally(() => {
      currentJob = null;
    });

  return { ok: true };
});

ipcMain.handle('start-batch-download', async (_event, payload) => {
  if (currentJob || batchRunning) {
    return { ok: false, error: 'A download is already running.' };
  }

  const { userId, m3u8Urls, names, tsUrlDemo, referer, outputRoot } = payload;
  if (!m3u8Urls || m3u8Urls.length === 0) {
    return { ok: false, error: 'No m3u8 URLs provided.' };
  }

  batchRunning = true;
  batchCancelled = false;

  // Pre-compute unique folder names to avoid overwrites
  // Use user-provided names if available, otherwise derive from URL
  const folderNames = [];
  const folderCount = {};
  for (let i = 0; i < m3u8Urls.length; i++) {
    let base = (names && names[i]) ? names[i] : deriveVideoId(m3u8Urls[i]);
    // Sanitize folder name: remove invalid filesystem characters
    base = base.replace(/[<>:"/\\|?*]/g, '_').trim() || 'video';
    if (!folderCount[base]) {
      folderCount[base] = 1;
      folderNames.push(base);
    } else {
      folderCount[base]++;
      folderNames.push(`${base}_${folderCount[base]}`);
    }
  }

  // Send folder names to renderer for display
  sendToRenderer('batch-folder-names', folderNames);

  // Run the batch queue asynchronously
  (async () => {
    for (let i = 0; i < m3u8Urls.length; i++) {
      if (batchCancelled) {
        // Mark remaining items as cancelled
        for (let j = i; j < m3u8Urls.length; j++) {
          sendToRenderer('batch-item-status', { index: j, status: 'cancelled' });
        }
        break;
      }

      const url = m3u8Urls[i];
      const folderName = folderNames[i];

      sendToRenderer('batch-item-status', { index: i, status: 'running' });
      sendToRenderer('log', `\n━━━ Batch [${i + 1}/${m3u8Urls.length}] ━━━ ${folderName}`);
      sendToRenderer('log', `URL: ${url}`);

      currentJob = new DownloadJob({
        userId,
        m3u8Url: url,
        tsUrlDemo,
        referer,
        outputRoot,
        outputFolder: folderName,
        outputFileName: folderName,
        cleanup: true,
      });

      currentJob.on('log', (msg) => sendToRenderer('log', msg));
      currentJob.on('stage', (stage) => sendToRenderer('stage', stage));
      currentJob.on('progress', (progress) => {
        sendToRenderer('progress', {
          ...progress,
          batchIndex: i,
          batchTotal: m3u8Urls.length,
        });
      });

      try {
        const result = await currentJob.start();
        sendToRenderer('batch-item-status', {
          index: i,
          status: 'done',
          outputFile: result.outputFile,
        });
      } catch (err) {
        if (err && err.code === 'CANCELLED') {
          sendToRenderer('batch-item-status', { index: i, status: 'cancelled' });
          // Mark remaining as cancelled
          for (let j = i + 1; j < m3u8Urls.length; j++) {
            sendToRenderer('batch-item-status', { index: j, status: 'cancelled' });
          }
          batchCancelled = true;
        } else {
          sendToRenderer('log', `Error on item ${i + 1}: ${err.message || String(err)}`);
          sendToRenderer('batch-item-status', {
            index: i,
            status: 'error',
            error: err.message || String(err),
          });
          // Continue to next item on error
        }
      } finally {
        currentJob = null;
      }
    }

    batchRunning = false;
    if (batchCancelled) {
      sendToRenderer('cancelled', {});
    } else {
      sendToRenderer('batch-done', { total: m3u8Urls.length });
    }
  })();

  return { ok: true };
});

ipcMain.handle('cancel-download', () => {
  if (batchRunning) {
    batchCancelled = true;
  }
  if (currentJob) {
    currentJob.cancel();
    return true;
  }
  return false;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
