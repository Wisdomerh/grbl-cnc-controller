const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

let mainWindow;
let pythonProcess;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.loadFile('frontend/index.html');
    mainWindow.webContents.openDevTools();
}

function startPythonBackend() {
    pythonProcess = spawn('python', ['backend/server.py']);

    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python backend: ${data}`);
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python backend error: ${data}`);
    });
}

app.whenReady().then(() => {
    createWindow();
    startPythonBackend();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
    if (pythonProcess) {
        pythonProcess.kill();
    }
});

// IPC handlers
ipcMain.on('connect', async (event, port) => {
    try {
        const response = await axios.post('http://localhost:5000/connect', { port });
        event.reply('connect_response', response.data);
    } catch (error) {
        event.reply('connect_response', { status: 'error', message: error.message });
    }
});

ipcMain.on('disconnect', async (event) => {
    try {
        const response = await axios.post('http://localhost:5000/disconnect');
        event.reply('disconnect_response', response.data);
    } catch (error) {
        event.reply('disconnect_response', { status: 'error', message: error.message });
    }
});

ipcMain.on('reset', async (event) => {
    try {
        const response = await axios.post('http://localhost:5000/reset');
        event.reply('command_response', response.data);
    } catch (error) {
        event.reply('command_response', { status: 'error', message: error.message });
    }
});

ipcMain.on('home', async (event) => {
    try {
        const response = await axios.post('http://localhost:5000/home');
        event.reply('command_response', response.data);
    } catch (error) {
        event.reply('command_response', { status: 'error', message: error.message });
    }
});

ipcMain.on('jog', async (event, jogCommand) => {
    try {
        const response = await axios.post('http://localhost:5000/jog', jogCommand);
        event.reply('command_response', response.data);
    } catch (error) {
        event.reply('command_response', { status: 'error', message: error.message });
    }
});

ipcMain.on('send_gcode', async (event, gcode) => {
    try {
        const response = await axios.post('http://localhost:5000/send_gcode', { gcode });
        event.reply('command_response', response.data);
    } catch (error) {
        event.reply('command_response', { status: 'error', message: error.message });
    }
});

ipcMain.on('get_status', async (event) => {
    try {
        const response = await axios.get('http://localhost:5000/status');
        event.reply('status_response', response.data);
    } catch (error) {
        event.reply('status_response', { status: 'error', message: error.message });
    }
});