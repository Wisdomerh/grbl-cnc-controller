# backend/gcode_parser.py
import re
import logging
import json
import math
import numpy as np
from enum import Enum

logger = logging.getLogger(__name__)

class GCodeMode(Enum):
    ABSOLUTE = 0    # G90
    RELATIVE = 1    # G91
    
class GCodePlane(Enum):
    XY = 0          # G17
    ZX = 1          # G18
    YZ = 2          # G19
    
class CoordinateSystem(Enum):
    G54 = 0         # Default work coordinate system
    G55 = 1
    G56 = 2
    G57 = 3
    G58 = 4
    G59 = 5

class GCodeParser:
    """
    Parser for G-code to extract toolpaths and generate visualization data.
    """
    
    def __init__(self):
        self.reset()
    
    def reset(self):
        """Reset parser state to default values"""
        self.position = {
            'x': 0.0,
            'y': 0.0,
            'z': 0.0
        }
        self.tool_position = {
            'x': 0.0,
            'y': 0.0,
            'z': 0.0
        }
        self.feed_rate = 0
        self.spindle_speed = 0
        self.mode = GCodeMode.ABSOLUTE
        self.plane = GCodePlane.XY
        self.coord_system = CoordinateSystem.G54
        self.positions = []     # List of points representing the toolpath
        self.segments = []      # List of line segments with metadata
        self.rapids = []        # List of rapid movements
        self.min_point = {'x': float('inf'), 'y': float('inf'), 'z': float('inf')}
        self.max_point = {'x': float('-inf'), 'y': float('-inf'), 'z': float('-inf')}
        
    def parse(self, gcode):
        """
        Parse G-code and extract toolpath information
        
        Args:
            gcode (str): G-code content as a string
            
        Returns:
            dict: Parsed toolpath data
        """
        self.reset()
        
        lines = gcode.splitlines()
        line_count = 0
        
        for line in lines:
            line_count += 1
            
            # Strip comments and whitespace
            line = self._strip_comments(line).strip()
            
            if not line:
                continue
                
            try:
                self._parse_line(line, line_count)
            except Exception as e:
                logger.error(f"Error parsing line {line_count}: {line}, Error: {str(e)}")
        
        # Build visualization data
        visualization_data = {
            'segments': self.segments,
            'rapids': self.rapids,
            'bounds': {
                'min': self.min_point,
                'max': self.max_point
            }
        }
        
        return visualization_data
    
    def _strip_comments(self, line):
        """Remove comments from G-code line"""
        # Remove parenthetical comments
        line = re.sub(r'\(.*?\)', '', line)
        
        # Remove semicolon comments
        if ';' in line:
            line = line.split(';')[0]
            
        return line
    
    def _update_bounds(self, x=None, y=None, z=None):
        """Update bounding box with new coordinates"""
        if x is not None:
            self.min_point['x'] = min(self.min_point['x'], x)
            self.max_point['x'] = max(self.max_point['x'], x)
        
        if y is not None:
            self.min_point['y'] = min(self.min_point['y'], y)
            self.max_point['y'] = max(self.max_point['y'], y)
            
        if z is not None:
            self.min_point['z'] = min(self.min_point['z'], z)
            self.max_point['z'] = max(self.max_point['z'], z)
    
    def _add_segment(self, start, end, is_rapid=False, feed_rate=None, line_number=None):
        """Add a line segment to the toolpath with metadata"""
        # Update bounding box
        self._update_bounds(end['x'], end['y'], end['z'])
        
        segment = {
            'start': {k: v for k, v in start.items()},
            'end': {k: v for k, v in end.items()},
            'feed_rate': feed_rate or self.feed_rate,
            'is_rapid': is_rapid,
            'line': line_number
        }
        
        if is_rapid:
            self.rapids.append(segment)
        else:
            self.segments.append(segment)
        
        # Add position to the sequence
        self.positions.append(end.copy())
        
    def _parse_line(self, line, line_number):
        """Parse a single line of G-code"""
        # Extract commands with regex
        commands = re.findall(r'([A-Z])([+\-]?\d*\.?\d*)', line)
        
        if not commands:
            return
        
        # Make a copy of the current position as the start point
        start_point = self.position.copy()
        has_movement = False
        is_rapid = False
        new_position = self.position.copy()
        
        for code, value in commands:
            value = float(value) if value else 0
            
            # G-code command interpretation
            if code == 'G':
                if value == 0:
                    # Rapid positioning
                    is_rapid = True
                elif value == 1:
                    # Linear interpolation
                    is_rapid = False
                elif value == 2 or value == 3:
                    # Circular interpolation (CW/CCW)
                    # Note: Circular movements are simplified as linear for visualization
                    is_rapid = False
                elif value == 17:
                    # XY plane selection
                    self.plane = GCodePlane.XY
                elif value == 18:
                    # ZX plane selection
                    self.plane = GCodePlane.ZX
                elif value == 19:
                    # YZ plane selection
                    self.plane = GCodePlane.YZ
                elif value == 20:
                    # Inch units
                    # We're assuming mm for this implementation
                    logger.warning("Inch units detected (G20). This parser uses mm.")
                elif value == 21:
                    # Millimeter units
                    pass  # Already using mm
                elif value == 90:
                    # Absolute positioning
                    self.mode = GCodeMode.ABSOLUTE
                elif value == 91:
                    # Relative positioning
                    self.mode = GCodeMode.RELATIVE
                elif value == 54:
                    # Coordinate system G54
                    self.coord_system = CoordinateSystem.G54
                elif value in [55, 56, 57, 58, 59]:
                    # Other coordinate systems
                    self.coord_system = CoordinateSystem(value - 54)
                    
            # Set feed rate
            elif code == 'F':
                self.feed_rate = value
                
            # Set spindle speed
            elif code == 'S':
                self.spindle_speed = value
                
            # Movement commands
            elif code in ['X', 'Y', 'Z']:
                has_movement = True
                axis = code.lower()
                
                # Handle absolute vs. relative positioning
                if self.mode == GCodeMode.ABSOLUTE:
                    new_position[axis] = value
                else:
                    new_position[axis] += value
        
        # If there's a movement, add it to the toolpath
        if has_movement:
            self._add_segment(
                start_point, 
                new_position, 
                is_rapid=is_rapid, 
                feed_rate=self.feed_rate,
                line_number=line_number
            )
            
            # Update current position
            self.position = new_position.copy()
            
            # Update tool position for real-time display
            self.tool_position = new_position.copy()

    def get_visualization_json(self):
        """Get JSON data for visualization in frontend"""
        data = {
            'segments': self.segments,
            'rapids': self.rapids,
            'bounds': {
                'min': self.min_point,
                'max': self.max_point
            },
            'dimensions': {
                'x': self.max_point['x'] - self.min_point['x'],
                'y': self.max_point['y'] - self.min_point['y'],
                'z': self.max_point['z'] - self.min_point['z']
            }
        }
        
        return json.dumps(data)