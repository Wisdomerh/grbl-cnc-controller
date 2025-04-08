# backend/lib/websocket_server.py
import json
import logging
import threading
import time
import asyncio
import websockets
import concurrent.futures
import multiprocessing
from .serial_manager import GRBLSerialManager
from .gcode_parser import GCodeParser
from .gcode_generator import GCodeGenerator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WebSocketServer:
    """
    WebSocket server for communication between Python backend and Electron frontend.
    """
    
    def __init__(self, host='localhost', port=5000):
        self.host = host
        self.port = port
        self.serial_manager = GRBLSerialManager()
        self.running = False
        self.clients = set()
        self.gcode_parser = GCodeParser()  # Add the parser instance
        self.job_state = 'idle'  # 'idle', 'running', 'paused', 'error'
        self.job_buffer = []     # Buffer of G-code commands
        self.job_position = 0    # Current position in job buffer
        self.job_total = 0       # Total commands in job
        self.job_thread = None   # Job execution thread
        self.job_paused = threading.Event()  # Event to signal job paused/resumed
        self.job_stop = threading.Event()    # Event to signal job stopped
        self.gcode_generator = GCodeGenerator()

        
        # Create thread pools for parallel processing
        num_cores = multiprocessing.cpu_count()
        logger.info(f"System has {num_cores} CPU cores available")
        self.thread_pool = concurrent.futures.ThreadPoolExecutor(max_workers=14)
        
        # Register serial manager callbacks
        self.serial_manager.register_callback('on_state_change', self._on_state_change)
        self.serial_manager.register_callback('on_position_update', self._on_position_update)
        self.serial_manager.register_callback('on_error', self._on_error)
        self.serial_manager.register_callback('on_message', self._on_message)
        
        # Event loop for the server
        self.loop = None
        self.server = None
    
    # Handler for WebSocket connections
    async def handler(self, websocket):
        self.clients.add(websocket)
        
        try:
            logger.info(f"Client connected: {websocket.remote_address}")
            
            # Send initial machine status
            status = self.serial_manager.get_status()
            await websocket.send(json.dumps({
                'type': 'machine_status',
                'data': status
            }))
            
            # Handle messages
            async for message in websocket:
                try:
                    data = json.loads(message)
                    await self.process_message(websocket, data)
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON: {message}")
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': 'Invalid JSON format'
                    }))
        
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Client disconnected: {websocket.remote_address}")
        
        finally:
            self.clients.remove(websocket)

    async def process_message(self, websocket, data):
        command = data.get('command')
        
        if not command:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'No command specified'
            }))
            return
        
        # Log incoming commands for debugging
        logger.debug(f"Received command: {command}")
        
        # List ports command
        if command == 'list_ports':
            ports = self.serial_manager.list_ports()
            await websocket.send(json.dumps({
                'type': 'ports_list',
                'data': ports
            }))
        
        # Connect command
        elif command == 'connect':
            port = data.get('port')
            baud_rate = data.get('baudRate', 115200)
            
            if not port:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'No port specified'
                }))
                return
            
            # Connect in a separate thread to not block the event loop
            success = await self.loop.run_in_executor(
                self.thread_pool, 
                lambda: self.serial_manager.connect(port, baud_rate)
            )
            
            await websocket.send(json.dumps({
                'type': 'connect_result',
                'success': success,
                'message': "Connected successfully" if success else "Failed to connect"
            }))
            
            if success:
                status = self.serial_manager.get_status()
                await websocket.send(json.dumps({
                    'type': 'machine_status',
                    'data': status
                }))
        
        # Job control commands - centralized handling
        elif command in ['send_gcode', 'pause_job', 'resume_job', 'stop_job', 'emergency_stop']:
            # Check if this is a program execution mode for send_gcode
            if command == 'send_gcode' and data.get('mode') == 'program':
                await self.handle_job_control(websocket, data)
            # Regular G-code sending (not for program execution)
            elif command == 'send_gcode':
                gcode = data.get('gcode')
                priority = data.get('priority', False)
                
                if not gcode:
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': 'No G-code specified'
                    }))
                    return
                
                # Special handling for zero commands to make them immediate
                is_zero_command = isinstance(gcode, str) and ("G10 L20 P1" in gcode or "G28" in gcode)
                
                if is_zero_command:
                    # Zero commands get highest priority and direct execution
                    success = await self.loop.run_in_executor(
                        None,  # Use default executor for fastest execution
                        lambda: self.serial_manager.send_command(gcode, True)
                    )
                    
                    # Request an immediate status update
                    if success:
                        self.serial_manager.send_immediate_command('?')
                else:
                    # Normal G-code processing for non-zero commands
                    async def send_codes():
                        success = True
                        if isinstance(gcode, list):
                            for line in gcode:
                                line_success = await self.loop.run_in_executor(
                                    self.thread_pool,
                                    lambda: self.serial_manager.send_command(line, priority)
                                )
                                if not line_success:
                                    success = False
                                    break
                        else:
                            success = await self.loop.run_in_executor(
                                self.thread_pool,
                                lambda: self.serial_manager.send_command(gcode, priority)
                            )
                        return success
                    
                    success = await send_codes()
                
                await websocket.send(json.dumps({
                    'type': 'gcode_result',
                    'success': success,
                    'message': "G-code sent successfully" if success else "Failed to send G-code"
                }))
            # Other job control commands
            else:
                await self.handle_job_control(websocket, data)
    
        elif command == 'generate_gcode':
            toolpaths = data.get('toolpaths')

            if not toolpaths:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'No toolpaths provided'
                }))
                return

            settings = data.get('settings')

            # Generate G-code in a separate thread
            try:
                gcode = await self.loop.run_in_executor(
                    self.thread_pool,
                    lambda: self.gcode_generator.generate(toolpaths, settings)
                )

                await websocket.send(json.dumps({
                    'type': 'gcode_generated',
                    'gcode': gcode
                }))

                logger.info(f"Generated G-code from {len(toolpaths)} toolpaths")
            except Exception as e:
                error_msg = f"Error generating G-code: {str(e)}"
                logger.error(error_msg)
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': error_msg
                }))

        # Disconnect command
        elif command == 'disconnect':
            await self.loop.run_in_executor(
                self.thread_pool,
                self.serial_manager.disconnect
            )
            
            await websocket.send(json.dumps({
                'type': 'disconnect_result',
                'success': True,
                'message': "Disconnected successfully"
            }))
        
        elif command == 'upload_gcode':
            await self.handle_file_upload(websocket, data)
        
        elif command == 'jog':
            axis = data.get('axis')
            distance = data.get('distance')
            feed_rate = data.get('feedRate', 500)
            
            # Check for secondary axis parameters (for diagonal movement)
            axis2 = data.get('axis2', None)
            distance2 = data.get('distance2', None)
            
            if not axis or distance is None:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Missing axis or distance'
                }))
                return
            
            # Format jog command
            if axis2 and distance2 is not None:
                # Combined command for diagonal movement
                jog_command = f"G91 G0 {axis}{distance} {axis2}{distance2} F{feed_rate}"
            else:
                jog_command = f"G91 G0 {axis}{distance} F{feed_rate}"
            
            success = await self.loop.run_in_executor(
                None,  # Use default executor for faster response
                lambda: self.serial_manager.send_command(jog_command, True)
            )
            
            # Return to absolute positioning
            if success:
                await asyncio.sleep(0.01)  # Smaller delay for faster response
                await self.loop.run_in_executor(
                    None,  # Use default executor for faster response
                    lambda: self.serial_manager.send_command("G90", True)
                )
            
            await websocket.send(json.dumps({
                'type': 'jog_result',
                'success': success,
                'message': "Jog command sent successfully" if success else "Failed to send jog command"
            }))
        
        elif command == 'parse_gcode':
            gcode = data.get('gcode')
            
            if not gcode:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'No G-code provided'
                }))
                return
            
            # Run the parser in a separate thread to avoid blocking the event loop
            visualization_data = await self.loop.run_in_executor(
                self.thread_pool,
                lambda: self.gcode_parser.parse(gcode)
            )
            
            await websocket.send(json.dumps({
                'type': 'gcode_visualization',
                'data': visualization_data
            }))
        
        # Home command
        elif command == 'home':
            success = await self.loop.run_in_executor(
                self.thread_pool,
                lambda: self.serial_manager.send_command("$H", True)
            )
            
            await websocket.send(json.dumps({
                'type': 'home_result',
                'success': success,
                'message': "Homing command sent successfully" if success else "Failed to send homing command"
            }))
        
        # Get status command
        elif command == 'get_status':
            status = self.serial_manager.get_status()
            await websocket.send(json.dumps({
                'type': 'machine_status',
                'data': status
            }))
        
        # Unknown command
        else:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': f"Unknown command: {command}"
            }))

    # Broadcast message to all clients
    async def broadcast(self, message):
        if not self.clients:
            return
            
        # Create a copy of clients to avoid issues if the set changes during iteration
        clients_copy = self.clients.copy()
        
        # Send to all clients
        for websocket in clients_copy:
            try:
                await websocket.send(message)
            except:
                # Client might have disconnected
                pass
    
    def _on_state_change(self, state):
        if self.loop is None or not self.loop.is_running():
            return
            
        message = json.dumps({
            'type': 'state_change',
            'state': state
        })
        
        asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)
    
    # Update the _on_position_update method in websocket_server.py
    # Replace the _on_position_update method in websocket_server.py with this:
    def _on_position_update(self, positions):
        """Callback for position update events with both coordinate systems"""
        if not self.clients or not self.loop:
            return
        
        try:
            # Make a clean copy of the position data with explicit float conversion
            # to avoid any JSON serialization issues
            positions_copy = {
                'mpos': {
                    'x': float(positions['mpos']['x']),
                    'y': float(positions['mpos']['y']),
                    'z': float(positions['mpos']['z'])
                },
                'wpos': {
                    'x': float(positions['wpos']['x']),
                    'y': float(positions['wpos']['y']),
                    'z': float(positions['wpos']['z'])
                }
            }
            
            # Create JSON message
            message = json.dumps({
                'type': 'position_update',
                'positions': positions_copy
            })
            
            # Broadcast to all clients directly
            for client in list(self.clients):
                try:
                    asyncio.run_coroutine_threadsafe(client.send(message), self.loop)
                except Exception as e:
                    logger.error(f"Error sending position update: {str(e)}")
        except Exception as e:
            logger.error(f"Error in _on_position_update: {str(e)}")
    
    def _on_error(self, error):
        if self.loop is None:
            return
            
        message = json.dumps({
            'type': 'error',
            'message': error
        })
        
        asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)
    
    def _on_message(self, direction, message):
        # Skip status updates and ok responses to reduce spam
        if message.startswith('<') or message == 'ok':
            return
            
        if self.loop is None:
            return
            
        message_data = json.dumps({
            'type': 'console_message',
            'direction': direction,
            'message': message
        })
        
        asyncio.run_coroutine_threadsafe(self.broadcast(message_data), self.loop)
    
    # Start the server
    def start(self):
        if self.running:
            logger.warning("Server already running")
            return
        
        self.running = True
        
        # Start in a separate thread
        server_thread = threading.Thread(target=self._run_server)
        server_thread.daemon = True
        server_thread.start()
    
    # Run the server (in a thread)
    def _run_server(self):
        # Create a new event loop for this thread
        asyncio.set_event_loop(asyncio.new_event_loop())
        self.loop = asyncio.get_event_loop()
        
        # Start server
        async def serve():
            self.server = await websockets.serve(self.handler, self.host, self.port)
            logger.info(f"WebSocket server started on ws://{self.host}:{self.port}")
            await self.server.wait_closed()
        
        try:
            self.loop.run_until_complete(serve())
            self.loop.run_forever()
        except Exception as e:
            logger.error(f"WebSocket server error: {e}")
        finally:
            self.loop.close()

    async def handle_file_upload(self, websocket, data):
        """Handle G-code file upload"""
        filename = data.get('filename', 'unnamed.gcode')
        content = data.get('content')
        
        if not content:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': 'No file content provided'
            }))
            return
        
        # Process file extension
        file_extension = filename.split('.')[-1].lower() if '.' in filename else 'gcode'
        
        # Known G-code file extensions
        valid_extensions = ['gcode', 'nc', 'ngc', 'tap', 'txt', 'cnc']
        
        # Validate file extension
        if file_extension not in valid_extensions:
            logger.warning(f"Unusual G-code file extension: {file_extension}")
        
        try:
            # Parse G-code content
            visualization_data = self.gcode_parser.parse(content)
            
            # Send visualization data back
            await websocket.send(json.dumps({
                'type': 'gcode_visualization',
                'data': visualization_data,
                'filename': filename
            }))
            
            logger.info(f"Processed G-code file: {filename} ({len(content)} bytes)")
            
        except Exception as e:
            error_msg = f"Error processing G-code file: {str(e)}"
            logger.error(error_msg)
            await websocket.send(json.dumps({
                'type': 'error',
                'message': error_msg
            }))
    
    def stop(self):
        if not self.running:
            return
        
        self.running = False
        
        # Shutdown thread pool
        try:
            self.thread_pool.shutdown(wait=False)
        except Exception as e:
            logger.error(f"Error shutting down thread pool: {e}")
        
        # Disconnect from GRBL device
        self.serial_manager.disconnect()
        
        # Close server and event loop
        if self.loop and self.loop.is_running():
            async def shutdown():
                # Close all WebSocket connections
                if self.server:
                    self.server.close()
                    await self.server.wait_closed()
                
                # Cancel all pending tasks
                tasks = [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                
                # Stop the event loop
                self.loop.stop()
            
            # Run the shutdown task
            try:
                future = asyncio.run_coroutine_threadsafe(shutdown(), self.loop)
                future.result(timeout=5)  # Wait up to 5 seconds for shutdown
            except Exception as e:
                logger.error(f"Error stopping WebSocket server: {e}")
        
        logger.info("WebSocket server stopped")

    async def handle_job_control(self, websocket, data):
        """Handle job control commands (send program, pause, resume, stop)"""
        command = data.get('command')
        
        if command == 'send_gcode' and data.get('mode') == 'program':
            # This is a G-code program execution
            gcode = data.get('gcode')
            
            if not gcode:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'No G-code provided'
                }))
                return
            
            # Start job execution
            self._start_job(gcode)
            
            # Immediately send job status to confirm receipt
            await websocket.send(json.dumps({
                'type': 'job_status',
                'data': {
                    'state': self.job_state,
                    'progress': 0,
                    'total': len(gcode),
                    'message': f"Started job with {len(gcode)} commands"
                }
            }))
            
            logger.info(f"Started G-code job with {len(gcode)} commands")
            
        elif command == 'pause_job':
            # Pause current job - ALWAYS send the pause command to the machine
            # regardless of our perceived job state
            
            # Store the previous state for reporting
            old_state = self.job_state
            
            # Send feed hold command to GRBL regardless of job state
            success = self.serial_manager.send_immediate_command('!')
            logger.info("Feed hold (pause) command sent to machine")
            
            # Update our internal state
            self.job_paused.clear()
            if self.job_state == 'running':
                self.job_state = 'paused'
            
            # Immediately send job status confirmation
            await websocket.send(json.dumps({
                'type': 'job_status',
                'data': {
                    'state': self.job_state,
                    'progress': self.job_position,
                    'total': self.job_total,
                    'message': "Job paused" if success else "Error sending pause command to machine"
                }
            }))
            
            # Update machine status to reflect the pause command more clearly
            if success:
                # Request an immediate status update
                self.serial_manager.send_immediate_command('?')
            
            logger.info(f"Pause command received, job state: {self.job_state}, command sent: {success}")
            
        elif command == 'resume_job':
            # Resume current job - always accept this command to ensure UI responsiveness
            old_state = self.job_state
            self._resume_job()
            
            # Immediately send job status confirmation
            await websocket.send(json.dumps({
                'type': 'job_status',
                'data': {
                    'state': self.job_state,
                    'progress': self.job_position,
                    'total': self.job_total,
                    'message': "Job resumed" if old_state == 'paused' else "Job was not paused"
                }
            }))
            
            logger.info(f"Resume command received, job state: {self.job_state}")
            
        elif command == 'stop_job':
            # Stop current job
            self._stop_job()
            
            # Immediately send job status confirmation
            await websocket.send(json.dumps({
                'type': 'job_status',
                'data': {
                    'state': self.job_state,
                    'progress': self.job_position,
                    'total': self.job_total,
                    'message': "Job stopped"
                }
            }))
            
            logger.info("Stop command received, job state: idle")
            
        elif command == 'emergency_stop':
            # Emergency stop - send feed hold and flush commands
            self._emergency_stop()
            
            # Immediately send job status confirmation
            await websocket.send(json.dumps({
                'type': 'job_status',
                'data': {
                    'state': 'error',
                    'message': 'Emergency stop activated'
                }
            }))
            
            logger.info("Emergency stop activated")

    def _start_job(self, gcode_lines):
        """Start a new G-code job with improved state handling"""
        # Stop any existing job
        if self.job_state != 'idle':
            self._stop_job()
            time.sleep(0.2)  # Give a moment for cleanup
        
        # Set up new job
        self.job_buffer = gcode_lines
        self.job_position = 0
        self.job_total = len(gcode_lines)
        
        # Clear stop and pause flags
        self.job_stop.clear()
        self.job_paused.set()  # Start in running state (not paused)
        
        # Set job state - MUST be set before starting the thread
        self.job_state = 'running'
        
        # Start job thread
        if self.job_thread and self.job_thread.is_alive():
            logger.warning("Job thread already running, stopping old thread")
            self.job_stop.set()
            self.job_paused.set()  # Unblock thread if paused
            self.job_thread.join(timeout=1.0)
        
        # Create new thread
        self.job_thread = threading.Thread(target=self._execute_job, daemon=True)
        self.job_thread.start()
        
        # Broadcast immediate status update
        self._broadcast_job_status(f"Started G-code job with {self.job_total} commands")
        
        logger.info(f"Started G-code job with {self.job_total} commands")
        return True

    def _execute_job(self):
    """Execute G-code job in a separate thread with improved reliability"""
    try:
        # Increase this thread's priority if possible
        self.set_thread_priority()
        
        # Send immediate status update to confirm job is running
        if self.job_state != 'running':
            self.job_state = 'running'
        
        self._broadcast_job_status("Job starting")
        
        # Initialize adaptive timing
        command_delay = 0.02  # Initial delay between commands
        last_response_time = 0
        
        # Main job execution loop
        while self.job_position < self.job_total and not self.job_stop.is_set():
            # Check if paused - this will block if we're paused
            if not self.job_paused.is_set():
                # Brief sleep while paused to prevent CPU spinning
                time.sleep(0.1)
                continue
            
            # Stop if requested
            if self.job_stop.is_set():
                break
            
            try:
                # Get next command
                command = self.job_buffer[self.job_position]
                
                # Skip empty commands and comments
                if not command or command.strip() == '' or command.startswith('(') or command.startswith(';'):
                    self.job_position += 1
                    continue
                
                # Send command to GRBL
                start_time = time.time()
                success = self.serial_manager.send_command(command)
                response_time = time.time() - start_time
                
                if not success:
                    logger.error(f"Failed to send command: {command}")
                    
                    # Update job state and broadcast error
                    self.job_state = 'error'
                    self._broadcast_job_status(f"Error sending command: {command}")
                    break
                
                # Adaptive timing: adjust delay based on response time
                if response_time < 0.01:  # Very fast response
                    command_delay = max(0.01, command_delay * 0.95)  # Slightly reduce delay
                elif response_time > 0.1:  # Slow response
                    command_delay = min(0.5, command_delay * 1.05)  # Slightly increase delay
                
                # Wait the calculated delay before next command
                time.sleep(command_delay)
                
                # Store last response time for tracking
                last_response_time = response_time
                
                # Add extra delay after complex operations (G2/G3 arcs)
                if 'G2' in command or 'G3' in command:
                    time.sleep(0.1)  # Extra delay for arcs
                
                # Increment position
                self.job_position += 1
                
                # Broadcast status update periodically
                if self.job_position % 5 == 0 or self.job_position == self.job_total:
                    self._broadcast_job_status()
            
            except Exception as e:
                logger.error(f"Error executing command: {str(e)}")
                
                # Update job state and broadcast error
                self.job_state = 'error'
                self._broadcast_job_status(f"Error in job execution: {str(e)}")
                break
        
        # Job completed or stopped
        if not self.job_stop.is_set() and self.job_position >= self.job_total:
            self.job_state = 'idle'
            logger.info("G-code job completed successfully")
        elif self.job_stop.is_set():
            self.job_state = 'idle'
            logger.info("G-code job stopped")
            
        # Final status update
        self._broadcast_job_status("Job complete" if self.job_position >= self.job_total else "Job stopped")
            
    except Exception as e:
        # Job error
        self.job_state = 'error'
        logger.error(f"Error in G-code job execution: {str(e)}")
        
        # Broadcast error
        self._broadcast_job_status(f"Error in job execution: {str(e)}")

    def set_thread_priority(self):
        """Set the current thread to high priority if possible."""
        try:
            import os
            os.nice(-10)  # Increase priority (Linux/macOS)
            logger.info("Set thread priority to high (Linux/macOS)")
        except (ImportError, OSError, AttributeError):
            try:
                import psutil
                import threading
                p = psutil.Process()
                p.nice(psutil.HIGH_PRIORITY_CLASS)  # Windows
                logger.info("Set thread priority to high (Windows)")
            except (ImportError, AttributeError):
                logger.warning("Could not set thread priority (unsupported platform)")

    def _broadcast_job_status(self, message=None):
        """Broadcast job status to all clients"""
        if self.loop and self.clients:
            status_data = {
                'state': self.job_state,
                'progress': self.job_position,
                'total': self.job_total
            }
            
            # Add message if provided
            if message:
                status_data['message'] = message
                
            # Calculate estimated time remaining if possible
            if self.job_position > 0 and self.job_state == 'running':
                # Simple time estimation - could be improved in a future version
                pass
                    
            try:
                asyncio.run_coroutine_threadsafe(
                    self.broadcast(json.dumps({
                        'type': 'job_status',
                        'data': status_data
                    })),
                    self.loop
                )
            except Exception as e:
                logger.error(f"Error broadcasting job status: {str(e)}")

    def _pause_job(self):
        """Pause current job with improved reliability"""
        # Set pause event regardless of current state
        # This makes the pause button always responsive
        self.job_paused.clear()
        
        # Only update state if we're actually running
        if self.job_state == 'running':
            # Update state
            self.job_state = 'paused'
            
            # Send feed hold command to GRBL (!), which is the immediate pause command
            success = self.serial_manager.send_immediate_command('!')
            
            if success:
                logger.info("G-code job paused")
            else:
                logger.error("Failed to send pause command to machine")
        else:
            logger.warning(f"Attempted to pause job but state was: {self.job_state}")

    def _resume_job(self):
        """Resume current job with improved reliability"""
        # Only update state if we're actually paused
        if self.job_state == 'paused':
            # Clear pause event
            self.job_paused.set()
            
            # Update state
            self.job_state = 'running'
            
            # Send cycle start command to GRBL (~), which is the resume command
            success = self.serial_manager.send_immediate_command('~')
            
            if success:
                logger.info("G-code job resumed")
            else:
                logger.error("Failed to send resume command to machine")
        else:
            # Still set the pause event to make the UI responsive
            self.job_paused.set()
            logger.warning(f"Attempted to resume job but state was: {self.job_state}")

    def _stop_job(self, return_to_zero=False):
        """
        Stop current job with option to return to zero
        
        Args:
            return_to_zero (bool): If True, send commands to return to zero after stopping
        """
        # Set stop event
        self.job_stop.set()
        
        # Also set pause event to unblock thread
        self.job_paused.set()
        
        # Update state
        self.job_state = 'idle'
        
        # Send soft reset to GRBL
        self.serial_manager.send_immediate_command('\x18')  # Ctrl+X
        
        # Wait a moment for the reset to take effect
        time.sleep(0.5)
        
        # If requested, return to zero
        if return_to_zero:
            try:
                # Send commands to return to zero after a short delay
                # First set to mm and absolute positioning mode
                self.serial_manager.send_command('G21')  # Set units to millimeters
                time.sleep(0.1)
                self.serial_manager.send_command('G90')  # Set to absolute positioning
                time.sleep(0.1)
                
                # Lift Z axis first for safety
                self.serial_manager.send_command('G0 Z5 F500')
                time.sleep(0.5)  # Give it time to raise
                
                # Move to X and Y zero
                self.serial_manager.send_command('G0 X0 Y0 F800')
                time.sleep(0.5)
                
                # Finally bring Z to zero if needed
                self.serial_manager.send_command('G0 Z0 F500')
                
                logger.info("Returning to zero position after job stop")
            except Exception as e:
                logger.error(f"Error returning to zero: {str(e)}")
        
        logger.info("G-code job stopped")

    def _emergency_stop(self):
        """Emergency stop - immediate halt"""
        # Set stop event
        self.job_stop.set()
        
        # Also set pause event to unblock thread
        self.job_paused.set()
        
        # Update state
        self.job_state = 'error'
        
        # Send feed hold followed by soft reset to GRBL
        self.serial_manager.send_immediate_command('!')
        time.sleep(0.1)
        self.serial_manager.send_immediate_command('\x18')  # Ctrl+X
        
        logger.info("EMERGENCY STOP activated")

# Test server if run directly
if __name__ == "__main__":
    server = WebSocketServer()
    server.start()
    
    print("WebSocket server running. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.stop()
        print("Server stopped")