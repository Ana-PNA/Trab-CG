import { createProgram, compileShader } from './webgl-utils.js';
import { OrbitCamera } from './camera.js';
import { SceneNode, MeshNode } from './scene.js';
import { parseOBJ, createMeshFromOBJ, parseMTL } from './obj-loader.js';
import { mat4, vec3 } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js';
import { modelNames } from './lista.js';

// shaders
const vertSrc = `#version 300 es
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec2 a_texcoord;
uniform mat4 u_world, u_view, u_projection;
out vec3 v_normal; out vec2 v_uv;
void main(){
  gl_Position = u_projection * u_view * u_world * vec4(a_position,1.0);
  v_normal = mat3(u_world) * a_normal;
  v_uv = a_texcoord;
}`;

const fragSrc = `#version 300 es
precision mediump float;
in vec3 v_normal; in vec2 v_uv;
uniform vec3 u_lightDir;
uniform sampler2D u_texture;
uniform int u_selected;
uniform int u_pickingMode;
uniform vec3 u_pickColor;
out vec4 outColor;
void main(){
  if (u_pickingMode == 1) { outColor = vec4(u_pickColor,1.0); return; }
  vec4 tex = texture(u_texture, v_uv);
  vec3 N = normalize(v_normal);
  float diff = max(dot(N, normalize(u_lightDir)), 0.0) * 0.7 + 0.3;
  vec3 base = tex.rgb * diff;
  if (u_selected == 1) base = base * 0.4 + vec3(1.0,0.65,0.2) * 0.6;
  outColor = vec4(base, tex.a);
}`;

function initGL(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true });
  if (!gl) { alert('WebGL2 não suportado.'); throw new Error('no webgl2'); }
  const vs = compileShader(gl, vertSrc, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fragSrc, gl.FRAGMENT_SHADER);
  const program = createProgram(gl, vs, fs);
  gl.useProgram(program);
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.11, 0.13, 0.17, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const loc = {
    world:      gl.getUniformLocation(program,'u_world'),
    view:       gl.getUniformLocation(program,'u_view'),
    projection: gl.getUniformLocation(program,'u_projection'),
    lightDir:   gl.getUniformLocation(program,'u_lightDir'),
    texture:    gl.getUniformLocation(program,'u_texture'),
    selected:   gl.getUniformLocation(program,'u_selected'),
    pickingMode:gl.getUniformLocation(program,'u_pickingMode'),
    pickColor:  gl.getUniformLocation(program,'u_pickColor'),
  };
  return { gl, program, loc };
}

function solidTex(gl, rgba) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}

function texFromImage(gl, image) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}

function geomBounds(positions) {
  let minX=Infinity,minY=Infinity,minZ=Infinity, maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x=positions[i], y=positions[i+1], z=positions[i+2];
    if (x<minX)minX=x; if (y<minY)minY=y; if (z<minZ)minZ=z;
    if (x>maxX)maxX=x; if (y>maxY)maxY=y; if (z>maxZ)maxZ=z;
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  const dx=maxX-minX, dy=maxY-minY, dz=maxZ-minZ;
  const radius = Math.max(0.001, 0.5*Math.sqrt(dx*dx+dy*dy+dz*dz));
  return { center:[cx,cy,cz], radius };
}

//main
window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('glcanvas');
  const objectListEl = document.getElementById('objectList');
  const thumbsEl = document.getElementById('thumbsEl');
  const statusEl = document.getElementById('status');
  const parentSelectEl = document.getElementById('parentSelect');

  const { gl, program, loc } = initGL(canvas);
  const whiteTex = solidTex(gl, [255,255,255,255]);

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 96; thumbCanvas.height = 96;
  const thumb = initGL(thumbCanvas);

  const camera = new OrbitCamera();
  camera.radius = 6;
  const root = new SceneNode();
  root.id = 0;
  let selectedNode = null;
  const modelLibrary = [];
  let nextId = 1;

  // grafo cena de hierarquia
  function collectMeshes(node, out = []) {
    if (node instanceof MeshNode) out.push(node);
    for (const c of node.children) collectMeshes(c, out);
    return out;
  }
  function isDescendant(node, maybeAncestor) {
    let p = node?.parent;
    while (p) { if (p === maybeAncestor) return true; p = p.parent; }
    return false;
  }
  function reparent(node, newParent) {
    if (!node || !newParent || node === newParent) return;
    if (newParent === node.parent) return;
   
    if (newParent !== root && isDescendant(newParent, node)) {
      alert('Não é possível anexar a um descendente.');
      return;
    }
    if (node.parent) {
      const i = node.parent.children.indexOf(node);
      if (i >= 0) node.parent.children.splice(i, 1);
    }
    newParent.addChild(node);
  }

  document.getElementById('textureInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedNode) return;

    const bitmap = await createImageBitmap(file);

    // criar a nova textura no WebGL
    const newTexture = texFromImage(gl, bitmap);

    // gestão de memória, exclui a antiga
    if (selectedNode.material.texture && selectedNode.material.texture !== whiteTex) {
      gl.deleteTexture(selectedNode.material.texture);
    }

    // aplicar a nova
    selectedNode.material.texture = newTexture;
    
    // limpa
    e.target.value = '';
  });

  // picking FBO 
  let pickTex, pickFbo, pickRb;
  function initPickFbo() {
    if (pickFbo) gl.deleteFramebuffer(pickFbo);
    if (pickTex) gl.deleteTexture(pickTex);
    if (pickRb)  gl.deleteRenderbuffer(pickRb);
    pickTex = gl.createTexture();
    pickFbo = gl.createFramebuffer();
    pickRb  = gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D, pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, pickRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickRb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function resizeCanvas() {
    const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      camera.setPerspective(Math.PI/4, w/Math.max(1,h), 0.1, 1000);
      initPickFbo();
    }
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // câmera orbital 
  canvas.addEventListener('mousemove', (e) => {
    if (e.buttons === 2 || (e.buttons === 1 && e.shiftKey)) {
      const k = camera.radius * 0.002;
      camera.target[0] -= e.movementX * k;
      camera.target[1] += e.movementY * k;
    } else if (e.buttons === 1) {
      camera.theta -= e.movementX * 0.01;
      camera.phi   -= e.movementY * 0.01;
      camera.phi = Math.max(0.05, Math.min(Math.PI - 0.05, camera.phi));
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.radius = Math.max(0.5, camera.radius + e.deltaY * 0.01);
  }, { passive:false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // carregar modelo 
  async function loadModelFromPackage(name) {
    const basePath = './Assets/obj/';
    try {
      const objText = await fetch(`${basePath}${name}.obj`).then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.text();
      });
      const mtlName = (objText.match(/^mtllib\s+(\S+)/m) || [])[1];
      const objData = parseOBJ(objText);

      let texImage = null;
      if (mtlName) {
        try {
          const mtlText = await fetch(`${basePath}${mtlName}`).then(r => r.text());
          const materials = parseMTL(mtlText);
          const texName = Object.values(materials).map(m => m.map_Kd).find(Boolean);
          if (texName) {
            const blob = await fetch(`${basePath}${texName}`).then(r => r.blob());
            texImage = await createImageBitmap(blob);
          }
        } catch (e) { /* sem material/textura */ }
      }

      const mesh = createMeshFromOBJ(gl, objData);
      const material = { name, texture: texImage ? texFromImage(gl, texImage) : whiteTex };
      const bounds = geomBounds(objData.positions);
      return { name, objData, mesh, material, bounds, texImage };
    } catch (err) {
      console.warn('Falha em', name, err.message);
      return null;
    }
  }

  function renderThumbnail(entry) {
    const tg = thumb.gl, tp = thumb.program, tloc = thumb.loc;
    const tMesh = createMeshFromOBJ(tg, entry.objData);
    const tTex  = entry.texImage ? texFromImage(tg, entry.texImage) : solidTex(tg, [200,200,200,255]);

    const { center, radius } = entry.bounds;
    const proj = mat4.create();
    mat4.perspective(proj, Math.PI/4, 1, 0.01, 1000);
    const dist = radius * 2.8 + 0.5;
    const eye = [center[0]+dist*0.7, center[1]+dist*0.7, center[2]+dist];
    const view = mat4.create();
    mat4.lookAt(view, eye, center, [0,1,0]);
    const world = mat4.create();

    tg.viewport(0, 0, thumbCanvas.width, thumbCanvas.height);
    tg.clearColor(0.07, 0.08, 0.11, 1);
    tg.clear(tg.COLOR_BUFFER_BIT | tg.DEPTH_BUFFER_BIT);
    tg.useProgram(tp);
    tg.uniformMatrix4fv(tloc.view, false, view);
    tg.uniformMatrix4fv(tloc.projection, false, proj);
    tg.uniformMatrix4fv(tloc.world, false, world);
    tg.uniform3fv(tloc.lightDir, [0.5,0.8,0.4]);
    tg.uniform1i(tloc.pickingMode, 0);
    tg.uniform1i(tloc.selected, 0);
    tg.activeTexture(tg.TEXTURE0);
    tg.bindTexture(tg.TEXTURE_2D, tTex);
    tg.uniform1i(tloc.texture, 0);

    tg.bindVertexArray(tMesh.vao);
    tg.drawElements(tg.TRIANGLES, tMesh.indexCount, tMesh.indexType, 0);
    tg.bindVertexArray(null);

    const url = thumbCanvas.toDataURL('image/png');
    tg.deleteVertexArray(tMesh.vao);
    if (tTex !== whiteTex) tg.deleteTexture(tTex);
    return url;
  }

  function addThumbCard(entry) {
    const card = document.createElement('div');
    card.className = 'thumb-card';
    const img = document.createElement('img');
    img.width = 80; img.height = 80;
    img.src = renderThumbnail(entry);
    const span = document.createElement('span');
    span.textContent = entry.name;
    card.appendChild(img); card.appendChild(span);
    card.addEventListener('click', () => instanceFromLibrary(entry));
    thumbsEl.appendChild(card);
  }

  function instanceFromLibrary(entry) {
    const node = new MeshNode(entry.mesh, entry.material);
    node.id = nextId++;
    node.name = entry.material.name;
    
    const parent = selectedNode || root;
    parent.addChild(node);
    rebuildObjectTree();
    selectNode(node);
    if (parent === root) {
      camera.radius = Math.max(camera.radius, entry.bounds.radius * 3 + 1);
    }
  }

  // arvore lateral 
  function rebuildObjectTree() {
    objectListEl.innerHTML = '';
    const buildUL = (parent) => {
      if (parent.children.length === 0) return null;
      const ul = document.createElement('ul');
      for (const child of parent.children) {
        const li = document.createElement('li');
        li.id = `entry-${child.id}`;
        if (child === selectedNode) li.classList.add('selected');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = child.name || child.material?.name || `Nó ${child.id}`;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = child.children.length ? `▾ ${child.children.length}` : '';
        li.appendChild(name);
        li.appendChild(badge);
        li.addEventListener('click', (e) => { e.stopPropagation(); selectNode(child); });
        ul.appendChild(li);
        const sub = buildUL(child);
        if (sub) ul.appendChild(sub);
      }
      return ul;
    };
    const tree = buildUL(root);
    if (tree) objectListEl.appendChild(tree);
    rebuildParentSelect();
  }

  function rebuildParentSelect() {
    parentSelectEl.innerHTML = '<option value="">(Raiz da cena)</option>';
    const all = collectMeshes(root);
    for (const n of all) {
      if (n === selectedNode) continue;
      if (selectedNode && isDescendant(n, selectedNode)) continue; // evita ciclo
      const opt = document.createElement('option');
      opt.value = String(n.id);
      opt.textContent = `${n.name || n.material?.name || 'Nó'} #${n.id}`;
      if (selectedNode && selectedNode.parent === n) opt.selected = true;
      parentSelectEl.appendChild(opt);
    }
    parentSelectEl.disabled = !selectedNode;
  }

  parentSelectEl.addEventListener('change', () => {
    if (!selectedNode) return;
    const id = parseInt(parentSelectEl.value);
    let target = root;
    if (!isNaN(id)) {
      target = collectMeshes(root).find(n => n.id === id) || root;
    }
    reparent(selectedNode, target);
    rebuildObjectTree();
  });

  function clearSelection() {
    if (selectedNode) selectedNode.selected = false;
    selectedNode = null;
    document.querySelectorAll('#objectList li').forEach(li => li.classList.remove('selected'));
    rebuildParentSelect();
  }
  function selectNode(node) {
    if (selectedNode) selectedNode.selected = false;
    selectedNode = node;
    if (node) node.selected = true;
    document.querySelectorAll('#objectList li').forEach(li => li.classList.remove('selected'));
    document.getElementById(`entry-${node?.id}`)?.classList.add('selected');
    updateTransformUI();
    rebuildParentSelect();
  }

  // UI transformações 
  const UI_FIELDS = ['posX','posY','posZ','rotX','rotY','rotZ','scaleX','scaleY','scaleZ',
                     'animTX','animTY','animTZ','animSpeed'];
  function updateTransformUI() {
    if (!selectedNode) return;
    const t = selectedNode.localTranslation, r = selectedNode.localRotation, s = selectedNode.localScale;
    const a = selectedNode.animTarget;
    const set = (id,v) => { const el = document.getElementById(id); if (el) el.value = (+v).toFixed(2); };
    set('posX',t[0]); set('posY',t[1]); set('posZ',t[2]);
    set('rotX',r[0]*180/Math.PI); set('rotY',r[1]*180/Math.PI); set('rotZ',r[2]*180/Math.PI);
    set('scaleX',s[0]); set('scaleY',s[1]); set('scaleZ',s[2]);
    set('animTX',a[0]); set('animTY',a[1]); set('animTZ',a[2]);
    document.getElementById('animSpeed').value = selectedNode.animSpeed;
    document.getElementById('animSpeedVal').textContent = (+selectedNode.animSpeed).toFixed(1);
  }
  const APPLY = {
    posX:v=>selectedNode.localTranslation[0]=v, posY:v=>selectedNode.localTranslation[1]=v, posZ:v=>selectedNode.localTranslation[2]=v,
    rotX:v=>selectedNode.localRotation[0]=v*Math.PI/180, rotY:v=>selectedNode.localRotation[1]=v*Math.PI/180, rotZ:v=>selectedNode.localRotation[2]=v*Math.PI/180,
    scaleX:v=>selectedNode.localScale[0]=v, scaleY:v=>selectedNode.localScale[1]=v, scaleZ:v=>selectedNode.localScale[2]=v,
    animTX:v=>selectedNode.animTarget[0]=v, animTY:v=>selectedNode.animTarget[1]=v, animTZ:v=>selectedNode.animTarget[2]=v,
    animSpeed:v=>{ selectedNode.animSpeed=v; document.getElementById('animSpeedVal').textContent=v.toFixed(1); },
  };
  UI_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      if (!selectedNode) return;
      APPLY[id](parseFloat(el.value) || 0);
    });
  });

  // exclui
  document.getElementById('btn-excluir').addEventListener('click', () => {
    if (!selectedNode) return;
    const node = selectedNode;
    if (node.parent) {
      const i = node.parent.children.indexOf(node);
      if (i >= 0) node.parent.children.splice(i, 1);
    }
    clearSelection();
    rebuildObjectTree();
  });

  // animação 
  document.getElementById('btnPlay').addEventListener('click', () => {
    if (!selectedNode) return alert('Selecione um objeto.');
    selectedNode.animPlaying = true;
  });
  document.getElementById('btnStop').addEventListener('click', () => {
    if (selectedNode) selectedNode.animPlaying = false;
  });

  // picking, recursivo
  function pickAt(x, y) {
    const meshes = collectMeshes(root);
    if (meshes.length === 0) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(loc.view, false, camera.viewMatrix);
    gl.uniformMatrix4fv(loc.projection, false, camera.projectionMatrix);
    gl.uniform1i(loc.pickingMode, 1);
    meshes.forEach((n, idx) => {
      const id = idx + 1;
      const r = ((id>>16)&255)/255, g = ((id>>8)&255)/255, b = (id&255)/255;
      gl.uniform3fv(loc.pickColor, [r,g,b]);
      n.draw(gl, program, { locations: loc, pickingMode: 1 });
    });
    const px = new Uint8Array(4);
    gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.uniform1i(loc.pickingMode, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pid = (px[0]<<16) | (px[1]<<8) | px[2];
    return pid > 0 ? meshes[pid - 1] : null;
  }
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    const hit = pickAt(x, y);
    if (hit) selectNode(hit); else clearSelection();
  });

  // pacote 
  const loadPackageBtn = document.getElementById('loadPackage');
  loadPackageBtn.addEventListener('click', async () => {
    loadPackageBtn.disabled = true;
    const n = Math.max(1, Math.min(modelNames.length, parseInt(document.getElementById('loadCount').value)||24));
    thumbsEl.innerHTML = '';
    modelLibrary.length = 0;
    statusEl.style.display = 'block';
    let done = 0;
    for (const name of modelNames.slice(0, n)) {
      statusEl.textContent = `Carregando ${++done}/${n}: ${name}`;
      const entry = await loadModelFromPackage(name);
      if (entry) { modelLibrary.push(entry); addThumbCard(entry); }
    }
    statusEl.textContent = `Pronto: ${modelLibrary.length} modelos`;
    setTimeout(() => statusEl.style.display = 'none', 1500);
    loadPackageBtn.disabled = false;
    loadPackageBtn.textContent = 'Recarregar';
  });

  // Salva hierarquia 
  document.getElementById('saveScene').addEventListener('click', () => {
    const nodes = [];
    const walk = (n, parentId) => {
      for (const c of n.children) {
        nodes.push({
          id: c.id,
          parentId: parentId,
          modelId: c.material?.name || '',
          name: c.name || '',
          translation: Array.from(c.localTranslation),
          rotation:    Array.from(c.localRotation),
          scale:       Array.from(c.localScale),
          animTarget:  Array.from(c.animTarget),
          animSpeed:   c.animSpeed || 1,
          animPlaying: !!c.animPlaying,
        });
        walk(c, c.id);
      }
    };
    walk(root, null);
    const blob = new Blob([JSON.stringify({ version:2, nodes }, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scene.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // carregar, reconstrói hierarquia
  document.getElementById('loadScene').addEventListener('change', (ev) => {
    const f = ev.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        root.children.length = 0;
        clearSelection();
        const byId = new Map(); 
        //tds nós primeiro
        for (const item of (parsed.nodes || [])) {
          const entry = modelLibrary.find(e => e.name === item.modelId);
          if (!entry) { console.warn('Modelo não está na biblioteca:', item.modelId); continue; }
          const node = new MeshNode(entry.mesh, entry.material);
          node.id = nextId++;
          node.name = item.name || entry.name;
          node.localTranslation = new Float32Array(item.translation);
          node.localRotation    = new Float32Array(item.rotation);
          node.localScale       = new Float32Array(item.scale);
          node.animTarget       = new Float32Array(item.animTarget || [0,0,0]);
          node.animSpeed        = item.animSpeed || 1;
          node.animPlaying      = !!item.animPlaying;
          byId.set(item.id, node);
        }
        // encaixa cada nó > pai 
        for (const item of (parsed.nodes || [])) {
          const node = byId.get(item.id);
          if (!node) continue;
          const parent = item.parentId != null ? (byId.get(item.parentId) || root) : root;
          parent.addChild(node);
        }
        rebuildObjectTree();
      } catch (err) {
        alert('JSON inválido: ' + err.message);
      }
    };
    reader.readAsText(f);
    ev.target.value = '';
  });

  // loop 
  let lastTime = 0;
  function frame(time) {
    const dt = Math.min(0.1, (time - lastTime) * 0.001);
    lastTime = time;
    resizeCanvas();

    // animação recursiva
    const allMeshes = collectMeshes(root);
    for (const c of allMeshes) {
      if (c.animPlaying) {
        for (let i = 0; i < 3; i++) {
          c.localTranslation[i] += (c.animTarget[i] - c.localTranslation[i]) * Math.min(1, c.animSpeed * dt);
        }
        if (selectedNode === c) updateTransformUI();
      }
    }

    root.updateWorldMatrix();
    camera.updateView();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.11, 0.13, 0.17, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(loc.view, false, camera.viewMatrix);
    gl.uniformMatrix4fv(loc.projection, false, camera.projectionMatrix);
    gl.uniform3fv(loc.lightDir, [0.5, 0.8, 0.4]);
    gl.uniform1i(loc.pickingMode, 0);

    // desenha tds os MeshNodes recursiva
    for (const c of allMeshes) {
      if (!c.mesh) continue;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, c.material?.texture || whiteTex);
      gl.uniform1i(loc.texture, 0);
      c.draw(gl, program, { locations: loc, pickingMode: 0 });
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  statusEl.textContent = 'Clique em "Carregar Modelos" para começar.';
});
