// socket.js

// Add these imports to your socket.js file
import { handlePortsList } from './setup-wizard.js';

// WebSocket communication module
let socket = null;
let appStateRef = null; // Store a reference to appState

// Export the socket instance getter
export function getSocket() {
  return socket;
}

export function initSocket(appState) {
  // Store the reference to appState
  appStateRef = appState;

  try {
    socket = new WebSocket('ws://localhost:5000');

    socket.onopen = () => {
      console.log('Connected to WebSocket server');
      if (appStateRef) {
        appStateRef.isSocketConnected = true;
        appStateRef.updateServerStatus(true);
        appStateRef.addConsoleMessage('system', 'Connected to server');

        // Request port list
        refreshPorts();
      } else {
        console.warn('WebSocket connected but appState is not available');
      }
    };

    socket.onclose = () => {
      console.log('Disconnected from WebSocket server');
      if (appStateRef) {
        appStateRef.isSocketConnected = false;
        appStateRef.isConnected = false;
        appStateRef.updateServerStatus(false);
        appStateRef.updateConnectionStatus(false);
        appStateRef.addConsoleMessage('system', 'Disconnected from server');

        // Try to reconnect after a delay
        setTimeout(() => initSocket(appStateRef), 3000);
      } else {
        // Try to reconnect after a delay anyway
        setTimeout(() => initSocket(null), 3000);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (appStateRef) {
        appStateRef.addConsoleMessage('error', `WebSocket error: ${error.message || 'Unknown error'}`);
      }
    };

    // Add this inside your socket message event handler
    socket.onmessage = (event) => {
      try {
        // Parse the incoming message
        const data = JSON.parse(event.data);
        console.log("Socket received message:", data);

        // Handle ports list response
        if (data.type === 'ports' || (data.command === 'list_ports' && data.ports)) {
          console.log("Received ports list from server:", data.ports);

          // Update the main UI port select dropdown if it exists
          const portSelect = document.getElementById('port-select');
          if (portSelect) {
            // Clear existing options
            portSelect.innerHTML = '<option value="">Select a port</option>';

            // Add each port as an option
            if (Array.isArray(data.ports)) {
              data.ports.forEach(port => {
                const option = document.createElement('option');
                option.value = port;
                option.textContent = port;
                portSelect.appendChild(option);

                // If we're already connected, select that port
                if (appStateRef.isConnected && appStateRef.connectedPort === port) {
                  option.selected = true;
                }
              });
            }
          }

          // Also update the setup wizard with the ports list
          handlePortsList(data.ports);
        }
        // Handle connection status updates
        else if (data.type === 'connect_status' || data.type === 'connection_status') {
          const connected = data.connected === true;
          const port = data.port || null;

          // Update the app state with connection status and port
          appStateRef.updateConnectionStatus(connected, port);

          // Add a console message
          if (connected) {
            appStateRef.addConsoleMessage('system', `Connected to ${port || 'machine'}`);
          } else {
            appStateRef.addConsoleMessage('system', 'Disconnected from machine');
          }
        }

        // Handle your other socket messages here
        handleSocketMessage(event);
      } catch (e) {
        console.error("Error parsing socket message:", e);
      }
    };

    // Attach DOM event handlers for connection controls
    attachConnectionHandlers();

    return socket;
  } catch (error) {
    console.error("Error initializing WebSocket:", error);
    if (appStateRef) {
      appStateRef.addConsoleMessage('error', `Failed to connect to server: ${error.message || 'Unknown error'}`);
    }

    // Try to reconnect after a delay
    setTimeout(() => initSocket(appStateRef), 5000);
  }
}

// Handle WebSocket messages
function handleSocketMessage(event) {
  try {
    const message = JSON.parse(event.data);
    console.log('Received message:', message.type, message);

    // Check if appState is available
    if (!appStateRef) {
      console.warn('Received message but appState is not available');
      return;
    }

    // Fast-track position updates for real-time display
    if (message.type === 'position_update') {
      appStateRef.updatePosition(message.positions);
      return; // Skip further processing
    }

    // Handle G-code visualization
    if (message.type === 'gcode_visualization') {
      if (window.handleGcodeVisualization) {
        window.handleGcodeVisualization(message.data);
      }
      appStateRef.visualizerData = message.data;
      appStateRef.addConsoleMessage('system', 'G-code visualization created');
      return;
    }

    // Handle job status updates with high priority
    if (message.type === 'job_status') {
      console.log('Job status update:', message.data);

      if (message.data.state) {
        // Don't let job status change from idle to running if machine is idle
        if (message.data.state === 'running' && appStateRef.machineStatus.state === 'Idle') {
          console.log("INCONSISTENCY DETECTED: Job status says running but machine is idle");
          // Force correction
          appStateRef.updateJobState('idle');
          if (message.data.message) {
            appStateRef.addConsoleMessage('system', "State corrected: Machine is idle");
          }
        } else {
          // Machine state always takes priority
          if (appStateRef.machineStatus.state === 'Run') {
            appStateRef.updateJobState('running');
          } else if (appStateRef.machineStatus.state === 'Hold') {
            appStateRef.updateJobState('paused');
          }
        }
      }

      // Update progress information
      if (message.data.progress !== undefined && message.data.total !== undefined) {
        appStateRef.jobProgress = {
          current: message.data.progress,
          total: message.data.total
        };

        // Update progress display
        const progressElement = document.getElementById('job-progress-value');
        if (progressElement) {
          const percent = message.data.total > 0 ?
            Math.round((message.data.progress / message.data.total) * 100) : 0;
          progressElement.textContent = `${message.data.progress}/${message.data.total} (${percent}%)`;
        }
      }

      // Add log message if provided
      if (message.data.message) {
        appStateRef.addConsoleMessage('system', message.data.message);
      }

      return; // Skip further processing
    }

    // Regular message handling
    switch (message.type) {
      case 'ports_list':
        // FIX: Check the structure of the message properly
        if (message.ports) {
          // If message.ports is an array, use it directly
          updatePortsList(message.ports);
        } else if (message.data) {
          // If the ports are in message.data, use that instead
          updatePortsList(message.data);
        } else {
          console.error('Ports list message has unexpected structure:', message);
          // Try to use an empty array as fallback
          updatePortsList([]);
        }
        break;

      case 'connect_result':
        appStateRef.isConnected = message.success;
        appStateRef.updateConnectionStatus(message.success);
        appStateRef.addConsoleMessage('system', message.message);

        if (message.success) {
          // Enable/disable buttons based on connection state
          const connectBtn = document.getElementById('connect-btn');
          const disconnectBtn = document.getElementById('disconnect-btn');
          if (connectBtn) connectBtn.disabled = true;
          if (disconnectBtn) disconnectBtn.disabled = false;

          // Request initial position after successful connection
          setTimeout(() => requestInitialPosition(), 500);
        } else {
          const connectBtn = document.getElementById('connect-btn');
          const disconnectBtn = document.getElementById('disconnect-btn');
          if (connectBtn) connectBtn.disabled = false;
          if (disconnectBtn) disconnectBtn.disabled = true;
        }
        break;

      case 'disconnect_result':
        appStateRef.isConnected = false;
        appStateRef.updateConnectionStatus(false);
        appStateRef.addConsoleMessage('system', message.message);

        // Enable/disable buttons based on connection state
        const connectBtn = document.getElementById('connect-btn');
        const disconnectBtn = document.getElementById('disconnect-btn');
        if (connectBtn) connectBtn.disabled = false;
        if (disconnectBtn) disconnectBtn.disabled = true;
        break;

      case 'machine_status':
        appStateRef.updateMachineState(message.data.state);

        // Update position if available
        if (message.data.position) {
          appStateRef.updatePosition(message.data.position);
        }
        break;

      case 'state_change':
        const previousState = appStateRef.machineStatus.state;
        appStateRef.updateMachineState(message.state);

        console.log(`Machine state changed: ${previousState} -> ${message.state}`);

        // If machine state changes to 'Run', ensure the job state is updated
        if (message.state === 'Run') {
          appStateRef.updateJobState('running');
        } else if (message.state === 'Hold') {
          appStateRef.updateJobState('paused');
        } else if (message.state === 'Idle') {
          // Check if this idle state follows a run/pause state
          if (previousState === 'Run' || appStateRef.jobState === 'running' || appStateRef.jobState === 'paused') {
            console.log("Machine returned to idle after running - job is complete or stopped");
            appStateRef.updateJobState('idle');
            appStateRef.addConsoleMessage('system', 'Machine stopped - ready for next job');
          }
        }
        break;

      case 'console_message':
        // Skip status reports and ok messages
        if (message.message && (message.message.startsWith('<') || message.message === 'ok')) {
          return;
        }
        appStateRef.addConsoleMessage(message.direction, message.message);
        break;

      case 'error':
        appStateRef.addConsoleMessage('error', message.message);
        break;

      default:
        console.log('Unknown message type:', message.type);
    }
  } catch (error) {
    console.error('Error parsing message:', error, event.data);
  }
}

// Attach event handlers for connection controls
function attachConnectionHandlers() {
  const refreshBtn = document.getElementById('refresh-btn');
  const connectBtn = document.getElementById('connect-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');

  if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshPorts);
  }

  if (connectBtn) {
    connectBtn.addEventListener('click', connectToMachine);
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', disconnectFromMachine);
  }
}

// Refresh ports list
function refreshPorts() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      command: 'list_ports'
    }));
    if (appStateRef) {
      appStateRef.addConsoleMessage('system', 'Refreshing ports...');
    } else {
      console.log('Refreshing ports...');
    }
  } else {
    if (appStateRef) {
      appStateRef.addConsoleMessage('error', 'Not connected to server');
    } else {
      console.error('Not connected to server');
    }
  }
}

// Connect to machine
function connectToMachine() {
  const portSelect = document.getElementById('port-select');
  const baudSelect = document.getElementById('baud-select');

  if (!portSelect || !baudSelect) return;

  const port = portSelect.value;
  const baudRate = parseInt(baudSelect.value);

  if (!port) {
    if (appStateRef) {
      appStateRef.addConsoleMessage('error', 'Please select a port');
    }
    return;
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      command: 'connect',
      port,
      baudRate
    }));
    if (appStateRef) {
      appStateRef.addConsoleMessage('system', `Connecting to ${port} at ${baudRate} baud...`);
    }
  } else {
    if (appStateRef) {
      appStateRef.addConsoleMessage('error', 'Not connected to server');
    }
  }
}

// Disconnect from machine
function disconnectFromMachine() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      command: 'disconnect'
    }));
    if (appStateRef) {
      appStateRef.addConsoleMessage('system', 'Disconnecting...');
    }
  } else {
    if (appStateRef) {
      appStateRef.addConsoleMessage('error', 'Not connected to server');
    }
  }
}

// Request initial position
function requestInitialPosition() {
  if (!appStateRef) return;

  if (socket && socket.readyState === WebSocket.OPEN && appStateRef.isConnected) {
    appStateRef.sendCommand('?', true);
    appStateRef.sendCommand('$#', true);
    appStateRef.addConsoleMessage('system', 'Requesting position data...');
  }
}

// Update ports list dropdown
function updatePortsList(ports) {
  const portSelect = document.getElementById('port-select');
  if (!portSelect) {
    console.error('Port select element not found');
    return;
  }

  // Debug output to see what we're working with
  console.log('Updating ports list with:', ports);

  // Safe check for ports
  if (!Array.isArray(ports)) {
    console.error('Expected ports to be an array, but got:', ports);
    ports = []; // Use empty array as fallback
  }

  // Save current selection if any
  const currentSelection = portSelect.value;

  // Clear current options
  portSelect.innerHTML = '<option value="">Select a port</option>';

  // Add new ports
  ports.forEach(port => {
    if (port) {
      const option = document.createElement('option');

      // FIX: Handle different port object structures
      if (typeof port === 'string') {
        // If port is just a string
        option.value = port;
        option.textContent = port;
      } else {
        // If port is an object with path/device properties
        option.value = port.path || port.device || port.comName || '';

        // Create descriptive text for the port
        let portText = option.value;
        if (port.manufacturer || port.pnpId || port.vendorId) {
          portText += ' (';
          if (port.manufacturer) portText += port.manufacturer;
          else if (port.vendorId) portText += `Vendor: ${port.vendorId}`;
          portText += ')';
        }

        option.textContent = portText;
      }

      portSelect.appendChild(option);
    }
  });

  // Restore selection if it exists in the new list
  if (currentSelection) {
    const exists = Array.from(portSelect.options).some(option => option.value === currentSelection);
    if (exists) {
      portSelect.value = currentSelection;
    }
  }

  // Log that we've updated the ports list
  if (appStateRef) {
    appStateRef.addConsoleMessage('system', `Found ${ports.length} ports`);
  } else {
    console.log(`Found ${ports.length} ports`);
  }
}