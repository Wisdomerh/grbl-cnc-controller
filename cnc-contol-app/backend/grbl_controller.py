import serial
import time
import re

class GRBLController:
    def __init__(self, port, baud_rate=115200):
        self.serial_port = serial.Serial(port, baud_rate)
        self.is_connected = False

    def connect(self):
        if not self.is_connected:
            self.serial_port.open()
            self.is_connected = True
            self.wake_up()

    def disconnect(self):
        if self.is_connected:
            self.serial_port.close()
            self.is_connected = False

    def wake_up(self):
        self.serial_port.write("\r\n\r\n".encode())
        time.sleep(2)
        self.serial_port.flushInput()

    def send_gcode(self, gcode):
        if not self.is_connected:
            raise Exception("Not connected to GRBL controller")

        gcode = self.remove_comments(gcode)
        self.serial_port.write(f"{gcode}\n".encode())
        response = self.serial_port.readline().decode().strip()
        return response

    def wait_for_movement_completion(self):
        while True:
            self.serial_port.write("?".encode())
            status = self.serial_port.readline().decode().strip()
            if "Idle" in status:
                break
            time.sleep(0.1)

    @staticmethod
    def remove_comments(gcode):
        return re.sub(r'\(.*?\)|;.*', '', gcode).strip()

    def reset(self):
        self.serial_port.write("\x18".encode())  # Ctrl+X
        time.sleep(1)

    def home(self):
        return self.send_gcode("$H")

    def jog(self, x=0, y=0, z=0, feed_rate=1000):
        gcode = f"G91 G0 X{x} Y{y} Z{z} F{feed_rate}"
        return self.send_gcode(gcode)

    def get_status(self):
        self.serial_port.write("?".encode())
        return self.serial_port.readline().decode().strip()