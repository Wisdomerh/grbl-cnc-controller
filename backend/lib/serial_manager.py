# Updated serial_manager.py with dual coordinate tracking

import serial
import serial.tools.list_ports
import threading
import time
import queue
import re
import logging
import json
import asyncio


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GRBLSerialManager:
    """
    Manages serial communication with GRBL devices.
    Handles connection, command sending, and response parsing.
    """
    
    def __init__(self):
        self.serial_port = None
        self.is_connected = False
        self.command_queue = queue.Queue()
        self.response_queue = queue.Queue()
        self.running = False
        self.sender_thread = None
        self.reader_thread = None
        self.status_thread = None
        self.machine_status = {
            'state': 'Disconnected',
            'mpos': {'x': 0.0, 'y': 0.0, 'z': 0.0},  # Machine position
            'wpos': {'x': 0.0, 'y': 0.0, 'z': 0.0},  # Work position
            'wco': {'x': 0.0, 'y': 0.0, 'z': 0.0},   # Work coordinate offset
            'feed_rate': 0,
            'spindle_speed': 0
        }
        self.callbacks = {
            'on_state_change': None,
            'on_position_update': None,
            'on_error': None,
            'on_message': None
        }
        # Initialize the queue lock
        self.queue_lock = threading.Lock()
    
    def list_ports(self):
        """List all available serial ports"""
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append({
                'device': port.device,
                'description': port.description,
                'hwid': port.hwid
            })
        return ports
    
    def connect(self, port, baud_rate=115200, timeout=2):
        """Connect to GRBL device with improved timeout settings"""
        if self.is_connected:
            self.disconnect()
            
        try:
            # Connect to serial port with longer timeouts
            self.serial_port = serial.Serial(
                port, 
                baud_rate, 
                timeout=timeout,      # Read timeout
                write_timeout=2.0     # Write timeout - longer to prevent timeouts
            )
            
            # Clear startup text
            self.serial_port.reset_input_buffer()
            time.sleep(2)  # Give GRBL time to initialize
            
            # Check if it's a GRBL device (more lenient check)
            self.serial_port.write(b'\r\n\r\n')  # Wake up GRBL
            time.sleep(2)

            # Try to read multiple lines in case there's startup info
            response = ""
            for _ in range(5):  # Try reading up to 5 lines
                if self.serial_port.in_waiting:
                    line = self.serial_port.readline().decode('utf-8', errors='ignore').strip()
                    response += line + "\n"
                    # If we see GRBL, we're good
                    if 'Grbl' in line or 'grbl' in line.lower() or line == 'ok':
                        logger.info(f"GRBL detected with response: {line}")
                        break
                else:
                    time.sleep(0.5)

            # If no response, try sending a status query
            if not response.strip():
                logger.info("No initial response, trying status query")
                self.serial_port.write(b'?')
                time.sleep(1)
                if self.serial_port.in_waiting:
                    response = self.serial_port.readline().decode('utf-8', errors='ignore').strip()

            # Check if we got any response at all
            if not response.strip():
                self.serial_port.close()
                error_msg = "No response from device"
                logger.error(error_msg)
                if self.callbacks['on_error']:
                    self.callbacks['on_error'](error_msg)
                return False

            # If we made it here, assume it's a GRBL device
            logger.info(f"Connected to device with response: {response}")
                
            # Start communication threads
            self.running = True
            self.is_connected = True
            self.sender_thread = threading.Thread(target=self._command_sender, daemon=True)
            self.reader_thread = threading.Thread(target=self._response_reader, daemon=True)
            self.status_thread = threading.Thread(target=self._status_poller, daemon=True)
            
            self.sender_thread.start()
            self.reader_thread.start()
            self.status_thread.start()
            
            # Update machine state
            self.machine_status['state'] = 'Idle'
            if self.callbacks['on_state_change']:
                self.callbacks['on_state_change'](self.machine_status['state'])
            
            # Request initial position - request both WCO and position in one command
            self.send_immediate_command('$G')  # Get parser state
            self.send_immediate_command('$#')  # Get coordinate parameters
            self.send_immediate_command('?')   # Get status with position
                
            logger.info(f"Connected to GRBL device on {port}")
            return True
            
        except serial.SerialException as e:
            error_msg = f"Error connecting to port {port}: {str(e)}"
            logger.error(error_msg)
            if self.callbacks['on_error']:
                self.callbacks['on_error'](error_msg)
            return False
    
    def disconnect(self):
        """Disconnect from GRBL device"""
        if not self.is_connected:
            return
            
        self.running = False
        time.sleep(0.5)  # Give threads time to finish
        
        if self.serial_port and self.serial_port.is_open:
            self.serial_port.close()
            
        self.is_connected = False
        self.machine_status['state'] = 'Disconnected'
        
        if self.callbacks['on_state_change']:
            self.callbacks['on_state_change'](self.machine_status['state'])
            
        logger.info("Disconnected from GRBL device")
    
    def send_immediate_command(self, command, log=True, max_retries=3):
        """Send a command immediately, bypassing the queue, with retry logic"""
        if not self.is_connected:
            error_msg = "Cannot send command: Not connected to GRBL device"
            logger.error(error_msg)
            if self.callbacks['on_error']:
                self.callbacks['on_error'](error_msg)
            return False
        
        retries = 0
        while retries < max_retries:
            try:
                cmd = command.strip() + '\n'
                self.serial_port.write(cmd.encode())
                
                if log:  # Only log if requested
                    logger.debug(f"Sent immediate command: {command}")
                    if self.callbacks['on_message']:
                        self.callbacks['on_message']('sent', command)
                
                return True
            except serial.SerialException as e:
                retries += 1
                error_msg = f"Error sending command (attempt {retries}/{max_retries}): {str(e)}"
                logger.error(error_msg)
                if self.callbacks['on_error']:
                    self.callbacks['on_error'](error_msg)
                time.sleep(0.1)  # Small delay before retrying
        
        return False
    
    def get_status(self):
        """Get current machine status"""
        return self.machine_status
    
    def register_callback(self, event, callback):
        """Register a callback function for specific events"""
        if event in self.callbacks:
            self.callbacks[event] = callback
    
    def send_command(self, command, priority=False):
        """Send a command to GRBL with priority handling"""
        if not self.is_connected:
            error_msg = "Cannot send command: Not connected to GRBL device"
            logger.error(error_msg)
            if self.callbacks['on_error']:
                self.callbacks['on_error'](error_msg)
            return False
        
        try:
            # Prioritize zero commands
            is_zero_command = "G10 L20 P1" in command
            
            # Use highest priority for zero and homing commands
            if is_zero_command or priority:
                with self.queue_lock:
                    while not self.command_queue.empty():
                        self.command_queue.get()
                    
                    # Add the command to the now-empty queue
                    self.command_queue.put((command, 0))
                
                # For zeroing commands, send an immediate WCO query after
                if is_zero_command:
                    # Small delay to ensure zeroing completes
                    time.sleep(0.1)
                    self.send_immediate_command('$#', log=False)  # Get updated work coordinate offsets
                    self.send_immediate_command('?', log=False)   # Get updated position
                    logger.info(f"Sent zeroing command: {command}")
            else:
                # Normal priority command
                self.command_queue.put((command, 0))
            
            return True
        except Exception as e:
            error_msg = f"Error sending command: {str(e)}"
            logger.error(error_msg)
            if self.callbacks['on_error']:
                self.callbacks['on_error'](error_msg)
            return False
    
    def _command_sender(self):
        """Thread function to send commands from the queue with retry logic"""
        MAX_RETRIES = 3
        
        while self.running:
            try:
                if not self.command_queue.empty():
                    command, retry_count = self.command_queue.get()
                    
                    try:
                        cmd = command.strip() + '\n'
                        self.serial_port.write(cmd.encode())
                        
                        log_msg = f"Sent command: {command}"
                        logger.debug(log_msg)
                        if self.callbacks['on_message']:
                            self.callbacks['on_message']('sent', command)
                            
                        self.command_queue.task_done()
                        time.sleep(0.05)  # Small delay between commands
                    except serial.SerialTimeoutException as e:
                        # Handle timeout with retry logic
                        if retry_count < MAX_RETRIES:
                            logger.warning(f"Timeout sending command: {command}, retrying ({retry_count+1}/{MAX_RETRIES})")
                            # Put back in queue with increased retry count
                            self.command_queue.put((command, retry_count + 1))
                        else:
                            error_msg = f"Error sending command after {MAX_RETRIES} retries: {command}"
                            logger.error(error_msg)
                            if self.callbacks['on_error']:
                                self.callbacks['on_error'](error_msg)
                        
                        # Slightly longer delay after timeout
                        time.sleep(0.1)
                else:
                    time.sleep(0.01)  # Very small delay when queue is empty
            except Exception as e:
                error_msg = f"Error in command sender: {str(e)}"
                logger.error(error_msg)
                if self.callbacks['on_error']:
                    self.callbacks['on_error'](error_msg)
                time.sleep(0.5)  # Delay to prevent CPU hogging on error
    
    def _response_reader(self):
        """Thread function to read and process responses"""
        while self.running:
            try:
                if self.serial_port and self.serial_port.is_open and self.serial_port.in_waiting:
                    response = self.serial_port.readline().decode('utf-8', errors='ignore').strip()
                    
                    if response:
                        self._process_response(response)
                        
                        log_msg = f"Received: {response}"
                        logger.debug(log_msg)
                        if self.callbacks['on_message']:
                            self.callbacks['on_message']('received', response)
                else:
                    time.sleep(0.1)
            except Exception as e:
                error_msg = f"Error in response reader: {str(e)}"
                logger.error(error_msg)
                if self.callbacks['on_error']:
                    self.callbacks['on_error'](error_msg)
                time.sleep(1)
    
    def _status_poller(self):
        """Thread function to poll for machine status more frequently"""
        while self.running:
            try:
                # Only poll if connected
                if self.is_connected and self.serial_port and self.serial_port.is_open:
                    try:
                        # Direct write to port for maximum speed
                        self.serial_port.write(b'?')
                        
                        # Very minimal sleep between polls
                        # 0.05 = 20 updates per second, which should feel real-time
                        time.sleep(0.05)  
                    except Exception as e:
                        # If an error occurs, wait a bit longer before trying again
                        logger.error(f"Error sending status query: {str(e)}")
                        time.sleep(0.5)
                else:
                    time.sleep(0.1)
            except Exception as e:
                error_msg = f"Error in status poller: {str(e)}"
                logger.error(error_msg)
                if self.callbacks['on_error']:
                    self.callbacks['on_error'](error_msg)
                time.sleep(0.5)
    
    def _process_response(self, response):
        """Process responses from GRBL"""
        # Status report (response to ? command)
        if response.startswith('<') and response.endswith('>'):
            self._parse_status_report(response)
            # Don't send status reports to console
            return
            
        # Work coordinate offset report (response to $# command)
        if "[G54:" in response or "[G55:" in response or "[G56:" in response:
            self._parse_wco_report(response)
            return
        
        # Filter out ok responses (they're just acknowledgments)
        if response.strip() == 'ok':
            # Still process ok responses but don't log them to console
            self.response_queue.put(response)
            return
        
        # Error messages
        elif response.startswith('error:'):
            error_code = response.split(':')[1].strip()
            error_msg = f"GRBL Error: {error_code}"
            logger.error(error_msg)
            if self.callbacks['on_error']:
                self.callbacks['on_error'](error_msg)
        
        # Add response to queue for any listeners
        self.response_queue.put(response)
        
        # Send to message callback (for console)
        if self.callbacks['on_message']:
            self.callbacks['on_message']('received', response)
    
    def _parse_wco_report(self, response):
        """Parse work coordinate offset report from GRBL"""
        try:
            # Extract G54 offset (default work coordinate system)
            g54_match = re.search(r'G54:(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)', response)
            if g54_match:
                # Update work coordinate offset
                self.machine_status['wco'] = {
                    'x': float(g54_match.group(1)),
                    'y': float(g54_match.group(2)),
                    'z': float(g54_match.group(3))
                }
                logger.debug(f"Updated WCO: {self.machine_status['wco']}")
                
                # Update work position based on machine position and offset
                if 'mpos' in self.machine_status:
                    self._calculate_work_position()
        except Exception as e:
            logger.error(f"Error parsing WCO report: {e}")
    
    def _calculate_work_position(self):
        """Calculate work position from machine position and WCO"""
        mpos = self.machine_status['mpos']
        wco = self.machine_status['wco']
        
        self.machine_status['wpos'] = {
            'x': mpos['x'] - wco['x'],
            'y': mpos['y'] - wco['y'],
            'z': mpos['z'] - wco['z']
        }
        
        logger.debug(f"Calculated WPos: {self.machine_status['wpos']}")
    
    def _parse_status_report(self, status):
        """Parse status report from GRBL"""
        try:
            # Extract machine state
            state_match = re.search(r'<(\w+)', status)
            if state_match:
                new_state = state_match.group(1)
                if new_state != self.machine_status['state']:
                    self.machine_status['state'] = new_state
                    if self.callbacks['on_state_change']:
                        self.callbacks['on_state_change'](new_state)
            
            position_updated = False
            
            # Extract machine position (MPos)
            mpos_match = re.search(r'MPos:(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)', status)
            if mpos_match:
                self.machine_status['mpos'] = {
                    'x': float(mpos_match.group(1)),
                    'y': float(mpos_match.group(2)),
                    'z': float(mpos_match.group(3))
                }
                position_updated = True
                
                # If we have WCO, calculate work position
                if 'wco' in self.machine_status:
                    self._calculate_work_position()
            
            # Extract work position (WPos)
            wpos_match = re.search(r'WPos:(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)', status)
            if wpos_match:
                self.machine_status['wpos'] = {
                    'x': float(wpos_match.group(1)),
                    'y': float(wpos_match.group(2)),
                    'z': float(wpos_match.group(3))
                }
                position_updated = True
                
                # If no MPos was provided, calculate it from WPos and WCO
                if not mpos_match and 'wco' in self.machine_status:
                    wpos = self.machine_status['wpos']
                    wco = self.machine_status['wco']
                    self.machine_status['mpos'] = {
                        'x': wpos['x'] + wco['x'],
                        'y': wpos['y'] + wco['y'],
                        'z': wpos['z'] + wco['z']
                    }
            
            # Extract work coordinate offset (WCO)
            wco_match = re.search(r'WCO:(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)', status)
            if wco_match:
                self.machine_status['wco'] = {
                    'x': float(wco_match.group(1)),
                    'y': float(wco_match.group(2)),
                    'z': float(wco_match.group(3))
                }
                position_updated = True
                
                # Recalculate positions if needed
                if mpos_match and not wpos_match:
                    self._calculate_work_position()
            
            # Extract feed and speed
            fs_match = re.search(r'FS:(\d+),(\d+)', status)
            if fs_match:
                self.machine_status['feed_rate'] = int(fs_match.group(1))
                self.machine_status['spindle_speed'] = int(fs_match.group(2))
            
            # Send position updates if anything has changed
            if position_updated and self.callbacks['on_position_update']:
                # Always make sure both position types exist
                if 'mpos' not in self.machine_status:
                    self.machine_status['mpos'] = {'x': 0.0, 'y': 0.0, 'z': 0.0}
                if 'wpos' not in self.machine_status:
                    self.machine_status['wpos'] = {'x': 0.0, 'y': 0.0, 'z': 0.0}
                    
                # Send position update callback
                self.callbacks['on_position_update']({
                    'mpos': self.machine_status['mpos'],
                    'wpos': self.machine_status['wpos']
                })
        
        except Exception as e:
            error_msg = f"Error parsing status report: {str(e)}"
            logger.error(error_msg)
            if self.callbacks['on_error']:
                self.callbacks['on_error'](error_msg)


# Example usage
if __name__ == "__main__":
    # Create the GRBL manager
    grbl_manager = GRBLSerialManager()
    
    # Define callback handlers
    def on_state_change(state):
        print(f"Machine state changed to: {state}")
    
    def on_position_update(self, position):
        """Callback for position update events - highest priority"""
        if self.clients:
            message = json.dumps({
                'type': 'position_update',
                'position': position
            })
            
            # Send immediately to all clients
            for client in self.clients:
                try:
                    client.send(message)
                except Exception as e:
                    logger.error(f"Error sending position update: {e}")
    
    def on_error(self, error):
        if self.loop is None:
            return
            
        message = json.dumps({
            'type': 'error',
            'message': error
        })
        
        asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)
    
    def on_message(self, direction, message):
        """Callback for message events"""
        # Skip status reports and 'ok' responses completely
        if message.startswith('<') or message == 'ok':
            return
            
        if self.clients:
            message_data = json.dumps({
                'type': 'console_message',
                'direction': direction,
                'message': message
            })
            
            # Broadcast to all clients
            asyncio.run_coroutine_threadsafe(
                self._broadcast(message_data), 
                asyncio.get_event_loop()
            )
    
    # Register callbacks
    grbl_manager.register_callback('on_state_change', on_state_change)
    grbl_manager.register_callback('on_position_update', on_position_update)
    grbl_manager.register_callback('on_error', on_error)
    grbl_manager.register_callback('on_message', on_message)
    
    # List available ports
    ports = grbl_manager.list_ports()
    print("Available ports:")
    for i, port in enumerate(ports):
        print(f"{i+1}. {port['device']} - {port['description']}")
    
    if ports:
        port_idx = input("Enter port number to connect: ")
        try:
            port_idx = int(port_idx) - 1
            if 0 <= port_idx < len(ports):
                port = ports[port_idx]['device']
                print(f"Connecting to {port}...")
                connected = grbl_manager.connect(port)
                
                if connected:
                    print("Connected! Enter commands (type 'exit' to quit):")
                    
                    while True:
                        cmd = input("> ")
                        if cmd.lower() == 'exit':
                            break
                        grbl_manager.send_command(cmd)
                    
                    grbl_manager.disconnect()
                else:
                    print("Failed to connect")
            else:
                print("Invalid port selection")
        except Exception as e:
            print(f"Error: {str(e)}")
