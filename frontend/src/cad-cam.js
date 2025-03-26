// frontend/src/cad-cam.js
// CAD/CAM integration module

import { initCADManager } from './cad-manager.js';
import { initToolpathGenerator } from './cam-manager.js';

// Expose the initialization function globally
window.initCADManager = initCADManager;

// Expose a resize function for the canvas
window.resizeCADCanvas = function() {
  if (window.paper && window.paper.view) {
    // Get the canvas container
    const container = document.querySelector('.cad-canvas-container');
    if (container && window.paper.view) {
      const width = container.clientWidth;
      const height = container.clientHeight;
      
      window.paper.view.viewSize = new paper.Size(width, height);
      console.log(`Canvas resized to ${width}x${height}`);
      
      // Refresh view
      window.paper.view.update();
    }
  }
};

// Initialize when document is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('CAD/CAM module loaded');
  
  // Check if app state exists
  if (window.appState) {
    initCADManager(window.appState);
  } else {
    // If not available yet, wait for it
    const checkInterval = setInterval(() => {
      if (window.appState) {
        initCADManager(window.appState);
        clearInterval(checkInterval);
      }
    }, 500);
    
    // Stop checking after 10 seconds
    setTimeout(() => clearInterval(checkInterval), 10000);
  }
});