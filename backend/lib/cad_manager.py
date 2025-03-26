# backend/lib/cad_manager.py
import json
import logging
import math
from datetime import datetime
from copy import deepcopy

logger = logging.getLogger(__name__)

class CADManager:
    """
    Handles CAD/CAM operations and toolpath generation on the backend
    """
    
    def __init__(self):
        # No need for direct GCode parser reference since we'll generate G-code
        pass
    
    def generate_toolpath(self, shapes, operation, settings):
        """
        Generate toolpath for shapes with specified operation and settings
        
        Args:
            shapes (list): List of shape definitions
            operation (str): Type of operation ('profile', 'pocket', 'drill')
            settings (dict): CAM settings
            
        Returns:
            dict: Generated toolpath data
        """
        try:
            logger.info(f"Generating {operation} toolpath for {len(shapes)} shapes")
            
            # Process based on operation type
            if operation == 'profile':
                return self._generate_profile_toolpath(shapes, settings)
            elif operation == 'pocket':
                return self._generate_pocket_toolpath(shapes, settings)
            elif operation == 'drill':
                return self._generate_drill_toolpath(shapes, settings)
            else:
                logger.error(f"Unknown operation type: {operation}")
                return {
                    'success': False,
                    'error': f"Unknown operation type: {operation}"
                }
                
        except Exception as e:
            logger.error(f"Error generating toolpath: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _generate_profile_toolpath(self, shapes, settings):
        """Generate profile (outline) toolpath"""
        try:
            toolpaths = []
            
            for shape in shapes:
                # For each shape, generate a profile path
                shape_type = shape.get('type', 'unknown')
                
                if shape_type == 'circle':
                    # For circles, create an offset circle
                    center_x = shape.get('center_x', 0)
                    center_y = shape.get('center_y', 0)
                    radius = shape.get('radius', 10)
                    tool_radius = settings.get('toolDiameter', 3.175) / 2
                    
                    # Calculate offset (outside or inside the profile)
                    offset_radius = radius + tool_radius  # Assuming outside cut
                    
                    # Create path segments (for a circle, approximate with points)
                    segments = []
                    num_points = 36  # Number of points to approximate circle
                    
                    for i in range(num_points + 1):
                        angle = 2 * math.pi * i / num_points
                        x = center_x + offset_radius * math.cos(angle)
                        y = center_y + offset_radius * math.sin(angle)
                        segments.append({'x': x, 'y': y})
                    
                    toolpaths.append({
                        'type': 'profile',
                        'shape_type': 'circle',
                        'original_shape': shape,
                        'segments': segments,
                        'closed': True
                    })
                    
                elif shape_type == 'rectangle':
                    # For rectangles, create an offset rectangle
                    x = shape.get('x', 0)
                    y = shape.get('y', 0)
                    width = shape.get('width', 10)
                    height = shape.get('height', 10)
                    tool_radius = settings.get('toolDiameter', 3.175) / 2
                    
                    # Calculate offset (outside the profile)
                    offset_x = x - tool_radius
                    offset_y = y - tool_radius
                    offset_width = width + 2 * tool_radius
                    offset_height = height + 2 * tool_radius
                    
                    # Create path segments for rectangle
                    segments = [
                        {'x': offset_x, 'y': offset_y},                           # Top-left
                        {'x': offset_x + offset_width, 'y': offset_y},            # Top-right
                        {'x': offset_x + offset_width, 'y': offset_y + offset_height},  # Bottom-right
                        {'x': offset_x, 'y': offset_y + offset_height},           # Bottom-left
                        {'x': offset_x, 'y': offset_y}                            # Back to start
                    ]
                    
                    toolpaths.append({
                        'type': 'profile',
                        'shape_type': 'rectangle',
                        'original_shape': shape,
                        'segments': segments,
                        'closed': True
                    })
                    
                elif shape_type == 'line':
                    # For lines, just follow the line with the tool center
                    x1 = shape.get('x1', 0)
                    y1 = shape.get('y1', 0)
                    x2 = shape.get('x2', 10)
                    y2 = shape.get('y2', 10)
                    
                    # Create path segments for line
                    segments = [
                        {'x': x1, 'y': y1},
                        {'x': x2, 'y': y2}
                    ]
                    
                    toolpaths.append({
                        'type': 'profile',
                        'shape_type': 'line',
                        'original_shape': shape,
                        'segments': segments,
                        'closed': False
                    })
            
            return {
                'success': True,
                'toolpaths': toolpaths
            }
            
        except Exception as e:
            logger.error(f"Error generating profile toolpath: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _generate_pocket_toolpath(self, shapes, settings):
        """Generate pocket toolpath"""
        try:
            toolpaths = []
            
            for shape in shapes:
                # Only process closed shapes for pocketing
                shape_type = shape.get('type', 'unknown')
                
                if shape_type == 'circle':
                    # For circles, create concentric circles inward
                    center_x = shape.get('center_x', 0)
                    center_y = shape.get('center_y', 0)
                    radius = shape.get('radius', 10)
                    tool_diameter = settings.get('toolDiameter', 3.175)
                    tool_radius = tool_diameter / 2
                    step_over = settings.get('stepOver', 40) / 100  # Convert to decimal
                    
                    # Calculate step size
                    step_size = tool_diameter * step_over
                    
                    # Generate concentric circles
                    contours = []
                    current_radius = radius - tool_radius  # Start inside the shape
                    
                    while current_radius > tool_radius:
                        # Create a contour at this radius
                        segments = []
                        num_points = 36  # Number of points to approximate circle
                        
                        for i in range(num_points + 1):
                            angle = 2 * math.pi * i / num_points
                            x = center_x + current_radius * math.cos(angle)
                            y = center_y + current_radius * math.sin(angle)
                            segments.append({'x': x, 'y': y})
                        
                        contours.append({
                            'segments': segments,
                            'closed': True
                        })
                        
                        # Reduce radius for next contour
                        current_radius -= step_size
                    
                    # Add a final point at the center if needed
                    if current_radius <= tool_radius:
                        contours.append({
                            'segments': [{'x': center_x, 'y': center_y}],
                            'closed': False
                        })
                    
                    toolpaths.append({
                        'type': 'pocket',
                        'shape_type': 'circle',
                        'original_shape': shape,
                        'contours': contours
                    })
                    
                elif shape_type == 'rectangle':
                    # For rectangles, create inset rectangles
                    x = shape.get('x', 0)
                    y = shape.get('y', 0)
                    width = shape.get('width', 10)
                    height = shape.get('height', 10)
                    tool_diameter = settings.get('toolDiameter', 3.175)
                    tool_radius = tool_diameter / 2
                    step_over = settings.get('stepOver', 40) / 100  # Convert to decimal
                    
                    # Calculate step size
                    step_size = tool_diameter * step_over
                    
                    # Generate inset rectangles
                    contours = []
                    inset = tool_radius  # Start with tool radius inset
                    
                    while inset < min(width / 2, height / 2):
                        # Create a contour at this inset
                        segments = [
                            {'x': x + inset, 'y': y + inset},                             # Top-left
                            {'x': x + width - inset, 'y': y + inset},                     # Top-right
                            {'x': x + width - inset, 'y': y + height - inset},            # Bottom-right
                            {'x': x + inset, 'y': y + height - inset},                    # Bottom-left
                            {'x': x + inset, 'y': y + inset}                              # Back to start
                        ]
                        
                        contours.append({
                            'segments': segments,
                            'closed': True
                        })
                        
                        # Increase inset for next contour
                        inset += step_size
                    
                    # Add a central point if needed
                    if inset >= min(width / 2, height / 2):
                        contours.append({
                            'segments': [{'x': x + width / 2, 'y': y + height / 2}],
                            'closed': False
                        })
                    
                    toolpaths.append({
                        'type': 'pocket',
                        'shape_type': 'rectangle',
                        'original_shape': shape,
                        'contours': contours
                    })
            
            return {
                'success': True,
                'toolpaths': toolpaths
            }
            
        except Exception as e:
            logger.error(f"Error generating pocket toolpath: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def _generate_drill_toolpath(self, shapes, settings):
        """Generate drilling toolpath"""
        try:
            toolpaths = []
            
            for shape in shapes:
                shape_type = shape.get('type', 'unknown')
                
                if shape_type == 'circle':
                    # Use the center of the circle as the drill point
                    center_x = shape.get('center_x', 0)
                    center_y = shape.get('center_y', 0)
                    
                    toolpaths.append({
                        'type': 'drill',
                        'shape_type': 'circle',
                        'original_shape': shape,
                        'point': {'x': center_x, 'y': center_y},
                        'depth': settings.get('cutDepth', 5.0)
                    })
                
                elif shape_type == 'point':
                    # Direct drill at the point
                    x = shape.get('x', 0)
                    y = shape.get('y', 0)
                    
                    toolpaths.append({
                        'type': 'drill',
                        'shape_type': 'point',
                        'original_shape': shape,
                        'point': {'x': x, 'y': y},
                        'depth': settings.get('cutDepth', 5.0)
                    })
            
            return {
                'success': True,
                'toolpaths': toolpaths
            }
            
        except Exception as e:
            logger.error(f"Error generating drill toolpath: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def generate_gcode(self, toolpaths, settings=None):
        """
        Generate G-code from toolpaths
        
        Args:
            toolpaths (list): List of toolpath definitions
            settings (dict): Additional settings, optional
            
        Returns:
            dict: Generated G-code data
        """
        try:
            logger.info(f"Generating G-code from {len(toolpaths)} toolpaths")
            
            # G-code header
            gcode = []
            gcode.append('; Generated by CNC Control CAD/CAM')
            gcode.append(f'; {datetime.now().isoformat()}')
            gcode.append('')
            gcode.append('G21 ; Set units to millimeters')
            gcode.append('G90 ; Absolute positioning')
            gcode.append('G17 ; XY plane selection')
            gcode.append('G54 ; Use workspace coordinate system 1')
            gcode.append('')
            
            safe_z = settings.get('safeZ', 5) if settings else 5
            
            # Process each toolpath
            for i, toolpath in enumerate(toolpaths):
                operation = toolpath.get('type', 'unknown')
                toolpath_settings = toolpath.get('settings', {})
                
                # Merge settings
                if settings:
                    merged_settings = settings.copy()
                    merged_settings.update(toolpath_settings)
                else:
                    merged_settings = toolpath_settings
                
                # Get operation-specific parameters
                cut_depth = merged_settings.get('cutDepth', 1.0)
                step_depth = merged_settings.get('stepDepth', 0.5)
                feed_rate = merged_settings.get('feedRate', 500)
                plunge_rate = merged_settings.get('plungeRate', 200)
                
                gcode.append(f'; Toolpath {i+1}: {operation}')
                
                # Calculate number of passes based on cut depth and step depth
                total_passes = math.ceil(cut_depth / step_depth)
                actual_step_depth = cut_depth / total_passes  # Recalculate for even steps
                
                if operation == 'profile':
                    # Process profile toolpath
                    segments = toolpath.get('segments', [])
                    closed = toolpath.get('closed', False)
                    
                    if segments:
                        # Move to start position
                        gcode.append(f'G0 Z{safe_z} ; Move to safe height')
                        gcode.append(f'G0 X{segments[0]["x"]:.3f} Y{segments[0]["y"]:.3f} ; Move to start position')
                        
                        # Process each depth pass
                        for pass_num in range(1, total_passes + 1):
                            current_depth = pass_num * actual_step_depth
                            
                            gcode.append(f'; Pass {pass_num}/{total_passes} - Depth: {current_depth:.3f}mm')
                            gcode.append(f'G1 Z-{current_depth:.3f} F{plunge_rate} ; Plunge to depth')
                            
                            # Cut through all segments
                            for j in range(1, len(segments)):
                                segment = segments[j]
                                gcode.append(f'G1 X{segment["x"]:.3f} Y{segment["y"]:.3f} F{feed_rate} ; Cut to point')
                            
                            # If closed, return to start
                            if closed and len(segments) > 1:
                                gcode.append(f'G1 X{segments[0]["x"]:.3f} Y{segments[0]["y"]:.3f} F{feed_rate} ; Return to start')
                            
                            # Retract before next pass
                            gcode.append(f'G0 Z{safe_z} ; Retract to safe height')
                    
                elif operation == 'pocket':
                    # Process pocket toolpath
                    contours = toolpath.get('contours', [])
                    
                    for contour_index, contour in enumerate(contours):
                        segments = contour.get('segments', [])
                        closed = contour.get('closed', False)
                        
                        if not segments:
                            continue
                        
                        gcode.append(f'; Pocket contour {contour_index + 1}/{len(contours)}')
                        
                        # Move to start position
                        gcode.append(f'G0 Z{safe_z} ; Move to safe height')
                        gcode.append(f'G0 X{segments[0]["x"]:.3f} Y{segments[0]["y"]:.3f} ; Move to start position')
                        
                        # Process each depth pass
                        for pass_num in range(1, total_passes + 1):
                            current_depth = pass_num * actual_step_depth
                            
                            gcode.append(f'; Pass {pass_num}/{total_passes} - Depth: {current_depth:.3f}mm')
                            gcode.append(f'G1 Z-{current_depth:.3f} F{plunge_rate} ; Plunge to depth')
                            
                            # For single point (center), just dwell
                            if len(segments) == 1:
                                gcode.append(f'G4 P0.5 ; Dwell for 0.5 seconds')
                            else:
                                # Cut through all segments
                                for j in range(1, len(segments)):
                                    segment = segments[j]
                                    gcode.append(f'G1 X{segment["x"]:.3f} Y{segment["y"]:.3f} F{feed_rate} ; Cut to point')
                                
                                # If closed, return to start
                                if closed and len(segments) > 1:
                                    gcode.append(f'G1 X{segments[0]["x"]:.3f} Y{segments[0]["y"]:.3f} F{feed_rate} ; Return to start')
                            
                            # Retract before next pass or contour
                            gcode.append(f'G0 Z{safe_z} ; Retract to safe height')
                
                elif operation == 'drill':
                    # Process drill operation
                    point = toolpath.get('point', {})
                    depth = toolpath.get('depth', cut_depth)
                    
                    if point:
                        gcode.append(f'; Drill at X{point["x"]:.3f} Y{point["y"]:.3f} to depth {depth:.3f}mm')
                        gcode.append(f'G0 Z{safe_z} ; Move to safe height')
                        gcode.append(f'G0 X{point["x"]:.3f} Y{point["y"]:.3f} ; Move to drill position')
                        
                        # For deeper holes, use peck drilling
                        if depth > 3 * step_depth:
                            gcode.append('; Peck drilling cycle')
                            current_depth = 0
                            
                            while current_depth < depth:
                                # Increment depth
                                current_depth += step_depth
                                if current_depth > depth:
                                    current_depth = depth
                                
                                # Drill to current depth
                                gcode.append(f'G1 Z-{current_depth:.3f} F{plunge_rate} ; Peck to depth {current_depth:.3f}mm')
                                
                                # Retract slightly to clear chips (except on final peck)
                                if current_depth < depth:
                                    retract_height = 1.0  # 1mm retract
                                    gcode.append(f'G0 Z-{current_depth - retract_height:.3f} ; Retract for chip clearing')
                                    
                            # Final retract
                            gcode.append(f'G0 Z{safe_z} ; Retract to safe height')
                        else:
                            # Simple drilling for shallow holes
                            gcode.append(f'G1 Z-{depth:.3f} F{plunge_rate} ; Drill to depth')
                            gcode.append(f'G0 Z{safe_z} ; Retract to safe height')
                
                gcode.append('')
            
            # G-code footer
            gcode.append('G0 Z30 ; Move to safe Z height')
            gcode.append('G0 X0 Y0 ; Return to origin')
            gcode.append('M5 ; Stop spindle')
            gcode.append('M30 ; End program')
            
            return {
                'success': True,
                'gcode': '\n'.join(gcode)
            }
                
        except Exception as e:
            logger.error(f"Error generating G-code: {str(e)}")
            return {
                'success': False,
                'error': str(e)
            }

    def process_imported_file(self, file_data, file_type):
        """
        Process imported CAD files (DXF, SVG, etc.)
        
        Args:
            file_data (bytes): File content
            file_type (str): File type extension (dxf, svg, etc.)
            
        Returns:
            dict: Processed shapes
        """
        # This would require additional libraries like ezdxf for DXF or svg.path for SVG
        # This is a placeholder for future implementation
        logger.warning(f"File import for {file_type} not fully implemented yet")
        
        return {
            'success': False,
            'error': f"Import for {file_type} files is not supported yet"
        }