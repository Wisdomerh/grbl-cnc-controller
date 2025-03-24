// Machine control panel functionality
import { getSocket } from './socket.js';

// Initialize control panel
export function initControlPanel(appState) {
  // Step size buttons
  const stepButtons = document.querySelectorAll('.step-btn');
  let currentStepSize = appState.stepSize;
  
  stepButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      stepButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentStepSize = parseFloat(btn.dataset.step);
      appState.stepSize = currentStepSize;
    });
  });
  
  // Feed rate slider
  const feedSlider = document.getElementById('feed-rate-slider');
  const feedValue = document.getElementById('feed-rate-value');
  
  if (feedSlider && feedValue) {
    feedSlider.value = appState.feedRate;
    feedValue.textContent = appState.feedRate;
    
    feedSlider.addEventListener('input', () => {
      appState.feedRate = parseInt(feedSlider.value);
      feedValue.textContent = appState.feedRate;
    });
  }
  
  // Jog buttons - updated for diagonal movement
  const jogButtons = document.querySelectorAll('.jog-btn:not(.home-btn)');
  jogButtons.forEach(btn => {
    if (!btn.dataset.axis) return; // Skip if no axis defined
    
    btn.addEventListener('click', () => {
      if (!appState.isConnected) {
        appState.addConsoleMessage('error', 'Machine not connected');
        return;
      }
      
      const axis = btn.dataset.axis;
      const direction = parseInt(btn.dataset.dir);
      
      // If it's a diagonal move (has second axis)
      if (btn.dataset.axis2 && btn.dataset.dir2) {
        const axis2 = btn.dataset.axis2;
        const direction2 = parseInt(btn.dataset.dir2);
        // Pass both axes for diagonal movement
        jogMachine(axis, direction, appState.feedRate, axis2, direction2, appState);
      } else {
        // Single axis movement
        jogMachine(axis, direction, appState.feedRate, null, null, appState);
      }
    });
  });
  
  // Home button
  document.querySelector('.home-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    
    homeMachine(appState);
  });
  
  // Special buttons
  document.getElementById('unlock-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    
    appState.sendCommand('$X');
  });
  
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    
    // Ctrl-X character (ASCII 24)
    appState.sendCommand(String.fromCharCode(24));
  });
  
  document.getElementById('zero-x-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    appState.sendCommand('G10 P0 L20 X0');
    appState.addConsoleMessage('system', 'Zeroing X axis');
    
    // Request position update after zeroing
    setTimeout(() => requestInitialPosition(appState), 100);
  });
  
  document.getElementById('zero-y-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    appState.sendCommand('G10 P0 L20 Y0');
    appState.addConsoleMessage('system', 'Zeroing Y axis');
    
    // Request position update after zeroing
    setTimeout(() => requestInitialPosition(appState), 100);
  });
  
  document.getElementById('zero-z-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    appState.sendCommand('G10 P0 L20 Z0');
    appState.addConsoleMessage('system', 'Zeroing Z axis');
    
    // Request position update after zeroing
    setTimeout(() => requestInitialPosition(appState), 100);
  });
  
  document.getElementById('zero-all-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    appState.sendCommand('G10 P0 L20 X0 Y0 Z0');
    appState.addConsoleMessage('system', 'Zeroing all axes');
    
    // Request position update after zeroing
    setTimeout(() => requestInitialPosition(appState), 100);
  });
  
  // Return to zero
  document.getElementById('return-to-zero-btn')?.addEventListener('click', () => {
    if (!appState.isConnected) {
      appState.addConsoleMessage('error', 'Machine not connected');
      return;
    }
    returnToZero(appState);
  });

  // Add event listener for settings button if it exists
  document.getElementById('save-settings-btn')?.addEventListener('click', () => {
    saveGrblSettings(appState);
  });
}

// Jog the machine - updated to handle diagonal movements
function jogMachine(axis, direction, feedRate, axis2, direction2, appState) {
  const socket = getSocket();
  const distance = direction * appState.stepSize;
  
  // Check if this is a diagonal movement (both axes)
  if (axis2 !== null && direction2 !== null) {
    const distance2 = direction2 * appState.stepSize;
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        command: 'jog',
        axis: axis,
        distance: distance,
        axis2: axis2,
        distance2: distance2,
        feedRate: feedRate
      }));
      
      appState.addConsoleMessage('sent', `Jog ${axis}${direction > 0 ? '+' : '-'}${appState.stepSize}mm, ${axis2}${direction2 > 0 ? '+' : '-'}${appState.stepSize}mm`);
    }
  } else {
    // Single axis movement
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        command: 'jog',
        axis: axis,
        distance: distance,
        feedRate: feedRate
      }));
      
      appState.addConsoleMessage('sent', `Jog ${axis}${direction > 0 ? '+' : '-'}${appState.stepSize}mm`);
    }
  }
}

// Home the machine
function homeMachine(appState) {
  const socket = getSocket();
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      command: 'home'
    }));
    
    appState.addConsoleMessage('sent', 'Home command ($H)');
  }
}

// Return to zero
function returnToZero(appState) {
  appState.sendCommand('G21'); // Set units to millimeters
  appState.sendCommand('G90'); // Set to absolute positioning
  
  setTimeout(() => {
    appState.sendCommand('G0 Z5'); // Move Z to 5mm above zero
    
    setTimeout(() => {
      appState.sendCommand('G0 X0 Y0'); // Move X and Y to zero
      
      setTimeout(() => {
        appState.sendCommand('G0 Z0'); // Move Z to zero
        appState.addConsoleMessage('system', 'Returning to zero');
      }, 500);
    }, 500);
  }, 500);
}

// Request initial position
function requestInitialPosition(appState) {
  const socket = getSocket();
  if (socket && socket.readyState === WebSocket.OPEN && appState.isConnected) {
    socket.send(JSON.stringify({
      command: 'send_gcode',
      gcode: '?',
      priority: true
    }));
    
    socket.send(JSON.stringify({
      command: 'send_gcode',
      gcode: '$#',
      priority: true
    }));
    
    appState.addConsoleMessage('system', 'Requesting position data...');
  }
}

// Save GRBL settings
function saveGrblSettings(appState) {
  if (!appState.isConnected) {
    appState.addConsoleMessage('error', 'Machine not connected');
    return;
  }
  
  // Get values from form
  const stepsX = document.getElementById('steps-x')?.value;
  const stepsY = document.getElementById('steps-y')?.value;
  const stepsZ = document.getElementById('steps-z')?.value;
  const maxFeedRate = document.getElementById('max-feed-rate')?.value;
  const maxTravelX = document.getElementById('max-travel-x')?.value;
  const maxTravelY = document.getElementById('max-travel-y')?.value;
  const maxTravelZ = document.getElementById('max-travel-z')?.value;
  const homingEnabled = document.getElementById('homing-enabled')?.value;
  
  // Check if all settings are available
  if (!stepsX || !stepsY || !stepsZ || !maxFeedRate || 
      !maxTravelX || !maxTravelY || !maxTravelZ || homingEnabled === undefined) {
    appState.addConsoleMessage('error', 'One or more settings are missing');
    return;
  }
  
  // Prepare commands
  const commands = [
    `$100=${stepsX}`,   // X steps/mm
    `$101=${stepsY}`,   // Y steps/mm
    `$102=${stepsZ}`,   // Z steps/mm
    `$110=${maxFeedRate}`,  // X max rate
    `$111=${maxFeedRate}`,  // Y max rate
    `$112=${maxFeedRate}`,  // Z max rate
    `$130=${maxTravelX}`,   // X max travel
    `$131=${maxTravelY}`,   // Y max travel
    `$132=${maxTravelZ}`,   // Z max travel
    `$22=${homingEnabled}`  // Homing enable
  ];
  
  // Send commands
  commands.forEach(cmd => {
    appState.sendCommand(cmd);
  });
  
  appState.addConsoleMessage('system', 'Settings saved');
  
  // Request current settings to verify
  setTimeout(() => {
    appState.sendCommand('$$');
  }, 500);
}