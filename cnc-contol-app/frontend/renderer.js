const { ipcRenderer } = require('electron');

// DOM elements
const portInput = document.getElementById('port-input');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const resetBtn = document.getElementById('reset-btn');
const homeBtn = document.getElementById('home-btn');
const jogBtns = document.querySelectorAll('.jog-btn');
const gcodeFileInput = document.getElementById('gcode-file-input');
const filePathDisplay = document.getElementById('file-path');
const gcodeInput = document.getElementById('gcode-input');
const sendGcodeBtn = document.getElementById('send-gcode-btn');
const statusDisplay = document.getElementById('status-display');

let isConnected = false;

// Connect to GRBL controller
connectBtn.addEventListener('click', () => {
    const port = portInput.value;
    ipcRenderer.send('connect', port);
});

// Disconnect from GRBL controller
disconnectBtn.addEventListener('click', () => {
    ipcRenderer.send('disconnect');
});

// Reset GRBL controller
resetBtn.addEventListener('click', () => {
    ipcRenderer.send('reset');
});

// Home GRBL controller
homeBtn.addEventListener('click', () => {
    ipcRenderer.send('home');
});

// Jog controls
jogBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const axis = btn.dataset.axis;
        const direction = parseInt(btn.dataset.direction);
        const distance = 10; // You can make this configurable
        const jogCommand = {
            [axis]: direction * distance
        };
        ipcRenderer.send('jog', jogCommand);
    });
});

// Handle G-code file input
gcodeFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        filePathDisplay.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
            gcodeInput.value = e.target.result;
        };
        reader.readAsText(file);
    }
});

// Send G-code
sendGcodeBtn.addEventListener('click', () => {
    const gcode = gcodeInput.value;
    ipcRenderer.send('send_gcode', gcode);
});

// IPC listeners for responses from the main process
ipcRenderer.on('connect_response', (event, response) => {
    if (response.status === 'success') {
        isConnected = true;
        updateUIConnection();
        statusDisplay.textContent = 'Connected to GRBL controller';
    } else {
        statusDisplay.textContent = `Connection error: ${response.message}`;
    }
});

ipcRenderer.on('disconnect_response', (event, response) => {
    if (response.status === 'success') {
        isConnected = false;
        updateUIConnection();
        statusDisplay.textContent = 'Disconnected from GRBL controller';
    } else {
        statusDisplay.textContent = `Disconnection error: ${response.message}`;
    }
});

ipcRenderer.on('command_response', (event, response) => {
    if (response.status === 'success') {
        statusDisplay.textContent = `Command executed: ${response.response}`;
    } else {
        statusDisplay.textContent = `Command error: ${response.message}`;
    }
});

function updateUIConnection() {
    connectBtn.disabled = isConnected;
    disconnectBtn.disabled = !isConnected;
    resetBtn.disabled = !isConnected;
    homeBtn.disabled = !isConnected;
    jogBtns.forEach(btn => btn.disabled = !isConnected);
    sendGcodeBtn.disabled = !isConnected;
}

// Request initial status on load
ipcRenderer.send('get_status');