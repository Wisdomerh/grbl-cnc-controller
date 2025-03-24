// G-code file handling functionality
import { getSocket } from './socket.js';

export function initFileUpload(appState) {
  const fileInput = document.getElementById('gcode-file-input');
  const fileNameDisplay = document.getElementById('file-name-display');
  const gcodeEditor = document.getElementById('gcode-editor');
  const recentFilesList = document.getElementById('recent-files-list');
  
  if (!fileInput || !fileNameDisplay || !gcodeEditor) {
    console.error('File upload elements not found');
    return;
  }
  
  // Handle file selection
  fileInput.addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    fileNameDisplay.textContent = `${file.name} (${formatFileSize(file.size)})`;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const fileContent = e.target.result;
      gcodeEditor.value = fileContent;
      
      // Store the file content in localStorage for recent files access
      try {
        localStorage.setItem(`gcode_${file.name}`, fileContent);
      } catch (error) {
        // If localStorage is full, we can't cache the file
        console.warn('Cannot cache file content: localStorage may be full', error);
      }
      
      appState.addConsoleMessage('system', `Loaded file: ${file.name}`);
      
      // Add to recent files
      addRecentFile(file.name, getFileExtension(file.name), file.size, appState);
      
      // Send to server for parsing and visualization
      const socket = getSocket();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          command: 'upload_gcode',
          filename: file.name,
          content: fileContent
        }));
        appState.addConsoleMessage('system', `Sending file to server for processing...`);
      } else {
        // If server connection isn't available, try to parse locally
        if (typeof parseGcode === 'function') {
          parseGcode(appState);
        }
      }
    };
    
    reader.onerror = function() {
      appState.addConsoleMessage('error', `Error reading file: ${file.name}`);
    };
    
    reader.readAsText(file);
  });
  
  // File drag and drop handling
  const dropZone = document.getElementById('gcode-tab');
  if (dropZone) {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, preventDefaults, false);
    });
    
    // Highlight drop zone when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, unhighlight, false);
    });
    
    // Handle dropped files
    dropZone.addEventListener('drop', function(e) {
      const dt = e.dataTransfer;
      const files = dt.files;
      
      if (files.length > 0) {
        fileInput.files = files;
        // Trigger the change event manually
        const event = new Event('change');
        fileInput.dispatchEvent(event);
      }
    }, false);
  }
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  function highlight() {
    dropZone.classList.add('highlight');
  }
  
  function unhighlight() {
    dropZone.classList.remove('highlight');
  }
}

// Add a file to recent files
function addRecentFile(name, extension, size, appState) {
  // Remove if already exists
  let recentFiles = [...appState.recentFiles].filter(f => f.name !== name);
  
  // Add to beginning
  recentFiles.unshift({
    name: name,
    extension: extension,
    size: size,
    date: new Date().toISOString()
  });
  
  // Limit to 10 files
  if (recentFiles.length > 10) {
    recentFiles.pop();
  }
  
  // Update app state
  appState.recentFiles = recentFiles;
  
  // Save to localStorage
  try {
    localStorage.setItem('recentGcodeFiles', JSON.stringify(recentFiles));
  } catch (e) {
    console.error('Error saving recent files:', e);
  }
  
  // Update the UI - this should be done by the App class
  if (typeof window.app?.updateRecentFilesList === 'function') {
    window.app.updateRecentFilesList();
  }
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes < 1024) {
    return bytes + ' bytes';
  } else if (bytes < 1048576) {
    return (bytes / 1024).toFixed(1) + ' KB';
  } else {
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}

// Helper function to get file extension
function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

// Helper function to get color for file extension
export function getExtensionColor(extension) {
  const colors = {
    'gcode': '#2196F3',  // Blue
    'nc': '#4CAF50',     // Green
    'ngc': '#FF9800',    // Orange
    'tap': '#9C27B0',    // Purple
    'txt': '#607D8B',    // Gray
    'cnc': '#F44336'     // Red
  };
  
  return colors[extension?.toLowerCase()] || '#2196F3';
}