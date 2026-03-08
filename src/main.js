const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const { DownloadJob, deriveVideoId } = require('./core/downloader');

let mainWindow = null;
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

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send(channel, payload);
  }
}

ipcMain.handle('get-default-output-root', () => app.getPath('downloads'));

ipcMain.handle('select-output-root', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

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
