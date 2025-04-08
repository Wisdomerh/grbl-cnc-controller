import { getSocket } from './socket.js';

export class CADDrawer {
  constructor(containerId, appState) {
    this.container = document.getElementById(containerId);
    this.appState = appState;
    this.elements = [];
    this.isDrawing = false;
    this.currentTool = 'select';
    this.startPoint = null;
    this.tempElement = null;
    this.gridSize = 5; // Grid size in mm
    this.selectedElement = null;
    this.toolDiameter = 3.0;
    this.stepDown = 1.0;
    this.feedRate = 500;
    
    // Operation settings
    this.cutDepth = -1.0;
    this.operationType = 'profile';
    
    // Initialize Two.js
    this.initTwoJS();
    
    // Initialize event listeners
    this.initEventListeners();
    
    // Set up grid
    this.drawGrid();

    this.currentText = '';
    this.textSize = 20; 
    this.textFont = 'Arial';

    this.isDraggingElement = false;
    this.dragStartPoint = null;
    this.elementStartPosition = null;
    this.isResizingElement = false;
    this.resizeStartPoint = null;
    this.resizeHandle = null;
    
    this.resizeHandlesGroup = null;
  
    console.log('CAD Drawer initialized with 2.5D support');
  }


  initTwoJS() {
    console.log('Initializing Two.js', Two, this.container);
    if (!this.container) {
      console.error('CAD container not found');
      return;
    }
    
    const params = {
      width: this.container.offsetWidth || 800, // Fallback width
      height: this.container.offsetHeight || 600, // Fallback height
      type: Two.Types.svg
    };
    
    console.log('Creating Two.js instance with params:', params);
    this.two = new Two(params);
    console.log('Two.js instance created:', this.two);
    
    // Explicitly append to container
    const domElement = this.two.renderer.domElement;
    console.log('Appending element to container:', domElement);
    this.container.appendChild(domElement);
    
    // Set up coordinate system (origin at center)
    this.centerX = this.two.width / 2;
    this.centerY = this.two.height / 2;
    
    // Create groups that were missing
    this.drawingGroup = this.two.makeGroup();
    this.gridGroup = this.two.makeGroup();
    this.tempGroup = this.two.makeGroup();
    
    // Draw the initial grid after creating groups
    this.drawGrid();
    
    // Force an update
    this.two.update();
  }
  
  initEventListeners() {
    if (!this.container) return;
    
    // Mouse events for drawing
    this.container.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.container.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.container.addEventListener('mouseup', this.handleMouseUp.bind(this));
    
    // Window resize event
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // Tool selection
    const toolButtons = document.querySelectorAll('.cad-tool-btn');
    console.log('Found tool buttons:', toolButtons.length);
    toolButtons.forEach(button => {
      button.addEventListener('click', (event) => {
        console.log('Tool button clicked:', button.dataset.tool || button.getAttribute('data-tool'));
        const tool = button.dataset.tool || button.getAttribute('data-tool');
        if (tool) {
          this.setTool(tool);
          // Remove active class from all buttons
          toolButtons.forEach(btn => btn.classList.remove('active'));
          // Add active class to clicked button
          button.classList.add('active');
        }
      });
    });
    
    const toolDiameterInput = document.getElementById('cad-tool-diameter');
    if (toolDiameterInput) {
      toolDiameterInput.addEventListener('change', () => {
        this.toolDiameter = parseFloat(toolDiameterInput.value);
      });
    }
  
    const stepDownInput = document.getElementById('cad-step-down');
    if (stepDownInput) {
      stepDownInput.addEventListener('change', () => {
        this.stepDown = parseFloat(stepDownInput.value);
      });
    }
  
    const feedRateInput = document.getElementById('cad-feed-rate');
    if (feedRateInput) {
      feedRateInput.addEventListener('change', () => {
        this.feedRate = parseFloat(feedRateInput.value);
      });
    }
    
    // Depth input
    const depthInput = document.getElementById('cad-cut-depth');
    if (depthInput) {
      depthInput.addEventListener('change', () => {
        this.cutDepth = parseFloat(depthInput.value);
        // Update selected element if any
        if (this.selectedElement) {
          this.selectedElement.depth = this.cutDepth;
          this.updateElementVisual(this.selectedElement);
        }
      });
    }
    
    // Operation type selection
    const operationSelect = document.getElementById('cad-operation-select');
    if (operationSelect) {
      operationSelect.addEventListener('change', () => {
        this.operationType = operationSelect.value;
        // Update selected element if any
        if (this.selectedElement) {
          this.selectedElement.operation = this.operationType;
          this.updateElementVisual(this.selectedElement);
        }
      });
    }
    
    // Clear button
    const clearButton = document.getElementById('cad-clear-btn');
    if (clearButton) {
      clearButton.addEventListener('click', this.clearDrawing.bind(this));
    }
    
    // Generate G-code button
    const generateButton = document.getElementById('cad-generate-gcode-btn');
    if (generateButton) {
      generateButton.addEventListener('click', this.generateGCode.bind(this));
    }
  
    // Add text size input if it doesn't exist yet
    if (!document.getElementById('cad-text-size')) {
      const textSizeInput = document.createElement('div');
      textSizeInput.className = 'cad-settings-row';
      textSizeInput.innerHTML = `
        <label for="cad-text-size">Text Size:</label>
        <input type="number" id="cad-text-size" value="${this.textSize}" min="5" step="1" max="100">
        <span>px</span>
      `;
      
      const settingsPanel = document.querySelector('.cad-settings-panel');
      if (settingsPanel) {
        settingsPanel.appendChild(textSizeInput);
        
        // Add event listener for text size
        const textSizeElement = document.getElementById('cad-text-size');
        if (textSizeElement) {
          textSizeElement.addEventListener('change', () => {
            this.textSize = parseFloat(textSizeElement.value);
          });
        }
      }
    }
  }
  
  handleResize() {
    if (!this.container || !this.two) return;
    
    // Update Two.js dimensions
    this.two.width = this.container.offsetWidth;
    this.two.height = this.container.offsetHeight;
    this.centerX = this.two.width / 2;
    this.centerY = this.two.height / 2;
    
    // Redraw grid
    this.clearGrid();
    this.drawGrid();
    
    // Update renderer
    this.two.update();
  }
  
  drawResizeHandles() {
    // Remove any existing handles
    if (this.resizeHandlesGroup) {
      this.two.remove(this.resizeHandlesGroup);
    }
    
    // If no element is selected, return
    if (!this.selectedElement) return;
    
    // Create a new group for handles
    this.resizeHandlesGroup = this.two.makeGroup();
    
    // Define handle positions based on element type
    let handles = [];
    
    if (this.selectedElement.type === 'circle') {
      const center = this.selectedElement.center;
      const radius = this.selectedElement.radius;
      
      // Add a handle at the edge of the circle (east point)
      handles.push({
        x: center.x + radius,
        y: center.y,
        id: 'radius'
      });
    } else if (this.selectedElement.type === 'rectangle') {
      const center = this.selectedElement.center;
      const halfWidth = this.selectedElement.width / 2;
      const halfHeight = this.selectedElement.height / 2;
      
      // Add handles at the corners and sides
      handles = [
        { x: center.x - halfWidth, y: center.y - halfHeight, id: 'top-left' },
        { x: center.x + halfWidth, y: center.y - halfHeight, id: 'top-right' },
        { x: center.x - halfWidth, y: center.y + halfHeight, id: 'bottom-left' },
        { x: center.x + halfWidth, y: center.y + halfHeight, id: 'bottom-right' },
        { x: center.x, y: center.y - halfHeight, id: 'top' },
        { x: center.x, y: center.y + halfHeight, id: 'bottom' },
        { x: center.x - halfWidth, y: center.y, id: 'left' },
        { x: center.x + halfWidth, y: center.y, id: 'right' }
      ];
    } else if (this.selectedElement.type === 'line') {
      // Add handles at the endpoints
      handles = [
        { ...this.selectedElement.start, id: 'start' },
        { ...this.selectedElement.end, id: 'end' }
      ];
    } else if (this.selectedElement.type === 'text') {
      // For text, allow resizing by dragging the right side
      const position = this.selectedElement.position;
      const width = (this.selectedElement.text.length * (this.selectedElement.size || 20) * 0.6) / 10;
      
      handles.push({
        x: position.x + width/2,
        y: position.y,
        id: 'size'
      });
    }
    
    // Draw all handles
    for (const handle of handles) {
      const screenPos = this.worldToScreen(handle.x, handle.y);
      const handleSize = 6; // Size in pixels
      
      const handleVisual = this.two.makeRectangle(
        screenPos.x, screenPos.y, 
        handleSize, handleSize
      );
      
      handleVisual.fill = '#ff9800'; // Orange color
      handleVisual.stroke = '#000';
      handleVisual.linewidth = 1;
      
      this.resizeHandlesGroup.add(handleVisual);
    }
    
    this.two.update();
  }

  screenToWorld(x, y) {

    return {
      x: (x - this.centerX) / 10, 
      y: (this.centerY - y) / 10  
    };
  }
  
  worldToScreen(x, y) {
    // Convert world coordinates to screen coordinates
    return {
      x: this.centerX + (x * 10),
      y: this.centerY - (y * 10)
    };
  }
  
  snapToGrid(point) {
    // Snap to nearest grid point
    return {
      x: Math.round(point.x / this.gridSize) * this.gridSize,
      y: Math.round(point.y / this.gridSize) * this.gridSize
    };
  }

  generateTextGcode(element, safeZ, plungeRate, feedRate, stepDown) {
    const gcode = [];
    
    gcode.push(`; Text Outline: "${element.text}"`);
    gcode.push(`; Position: X${element.position.x.toFixed(3)}, Y${element.position.y.toFixed(3)}`);
    gcode.push(`; Depth: ${element.depth} mm`);
    
    // Calculate text metrics
    const charWidth = (element.size || 20) * 0.6 / 10; // Convert pixel size to mm
    const charHeight = (element.size || 20) / 10; // Convert pixel size to mm
    const spacing = charWidth * 0.2; // Space between characters
    
    // Determine total text width
    const totalWidth = element.text.length * (charWidth + spacing) - spacing;
    
    // Calculate start position (centered on the original position)
    const startX = element.position.x - totalWidth / 2;
    const baseY = element.position.y;
    
    // Perform cutting in multiple depth passes if needed
    let currentDepth = 0;
    const targetDepth = element.depth;
    
    while (currentDepth > targetDepth) {
      // Calculate the next depth level
      currentDepth = Math.max(currentDepth - stepDown, targetDepth);
      
      gcode.push(`; Cutting at depth: ${currentDepth.toFixed(3)} mm`);
      
      // Process each character
      let xPos = startX;
      
      for (let charIndex = 0; charIndex < element.text.length; charIndex++) {
        const char = element.text[charIndex];
        
        // Skip spaces but advance position
        if (char === ' ') {
          xPos += charWidth + spacing;
          continue;
        }
        
        // Center of this character
        const charCenterX = xPos + charWidth / 2;
        
        gcode.push(`; Character: ${char}`);
        gcode.push(`G0 Z${safeZ} ; Raise to safe height`);
        
        // Generate the outline path for this character
        const { path, width } = this.getCharacterPath(char, charCenterX, baseY, charWidth, charHeight);
        
        // Move to first point of the path
        if (path.length > 0) {
          gcode.push(`G0 X${path[0].x} Y${path[0].y} ; Move to start point`);
          gcode.push(`G1 Z${currentDepth} F${plungeRate} ; Plunge to cutting depth`);
          
          // Follow the path, but convert arcs to line segments for better reliability
          let prevPoint = path[0];
          
          for (let i = 1; i < path.length; i++) {
            const point = path[i];
            
            if (point.type === 'line') {
              gcode.push(`G1 X${point.x} Y${point.y} F${feedRate} ; Line`);
            } else if (point.type === 'arc') {
              // Convert arc to line segments for better reliability
              const arcSegments = this.arcToLines(
                prevPoint.x, prevPoint.y, 
                point.x, point.y, 
                point.centerX, point.centerY, 
                point.clockwise,
                12  // Use 12 segments per arc for smoother curves
              );
              
              arcSegments.forEach(segment => {
                gcode.push(`G1 X${segment.x.toFixed(4)} Y${segment.y.toFixed(4)} F${feedRate} ; Arc segment`);
              });
            }
            
            prevPoint = point;
          }
        }
        
        // Add a dwell after each character to let the controller catch up
        gcode.push(`G4 P0.1 ; Dwell for 0.1 seconds`);
        
        // Advance to next character position
        xPos += width + spacing;
      }
    }
    
    // Return to safe height
    gcode.push(`G0 Z${safeZ} ; Return to safe height`);
    
    return gcode;
  }
  
  // Add this helper method to convert arcs to line segments
  arcToLines(startX, startY, endX, endY, centerX, centerY, isClockwise, segmentCount = 12) {
    const segments = [];
    
    // Calculate radius based on the distance from start to center
    const dx1 = startX - centerX;
    const dy1 = startY - centerY;
    const radius = Math.sqrt(dx1*dx1 + dy1*dy1);
    
    // Calculate start and end angles
    const startAngle = Math.atan2(startY - centerY, startX - centerX);
    const endAngle = Math.atan2(endY - centerY, endX - centerX);
    
    // Adjust end angle for proper arc direction
    let totalAngle;
    if (isClockwise) {
      totalAngle = (startAngle <= endAngle) ? (startAngle - endAngle) : (startAngle - endAngle);
    } else {
      totalAngle = (endAngle >= startAngle) ? (endAngle - startAngle) : (2 * Math.PI + endAngle - startAngle);
    }
    
    // Ensure positive angle
    if (totalAngle < 0) totalAngle += 2 * Math.PI;
    
    // Generate segments
    for (let i = 1; i <= segmentCount; i++) {
      const fraction = i / segmentCount;
      let angle;
      
      if (isClockwise) {
        angle = startAngle - (totalAngle * fraction);
      } else {
        angle = startAngle + (totalAngle * fraction);
      }
      
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      
      segments.push({ x, y });
    }
    
    return segments;
  }

  getCharacterPath(char, centerX, centerY, width, height) {
    // Set up path array to hold points
    const path = [];
    let actualWidth = width;
    
    // Half dimensions
    const w2 = width / 2;
    const h2 = height / 2;
    
    // Character-specific paths
    switch (char.toLowerCase()) {
      case 'a':
        // Top point of A
        path.push({ x: centerX, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Across to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        // Up to top
        path.push({ x: centerX, y: centerY - h2, type: 'line' });
        // Move to left side middle
        path.push({ x: centerX - w2/2, y: centerY, type: 'move' });
        // Draw crossbar
        path.push({ x: centerX + w2/2, y: centerY, type: 'line' });
        break;
        
      case 'b':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Right to bottom middle
        path.push({ x: centerX, y: centerY + h2, type: 'line' });
        // Arc to middle right
        path.push({ 
          x: centerX + w2, 
          y: centerY, 
          centerX: centerX, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to top middle
        path.push({ 
          x: centerX, 
          y: centerY - h2/2, 
          centerX: centerX, 
          centerY: centerY - h2/4, 
          type: 'arc', 
          clockwise: true 
        });
        // Back to start
        path.push({ x: centerX - w2, y: centerY - h2, type: 'line' });
        break;
        
      case 'c':
        // Start at top right
        path.push({ x: centerX + w2, y: centerY - h2/2, type: 'move' });
        // Arc to bottom right
        path.push({ 
          x: centerX, 
          y: centerY + h2, 
          centerX: centerX, 
          centerY: centerY, 
          type: 'arc', 
          clockwise: false 
        });
        // Arc to top left
        path.push({ 
          x: centerX - w2, 
          y: centerY, 
          centerX: centerX - w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: false 
        });
        // Arc back to top right
        path.push({ 
          x: centerX + w2, 
          y: centerY - h2/2, 
          centerX: centerX, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: false 
        });
        break;
        
      case 'd':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Arc to middle right
        path.push({ 
          x: centerX + w2, 
          y: centerY, 
          centerX: centerX, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to top middle
        path.push({ 
          x: centerX - w2, 
          y: centerY - h2, 
          centerX: centerX, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        break;
        
      case 'e':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Right to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        // Back to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'move' });
        // Up to middle left
        path.push({ x: centerX - w2, y: centerY, type: 'line' });
        // Right to middle right
        path.push({ x: centerX + w2/2, y: centerY, type: 'line' });
        // Back to middle left
        path.push({ x: centerX - w2, y: centerY, type: 'move' });
        // Up to top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'line' });
        // Right to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        break;
        
      case 'f':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Back to middle left
        path.push({ x: centerX - w2, y: centerY, type: 'move' });
        // Right to middle right
        path.push({ x: centerX + w2/2, y: centerY, type: 'line' });
        // Back to top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Right to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        break;
        
      case 'g':
        // Start at top right
        path.push({ x: centerX + w2, y: centerY - h2/2, type: 'move' });
        // Arc to bottom right
        path.push({ 
          x: centerX, 
          y: centerY + h2, 
          centerX: centerX, 
          centerY: centerY, 
          type: 'arc', 
          clockwise: false 
        });
        // Arc to top left
        path.push({ 
          x: centerX - w2, 
          y: centerY, 
          centerX: centerX - w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: false 
        });
        // Arc to top right
        path.push({ 
          x: centerX + w2, 
          y: centerY - h2/2, 
          centerX: centerX, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: false 
        });
        // Straight down to center right
        path.push({ x: centerX + w2, y: centerY, type: 'line' });
        // Draw crossbar to center
        path.push({ x: centerX, y: centerY, type: 'line' });
        break;
        
      case 'h':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Move to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'move' });
        // Down to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        // Move to middle left
        path.push({ x: centerX - w2, y: centerY, type: 'move' });
        // Right to middle right
        path.push({ x: centerX + w2, y: centerY, type: 'line' });
        break;
        
      case 'i':
        // Start at top center
        path.push({ x: centerX, y: centerY - h2, type: 'move' });
        // Down to bottom center
        path.push({ x: centerX, y: centerY + h2, type: 'line' });
        // Top bar left
        path.push({ x: centerX - w2/2, y: centerY - h2, type: 'move' });
        // Top bar right
        path.push({ x: centerX + w2/2, y: centerY - h2, type: 'line' });
        // Bottom bar left
        path.push({ x: centerX - w2/2, y: centerY + h2, type: 'move' });
        // Bottom bar right
        path.push({ x: centerX + w2/2, y: centerY + h2, type: 'line' });
        actualWidth = width * 0.5; // I is narrower
        break;
        
      case 'j':
        // Start at top center
        path.push({ x: centerX, y: centerY - h2, type: 'move' });
        // Down to bottom center
        path.push({ x: centerX, y: centerY + h2/2, type: 'line' });
        // Arc to left
        path.push({ 
          x: centerX - w2/2, 
          y: centerY + h2, 
          centerX: centerX - w2/4, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: false 
        });
        // Top bar left
        path.push({ x: centerX - w2/2, y: centerY - h2, type: 'move' });
        // Top bar right
        path.push({ x: centerX + w2/2, y: centerY - h2, type: 'line' });
        break;
        
      case 'k':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Move to middle left
        path.push({ x: centerX - w2, y: centerY, type: 'move' });
        // Diagonal to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        // Back to middle left
        path.push({ x: centerX - w2, y: centerY, type: 'move' });
        // Diagonal to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        break;
        
      case 'l':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Right to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        actualWidth = width * 0.7; // L is narrower
        break;
        
      case 'm':
        // Start at bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'move' });
        // Up to top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'line' });
        // Diagonal to middle center
        path.push({ x: centerX, y: centerY, type: 'line' });
        // Diagonal to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        // Down to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        actualWidth = width * 1.2; // M is wider
        break;
        
      case 'n':
        // Start at bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'move' });
        // Up to top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'line' });
        // Diagonal to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        // Up to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        break;
        
      case 'o':
        // Start at top center
        path.push({ x: centerX, y: centerY - h2, type: 'move' });
        // Arc to right center
        path.push({ 
          x: centerX + w2, 
          y: centerY, 
          centerX: centerX + w2/2, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to bottom center
        path.push({ 
          x: centerX, 
          y: centerY + h2, 
          centerX: centerX + w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to left center
        path.push({ 
          x: centerX - w2, 
          y: centerY, 
          centerX: centerX - w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc back to top center
        path.push({ 
          x: centerX, 
          y: centerY - h2, 
          centerX: centerX - w2/2, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        break;
        
      case 'p':
        // Start at bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'move' });
        // Up to top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'line' });
        // Right to top middle
        path.push({ x: centerX + w2/2, y: centerY - h2, type: 'line' });
        // Arc to middle right
        path.push({ 
          x: centerX + w2, 
          y: centerY - h2/4, 
          centerX: centerX + w2/4, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to middle left
        path.push({ 
          x: centerX - w2, 
          y: centerY, 
          centerX: centerX, 
          centerY: centerY, 
          type: 'arc', 
          clockwise: true 
        });
        break;
        
      case 'q':
        // Draw O first
        path.push({ x: centerX, y: centerY - h2, type: 'move' });
        path.push({ 
          x: centerX + w2, 
          y: centerY, 
          centerX: centerX + w2/2, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        path.push({ 
          x: centerX, 
          y: centerY + h2, 
          centerX: centerX + w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        path.push({ 
          x: centerX - w2, 
          y: centerY, 
          centerX: centerX - w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        path.push({ 
          x: centerX, 
          y: centerY - h2, 
          centerX: centerX - w2/2, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Add tail
        path.push({ x: centerX + w2/2, y: centerY + h2/2, type: 'move' });
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        break;
        
      case 'r':
        // Start at bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'move' });
        // Up to top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'line' });
        // Right to top middle
        path.push({ x: centerX + w2/2, y: centerY - h2, type: 'line' });
        // Arc to middle right
        path.push({ 
          x: centerX + w2, 
          y: centerY - h2/4, 
          centerX: centerX + w2/4, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to middle left
        path.push({ 
          x: centerX - w2, 
          y: centerY, 
          centerX: centerX, 
          centerY: centerY, 
          type: 'arc', 
          clockwise: true 
        });
        // Diagonal to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        break;
        
      case 's':
        // Start at top right
        path.push({ x: centerX + w2, y: centerY - h2/2, type: 'move' });
        // Arc to top left
        path.push({ 
          x: centerX - w2, 
          y: centerY - h2/2, 
          centerX: centerX, 
          centerY: centerY - h2, 
          type: 'arc', 
          clockwise: false 
        });
        // Arc to middle right
        path.push({ 
          x: centerX + w2/2, 
          y: centerY, 
          centerX: centerX - w2/4, 
          centerY: centerY - h2/4, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to bottom right
        path.push({ 
          x: centerX + w2, 
          y: centerY + h2/2, 
          centerX: centerX + w2/2, 
          centerY: centerY + h2/4, 
          type: 'arc', 
          clockwise: true 
        });
        // Arc to bottom left
        path.push({ 
          x: centerX - w2, 
          y: centerY + h2/2, 
          centerX: centerX, 
          centerY: centerY + h2, 
          type: 'arc', 
          clockwise: false 
        });
        break;
        
      case 't':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Right to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        // Move to top center
        path.push({ x: centerX, y: centerY - h2, type: 'move' });
        // Down to bottom center
        path.push({ x: centerX, y: centerY + h2, type: 'line' });
        break;
        
      case 'u':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2/2, type: 'line' });
        // Arc to bottom right
        path.push({ 
          x: centerX + w2, 
          y: centerY + h2/2, 
          centerX: centerX, 
          centerY: centerY + h2, 
          type: 'arc', 
          clockwise: true 
        });
        // Up to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        break;
        
      case 'v':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Diagonal to bottom center
        path.push({ x: centerX, y: centerY + h2, type: 'line' });
        // Diagonal to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        break;
        
      case 'w':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Down to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Up to middle center
        path.push({ x: centerX, y: centerY, type: 'line' });
        // Down to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        // Up to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        actualWidth = width * 1.2; // W is wider
        break;
        
      case 'x':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Diagonal to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        // Move to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'move' });
        // Diagonal to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        break;
        
      case 'y':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Diagonal to center
        path.push({ x: centerX, y: centerY, type: 'line' });
        // Down to bottom center
        path.push({ x: centerX, y: centerY + h2, type: 'line' });
        // Move back to center
        path.push({ x: centerX, y: centerY, type: 'move' });
        // Diagonal to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        break;
        
      case 'z':
        // Start at top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Right to top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        // Diagonal to bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Right to bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        break;
        
      // Add numeric characters
      case '0':
        // Similar to O
        path.push({ x: centerX, y: centerY - h2, type: 'move' });
        path.push({ 
          x: centerX + w2, 
          y: centerY, 
          centerX: centerX + w2/2, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        path.push({ 
          x: centerX, 
          y: centerY + h2, 
          centerX: centerX + w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        path.push({ 
          x: centerX - w2, 
          y: centerY, 
          centerX: centerX - w2/2, 
          centerY: centerY + h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        path.push({ 
          x: centerX, 
          y: centerY - h2, 
          centerX: centerX - w2/2, 
          centerY: centerY - h2/2, 
          type: 'arc', 
          clockwise: true 
        });
        // Add diagonal line
        path.push({ x: centerX - w2/2, y: centerY - h2/2, type: 'move' });
        path.push({ x: centerX + w2/2, y: centerY + h2/2, type: 'line' });
        break;
        
      // Default for any other character - simple rectangle outline
      default:
        // Top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'move' });
        // Top right
        path.push({ x: centerX + w2, y: centerY - h2, type: 'line' });
        // Bottom right
        path.push({ x: centerX + w2, y: centerY + h2, type: 'line' });
        // Bottom left
        path.push({ x: centerX - w2, y: centerY + h2, type: 'line' });
        // Back to top left
        path.push({ x: centerX - w2, y: centerY - h2, type: 'line' });
        break;
        }
        
        // Return the path and actual width
        return {
          path: path,
          width: actualWidth
        };
      }
  
  handleMouseDown(event) {
    // Special handling for text tool
    if (this.currentTool === 'text') {
      console.log('Text tool activated, handling click event');
      
      const rect = this.container.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      
      // Convert to world coordinates
      const worldPoint = this.screenToWorld(x, y);
      
      // Snap to grid
      const snappedPoint = this.snapToGrid(worldPoint);
      
      // Save these for later use when the dialog is confirmed
      this._pendingTextPosition = snappedPoint;
      
      // Show the text input dialog
      this.showTextInputDialog((textContent) => {
        if (!textContent || textContent.trim() === '') {
          console.log('Text input was empty or cancelled');
          return;
        }
        
        console.log(`Creating text: "${textContent}" at position:`, snappedPoint);
        
        // Create text element
        const screenPos = this.worldToScreen(snappedPoint.x, snappedPoint.y);
        const textVisual = this.two.makeText(textContent, screenPos.x, screenPos.y);
        
        // Style the text
        textVisual.fill = '#2ecc71'; // Green color
        textVisual.size = this.textSize || 20; // Use the configurable text size or default
        textVisual.family = this.textFont || 'Arial';
        
        // Create element object
        const element = {
          type: 'text',
          text: textContent,
          position: { ...snappedPoint },
          depth: this.cutDepth,
          operation: this.operationType,
          size: this.textSize || 20,
          font: this.textFont || 'Arial',
          visual: textVisual
        };
        
        // Add to drawing group and elements array
        this.drawingGroup.add(textVisual);
        this.elements.push(element);
        this.two.update();
        
        // Update status
        const statusMessage = document.getElementById('cad-status-message');
        if (statusMessage) {
          statusMessage.textContent = `Added text: "${textContent}"`;
        }
        
        console.log(`Successfully added text "${textContent}" to elements array`);
      });
      return;
    }
    
    if (this.currentTool === 'select') {
      this.handleSelectTool(event);
      return;
    }
    
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to world coordinates
    const worldPoint = this.screenToWorld(x, y);
    
    // Snap to grid
    const snappedPoint = this.snapToGrid(worldPoint);
    
    this.isDrawing = true;
    this.startPoint = snappedPoint;
    
    // Create temporary element based on current tool
    if (this.currentTool === 'line') {
      // Create temporary line
      const screenStart = this.worldToScreen(snappedPoint.x, snappedPoint.y);
      this.tempElement = this.two.makeLine(
        screenStart.x, screenStart.y,
        screenStart.x, screenStart.y
      );
      this.tempElement.stroke = '#3498db';
      this.tempElement.linewidth = 2;
      this.tempGroup.add(this.tempElement);
    } else if (this.currentTool === 'rectangle') {
      // Create temporary rectangle
      const screenStart = this.worldToScreen(snappedPoint.x, snappedPoint.y);
      this.tempElement = this.two.makeRectangle(
        screenStart.x, screenStart.y, 0, 0
      );
      this.tempElement.stroke = '#3498db';
      this.tempElement.linewidth = 2;
      this.tempElement.noFill();
      this.tempGroup.add(this.tempElement);
    } else if (this.currentTool === 'circle') {
      // Create temporary circle
      const screenStart = this.worldToScreen(snappedPoint.x, snappedPoint.y);
      this.tempElement = this.two.makeCircle(
        screenStart.x, screenStart.y, 0
      );
      this.tempElement.stroke = '#3498db';
      this.tempElement.linewidth = 2;
      this.tempElement.noFill();
      this.tempGroup.add(this.tempElement);
      
      // Log for debugging
      console.log('Circle created at', screenStart.x, screenStart.y);
    }
    
    this.two.update();
    
    // Update status message
    const statusMessage = document.getElementById('cad-status-message');
    if (statusMessage) {
      statusMessage.textContent = `Drawing: ${this.currentTool} at depth: ${this.cutDepth}mm`;
    }
  }

  setTool(tool) {
    console.log('Setting tool to:', tool);
    this.currentTool = tool;
    
    // Deselect element when switching tools
    if (tool !== 'select') {
      this.selectedElement = null;
      this.updateAllVisuals();
    }
    
    // Update status message
    const statusMessage = document.getElementById('cad-status-message');
    if (statusMessage) {
      statusMessage.textContent = `Selected tool: ${tool}`;
    }
  }
  
  showTextInputDialog(callback) {
    const modal = document.getElementById('text-input-modal-overlay');
    const inputField = document.getElementById('text-input-value');
    const confirmBtn = document.getElementById('confirm-text-btn');
    const cancelBtn = document.getElementById('cancel-text-btn');
    const closeBtn = document.getElementById('close-text-modal');
    
    // Clear previous input
    inputField.value = '';
    
    // Show modal
    modal.classList.add('active');
    
    // Focus input field
    setTimeout(() => {
      inputField.focus();
    }, 100);
    
    // Handle confirm button click
    const handleConfirm = () => {
      const text = inputField.value;
      modal.classList.remove('active');
      
      // Remove event listeners
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      closeBtn.removeEventListener('click', handleCancel);
      inputField.removeEventListener('keyup', handleKeyup);
      
      // Call callback with text value
      callback(text);
    };
    
    // Handle cancel button click
    const handleCancel = () => {
      modal.classList.remove('active');
      
      // Remove event listeners
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
      closeBtn.removeEventListener('click', handleCancel);
      inputField.removeEventListener('keyup', handleKeyup);
      
      // Call callback with null to indicate cancellation
      callback(null);
    };
    
    // Handle Enter key press
    const handleKeyup = (e) => {
      if (e.key === 'Enter') {
        handleConfirm();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    };
    
    // Add event listeners
    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    inputField.addEventListener('keyup', handleKeyup);
  }

  handleMouseMove(event) {
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to world coordinates
    const worldPoint = this.screenToWorld(x, y);
    
    // Snap to grid
    const snappedPoint = this.snapToGrid(worldPoint);
    
    // Handle element dragging
    if (this.isDraggingElement && this.selectedElement && this.dragStartPoint) {
      // Calculate drag delta
      const deltaX = snappedPoint.x - this.dragStartPoint.x;
      const deltaY = snappedPoint.y - this.dragStartPoint.y;
      
      // Update element position based on type
      if (this.selectedElement.type === 'circle') {
        this.selectedElement.center.x = this.elementStartPosition.x + deltaX;
        this.selectedElement.center.y = this.elementStartPosition.y + deltaY;
        
        // Update visual
        const screenPos = this.worldToScreen(this.selectedElement.center.x, this.selectedElement.center.y);
        this.selectedElement.visual.translation.set(screenPos.x, screenPos.y);
      } else if (this.selectedElement.type === 'rectangle') {
        this.selectedElement.center.x = this.elementStartPosition.x + deltaX;
        this.selectedElement.center.y = this.elementStartPosition.y + deltaY;
        
        // Update visual
        const screenPos = this.worldToScreen(this.selectedElement.center.x, this.selectedElement.center.y);
        this.selectedElement.visual.translation.set(screenPos.x, screenPos.y);
      } else if (this.selectedElement.type === 'line') {
        // Move both start and end points
        this.selectedElement.start.x = this.elementStartPosition.start.x + deltaX;
        this.selectedElement.start.y = this.elementStartPosition.start.y + deltaY;
        this.selectedElement.end.x = this.elementStartPosition.end.x + deltaX;
        this.selectedElement.end.y = this.elementStartPosition.end.y + deltaY;
        
        // Update visual
        const screenStart = this.worldToScreen(this.selectedElement.start.x, this.selectedElement.start.y);
        const screenEnd = this.worldToScreen(this.selectedElement.end.x, this.selectedElement.end.y);
        
        this.selectedElement.visual.vertices[0].x = screenStart.x;
        this.selectedElement.visual.vertices[0].y = screenStart.y;
        this.selectedElement.visual.vertices[1].x = screenEnd.x;
        this.selectedElement.visual.vertices[1].y = screenEnd.y;
      } else if (this.selectedElement.type === 'text') {
        this.selectedElement.position.x = this.elementStartPosition.x + deltaX;
        this.selectedElement.position.y = this.elementStartPosition.y + deltaY;
        
        // Update visual
        const screenPos = this.worldToScreen(this.selectedElement.position.x, this.selectedElement.position.y);
        this.selectedElement.visual.translation.set(screenPos.x, screenPos.y);
      }
      
      this.two.update();
      return;
    }
    
    // Handle element resizing
    if (this.isResizingElement && this.selectedElement && this.resizeHandle && this.resizeStartPoint) {
      // Calculate resize delta
      const deltaX = snappedPoint.x - this.resizeStartPoint.x;
      const deltaY = snappedPoint.y - this.resizeStartPoint.y;
      
      if (this.selectedElement.type === 'circle' && this.resizeHandle.id === 'radius') {
        // Calculate new radius
        const center = this.selectedElement.center;
        const dx = snappedPoint.x - center.x;
        const dy = snappedPoint.y - center.y;
        const newRadius = Math.sqrt(dx * dx + dy * dy);
        
        // Update radius (minimum value 0.5)
        this.selectedElement.radius = Math.max(0.5, newRadius);
        
        // Update visual
        const screenRadius = this.selectedElement.radius * 10;
        this.selectedElement.visual.radius = screenRadius;
      } else if (this.selectedElement.type === 'rectangle') {
        const center = this.selectedElement.center;
        let newWidth = this.selectedElement.width;
        let newHeight = this.selectedElement.height;
        
        // Handle different resize handles
        if (this.resizeHandle.id === 'right') {
          const dx = snappedPoint.x - center.x;
          newWidth = Math.max(1, Math.abs(dx) * 2);
        } else if (this.resizeHandle.id === 'left') {
          const dx = center.x - snappedPoint.x;
          newWidth = Math.max(1, Math.abs(dx) * 2);
        } else if (this.resizeHandle.id === 'top') {
          const dy = center.y - snappedPoint.y;
          newHeight = Math.max(1, Math.abs(dy) * 2);
        } else if (this.resizeHandle.id === 'bottom') {
          const dy = snappedPoint.y - center.y;
          newHeight = Math.max(1, Math.abs(dy) * 2);
        } else if (this.resizeHandle.id.includes('top') && this.resizeHandle.id.includes('right')) {
          const dx = snappedPoint.x - center.x;
          const dy = center.y - snappedPoint.y;
          newWidth = Math.max(1, Math.abs(dx) * 2);
          newHeight = Math.max(1, Math.abs(dy) * 2);
        } else if (this.resizeHandle.id.includes('top') && this.resizeHandle.id.includes('left')) {
          const dx = center.x - snappedPoint.x;
          const dy = center.y - snappedPoint.y;
          newWidth = Math.max(1, Math.abs(dx) * 2);
          newHeight = Math.max(1, Math.abs(dy) * 2);
        } else if (this.resizeHandle.id.includes('bottom') && this.resizeHandle.id.includes('right')) {
          const dx = snappedPoint.x - center.x;
          const dy = snappedPoint.y - center.y;
          newWidth = Math.max(1, Math.abs(dx) * 2);
          newHeight = Math.max(1, Math.abs(dy) * 2);
        } else if (this.resizeHandle.id.includes('bottom') && this.resizeHandle.id.includes('left')) {
          const dx = center.x - snappedPoint.x;
          const dy = snappedPoint.y - center.y;
          newWidth = Math.max(1, Math.abs(dx) * 2);
          newHeight = Math.max(1, Math.abs(dy) * 2);
        }
        
        // Update width and height
        this.selectedElement.width = newWidth;
        this.selectedElement.height = newHeight;
        
        // Update visual
        const screenWidth = newWidth * 10;
        const screenHeight = newHeight * 10;
        this.selectedElement.visual.width = screenWidth;
        this.selectedElement.visual.height = screenHeight;
      } else if (this.selectedElement.type === 'line') {
        if (this.resizeHandle.id === 'start') {
          this.selectedElement.start.x = snappedPoint.x;
          this.selectedElement.start.y = snappedPoint.y;
          
          // Update visual
          const screenStart = this.worldToScreen(snappedPoint.x, snappedPoint.y);
          this.selectedElement.visual.vertices[0].x = screenStart.x;
          this.selectedElement.visual.vertices[0].y = screenStart.y;
        } else if (this.resizeHandle.id === 'end') {
          this.selectedElement.end.x = snappedPoint.x;
          this.selectedElement.end.y = snappedPoint.y;
          
          // Update visual
          const screenEnd = this.worldToScreen(snappedPoint.x, snappedPoint.y);
          this.selectedElement.visual.vertices[1].x = screenEnd.x;
          this.selectedElement.visual.vertices[1].y = screenEnd.y;
        }
      } else if (this.selectedElement.type === 'text' && this.resizeHandle.id === 'size') {
        // Calculate distance from position to current point
        const position = this.selectedElement.position;
        const dx = snappedPoint.x - position.x;
        
        // Update text size based on width
        // Width in mm = text length * (size in px) * 0.6 / 10
        // So size in px = width in mm * 10 / (text length * 0.6)
        const textLength = this.selectedElement.text.length;
        if (textLength > 0) {
          const widthInMm = Math.abs(dx) * 2; // Double the distance for full width
          const newSize = Math.max(8, (widthInMm * 10) / (textLength * 0.6));
          
          // Update size (cap at reasonable values)
          this.selectedElement.size = Math.min(100, Math.round(newSize));
          
          // Update visual
          this.selectedElement.visual.size = this.selectedElement.size;
          
          // Also update the text size input
          const textSizeInput = document.getElementById('cad-text-size');
          if (textSizeInput) {
            textSizeInput.value = this.selectedElement.size;
          }
        }
      }
      
      this.two.update();
      return;
    }
    
    // Original mouse move behavior for drawing tools
    if (!this.isDrawing || !this.tempElement) return;
    
    // Code for drawing tools remains the same...
    if (this.currentTool === 'line') {
      // Update line end point
      const screenEnd = this.worldToScreen(snappedPoint.x, snappedPoint.y);
      this.tempElement.vertices[1].x = screenEnd.x;
      this.tempElement.vertices[1].y = screenEnd.y;
    } else if (this.currentTool === 'rectangle') {
      // Update rectangle size and position
      const screenStart = this.worldToScreen(this.startPoint.x, this.startPoint.y);
      const screenEnd = this.worldToScreen(snappedPoint.x, snappedPoint.y);
      
      const width = Math.abs(screenEnd.x - screenStart.x);
      const height = Math.abs(screenEnd.y - screenStart.y);
      
      // Position is the center of the rectangle
      const centerX = (screenStart.x + screenEnd.x) / 2;
      const centerY = (screenStart.y + screenEnd.y) / 2;
      
      this.tempElement.width = width;
      this.tempElement.height = height;
      this.tempElement.translation.set(centerX, centerY);
    } else if (this.currentTool === 'circle') {
      // Get screen coordinates
      const screenStart = this.worldToScreen(this.startPoint.x, this.startPoint.y);
      const screenEnd = this.worldToScreen(snappedPoint.x, snappedPoint.y);
      
      // Calculate distance (radius)
      const dx = screenEnd.x - screenStart.x;
      const dy = screenEnd.y - screenStart.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      
      // Update circle radius
      this.tempElement.radius = radius;
    }
    
    this.two.update();
  }
  
  handleMouseUp(event) {
    if (!this.isDrawing) return;
    
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to world coordinates
    const worldPoint = this.screenToWorld(x, y);
    
    // Snap to grid
    const snappedPoint = this.snapToGrid(worldPoint);
    
    // Only create if points are different
    const isDifferentPoints = 
      this.startPoint.x !== snappedPoint.x || 
      this.startPoint.y !== snappedPoint.y;
    
    // Finalize drawing based on current tool
    let element = null; // Define element variable at the top level
    
    if (isDifferentPoints) {
      if (this.currentTool === 'line') {
        element = {
          type: 'line',
          start: { ...this.startPoint },
          end: { ...snappedPoint },
          depth: this.cutDepth,
          operation: this.operationType,
          visual: null
        };
        
        // Create final line
        const screenStart = this.worldToScreen(this.startPoint.x, this.startPoint.y);
        const screenEnd = this.worldToScreen(snappedPoint.x, snappedPoint.y);
        const line = this.two.makeLine(
          screenStart.x, screenStart.y,
          screenEnd.x, screenEnd.y
        );
        
        element.visual = line;
        this.updateElementVisual(element);
        this.drawingGroup.add(line);
        
      } else if (this.currentTool === 'rectangle') {
        // Calculate rectangle parameters
        const minX = Math.min(this.startPoint.x, snappedPoint.x);
        const minY = Math.min(this.startPoint.y, snappedPoint.y);
        const maxX = Math.max(this.startPoint.x, snappedPoint.x);
        const maxY = Math.max(this.startPoint.y, snappedPoint.y);
        const width = maxX - minX;
        const height = maxY - minY;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        
        element = {
          type: 'rectangle',
          center: { x: centerX, y: centerY },
          width: width,
          height: height,
          depth: this.cutDepth,
          operation: this.operationType,
          visual: null
        };
        
        // Create final rectangle
        const screenCenter = this.worldToScreen(centerX, centerY);
        const screenWidth = width * 10;
        const screenHeight = height * 10;
        
        const rect = this.two.makeRectangle(
          screenCenter.x, screenCenter.y,
          screenWidth, screenHeight
        );
        
        element.visual = rect;
        this.updateElementVisual(element);
        this.drawingGroup.add(rect);
        
      } else if (this.currentTool === 'circle') {
        // Calculate circle parameters
        const dx = snappedPoint.x - this.startPoint.x;
        const dy = snappedPoint.y - this.startPoint.y;
        const radius = Math.sqrt(dx * dx + dy * dy);
        
        // Only create if radius is greater than zero
        if (radius > 0) {
          element = {
            type: 'circle',
            center: { ...this.startPoint },
            radius: radius,
            depth: this.cutDepth,
            operation: this.operationType,
            visual: null
          };
          
          // Create final circle
          const screenCenter = this.worldToScreen(this.startPoint.x, this.startPoint.y);
          const screenRadius = radius * 10;
          
          const circle = this.two.makeCircle(
            screenCenter.x, screenCenter.y,
            screenRadius
          );
          circle.noFill();
          circle.stroke = '#2ecc71';
          
          element.visual = circle;
          this.updateElementVisual(element);
          this.drawingGroup.add(circle);
          
          // Log for debugging
          console.log('Circle finalized:', element);
        }
      }
      
      // Only add element to elements array if it was created
      if (element) {
        this.elements.push(element);
        console.log(`Added ${element.type} to elements array, count: ${this.elements.length}`);
      }
    }
    
    // Only preview circles if a circle element was created
    if (isDifferentPoints && this.currentTool === 'circle' && element) {
      // Use setTimeout to ensure the element is fully added to the array first
      setTimeout(() => this.previewCircles(), 100);
    }
    
    // Clean up
    this.isDrawing = false;
    this.startPoint = null;
    if (this.tempElement) {
      this.tempGroup.remove(this.tempElement);
      this.tempElement = null;
    }
    
    this.two.update();
    
    // Update status message
    const statusMessage = document.getElementById('cad-status-message');
    if (statusMessage) {
      statusMessage.textContent = `Ready - ${this.elements.length} element(s)`;
    }
  }

  
  
  handleSelectTool(event) {
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to world coordinates
    const worldPoint = this.screenToWorld(x, y);
    
    // If we're already in the middle of a drag operation
    if (this.isDraggingElement && this.selectedElement) {
      // End dragging
      this.isDraggingElement = false;
      this.dragStartPoint = null;
      
      // Update status message
      const statusMessage = document.getElementById('cad-status-message');
      if (statusMessage) {
        statusMessage.textContent = `Element moved to X:${this.selectedElement.position ? this.selectedElement.position.x.toFixed(2) : 'N/A'} Y:${this.selectedElement.position ? this.selectedElement.position.y.toFixed(2) : 'N/A'}`;
      }
      return;
    }
    
    // If we're already in the middle of a resize operation
    if (this.isResizingElement && this.selectedElement) {
      // End resizing
      this.isResizingElement = false;
      this.resizeStartPoint = null;
      this.resizeHandle = null;
      
      // Update status message
      const statusMessage = document.getElementById('cad-status-message');
      if (statusMessage) {
        statusMessage.textContent = `Element resized`;
      }
      return;
    }
    
    // Check if we're clicking on a resize handle of the currently selected element
    if (this.selectedElement) {
      const handle = this.getResizeHandleAtPoint(worldPoint);
      if (handle) {
        this.isResizingElement = true;
        this.resizeStartPoint = worldPoint;
        this.resizeHandle = handle;
        
        // Update status message
        const statusMessage = document.getElementById('cad-status-message');
        if (statusMessage) {
          statusMessage.textContent = `Resizing ${this.selectedElement.type}...`;
        }
        return;
      }
    }
    
    // Find clicked element
    const clickedElement = this.findElementAt(worldPoint);
    
    // If we clicked on an element
    if (clickedElement) {
      // Select the element
      this.selectedElement = clickedElement;
      
      // Start dragging
      this.isDraggingElement = true;
      this.dragStartPoint = worldPoint;
      this.elementStartPosition = this.getElementPosition(clickedElement);
      
      // Update UI based on selection
      console.log('Element selected for dragging:', this.selectedElement);
      
      // Update depth input
      const depthInput = document.getElementById('cad-cut-depth');
      if (depthInput) {
        depthInput.value = this.selectedElement.depth;
      }
      
      // Update operation type
      const operationSelect = document.getElementById('cad-operation-select');
      if (operationSelect) {
        operationSelect.value = this.selectedElement.operation;
      }
      
      // Highlight selected element
      this.updateAllVisuals();
      
      // Update status message
      const statusMessage = document.getElementById('cad-status-message');
      if (statusMessage) {
        statusMessage.textContent = `Selected ${this.selectedElement.type} - dragging...`;
      }
    } else {
      // Deselect if clicking on empty space
      this.selectedElement = null;
      this.updateAllVisuals();
      
      // Update status message
      const statusMessage = document.getElementById('cad-status-message');
      if (statusMessage) {
        statusMessage.textContent = 'No element selected';
      }
    }
  }

  getElementPosition(element) {
    if (element.type === 'circle') {
      return { ...element.center };
    } else if (element.type === 'rectangle') {
      return { ...element.center };
    } else if (element.type === 'line') {
      return {
        start: { ...element.start },
        end: { ...element.end }
      };
    } else if (element.type === 'text') {
      return { ...element.position };
    }
    return null;
  }

  getResizeHandleAtPoint(point) {
    if (!this.selectedElement) return null;
    
    // Define handle positions based on element type
    let handles = [];
    
    if (this.selectedElement.type === 'circle') {
      const center = this.selectedElement.center;
      const radius = this.selectedElement.radius;
      
      // Add a handle at the edge of the circle (east point)
      handles.push({
        x: center.x + radius,
        y: center.y,
        id: 'radius'
      });
    } else if (this.selectedElement.type === 'rectangle') {
      const center = this.selectedElement.center;
      const halfWidth = this.selectedElement.width / 2;
      const halfHeight = this.selectedElement.height / 2;
      
      // Add handles at the corners and sides
      handles = [
        { x: center.x - halfWidth, y: center.y - halfHeight, id: 'top-left' },
        { x: center.x + halfWidth, y: center.y - halfHeight, id: 'top-right' },
        { x: center.x - halfWidth, y: center.y + halfHeight, id: 'bottom-left' },
        { x: center.x + halfWidth, y: center.y + halfHeight, id: 'bottom-right' },
        { x: center.x, y: center.y - halfHeight, id: 'top' },
        { x: center.x, y: center.y + halfHeight, id: 'bottom' },
        { x: center.x - halfWidth, y: center.y, id: 'left' },
        { x: center.x + halfWidth, y: center.y, id: 'right' }
      ];
    } else if (this.selectedElement.type === 'line') {
      // Add handles at the endpoints
      handles = [
        { ...this.selectedElement.start, id: 'start' },
        { ...this.selectedElement.end, id: 'end' }
      ];
    } else if (this.selectedElement.type === 'text') {
      // For text, allow resizing by dragging the right side
      const position = this.selectedElement.position;
      const width = (this.selectedElement.text.length * (this.selectedElement.size || 20) * 0.6) / 10;
      
      handles.push({
        x: position.x + width/2,
        y: position.y,
        id: 'size'
      });
    }
    
    // Check if point is near any handle
    // Increased tolerance to make handles easier to grab
    const tolerance = 1.0; // 1 grid unit tolerance (increased from 0.5)
    console.log('Checking for handle near', point.x, point.y, 'with tolerance', tolerance);
    
    for (const handle of handles) {
      const dx = point.x - handle.x;
      const dy = point.y - handle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      console.log('Handle', handle.id, 'at', handle.x, handle.y, 'distance:', distance);
      
      if (distance <= tolerance) {
        console.log('Found handle:', handle.id);
        return handle;
      }
    }
    
    console.log('No handle found');
    return null;
  }
  
  

  previewCircles() {
    // Extract all circles from the elements array
    const circleElements = this.elements.filter(elem => elem.type === 'circle');
    
    if (circleElements.length === 0) {
      console.log('No circles to preview');
      return;
    }
    
    // Convert to the format expected by the visualizer
    const circles = circleElements.map(elem => ({
      center: {
        x: elem.center.x,
        y: elem.center.y,
        z: elem.depth || 0  // Use the cut depth as Z coordinate
      },
      radius: elem.radius
    }));
    
    // Prepare visualization data
    const visualizationData = {
      segments: [], // Empty for now
      rapids: [],   // Empty for now
      circles: circles,
      bounds: {
        min: { 
          x: Math.min(...circles.map(c => c.center.x - c.radius)),
          y: Math.min(...circles.map(c => c.center.y - c.radius)),
          z: Math.min(...circles.map(c => c.center.z))
        },
        max: {
          x: Math.max(...circles.map(c => c.center.x + c.radius)),
          y: Math.max(...circles.map(c => c.center.y + c.radius)),
          z: Math.max(...circles.map(c => c.center.z))
        }
      }
    };
    
    // Call the visualization handler
    if (typeof window.handleGcodeVisualization === 'function') {
      window.handleGcodeVisualization(visualizationData);
      console.log('Circle preview sent to visualizer:', circles);
    } else {
      console.error('Visualizer not available');
    }
  }
  
  findElementAt(point) {
    // Tolerance for selection in world units
    const tolerance = 1; 
    
    for (let i = this.elements.length - 1; i >= 0; i--) {
      const element = this.elements[i];
      
      if (element.type === 'line') {
        // Check if point is close to the line
        if (this.isPointNearLine(point, element.start, element.end, tolerance)) {
          return element;
        }
      } else if (element.type === 'rectangle') {
        // Check if point is inside the rectangle
        const halfWidth = element.width / 2;
        const halfHeight = element.height / 2;
        
        if (
          point.x >= element.center.x - halfWidth - tolerance &&
          point.x <= element.center.x + halfWidth + tolerance &&
          point.y >= element.center.y - halfHeight - tolerance &&
          point.y <= element.center.y + halfHeight + tolerance
        ) {
          return element;
        }
      } else if (element.type === 'circle') {
        // Check if point is near the circle circumference
        const dx = point.x - element.center.x;
        const dy = point.y - element.center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (Math.abs(distance - element.radius) <= tolerance) {
          return element;
        }
      }
      else if (element.type === 'text') {
        // Calculate approximate text dimensions based on text length and size
        const textWidth = element.text.length * (element.size / 10) * 0.6;
        const textHeight = element.size / 10;
        
        // Check if point is within text bounding box
        if (
          point.x >= element.position.x - textWidth/2 - tolerance &&
          point.x <= element.position.x + textWidth/2 + tolerance &&
          point.y >= element.position.y - textHeight/2 - tolerance &&
          point.y <= element.position.y + textHeight/2 + tolerance
        ) {
          return element;
        }
      }
      
    }
    
    return null;
  }
  
  convertTextToPaths(text, x, y, size, font) {
    console.log(`Converting text "${text}" to paths`);
    const paths = [];
    let offsetX = 0;
    
    for (let i = 0; i < text.length; i++) {
      // Each character is approximated as a small rectangle
      const charWidth = size * 0.6;
      paths.push({
        type: 'rectangle',
        center: { x: x + offsetX + charWidth/2, y: y },
        width: charWidth,
        height: size
      });
      offsetX += charWidth;
    }
    
    return paths;
  }

  isPointNearLine(point, lineStart, lineEnd, tolerance) {
    // Calculate the distance from point to line
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    // Avoid division by zero
    if (length === 0) return false;
    
    // Calculate the normalized perpendicular distance
    const nx = -dy / length;
    const ny = dx / length;
    
    const perpDistance = Math.abs(
      (point.x - lineStart.x) * nx + (point.y - lineStart.y) * ny
    );
    
    // Calculate projection of point onto line
    const dotProduct = 
      (point.x - lineStart.x) * dx + 
      (point.y - lineStart.y) * dy;
    const projectionRatio = dotProduct / (length * length);
    
    // Check if point is within line segment (with tolerance)
    if (projectionRatio < -tolerance || projectionRatio > 1 + tolerance) {
      return false;
    }
    
    return perpDistance <= tolerance;
  }
  
updateElementVisual(element) {
  if (!element || !element.visual) return;
  
  // Existing code for visual update...
  element.visual.noFill();
  
  // Determine stroke based on operation type
  switch (element.operation) {
    case 'profile':
      element.visual.stroke = '#e74c3c'; // Red
      element.visual.dashes = []; // Solid line
      break;
    case 'pocket':
      element.visual.stroke = '#3498db'; // Blue
      element.visual.dashes = [5, 3]; // Dashed line
      break;
    case 'drill':
      element.visual.stroke = '#2ecc71'; // Green
      element.visual.dashes = [2, 2]; // Dotted line
      break;
    default:
      element.visual.stroke = '#2c3e50'; // Dark blue
      break;
  }
  
  const depthFactor = Math.min(Math.abs(element.depth) / 5, 1);
  const lineWidth = 1 + (depthFactor * 3);
  element.visual.linewidth = lineWidth;
  
  // Highlight if selected
  if (this.selectedElement === element) {
    element.visual.stroke = '#f39c12'; // Orange for selected element
    element.visual.linewidth += 1;
    
    // Draw resize handles when element is selected
    this.drawResizeHandles();
  }
  
  this.two.update();
}
  
updateAllVisuals() {
  // Remove any existing resize handles
  if (this.resizeHandlesGroup) {
    this.two.remove(this.resizeHandlesGroup);
    this.resizeHandlesGroup = null;
  }
  
  this.elements.forEach(element => {
    this.updateElementVisual(element);
  });
}
  
  clearDrawing() {
    // Remove all elements from the drawing group
    while (this.drawingGroup.children.length > 0) {
      this.drawingGroup.remove(this.drawingGroup.children[0]);
    }
    
    // Clear elements array
    this.elements = [];
    this.selectedElement = null;
    
    this.two.update();
    
    // Update status
    const statusMessage = document.getElementById('cad-status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Drawing cleared';
    }
    
    console.log('Drawing cleared');
  }
  
  drawGrid() {
    if (!this.two) return;
    
    const width = this.two.width;
    const height = this.two.height;
    
    // Draw grid
    const gridSizePixels = this.gridSize * 10;
    
    // Horizontal lines
    for (let y = this.centerY % gridSizePixels; y < height; y += gridSizePixels) {
      const line = this.two.makeLine(0, y, width, y);
      line.stroke = '#ddd';
      line.linewidth = 0.5;
      this.gridGroup.add(line);
    }
    
    // Vertical lines
    for (let x = this.centerX % gridSizePixels; x < width; x += gridSizePixels) {
      const line = this.two.makeLine(x, 0, x, height);
      line.stroke = '#ddd';
      line.linewidth = 0.5;
      this.gridGroup.add(line);
    }
    
    // Draw axes
    const xAxis = this.two.makeLine(0, this.centerY, width, this.centerY);
    xAxis.stroke = '#f00';
    xAxis.linewidth = 1;
    this.gridGroup.add(xAxis);
    
    const yAxis = this.two.makeLine(this.centerX, 0, this.centerX, height);
    yAxis.stroke = '#00f';
    yAxis.linewidth = 1;
    this.gridGroup.add(yAxis);
    
    this.two.update();
  }
  
  clearGrid() {
    // Remove all grid elements
    while (this.gridGroup.children.length > 0) {
      this.gridGroup.remove(this.gridGroup.children[0]);
    }
    this.two.update();
  }
  
  generateGCode() {
    if (this.elements.length === 0) {
      console.log('No elements to generate G-code from');
      // Display a message to the user
      if (this.appState && this.appState.addConsoleMessage) {
        this.appState.addConsoleMessage('error', 'No elements to generate G-code from');
      }
      
      // Update status
      const statusMessage = document.getElementById('cad-status-message');
      if (statusMessage) {
        statusMessage.textContent = 'Error: No elements to generate G-code from';
      }
      
      return;
    }
    
    // Update status
    const statusMessage = document.getElementById('cad-status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Generating G-code...';
    }
    
    // Generate G-code with 2.5D operations
    const gcode = this.generate25DGCode(this.elements);
    
    // Create a download link for the G-code
    const filename = `cad_drawing_${new Date().toISOString().replace(/[:.]/g, '-')}.gcode`;
    this.saveGCodeToFile(gcode, filename);
    
    // Show success message
    if (this.appState && this.appState.addConsoleMessage) {
      this.appState.addConsoleMessage('system', `G-code saved as ${filename}`);
      this.appState.addConsoleMessage('system', 'You can now load this file in the G-code tab');
    }
    
    // Update status
    if (statusMessage) {
      statusMessage.textContent = `G-code saved as ${filename}`;
    }
  
    // Optionally switch to G-code tab
    const tabButtons = document.querySelectorAll('.tab-button');
    const gcodeTabButton = Array.from(tabButtons).find(button => button.getAttribute('data-tab') === 'gcode');
    if (gcodeTabButton) {
      gcodeTabButton.click();
    }
  }

generate25DGCode(elements) {
  // Default settings
  const safeZ = 5;
  const feedRate = this.feedRate;
  const plungeRate = Math.min(this.feedRate / 2, 200); // Half feed rate or 200, whichever is lower
  const stepDown = this.stepDown;
  
  let gcode = [];

  // Add header
  gcode.push("; G-code generated from 2.5D CAD drawing");
  gcode.push("; Generated on " + new Date().toLocaleString());
  gcode.push("; Operations: " + elements.length);
  gcode.push("");
  gcode.push("G21 ; Set units to millimeters");
  gcode.push("G90 ; Absolute positioning");
  gcode.push("G94 ; Feed rate in units per minute");
  gcode.push(`G0 Z${safeZ} F${feedRate*2} ; Move to safe height`);
  gcode.push("");

  // Sort elements by operation type
  const sortedElements = [...elements].sort((a, b) => {
    // Sort by operation first
    if (a.operation !== b.operation) {
      const opOrder = { 'drill': 0, 'pocket': 1, 'profile': 2 };
      return opOrder[a.operation] - opOrder[b.operation];
    }
    // Then by depth (deeper cuts later)
    return b.depth - a.depth;
  });

  // Process each element
  for (let i = 0; i < sortedElements.length; i++) {
    const element = sortedElements[i]; // Make sure we're using the element from the loop
    
    gcode.push(`; Operation ${i+1}: ${element.operation.toUpperCase()} - ${element.type.toUpperCase()}`);
    gcode.push(`; Depth: ${element.depth} mm`);
    
    if (element.type === 'text') {
      gcode.push(`; Operation ${i+1}: ${element.operation.toUpperCase()} - TEXT OUTLINE`);
      gcode.push(`; Text: "${element.text}"`);
      gcode.push(`; Position: X${element.position.x.toFixed(3)}, Y${element.position.y.toFixed(3)}`);
      gcode.push(`; Depth: ${element.depth} mm`);
      
      // Calculate text metrics
      const charWidth = (element.size || 20) * 0.6 / 10; // Convert pixel size to mm
      const charHeight = (element.size || 20) / 10; // Convert pixel size to mm
      const spacing = charWidth * 0.2; // Space between characters
      const textGcode = this.generateTextGcode(element, safeZ, plungeRate, feedRate, stepDown);
      // Generate G-code for each character (as outlines)
      let xOffset = 0;
      for (let charIndex = 0; charIndex < element.text.length; charIndex++) {
        const char = element.text[charIndex];
        
        // Skip spaces
        if (char === ' ') {
          xOffset += charWidth;
          continue;
        }
        
        // Calculate character position (center of character)
        const charPosition = {
          x: element.position.x - ((element.text.length * (charWidth + spacing)) / 2) + xOffset + (charWidth / 2),
          y: element.position.y
        };
        
        gcode.push(`; Character: ${char}`);
        
        // Generate an approximated outline for each character
        // Move to starting point at safe height
        gcode.push(`G0 Z${safeZ} ; Raise to safe height`);
        
        // Begin character outline
        // We'll create a simple rectangular outline with rounded corners for each character
        
        // Plunge to cutting depth
        gcode.push(`G0 X${charPosition.x - charWidth/2} Y${charPosition.y - charHeight/2} ; Move to bottom-left of character`);
        gcode.push(`G1 Z${element.depth} F${plungeRate} ; Plunge to cutting depth`);
        
        // Define corner radius
        const cornerRadius = Math.min(charWidth, charHeight) * 0.2;
        const arcSteps = 8; // Number of segments for rounded corners
        
        // Bottom edge with rounded corners
        gcode.push(`G1 X${charPosition.x + charWidth/2 - cornerRadius} Y${charPosition.y - charHeight/2} F${feedRate} ; Bottom edge`);
        
        // Bottom-right corner (arc)
        for (let step = 0; step < arcSteps; step++) {
          const angle = Math.PI / 2 * (step / arcSteps);
          const x = charPosition.x + charWidth/2 - cornerRadius + cornerRadius * Math.cos(angle);
          const y = charPosition.y - charHeight/2 + cornerRadius - cornerRadius * Math.sin(angle);
          gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate} ; Bottom-right corner arc`);
        }
        
        // Right edge
        gcode.push(`G1 X${charPosition.x + charWidth/2} Y${charPosition.y + charHeight/2 - cornerRadius} F${feedRate} ; Right edge`);
        
        // Top-right corner (arc)
        for (let step = 0; step < arcSteps; step++) {
          const angle = Math.PI / 2 * (step / arcSteps) + Math.PI / 2;
          const x = charPosition.x + charWidth/2 - cornerRadius + cornerRadius * Math.cos(angle);
          const y = charPosition.y + charHeight/2 - cornerRadius + cornerRadius * Math.sin(angle);
          gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate} ; Top-right corner arc`);
        }
        
        // Top edge
        gcode.push(`G1 X${charPosition.x - charWidth/2 + cornerRadius} Y${charPosition.y + charHeight/2} F${feedRate} ; Top edge`);
        
        // Top-left corner (arc)
        for (let step = 0; step < arcSteps; step++) {
          const angle = Math.PI / 2 * (step / arcSteps) + Math.PI;
          const x = charPosition.x - charWidth/2 + cornerRadius + cornerRadius * Math.cos(angle);
          const y = charPosition.y + charHeight/2 - cornerRadius + cornerRadius * Math.sin(angle);
          gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate} ; Top-left corner arc`);
        }
        
        // Left edge
        gcode.push(`G1 X${charPosition.x - charWidth/2} Y${charPosition.y - charHeight/2 + cornerRadius} F${feedRate} ; Left edge`);
        
        // Bottom-left corner (arc)
        for (let step = 0; step < arcSteps; step++) {
          const angle = Math.PI / 2 * (step / arcSteps) + 3 * Math.PI / 2;
          const x = charPosition.x - charWidth/2 + cornerRadius + cornerRadius * Math.cos(angle);
          const y = charPosition.y - charHeight/2 + cornerRadius + cornerRadius * Math.sin(angle);
          gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate} ; Bottom-left corner arc`);
        }
        
        // Close the outline by returning to the starting point
        gcode.push(`G1 X${charPosition.x - charWidth/2} Y${charPosition.y - charHeight/2} F${feedRate} ; Close outline`);
        
        // Update offset for next character
        xOffset += charWidth + spacing;
      }
      
      // Return to safe height after completing all characters
      gcode.push(`G0 Z${safeZ} ; Retract to safe height`);
      gcode = gcode.concat(textGcode);
    }
    else if (element.operation === 'drill') {
      // Generate drilling operation
      if (element.type === 'circle') {
        gcode.push(this.generateDrillOperation(element, safeZ, plungeRate, feedRate, stepDown));
      } else {
        gcode.push("; Warning: Drill operation only supported for circles");
        gcode.push("; Using center point as drill location");
        
        let center;
        if (element.type === 'rectangle') {
          center = element.center;
        } else if (element.type === 'line') {
          center = {
            x: (element.start.x + element.end.x) / 2,
            y: (element.start.y + element.end.y) / 2
          };
        }
        
        if (center) {
          const drillElement = {
            type: 'circle',
            center: center,
            radius: 0.5, // Default small radius
            depth: element.depth,
            operation: 'drill'
          };
          gcode.push(this.generateDrillOperation(drillElement, safeZ, plungeRate, feedRate, stepDown));
        }
      }
    } else if (element.operation === 'pocket') {
      // Generate pocket operation
      if (element.type === 'rectangle') {
        gcode.push(this.generateRectanglePocketOperation(element, safeZ, plungeRate, feedRate, stepDown));
      } else if (element.type === 'circle') {
        gcode.push(this.generateCirclePocketOperation(element, safeZ, plungeRate, feedRate, stepDown));
      } else {
        gcode.push("; Warning: Pocket operation not supported for this shape");
        gcode.push("; Using profile operation instead");
        gcode.push(this.generateProfileOperation(element, safeZ, plungeRate, feedRate, stepDown));
      }
    } else {
      // Default to profile operation
      gcode.push(this.generateProfileOperation(element, safeZ, plungeRate, feedRate, stepDown));
    }
    
    gcode.push(""); // Add blank line between operations
  }

  // Add footer
  gcode.push("; Finish up");
  gcode.push(`G0 Z${safeZ} ; Final return to safe height`);
  gcode.push("G0 X0 Y0 ; Return to origin");
  gcode.push("M5 ; Turn off spindle");
  gcode.push("M30 ; End program");

  return gcode.join('\n');
}

generateDrillOperation(element, safeZ, plungeRate, feedRate, stepDown) {
const lines = [];
const targetDepth = element.depth;
const center = element.center;

// Move to position at safe height
lines.push(`G0 X${center.x} Y${center.y} ; Move to drill position`);

// Perform drilling in steps
let currentDepth = 0;
while (currentDepth > targetDepth) {
  // Calculate next depth
  currentDepth = Math.max(currentDepth - stepDown, targetDepth);
  
  // Plunge to depth
  lines.push(`G1 Z${currentDepth} F${plungeRate} ; Drill to depth ${currentDepth}mm`);
  
  // Small dwell to clear chips
  lines.push("G4 P0.5 ; Dwell for 0.5 seconds");
  
  // Retract slightly for peck drilling if not at final depth
  if (currentDepth > targetDepth) {
    lines.push(`G0 Z${Math.min(currentDepth + 1, 0)} ; Retract for chip clearing`);
  }
}

// Return to safe height
lines.push(`G0 Z${safeZ} ; Retract to safe height`);

return lines.join('\n');
}

generateCirclePocketOperation(element, safeZ, plungeRate, feedRate, stepDown) {
const lines = [];
const targetDepth = element.depth;
const center = element.center;
const radius = element.radius;

// Move to starting position at safe height
lines.push(`G0 X${center.x} Y${center.y} ; Move to circle center`);

// Perform pocketing in depth steps
let currentDepth = 0;
while (currentDepth > targetDepth) {
  // Calculate next depth
  currentDepth = Math.max(currentDepth - stepDown, targetDepth);
  
  // Plunge to depth
  lines.push(`G1 Z${currentDepth} F${plungeRate} ; Plunge to depth ${currentDepth}mm`);
  
  // Spiral out from center
  const spiralSteps = Math.max(10, Math.ceil(radius * 2)); // At least 10 steps for small circles
  const radiusIncrement = radius / spiralSteps;
  
  for (let i = 1; i <= spiralSteps; i++) {
    const spiralRadius = radiusIncrement * i;
    // Add spiral segments (use multiple points to approximate a spiral)
    const segments = 16; // Number of segments per spiral
    
    for (let j = 0; j <= segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      const x = center.x + Math.cos(angle) * spiralRadius;
      const y = center.y + Math.sin(angle) * spiralRadius;
      
      if (j === 0 && i === 1) {
        // First point - move to position
        lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate} ; Start spiral`);
      } else {
        // Continue spiral
        lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} ; Spiral pocket`);
      }
    }
  }
  
  // Do a full circle at the end to clean up the edges
  lines.push(`G1 X${center.x + radius} Y${center.y} F${feedRate} ; Move to edge`);
  lines.push(`G2 X${center.x + radius} Y${center.y} I${-radius} J0 F${feedRate} ; Full circle cleanup`);
}

// Return to center and then to safe height
lines.push(`G1 X${center.x} Y${center.y} F${feedRate} ; Return to center`);
lines.push(`G0 Z${safeZ} ; Retract to safe height`);

return lines.join('\n');
}

generateRectanglePocketOperation(element, safeZ, plungeRate, feedRate, stepDown) {
const lines = [];
const targetDepth = element.depth;
const center = element.center;
const width = element.width;
const height = element.height;

// Calculate corner points
const left = center.x - width/2;
const right = center.x + width/2;
const top = center.y + height/2;
const bottom = center.y - height/2;

// Move to starting position at safe height
lines.push(`G0 X${center.x} Y${center.y} ; Move to rectangle center`);

// Tool diameter for step-over calculation (assumed to be 3mm)
const toolDiameter = 3;
const stepOver = toolDiameter * 0.8; // 80% step-over

// Perform pocketing in depth steps
let currentDepth = 0;
while (currentDepth > targetDepth) {
  // Calculate next depth
  currentDepth = Math.max(currentDepth - stepDown, targetDepth);
  
  // Plunge to depth
  lines.push(`G1 Z${currentDepth} F${plungeRate} ; Plunge to depth ${currentDepth}mm`);
  
  // Calculate number of passes needed
  const numPasses = Math.ceil(Math.min(width, height) / 2 / stepOver);
  
  // Spiral out from center
  for (let i = 1; i <= numPasses; i++) {
    // Calculate inset distance
    const inset = i * stepOver;
    
    // Skip if inset makes rectangle too small
    if (inset * 2 >= width || inset * 2 >= height) break;
    
    // Calculate corners of this pass
    const passLeft = left + inset;
    const passRight = right - inset;
    const passTop = top - inset;
    const passBottom = bottom + inset;
    
    // If this is the first pass, move to starting position
    if (i === 1) {
      lines.push(`G1 X${passLeft} Y${passBottom} F${feedRate} ; Move to start`);
    }
    
    // Do rectangle path
    lines.push(`G1 X${passRight} Y${passBottom} F${feedRate} ; Bottom edge`);
    lines.push(`G1 X${passRight} Y${passTop} ; Right edge`);
    lines.push(`G1 X${passLeft} Y${passTop} ; Top edge`);
    lines.push(`G1 X${passLeft} Y${passBottom} ; Left edge`);
  }
}

// Return to center and then to safe height
lines.push(`G1 X${center.x} Y${center.y} F${feedRate} ; Return to center`);
lines.push(`G0 Z${safeZ} ; Retract to safe height`);

return lines.join('\n');
}

generateProfileOperation(element, safeZ, plungeRate, feedRate, stepDown) {
const lines = [];
const targetDepth = element.depth;

if (element.type === 'line') {
  // Handle line profile
  const start = element.start;
  const end = element.end;
  
  // Move to start position at safe height
  lines.push(`G0 X${start.x} Y${start.y} ; Move to start position`);
  
  // Perform profiling in steps
  let currentDepth = 0;
  while (currentDepth > targetDepth) {
    // Calculate next depth
    currentDepth = Math.max(currentDepth - stepDown, targetDepth);
    
    // Plunge to depth
    lines.push(`G1 Z${currentDepth} F${plungeRate} ; Plunge to depth ${currentDepth}mm`);
    
    // Cut to end position
    lines.push(`G1 X${end.x} Y${end.y} F${feedRate} ; Cut to end position`);
    
    // If not at final depth, go back to start for next pass
    if (currentDepth > targetDepth) {
      lines.push(`G0 Z${safeZ} ; Return to safe height`);
      lines.push(`G0 X${start.x} Y${start.y} ; Move back to start position`);
    }
  }
  
} else if (element.type === 'rectangle') {
  // Handle rectangle profile
  const center = element.center;
  const width = element.width;
  const height = element.height;
  
  // Calculate corner points
  const left = center.x - width/2;
  const right = center.x + width/2;
  const top = center.y + height/2;
  const bottom = center.y - height/2;
  
  // Starting point (bottom left)
  const startX = left;
  const startY = bottom;
  
  // Move to start position at safe height
  lines.push(`G0 X${startX} Y${startY} ; Move to start position`);
  
  // Perform profiling in steps
  let currentDepth = 0;
  while (currentDepth > targetDepth) {
    // Calculate next depth
    currentDepth = Math.max(currentDepth - stepDown, targetDepth);
    
    // Plunge to depth
    lines.push(`G1 Z${currentDepth} F${plungeRate} ; Plunge to depth ${currentDepth}mm`);
    
    // Cut rectangle profile
    lines.push(`G1 X${right} Y${bottom} F${feedRate} ; Bottom edge`);
    lines.push(`G1 X${right} Y${top} ; Right edge`);
    lines.push(`G1 X${left} Y${top} ; Top edge`);
    lines.push(`G1 X${left} Y${bottom} ; Left edge`);
    
    // If not at final depth, prepare for next pass
    if (currentDepth > targetDepth) {
      // No need to return to start, we're already there
      // Just reposition Z for next pass
    }
  }
  
} else if (element.type === 'circle') {
  // Handle circle profile
  const center = element.center;
  const radius = element.radius;
  
  // Starting point (right side of circle)
  const startX = center.x + radius;
  const startY = center.y;
  
  // Move to start position at safe height
  lines.push(`G0 X${startX} Y${startY} ; Move to start position`);
  
  // Perform profiling in steps
  let currentDepth = 0;
  while (currentDepth > targetDepth) {
    // Calculate next depth
    currentDepth = Math.max(currentDepth - stepDown, targetDepth);
    
    // Plunge to depth
    lines.push(`G1 Z${currentDepth} F${plungeRate} ; Plunge to depth ${currentDepth}mm`);
    
    // Cut circle profile
    // G2 is clockwise circular interpolation
    // I and J are the center point offset from current position
    lines.push(`G2 X${startX} Y${startY} I${-radius} J0 F${feedRate} ; Circle profile`);
    
    // If not at final depth, prepare for next pass
    if (currentDepth > targetDepth) {
      // No need to return to start, we're already there
      // Just continue to next pass
    }
  }
}

// Return to safe height
lines.push(`G0 Z${safeZ} ; Return to safe height`);

return lines.join('\n');
}

// Save G-code to a file
saveGCodeToFile(gcode, filename) {
const blob = new Blob([gcode], { type: 'text/plain' });
const url = URL.createObjectURL(blob);

const a = document.createElement('a');
a.href = url;
a.download = filename;
a.style.display = 'none';

document.body.appendChild(a);
a.click();

// Clean up
setTimeout(() => {
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}, 100);
}
}