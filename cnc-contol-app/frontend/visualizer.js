import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

class GCodeVisualizer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer();
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        
        this.init();
    }

    init() {
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.container.appendChild(this.renderer.domElement);

        this.camera.position.set(0, 0, 200);
        this.controls.update();

        this.addGrid();
        this.addLights();

        this.animate();
    }

    addGrid() {
        const gridHelper = new THREE.GridHelper(200, 20);
        this.scene.add(gridHelper);
    }

    addLights() {
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    drawPath(gcode) {
        // Parse G-code and create a 3D path
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.LineBasicMaterial({ color: 0x0000ff });

        const points = [];
        let currentPosition = new THREE.Vector3(0, 0, 0);

        gcode.split('\n').forEach(line => {
            const parts = line.trim().split(' ');
            if (parts[0] === 'G1' || parts[0] === 'G0') {
                parts.slice(1).forEach(part => {
                    const axis = part[0];
                    const value = parseFloat(part.slice(1));
                    if (axis === 'X') currentPosition.x = value;
                    if (axis === 'Y') currentPosition.y = value;
                    if (axis === 'Z') currentPosition.z = value;
                });
                points.push(currentPosition.clone());
            }
        });

        geometry.setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
    }

    clear() {
        this.scene.children.forEach(child => {
            if (child instanceof THREE.Line) {
                this.scene.remove(child);
            }
        });
    }
}

export default GCodeVisualizer;