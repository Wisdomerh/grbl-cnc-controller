// Execution controls for G-code running, pausing, and stopping
import { getSocket } from './socket.js';
import { openSetupWizard } from './setup-wizard.js';

export function initExecutionControls(appState) {
    const runGcodeBtn = document.getElementById('run-gcode-btn');
    const pauseResumeBtn = document.getElementById('pause-resume-btn');
    const stopGcodeBtn = document.getElementById('stop-gcode-btn');
    const emergencyStopBtn = document.getElementById('emergency-stop-btn');
    const setupBtn = document.getElementById('setup-btn');
    
    if (!runGcodeBtn || !pauseResumeBtn || !stopGcodeBtn || !emergencyStopBtn) {
      console.error('Execution control buttons not found');
      return;
    }
    
    console.log('Initializing execution control buttons');
    
    // Run G-code button
    runGcodeBtn.addEventListener('click', () => {
      if (!appState.isConnected) {
        appState.addConsoleMessage('error', 'Machine not connected');
        return;
      }
      
      const gcodeEditor = document.getElementById('gcode-editor');
      if (!gcodeEditor) {
        console.error('G-code editor not found');
        return;
      }
      
      const gcodeText = gcodeEditor.value;
      
      if (!gcodeText.trim()) {
        appState.addConsoleMessage('error', 'No G-code to run');
        return;
      }
      
      // Split into lines and filter out empty lines and comments
      const lines = gcodeText.split('\n')
        .map(line => line.split(';')[0].trim())  // Remove inline comments
        .filter(line => line);                   // Remove empty lines
      
      if (lines.length === 0) {
        appState.addConsoleMessage('error', 'No valid G-code commands found');
        return;
      }
      
      // Explicitly update UI state BEFORE sending the command
      runGcodeBtn.disabled = true;
      pauseResumeBtn.disabled = false;
      stopGcodeBtn.disabled = false;
      
      pauseResumeBtn.textContent = 'Pause';
      pauseResumeBtn.classList.remove('resume');
      pauseResumeBtn.classList.add('pause');
      
      // Update global job state
      appState.updateJobState('running');
      
      // Create or update job status display
      updateJobStatusDisplay('running', appState);
      
      // Send lines one by one with similar timing to backend
      runLineByLine(lines, appState);
    });
    
    // Pause/Resume button
    pauseResumeBtn.addEventListener('click', () => {
      if (!appState.isConnected) {
        appState.addConsoleMessage('error', 'Machine not connected');
        return;
      }
      
      // Check the current visual state of the button to determine action
      const isPauseButton = pauseResumeBtn.classList.contains('pause');
      const socket = getSocket();
      
      if (isPauseButton) {
        // Currently showing "Pause", so we want to pause the job
        // Update UI first
        pauseResumeBtn.textContent = 'Resume';
        pauseResumeBtn.classList.remove('pause');
        pauseResumeBtn.classList.add('resume');
        
        // Update global state
        appState.updateJobState('paused');
        updateJobStatusDisplay('paused', appState);
        
        // Force pause command to machine regardless of job state
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            command: 'send_gcode',
            gcode: '!',  // Feed hold command
            priority: true
          }));
          
          // Also send pause_job to update server state
          socket.send(JSON.stringify({
            command: 'pause_job'
          }));
        }
        
        appState.addConsoleMessage('system', 'Pausing job...');
      } else {
        // Currently showing "Resume", so we want to resume the job
        // Update UI first
        pauseResumeBtn.textContent = 'Pause';
        pauseResumeBtn.classList.remove('resume');
        pauseResumeBtn.classList.add('pause');
        
        // Update global state
        appState.updateJobState('running');
        updateJobStatusDisplay('running', appState);
        
        // Force resume command to machine regardless of job state
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            command: 'send_gcode',
            gcode: '~',  // Cycle start command 
            priority: true
          }));
          
          // Also send resume_job to update server state
          socket.send(JSON.stringify({
            command: 'resume_job'
          }));
        }
        
        appState.addConsoleMessage('system', 'Resuming job...');
      }
    });
    
    // Stop button with return to zero
    stopGcodeBtn.addEventListener('click', () => {
      if (!appState.isConnected) {
        appState.addConsoleMessage('error', 'Machine not connected');
        return;
      }
      
      // Update UI immediately
      runGcodeBtn.disabled = false;
      pauseResumeBtn.disabled = true;
      stopGcodeBtn.disabled = true;
      
      // Force job state to idle
      appState.updateJobState('idle');
      updateJobStatusDisplay('idle', appState);
      
      // Send the stop command first (without return to zero)
      const socket = getSocket();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          command: 'stop_job',
          return_to_zero: false
        }));
        
        appState.addConsoleMessage('system', 'Stopping job...');
        
        // Give the machine time to stop and enter alarm state
        setTimeout(() => {
          // Send unlock command explicitly
          socket.send(JSON.stringify({
            command: 'send_gcode',
            gcode: '$X',
            priority: true
          }));
          
          appState.addConsoleMessage('system', 'Unlocking machine...');
          
          // Wait for unlock to take effect before returning to zero
          setTimeout(() => {
            // Now send the return to zero commands as a sequence
            sendReturnToZeroSequence(appState);
          }, 1500); // Wait 1.5 seconds for unlock to take effect
        }, 1000); // Wait 1 second after stop
      }
    });
    

    function runLineByLine(lines, appState) {
      const socket = getSocket();
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        appState.addConsoleMessage('error', 'Not connected to server');
        return;
      }
      
      // First, send the entire program to the backend with 'program' mode
      // This allows the backend to manage the execution properly
      socket.send(JSON.stringify({
        command: 'send_gcode',
        gcode: lines,
        mode: 'program'
      }));
      
      appState.addConsoleMessage('system', `Starting G-code program with ${lines.length} commands...`);
      
      // Set up a counter for line processing
      let lineIndex = 0;
      
      // Create a status display element or use an existing one
      let statusElement = document.getElementById('line-execution-status');
      if (!statusElement) {
        statusElement = document.createElement('div');
        statusElement.id = 'line-execution-status';
        statusElement.className = 'execution-status';
        const consoleElement = document.getElementById('console');
        if (consoleElement) {
          consoleElement.parentElement.insertBefore(statusElement, consoleElement);
        }
      }
      
      // Show the initial status
      statusElement.textContent = `Executing line 1/${lines.length}`;
      
      // Function to process the next line
      function processNextLine() {
        if (lineIndex >= lines.length) {
          // All lines processed
          statusElement.textContent = `Execution complete: ${lines.length}/${lines.length} lines`;
          return;
        }
        
        // Skip empty lines and comments
        while (lineIndex < lines.length && 
               (!lines[lineIndex] || 
                lines[lineIndex].startsWith(';') || 
                lines[lineIndex].startsWith('('))) {
          lineIndex++;
        }
        
        if (lineIndex >= lines.length) {
          // All lines processed after skipping comments
          statusElement.textContent = `Execution complete: ${lines.length}/${lines.length} lines`;
          return;
        }
        
        const line = lines[lineIndex];
        
        // Show the current line in the console
        appState.addConsoleMessage('sent', line);
        
        // Update status display
        statusElement.textContent = `Executing line ${lineIndex + 1}/${lines.length}`;
        
        // Determine delay based on command complexity
        let delay = 100; // Default delay in milliseconds
        
        // Increase delay for more complex commands
        if (line.includes('G2') || line.includes('G3')) {
          // Arc movements need more time
          delay = 250;
        } else if (line.includes('G0') || line.includes('G1')) {
          // Linear movements
          delay = 150;
        } else if (line.startsWith('G4')) {
          // For dwell commands, parse the dwell time
          const match = /P(\d+(\.\d+)?)/.exec(line);
          if (match) {
            // P value is in seconds, convert to ms and add a small buffer
            delay = parseFloat(match[1]) * 1000 + 50;
          }
        }
        
        // Process the next line after the calculated delay
        lineIndex++;
        setTimeout(processNextLine, delay);
      }
      
      // Start processing the first line
      processNextLine();
    }
    
    // Emergency Stop button
    emergencyStopBtn.addEventListener('click', () => {
      if (!appState.isConnected) {
        appState.addConsoleMessage('error', 'Machine not connected');
        return;
      }
      
      // Always update UI immediately
      runGcodeBtn.disabled = false;
      pauseResumeBtn.disabled = true;
      stopGcodeBtn.disabled = true;
      
      pauseResumeBtn.textContent = 'Pause';
      pauseResumeBtn.classList.remove('resume');
      pauseResumeBtn.classList.add('pause');
      
      // Update global state
      appState.updateJobState('idle');
      updateJobStatusDisplay('idle', appState);
      
      // Send emergency stop command
      const socket = getSocket();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          command: 'emergency_stop'
        }));
        
        appState.addConsoleMessage('error', 'EMERGENCY STOP ACTIVATED');
      }
      
      // Visual feedback
      emergencyStopBtn.classList.add('activated');
      setTimeout(() => {
        emergencyStopBtn.classList.remove('activated');
      }, 2000);
    });
    
    // Setup button - Open new setup wizard
    if (setupBtn) {
      setupBtn.addEventListener('click', async () => {
        try {
          await openSetupWizard(appState);
        } catch (error) {
          console.error('Error opening setup wizard:', error);
          appState.addConsoleMessage('error', 'Error opening setup wizard');
        }
      });
    }
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Space bar for pause/resume
      if (e.key === ' ' && document.activeElement.tagName !== 'INPUT' && 
          document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        pauseResumeBtn.click();
      }
      
      // Escape key for stop
      if (e.key === 'Escape') {
        stopGcodeBtn.click();
      }
      
      // Ctrl+Shift+X for emergency stop
      if (e.key === 'X' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        emergencyStopBtn.click();
      }
    });
    
    // Add event listeners for G-code buttons
    const parseGcodeBtn = document.getElementById('parse-gcode-btn');
    if (parseGcodeBtn) {
      parseGcodeBtn.addEventListener('click', () => parseGcode(appState));
    }
    
    const clearGcodeBtn = document.getElementById('clear-gcode-btn');
    if (clearGcodeBtn) {
      clearGcodeBtn.addEventListener('click', () => {
        const gcodeEditor = document.getElementById('gcode-editor');
        if (gcodeEditor) {
          gcodeEditor.value = '';
          clearVisualization();
        }
      });
    }
}

// Function to send the return to zero sequence
export function sendReturnToZeroSequence(appState) {
  appState.addConsoleMessage('system', 'Returning to zero...');
  
  // Send commands in sequence with delays
  const commands = [
    'G21',             // Set units to mm
    'G90',             // Absolute positioning
    'G0 Z5 F500',      // Lift Z for safety
    'G0 X0 Y0 F800',   // Move to X/Y zero
    'G0 Z0 F500'       // Lower Z to zero
  ];
  
  // Send commands with delays between them
  let delay = 0;
  commands.forEach((cmd, index) => {
    setTimeout(() => {
      appState.sendCommand(cmd, true);
    }, delay);
    delay += 500; // Add 500ms between commands
  });
}

// Format time in seconds to mm:ss or hh:mm:ss
export function formatTime(seconds) {
  if (seconds < 0) return '--:--';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

// Update the job status display
function updateJobStatusDisplay(state, appState) {
  const statusElement = document.getElementById('job-status');
  const progressElement = document.getElementById('job-progress-value');
  
  if (!statusElement) return;
  
  // Update status text and class
  statusElement.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  statusElement.className = `status ${state}`;
  
  // If idle, reset progress display
  if (state === 'idle' && progressElement) {
    progressElement.textContent = '0/0 (0%)';
  }
}

// Parse and visualize G-code
function parseGcode(appState) {
  const gcodeEditor = document.getElementById('gcode-editor');
  if (!gcodeEditor) {
    console.error('G-code editor not found');
    return;
  }
  
  const gcodeText = gcodeEditor.value;
  
  if (!gcodeText.trim()) {
    appState.addConsoleMessage('error', 'No G-code to parse');
    return;
  }
  
  // Send to backend for parsing
  const socket = getSocket();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      command: 'parse_gcode',
      gcode: gcodeText
    }));
    
    appState.addConsoleMessage('system', 'Parsing G-code...');
  } else {
    appState.addConsoleMessage('error', 'Not connected to server');
  }
}

// Clear the visualization by calling the visualizer method if available
function clearVisualization() {
  if (typeof window.clearVisualization === 'function') {
    window.clearVisualization();
  }
}