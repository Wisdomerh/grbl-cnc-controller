function addPropertyChangeListeners(item) {
    // Common properties
    document.getElementById('stroke-color-prop')?.addEventListener('change', e => {
      item.strokeColor = e.target.value;
    });
    
    document.getElementById('stroke-width-prop')?.addEventListener('change', e => {
      item.strokeWidth = parseFloat(e.target.value);
    });
    
    // Type-specific properties
    if (item.className === 'Path') {
      // For lines
      if (item.segments.length === 2) {
        document.getElementById('start-x-prop')?.addEventListener('change', e => {
          item.segments[0].point.x = parseFloat(e.target.value);
        });
        
        document.getElementById('start-y-prop')?.addEventListener('change', e => {
          item.segments[0].point.y = parseFloat(e.target.value);
        });
        
        document.getElementById('end-x-prop')?.addEventListener('change', e => {
          item.segments[1].point.x = parseFloat(e.target.value);
        });
        
        document.getElementById('end-y-prop')?.addEventListener('change', e => {
          item.segments[1].point.y = parseFloat(e.target.value);
        });
      }
    } else if (item.className === 'Path.Rectangle') {
      // For rectangles
      document.getElementById('rect-x-prop')?.addEventListener('change', e => {
        const dx = parseFloat(e.target.value) - item.bounds.x;
        item.position.x += dx;
      });
      
      document.getElementById('rect-y-prop')?.addEventListener('change', e => {
        const dy = parseFloat(e.target.value) - item.bounds.y;
        item.position.y += dy;
      });
      
      document.getElementById('rect-width-prop')?.addEventListener('change', e => {
        item.scale(parseFloat(e.target.value) / item.bounds.width, 1, item.bounds.topLeft);
      });
      
      document.getElementById('rect-height-prop')?.addEventListener('change', e => {
        item.scale(1, parseFloat(e.target.value) / item.bounds.height, item.bounds.topLeft);
      });
    } else if (item.className === 'Path.Circle') {
      // For circles
      document.getElementById('circle-x-prop')?.addEventListener('change', e => {
        item.position.x = parseFloat(e.target.value);
      });
      
      document.getElementById('circle-y-prop')?.addEventListener('change', e => {
        item.position.y = parseFloat(e.target.value);
      });
      
      document.getElementById('circle-radius-prop')?.addEventListener('change', e => {
        const newRadius = parseFloat(e.target.value);
        const scale = newRadius / (item.bounds.width / 2);
        item.scale(scale);
      });
    }
  }
  
  function clearDrawing() {
    // Keep grid
    const grid = project.getItem({ name: 'grid' });
    
    // Clear all other items
    project.clear();
    
    // Restore grid
    if (grid) {
      project.addLayer(grid);
    } else {
      // Recreate grid if not found
      const canvas = document.getElementById('cad-canvas');
      createGrid(canvas.width, canvas.height);
    }
    
    // Clear CAD state
    cadState.shapes = [];
    cadState.selectedShape = null;
    cadState.toolpaths = [];
    
    // Update property panel
    updatePropertyPanel(null);
    
    console.log('Drawing cleared');
  }
  
  function saveDrawing() {
    try {
      // Filter out grid and previews
      const exportItems = [];
      
      project.getItems().forEach(item => {
        if (item.parent && item.parent.name === 'grid') return;
        if (item.name === 'preview') return;
        if (item.name === 'toolpath') return;
        
        exportItems.push(item);
      });
      
      // Create a JSON representation
      const drawingData = {
        version: '1.0',
        objects: exportItems.map(item => item.exportJSON())
      };
      
      // Convert to JSON string
      const jsonString = JSON.stringify(drawingData);
      
      // Create a download link
      const fileName = prompt('Enter filename to save:', 'drawing.json');
      if (!fileName) return;
      
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      
      console.log('Drawing saved');
    } catch (error) {
      console.error('Error saving drawing:', error);
      alert('Error saving drawing: ' + error.message);
    }
  }
  
  function loadDrawing() {
    // Create a file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = function(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          
          // Clear current drawing
          clearDrawing();
          
          // Import objects
          if (data.objects && Array.isArray(data.objects)) {
            data.objects.forEach(jsonItem => {
              const item = paper.Item.importJSON(jsonItem);
              cadState.shapes.push(item);
            });
          }
          
          console.log('Drawing loaded successfully');
        } catch (error) {
          console.error('Error loading drawing:', error);
          alert('Error loading drawing: ' + error.message);
        }
      };
      
      reader.readAsText(file);
    };
    
    input.click();
  }
  
  function exportGcode() {
    // Check if we have toolpaths
    if (cadState.toolpaths.length === 0) {
      // If no toolpaths, ask to generate them from all shapes
      if (confirm('No toolpaths generated yet. Generate profile toolpaths for all shapes?')) {
        // Generate profile toolpaths for all shapes
        cadState.shapes.forEach(shape => {
          generateToolpath('profile', shape);
        });
      } else {
        return;
      }
    }
    
    // Generate G-code from toolpaths
    const socket = getSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        command: 'generate_gcode',
        toolpaths: cadState.toolpaths.map(tp => ({
          type: tp.path.data.type,
          sourceShape: tp.path.data.sourceShape,
          settings: tp.settings
        }))
      }));
      
      console.log('Requesting G-code generation from server...');
    } else {
      // Fallback to client-side generation
      const gcode = generateGcodeFromToolpaths(cadState.toolpaths);
      
      // Send to G-code editor
      const gcodeEditor = document.getElementById('gcode-editor');
      if (gcodeEditor) {
        // Load into editor
        gcodeEditor.value = gcode;
        
        // Switch to G-code tab
        const gcodeTabButton = document.querySelector('.tab-button[data-tab="gcode"]');
        if (gcodeTabButton) {
          gcodeTabButton.click();
        }
        
        // Parse the G-code to update visualization
        const parseButton = document.getElementById('parse-gcode-btn');
        if (parseButton) {
          parseButton.click();
        }
        
        console.log('G-code exported to editor');
      } else {
        // Download as file
        const fileName = prompt('Enter filename to save G-code:', 'toolpath.gcode');
        if (!fileName) return;
        
        const blob = new Blob([gcode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        
        console.log('G-code exported as file');
      }
    }
  }
  
  // Generate basic G-code from toolpaths - fallback if server is unavailable
  function generateGcodeFromToolpaths(toolpaths) {
    // G-code header
    let gcode = [];
    gcode.push('; Generated by CNC Control CAD/CAM');
    gcode.push('; ' + new Date().toISOString());
    gcode.push('');
    gcode.push('G21 ; Set units to millimeters');
    gcode.push('G90 ; Absolute positioning');
    gcode.push('G17 ; XY plane selection');
    gcode.push('');
    
    // Process each toolpath
    toolpaths.forEach((tp, index) => {
      const path = tp.path;
      if (!path) return;
      
      gcode.push(`; Toolpath ${index + 1}`);
      gcode.push(`; Type: ${path.data?.type || 'unknown'}`);
      gcode.push(`; Tool diameter: ${tp.settings.toolDiameter}mm`);
      gcode.push(`; Feed rate: ${tp.settings.feedRate}mm/min`);
      gcode.push(`; Plunge rate: ${tp.settings.plungeRate}mm/min`);
      gcode.push(`; Cut depth: ${tp.settings.cutDepth}mm`);
      gcode.push('');
      
      // Simple G-code generation based on shape type
      if (path.className === 'Path') {
        // For lines
        gcode.push('G0 Z5 ; Safe height');
        
        // Start point
        const startPoint = path.segments[0].point;
        gcode.push(`G0 X${startPoint.x.toFixed(3)} Y${startPoint.y.toFixed(3)} ; Move to start`);
        
        // Plunge to depth
        gcode.push(`G1 Z-${tp.settings.cutDepth.toFixed(3)} F${tp.settings.plungeRate} ; Plunge to depth`);
        
        // Process segments
        for (let i = 1; i < path.segments.length; i++) {
          const point = path.segments[i].point;
          gcode.push(`G1 X${point.x.toFixed(3)} Y${point.y.toFixed(3)} F${tp.settings.feedRate} ; Cut to point`);
        }
        
        // Retract
        gcode.push('G0 Z5 ; Retract to safe height');
      } else if (path.className === 'Path.Circle') {
        // For circles - approximate with small segments
        const center = path.position;
        const radius = path.bounds.width / 2;
        
        gcode.push('G0 Z5 ; Safe height');
        gcode.push(`; Circle center: X${center.x.toFixed(3)} Y${center.y.toFixed(3)}, Radius: ${radius.toFixed(3)}`);
        
        // Move to start point on circle
        const startX = center.x + radius;
        const startY = center.y;
        gcode.push(`G0 X${startX.toFixed(3)} Y${startY.toFixed(3)} ; Move to start point on circle`);
        
        // Plunge to depth
        gcode.push(`G1 Z-${tp.settings.cutDepth.toFixed(3)} F${tp.settings.plungeRate} ; Plunge to depth`);
        
        // Generate circle using small G1 moves (approximation)
        const segments = 36; // Number of segments for a complete circle
        for (let i = 1; i <= segments; i++) {
          const angle = (i * 2 * Math.PI) / segments;
          const x = center.x + radius * Math.cos(angle);
          const y = center.y + radius * Math.sin(angle);
          gcode.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${tp.settings.feedRate} ; Circle segment ${i}/${segments}`);
        }
        
        // Retract
        gcode.push('G0 Z5 ; Retract to safe height');
      } else if (path.className === 'Path.Rectangle') {
        // For rectangles
        const bounds = path.bounds;
        
        gcode.push('G0 Z5 ; Safe height');
        
        // Start at top-left corner
        gcode.push(`G0 X${bounds.left.toFixed(3)} Y${bounds.top.toFixed(3)} ; Move to top-left corner`);
        
        // Plunge to depth
        gcode.push(`G1 Z-${tp.settings.cutDepth.toFixed(3)} F${tp.settings.plungeRate} ; Plunge to depth`);
        
        // Move around rectangle
        gcode.push(`G1 X${bounds.right.toFixed(3)} Y${bounds.top.toFixed(3)} F${tp.settings.feedRate} ; Top edge`);
        gcode.push(`G1 X${bounds.right.toFixed(3)} Y${bounds.bottom.toFixed(3)} F${tp.settings.feedRate} ; Right edge`);
        gcode.push(`G1 X${bounds.left.toFixed(3)} Y${bounds.bottom.toFixed(3)} F${tp.settings.feedRate} ; Bottom edge`);
        gcode.push(`G1 X${bounds.left.toFixed(3)} Y${bounds.top.toFixed(3)} F${tp.settings.feedRate} ; Left edge (return to start)`);
        
        // Retract
        gcode.push('G0 Z5 ; Retract to safe height');
      }
      
      gcode.push('');
    });
    
    // G-code footer
    gcode.push('G0 Z10 ; Move to safe Z height');
    gcode.push('G0 X0 Y0 ; Return to origin');
    gcode.push('M5 ; Stop spindle');
    gcode.push('M30 ; End program');
    
    return gcode.join('\n');
  }
  
  // Handle G-code response from server
  function handleGcodeResponse(message) {
    // Check if the message is a G-code result
    if (typeof message === 'string' && message.startsWith('GCODE_RESULT:')) {
      try {
        // Extract the JSON part of the message
        const jsonStr = message.substring('GCODE_RESULT:'.length);
        const result = JSON.parse(jsonStr);
        
        if (result.success && result.gcode) {
          // Load into editor
          const gcodeEditor = document.getElementById('gcode-editor');
          if (gcodeEditor) {
            gcodeEditor.value = result.gcode;
            
            // Switch to G-code tab
            const gcodeTabButton = document.querySelector('.tab-button[data-tab="gcode"]');
            if (gcodeTabButton) {
              gcodeTabButton.click();
            }
            
            // Parse the G-code to update visualization
            const parseButton = document.getElementById('parse-gcode-btn');
            if (parseButton) {
              parseButton.click();
            }
            
            console.log('G-code received from server and loaded into editor');
          }
        } else if (result.error) {
          console.error('Error generating G-code:', result.error);
          alert('Error generating G-code: ' + result.error);
        }
      } catch (e) {
        console.error('Error parsing G-code result:', e);
      }
    }
    
    // Check if the message is a toolpath result
    if (typeof message === 'string' && message.startsWith('TOOLPATH_RESULT:')) {
      try {
        // Extract the JSON part of the message
        const jsonStr = message.substring('TOOLPATH_RESULT:'.length);
        const result = JSON.parse(jsonStr);
        
        console.log('Received toolpath result from server:', result);
        
        // Handle toolpath result...
      } catch (e) {
        console.error('Error parsing toolpath result:', e);
      }
    }
  }// frontend/src/cad-manager.js
  // Main CAD interface management
  
  import { getSocket } from './socket.js';
  import { initToolpathGenerator, generateToolpath } from './cam-manager.js';
  
  // Global paper.js variables
  let project;
  let activeTool = 'select';
  let activeObject = null;
  let snapToGrid = true;
  let gridSize = 5; // mm
  
  // CAD state tracking
  const cadState = {
    mode: 'draw', // 'draw', 'edit', 'cam'
    shapes: [],
    selectedShape: null,
    toolpaths: [],
    drawingSettings: {
      strokeColor: '#000000',
      strokeWidth: 1,
      fillColor: null
    },
    camSettings: {
      toolDiameter: 3.175, // mm
      feedRate: 500, // mm/min
      plungeRate: 200, // mm/min
      cutDepth: 1.0, // mm
      stepDepth: 0.5, // mm
      stepOver: 40 // percentage
    }
  };
  
  export function initCADManager(appState) {
    console.log('Initializing CAD Manager');
    
    // Initialize Paper.js
    const canvas = document.getElementById('cad-canvas');
    if (!canvas) {
      console.error('CAD canvas not found');
      return;
    }
    
    // Setup Paper.js
    paper.setup(canvas);
    project = paper.project;
    
    // Create a grid
    createGrid(canvas.width, canvas.height);
    
    // Initialize events
    initEventListeners();
    
    // Initialize CAM toolpaths generator
    initToolpathGenerator(cadState);
    
    // Listen for tab changes to resize canvas
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        if (button.getAttribute('data-tab') === 'cad') {
          setTimeout(resizeCanvas, 100); // Resize after tab becomes visible
        }
      });
    });
    
    // If CAD tab is already active on load
    if (document.getElementById('cad-tab')?.classList.contains('active')) {
      resizeCanvas();
    }
    
    // Register this module with appState for communication
    if (appState) {
      // Add state management
      appState.cadState = cadState;
      
      // Register event handlers with appState
      appState.addMessageHandler(handleGcodeResponse);
    }
    
    console.log('CAD Manager initialized');
    
    // Expose resize function globally
    window.resizeCADCanvas = resizeCanvas;
  }
  
  function resizeCanvas() {
    const canvas = document.getElementById('cad-canvas');
    const container = document.querySelector('.cad-canvas-container');
    if (!canvas || !container) return;
    
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    canvas.width = width;
    canvas.height = height;
    paper.view.viewSize = new paper.Size(width, height);
    
    // Recreate grid for new size
    createGrid(width, height);
    
    console.log(`Canvas resized to ${width}x${height}`);
  }
  
  function createGrid(width, height) {
    // Clear any existing grid
    const existingGrid = project.getItem({ name: 'grid' });
    if (existingGrid) existingGrid.remove();
    
    // Create grid group
    const grid = new paper.Group();
    grid.name = 'grid';
    
    // Calculate grid spacing in paper.js points
    const spacing = gridSize;
    
    // Draw grid lines
    const gridColor = new paper.Color(0.8, 0.8, 0.8);
    
    // Draw horizontal lines
    for (let y = 0; y < height; y += spacing) {
      const path = new paper.Path.Line(
        new paper.Point(0, y),
        new paper.Point(width, y)
      );
      path.strokeColor = gridColor;
      path.strokeWidth = 0.5;
      grid.addChild(path);
    }
    
    // Draw vertical lines
    for (let x = 0; x < width; x += spacing) {
      const path = new paper.Path.Line(
        new paper.Point(x, 0),
        new paper.Point(x, height)
      );
      path.strokeColor = gridColor;
      path.strokeWidth = 0.5;
      grid.addChild(path);
    }
    
    // Draw X and Y axes with different color
    const xAxis = new paper.Path.Line(
      new paper.Point(0, 0),
      new paper.Point(width, 0)
    );
    xAxis.strokeColor = 'red';
    xAxis.strokeWidth = 1;
    
    const yAxis = new paper.Path.Line(
      new paper.Point(0, 0),
      new paper.Point(0, height)
    );
    yAxis.strokeColor = 'green';
    yAxis.strokeWidth = 1;
    
    grid.addChild(xAxis);
    grid.addChild(yAxis);
    
    // Send grid to back
    grid.sendToBack();
  }
  
  function initEventListeners() {
    // Tool selection
    const toolButtons = document.querySelectorAll('.tool-btn');
    toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // Remove active class from all buttons
        toolButtons.forEach(b => b.classList.remove('active'));
        
        // Add active class to clicked button
        btn.classList.add('active');
        
        // Set active tool
        activeTool = btn.getAttribute('data-tool');
        
        // Update mode
        cadState.mode = 'draw';
        
        console.log(`Tool selected: ${activeTool}`);
      });
    });
    
    // CAM operation buttons
    const camButtons = document.querySelectorAll('.cam-btn');
    camButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!cadState.selectedShape) {
          alert('Please select a shape first');
          return;
        }
        
        // Get operation type
        const operation = btn.getAttribute('data-operation');
        
        // Update mode
        cadState.mode = 'cam';
        
        // Generate toolpath
        generateToolpath(operation, cadState.selectedShape);
      });
    });
    
    // Action buttons
    document.getElementById('new-drawing')?.addEventListener('click', clearDrawing);
    document.getElementById('save-drawing')?.addEventListener('click', saveDrawing);
    document.getElementById('load-drawing')?.addEventListener('click', loadDrawing);
    document.getElementById('export-gcode')?.addEventListener('click', exportGcode);
    
    // Paper.js tool events
    setupPaperTools();
    
    // CAM Settings events
    document.getElementById('tool-diameter')?.addEventListener('change', e => {
      cadState.camSettings.toolDiameter = parseFloat(e.target.value);
    });
    
    document.getElementById('tool-feedrate')?.addEventListener('change', e => {
      cadState.camSettings.feedRate = parseFloat(e.target.value);
    });
    
    document.getElementById('tool-plungerate')?.addEventListener('change', e => {
      cadState.camSettings.plungeRate = parseFloat(e.target.value);
    });
    
    document.getElementById('cut-depth')?.addEventListener('change', e => {
      cadState.camSettings.cutDepth = parseFloat(e.target.value);
    });
    
    document.getElementById('step-depth')?.addEventListener('change', e => {
      cadState.camSettings.stepDepth = parseFloat(e.target.value);
    });
    
    document.getElementById('step-over')?.addEventListener('change', e => {
      cadState.camSettings.stepOver = parseFloat(e.target.value);
    });
  }
  
  function setupPaperTools() {
    // Select Tool
    const selectTool = new paper.Tool();
    
    selectTool.onMouseDown = function(event) {
      if (activeTool !== 'select') return;
      
      // Deselect all
      deselectAll();
      
      // Hit test at event point
      const hitResult = project.hitTest(event.point, {
        segments: true,
        stroke: true,
        fill: true,
        tolerance: 5
      });
      
      if (hitResult) {
        const item = hitResult.item;
        
        // Skip grid
        if (item.parent && item.parent.name === 'grid') return;
        
        // Select the item
        item.selected = true;
        cadState.selectedShape = item;
        
        // Show properties
        updatePropertyPanel(item);
      }
    };
    
    // Line Tool
    const lineTool = new paper.Tool();
    let lineStart = null;
    
    lineTool.onMouseDown = function(event) {
      if (activeTool !== 'line') return;
      
      if (!lineStart) {
        // Start drawing line
        lineStart = event.point;
      } else {
        // Complete line
        const line = new paper.Path.Line(lineStart, event.point);
        line.strokeColor = cadState.drawingSettings.strokeColor;
        line.strokeWidth = cadState.drawingSettings.strokeWidth;
        
        // Add to shapes array
        cadState.shapes.push(line);
        
        // Reset starting point
        lineStart = null;
      }
    };
    
    lineTool.onMouseMove = function(event) {
      if (activeTool !== 'line' || !lineStart) return;
      
      // Remove previous preview
      const previews = project.getItems({ name: 'preview' });
      previews.forEach(item => item.remove());
      
      // Draw preview line
      const preview = new paper.Path.Line(lineStart, event.point);
      preview.strokeColor = cadState.drawingSettings.strokeColor;
      preview.strokeWidth = cadState.drawingSettings.strokeWidth;
      preview.dashArray = [4, 4]; // Make it dashed
      preview.name = 'preview';
    };
    
    // Rectangle Tool
    const rectTool = new paper.Tool();
    let rectStart = null;
    
    rectTool.onMouseDown = function(event) {
      if (activeTool !== 'rectangle') return;
      
      if (!rectStart) {
        // Start drawing rectangle
        rectStart = event.point;
      } else {
        // Complete rectangle
        const rect = new paper.Path.Rectangle(rectStart, event.point);
        rect.strokeColor = cadState.drawingSettings.strokeColor;
        rect.strokeWidth = cadState.drawingSettings.strokeWidth;
        
        if (cadState.drawingSettings.fillColor) {
          rect.fillColor = cadState.drawingSettings.fillColor;
        }
        
        // Add to shapes array
        cadState.shapes.push(rect);
        
        // Reset starting point
        rectStart = null;
      }
    };
    
    rectTool.onMouseMove = function(event) {
      if (activeTool !== 'rectangle' || !rectStart) return;
      
      // Remove previous preview
      const previews = project.getItems({ name: 'preview' });
      previews.forEach(item => item.remove());
      
      // Draw preview rectangle
      const preview = new paper.Path.Rectangle(rectStart, event.point);
      preview.strokeColor = cadState.drawingSettings.strokeColor;
      preview.strokeWidth = cadState.drawingSettings.strokeWidth;
      preview.dashArray = [4, 4]; // Make it dashed
      preview.name = 'preview';
    };
    
    // Circle Tool
    const circleTool = new paper.Tool();
    let circleCenter = null;
    
    circleTool.onMouseDown = function(event) {
      if (activeTool !== 'circle') return;
      
      if (!circleCenter) {
        // Start drawing circle
        circleCenter = event.point;
      } else {
        // Complete circle
        const radius = circleCenter.getDistance(event.point);
        const circle = new paper.Path.Circle(circleCenter, radius);
        circle.strokeColor = cadState.drawingSettings.strokeColor;
        circle.strokeWidth = cadState.drawingSettings.strokeWidth;
        
        if (cadState.drawingSettings.fillColor) {
          circle.fillColor = cadState.drawingSettings.fillColor;
        }
        
        // Add to shapes array
        cadState.shapes.push(circle);
        
        // Reset center point
        circleCenter = null;
      }
    };
    
    circleTool.onMouseMove = function(event) {
      if (activeTool !== 'circle' || !circleCenter) return;
      
      // Remove previous preview
      const previews = project.getItems({ name: 'preview' });
      previews.forEach(item => item.remove());
      
      // Draw preview circle
      const radius = circleCenter.getDistance(event.point);
      const preview = new paper.Path.Circle(circleCenter, radius);
      preview.strokeColor = cadState.drawingSettings.strokeColor;
      preview.strokeWidth = cadState.drawingSettings.strokeWidth;
      preview.dashArray = [4, 4]; // Make it dashed
      preview.name = 'preview';
    };
    
    // Set up view
    paper.view.onFrame = function(event) {
      // This is called on every animation frame
      // For smooth updates to the canvas
    };
  }
  
  function deselectAll() {
    project.getItems().forEach(item => {
      item.selected = false;
    });
    
    cadState.selectedShape = null;
    updatePropertyPanel(null);
  }
  
  function updatePropertyPanel(item) {
    const container = document.getElementById('property-container');
    if (!container) return;
    
    // Clear existing properties
    container.innerHTML = '';
    
    if (!item) {
      container.innerHTML = '<p>No object selected</p>';
      return;
    }
    
    // Create property inputs based on item type
    const properties = document.createElement('div');
    
    // Common properties
    const strokeColorProp = document.createElement('div');
    strokeColorProp.className = 'property';
    strokeColorProp.innerHTML = `
      <label>Stroke Color:</label>
      <input type="color" value="${item.strokeColor ? item.strokeColor.toCSS(true) : '#000000'}" id="stroke-color-prop">
    `;
    properties.appendChild(strokeColorProp);
    
    const strokeWidthProp = document.createElement('div');
    strokeWidthProp.className = 'property';
    strokeWidthProp.innerHTML = `
      <label>Stroke Width:</label>
      <input type="number" value="${item.strokeWidth || 1}" min="0.1" step="0.1" id="stroke-width-prop">
    `;
    properties.appendChild(strokeWidthProp);
    
    // Type-specific properties
    if (item.className === 'Path') {
      // For Path objects (lines, polylines)
      if (item.segments.length === 2) {
        // Line
        const p1 = item.segments[0].point;
        const p2 = item.segments[1].point;
        
        const startXProp = document.createElement('div');
        startXProp.className = 'property';
        startXProp.innerHTML = `
          <label>Start X:</label>
          <input type="number" value="${p1.x.toFixed(2)}" step="1" id="start-x-prop">
        `;
        properties.appendChild(startXProp);
        
        const startYProp = document.createElement('div');
        startYProp.className = 'property';
        startYProp.innerHTML = `
          <label>Start Y:</label>
          <input type="number" value="${p1.y.toFixed(2)}" step="1" id="start-y-prop">
        `;
        properties.appendChild(startYProp);
        
        const endXProp = document.createElement('div');
        endXProp.className = 'property';
        endXProp.innerHTML = `
          <label>End X:</label>
          <input type="number" value="${p2.x.toFixed(2)}" step="1" id="end-x-prop">
        `;
        properties.appendChild(endXProp);
        
        const endYProp = document.createElement('div');
        endYProp.className = 'property';
        endYProp.innerHTML = `
          <label>End Y:</label>
          <input type="number" value="${p2.y.toFixed(2)}" step="1" id="end-y-prop">
        `;
        properties.appendChild(endYProp);
      }
    } else if (item.className === 'Path.Rectangle') {
      // For rectangles
      const bounds = item.bounds;
      
      const xProp = document.createElement('div');
      xProp.className = 'property';
      xProp.innerHTML = `
        <label>X:</label>
        <input type="number" value="${bounds.x.toFixed(2)}" step="1" id="rect-x-prop">
      `;
      properties.appendChild(xProp);
      
      const yProp = document.createElement('div');
      yProp.className = 'property';
      yProp.innerHTML = `
        <label>Y:</label>
        <input type="number" value="${bounds.y.toFixed(2)}" step="1" id="rect-y-prop">
      `;
      properties.appendChild(yProp);
      
      const widthProp = document.createElement('div');
      widthProp.className = 'property';
      widthProp.innerHTML = `
        <label>Width:</label>
        <input type="number" value="${bounds.width.toFixed(2)}" min="0.1" step="1" id="rect-width-prop">
      `;
      properties.appendChild(widthProp);
      
      const heightProp = document.createElement('div');
      heightProp.className = 'property';
      heightProp.innerHTML = `
        <label>Height:</label>
        <input type="number" value="${bounds.height.toFixed(2)}" min="0.1" step="1" id="rect-height-prop">
      `;
      properties.appendChild(heightProp);
    } else if (item.className === 'Path.Circle') {
      // For circles
      const center = item.position;
      const radius = item.bounds.width / 2;
      
      const centerXProp = document.createElement('div');
      centerXProp.className = 'property';
      centerXProp.innerHTML = `
        <label>Center X:</label>
        <input type="number" value="${center.x.toFixed(2)}" step="1" id="circle-x-prop">
      `;
      properties.appendChild(centerXProp);
      
      const centerYProp = document.createElement('div');
      centerYProp.className = 'property';
      centerYProp.innerHTML = `
        <label>Center Y:</label>
        <input type="number" value="${center.y.toFixed(2)}" step="1" id="circle-y-prop">
      `;
      properties.appendChild(centerYProp);
      
      const radiusProp = document.createElement('div');
      radiusProp.className = 'property';
      radiusProp.innerHTML = `
        <label>Radius:</label>
        <input type="number" value="${radius.toFixed(2)}" min="0.1" step="1" id="circle-radius-prop">
      `;
      properties.appendChild(radiusProp);
    }
    
    container.appendChild(properties);
    
    // Add event listeners for property changes
    addPropertyChangeListeners(item);
  }