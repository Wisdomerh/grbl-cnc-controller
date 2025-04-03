const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;
let splashWindow;

function createSplashWindow() {
  // Create the splash window
  splashWindow = new BrowserWindow({
    width: 500,
    height: 500,
    transparent: false,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'frontend/src/assets/icon-cnc.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Load the splash screen HTML file
  splashWindow.loadFile(path.join(__dirname, 'frontend/public/splash.html'));

  // When the splash screen is ready to show, display it
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Don't show until loaded
    icon: path.join(__dirname, 'frontend/src/assets/icon-cnc.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, 'frontend/public/index.html'));

  // Open the DevTools in development
  mainWindow.webContents.openDevTools();

  // Once the main window is ready, close the splash screen and show the main window
  mainWindow.once('ready-to-show', () => {
    // Give a bit more time for the splash animation
    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
        splashWindow = null;
      }
      mainWindow.show();
      mainWindow.maximize(); // Maximize the window to fix size issue
    }, 1000);
  });

  // Emitted when the window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createSplashWindow();
  
  // Create the main window after a delay to allow splash screen to show
  setTimeout(createWindow, 1000);
});

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