export function parseOBJ(text) {
  const lines = text.split(/\r?\n/);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const finalPositions = [];
  const finalNormals = [];
  const finalUVs = [];
  const indexMap = new Map();
  let nextIndex = 0;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];

    if (tag === 'v') {
      positions.push(parts.slice(1).map(Number));
    } else if (tag === 'vn') {
      normals.push(parts.slice(1).map(Number));
    } else if (tag === 'vt') {
      uvs.push(parts.slice(1).map(Number));
    } else if (tag === 'f') {
      const face = parts.slice(1).map(part => {
        const comps = part.split('/');
        return comps.map((value) => (value === '' ? undefined : Number(value)));
      });

      for (let i = 1; i < face.length - 1; i++) {
        [face[0], face[i], face[i + 1]].forEach(v => {
          const key = `${v[0] || 0}/${v[1] || 0}/${v[2] || 0}`;
          if (!indexMap.has(key)) {
            const [vi, vti, vni] = v;
            const pos = positions[(vi || 1) - 1] || [0, 0, 0];
            finalPositions.push(...pos);
            if (vni) {
              finalNormals.push(...(normals[vni - 1] || [0, 0, 1]));
            } else {
              finalNormals.push(0, 0, 1);
            }
            if (vti) {
              finalUVs.push(...(uvs[vti - 1] || [0, 0]));
            } else {
              finalUVs.push(0, 0);
            }
            indexMap.set(key, nextIndex++);
          }
          indices.push(indexMap.get(key));
        });
      }
    }
  }

  return {
    positions: new Float32Array(finalPositions),
    normals: new Float32Array(finalNormals),
    texcoords: new Float32Array(finalUVs),
    indices: new Uint32Array(indices)
  };
}

export function parseMTL(text) {
  const lines = text.split(/\r?\n/);
  const materials = {};
  let current = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];

    if (tag === 'newmtl') {
      current = parts[1];
      materials[current] = {};
    } else if (tag === 'map_Kd' && current) {
      materials[current].map_Kd = parts.slice(1).join(' ');
    } else if (tag === 'Kd' && current) {
      materials[current].Kd = parts.slice(1).map(Number);
    }
  }

  return materials;
}

export function createMeshFromOBJ(gl, objData) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  function createBuffer(data, location, size) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  createBuffer(objData.positions, 0, 3);
  createBuffer(objData.normals, 1, 3);
  createBuffer(objData.texcoords, 2, 2);

  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, objData.indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return {vao, indexCount: objData.indices.length, indexType: gl.UNSIGNED_INT};
}

export async function loadOBJFromFile(gl, path) {

  const res = await fetch(path);
  const text = await res.text();
  const objData = parseOBJ(text);
  return createMeshFromOBJ(gl, objData);
}