const els = {
  userId: document.getElementById('userId'),
  tsUrlDemo: document.getElementById('tsUrlDemo'),
  referer: document.getElementById('referer'),
  outputRoot: document.getElementById('outputRoot'),
  browseBtn: document.getElementById('browseBtn'),
  addRowBtn: document.getElementById('addRowBtn'),
  batchTableBody: document.getElementById('batchTableBody'),
  startBtn: document.getElementById('startBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  logOutput: document.getElementById('logOutput'),
  statusText: document.getElementById('statusText'),
  progressText: document.getElementById('progressText'),
  progressBar: document.getElementById('progressBar'),
  batchProgress: document.getElementById('batchProgress'),
};

let isBatchMode = false;

// ─── Table Row Management ───

let rowCounter = 0;

function addRow(name = '', url = '') {
  rowCounter++;
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowCounter;

  tr.innerHTML = `
    <td class="col-index">${getRowCount() + 1}</td>
    <td class="col-name"><input type="text" class="row-name" placeholder="课程名" value="${escapeHtml(name)}" /></td>
    <td class="col-url"><input type="text" class="row-url" placeholder="https://...m3u8" value="${escapeHtml(url)}" /></td>
    <td class="col-status"><span class="batch-item-status batch-status-idle">—</span></td>
    <td class="col-action"><button class="btn ghost small remove-row-btn" type="button">✕</button></td>
  `;

  tr.querySelector('.remove-row-btn').addEventListener('click', () => {
    tr.remove();
    reindexRows();
  });

  els.batchTableBody.appendChild(tr);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getRowCount() {
  return els.batchTableBody.querySelectorAll('tr').length;
}

function reindexRows() {
  const rows = els.batchTableBody.querySelectorAll('tr');
  rows.forEach((row, i) => {
    row.querySelector('.col-index').textContent = i + 1;
  });
}

function getTableData() {
  const rows = els.batchTableBody.querySelectorAll('tr');
  const items = [];
  rows.forEach((row) => {
    const name = row.querySelector('.row-name').value.trim();
    const url = row.querySelector('.row-url').value.trim();
    if (url) {
      items.push({ name, url });
    }
  });
  return items;
}

function setRowStatus(index, status) {
  const rows = els.batchTableBody.querySelectorAll('tr');
  if (index >= rows.length) return;
  const statusEl = rows[index].querySelector('.batch-item-status');
  if (!statusEl) return;

  const labels = {
    idle: '—',
    waiting: 'Waiting',
    running: '▶ Running',
    done: '✓ Done',
    error: '✗ Error',
    cancelled: '— Cancelled',
  };

  statusEl.textContent = labels[status] || status;
  statusEl.className = `batch-item-status batch-status-${status}`;
}

function setAllRowsStatus(status) {
  const rows = els.batchTableBody.querySelectorAll('tr');
  rows.forEach((_, i) => setRowStatus(i, status));
}

function updateRowName(index, name) {
  const rows = els.batchTableBody.querySelectorAll('tr');
  if (index >= rows.length) return;
  const nameInput = rows[index].querySelector('.row-name');
  if (nameInput && !nameInput.value.trim()) {
    nameInput.value = name;
  }
}

// ─── Helpers ───

function setStatus(text) {
  els.statusText.textContent = text;
}

function setProgress(current, total) {
  els.progressText.textContent = `${current} / ${total}`;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  els.progressBar.style.width = `${pct}%`;
}

function setBatchProgress(index, total) {
  if (total > 1) {
    els.batchProgress.textContent = `Video ${index + 1}/${total}  ·  `;
  } else {
    els.batchProgress.textContent = '';
  }
}

function appendLog(message) {
  if (!message) return;
  const line = `${new Date().toLocaleTimeString()}  ${message}\n`;
  els.logOutput.textContent += line;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function lockForm(isLocked) {
  const fields = [els.userId, els.tsUrlDemo, els.referer, els.outputRoot, els.browseBtn, els.addRowBtn];
  fields.forEach((f) => { f.disabled = isLocked; });

  // Lock all row inputs and remove buttons
  els.batchTableBody.querySelectorAll('input, button').forEach((el) => {
    el.disabled = isLocked;
  });

  els.startBtn.disabled = isLocked;
  els.cancelBtn.disabled = !isLocked;
}

// ─── Init ───

async function init() {
  const defaultRoot = await window.api.getDefaultOutputRoot();
  if (defaultRoot) {
    els.outputRoot.value = defaultRoot;
  }
  // Start with one empty row
  addRow();
}

// ─── Events ───

els.addRowBtn.addEventListener('click', () => addRow());

els.browseBtn.addEventListener('click', async () => {
  const root = await window.api.selectOutputRoot();
  if (root) {
    els.outputRoot.value = root;
  }
});

els.clearLogBtn.addEventListener('click', () => {
  els.logOutput.textContent = '';
});

els.startBtn.addEventListener('click', async () => {
  const items = getTableData();
  if (items.length === 0) {
    appendLog('No valid m3u8 URLs in the table.');
    return;
  }

  const userId = els.userId.value.trim();
  if (!userId) {
    appendLog('Missing userId.');
    return;
  }

  setStatus('Starting');
  setProgress(0, 0);
  lockForm(true);

  if (items.length === 1) {
    isBatchMode = false;
    els.batchProgress.textContent = '';
    setRowStatus(0, 'running');

    const payload = {
      userId,
      m3u8Url: items[0].url,
      tsUrlDemo: els.tsUrlDemo.value.trim(),
      referer: els.referer.value.trim(),
      outputRoot: els.outputRoot.value.trim(),
      outputFolder: items[0].name || '',
    };

    appendLog('Starting download...');
    const result = await window.api.startDownload(payload);
    if (!result.ok) {
      appendLog(result.error || 'Failed to start.');
      setRowStatus(0, 'error');
      lockForm(false);
      setStatus('Idle');
    }
  } else {
    isBatchMode = true;
    setAllRowsStatus('waiting');
    setBatchProgress(0, items.length);

    const payload = {
      userId,
      m3u8Urls: items.map((i) => i.url),
      names: items.map((i) => i.name),
      tsUrlDemo: els.tsUrlDemo.value.trim(),
      referer: els.referer.value.trim(),
      outputRoot: els.outputRoot.value.trim(),
    };

    appendLog(`Starting batch download: ${items.length} videos...`);
    const result = await window.api.startBatchDownload(payload);
    if (!result.ok) {
      appendLog(result.error || 'Failed to start batch.');
      lockForm(false);
      setStatus('Idle');
    }
  }
});

els.cancelBtn.addEventListener('click', async () => {
  await window.api.cancelDownload();
});

// ─── IPC Listeners ───

window.api.onLog((msg) => appendLog(msg));

window.api.onStage((stage) => {
  const map = {
    fetching: 'Fetching m3u8',
    downloading: 'Downloading segments',
    merging: 'Merging',
    cleaning: 'Cleaning',
    done: 'Done',
  };
  setStatus(map[stage] || stage);
});

window.api.onProgress((progress) => {
  setProgress(progress.current, progress.total);
  if (isBatchMode && progress.batchIndex !== undefined) {
    setBatchProgress(progress.batchIndex, progress.batchTotal);
  }
});

window.api.onDone((data) => {
  appendLog(`Done: ${data.outputFile}`);
  setStatus('Done');
  setRowStatus(0, 'done');
  els.batchProgress.textContent = '';
  lockForm(false);
});

window.api.onError((err) => {
  appendLog(`Error: ${err}`);
  setStatus('Error');
  els.batchProgress.textContent = '';
  lockForm(false);
});

window.api.onCancelled(() => {
  appendLog('Cancelled by user.');
  setStatus('Cancelled');
  els.batchProgress.textContent = '';
  lockForm(false);
});

window.api.onBatchItemStatus((data) => {
  setRowStatus(data.index, data.status);
});

window.api.onBatchFolderNames((folderNames) => {
  folderNames.forEach((name, index) => {
    updateRowName(index, name);
  });
});

window.api.onBatchDone((data) => {
  appendLog(`\nAll ${data.total} videos completed!`);
  setStatus('All Done');
  els.batchProgress.textContent = '';
  lockForm(false);
});

init();
