"use strict";

function parseOBJ(text) {
  // because indices are base 1 let's just fill in the 0th data
    const objPositions = [[0, 0, 0]];
    const objTexcoords = [[0, 0]];
    const objNormals = [[0, 0, 0]];

  // same order as `f` indices
    const objVertexData = [
        objPositions,
        objTexcoords,
        objNormals,
    ];

  // same order as `f` indices
  let webglVertexData = [
    [],   // positions
    [],   // texcoords
    [],   // normals
  ];

  const materialLibs = [];
  const geometries = [];
  let geometry;
  let groups = ['default'];
  let material = 'default';
  let object = 'default';

  const noop = () => {};

  function newGeometry() {
    // If there is an existing geometry and it's
    // not empty then start a new one.
    if (geometry && geometry.data.position.length) {
      geometry = undefined;
    }
  }

  function setGeometry() {
    if (!geometry) {
      const position = [];
      const texcoord = [];
      const normal = [];
      webglVertexData = [
        position,
        texcoord,
        normal,
      ];
      geometry = {
        object,
        groups,
        material,
        data: {
          position,
          texcoord,
          normal,
        },
      };
      geometries.push(geometry);
    }
  }

  function addVertex(vert) {
    const ptn = vert.split('/');
    ptn.forEach((objIndexStr, i) => {
      if (!objIndexStr) {
        return;
      }
      const objIndex = parseInt(objIndexStr);
      const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
      webglVertexData[i].push(...objVertexData[i][index]);
    });
  }

  const keywords = {
    v(parts) {
      objPositions.push(parts.map(parseFloat));
    },
    vn(parts) {
      objNormals.push(parts.map(parseFloat));
    },
    vt(parts) {
      // should check for missing v and extra w?
      objTexcoords.push(parts.map(parseFloat));
    },
    f(parts) {
      setGeometry();
      const numTriangles = parts.length - 2;
      for (let tri = 0; tri < numTriangles; ++tri) {
        addVertex(parts[0]);
        addVertex(parts[tri + 1]);
        addVertex(parts[tri + 2]);
      }
    },
    s: noop,    // smoothing group
    mtllib(parts, unparsedArgs) {
      // the spec says there can be multiple filenames here
      // but many exist with spaces in a single filename
      materialLibs.push(unparsedArgs);
    },
    usemtl(parts, unparsedArgs) {
      material = unparsedArgs;
      newGeometry();
    },
    g(parts) {
      groups = parts;
      newGeometry();
    },
    o(parts, unparsedArgs) {
      object = unparsedArgs;
      newGeometry();
    },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
    const line = lines[lineNo].trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const m = keywordRE.exec(line);
    if (!m) {
      continue;
    }
    const [, keyword, unparsedArgs] = m;
    const parts = line.split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (!handler) {
      console.warn('unhandled keyword:', keyword);  // eslint-disable-line no-console
      continue;
    }
    handler(parts, unparsedArgs);
  }

  // remove any arrays that have no entries.
  for (const geometry of geometries) {
    geometry.data = Object.fromEntries(
        Object.entries(geometry.data).filter(([, array]) => array.length > 0));
  }

  return {
    geometries,
    materialLibs,
  };
}

async function main() {
  // Get A WebGL context
  /** @type {HTMLCanvasElement} */
  const canvas = document.querySelector("#canvas");
  const gl = canvas.getContext("webgl");
  if (!gl) {
    return;
  }

  const vs = `
  attribute vec4 a_position;
  attribute vec3 a_normal;

  uniform mat4 u_projection;
  uniform mat4 u_view;
  uniform mat4 u_world;

  varying vec3 v_normal;

  void main() {
    gl_Position = u_projection * u_view * u_world * a_position;
    v_normal = mat3(u_world) * a_normal;
  }
  `;

  const fs = `
precision mediump float;

varying vec3 v_normal;

uniform vec4 u_diffuse;
uniform vec3 u_lightDirection;
uniform vec3 u_viewDirection; // Add view direction for specular highlights
uniform float u_shininess;    // Shininess factor for specular reflection
uniform vec4 u_specular;      // Specular color

void main () {
    vec3 normal = normalize(v_normal);
    vec3 lightDir = normalize(u_lightDirection);
    vec3 viewDir = normalize(u_viewDirection);

    // Diffuse lighting
    float light = max(dot(lightDir, normal), 0.0);

    // Specular highlights (Blinn-Phong)
    vec3 halfVector = normalize(lightDir + viewDir);
    float specular = pow(max(dot(normal, halfVector), 0.0), u_shininess);

    vec3 color = u_diffuse.rgb * light + u_specular.rgb * specular;
    gl_FragColor = vec4(color, u_diffuse.a);
}
`;



  // compiles and links the shaders, looks up attribute and uniform locations
  const meshProgramInfo = webglUtils.createProgramInfo(gl, [vs, fs]);

  const response = await fetch('mug.obj');  
  const text = await response.text();
  const obj = parseOBJ(text);

  // const parts = obj.geometries.map(({data}) => {
  //   // Because data is just named arrays like this
  //   //
  //   // {
  //   //   position: [...],
  //   //   texcoord: [...],
  //   //   normal: [...],
  //   // }
  //   //
  //   // and because those names match the attributes in our vertex
  //   // shader we can pass it directly into `createBufferInfoFromArrays`
  //   // from the article "less code more fun".

  //   // create a buffer for each array by calling
  //   // gl.createBuffer, gl.bindBuffer, gl.bufferData
  //   const bufferInfo = webglUtils.createBufferInfoFromArrays(gl, data);
  //   return {
  //     material: {
  //       u_diffuse: [1, 1, 1, 1],
  //     },
  //     bufferInfo,
  //   };
  // });
  const parts = obj.geometries.map(({data}) => {
    const bufferInfo = webglUtils.createBufferInfoFromArrays(gl, data);
    return {
        material: {
            u_diffuse: [1, 1, 1, 1],  // Diffuse color, white
            u_specular: [1, 1, 1, 1], // Specular color, white for glossy highlights
            u_shininess: 50.0,        // Shininess level for ceramic-like material
        },
        bufferInfo,
    };
});


  function getExtents(positions) {
    const min = positions.slice(0, 3);
    const max = positions.slice(0, 3);
    for (let i = 3; i < positions.length; i += 3) {
      for (let j = 0; j < 3; ++j) {
        const v = positions[i + j];
        min[j] = Math.min(v, min[j]);
        max[j] = Math.max(v, max[j]);
      }
    }
    return {min, max};
  }

  function getGeometriesExtents(geometries) {
    return geometries.reduce(({min, max}, {data}) => {
      const minMax = getExtents(data.position);
      return {
        min: min.map((min, ndx) => Math.min(minMax.min[ndx], min)),
        max: max.map((max, ndx) => Math.max(minMax.max[ndx], max)),
      };
    }, {
      min: Array(3).fill(Number.POSITIVE_INFINITY),
      max: Array(3).fill(Number.NEGATIVE_INFINITY),
    });
  }

  const extents = getGeometriesExtents(obj.geometries);
  const range = m4.subtractVectors(extents.max, extents.min);
  // amount to move the object so its center is at the origin
  const objOffset = m4.scaleVector(
      m4.addVectors(
        extents.min,
        m4.scaleVector(range, 0.5)),
      -1);
  const cameraTarget = [0, 0, 0];
  // figure out how far away to move the camera so we can likely
  // see the object.
  const radius = m4.length(range) * 1.2;
  const cameraPosition = m4.addVectors(cameraTarget, [
    0,
    0,
    radius,
  ]);
  // Set zNear and zFar to something hopefully appropriate
  // for the size of this object.
  const zNear = radius / 100;
  const zFar = radius * 3;

  function degToRad(deg) {
    return deg * Math.PI / 180;
  }

  function render(time) {
    time *= 0.001;  // convert to seconds

    webglUtils.resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    const fieldOfViewRadians = degToRad(60);
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);

    const up = [0, 1, 0];
    // Compute the camera's matrix using look at.
    const camera = m4.lookAt(cameraPosition, cameraTarget, up);

    // Make a view matrix from the camera matrix.
    const view = m4.inverse(camera);

    const sharedUniforms = {
      u_lightDirection: m4.normalize([-1, 3, 5]),
      u_viewDirection: cameraPosition, // Pass the camera position for specular calculation
      u_projection: projection,
      u_view: view,
      u_shininess: 50.0,               // Adjust shininess for ceramic gloss
      u_specular: [1, 1, 1, 1],        // Specular color, typically white
  };
  

    gl.useProgram(meshProgramInfo.program);

    // calls gl.uniform
    webglUtils.setUniforms(meshProgramInfo, sharedUniforms);

    // compute the world matrix once since all parts
    // are at the same space.
    let u_world = m4.yRotation(time);
    u_world = m4.translate(u_world, ...objOffset);

    for (const {bufferInfo, material} of parts) {
      // calls gl.bindBuffer, gl.enableVertexAttribArray, gl.vertexAttribPointer
      webglUtils.setBuffersAndAttributes(gl, meshProgramInfo, bufferInfo);
      // calls gl.uniform
      webglUtils.setUniforms(meshProgramInfo, {
        u_world,
        u_diffuse: material.u_diffuse,
      });
      // calls gl.drawArrays or gl.drawElements
      webglUtils.drawBufferInfo(gl, bufferInfo);
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}

main();
