from flask import Flask, request, jsonify
from flask_socketio import SocketIO
from .grbl_controller import GRBLController

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

grbl_controller = None

@app.route('/connect', methods=['POST'])
def connect():
    global grbl_controller
    port = request.json['port']
    try:
        grbl_controller = GRBLController(port)
        grbl_controller.connect()
        return jsonify({"status": "success", "message": "Connected to GRBL controller"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/disconnect', methods=['POST'])
def disconnect():
    global grbl_controller
    if grbl_controller:
        grbl_controller.disconnect()
        grbl_controller = None
        return jsonify({"status": "success", "message": "Disconnected from GRBL controller"})
    return jsonify({"status": "error", "message": "Not connected to any controller"})

@app.route('/send_gcode', methods=['POST'])
def send_gcode():
    if not grbl_controller:
        return jsonify({"status": "error", "message": "Not connected to any controller"})
    gcode = request.json['gcode']
    try:
        response = grbl_controller.send_gcode(gcode)
        grbl_controller.wait_for_movement_completion()
        return jsonify({"status": "success", "response": response})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

@app.route('/reset', methods=['POST'])
def reset():
    if not grbl_controller:
        return jsonify({"status": "error", "message": "Not connected to any controller"})
    grbl_controller.reset()
    return jsonify({"status": "success", "message": "GRBL controller reset"})

@app.route('/home', methods=['POST'])
def home():
    if not grbl_controller:
        return jsonify({"status": "error", "message": "Not connected to any controller"})
    response = grbl_controller.home()
    return jsonify({"status": "success", "response": response})

@app.route('/jog', methods=['POST'])
def jog():
    if not grbl_controller:
        return jsonify({"status": "error", "message": "Not connected to any controller"})
    x = request.json.get('x', 0)
    y = request.json.get('y', 0)
    z = request.json.get('z', 0)
    feed_rate = request.json.get('feed_rate', 1000)
    response = grbl_controller.jog(x, y, z, feed_rate)
    return jsonify({"status": "success", "response": response})

@app.route('/status', methods=['GET'])
def status():
    if not grbl_controller:
        return jsonify({"status": "error", "message": "Not connected to any controller"})
    status = grbl_controller.get_status()
    return jsonify({"status": "success", "grbl_status": status})

def run_server():
    socketio.run(app, host='127.0.0.1', port=5000)

if __name__ == '__main__':
    run_server()