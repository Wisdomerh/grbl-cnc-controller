import { CADDrawer } from './cad-drawer.js';

let cadDrawer = null;

export function initCADModule(appState) {
  console.log('Initializing CAD module...');
  
  // Initialize the CAD drawer
  try {
    cadDrawer = new CADDrawer('cad-canvas-container', appState);
    
    // Add mouse move handler for coordinates display
    const canvasContainer = document.getElementById('cad-canvas-container');
    const coordX = document.getElementById('cad-coord-x');
    const coordY = document.getElementById('cad-coord-y');
    
    if (canvasContainer && coordX && coordY) {
      canvasContainer.addEventListener('mousemove', (event) => {
        const rect = canvasContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        
        // Convert screen coordinates to world coordinates
        const worldCoords = cadDrawer.screenToWorld(x, y);
        const snappedCoords = cadDrawer.snapToGrid(worldCoords);
        
        // Update coordinate display
        coordX.textContent = snappedCoords.x.toFixed(2);
        coordY.textContent = snappedCoords.y.toFixed(2);
      });
    }
    
    // Setup tab resize handling
    const cadTab = document.getElementById('cad-tab');
    const tabButtons = document.querySelectorAll('.tab-button');
    
    tabButtons.forEach(button => {
      if (button.getAttribute('data-tab') === 'cad') {
        button.addEventListener('click', () => {
          // Force a resize when the tab becomes active
          setTimeout(() => {
            if (cadDrawer) {
              cadDrawer.handleResize();
            }
          }, 100);
        });
      }
    });
    
    console.log('CAD module initialized successfully');
    
    return cadDrawer;
  } catch (error) {
    console.error('Error initializing CAD module:', error);
    appState.addConsoleMessage('error', `Error initializing CAD module: ${error.message}`);
    return null;
  }
}

// Make the CAD drawer available globally for debugging
window.cadDrawer = cadDrawer;