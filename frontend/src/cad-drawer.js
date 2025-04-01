import { getSocket } from './socket.js';

class CADDrawer {
  constructor(containerId, appState) {
    this.container = document.getElementById(containerId);
    this.appState = appState;
    this.elements = [];
    this.isDrawing = false;
    this.currentTool = 'line';
    this.startPoint = null;
    this.tempElement = null;
    this.gridSize = 5; // Grid size in mm
    
    // Initialize Two.js
    this.initTwoJS();
    
    // Initialize event listeners
    this.initEventListeners();
    
    // Set up grid
    this.drawGrid();
    
    console.log('CAD Drawer initialized');
  }
  
  initTwoJS() {
    const params = {
      width: this.container.offsetWidth,
      height: this.container.offsetHeight,
      type: Two.Types.svg
    };
    
    this.two = new Two(params).appendTo(this.container);
    
    // Set up coordinate system (origin at center)
    this.centerX = this.two.width / 2;
    this.centerY = this.two.height / 2;
    
    // Create a group for the drawing elements
    this.drawingGroup = this.two.makeGroup();
    
    // Create a group for the grid
    this.gridGroup = this.two.makeGroup();
    
    // Create a group for temporary drawing elements
    this.tempGroup = this.two.makeGroup();
  }
  
  initEventListeners() {
    // Mouse events for drawing
    this.container.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.container.addEventListener('mousemove', this.handleMouseMove.bind(this));
    this.container.addEventListener('mouseup', this.handleMouseUp.bind(this));
    
    // Window resize event
    window.addEventListener('resize', this.handleResize.bind(this));
    
    // Tool selection
    const toolButtons = document.querySelectorAll('.cad-tool-btn');
    toolButtons.forEach(button => {
      button.addEventListener('click', () => {
        this.setTool(button.dataset.tool);
        // Remove active class from all buttons
        toolButtons.forEach(btn => btn.classList.remove('active'));
        // Add active class to clicked button
        button.classList.add('active');
      });
    });
    
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
    if (this.currentTool === 'none') return;
    
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
    switch (this.currentTool) {
      case 'line':
        // Create temporary line
        const screenStart = this.worldToScreen(snappedPoint.x, snappedPoint.y);
        this.tempElement = this.two.makeLine(
          screenStart.x, screenStart.y,
          screenStart.x, screenStart.y
        );
        this.tempElement.stroke = '#3498db';
        this.tempElement.linewidth = 2;
        this.tempGroup.add(this.tempElement);
        break;
      // Add cases for other tools (circle, rectangle, etc.)
    }
    
    this.two.update();
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
    switch (this.currentTool) {
      case 'line':
        // Update line end point
        const screenStart = this.worldToScreen(this.startPoint.x, this.startPoint.y);
        const screenEnd = this.worldToScreen(snappedPoint.x, snappedPoint.y);
        this.tempElement.vertices[1].x = screenEnd.x;
        this.tempElement.vertices[1].y = screenEnd.y;
        break;
      // Add cases for other tools
    }
    
    this.two.update();
  }
  
  handleMouseUp(event) {
    if (!this.isDrawing) return;
    
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to world coordinates
    const worldPoint = this.screenToScreen(x, y);
    
    // Snap to grid
    const snappedPoint = this.snapToGrid(worldPoint);
    
    // Finalize drawing based on current tool
    switch (this.currentTool) {
      case 'line':
        // Only add if start and end points are different
        if (this.startPoint.x !== snappedPoint.x || this.startPoint.y !== snappedPoint.y) {
          // Create final line
          const screenStart = this.worldToScreen(this.startPoint.x, this.startPoint.y);
          const screenEnd = this.worldToScreen(snappedPoint.x, snappedPoint.y);
          const line = this.two.makeLine(
            screenStart.x, screenStart.y,
            screenEnd.x, screenEnd.y
          );
          line.stroke = '#2ecc71';
          line.linewidth = 2;
          
          // Add to drawing group
          this.drawingGroup.add(line);
          
          // Store element data
          this.elements.push({
            type: 'line',
            start: this.startPoint,
            end: snappedPoint
          });
        }
        break;
      // Add cases for other tools
    }
    
    // Clean up
    this.isDrawing = false;
    this.startPoint = null;
    if (this.tempElement) {
      this.tempGroup.remove(this.tempElement);
      this.tempElement = null;
    }
    
    this.two.update();
    
    console.log('Elements:', this.elements);
  }
  
  setTool(tool) {
    this.currentTool = tool;
    console.log('Current tool:', this.currentTool);
  }
  
  clearDrawing() {
    // Remove all elements from the drawing group
    while (this.drawingGroup.children.length > 0) {
      this.drawingGroup.remove(this.drawingGroup.children[0]);
    }
    
    // Clear elements array
    this.elements = [];
    
    this.two.update();
    console.log('Drawing cleared');
  }
  
  drawGrid() {
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
    
    // Collect toolpath data
    const toolpaths = this.elements.map(element => {
      return {
        type: element.type,
        data: element
      };
    });
    
    // Update status
    const statusMessage = document.getElementById('cad-status-message');
    if (statusMessage) {
      statusMessage.textContent = 'Generating G-code...';
    }
    
    // Generate G-code directly in the client for simpler implementation
    const gcode = this.generateSimpleGCode(toolpaths);
    
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
  
  // Generate basic G-code for simple shapes
  generateSimpleGCode(toolpaths) {
    // Default settings
    const safeZ = 5;       // Safe Z height for travel moves
    const cutDepth = -1.0; // Cutting depth
    const feedRate = 500;  // Feed rate for cutting moves
    const plungeRate = 200; // Plunge rate for Z movements
    
    let gcode = [];
    
    // Add header
    gcode.push("; G-code generated from CAD drawing");
    gcode.push("; Generated on " + new Date().toLocaleString());
    gcode.push("");
    gcode.push("G21 ; Set units to millimeters");
    gcode.push("G90 ; Absolute positioning");
    gcode.push(`G0 Z${safeZ} ; Move to safe height`);
    
    // Process each toolpath
    for (let i = 0; i < toolpaths.length; i++) {
      const toolpath = toolpaths[i];
      
      if (toolpath.type === 'line') {
        const line = toolpath.data;
        
        // Add comment
        gcode.push(`; Line from (${line.start.x}, ${line.start.y}) to (${line.end.x}, ${line.end.y})`);
        
        // Move to start position at safe height
        gcode.push(`G0 X${line.start.x} Y${line.start.y} ; Move to start position`);
        
        // Plunge to cutting depth
        gcode.push(`G1 Z${cutDepth} F${plungeRate} ; Plunge to cutting depth`);
        
        // Cut to end position
        gcode.push(`G1 X${line.end.x} Y${line.end.y} F${feedRate} ; Cut to end position`);
        
        // Return to safe height
        gcode.push(`G0 Z${safeZ} ; Return to safe height`);
        gcode.push("");
      }
      // Add other shape types here as needed
    }
    
    // Add footer
    gcode.push(`G0 Z${safeZ} ; Final return to safe height`);
    gcode.push("G0 X0 Y0 ; Return to origin");
    gcode.push("M5 ; Turn off spindle");
    gcode.push("M30 ; End program");
    
    return gcode.join('\n');
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
  
  worldToScreen(x, y) {
    // Convert world coordinates to screen coordinates
    return {
      x: this.centerX + (x * 10),
      y: this.centerY - (y * 10)
    };
  }
  
  screenToScreen(x, y) {
    // This is a correctly named method to replace the accidental duplicate in handleMouseUp
    return this.screenToWorld(x, y);
  }
}

// Export the class
export { CADDrawer };