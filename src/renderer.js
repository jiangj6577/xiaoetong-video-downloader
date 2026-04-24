const els = {
  userId: document.getElementById('userId'),
  addRowBtn: document.getElementById('addRowBtn'),
  exportListBtn: document.getElementById('exportListBtn'),
  batchTableBody: document.getElementById('batchTableBody'),
  // Login elements
  loginBtn: document.getElementById('loginBtn'),
  clearLoginBtn: document.getElementById('clearLoginBtn'),
  loginStatus: document.getElementById('loginStatus'),
  // Parse elements
  courseUrlInput: document.getElementById('courseUrlInput'),
  parseBtn: document.getElementById('parseBtn'),
  parseStatus: document.getElementById('parseStatus'),
  parseProgressBar: document.getElementById('parseProgressBar'),
  parseStatusText: document.getElementById('parseStatusText'),
  parseLogOutput: document.getElementById('parseLogOutput'),
  copyParseLogBtn: document.getElementById('copyParseLogBtn'),
  clearParseLogBtn: document.getElementById('clearParseLogBtn'),
  // Mode switcher elements
  navAuto: document.getElementById('navAuto'),
  navManual: document.getElementById('navManual'),
  panelAuto: document.getElementById('panelAuto'),
  panelManual: document.getElementById('panelManual'),
  // Sidebar footer
  exportPath: document.getElementById('exportPath'),
};

let currentMode = 'auto'; // 'auto' or 'manual'

// ─── Mode Switching ───

function switchMode(mode) {
  currentMode = mode;
  if (mode === 'auto') {
    els.navAuto.classList.add('active');
    els.navManual.classList.remove('active');
    els.panelAuto.classList.add('active');
    els.panelManual.classList.remove('active');
  } else {
    els.navManual.classList.add('active');
    els.navAuto.classList.remove('active');
    els.panelManual.classList.add('active');
    els.panelAuto.classList.remove('active');
  }
}

els.navAuto.addEventListener('click', (e) => {
  e.preventDefault();
  if (currentMode !== 'auto') switchMode('auto');
});

els.navManual.addEventListener('click', (e) => {
  e.preventDefault();
  if (currentMode !== 'manual') switchMode('manual');
});

// ─── Table Row Management ───

let rowCounter = 0;

function addRow(name = '', url = '') {
  rowCounter++;
  const tr = document.createElement('tr');
  tr.dataset.rowId = rowCounter;

  tr.innerHTML = `
    <td class="col-index">${getRowCount() + 1}</td>
    <td class="col-name"><input type="text" class="row-name" placeholder="Course Name" value="${escapeHtml(name)}" /></td>
    <td class="col-url"><input type="text" class="row-url" placeholder="https://...m3u8" value="${escapeHtml(url)}" /></td>
    <td class="col-action"><button class="btn btn-ghost text-sm remove-row-btn" type="button">✕</button></td>
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
    let url = row.querySelector('.row-url').value.trim();
    // Strip prefixes like "请求网址 " from browser DevTools copy-paste
    const urlMatch = url.match(/https?:\/\/.+/);
    if (urlMatch) url = urlMatch[0].trim();
    if (url) {
      items.push({ name, url });
    }
  });
  return items;
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

function appendLog(message) {
  if (!message) return;
  console.log(message);
}

function lockForm(isLocked) {
  const fields = [els.userId, els.addRowBtn, els.exportListBtn];
  fields.forEach((f) => { if (f) f.disabled = isLocked; });

  // Lock all row inputs and remove buttons
  els.batchTableBody.querySelectorAll('input, button').forEach((el) => {
    el.disabled = isLocked;
  });

  // Lock mode switcher during parse
  els.navAuto.disabled = isLocked;
  els.navManual.disabled = isLocked;
}

// ─── Login Logic ───

function setLoginStatus(status) {
  const statusEl = els.loginStatus;
  if (!statusEl) return;
  const labels = {
    none: { text: '未登录', class: 'badge badge-gray' },
    pending: { text: '登录中...', class: 'badge badge-orange' },
    ok: { text: '已登录 ✓', class: 'badge badge-green' },
  };
  const config = labels[status] || labels.none;
  statusEl.className = config.class;
  statusEl.textContent = config.text;
}

els.loginBtn.addEventListener('click', async () => {
  const courseUrl = els.courseUrlInput.value.trim();
  if (!courseUrl) {
    appendParseLog('⚠ 请先输入课程链接再登录。');
    els.parseLogOutput.style.display = 'block';
    return;
  }

  // Validate URL format
  try {
    new URL(courseUrl);
  } catch (e) {
    appendParseLog('⚠ 课程链接格式不正确，请输入完整的 URL。');
    els.parseLogOutput.style.display = 'block';
    return;
  }

  els.loginBtn.disabled = true;
  setLoginStatus('pending');
  appendParseLog('正在打开登录页面...');

  try {
    const result = await window.api.xiaoeLogin({ courseUrl });
    if (result.ok) {
      appendParseLog('✅ ' + result.message);
    } else {
      appendParseLog('⚠ ' + (result.error || '登录未完成'));
    }
  } catch (err) {
    appendParseLog('❌ 登录窗口异常: ' + err.message);
    setLoginStatus('none');
  } finally {
    els.loginBtn.disabled = false;
  }
});

els.clearLoginBtn.addEventListener('click', async () => {
  els.clearLoginBtn.disabled = true;
  try {
    await window.api.clearXiaoeLogin();
    appendParseLog('✅ 已清除登录状态，请重新登录。');
  } catch (err) {
    appendParseLog('❌ 清除失败: ' + err.message);
  } finally {
    els.clearLoginBtn.disabled = false;
  }
});

// ─── Parse Course Logic ───

function appendParseLog(message) {
  if (!message) return;
  const line = `${new Date().toLocaleTimeString()}  ${message}\n`;
  els.parseLogOutput.textContent += line;
  els.parseLogOutput.scrollTop = els.parseLogOutput.scrollHeight;
}

function buildParseLogCodeBlock() {
  const content = els.parseLogOutput.textContent.trim();
  if (!content) return '';
  return `\`\`\`text\n${content}\n\`\`\``;
}

function buildDownloadListExportText() {
  const items = getTableData();
  if (items.length === 0) return '';

  const stripExtension = (name) => String(name || '').trim().replace(/\.[^./\\]+$/, '');

  return items
    .map((item) => `${stripExtension(item.name)},${item.url}`)
    .join('\n');
}

els.parseBtn.addEventListener('click', async () => {
  const courseUrl = els.courseUrlInput.value.trim();
  if (!courseUrl) {
    appendParseLog('请输入课程链接。');
    return;
  }

  // Reset UI
  els.parseLogOutput.textContent = '';
  els.parseStatus.style.display = 'block';
  els.parseProgressBar.style.width = '0%';
  els.parseStatusText.textContent = '解析中...';
  els.parseBtn.disabled = true;
  els.courseUrlInput.disabled = true;

  appendParseLog(`开始解析: ${courseUrl}`);

  try {
    const result = await window.api.parseCourse({ courseUrl });

    if (result.ok && result.results && result.results.length > 0) {
      // Clear existing rows
      els.batchTableBody.innerHTML = '';
      rowCounter = 0;

      // Fill the table with parsed results
      result.results.forEach((item) => {
        addRow(item.title || '', item.m3u8_url || '');
      });

      // referer auto-fill removed

      els.parseStatusText.textContent = `解析完成! 已填入 ${result.results.length} 条视频`;
      els.parseProgressBar.style.width = '100%';
      appendParseLog(`✅ 已将 ${result.results.length} 条 m3u8 地址自动填入下方下载表格！`);
    } else {
      els.parseStatusText.textContent = '解析失败';
      appendParseLog(`❌ 解析失败: ${result.error || '未知错误'}`);
    }
  } catch (err) {
    els.parseStatusText.textContent = '解析出错';
    appendParseLog(`❌ 异常: ${err.message}`);
  } finally {
    els.parseBtn.disabled = false;
    els.courseUrlInput.disabled = false;
  }
});

// ─── Init ───

async function init() {
  try {
    const loginState = await window.api.getXiaoeLoginStatus();
    const isLoggedIn = loginState && loginState.status === 'ok';
    setLoginStatus(isLoggedIn ? 'ok' : 'none');
    if (isLoggedIn) {
      appendParseLog(`已检测到登录状态（cookies: ${loginState.cookieCount || 0}）`);
    } else {
      appendParseLog('当前未检测到登录状态，请先登录后再解析课程。');
    }
  } catch (err) {
    setLoginStatus('none');
    appendParseLog('登录状态检测失败，请手动登录后再解析课程。');
  }

  // Start with one empty row
  addRow();
}

// ─── Events ───

els.addRowBtn.addEventListener('click', () => addRow());

els.clearParseLogBtn.addEventListener('click', () => {
  els.parseLogOutput.textContent = '';
});

els.copyParseLogBtn.addEventListener('click', async () => {
  const text = buildParseLogCodeBlock();
  if (!text) {
    appendParseLog('暂无可复制的解析日志。');
    return;
  }

  const originalText = els.copyParseLogBtn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.copyParseLogBtn.textContent = '已复制';
  } catch (err) {
    els.copyParseLogBtn.textContent = '复制失败';
    appendParseLog(`复制解析日志失败: ${err.message}`);
  } finally {
    setTimeout(() => {
      els.copyParseLogBtn.textContent = originalText;
    }, 1500);
  }
});

els.exportListBtn.addEventListener('click', async () => {
  const content = buildDownloadListExportText();
  if (!content) {
    appendParseLog('⚠ 当前下载列表为空，无法导出。');
    return;
  }
  try {
    const result = await window.api.exportDownloadList({ content });
    if (result && result.ok) {
      appendParseLog(`✅ 下载列表已导出: ${result.filePath}`);
      if (els.exportPath) {
        els.exportPath.value = result.filePath;
        els.exportPath.title = result.filePath;
      }
    } else if (!result || !result.cancelled) {
      appendParseLog('⚠ 导出下载列表失败。');
    }
  } catch (err) {
    appendParseLog(`❌ 导出下载列表失败: ${err.message}`);
  }
});

// ─── IPC Listeners ───

window.api.onLog((msg) => appendLog(msg));

// ─── Login IPC Listener ───

window.api.onLoginStatus((status) => setLoginStatus(status));

// ─── Parse IPC Listeners ───

window.api.onParseLog((msg) => appendParseLog(msg));

window.api.onParseProgress((data) => {
  const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
  els.parseProgressBar.style.width = `${pct}%`;
  els.parseStatusText.textContent = `解析进度: ${data.current}/${data.total}`;
});

window.api.onParseUserId((uid) => {
  if (uid && !els.userId.value.trim()) {
    els.userId.value = uid;
    appendParseLog(`已自动填入 userId: ${uid}`);
  }
});

init();
