const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  exportDownloadList: (payload) => ipcRenderer.invoke('export-download-list', payload),
  getDefaultExportPath: () => ipcRenderer.invoke('get-default-export-path'),

  // XiaoE login
  xiaoeLogin: (payload) => ipcRenderer.invoke('xiaoe-login', payload),
  getXiaoeLoginStatus: () => ipcRenderer.invoke('get-xiaoe-login-status'),
  clearXiaoeLogin: () => ipcRenderer.invoke('clear-xiaoe-login'),
  onLoginStatus: (callback) => ipcRenderer.on('login-status', (_event, status) => callback(status)),

  // XiaoE course parser
  parseCourse: (payload) => ipcRenderer.invoke('parse-course', payload),

  onLog: (callback) => ipcRenderer.on('log', (_event, msg) => callback(msg)),

  // Parse progress
  onParseLog: (callback) => ipcRenderer.on('parse-log', (_event, msg) => callback(msg)),
  onParseProgress: (callback) => ipcRenderer.on('parse-progress', (_event, data) => callback(data)),
  onParseUserId: (callback) => ipcRenderer.on('parse-userId', (_event, uid) => callback(uid)),
});
