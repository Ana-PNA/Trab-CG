import { vec3, mat4 } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js';

export class OrbitCamera {
  constructor() {
    this.theta = 0; this.phi = 0.4; this.radius = 5;
    this.target = vec3.fromValues(0,0,0);
    this.up = vec3.fromValues(0,1,0);
    this.viewMatrix = mat4.create();
    this.projectionMatrix = mat4.create();
    this._eye = vec3.create();
  }
// calculos das matrizes de view e projection
  updateView() {
    const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    vec3.set(this._eye, x + this.target[0], y + this.target[1], z + this.target[2]);
    mat4.lookAt(this.viewMatrix, this._eye, this.target, this.up);
  }

  setPerspective(fovy, aspect, near, far) {
    mat4.perspective(this.projectionMatrix, fovy, aspect, near, far);
  }
}
