import logging

logger = logging.getLogger(__name__)

class GCodeGenerator:
    """
    Generates G-code from 2D toolpaths.
    """
    
    def __init__(self):
        self.settings = {
            'feed_rate': 500,     # Default feed rate in mm/min
            'plunge_rate': 200,   # Default plunge rate in mm/min
            'safe_z': 5,          # Safe Z height for travel moves
            'cut_depth': -1.0,    # Default cutting depth in mm
            'tool_diameter': 3.0  # Default tool diameter in mm
        }
    
    def generate(self, toolpaths, settings=None):
        """
        Generate G-code from toolpaths.
        
        Args:
            toolpaths (list): List of toolpath objects
            settings (dict, optional): Settings for G-code generation
            
        Returns:
            str: Generated G-code
        """
        if settings:
            # Update settings with provided values
            self.settings.update(settings)
        
        gcode = []
        
        # Add header
        gcode.append("G21 ; Set units to millimeters")
        gcode.append("G90 ; Absolute positioning")
        gcode.append(f"G0 Z{self.settings['safe_z']} ; Move to safe height")
        
        # Process each toolpath
        for toolpath in toolpaths:
            type_handlers = {
                'line': self._process_line,
                # Add handlers for other types as needed
            }
            
            handler = type_handlers.get(toolpath['type'])
            if handler:
                gcode.extend(handler(toolpath['data']))
            else:
                logger.warning(f"Unsupported toolpath type: {toolpath['type']}")
        
        # Add footer
        gcode.append(f"G0 Z{self.settings['safe_z']} ; Return to safe height")
        gcode.append("G0 X0 Y0 ; Return to origin")
        
        return '\n'.join(gcode)
    
    def _process_line(self, line_data):
        """Process a line toolpath."""
        gcode = []
        
        start_x = line_data['start']['x']
        start_y = line_data['start']['y']
        end_x = line_data['end']['x']
        end_y = line_data['end']['y']
        
        # Move to start position at safe height
        gcode.append(f"G0 X{start_x} Y{start_y} ; Move to start position")
        
        # Plunge to cutting depth
        gcode.append(f"G1 Z{self.settings['cut_depth']} F{self.settings['plunge_rate']} ; Plunge to cutting depth")
        
        # Cut to end position
        gcode.append(f"G1 X{end_x} Y{end_y} F{self.settings['feed_rate']} ; Cut to end position")
        
        # Return to safe height
        gcode.append(f"G0 Z{self.settings['safe_z']} ; Return to safe height")
        
        return gcode