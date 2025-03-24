# backend/main.py
import logging
import argparse
import sys
import os
import threading
import time
import psutil 

# Add the parent directory to the path so we can import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.lib.websocket_server import WebSocketServer

logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def optimize_process_priority():
    """Set high priority for the Python process and configure CPU affinity"""
    try:
        process = psutil.Process(os.getpid())
        
        # Set process priority (nice) to high
        if os.name == 'nt':  # Windows
            process.nice(psutil.HIGH_PRIORITY_CLASS)
            logger.info("Process priority set to HIGH_PRIORITY_CLASS")
        else:  # Unix/Linux
            process.nice(-10)  # Higher priority (-20 is highest, 19 is lowest)
            logger.info("Process nice value set to -10 (higher priority)")
        
        # Set CPU affinity to use all cores
        num_cores = psutil.cpu_count(logical=True)
        process.cpu_affinity(list(range(num_cores)))
        logger.info(f"CPU affinity set to use all {num_cores} cores")
        
    except Exception as e:
        logger.error(f"Error optimizing process: {e}")

def log_system_info():
    """Log information about the system resources"""
    try:
        # CPU information
        cpu_count = psutil.cpu_count(logical=False)
        cpu_threads = psutil.cpu_count(logical=True)
        cpu_freq = psutil.cpu_freq()
        
        # Memory information
        memory = psutil.virtual_memory()
        
        logger.info(f"System has {cpu_count} physical cores, {cpu_threads} logical cores")
        if cpu_freq:
            logger.info(f"CPU frequency: {cpu_freq.current:.2f} MHz")
        logger.info(f"System memory: {memory.total / (1024**3):.2f} GB, {memory.percent}% used")
        
    except Exception as e:
        logger.error(f"Error getting system info: {e}")

def main():
    parser = argparse.ArgumentParser(description='Smart CNC Control Backend')
    parser.add_argument('--host', default='localhost', help='Host address')
    parser.add_argument('--port', type=int, default=5000, help='Port number')
    args = parser.parse_args()

    # Log system information
    log_system_info()
    
    # Optimize process
    optimize_process_priority()
    
    try:
        logger.info("Starting WebSocket server...")
        server = WebSocketServer(host=args.host, port=args.port)
        server.start()
        
        logger.info(f"WebSocket server running on ws://{args.host}:{args.port}")
        logger.info("Press Ctrl+C to stop")
        
        # Keep the main thread running with minimal CPU usage
        while True:
            time.sleep(0.1)
    except KeyboardInterrupt:
        logger.info("Server shutdown by user")
        if 'server' in locals():
            server.stop()
    except Exception as e:
        logger.error(f"Error starting server: {e}")
    finally:
        logger.info("Server process terminated")

if __name__ == '__main__':
    main()