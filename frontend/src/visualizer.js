// G-code visualization functionality
let scene, camera, renderer, controls;
let gridHelper, toolpathGroup, rapidGroup, toolMesh;
let animationFrameId;
let currentVisualizationData;

export function initVisualizer(appState) {
  // Check if THREE.js is available
  if (typeof THREE === 'undefined') {
    console.error('THREE.js is not loaded. Visualization features will not be available.');
    appState.addConsoleMessage('error', 'Visualization library not loaded.');
    return;
  }
  
  const container = document.getElementById('visualizer-container');
  if (!container) {
    console.error('Visualizer container not found');
    return;
  }
  
  console.log('Initializing visualizer with container dimensions:', container.clientWidth, 'x', container.clientHeight);
  
  // Check if container has valid dimensions
  if (container.clientWidth <= 0 || container.clientHeight <= 0) {
    console.error('Visualizer container has invalid dimensions');
    appState.addConsoleMessage('error', 'Visualizer container has invalid dimensions. Check CSS.');
    // Force some minimums to attempt to render anyway
    container.style.width = '400px';
    container.style.height = '300px';
  }
  
  const width = Math.max(container.clientWidth, 400);
  const height = Math.max(container.clientHeight, 300);
  
  // Create scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a2a); // Darker background to see more clearly
  
  // Create camera with a reasonable field of view
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
  camera.position.set(100, 100, 100);
  camera.lookAt(0, 0, 0);
  
  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);
  
  console.log('Renderer created with size:', width, 'x', height);
  
  // Add orbit controls
  if (typeof THREE.OrbitControls !== 'undefined') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    console.log('OrbitControls initialized');
  } else {
    console.warn('THREE.OrbitControls not found, controls will not be available');
  }
  
  // Create lighting
  const ambientLight = new THREE.AmbientLight(0x606060); // Brighter ambient light
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); // Stronger lighting
  directionalLight.position.set(1, 1, 1);
  scene.add(directionalLight);
  
  // Add grid helper - make it more visible
  gridHelper = new THREE.GridHelper(200, 20, 0x888888, 0x444444);
  scene.add(gridHelper);
  
  // Add axes helper - make it larger
  const axesHelper = new THREE.AxesHelper(100);
  scene.add(axesHelper);
  
  // Create groups for toolpaths
  toolpathGroup = new THREE.Group();
  rapidGroup = new THREE.Group();
  scene.add(toolpathGroup);
  scene.add(rapidGroup);
  
  // Create tool representation - make it more visible
  const toolGeometry = new THREE.CylinderGeometry(3, 0, 15, 12);
  toolGeometry.rotateX(Math.PI);
  const toolMaterial = new THREE.MeshPhongMaterial({ color: 0xffff00, emissive: 0x444400 });
  toolMesh = new THREE.Mesh(toolGeometry, toolMaterial);
  toolMesh.position.set(0, 0, 0);
  scene.add(toolMesh);
  
  // Add a cube at origin as a visual reference
  const cubeGeometry = new THREE.BoxGeometry(10, 10, 10);
  const cubeMaterial = new THREE.MeshPhongMaterial({ color: 0xff8800 });
  const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cube.position.set(0, 0, 0);
  scene.add(cube);
  
  console.log('3D scene set up complete, starting render loop');
  
  // Start render loop
  animate();
  
  // Handle window resize
  window.addEventListener('resize', () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    if (width > 0 && height > 0) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      console.log('Resized visualizer to:', width, 'x', height);
    }
  });
  
  // Expose needed methods globally
  window.updateToolPosition = updateToolPosition;
  window.handleGcodeVisualization = handleGcodeVisualization;
  window.clearVisualization = clearVisualization;
  
  // Force a test render immediately to check for WebGL issues
  renderer.render(scene, camera);
  
  console.log('Visualizer initialized successfully');
  
  // Force a test visualization with a simple cube for debugging
  createDebugVisualization();
}

// Create a simple test visualization to validate the renderer
function createDebugVisualization() {
  console.log('Creating debug visualization...');
  
  // Clear any existing visualization
  clearVisualization();
  
  // Create a simple test toolpath - square on XY plane
  const debugData = {
    segments: [
      { start: { x: 0, y: 0, z: 0 }, end: { x: 50, y: 0, z: 0 } },
      { start: { x: 50, y: 0, z: 0 }, end: { x: 50, y: 50, z: 0 } },
      { start: { x: 50, y: 50, z: 0 }, end: { x: 0, y: 50, z: 0 } },
      { start: { x: 0, y: 50, z: 0 }, end: { x: 0, y: 0, z: 0 } }
    ],
    rapids: [
      { start: { x: 0, y: 0, z: 10 }, end: { x: 0, y: 0, z: 0 } }
    ],
    bounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 50, z: 10 }
    }
  };
  
  // Create debug visualization
  createVisualization(debugData);
  console.log('Debug visualization created');
}

// Animation loop
function animate() {
  animationFrameId = requestAnimationFrame(animate);
  
  if (controls) controls.update();
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// Update tool position
function updateToolPosition(position) {
  if (!toolMesh) return;
  
  console.log('Updating tool position:', position);
  
  // Update tool position (note: Y and Z are swapped to match usual CNC coordinates)
  toolMesh.position.set(
    parseFloat(position.x), 
    parseFloat(position.z), 
    parseFloat(position.y)
  );
  
  // Update position overlay
  const visualizerInfo = document.getElementById('visualizer-info');
  if (visualizerInfo) {
    visualizerInfo.textContent = `Position: X:${position.x.toFixed(3)} Y:${position.y.toFixed(3)} Z:${position.z.toFixed(3)}`;
  }
}

/**
 * Converts a circular arc to a series of line segments.
 * 
 * @param {Object} start - Start point {x, y, z}
 * @param {Object} end - End point {x, y, z}
 * @param {number} i - X offset from start point to center
 * @param {number} j - Y offset from start point to center
 * @param {number} k - Z offset from start point to center (rarely used)
 * @param {boolean} clockwise - Whether the arc is clockwise (G2) or counterclockwise (G3)
 * @param {number} segments - Number of line segments to approximate the arc (default: 32)
 * @returns {Array} Array of line segments { start: {x,y,z}, end: {x,y,z} }
 */
function arcToSegments(start, end, i, j, k = 0, clockwise = true, segments = 32) {
  // Calculate the center of the arc
  const center = {
    x: start.x + i,
    y: start.y + j,
    z: start.z + k
  };
  
  // Calculate radius based on the distance from start to center
  const radius = Math.sqrt(i*i + j*j + k*k);
  
  // Calculate the start angle (from center to start point)
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  
  // Calculate the end angle (from center to end point)
  let endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  
  // Adjust end angle for proper arc direction
  if (clockwise) {
    while (endAngle > startAngle) endAngle -= 2 * Math.PI;
    while (endAngle <= startAngle - 2 * Math.PI) endAngle += 2 * Math.PI;
  } else {
    while (endAngle < startAngle) endAngle += 2 * Math.PI;
    while (endAngle >= startAngle + 2 * Math.PI) endAngle -= 2 * Math.PI;
  }
  
  // Calculate the total angle to sweep
  let totalAngle = Math.abs(endAngle - startAngle);
  
  // Create segment points
  const arcSegments = [];
  const angleStep = totalAngle / segments;
  
  // Calculate height change per angle unit
  const startToEndAngle = clockwise ? (startAngle - endAngle) : (endAngle - startAngle);
  const zStep = (end.z - start.z) / startToEndAngle;
  
  let prevPoint = { ...start };
  
  // Generate segments
  for (let i = 1; i <= segments; i++) {
    const angle = clockwise 
      ? startAngle - (angleStep * i)
      : startAngle + (angleStep * i);
    
    // Calculate the distance swept so far
    const sweepSoFar = clockwise 
      ? (startAngle - angle)
      : (angle - startAngle);
    
    // Calculate new point
    const newPoint = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
      z: start.z + (zStep * sweepSoFar)
    };
    
    // For the last segment, ensure we end exactly at the end point
    if (i === segments) {
      newPoint.x = end.x;
      newPoint.y = end.y;
      newPoint.z = end.z;
    }
    
    // Add segment
    arcSegments.push({
      start: { ...prevPoint },
      end: { ...newPoint }
    });
    
    prevPoint = { ...newPoint };
  }
  
  return arcSegments;
}

// Clear the visualization
export function clearVisualization() {
  console.log('Clearing visualization');
  
  if (toolpathGroup) {
    while (toolpathGroup.children.length) {
      const object = toolpathGroup.children[0];
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
      toolpathGroup.remove(object);
    }
  }
  
  if (rapidGroup) {
    while (rapidGroup.children.length) {
      const object = rapidGroup.children[0];
      if (object.geometry) object.geometry.dispose();
      if (object.material) object.material.dispose();
      rapidGroup.remove(object);
    }
  }
}

// Handle parsed G-code visualization
function handleGcodeVisualization(data) {
  console.log('Received G-code visualization data:', data);
  createVisualization(data);
}

// Create visualization from parsed data
function createVisualization(data) {
  // Store the visualization data
  currentVisualizationData = data;
  
  // Clear previous visualizations
  clearVisualization();
  
  if (!data) {
    console.error('No visualization data provided');
    return;
  }
  
  console.log('Creating visualization with data:', data);
  
  // Create toolpath lines
  if (data.segments && data.segments.length > 0) {
    console.log('Creating', data.segments.length, 'toolpath segments');
    
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
    
    data.segments.forEach((segment, i) => {
      if (!segment.start || !segment.end) {
        console.warn('Invalid segment at index', i, segment);
        return;
      }
      
      const geometry = new THREE.BufferGeometry();
      
      // Create points (note Y and Z are swapped to match usual CNC coordinates)
      const points = [
        new THREE.Vector3(segment.start.x, segment.start.z, segment.start.y),
        new THREE.Vector3(segment.end.x, segment.end.z, segment.end.y)
      ];
      
      geometry.setFromPoints(points);
      const line = new THREE.Line(geometry, material);
      toolpathGroup.add(line);
    });
  } else {
    console.warn('No toolpath segments found in data');
  }
  
  // Create rapid movement lines
  if (data.rapids && data.rapids.length > 0) {
    console.log('Creating', data.rapids.length, 'rapid movement segments');
    
    // Use LineDashedMaterial for dashed lines
    try {
      const material = new THREE.LineDashedMaterial({ 
        color: 0xff0000,
        dashSize: 5,
        gapSize: 2
      });
      
      data.rapids.forEach((segment, i) => {
        if (!segment.start || !segment.end) {
          console.warn('Invalid rapid segment at index', i, segment);
          return;
        }
        
        const geometry = new THREE.BufferGeometry();
        
        // Create points (note Y and Z are swapped to match usual CNC coordinates)
        const points = [
          new THREE.Vector3(segment.start.x, segment.start.z, segment.start.y),
          new THREE.Vector3(segment.end.x, segment.end.z, segment.end.y)
        ];
        
        geometry.setFromPoints(points);
        
        try {
          const line = new THREE.Line(geometry, material.clone());
          line.computeLineDistances(); // This is necessary for dashed lines
          rapidGroup.add(line);
        } catch (err) {
          console.error('Error creating dashed line:', err);
          // Fallback to basic line
          const basicMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
          const line = new THREE.Line(geometry, basicMaterial);
          rapidGroup.add(line);
        }
      });
    } catch (err) {
      console.error('Error with LineDashedMaterial, falling back to basic lines:', err);
      
      // Fallback to basic lines
      const basicMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
      
      data.rapids.forEach((segment, i) => {
        if (!segment.start || !segment.end) return;
        
        const geometry = new THREE.BufferGeometry();
        const points = [
          new THREE.Vector3(segment.start.x, segment.start.z, segment.start.y),
          new THREE.Vector3(segment.end.x, segment.end.z, segment.end.y)
        ];
        
        geometry.setFromPoints(points);
        const line = new THREE.Line(geometry, basicMaterial);
        rapidGroup.add(line);
      });
    }
  } else {
    console.warn('No rapid movements found in data');
  }
  
  // Adjust camera to view the entire toolpath
  if (data.bounds) {
    console.log('Adjusting camera to fit bounds:', data.bounds);
    
    const bounds = data.bounds;
    const center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2
    };
    
    // Calculate size with a minimum to prevent issues with flat workpieces
    const sizeX = Math.max(bounds.max.x - bounds.min.x, 10);
    const sizeY = Math.max(bounds.max.y - bounds.min.y, 10);
    const sizeZ = Math.max(bounds.max.z - bounds.min.z, 10);
    
    const size = Math.max(sizeX, sizeY, sizeZ);
    
    // Position camera at an angle
    camera.position.set(
      center.x + size * 1.2,
      center.z + size * 1.2,  // Z and Y swapped
      center.y + size * 1.2   // Z and Y swapped
    );
    
    controls.target.set(center.x, center.z, center.y);  // Z and Y swapped
    controls.update();
    
    console.log('Camera positioned at:', camera.position);
    console.log('Camera looking at:', controls.target);
  } else {
    console.warn('No bounds information found in data');
    
    // Default camera position if no bounds
    camera.position.set(100, 100, 100);
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }
}

// Clean up resources
export function cleanupVisualizer() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  
  // Dispose of all geometries and materials
  clearVisualization();
  
  // Dispose of tool mesh
  if (toolMesh) {
    if (toolMesh.geometry) toolMesh.geometry.dispose();
    if (toolMesh.material) toolMesh.material.dispose();
    scene.remove(toolMesh);
  }
  
  // Dispose of grid helper
  if (gridHelper) {
    scene.remove(gridHelper);
  }
  
  // Remove renderer DOM element
  if (renderer && renderer.domElement) {
    renderer.domElement.remove();
  }
  
  // Clear all references
  scene = null;
  camera = null;
  renderer = null;
  controls = null;
  gridHelper = null;
  toolpathGroup = null;
  rapidGroup = null;
  toolMesh = null;
  currentVisualizationData = null;
}