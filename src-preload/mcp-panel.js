const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('McpPanelPreload', {
  getConfig: () => ipcRenderer.sendSync('get-config'),
  retry: () => ipcRenderer.invoke('retry')
});
