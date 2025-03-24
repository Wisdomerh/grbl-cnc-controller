import React, { useState, useEffect } from 'react';
import './ConnectionPanel.css';
import { initSocket } from './socket';

const ConnectionPanel = ({ socket, isConnected, onConnect, onDisconnect }) => {
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ x: 0, y: 0, z: 0 });


  
  // Fetch available ports when socket connects
  useEffect(() => {
    if (socket) {
      const fetchPorts = () => {
        setIsLoading(true);
        setError('');
        
        socket.send(JSON.stringify({
          command: 'list_ports'
        }));
          };
    
          socket.addEventListener('message', handleMessage);
    
          fetchPorts();
    
          return () => {
            socket.removeEventListener('message', handleMessage);
          };
        }
      }, [socket, selectedPort]);
      
  const handleMessage = (event) => {
    try {
      const response = JSON.parse(event.data);
  
      if (response.type === 'ports_list') {
        setPorts(response.data);
        setIsLoading(false);
  
        // Select first port if available and none selected
        if (response.data.length > 0 && !selectedPort) {
          setSelectedPort(response.data[0].device);
        }
      } else if (response.type === 'error') {
        setError(response.message);
        setIsLoading(false);
      } else if (response.type === 'position_update') {
        // Update the position when a position_update message is received
        setPosition(response.positions.wpos); // Use response.positions.wpos instead of response.position
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  };
  
  // Handle connect button click
  const handleConnect = () => {
    if (!selectedPort) {
      setError('Please select a port');
      return;
    }
    
    setIsLoading(true);
    setError('');
    
    socket.send(JSON.stringify({
      command: 'connect',
      port: selectedPort,
      baudRate: baudRate
    }));
    
    onConnect(selectedPort);
  };
  
  // Handle disconnect button click
  const handleDisconnect = () => {
    setIsLoading(true);
    setError('');
    
    socket.send(JSON.stringify({
      command: 'disconnect'
    }));
    
    onDisconnect();
  };
  
  // Handle refresh button click
  const handleRefresh = () => {
    if (socket) {
      socket.send(JSON.stringify({
        command: 'list_ports'
      }));
      
      setIsLoading(true);
      setError('');
    }
  };

  const handleReturnToZero = () => {
    if (socket) {
      socket.send(JSON.stringify({
        command: 'send_gcode',
        gcode: 'G90 G0 X0 Y0 Z0' // Command to move to absolute position (0, 0, 0)
      }));
    }
  };
  
  return (
    <div className="connection-panel">
      <h3>Connection</h3>
      
      <div className="connection-form">
        <div className="form-group">
          <label>Port:</label>
          <div className="port-selector">
            <select 
              value={selectedPort} 
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={isConnected || isLoading}
            >
              <option value="">Select a port</option>
              {ports.map((port, index) => (
                <option key={index} value={port.device}>
                  {port.device} - {port.description}
                </option>
              ))}
            </select>
            <button 
              className="refresh-button" 
              onClick={handleRefresh}
              disabled={isConnected || isLoading}
              title="Refresh port list"
            >
              ⟳
            </button>
          </div>
        </div>
        
        <div className="form-group">
          <label>Baud Rate:</label>
          <select 
            value={baudRate} 
            onChange={(e) => setBaudRate(parseInt(e.target.value))}
            disabled={isConnected || isLoading}
          >
            <option value="9600">9600</option>
            <option value="19200">19200</option>
            <option value="38400">38400</option>
            <option value="57600">57600</option>
            <option value="115200">115200</option>
            <option value="230400">230400</option>
          </select>
        </div>
        
        <div className="connection-status">
          Status: <span className={isConnected ? 'connected' : 'disconnected'}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="position-display">
          Position: 
          <span> X: {position.x.toFixed(3)} </span>
          <span> Y: {position.y.toFixed(3)} </span>
          <span> Z: {position.z.toFixed(3)} </span>
        </div>


        
        {error && <div className="error-message">{error}</div>}
        
        <div className="connection-actions">
          {!isConnected ? (
            <button 
              className="connect-button" 
              onClick={handleConnect}
              disabled={isLoading || !selectedPort}
            >
              {isLoading ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <>
              <button 
                className="disconnect-button" 
                onClick={handleDisconnect}
                disabled={isLoading}
              >
                {isLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
              <button 
                className="return-to-zero-button" 
                onClick={handleReturnToZero}
                disabled={isLoading}
              >
                Return to Zero
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConnectionPanel;