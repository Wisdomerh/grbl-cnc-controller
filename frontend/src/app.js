// Import modules
import { initSocket, getSocket } from './socket.js';
import { initFileUpload } from './file-handler.js';
import { initControlPanel } from './control-panel.js';
import { initExecutionControls } from './execution-controls.js';
import { initVisualizer } from './visualizer.js';
import { openSetupWizard } from './setup-wizard.js';
import './cad-cam.js';

// Create a shared state object to be passed to all modules
const appState = {
  isConnected: false,
  connectedPort: null,
  isSocketConnected: false,
  machineStatus: {
    state: 'Disconnected',
    workPosition: { x: 0, y: 0, z: 0 },
    machinePosition: { x: 0, y: 0, z: 0 }
  },
  jobState: 'idle',
  jobProgress: { current: 0, total: 0 },
  feedRate: 500,
  stepSize: 10.0,
  recentFiles: [],
  currentFile: null,
  visualizerData: null,
  settings: {
    stepsX: 80,
    stepsY: 80,
    stepsZ: 80,
    maxFeedRate: 500,
    maxTravelX: 200,
    maxTravelY: 200,
    maxTravelZ: 100,
    homingEnabled: 1
  },
  
  // Message handlers system
  messageHandlers: [],
  
  // Position update handlers
  positionHandlers: [],
  
  // Add a method to register message handlers
  addMessageHandler: function(handler) {
    if (typeof handler === 'function') {
      this.messageHandlers.push(handler);
      return true;
    }
    return false;
  },
  
  // Add a method to remove message handlers
  removeMessageHandler: function(handler) {
    const index = this.messageHandlers.indexOf(handler);
    if (index !== -1) {
      this.messageHandlers.splice(index, 1);
      return true;
    }
    return false;
  },
  
  // Add a method to process messages through all registered handlers
  processMessage: function(message) {
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (e) {
        console.error('Error in message handler:', e);
      }
    });
  },
  
  // Register position handlers
  registerPositionHandler: function(handler) {
    if (typeof handler === 'function') {
      this.positionHandlers.push(handler);
      return true;
    }
    return false;
  },
  
  // Remove position handler
  removePositionHandler: function(handler) {
    const index = this.positionHandlers.indexOf(handler);
    if (index !== -1) {
      this.positionHandlers.splice(index, 1);
      return true;
    }
    return false;
  },
  
  // Cache DOM elements centrally
  elements: {},
  
  // Common methods that can be used across modules
  addConsoleMessage: function(type, text) {
    // Filter out status reports and ok messages
    if (text && (text.startsWith('<') || text === 'ok')) {
      return;
    }
    
    const consoleElement = this.elements.console;
    if (!consoleElement) {
      console.log(`[${type}] ${text}`); // Fallback to console if UI element not found
      return;
    }
    
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}`;
    
    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = `[${new Date().toLocaleTimeString()}]`;
    
    const content = document.createElement('span');
    content.className = 'message-content';
    content.textContent = text;
    
    messageElement.appendChild(timestamp);
    messageElement.appendChild(content);
    consoleElement.appendChild(messageElement);
    
    // Scroll to bottom
    consoleElement.scrollTop = consoleElement.scrollHeight;
    
    // Limit console length
    const maxMessages = 100;
    while (consoleElement.children.length > maxMessages) {
      consoleElement.removeChild(consoleElement.firstChild);
    }
    
    // Process message through handlers
    if (text && this.processMessage) {
      this.processMessage(text);
    }
  },
  
  sendCommand: function(command, priority = false) {
    const socket = getSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        command: 'send_gcode',
        gcode: command,
        priority
      }));
      
      if (!priority) {
        this.addConsoleMessage('sent', command);
      }
    } else {
      this.addConsoleMessage('error', 'Not connected to server');
    }
  },
  
  updateServerStatus: function(connected) {
    if (this.elements.serverStatus) {
      this.elements.serverStatus.textContent = connected ? 'Connected' : 'Disconnected';
      this.elements.serverStatus.className = connected ? 'connected' : 'disconnected';
    }
  },
  
  updateConnectionStatus: function(connected, port) {
    this.isConnected = connected;

    if (port) {
      this.connectedPort = port;
      console.log(`Connected port updated: ${port}`);
    } else if (!connected) {
      this.connectedPort = null; // Clear port if disconnected
    }
    
    if (this.elements.connectionStatus) {
      this.elements.connectionStatus.textContent = connected ? 'Connected' : 'Disconnected';
      this.elements.connectionStatus.className = connected ? 'connected' : 'disconnected';
    }
    
    // Enable/disable buttons based on connection state
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    
    if (connectBtn) connectBtn.disabled = connected;
    if (disconnectBtn) disconnectBtn.disabled = !connected;
  },
  
  updateMachineState: function(state) {
    this.machineStatus.state = state;
    
    if (this.elements.machineState) {
      this.elements.machineState.textContent = state;
    }
  },
  
  updateJobState: function(state) {
    this.jobState = state;
    
    // Update button states based on job state
    const runBtn = document.getElementById('run-gcode-btn');
    const pauseResumeBtn = document.getElementById('pause-resume-btn');
    const stopBtn = document.getElementById('stop-gcode-btn');
    
    if (runBtn) runBtn.disabled = state !== 'idle';
    
    if (pauseResumeBtn) {
      pauseResumeBtn.disabled = state === 'idle';
      if (state === 'running') {
        pauseResumeBtn.textContent = 'Pause';
        pauseResumeBtn.innerHTML = '<i class="fas fa-pause"></i>&nbsp; Pause';
        pauseResumeBtn.classList.remove('resume');
        pauseResumeBtn.classList.add('pause');
      } else if (state === 'paused') {
        pauseResumeBtn.textContent = 'Resume';
        pauseResumeBtn.innerHTML = '<i class="fas fa-play"></i>&nbsp; Resume';
        pauseResumeBtn.classList.remove('pause');
        pauseResumeBtn.classList.add('resume');
      }
    }
    
    if (stopBtn) stopBtn.disabled = state === 'idle';
  },
  
  updatePosition: function(positions) {
    if (!positions) return;
    
    // Update work position
    if (positions.wpos) {
      this.machineStatus.workPosition = positions.wpos;
      
      if (this.elements.workPositionX) {
        this.elements.workPositionX.textContent = positions.wpos.x.toFixed(3);
      }
      if (this.elements.workPositionY) {
        this.elements.workPositionY.textContent = positions.wpos.y.toFixed(3);
      }
      if (this.elements.workPositionZ) {
        this.elements.workPositionZ.textContent = positions.wpos.z.toFixed(3);
      }
      
      // Notify position handlers
      if (this.positionHandlers && this.positionHandlers.length > 0) {
        this.positionHandlers.forEach(handler => {
          try {
            handler(positions.wpos);
          } catch (e) {
            console.error('Error in position handler:', e);
          }
        });
      }
    }
    
    // Update machine position
    if (positions.mpos) {
      this.machineStatus.machinePosition = positions.mpos;
      
      if (this.elements.machinePositionX) {
        this.elements.machinePositionX.textContent = positions.mpos.x.toFixed(3);
      }
      if (this.elements.machinePositionY) {
        this.elements.machinePositionY.textContent = positions.mpos.y.toFixed(3);
      }
      if (this.elements.machinePositionZ) {
        this.elements.machinePositionZ.textContent = positions.mpos.z.toFixed(3);
      }
    }
    
    // Update visualizer if available - this will be handled by visualizer module
    if (window.updateToolPosition && positions.wpos) {
      window.updateToolPosition(positions.wpos);
    }
    
    // Update visualizer info overlay
    if (this.elements.visualizerInfo && positions.wpos) {
      this.elements.visualizerInfo.textContent = `Position: X:${positions.wpos.x.toFixed(3)} Y:${positions.wpos.y.toFixed(3)} Z:${positions.wpos.z.toFixed(3)}`;
    }
  },
  
  // Clear the console
  clearConsole: function() {
    const consoleElement = this.elements.console;
    if (consoleElement) {
      consoleElement.innerHTML = '';
      this.addConsoleMessage('system', 'Console cleared');
    }
  },
  
  // Load settings from localStorage or use defaults
  loadSettings: function() {
    try {
      const savedSettings = localStorage.getItem('machineSettings');
      if (savedSettings) {
        this.settings = JSON.parse(savedSettings);
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  }
};

// Handler for limit switch feedback
function handleLimitSwitchMessages(message) {
  // Check for limit switch query responses
  if (message.includes('Limit:')) {
    // Parse limit switch status
    const match = /\[Limit:([^\]]+)\]/.exec(message);
    if (match && match[1]) {
      const states = match[1].split(',');
      console.log('Limit switch states:', states);
      
      // Send message to handlers using a custom format
      if (appState.processMessage) {
        appState.processMessage(`LIMIT:${states[0]},${states[1]},${states[2]}`);
      }
    }
  }
}

// Register the limit switch handler
appState.addMessageHandler(handleLimitSwitchMessages);

// Setup button handler
async function handleSetupButtonClick(appState) {
  console.log('Setup button clicked!');
  appState.addConsoleMessage('system', 'Opening setup wizard...');
  
  try {
    const wizard = await openSetupWizard(appState);
    console.log('Setup wizard opened successfully');
    
    // If the machine is connected, request a position update to sync the wizard
    if (appState.isConnected) {
      // Request current position
      appState.sendCommand('?', true); // '?' queries GRBL for status
      
      // If we have limit switches, request their status too
      if (appState.settings && appState.settings.$21 === 1) {
        appState.sendCommand('$L', true); // '$L' queries limit switch status in some GRBL versions
      }
    }
  } catch (error) {
    console.error('Error opening setup wizard:', error);
    appState.addConsoleMessage('error', 'Failed to open setup wizard: ' + error.message);
  }
}

// Sync wizard settings with app
function syncWizardSettingsWithApp(wizardSettings) {
  if (!wizardSettings) return;
  
  // Update app state settings
  if (appState.settings) {
    // Motor settings - direction mask
    let dirMask = 0;
    if (wizardSettings.motorSettings.invertX) dirMask |= 1;
    if (wizardSettings.motorSettings.invertY) dirMask |= 2;
    if (wizardSettings.motorSettings.invertZ) dirMask |= 4;
    appState.settings.$3 = dirMask;
    
    // Steps per mm
    appState.settings.stepsX = appState.settings.$100 = wizardSettings.calibration.stepsX;
    appState.settings.stepsY = appState.settings.$101 = wizardSettings.calibration.stepsY;
    appState.settings.stepsZ = appState.settings.$102 = wizardSettings.calibration.stepsZ;
    
    // Limit switches
    appState.settings.$21 = wizardSettings.limitSwitches.enabled ? 1 : 0;
    appState.settings.$5 = wizardSettings.limitSwitches.inverted ? 1 : 0;
    
    // Homing
    appState.settings.$22 = wizardSettings.homing.enabled ? 1 : 0;
    appState.settings.homingEnabled = wizardSettings.homing.enabled ? 1 : 0;
    let homingMask = 0;
    if (wizardSettings.homing.directionX === "+X") homingMask |= 1;
    if (wizardSettings.homing.directionY === "+Y") homingMask |= 2;
    if (wizardSettings.homing.directionZ === "+Z") homingMask |= 4;
    appState.settings.$23 = homingMask;
    
    // Soft limits
    appState.settings.$20 = wizardSettings.softLimits.enabled ? 1 : 0;
    appState.settings.maxTravelX = appState.settings.$130 = wizardSettings.softLimits.maxTravelX;
    appState.settings.maxTravelY = appState.settings.$131 = wizardSettings.softLimits.maxTravelY;
    appState.settings.maxTravelZ = appState.settings.$132 = wizardSettings.softLimits.maxTravelZ;
    
    // Save settings to localStorage
    try {
      localStorage.setItem('machineSettings', JSON.stringify(appState.settings));
    } catch (e) {
      console.error('Error saving settings to localStorage:', e);
    }
  }
}

// This function would be called from the setup wizard when settings are saved
window.syncWizardSettingsWithApp = syncWizardSettingsWithApp;

// Connect button event handler
document.getElementById('connect-btn').addEventListener('click', () => {
  const portSelect = document.getElementById('port-select');
  const baudSelect = document.getElementById('baud-select');
  
  if (!portSelect || !baudSelect) return;
  
  const port = portSelect.value;
  const baud = baudSelect.value;
  
  if (!port) {
    appState.addConsoleMessage('error', 'Please select a port');
    return;
  }
  
  // Store the port that we're attempting to connect to
  appState.connectedPort = port;
  
  // Send connection command
  const socket = getSocket();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      command: 'connect',
      port: port,
      baud: parseInt(baud)
    }));
    
    appState.addConsoleMessage('system', `Connecting to ${port} at ${baud} baud...`);
  } else {
    appState.addConsoleMessage('error', 'Not connected to server');
  }
});

// Expose appState globally for debugging
window.appState = appState;

// Main application class
class App {
  constructor() {
    // Initialize state variables from the shared appState
    this.state = appState;
    
    // DOM elements cache
    this.state.elements = {
      serverStatus: document.getElementById('server-status'),
      connectionStatus: document.getElementById('connection-status'),
      machineState: document.getElementById('machine-state'),
      workPositionX: document.getElementById('work-pos-x'),
      workPositionY: document.getElementById('work-pos-y'),
      workPositionZ: document.getElementById('work-pos-z'),
      machinePositionX: document.getElementById('machine-pos-x'),
      machinePositionY: document.getElementById('machine-pos-y'),
      machinePositionZ: document.getElementById('machine-pos-z'),
      gcodeEditor: document.getElementById('gcode-editor'),
      console: document.getElementById('console'),
      fileNameDisplay: document.getElementById('file-name-display'),
      recentFilesList: document.getElementById('recent-files-list'),
      feedRateValue: document.getElementById('feed-rate-value'),
      feedRateSlider: document.getElementById('feed-rate-slider'),
      visualizerContainer: document.getElementById('visualizer-container'),
      visualizerInfo: document.getElementById('visualizer-info'),
      setupBtn: document.getElementById('setup-btn'),
      clearConsoleBtn: document.getElementById('clear-console-btn')
    };
    
    // Tab handling
    this.tabButtons = document.querySelectorAll('.tab-button');
    this.tabContents = document.querySelectorAll('.tab-content');
    
    // Initialize the application
    this.init();
  }
  
  // Initialize the application
  init() {
    console.log('Initializing application...');
    
    // Load settings
    this.state.loadSettings();
    
    // Load recent files from localStorage
    this.loadRecentFiles();
    
    // Set up tab navigation event listeners
    this.setupTabHandlers();
    
    // Initialize WebSocket connection - it will now add its handlers to socket
    // Important: Initialize socket first so it's available to other modules
    const socket = initSocket(this.state);
    
    // Initialize all modules
    try {
      initFileUpload(this.state);
      initControlPanel(this.state);
      initExecutionControls(this.state);
      
      // Initialize visualizer if THREE.js is available
      if (this.state.elements.visualizerContainer && typeof THREE !== 'undefined') {
        initVisualizer(this.state);
      } else {
        console.warn('THREE.js is not available or visualizer container not found.');
      }
      
      // Initialize CAD/CAM if needed
      if (typeof initCADManager === 'function') {
        try {
          initCADManager(this.state);
          console.log('CAD/CAM module initialized');
        } catch (error) {
          console.error('Error initializing CAD/CAM module:', error);
        }
      }
      // Initialize event listeners for additional buttons
      this.initEventListeners();
      
      // Setup button handler - moved here to ensure it's initialized after DOM is fully loaded
      this.setupButtonHandlers();
      
      console.log('Application initialized');
    } catch (error) {
      console.error('Error initializing modules:', error);
    }
  }
  
  // Set up tab navigation
  setupTabHandlers() {
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.getAttribute('data-tab');
        this.activateTab(tab);
      });
    });
  }
  
  
  // Setup button handlers for the new setup wizard
  setupButtonHandlers() {
    const setupBtn = document.getElementById('setup-btn'); // Get direct reference
    console.log('Setup button reference:', setupBtn); // Debug log
    
    if (setupBtn) {
      // Remove any existing event listeners to prevent duplicates
      const old_handler = setupBtn._click_handler;
      if (old_handler) {
        setupBtn.removeEventListener('click', old_handler);
      }
      
      // Create and store the new handler
      const handler = () => handleSetupButtonClick(this.state);
      setupBtn._click_handler = handler;
      
      // Add with the capture option to ensure it fires
      setupBtn.addEventListener('click', handler, true);
      console.log('Setup button handler attached');
    } else {
      console.error('Setup button not found!');
    }
  }
  
  // Initialize additional event listeners
  initEventListeners() {
    // Fix for clear console button
    if (this.state.elements.clearConsoleBtn) {
      this.state.elements.clearConsoleBtn.addEventListener('click', () => {
        this.state.clearConsole();
      });
    }
    
    // Emergency stop button
    const emergencyStopBtn = document.getElementById('emergency-stop-btn');
    if (emergencyStopBtn) {
      emergencyStopBtn.addEventListener('click', () => {
        // First send the command to stop all operations
        this.state.sendCommand('\x18', true); // Send Ctrl+X
        
        // Add a message to the console
        this.state.addConsoleMessage('error', 'EMERGENCY STOP ACTIVATED');
        
        // Visual feedback
        emergencyStopBtn.classList.add('active');
        setTimeout(() => {
          emergencyStopBtn.classList.remove('active');
        }, 500);
      });
    }
    
    // Feed rate slider
    const feedRateSlider = this.state.elements.feedRateSlider;
    const feedRateValue = this.state.elements.feedRateValue;
    
    if (feedRateSlider && feedRateValue) {
      feedRateSlider.addEventListener('input', () => {
        const value = feedRateSlider.value;
        this.state.feedRate = parseInt(value);
        feedRateValue.textContent = value;
      });
    }
  }
  
  // Activate a tab
  activateTab(tabId) {
    // Update tab buttons
    this.tabButtons.forEach(button => {
      if (button.getAttribute('data-tab') === tabId) {
        button.classList.add('active');
      } else {
        button.classList.remove('active');
      }
    });
    
        // If activating CAD tab, trigger canvas resize
    if (tabId === 'cad' && window.resizeCADCanvas) {
      setTimeout(window.resizeCADCanvas, 100);
    }
    // Update tab contents
    this.tabContents.forEach(content => {
      if (content.id === `${tabId}-tab`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }
  
  // Load recent files from localStorage
  loadRecentFiles() {
    try {
      const savedFiles = localStorage.getItem('recentGcodeFiles');
      if (savedFiles) {
        this.state.recentFiles = JSON.parse(savedFiles);
        this.updateRecentFilesList();
      }
    } catch (e) {
      console.error('Error loading recent files:', e);
    }
  }
  
  // Update recent files list in UI
  updateRecentFilesList() {
    const recentFilesList = this.state.elements.recentFilesList;
    if (!recentFilesList) return;
    
    // Clear current list
    recentFilesList.innerHTML = '';
    
    // Add files to list
    if (this.state.recentFiles.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = '<span style="font-style: italic; color: #999;">No recent files</span>';
      recentFilesList.appendChild(li);
    } else {
      this.state.recentFiles.forEach(file => {
        const li = document.createElement('li');
        const extensionSpan = document.createElement('span');
        extensionSpan.className = 'file-extension';
        extensionSpan.textContent = file.extension?.toUpperCase() || 'FILE';
        li.appendChild(extensionSpan);
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = file.name;
        li.appendChild(nameSpan);
        
        li.addEventListener('click', () => this.loadRecentFile(file.name));
        recentFilesList.appendChild(li);
      });
    }
  }
  
  // Load a recent file
  loadRecentFile(fileName) {
    const fileInfo = this.state.recentFiles.find(file => file.name === fileName);
    
    if (!fileInfo) {
      this.state.addConsoleMessage('error', `File not found: ${fileName}`);
      return;
    }
    
    try {
      const fileContent = localStorage.getItem(`gcode_${fileName}`);
      
      if (fileContent) {
        // File content is in localStorage
        if (this.state.elements.gcodeEditor) {
          this.state.elements.gcodeEditor.value = fileContent;
        }
        
        this.state.currentFile = fileInfo;
        
        // Update file name display
        if (this.state.elements.fileNameDisplay) {
          this.state.elements.fileNameDisplay.textContent = fileInfo.name;
        }
        
        // Parse the file
        const socket = getSocket();
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            command: 'upload_gcode',
            filename: fileName,
            content: fileContent
          }));
        }
        
        this.state.addConsoleMessage('system', `Loaded file from history: ${fileName}`);
      } else {
        this.state.addConsoleMessage('system', `File content not found in storage. Please upload it again.`);
      }
    } catch (e) {
      console.error('Error loading file from localStorage:', e);
      this.state.addConsoleMessage('error', `Error loading file: ${e.message}`);
    }
  }
}

// Socket message parser to detect GRBL responses
function parseGrblResponses(data) {
  // Handle different types of responses
  
  // Status report handling
  if (data.startsWith('<') && data.includes('|')) {
    // Extract status information
    const statusMatch = /<([^|]+)\|/.exec(data);
    if (statusMatch) {
      const status = statusMatch[1];
      appState.updateMachineState(status);
    }
    
    // Extract position information
    const wposMatch = /WPos:([^|]+)/.exec(data);
    const mposMatch = /MPos:([^|]+)/.exec(data);
    
    const positions = {};
    
    if (wposMatch) {
      const wposValues = wposMatch[1].split(',');
      positions.wpos = {
        x: parseFloat(wposValues[0]),
        y: parseFloat(wposValues[1]),
        z: parseFloat(wposValues[2])
      };
    }
    
    if (mposMatch) {
      const mposValues = mposMatch[1].split(',');
      positions.mpos = {
        x: parseFloat(mposValues[0]),
        y: parseFloat(mposValues[1]),
        z: parseFloat(mposValues[2])
      };
    }
    
    if (Object.keys(positions).length > 0) {
      appState.updatePosition(positions);
    }
  }
  
  // Process as a message for handlers
  appState.processMessage(data);
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  try {
    console.log('DOM content loaded, initializing application...');
    const app = new App();
    window.app = app; // Make the app instance globally accessible if needed
    
    // Add direct setup button event listener as a fallback
    const setupBtn = document.getElementById('setup-btn');
    if (setupBtn) {
      console.log('Adding fallback event listener to setup button');
      setupBtn.addEventListener('click', async () => {
        console.log('Setup button clicked (fallback handler)');
        try {
          await openSetupWizard(window.appState);
          console.log('Setup wizard opened from fallback handler');
        } catch (error) {
          console.error('Error in fallback handler:', error);
        }
      }, true);
    }
    
    // Preload the setup wizard HTML to speed up first open
    console.log('Preloading setup wizard HTML...');
    const preloadPaths = [
      './setup-wizard.html',
      '../setup-wizard.html',
      '/setup-wizard.html',
      'setup-wizard.html'
    ];
    
    const attemptPreload = async (paths) => {
      for (const path of paths) {
        try {
          console.log(`Trying to preload from: ${path}`);
          const response = await fetch(path);
          if (response.ok) {
            console.log(`Successfully preloaded wizard HTML from: ${path}`);
            // Store the successful path globally for later use
            window.setupWizardPath = path;
            return;
          }
        } catch (e) {
          console.warn(`Failed to preload from ${path}: ${e.message}`);
        }
      }
      console.warn('Failed to preload setup wizard HTML from any path');
    };
    
    attemptPreload(preloadPaths);
      
  } catch (error) {
    console.error('Error creating application:', error);
  }
});