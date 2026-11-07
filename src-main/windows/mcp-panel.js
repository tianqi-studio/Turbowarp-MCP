const AbstractWindow = require('./abstract');
const {translate} = require('../l10n');
const {APP_NAME} = require('../brand');

const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:3000/dashboard';

class McpPanelWindow extends AbstractWindow {
  constructor () {
    super();

    this.window.setTitle(`${translate('mcp-panel.title')} - ${APP_NAME}`);

    this.dashboardUrl = process.env.TW_MCP_DASHBOARD_URL || DEFAULT_DASHBOARD_URL;
    this.isOffline = false;
    this.offlineError = '';

    this.ipc.on('get-config', (event) => {
      event.returnValue = {
        dashboardUrl: this.dashboardUrl,
        offlineError: this.offlineError,
        appName: APP_NAME
      };
    });

    this.ipc.handle('retry', () => {
      this.offlineError = '';
      this.loadDashboard();
    });

    this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // -3 is ERR_ABORTED, which happens when a navigation is superseded.
      if (!isMainFrame || errorCode === -3 || this.isOffline) {
        return;
      }
      this.showOffline(errorDescription);
    });

    this.window.webContents.on('did-finish-load', () => {
      const url = this.window.webContents.getURL();
      if (this.isOffline && url.startsWith('http')) {
        this.isOffline = false;
      }
    });

    this.loadDashboard();
  }

  loadDashboard () {
    this.isOffline = false;
    const result = this.loadURL(this.dashboardUrl);
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // did-fail-load is responsible for the offline fallback.
      });
    }
  }

  showOffline (errorDescription) {
    this.isOffline = true;
    this.offlineError = String(errorDescription || '');
    const result = this.loadURL('tw-mcp-panel://./mcp-panel.html');
    if (result && typeof result.catch === 'function') {
      result.catch(() => {
        // The local fallback page should always exist; ignore load errors.
      });
    }
  }

  getDimensions () {
    return {
      width: 1100,
      height: 800
    };
  }

  getPreload () {
    return 'mcp-panel';
  }

  getBackgroundColor () {
    return '#0b0d12';
  }

  isPopup () {
    return true;
  }

  static show () {
    const windows = AbstractWindow.getWindowsByClass(McpPanelWindow);
    const window = windows.length ? windows[0] : new McpPanelWindow();
    if (window.isOffline) {
      window.loadDashboard();
    }
    window.show();
  }
}

module.exports = McpPanelWindow;
