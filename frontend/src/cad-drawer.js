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
  
  screenToWorld(x, y) {
    // Convert screen coordinates to world coordinates
    return {
      x: (x - this.centerX) / 10, // Scale by 10 pixels per mm
      y: (this.centerY - y) / 10  // Invert Y axis to match CNC coordinate system
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
  
  handleMouseDown(event) {
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
    } if (this.currentTool === 'circle') {
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
  
  handleMouseMove(event) {
    if (!this.isDrawing || !this.tempElement) return;
    
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to world coordinates
    const worldPoint = this.screenToWorld(x, y);
    
    // Snap to grid
    const snappedPoint = this.snapToGrid(worldPoint);
    
    // Update temporary element based on current tool
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
  
  // Log for debugging
  console.log('Circle updated: radius =', radius);
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
    if (isDifferentPoints) {
      let element = null;
      
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
      if (element) {
        this.elements.push(element);
        console.log(`Added ${element.type} to elements array, count: ${this.elements.length}`);
      }
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
    
    // Find clicked element
    this.selectedElement = this.findElementAt(worldPoint);
    
    // Update UI based on selection
    if (this.selectedElement) {
      console.log('Element selected:', this.selectedElement);
      
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
        statusMessage.textContent = `Selected ${this.selectedElement.type} at depth ${this.selectedElement.depth}mm`;
      }
    } else {
      this.updateAllVisuals();
      
      // Update status message
      const statusMessage = document.getElementById('cad-status-message');
      if (statusMessage) {
        statusMessage.textContent = 'No element selected';
      }
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
    }
    
    return null;
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
    
    // Update visual properties based on operation type and depth
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
    
    // Adjust line width based on depth - deeper cuts get thicker lines
    // Scale from 1 to 4 based on depth from 0 to -10mm
    const depthFactor = Math.min(Math.abs(element.depth) / 5, 1);
    const lineWidth = 1 + (depthFactor * 3);
    element.visual.linewidth = lineWidth;
    
    // Highlight if selected
    if (this.selectedElement === element) {
      element.visual.stroke = '#f39c12'; // Orange for selected element
      element.visual.linewidth += 1;
    }
    
    this.two.update();
  }
  
  updateAllVisuals() {
    this.elements.forEach(element => {
      this.updateElementVisual(element);
    });
  }
  
  setTool(tool) {
    this.currentTool = tool;
    
    // Deselect element when switching tools
    if (tool !== 'select') {
      this.selectedElement = null;
      this.updateAllVisuals();
    }
    
    console.log('Current tool:', this.currentTool);
    
    // Update status message
    const statusMessage = document.getElementById('cad-status-message');
    if (statusMessage) {
      statusMessage.textContent = `Selected tool: ${tool}`;
    }
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

// Generate G-code for 2.5D operations
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
// This helps group similar operations together
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
  const element = sortedElements[i];
  
  gcode.push(`; Operation ${i+1}: ${element.operation.toUpperCase()} - ${element.type.toUpperCase()}`);
  gcode.push(`; Depth: ${element.depth} mm`);
  
  if (element.operation === 'drill') {
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