const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const crmUrl = 'https://ericsdesignsindia.github.io/erics-designs-mini-crm/?app=windows';

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    title: "Eric's Designs CRM",
    backgroundColor: '#f5f7fb',
    icon: path.join(__dirname, '..', 'ed-icon-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('https://ericsdesignsindia.github.io/')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  window.loadURL(crmUrl);
}

app.setName("Eric's Designs CRM");
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
