
// Global variables
let cadState;

// Initialize toolpath generator
export function initToolpathGenerator(state) {
  cadState = state;
  console.log('Toolpath generator initialized');
}

// Generate toolpath for a specific operation and shape
export function generateToolpath(operation, shape) {
  // Clear existing toolpaths for this shape
  const existingToolpaths = paper.project.getItems({
    name: 'toolpath', 
    data: { sourceShape: shape.id }
  });
  
  existingToolpaths.forEach(path => path.remove());
  
  // Generate new toolpath based on operation
  let toolpath;
  
  switch (operation) {
    case 'profile':
      toolpath = generateProfileToolpath(shape);
      break;
    case 'pocket':
      toolpath = generatePocketToolpath(shape);
      break;
    case 'drill':
      toolpath = generateDrillToolpath(shape);
      break;
    default:
      console.error(`Unknown operation: ${operation}`);
      return null;
  }
  
  // Add to toolpaths array if successful
  if (toolpath) {
    cadState.toolpaths.push({
      path: toolpath,
      operation: operation,
      sourceShape: shape.id,
      settings: { ...cadState.camSettings }
    });
    
    console.log(`Generated ${operation} toolpath for shape ${shape.id}`);
  }
  
  return toolpath;
}

// Generate profile (outline) toolpath
function generateProfileToolpath(shape) {
  const toolDiameter = cadState.camSettings.toolDiameter;
  const toolRadius = toolDiameter / 2;
  
  // Create a copy of the shape
  const toolpath = shape.clone();
  toolpath.name = 'toolpath';
  toolpath.data = { 
    type: 'profile',
    sourceShape: shape.id,
    toolDiameter: toolDiameter
  };
  
  // Set toolpath appearance
  toolpath.strokeColor = '#FF0000'; // Red for profile cuts
  toolpath.strokeWidth = 1;
  toolpath.dashArray = [4, 2];
  toolpath.fillColor = null;
  
  // For closed paths, we need to offset to account for tool diameter
  // This is a simple offset - a real implementation would use more sophisticated path offsetting
  if (toolpath.closed && typeof paper.Path.Offset === 'function') {
    try {
      // Try to use Paper.js offset method if available
      const offsetPath = paper.Path.Offset(toolpath, toolRadius);
      
      // If offsetPath is successfully created, replace toolpath with it
      if (offsetPath) {
        toolpath.remove();
        toolpath = offsetPath;
        toolpath.name = 'toolpath';
        toolpath.data = { 
          type: 'profile',
          sourceShape: shape.id,
          toolDiameter: toolDiameter
        };
        toolpath.strokeColor = '#FF0000';
        toolpath.strokeWidth = 1;
        toolpath.dashArray = [4, 2];
        toolpath.fillColor = null;
      }
    } catch (e) {
      console.error('Error offsetting path:', e);
      // Continue with the original path if offset fails
    }
  }
  
  return toolpath;
}

// Generate pocket toolpath
function generatePocketToolpath(shape) {
  const toolDiameter = cadState.camSettings.toolDiameter;
  const toolRadius = toolDiameter / 2;
  const stepOver = cadState.camSettings.stepOver / 100; // Convert percentage to decimal
  
  // Check if shape is closed (required for pocketing)
  if (!shape.closed) {
    alert('Pocket operation requires a closed shape');
    return null;
  }
  
  // Create a group to hold all pocket toolpaths
  const pocketGroup = new paper.Group();
  pocketGroup.name = 'toolpath';
  pocketGroup.data = { 
    type: 'pocket',
    sourceShape: shape.id,
    toolDiameter: toolDiameter
  };
  
  try {
    // Create inward offset paths
    let currentPath = shape.clone();
    currentPath.strokeColor = '#0000FF'; // Blue for pocket cuts
    currentPath.strokeWidth = 1;
    currentPath.fillColor = null;
    currentPath.dashArray = [4, 2];
    
    // Add the outer path to the group
    pocketGroup.addChild(currentPath);
    
    // Simple step-based inward offsetting
    // A real implementation would use more sophisticated algorithms
    const maxInset = Math.min(shape.bounds.width, shape.bounds.height) / 2;
    const stepSize = toolDiameter * stepOver;
    
    for (let inset = stepSize; inset < maxInset; inset += stepSize) {
      // For circles, simple scaling works for inward offsets
      if (shape.className === 'Path.Circle') {
        const center = shape.position;
        const radius = shape.bounds.width / 2 - inset;
        
        // Stop if radius is too small
        if (radius < toolRadius) break;
        
        const insetPath = new paper.Path.Circle(center, radius);
        insetPath.strokeColor = '#0000FF';
        insetPath.strokeWidth = 1;
        insetPath.fillColor = null;
        insetPath.dashArray = [4, 2];
        
        pocketGroup.addChild(insetPath);
      }
      // For rectangles, simple insets work
      else if (shape.className === 'Path.Rectangle') {
        const originalBounds = shape.bounds;
        const insetPath = new paper.Path.Rectangle(
          new paper.Rectangle(
            originalBounds.x + inset,
            originalBounds.y + inset,
            originalBounds.width - 2 * inset,
            originalBounds.height - 2 * inset
          )
        );
        
        // Stop if too small
        if (insetPath.bounds.width < toolDiameter || insetPath.bounds.height < toolDiameter) {
          insetPath.remove();
          break;
        }
        
        insetPath.strokeColor = '#0000FF';
        insetPath.strokeWidth = 1;
        insetPath.fillColor = null;
        insetPath.dashArray = [4, 2];
        
        pocketGroup.addChild(insetPath);
      }
      // For other complex shapes, use a more advanced approach
      else {
        // This is a placeholder - real implementation would use path offsetting libraries
        // or more sophisticated algorithms
        break;
      }
    }
    
    // If no paths were added, remove the group and return null
    if (pocketGroup.children.length === 0) {
      pocketGroup.remove();
      return null;
    }
    
    return pocketGroup;
  } catch (e) {
    console.error('Error generating pocket toolpath:', e);
    pocketGroup.remove();
    return null;
  }
}

// Generate drilling toolpath
function generateDrillToolpath(shape) {
  // Drilling only works for points or circles
  let center;
  
  if (shape.className === 'Path.Circle') {
    center = shape.position;
  } else if (shape.className === 'Path' && shape.segments.length === 1) {
    center = shape.segments[0].point;
  } else {
    alert('Drill operation requires a circle or point');
    return null;
  }
  
  // Create a drilling operation marker (crosshair)
  const drillMarker = new paper.Group();
  drillMarker.name = 'toolpath';
  drillMarker.data = { 
    type: 'drill',
    sourceShape: shape.id,
    center: { x: center.x, y: center.y }
  };
  
  // Create crosshair
  const lineH = new paper.Path.Line(
    new paper.Point(center.x - 5, center.y),
    new paper.Point(center.x + 5, center.y)
  );
  
  const lineV = new paper.Path.Line(
    new paper.Point(center.x, center.y - 5),
    new paper.Point(center.x, center.y + 5)
  );
  
  lineH.strokeColor = '#00FF00'; // Green for drill operations
  lineV.strokeColor = '#00FF00';
  
  drillMarker.addChild(lineH);
  drillMarker.addChild(lineV);
  
  // Add a small circle to represent the drill diameter
  const drillCircle = new paper.Path.Circle(center, cadState.camSettings.toolDiameter / 2);
  drillCircle.strokeColor = '#00FF00';
  drillCircle.strokeWidth = 1;
  drillCircle.dashArray = [2, 2];
  drillMarker.addChild(drillCircle);
  
  return drillMarker;
}

// Generate G-code from a path
export function generateGcodeFromPath(path, settings) {
  const gcode = [];
  const safeZ = 5; // Safe Z travel height
  
  // Different G-code generation strategies based on path type
  if (path.data && path.data.type === 'profile') {
    gcode.push('G0 Z' + safeZ + ' ; Safe height');
    
    // Handle different shape types
    if (path.className === 'Path') {
      // For paths, get all points
      const points = path.segments.map(segment => segment.point);
      
      // Move to first point
      if (points.length > 0) {
        const firstPoint = points[0];
        gcode.push('G0 X' + firstPoint.x.toFixed(3) + ' Y' + firstPoint.y.toFixed(3) + ' ; Move to start point');
        
        // Plunge to cutting depth
        gcode.push('G1 Z-' + settings.cutDepth.toFixed(3) + ' F' + settings.plungeRate + ' ; Plunge to depth');
        
        // Cut through all points
        for (let i = 1; i < points.length; i++) {
          const point = points[i];
          gcode.push('G1 X' + point.x.toFixed(3) + ' Y' + point.y.toFixed(3) + ' F' + settings.feedRate + ' ; Cut to point');
        }
        
        // If it's a closed path, return to start
        if (path.closed) {
          gcode.push('G1 X' + firstPoint.x.toFixed(3) + ' Y' + firstPoint.y.toFixed(3) + ' F' + settings.feedRate + ' ; Return to start');
        }
      }
    } else if (path.className === 'Path.Circle') {
      // For circles, approximate with G1 moves or use G2/G3 if supported
      const center = path.position;
      const radius = path.bounds.width / 2;
      
      gcode.push('G0 X' + (center.x + radius).toFixed(3) + ' Y' + center.y.toFixed(3) + ' ; Move to circle edge');
      gcode.push('G1 Z-' + settings.cutDepth.toFixed(3) + ' F' + settings.plungeRate + ' ; Plunge to depth');
      
      // Arc command if supported (G-code implementation dependent)
      gcode.push('G2 X' + (center.x + radius).toFixed(3) + ' Y' + center.y.toFixed(3) + 
                 ' I-' + radius.toFixed(3) + ' J0 F' + settings.feedRate + ' ; Full circle counterclockwise');
    } else if (path.className === 'Path.Rectangle') {
      // For rectangles, cut corners
      const bounds = path.bounds;
      
      gcode.push('G0 X' + bounds.left.toFixed(3) + ' Y' + bounds.top.toFixed(3) + ' ; Move to first corner');
      gcode.push('G1 Z-' + settings.cutDepth.toFixed(3) + ' F' + settings.plungeRate + ' ; Plunge to depth');
      
      // Cut around rectangle
      gcode.push('G1 X' + bounds.right.toFixed(3) + ' Y' + bounds.top.toFixed(3) + ' F' + settings.feedRate + ' ; Cut to corner 2');
      gcode.push('G1 X' + bounds.right.toFixed(3) + ' Y' + bounds.bottom.toFixed(3) + ' F' + settings.feedRate + ' ; Cut to corner 3');
      gcode.push('G1 X' + bounds.left.toFixed(3) + ' Y' + bounds.bottom.toFixed(3) + ' F' + settings.feedRate + ' ; Cut to corner 4');
      gcode.push('G1 X' + bounds.left.toFixed(3) + ' Y' + bounds.top.toFixed(3) + ' F' + settings.feedRate + ' ; Cut back to start');
    }
    
    // Return to safe height
    gcode.push('G0 Z' + safeZ + ' ; Return to safe height');
    
  } else if (path.data && path.data.type === 'pocket') {
    // For pocket operations with multiple paths
    if (path.className === 'Group' && path.children) {
      // Process each path in the group (from outside to inside)
      path.children.forEach((childPath, index) => {
        gcode.push('; Pocket contour ' + (index + 1) + ' of ' + path.children.length);
        
        if (childPath.segments) {
          const points = childPath.segments.map(segment => segment.point);
          
          // Move to first point
          if (points.length > 0) {
            const firstPoint = points[0];
            gcode.push('G0 Z' + safeZ + ' ; Safe height');
            gcode.push('G0 X' + firstPoint.x.toFixed(3) + ' Y' + firstPoint.y.toFixed(3) + ' ; Move to start point');
            
            // Plunge to cutting depth
            gcode.push('G1 Z-' + settings.cutDepth.toFixed(3) + ' F' + settings.plungeRate + ' ; Plunge to depth');
            
            // Cut through all points
            for (let i = 1; i < points.length; i++) {
              const point = points[i];
              gcode.push('G1 X' + point.x.toFixed(3) + ' Y' + point.y.toFixed(3) + ' F' + settings.feedRate + ' ; Cut to point');
            }
            
            // If it's a closed path, return to start
            if (childPath.closed) {
              gcode.push('G1 X' + firstPoint.x.toFixed(3) + ' Y' + firstPoint.y.toFixed(3) + ' F' + settings.feedRate + ' ; Return to start');
            }
            
            // Return to safe height between contours
            gcode.push('G0 Z' + safeZ + ' ; Return to safe height');
          }
        }
      });
    }
  } else if (path.data && path.data.type === 'drill') {
    // For drilling operations
    if (path.data.center) {
      const center = path.data.center;
      
      gcode.push('G0 Z' + safeZ + ' ; Safe height');
      gcode.push('G0 X' + center.x.toFixed(3) + ' Y' + center.y.toFixed(3) + ' ; Move to drill position');
      
      // Simple drilling - could be enhanced with peck drilling for deep holes
      gcode.push('G1 Z-' + settings.cutDepth.toFixed(3) + ' F' + settings.plungeRate + ' ; Drill to depth');
      gcode.push('G0 Z' + safeZ + ' ; Return to safe height');
    }
  }
  
  return gcode.join('\n');
}

// Generate G-code for a set of paths
export function generateGcodeFromPaths(paths, settings) {
  let gcode = [];
  
  // Header
  gcode.push('; Generated by CNC Control CAD/CAM');
  gcode.push('; ' + new Date().toISOString());
  gcode.push('');
  gcode.push('G21 ; Set units to millimeters');
  gcode.push('G90 ; Absolute positioning');
  gcode.push('G17 ; XY plane selection');
  gcode.push('G54 ; Use workspace coordinate system 1');
  gcode.push('');
  
  // Process each path
  paths.forEach((path, index) => {
    gcode.push('; Path ' + (index + 1) + ' of ' + paths.length);
    
    // Generate G-code for this path
    const pathGcode = generateGcodeFromPath(path, settings);
    gcode.push(pathGcode);
    
    gcode.push('');
  });
  
  // Footer
  gcode.push('G0 Z10 ; Move to safe Z height');
  gcode.push('G0 X0 Y0 ; Return to origin');
  gcode.push('M5 ; Stop spindle');
  gcode.push('M30 ; End program');
  
  return gcode.join('\n');
}