import { mat4, vec3 } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js';

export class SceneNode {
  constructor() {
    this.localTranslation = vec3.create();
    
    this.localRotation = vec3.create();
    this.localScale = vec3.fromValues(1,1,1);
    this.parent = null;
    this.children = [];
    this.worldMatrix = mat4.create();
    this._localMatrix = mat4.create();
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i,1);
    child.parent = null;
  }

  updateWorldMatrix() {
   
    mat4.identity(this._localMatrix);
    mat4.translate(this._localMatrix, this._localMatrix, this.localTranslation);
    mat4.rotateX(this._localMatrix, this._localMatrix, this.localRotation[0]);
    mat4.rotateY(this._localMatrix, this._localMatrix, this.localRotation[1]);
    mat4.rotateZ(this._localMatrix, this._localMatrix, this.localRotation[2]);
    mat4.scale(this._localMatrix, this._localMatrix, this.localScale);
    if (this.parent) mat4.multiply(this.worldMatrix, this.parent.worldMatrix, this._localMatrix);
    else mat4.copy(this.worldMatrix, this._localMatrix);
    for (const c of this.children) c.updateWorldMatrix();
  }
}

export class MeshNode extends SceneNode {
  constructor(mesh, material = {}) {
    super();
    this.mesh = mesh;
    this.material = material;
    // Propriedades de estado de animação
    this.animTarget = vec3.create();
    this.animSpeed = 1.0;
    this.animPlaying = false;
    this.selected = false;
  }

  draw(gl, program, config) {
    if (!this.mesh) return;

    // Bind do VAO 
    gl.bindVertexArray(this.mesh.vao);

    // Uniforms: 
    gl.uniformMatrix4fv(config.locations.world, false, this.worldMatrix);
    gl.uniform1i(config.locations.selected, this.selected ? 1 : 0);
    
    // Textura 
    if (!config.pickingMode && this.material.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.material.texture);
      gl.uniform1i(config.locations.texture, 0);
    }

    // Desenho 
    gl.drawElements(gl.TRIANGLES, this.mesh.indexCount, this.mesh.indexType, 0);
    
    // Limpeza rápida
    gl.bindVertexArray(null);
  }
}